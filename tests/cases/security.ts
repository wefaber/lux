import { check } from "../lib/api";
import type { TestCase } from "./types";

// Endurecimiento de la API (ronda de seguridad de la 3ra entrega). Cada caso
// replica una de las practicas de ataque de tests/security/run.ts, pero como
// verificacion determinista: pasa cuando el control existe.

const ME = `query QaMe { me { id } }`;

export const securityCases: TestCase[] = [
  {
    id: "CP-SEG-01",
    cu: "RNF",
    title: "Nadie se da de baja a sí mismo (updateUser ni deleteUser)",
    rf: [],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "Administrador descartable con sesión abierta.",
    steps: [
      "El administrador se desactiva con updateUser(isActive: false)",
      "El administrador se desactiva con deleteUser sobre su propio id",
      "Verificar que su sesión sigue activa",
    ],
    expected: "Ambas vías devuelven FORBIDDEN y la cuenta sigue activa; otro administrador sí puede darla de baja.",
    api: async (t) => {
      const me = await t.newUser("admin");
      const client = await t.login(me.dni, me.password);
      await client.failsWith(
        `mutation($id: ID!, $i: UserInput!) { updateUser(id: $id, input: $i) { id } }`,
        { id: me.id, i: { name: "Admin QA", dni: me.dni, email: `qa${me.dni}@iti.edu.uy`, role: "admin", isActive: false } },
        "FORBIDDEN",
        403,
      );
      await client.failsWith(`mutation($id: ID!) { deleteUser(id: $id) }`, { id: me.id }, "FORBIDDEN", 403);
      const still = await client.ok<{ me: { id: string } | null }>(ME);
      check(still.me?.id === me.id, "la cuenta quedó desactivada tras el intento");
      const other = await t.as("admin");
      await other.ok(`mutation($id: ID!) { deleteUser(id: $id) }`, { id: me.id });
    },
  },
  {
    id: "CP-SEG-02",
    cu: "RNF",
    title: "El técnico ve dni y email solo de las personas con las que trabaja",
    rf: [],
    kind: "negativo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Técnico y solicitante descartables; el solicitante tiene una incidencia.",
    steps: [
      "El técnico lista los usuarios sin tener nada asignado",
      "El técnico toma la incidencia del solicitante y vuelve a listar",
      "El administrador y el propio solicitante consultan sus datos",
    ],
    expected: "Antes de tomarla dni y email llegan null (nombre y rol siguen visibles); después se ven solo los del solicitante; el administrador ve todo.",
    api: async (t) => {
      const tec = await t.newUser("tecnico");
      const sol = await t.newUser("solicitante");
      const tecClient = await t.login(tec.dni, tec.password);
      const solClient = await t.login(sol.dni, sol.password);
      const LIST = `query QaUsers { users { id name role dni email } }`;
      type Row = { id: string; name: string; role: string; dni: string | null; email: string | null };

      const before = await tecClient.ok<{ users: Row[] }>(LIST);
      const seenBefore = before.users.find((u) => u.id === sol.id);
      check(seenBefore, "el técnico no ve al solicitante en la lista");
      check(seenBefore.name && seenBefore.role, "el nombre y el rol tienen que seguir visibles");
      check(before.users.filter((u) => u.id !== tec.id).every((u) => u.dni === null && u.email === null), "el técnico ve dni o email de personas sin relación");
      check(before.users.find((u) => u.id === tec.id)?.dni === tec.dni, "el técnico no ve su propio dni");

      // El solicitante crea la incidencia y el técnico la toma
      const created = await solClient.ok<{ createTicket: { id: string } }>(
        `mutation($i: TicketInput!) { createTicket(input: $i) { id } }`,
        { i: { title: t.tag("Sin red en el aula"), description: "No hay conexión de red en toda el aula desde ayer.", category: "network" } },
      );
      await tecClient.ok(`mutation($id: ID!) { claimTicket(id: $id) { id } }`, { id: created.createTicket.id });

      const after = await tecClient.ok<{ users: Row[] }>(LIST);
      const related = after.users.find((u) => u.id === sol.id);
      check(related?.dni === sol.dni, "el técnico no ve el dni del solicitante con ticket asignado");
      const others = after.users.filter((u) => u.id !== tec.id && u.id !== sol.id);
      check(others.every((u) => u.dni === null && u.email === null), "se filtró dni o email de alguien sin relación");

      const admin = await t.as("admin");
      const all = await admin.ok<{ users: Row[] }>(LIST);
      check(all.users.every((u) => u.dni && u.email), "el administrador tiene que ver dni y email de todos");

      // El solicitante ve sus datos, pero no los del técnico que lo atiende
      const mine = await solClient.ok<{ ticket: { assignedTo: { dni: string | null; email: string | null } | null }; me: { id: string } }>(
        `query($id: ID!) { me { id } ticket(id: $id) { assignedTo { dni email } } }`,
        { id: created.createTicket.id },
      );
      check(mine.ticket.assignedTo?.dni === null && mine.ticket.assignedTo?.email === null, "el solicitante ve el dni o email del técnico");
    },
  },
  {
    id: "CP-SEG-03",
    cu: "RNF",
    title: "Un técnico no modifica el trabajo asignado a otro técnico",
    rf: [],
    kind: "negativo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Dos técnicos descartables; una incidencia tomada por el primero; una solicitud de servicio sin asignar.",
    steps: [
      "El técnico B intenta cambiar estado, editar, completar y reasignar la incidencia del técnico A",
      "El técnico A y el administrador sí pueden operarla",
      "El técnico B toma la solicitud sin asignar y el técnico A intenta modificarla",
    ],
    expected: "Las cuatro operaciones del técnico B devuelven FORBIDDEN; el asignado y el administrador conservan el control; lo que está sin asignar se reclama.",
    api: async (t) => {
      const a = await t.newUser("tecnico");
      const b = await t.newUser("tecnico");
      const tecA = await t.login(a.dni, a.password);
      const tecB = await t.login(b.dni, b.password);
      const admin = await t.as("admin");

      const ticket = await t.newTicket();
      await tecA.ok(`mutation($id: ID!) { claimTicket(id: $id) { id } }`, { id: ticket });

      await tecB.failsWith(`mutation($id: ID!) { changeTicketStatus(id: $id, status: "in_resolution") { id } }`, { id: ticket }, "FORBIDDEN", 403);
      await tecB.failsWith(`mutation($id: ID!) { updateTicket(id: $id, input: { title: "Cambiado por otro técnico" }) { id } }`, { id: ticket }, "FORBIDDEN", 403);
      await tecB.failsWith(
        `mutation($id: ID!) { completeTicket(id: $id, input: { diagnosis: "x", corrected: true, actionsTaken: "y" }) { id } }`,
        { id: ticket },
        "FORBIDDEN",
        403,
      );
      await tecB.failsWith(`mutation($id: ID!, $t: ID!) { assignTicket(id: $id, technicianId: $t) { id } }`, { id: ticket, t: b.id }, "FORBIDDEN", 403);

      const untouched = await tecA.ok<{ ticket: { assignedTo: { id: string }; status: string } }>(
        `query($id: ID!) { ticket(id: $id) { status assignedTo { id } } }`,
        { id: ticket },
      );
      check(untouched.ticket.assignedTo.id === a.id && untouched.ticket.status === "in_progress", "el ticket cambió pese al rechazo");

      await tecA.ok(`mutation($id: ID!) { changeTicketStatus(id: $id, status: "in_resolution") { id } }`, { id: ticket });
      await admin.ok(`mutation($id: ID!, $t: ID!) { assignTicket(id: $id, technicianId: $t) { id } }`, { id: ticket, t: b.id });
      await tecB.ok(`mutation($id: ID!) { updateTicket(id: $id, input: { title: "Ahora lo atiende B" }) { id } }`, { id: ticket });

      // Solicitud sin asignar: cualquiera la reclama, después queda del que la tomó
      const service = await t.newService();
      await tecB.ok(`mutation($id: ID!) { updateServiceRequest(id: $id, input: { status: "in_progress" }) { id assignedTo { id } } }`, { id: service });
      await tecA.failsWith(`mutation($id: ID!) { updateServiceRequest(id: $id, input: { status: "in_progress" }) { id } }`, { id: service }, "FORBIDDEN", 403);
      await tecA.failsWith(`mutation($id: ID!, $t: ID!) { assignServiceRequest(id: $id, technicianId: $t) { id } }`, { id: service, t: a.id }, "FORBIDDEN", 403);
    },
  },
];
