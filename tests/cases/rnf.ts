import { check } from "../lib/api";
import type { TestCase } from "./types";

export const rnfCases: TestCase[] = [
  {
    id: "CP-RNF-01",
    cu: "RNF",
    title: "Inyección SQL en el login",
    rf: ["RNF-SEG-002"],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Ninguna.",
    steps: ["Enviar documento ' OR '1'='1 y contraseña ' OR '1'='1"],
    expected: "Credenciales inválidas: las consultas están parametrizadas.",
    api: async (t) => {
      const payload = "' OR '1'='1";
      await t.anon().fails(`query Q($d: String!, $p: String!) { login(dni: $d, password: $p) { token } }`, { d: payload, p: payload }, "Credenciales inválidas");
    },
  },
  {
    id: "CP-RNF-02",
    cu: "RNF",
    title: "XSS almacenado en el título de una incidencia",
    rf: ["RNF-SEG-003"],
    kind: "negativo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión de solicitante.",
    steps: ["Crear una incidencia con título <img src=x onerror=alert(1)>", "Abrir la lista de incidencias"],
    expected: "El título se muestra como texto; no se ejecuta ningún script.",
    api: async (t) => {
      const title = `<img src=x onerror=alert(1)> ${t.runId}`;
      const sol = await t.as("solicitante");
      const d = await sol.ok<{ createTicket: { title: string } }>(
        `mutation Q($input: TicketInput!) { createTicket(input: $input) { title } }`,
        { input: { title, description: "Prueba de sanitización de entradas en la interfaz.", category: "other" } },
      );
      // La API guarda el texto tal cual; la protección es que React lo escapa al renderizar.
      check(d.createTicket.title === title, "la API alteró el texto");
    },
    ui: {
      as: "solicitante",
      start: "/dashboard/tickets",
      goal: "Buscar el ticket con el texto {tag} y abrirlo",
      success: "El título se ve como texto literal con los signos < y >, sin imagen rota",
      // El runner además falla el caso si la página abre un alert().
      setup: async (t) => {
        const tag = `xss-${t.runId}`;
        await (await t.as("solicitante")).ok(`mutation Q($input: TicketInput!) { createTicket(input: $input) { id } }`, {
          input: { title: `<img src=x onerror=alert(1)> ${tag}`, description: "Prueba de sanitización de entradas en la interfaz.", category: "other" },
        });
        return { tag };
      },
    },
  },
  {
    id: "CP-RNF-03",
    cu: "RNF",
    title: "Tiempo de respuesta de las vistas principales",
    rf: ["RNF-REND-001"],
    kind: "limite",
    actor: "admin",
    priority: "media",
    precondition: "Entorno con el dataset de ejemplo.",
    steps: ["Medir las consultas del panel, tickets, inventario y préstamos"],
    expected: "Cada una responde en menos de 3 segundos.",
    api: async (t) => {
      const admin = await t.as("admin");
      const queries = [
        `query { dashboardStats { openTickets } }`,
        `query { tickets { id } }`,
        `query { products { id } }`,
        `query { loans { id } }`,
      ];
      for (const q of queries) {
        const start = performance.now();
        await admin.ok(q);
        const ms = performance.now() - start;
        check(ms < 3000, `${q} tardó ${Math.round(ms)} ms`);
      }
    },
  },
  {
    id: "CP-RNF-04",
    cu: "RNF",
    title: "Interfaz disponible en inglés",
    rf: ["RNF-INT-001"],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión iniciada.",
    steps: ["Cambiar el idioma a inglés", "Recorrer menú, formularios, mensajes y reportes"],
    expected: "Todos los textos se muestran en inglés.",
    ui: { as: "solicitante", start: "/dashboard", goal: "Cambiar el idioma de la interfaz a inglés", success: "El menú y los títulos se ven en inglés", expect: /\b(Inventory|Loans|Requests|Sign out|Profile|Home)\b/ },
  },
  {
    id: "CP-RNF-05",
    cu: "RNF",
    title: "La contraseña nunca se expone",
    rf: ["RNF-SEG-001", "RF-AUTH-002"],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "Sesión de administrador.",
    steps: ["Pedir el campo password o passwordHash de un usuario"],
    expected: "El esquema no expone ningún campo de contraseña.",
    api: async (t) => {
      const admin = await t.as("admin");
      await admin.fails(`query { users { id password } }`, {}, "Cannot query field");
      await admin.fails(`query { users { id passwordHash } }`, {}, "Cannot query field");
    },
  },
];
