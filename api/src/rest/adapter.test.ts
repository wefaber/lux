import { describe, expect, spyOn, test } from "bun:test";
import { buildSchema, type GraphQLSchema } from "graphql";
import { createSchema } from "graphql-yoga";
import { conflict, forbidden, tooManyAttempts } from "../errors";
import { typeDefs } from "../graphql/schema";
import { buildVariables, compileRoutes, runRoute, type RouteSpec } from "./adapter";
import { ROUTES } from "./routes";

const sdl: GraphQLSchema = buildSchema(typeDefs);

describe("tabla de rutas", () => {
  test("todas las rutas apuntan a una operacion existente del esquema", () => {
    expect(() => compileRoutes(sdl, ROUTES)).not.toThrow();
  });

  test("no hay dos rutas con el mismo metodo y path", () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("cada operacion del esquema tiene su ruta REST (si se agrega una, hay que decidir su ruta)", () => {
    const exposed = new Set(ROUTES.map((r) => r.operation));
    const all = [
      ...Object.keys(sdl.getQueryType()!.getFields()),
      ...Object.keys(sdl.getMutationType()!.getFields()),
    ];
    expect(all.filter((name) => !exposed.has(name))).toEqual([]);
  });

  test("las altas responden 201 y los GET nunca ejecutan mutations", () => {
    for (const route of ROUTES) {
      if (route.method === "POST" && route.operation !== "login" && route.operation !== "logout") {
        expect(route.created).toBe(true);
      }
      if (route.method === "GET") expect(sdl.getMutationType()!.getFields()[route.operation]).toBeUndefined();
    }
  });

  test("el selection set se arma del esquema e incluye relaciones anidadas", () => {
    const routes = compileRoutes(sdl, ROUTES);
    const ticket = routes.find((r) => r.spec.operation === "ticket")!;
    const source = ticket.document.loc!.source.body;
    expect(source).toContain("submittedBy { id name");
    expect(source).toContain("equipment { id");
    expect(source).toContain("components { id");
    // nunca campos que el esquema no expone
    expect(source).not.toContain("passwordHash");
  });
});

describe("buildVariables", () => {
  const field = (op: string) => sdl.getQueryType()!.getFields()[op] ?? sdl.getMutationType()!.getFields()[op]!;
  const none = new URLSearchParams();

  test("el path gana sobre el cuerpo y la query string", () => {
    const vars = buildVariables(field("ticket"), { params: { id: "tkt-1" }, query: new URLSearchParams("id=otro"), body: { id: "otro" } });
    expect(vars).toEqual({ id: "tkt-1" });
  });

  test("input es el cuerpo entero; los demas argumentos salen de un campo del cuerpo", () => {
    expect(buildVariables(field("createTicket"), { params: {}, query: none, body: { title: "t" } })).toEqual({ input: { title: "t" } });
    expect(buildVariables(field("rejectLoan"), { params: { id: "l1" }, query: none, body: { reason: "no hay stock" } })).toEqual({ id: "l1", reason: "no hay stock" });
  });

  test("los filtros de lectura se toman de la query string y se tipan segun el esquema", () => {
    const vars = buildVariables(field("users"), { params: {}, query: new URLSearchParams("role=tecnico&isActive=true"), body: undefined });
    expect(vars).toEqual({ role: "tecnico", isActive: true });
  });

  test("un booleano o numero mal escrito es BAD_REQUEST", () => {
    expect(() => buildVariables(field("users"), { params: {}, query: new URLSearchParams("isActive=quizas"), body: undefined })).toThrow("true o false");
    expect(() => buildVariables(field("dashboardStats"), { params: {}, query: none, body: undefined })).not.toThrow();
  });
});

describe("runRoute: envelope y status HTTP", () => {
  const user = { id: "u1", name: "Ana", dni: "1", email: "a@x", role: "solicitante", isActive: true, createdAt: "t", updatedAt: "t" };
  const ticket = {
    id: "tkt-1", title: "t", description: "d", category: "other", status: "pending",
    submittedBy: user, assignedTo: null, equipmentId: null, equipment: null,
    diagnosis: null, corrected: null, actionsTaken: null, createdAt: "t", updatedAt: "t", resolvedAt: null,
  };
  const schema = createSchema({
    typeDefs,
    resolvers: {
      Query: {
        me: () => null,
        ticket: (_p: unknown, a: { id: string }) => (a.id === "tkt-1" ? ticket : null),
        tickets: () => [ticket],
        users: () => {
          throw forbidden();
        },
        login: () => {
          throw tooManyAttempts("bloqueado", 120);
        },
        pendingNews: () => ["ticket"],
      },
      Mutation: {
        createTicket: () => ticket,
        approveLoan: () => {
          throw conflict("ya aprobado");
        },
        softDeleteTicket: () => true,
        logout: () => true,
        acknowledgeNotice: () => {
          throw new Error('relation "notices" does not exist');
        },
      },
    },
  });
  const routes = compileRoutes(schema, ROUTES);
  const run = (method: string, path: string, params: Record<string, string> = {}, body?: unknown, query = "") =>
    runRoute(schema, routes.find((r) => r.spec.method === method && r.spec.path === path)!, { params, query: new URLSearchParams(query), body }, {});

  test("lectura 200 con status, message y data", async () => {
    const r = await run("GET", "/tickets/:id", { id: "tkt-1" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 200, message: "OK", data: { id: "tkt-1", submittedBy: { id: "u1" } } });
    expect(r.body.code).toBeUndefined();
  });

  test("lista vacia o con elementos sigue siendo 200", async () => {
    const r = await run("GET", "/tickets");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  test("alta 201", async () => {
    const r = await run("POST", "/tickets", {}, { title: "t", description: "d", category: "other" });
    expect(r.status).toBe(201);
    expect(r.body.message).toBe("Creado");
  });

  test("baja devuelve el id y deleted", async () => {
    const r = await run("DELETE", "/tickets/:id", { id: "tkt-1" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 200, message: "Eliminado", data: { id: "tkt-1", deleted: true } });
  });

  test("null en una lectura por id es 404; me sin sesion es 401", async () => {
    const missing = await run("GET", "/tickets/:id", { id: "nada" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ status: 404, message: "No encontrado", data: null, code: "NOT_FOUND" });
    const me = await run("GET", "/auth/me");
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("UNAUTHENTICATED");
  });

  test("403, 409 y 429 salen del extensions.status del resolver", async () => {
    expect((await run("GET", "/users")).status).toBe(403);
    const conflicted = await run("PUT", "/loans/:id/approve", { id: "l1" });
    expect(conflicted.status).toBe(409);
    expect(conflicted.body).toMatchObject({ status: 409, message: "ya aprobado", data: null, code: "CONFLICT" });
    const locked = await run("POST", "/auth/login", {}, { dni: "1", password: "x" });
    expect(locked.status).toBe(429);
    expect(locked.headers?.["Retry-After"]).toBe("120");
  });

  test("falta un campo obligatorio: 400 BAD_REQUEST", async () => {
    const r = await run("POST", "/tickets", {}, { title: "solo titulo" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("BAD_REQUEST");
  });

  test("un error inesperado sale como 500 sin el texto original", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const r = await run("DELETE", "/notices/:id", { id: "n1" });
    log.mockRestore();
    expect(r.status).toBe(500);
    expect(r.body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(r.body)).not.toContain("relation");
  });

  test("operaciones booleanas con data propia", async () => {
    expect((await run("POST", "/auth/logout")).body.data).toEqual({ loggedOut: true });
  });
});

describe("RouteSpec", () => {
  test("los paths usan el mismo nombre de parametro que el argumento GraphQL", () => {
    const specs: RouteSpec[] = ROUTES.filter((r) => r.path.includes(":"));
    const compiled = compileRoutes(sdl, specs);
    for (const route of compiled) {
      const names = [...route.spec.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
      for (const name of names) {
        expect(route.field.args.map((a) => a.name)).toContain(name);
      }
    }
  });
});
