import { check, seedCredentials } from "../lib/api";
import type { TestCase } from "./types";

const LOGIN = `query QaLogin($dni: String!, $password: String!) {
  login(dni: $dni, password: $password) { id role token }
}`;
const ME = `query QaMe { me { id role } }`;

export const authCases: TestCase[] = [
  {
    id: "CP-01-01",
    cu: "CU-01",
    title: "Inicio de sesión con credenciales válidas",
    rf: ["RF-AUTH-001", "RF-AUTH-002"],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "El usuario tiene una cuenta vigente.",
    steps: ["Ingresar documento y contraseña válidos", "Enviar el formulario"],
    expected: "Se establece la sesión con el rol de la cuenta y se muestra el inicio.",
    api: async (t) => {
      const { dni, password } = seedCredentials("solicitante");
      const d = await t.anon().ok<{ login: { role: string; token: string } }>(LOGIN, { dni, password });
      check(d.login.role === "solicitante", `rol devuelto: ${d.login.role}`);
      check(d.login.token.split(".").length === 3, "el token no es un JWT");
    },
    // El runner ya inició sesión con el formulario (si fallara, el caso da error): el agente confirma el destino.
    ui: { as: "solicitante", start: "/dashboard", goal: "Confirmar que la sesión está iniciada y se ve el inicio del solicitante", success: "Se ve el saludo con el nombre del usuario y el rol Solicitante", expect: /Solicitante/ },
  },
  {
    id: "CP-01-02",
    cu: "CU-01",
    title: "Contraseña incorrecta",
    rf: ["RF-AUTH-001"],
    rn: ["RN-02"],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Existe la cuenta.",
    steps: ["Ingresar un documento válido y una contraseña incorrecta"],
    expected: "Mensaje 'Credenciales inválidas', sin indicar cuál dato falló.",
    api: async (t) => {
      const { dni } = seedCredentials("solicitante");
      await t.anon().fails(LOGIN, { dni, password: "incorrecta-qa" }, "Credenciales inválidas");
    },
  },
  {
    id: "CP-01-03",
    cu: "CU-01",
    title: "Documento inexistente: mismo mensaje que clave incorrecta",
    rf: ["RF-AUTH-001"],
    rn: ["RN-02"],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Ninguna.",
    steps: ["Ingresar un documento que no existe"],
    expected: "Mensaje idéntico al de CP-01-02 (no permite enumerar cuentas).",
    api: async (t) => {
      const a = await t.anon().fails(LOGIN, { dni: "99999990", password: "x" });
      const { dni } = seedCredentials("solicitante");
      const b = await t.anon().fails(LOGIN, { dni, password: "incorrecta-qa" });
      check(a === b, `mensajes distintos: "${a}" vs "${b}"`);
    },
  },
  {
    id: "CP-01-04",
    cu: "CU-01",
    title: "Bloqueo tras intentos fallidos consecutivos",
    rf: ["RF-AUTH-007"],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Existe la cuenta.",
    steps: ["Fallar el login 6 veces seguidas", "Intentar con la clave correcta"],
    expected: "El acceso queda restringido 15 minutos (bloqueo desde el quinto fallo) y se informa con TOO_MANY_ATTEMPTS / 429.",
    api: async (t) => {
      const { dni, password } = await t.newUser();
      for (let i = 0; i < 6; i++) await t.anon().gql(LOGIN, { dni, password: `mal-${i}` });
      const r = await t.anon().gql(LOGIN, { dni, password });
      check(r.errors.length > 0, "después de 6 fallos el login siguió funcionando");
      check(r.errors[0]?.extensions?.code === "TOO_MANY_ATTEMPTS", `código inesperado: ${r.errors[0]?.extensions?.code}`);
      check(r.errors[0]?.extensions?.status === 429, "el status equivalente no es 429");
    },
  },
  {
    id: "CP-01-05",
    cu: "CU-01",
    title: "Cuenta deshabilitada no puede ingresar",
    rf: ["RF-AUTH-001", "RF-USR-003"],
    kind: "negativo",
    actor: "anonimo",
    priority: "media",
    precondition: "La cuenta fue deshabilitada por un administrador.",
    steps: ["Ingresar con las credenciales de la cuenta deshabilitada"],
    expected: "No se establece sesión.",
    api: async (t) => {
      const user = await t.newUser();
      const admin = await t.as("admin");
      await admin.ok(`mutation QaDeleteUser($id: ID!) { deleteUser(id: $id) }`, { id: user.id });
      await t.anon().fails(LOGIN, { dni: user.dni, password: user.password });
    },
  },
  {
    id: "CP-01-06",
    cu: "CU-01",
    title: "Solicitante no accede a operaciones de administración",
    rf: ["RF-AUTH-006"],
    kind: "negativo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión iniciada como solicitante.",
    steps: ["Pedir el listado de usuarios", "Pedir los reportes", "Pedir el registro de auditoría"],
    expected: "Las tres operaciones se rechazan por permisos.",
    api: async (t) => {
      const sol = await t.as("solicitante");
      await sol.fails(`query { users { id } }`, {}, "permisos");
      await sol.fails(`query { reports { resolution { resolvedCount } } }`, {}, "permisos");
      await sol.fails(`query { activityLogs { id } }`, {}, "permisos");
    },
    ui: { as: "solicitante", start: "/admin/users", goal: "Intentar abrir la gestión de usuarios", success: "El sistema niega el acceso (pantalla 403 o redirección al inicio)", expect: /403|Acceso denegado|Buenos (días|tardes)|Buenas noches/ },
  },
  {
    id: "CP-01-07",
    cu: "CU-01",
    title: "Operación sin sesión",
    rf: ["RF-AUTH-005", "RF-AUTH-006"],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Sin token.",
    steps: ["Consultar 'me' y crear un ticket sin sesión"],
    expected: "La API responde 'No autenticado'.",
    api: async (t) => {
      const r = await t.anon().ok<{ me: unknown }>(ME);
      check(r.me === null, "me devolvió un usuario sin token");
      await t.anon().fails(
        `mutation { createTicket(input: { title: "x", description: "x", category: "hardware" }) { id } }`,
        {},
        "No autenticado",
      );
    },
  },
  {
    id: "CP-02-01",
    cu: "CU-02",
    title: "Cerrar sesión",
    rf: ["RF-AUTH-004"],
    kind: "positivo",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesión iniciada.",
    steps: ["Abrir el menú de usuario", "Elegir 'Cerrar sesión'"],
    expected: "Se vuelve a la pantalla de login y las rutas internas piden autenticación.",
    ui: { as: "solicitante", start: "/dashboard", goal: "Cerrar la sesión desde el menú de usuario", success: "Se ve el formulario de inicio de sesión" },
  },
  {
    id: "CP-02-02",
    cu: "CU-02",
    title: "El token deja de valer después del logout",
    rf: ["RF-AUTH-004"],
    kind: "negativo",
    actor: "solicitante",
    priority: "media",
    precondition: "Se cerró la sesión con la operación logout.",
    steps: ["Iniciar sesión", "Ejecutar logout", "Reutilizar el token anterior contra la API", "Revisar la auditoría"],
    expected: "La API trata el token como no autenticado y la auditoría tiene LOGOUT a nombre del usuario.",
    api: async (t) => {
      const user = await t.newUser();
      const session = await t.login(user.dni, user.password);
      const before = await session.ok<{ me: { id: string } | null }>(ME);
      check(before.me?.id === user.id, "la sesión recién abierta no autentica");
      await session.ok(`mutation QaLogout { logout }`);
      const after = await session.ok<{ me: unknown }>(ME);
      check(after.me === null, "el token sigue autenticando después del logout");
      await session.failsWith(`query { tickets { id } }`, {}, "UNAUTHENTICATED", 401);
      const root = await t.as("root_admin");
      const logs = await root.ok<{ activityLogs: { entityId: string }[] }>(
        `query QaLogout($userId: ID, $operation: String) { activityLogs(userId: $userId, operation: $operation) { entityId } }`,
        { userId: user.id, operation: "LOGOUT" },
      );
      check(logs.activityLogs.length === 1, "el logout no quedó en auditoría");
    },
  },
  {
    id: "CP-27-01",
    cu: "CU-27",
    title: "Token alterado o vencido",
    rf: ["RF-AUTH-003"],
    kind: "negativo",
    actor: "reloj",
    priority: "alta",
    precondition: "Token con firma inválida (equivale a uno vencido para la API).",
    steps: ["Enviar una operación con el token modificado"],
    expected: "La API trata la petición como no autenticada.",
    api: async (t) => {
      const sol = await t.as("solicitante");
      const [h, p] = (sol.token ?? "").split(".");
      const r = await t.withToken(`${h}.${p}.firmaInvalida`).ok<{ me: unknown }>(ME);
      check(r.me === null, "un token con firma inválida fue aceptado");
    },
  },
  {
    id: "CP-27-03",
    cu: "CU-27",
    title: "El token vence a las 8 horas",
    rf: ["RF-AUTH-003"],
    kind: "limite",
    actor: "reloj",
    priority: "media",
    precondition: "Sesión recién iniciada.",
    steps: ["Decodificar el JWT (iat y exp)"],
    expected: "exp - iat = 28800 s (8 h), como se declaró en E2.",
    api: async (t) => {
      const sol = await t.as("solicitante");
      const payload = JSON.parse(Buffer.from((sol.token ?? "").split(".")[1] ?? "", "base64url").toString()) as { iat: number; exp: number };
      check(payload.exp - payload.iat === 8 * 3600, `la vigencia es de ${(payload.exp - payload.iat) / 3600} h`);
    },
  },
  {
    id: "CP-27-02",
    cu: "CU-27",
    title: "Expiración por inactividad configurable",
    rf: ["RF-AUTH-003"],
    kind: "limite",
    actor: "reloj",
    priority: "media",
    precondition: "Sesión inactiva por más del período configurado.",
    steps: ["Dejar la sesión inactiva", "Intentar operar"],
    expected: "La sesión expira y se pide iniciar sesión de nuevo.",
    knownGap: "El JWT vence a las 8 h fijas desde el login; no hay expiración por inactividad configurable",
  },
];
