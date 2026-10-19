import { type ApiCtx, check, seedUserId } from "../lib/api";
import type { TestCase } from "./types";

const CREATE = `mutation QaCreateLoan($input: LoanInput!) { createLoan(input: $input) { id status } }`;
const LOAN = `query QaLoan($id: ID!) { loan(id: $id) { id status approvedBy { id } actualReturnDate equipment { id status } } }`;
const APPROVE = `mutation QaApprove($id: ID!) { approveLoan(id: $id) { id status approvedBy { id } } }`;
const REJECT = `mutation QaReject($id: ID!, $reason: String!) { rejectLoan(id: $id, reason: $reason) { id status rejectionReason } }`;
const DELIVER = `mutation QaDeliver($id: ID!) { deliverLoan(id: $id) { id status equipment { status } } }`;
const RETURN = `mutation QaReturn($id: ID!, $damaged: Boolean, $issues: String) { returnLoan(id: $id, damaged: $damaged, issues: $issues) { id status equipment { status } } }`;

type L = { id: string; status: string; approvedBy?: { id: string } | null; rejectionReason?: string | null; equipment?: { id?: string; status: string } };

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

// Pedido nuevo del solicitante sobre un equipo creado para el caso.
async function newLoan(t: ApiCtx, from = 1, to = 8): Promise<{ loanId: string; equipmentId: string }> {
  const product = await t.newProduct();
  const d = await (await t.as("solicitante")).ok<{ createLoan: L }>(CREATE, {
    input: { equipmentId: product.id, issueDate: day(from), returnDate: day(to) },
  });
  return { loanId: d.createLoan.id, equipmentId: product.id };
}

