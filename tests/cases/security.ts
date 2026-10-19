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
  {
    id: "CP-SEG-04",
    cu: "RNF",
    title: "Cambiar la contraseña cierra las sesiones anteriores",
    rf: [],
    kind: "negativo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Usuario descartable con dos sesiones abiertas.",
    steps: [
      "Abrir dos sesiones con la contraseña vigente",
      "Cambiar la contraseña desde una de ellas",
      "Usar las dos sesiones viejas y volver a iniciar sesión con la contraseña nueva",
      "El administrador restablece la contraseña por updateUser",
    ],
    expected: "Los dos tokens viejos devuelven me = null; la contraseña nueva abre una sesión válida; el restablecimiento del administrador también corta las sesiones.",
    api: async (t) => {
      const user = await t.newUser("solicitante");
      const one = await t.login(user.dni, user.password);
      const two = await t.login(user.dni, user.password);
      check((await one.ok<{ me: { id: string } | null }>(ME)).me?.id === user.id, "la sesión inicial no funciona");

      const next = `Nueva-${t.runId}-Clave`;
      await one.ok(`mutation($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }`, { c: user.password, n: next });
      check((await one.ok<{ me: unknown }>(ME)).me === null, "la sesión que cambió la contraseña sigue válida");
      check((await two.ok<{ me: unknown }>(ME)).me === null, "otra sesión abierta sigue válida tras el cambio");

      await t.anon().failsWith(
        `query($d: String!, $p: String!) { login(dni: $d, password: $p) { token } }`,
        { d: user.dni, p: user.password },
        "INVALID_CREDENTIALS",
        401,
      );
      const fresh = await t.login(user.dni, next);
      check((await fresh.ok<{ me: { id: string } | null }>(ME)).me?.id === user.id, "la sesión con la contraseña nueva no funciona");

      const admin = await t.as("admin");
      await admin.ok(`mutation($id: ID!, $i: UserInput!) { updateUser(id: $id, input: $i) { id } }`, {
        id: user.id,
        i: { name: "Usuario Prueba", dni: user.dni, email: `qa${user.dni}@iti.edu.uy`, role: "solicitante", password: `Reset-${t.runId}-Clave` },
      });
      check((await fresh.ok<{ me: unknown }>(ME)).me === null, "el restablecimiento del administrador no cortó la sesión");
    },
  },
  {
    id: "CP-SEG-05",
    cu: "RNF",
    title: "El login responde igual para cuenta inexistente, clave errónea y cuenta bloqueada",
    rf: ["RF-AUTH-007"],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Usuario descartable y un documento que no existe.",
    steps: [
      "Fallar el login con una cuenta existente y con un documento inexistente",
      "Repetir hasta el bloqueo en ambos",
      "Comparar mensajes, códigos y status, por GraphQL y por REST",
    ],
    expected: "Mismo mensaje en los cuatro casos; los dos bloqueos son TOO_MANY_ATTEMPTS / 429 (con Retry-After por REST) sin importar si la cuenta existe.",
    api: async (t) => {
      const real = await t.newUser("solicitante");
      const ghost = String(80000000 + Math.floor(Math.random() * 9999999));
      const LOGIN = `query($d: String!, $p: String!) { login(dni: $d, password: $p) { token } }`;
      const attempt = async (dni: string) => (await t.anon().gql(LOGIN, { d: dni, p: "mala-clave-qa" })).errors[0];

      const wrong = await attempt(real.dni);
      const missing = await attempt(ghost);
      check(wrong?.message === missing?.message, `mensajes distintos: "${wrong?.message}" vs "${missing?.message}"`);
      check(wrong?.extensions?.code === "INVALID_CREDENTIALS" && missing?.extensions?.code === "INVALID_CREDENTIALS", "los dos deberían ser INVALID_CREDENTIALS");

      for (let i = 0; i < 5; i++) {
        await attempt(real.dni);
        await attempt(ghost);
      }
      const lockedReal = await attempt(real.dni);
      const lockedGhost = await attempt(ghost);
      check(lockedReal?.extensions?.code === "TOO_MANY_ATTEMPTS" && lockedReal.extensions.status === 429, "la cuenta real no quedó bloqueada con 429");
      check(lockedGhost?.extensions?.code === "TOO_MANY_ATTEMPTS" && lockedGhost.extensions.status === 429, "el documento inexistente no se bloquea igual");
      check(lockedReal.message === wrong.message && lockedGhost.message === wrong.message, "el mensaje del bloqueo delata el estado de la cuenta");

      const viaRest = await (await t.rest()).req("POST", "/auth/login", { dni: real.dni, password: real.password });
      check(viaRest.http === 429 && viaRest.body.status === 429, `por REST se esperaba 429 y fue ${viaRest.http}`);
      check(Number(viaRest.headers.get("retry-after")) > 0, "falta Retry-After en el 429");
      check(viaRest.body.message === wrong.message, "el mensaje por REST es distinto");
    },
  },
  {
    id: "CP-SEG-06",
    cu: "RNF",
    title: "Cabeceras de seguridad, CORS con lista de orígenes y tope de tamaño del body",
    rf: [],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "API en ejecución; origen ajeno que no figura en CORS_ORIGINS.",
    steps: [
      "Pedir /graphql, /health y una ruta /api/v1 inexistente y revisar las cabeceras",
      "Preflight desde un origen ajeno y desde uno permitido",
      "Enviar un body de 300 KiB y 15 alias de login en un request",
    ],
    expected: "nosniff, X-Frame-Options DENY, Referrer-Policy y CSP en todas; el origen ajeno recibe 403 sin Allow-Origin; el body grande da 413; los alias dan BAD_REQUEST sin ejecutar ningún login.",
    api: async (t) => {
      const url = (path: string) => new URL(path, t.endpoint).toString();
      const json = { "content-type": "application/json" };
      const probes = [
        await fetch(url("/graphql"), { method: "POST", headers: json, body: JSON.stringify({ query: "{ __typename }" }) }),
        await fetch(url("/health")),
        await fetch(url("/api/v1/ruta-que-no-existe")),
      ];
      for (const res of probes) {
        const where = new URL(res.url).pathname;
        check(res.headers.get("x-content-type-options") === "nosniff", `${where}: falta nosniff`);
        check(res.headers.get("x-frame-options") === "DENY", `${where}: falta X-Frame-Options`);
        check(res.headers.get("referrer-policy") === "no-referrer", `${where}: falta Referrer-Policy`);
        check(res.headers.get("content-security-policy")?.includes("default-src 'none'"), `${where}: falta la CSP`);
      }

      const foreign = "https://sitio-ajeno.example";
      for (const path of ["/graphql", "/api/v1/auth/login"]) {
        const pre = await fetch(url(path), {
          method: "OPTIONS",
          headers: { origin: foreign, "access-control-request-method": "POST", "access-control-request-headers": "content-type,authorization" },
        });
        check(pre.status === 403, `${path}: el preflight ajeno devolvió ${pre.status}`);
        check(pre.headers.get("access-control-allow-origin") === null, `${path}: se reflejó el origen ajeno`);
      }
      const post = await fetch(url("/graphql"), {
        method: "POST",
        headers: { ...json, origin: foreign },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
      check(post.headers.get("access-control-allow-origin") === null, "la respuesta a un origen ajeno trae Allow-Origin");
      check(post.headers.get("access-control-allow-credentials") === null, "la respuesta a un origen ajeno trae Allow-Credentials");

      const big = await fetch(url("/graphql"), {
        method: "POST",
        headers: json,
        body: JSON.stringify({ query: "{ __typename }", padding: "a".repeat(300 * 1024) }),
      });
      check(big.status === 413, `un body de 300 KiB devolvió HTTP ${big.status}`);

      const user = await t.newUser("solicitante");
      const aliases = Array.from({ length: 15 }, (_, i) => `a${i}: login(dni: "${user.dni}", password: "mala-${i}") { token }`).join(" ");
      const batch = await t.anon().gql(`{ ${aliases} }`);
      check(batch.data === null, "se ejecutó algún login de un request con 15 alias");
      check(batch.errors[0]?.extensions?.code === "BAD_REQUEST", `código inesperado: ${batch.errors[0]?.extensions?.code}`);
      // Ningún intento llegó a contarse: la cuenta sigue pudiendo iniciar sesión
      await t.login(user.dni, user.password);
    },
  },
];