export const loanCases: TestCase[] = [
  {
    id: "CP-05-01",
    cu: "CU-05",
    title: "Solicitar préstamo de un equipo disponible",
    rf: ["RF-PRES-001", "RF-PRES-002"],
    rn: ["RN-07"],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Existe un equipo disponible.",
    steps: ["Elegir el equipo", "Indicar fecha de retiro y de devolución", "Enviar"],
    expected: "El pedido queda 'pendiente' a la espera de autorización.",
    api: async (t) => {
      const { loanId } = await newLoan(t);
      const d = await (await t.as("solicitante")).ok<{ loan: L }>(LOAN, { id: loanId });
      check(d.loan.status === "pending", `estado: ${d.loan.status}`);
    },
    ui: { as: "solicitante", start: "/dashboard/loans", goal: "Pedir en préstamo cualquier equipo disponible desde mañana por una semana", success: "El préstamo aparece en la lista con estado Pendiente" },
  },
  {
    id: "CP-05-02",
    cu: "CU-05",
    title: "Fecha de devolución anterior a la de retiro",
    rf: ["RF-PRES-001"],
    rn: ["RN-09"],
    kind: "limite",
    actor: "solicitante",
    priority: "alta",
    precondition: "Existe un equipo disponible.",
    steps: ["Indicar devolución un día antes del retiro", "Enviar"],
    expected: "Se rechaza el rango (flujo 4a).",
    api: async (t) => {
      const product = await t.newProduct();
      await (await t.as("solicitante")).fails(CREATE, { input: { equipmentId: product.id, issueDate: day(5), returnDate: day(4) } }, "posterior");
    },
  },
  {
    id: "CP-05-03",
    cu: "CU-05",
    title: "Equipo dado de baja no se puede pedir",
    rf: ["RF-PRES-002", "RF-INV-003"],
    kind: "negativo",
    actor: "solicitante",
    priority: "alta",
    precondition: "El equipo está dado de baja.",
    steps: ["Intentar pedir el equipo"],
    expected: "Se informa que no está disponible (flujo 3b, CU-V).",
    knownGap: "Se rechaza, pero el mensaje dice 'Equipo o usuario no encontrado' en vez de informar la baja",
    api: async (t) => {
      const product = await t.newProduct();
      await (await t.as("tecnico")).ok(`mutation QaRetire($id: ID!) { softDeleteProduct(id: $id) }`, { id: product.id });
      await (await t.as("solicitante")).fails(CREATE, { input: { equipmentId: product.id, issueDate: day(1), returnDate: day(3) } }, "disponible");
    },
  },
  {
    id: "CP-05-04",
    cu: "CU-05",
    title: "Segundo pedido pendiente sobre el mismo equipo",
    rf: ["RF-PRES-002"],
    rn: ["RN-07"],
    kind: "limite",
    actor: "solicitante",
    priority: "baja",
    precondition: "El equipo tiene un pedido pendiente de otro solicitante.",
    steps: ["Pedir el mismo equipo"],
    expected: "El pedido se registra: la reserva efectiva ocurre en la autorización (flujo 3c).",
    api: async (t) => {
      const { equipmentId } = await newLoan(t);
      const d = await (await t.asSeed("u-sol-2")).ok<{ createLoan: L }>(CREATE, { input: { equipmentId, issueDate: day(1), returnDate: day(4) } });
      check(d.createLoan.status === "pending", `estado: ${d.createLoan.status}`);
    },
  },
  {
    id: "CP-19-01",
    cu: "CU-19",
    title: "Administrador autoriza un pedido",
    rf: ["RF-PRES-001", "RF-PRES-002"],
    rn: ["RN-15"],
    kind: "positivo",
    actor: "admin",
    priority: "alta",
    precondition: "Existe un pedido pendiente.",
    steps: ["Abrir pedidos pendientes", "Autorizar"],
    expected: "El pedido queda 'aprobado' con el administrador como responsable.",
    api: async (t) => {
      const { loanId } = await newLoan(t);
      const d = await (await t.as("admin")).ok<{ approveLoan: L }>(APPROVE, { id: loanId });
      check(d.approveLoan.status === "approved", `estado: ${d.approveLoan.status}`);
      check(d.approveLoan.approvedBy?.id === seedUserId("admin"), "la autorización no registró responsable (RN-15)");
    },
    ui: {
      as: "admin",
      start: "/dashboard/loans",
      goal: "Aprobar el pedido de préstamo {id}",
      success: "El préstamo {id} pasa a estado Aprobado",
      setup: async (t) => ({ id: (await newLoan(t)).loanId }),
      expect: /Aprobado/,
    },
  },
  {
    id: "CP-19-02",
    cu: "CU-19",
    title: "Denegar sin motivo",
    rf: ["RF-PRES-001"],
    rn: ["RN-16"],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "Existe un pedido pendiente.",
    steps: ["Denegar con motivo vacío", "Denegar con un motivo válido"],
    expected: "El primero se rechaza; el segundo deja el pedido 'rechazado' con su motivo visible.",
    api: async (t) => {
      const { loanId } = await newLoan(t);
      const admin = await t.as("admin");
      await admin.fails(REJECT, { id: loanId, reason: " " }, "motivo");
      const d = await admin.ok<{ rejectLoan: L }>(REJECT, { id: loanId, reason: "Equipo reservado para examen" });
      check(d.rejectLoan.status === "rejected" && d.rejectLoan.rejectionReason, "no quedó rechazado con motivo");
    },
  },
  {
    id: "CP-19-03",
    cu: "CU-19",
    title: "Nadie autoriza su propio pedido",
    rf: ["RF-PRES-001"],
    rn: ["RN-17"],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "El administrador pidió un equipo para sí mismo.",
    steps: ["El mismo administrador intenta autorizarlo"],
    expected: "Se rechaza: la autorización debe recaer en otro administrador (flujo 4b).",
    knownGap: "RN-17 sin implementar: approveLoan no compara solicitante con autorizante",
    api: async (t) => {
      const product = await t.newProduct();
      const admin = await t.as("admin");
      const d = await admin.ok<{ createLoan: L }>(CREATE, { input: { equipmentId: product.id, issueDate: day(1), returnDate: day(2) } });
      await admin.fails(APPROVE, { id: d.createLoan.id });
    },
  },
  {
    id: "CP-19-04",
    cu: "CU-19",
    title: "Solo el Administrador autoriza préstamos",
    rf: ["RF-PRES-001", "RF-AUTH-006"],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "Existe un pedido pendiente.",
    steps: ["Un técnico intenta autorizarlo"],
    expected: "Se rechaza por permisos (CU-19 es del Administrador).",
    knownGap: "approveLoan acepta cualquier rol de staff: el técnico también autoriza",
    api: async (t) => {
      const { loanId } = await newLoan(t);
      await (await t.as("tecnico")).fails(APPROVE, { id: loanId }, "permisos");
    },
  },
  {
    id: "CP-19-05",
    cu: "CU-19",
    title: "Autorizar un equipo ya comprometido",
    rf: ["RF-PRES-002"],
    rn: ["RN-08"],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "Dos pedidos pendientes sobre el mismo equipo; uno ya autorizado.",
    steps: ["Autorizar el segundo pedido"],
    expected: "Se rechaza: un equipo admite un solo préstamo activo (flujo 3a).",
    api: async (t) => {
      const first = await newLoan(t);
      const second = await (await t.asSeed("u-sol-2")).ok<{ createLoan: L }>(CREATE, {
        input: { equipmentId: first.equipmentId, issueDate: day(1), returnDate: day(3) },
      });
      const admin = await t.as("admin");
      await admin.ok(APPROVE, { id: first.loanId });
      await admin.fails(APPROVE, { id: second.createLoan.id }, "comprometido");
    },
  },
  {
    id: "CP-15-01",
    cu: "CU-15",
    title: "Entregar un equipo autorizado",
    rf: ["RF-PRES-001", "RF-PRES-006"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Préstamo aprobado.",
    steps: ["Registrar la entrega"],
    expected: "El préstamo queda 'activo' y el equipo 'en uso'.",
    api: async (t) => {
      const { loanId } = await newLoan(t, 0, 5);
      await (await t.as("admin")).ok(APPROVE, { id: loanId });
      const d = await (await t.as("tecnico")).ok<{ deliverLoan: L }>(DELIVER, { id: loanId });
      check(d.deliverLoan.status === "active", `estado: ${d.deliverLoan.status}`);
      check(d.deliverLoan.equipment?.status === "in_use", `equipo: ${d.deliverLoan.equipment?.status}`);
    },
  },
  {
    id: "CP-15-02",
    cu: "CU-15",
    title: "Entregar un pedido no autorizado",
    rf: ["RF-PRES-001"],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "Préstamo pendiente.",
    steps: ["Intentar registrar la entrega"],
    expected: "Se rechaza.",
    api: async (t) => {
      const { loanId } = await newLoan(t);
      await (await t.as("tecnico")).fails(DELIVER, { id: loanId });
    },
  },
  {
    id: "CP-15-03",
    cu: "CU-15",
    title: "Comprobante PDF del préstamo",
    rf: ["RF-PRES-003"],
    kind: "positivo",
    actor: "tecnico",
    priority: "baja",
    precondition: "Préstamo entregado.",
    steps: ["Descargar el comprobante"],
    expected: "Se genera un PDF con equipo, solicitante, responsable y fechas.",
    knownGap: "RF-PRES-003 sin implementar: no hay comprobante PDF",
  },
  {
    id: "CP-16-01",
    cu: "CU-16",
    title: "Registrar devolución en buen estado",
    rf: ["RF-PRES-005"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Préstamo activo.",
    steps: ["Identificar el préstamo", "Registrar la devolución sin daños"],
    expected: "El préstamo queda 'devuelto' con fecha real y el equipo vuelve a 'disponible'.",
    api: async (t) => {
      const { loanId } = await newLoan(t, 0, 5);
      await (await t.as("admin")).ok(APPROVE, { id: loanId });
      const tec = await t.as("tecnico");
      await tec.ok(DELIVER, { id: loanId });
      const d = await tec.ok<{ returnLoan: L }>(RETURN, { id: loanId, damaged: false });
      check(d.returnLoan.status === "returned", `estado: ${d.returnLoan.status}`);
      check(d.returnLoan.equipment?.status === "available", `equipo: ${d.returnLoan.equipment?.status}`);
    },
  },
  {
    id: "CP-16-02",
    cu: "CU-16",
    title: "Devolución con falla",
    rf: ["RF-PRES-005", "RF-INV-004"],
    rn: ["RN-20"],
    kind: "limite",
    actor: "tecnico",
    priority: "media",
    precondition: "Préstamo activo; el equipo vuelve dañado.",
    steps: ["Registrar la devolución marcando daño y describiendo la falla"],
    expected: "La devolución no se bloquea; el equipo pasa a 'en reparación' (flujo 3a, extiende CU-10).",
    api: async (t) => {
      const { loanId } = await newLoan(t, 0, 5);
      await (await t.as("admin")).ok(APPROVE, { id: loanId });
      const tec = await t.as("tecnico");
      await tec.ok(DELIVER, { id: loanId });
      const d = await tec.ok<{ returnLoan: L }>(RETURN, { id: loanId, damaged: true, issues: "Pantalla rayada" });
      check(d.returnLoan.status === "returned", "la devolución se bloqueó");
      check(d.returnLoan.equipment?.status === "in_repair", `equipo: ${d.returnLoan.equipment?.status}`);
    },
  },
  {
    id: "CP-26-01",
    cu: "CU-26",
    title: "Préstamo vencido sin devolución",
    rf: ["RF-PRES-006"],
    // RN-23 (idempotencia): la segunda evaluación no cambia el resultado. RN-22 (atribución al
    // sistema en la auditoría) no se comprueba acá: la cubre CP-26-03.
    rn: ["RN-23"],
    kind: "positivo",
    actor: "reloj",
    priority: "alta",
    precondition: "Préstamo activo cuya fecha pactada ya pasó.",
    steps: ["Consultar el préstamo", "Consultar el préstamo por segunda vez"],
    expected: "El préstamo figura 'vencido' y sigue vencido en la segunda evaluación.",
    api: async (t) => {
      const { loanId } = await newLoan(t, -3, -1);
      await (await t.as("admin")).ok(APPROVE, { id: loanId });
      const tec = await t.as("tecnico");
      await tec.ok(DELIVER, { id: loanId });
      await tec.ok(`query { loans { id } }`);
      const d = await tec.ok<{ loan: L }>(LOAN, { id: loanId });
      check(d.loan.status === "overdue", `estado: ${d.loan.status}`);
      await tec.ok(`query { loans { id } }`);
      const again = await tec.ok<{ loan: L }>(LOAN, { id: loanId });
      check(again.loan.status === "overdue", `estado tras la segunda evaluación: ${again.loan.status}`);
    },
  },
  {
    id: "CP-26-03",
    cu: "CU-26",
    title: "El vencimiento queda en auditoría atribuido al sistema",
    rf: ["RF-PRES-006", "RF-TRZ-001"],
    rn: ["RN-22"],
    kind: "positivo",
    actor: "reloj",
    priority: "media",
    precondition: "Préstamo activo cuya fecha pactada ya pasó.",
    steps: ["Consultar el préstamo para que se evalúe el vencimiento", "Consultar la auditoría como raíz"],
    expected: "Existe una fila de auditoría sobre el préstamo, con una operación de vencimiento y sin usuario humano.",
    knownGap: "RN-22 sin implementar: syncOverdueLoans cambia el estado y avisa, pero no escribe en activity_logs",
    api: async (t) => {
      const { loanId } = await newLoan(t, -3, -1);
      await (await t.as("admin")).ok(APPROVE, { id: loanId });
      const tec = await t.as("tecnico");
      await tec.ok(DELIVER, { id: loanId });
      await tec.ok(`query { loans { id } }`);
      const root = await t.as("root_admin");
      const d = await root.ok<{ activityLogs: { entityId: string; operation: string; userId: string | null }[] }>(
        `query QaLogsAll { activityLogs { entityId operation userId } }`,
      );
      const row = d.activityLogs.find((l) => l.entityId === loanId && /OVERDUE|EXPIRE/i.test(l.operation));
      check(row, "el vencimiento no quedó en auditoría");
      check(!row.userId, `el vencimiento figura a nombre de ${row.userId}`);
    },
  },
  {
    id: "CP-26-02",
    cu: "CU-26",
    title: "Un préstamo vencido se puede devolver",
    rf: ["RF-PRES-005"],
    rn: ["RN-19", "RN-21"],
    kind: "limite",
    actor: "tecnico",
    priority: "media",
    precondition: "Préstamo vencido.",
    steps: ["Registrar la devolución"],
    expected: "Se registra la devolución.",
    api: async (t) => {
      const { loanId } = await newLoan(t, -3, -1);
      await (await t.as("admin")).ok(APPROVE, { id: loanId });
      const tec = await t.as("tecnico");
      await tec.ok(DELIVER, { id: loanId });
      await tec.ok(`query { loans { id } }`);
      const d = await tec.ok<{ returnLoan: L }>(RETURN, { id: loanId, damaged: false });
      check(d.returnLoan.status === "returned", `estado: ${d.returnLoan.status}`);
    },
  },
];
