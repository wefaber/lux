import { mockPasswords, mockUsers } from "../../api/src/db/fixtures/data/users";
import { suggestMachineId } from "../../api/src/lib/validation";
import type { Role } from "../cases/types";

// Cliente GraphQL mínimo para los casos de nivel 1. Las credenciales salen del
// seed del propio repo (api/src/db/fixtures/data/users.ts); en un entorno que no
// use ese seed se pisan con QA_DNI_<ROL> y QA_PASSWORD_<ROL>.

export interface GqlError {
  message: string;
  extensions?: { code?: string; status?: number; [key: string]: unknown };
}

export interface GqlResult<T = Record<string, unknown>> {
  data: T | null;
  errors: GqlError[];
}

export class AssertionError extends Error {}

const SEED_BY_ROLE: Record<Role, string> = {
  root_admin: "u-root",
  admin: "u-admin-1",
  tecnico: "u-tec-1",
  solicitante: "u-sol-1",
};

function credentials(role: Role): { dni: string; password: string } {
  const key = role.toUpperCase();
  const seed = mockUsers.find((u) => u.id === SEED_BY_ROLE[role]);
  const dni = process.env[`QA_DNI_${key}`] ?? seed?.dni;
  const password = process.env[`QA_PASSWORD_${key}`] ?? (dni ? mockPasswords[dni] : undefined);
  if (!dni || !password) throw new Error(`Sin credenciales de prueba para el rol ${role}`);
  return { dni, password };
}

export function seedUserId(role: Role): string {
  return SEED_BY_ROLE[role];
}

export function seedCredentials(role: Role) {
  return credentials(role);
}

export class Client {
  constructor(
    private readonly endpoint: string,
    readonly token: string | null,
  ) {}

  async gql<T = Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GqlResult<T>> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<GqlResult<T>>;
    return { data: body.data ?? null, errors: body.errors ?? [] };
  }

  // Devuelve data o falla el caso con el primer error de la API.
  async ok<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const r = await this.gql<T>(query, variables);
    if (r.errors.length > 0 || !r.data) {
      throw new AssertionError(`se esperaba éxito y la API respondió: ${r.errors.map((e) => e.message).join(" | ")}`);
    }
    return r.data;
  }

  // Exige que la operación falle; si se pasa `match`, el mensaje tiene que contenerlo.
  async fails(query: string, variables?: Record<string, unknown>, match?: string | RegExp): Promise<string> {
    const r = await this.gql(query, variables);
    if (r.errors.length === 0) throw new AssertionError("se esperaba un error y la operación se ejecutó");
    const msg = r.errors.map((e) => e.message).join(" | ");
    if (match && !(typeof match === "string" ? msg.includes(match) : match.test(msg))) {
      throw new AssertionError(`error distinto del esperado: "${msg}"`);
    }
    return msg;
  }

  // Exige que falle con un código del catálogo de errores (extensions.code) y el
  // status HTTP equivalente que lo acompaña.
  async failsWith(
    query: string,
    variables: Record<string, unknown> | undefined,
    code: string,
    status: number,
  ): Promise<GqlError> {
    const r = await this.gql(query, variables);
    const error = r.errors[0];
    if (!error) throw new AssertionError("se esperaba un error y la operación se ejecutó");
    const got = error.extensions;
    if (got?.code !== code || got?.status !== status) {
      throw new AssertionError(
        `se esperaba ${code}/${status} y la API devolvió ${got?.code}/${got?.status} ("${error.message}")`,
      );
    }
    return error;
  }
}

export class ApiCtx {
  private tokens = new Map<Role, string>();
  private cache = new Map<string, unknown>();
  readonly runId = Date.now().toString(36);
  private seq = 0;

  constructor(readonly endpoint: string) {}

  anon(): Client {
    return new Client(this.endpoint, null);
  }

  withToken(token: string): Client {
    return new Client(this.endpoint, token);
  }

  async as(role: Role): Promise<Client> {
    let token = this.tokens.get(role);
    if (!token) {
      const { dni, password } = credentials(role);
      const data = await this.anon().ok<{ login: { token: string } }>(
        `query QaLogin($dni: String!, $password: String!) { login(dni: $dni, password: $password) { token } }`,
        { dni, password },
      );
      token = data.login.token;
      this.tokens.set(role, token);
    }
    return new Client(this.endpoint, token);
  }

  // Sesión de un usuario puntual del seed (p. ej. un segundo técnico).
  async asSeed(userId: string): Promise<Client> {
    const user = mockUsers.find((u) => u.id === userId);
    const password = user ? mockPasswords[user.dni] : undefined;
    if (!user || !password) throw new Error(`El seed no tiene al usuario ${userId}`);
    return this.login(user.dni, password);
  }

  async login(dni: string, password: string): Promise<Client> {
    const data = await this.anon().ok<{ login: { token: string } }>(
      `query QaLogin($dni: String!, $password: String!) { login(dni: $dni, password: $password) { token } }`,
      { dni, password },
    );
    return new Client(this.endpoint, data.login.token);
  }

  // Usuario descartable creado por el administrador (para casos que lo bloquean o lo dan de baja).
  async newUser(role: Role = "solicitante"): Promise<{ id: string; dni: string; password: string }> {
    const admin = await this.as("admin");
    const dni = String(90000000 + Math.floor(Math.random() * 9999999));
    const password = `QaPass-${this.runId}`;
    const d = await admin.ok<{ createUser: { id: string } }>(
      `mutation QaCreateUser($input: UserInput!) { createUser(input: $input) { id } }`,
      { input: { name: "Usuario Prueba", dni, email: `qa${dni}@iti.edu.uy`, password, role } },
    );
    return { id: d.createUser.id, dni, password };
  }

  // Ticket nuevo del solicitante, en estado pendiente.
  async newTicket(equipmentId?: string): Promise<string> {
    const sol = await this.as("solicitante");
    const d = await sol.ok<{ createTicket: { id: string } }>(
      `mutation QaCreateTicket($input: TicketInput!) { createTicket(input: $input) { id } }`,
      {
        input: {
          title: this.tag("Monitor sin imagen"),
          description: "El monitor no enciende desde la mañana; probé otro cable y sigue igual.",
          category: "hardware",
          equipmentId,
        },
      },
    );
    return d.createTicket.id;
  }

  // Préstamo pendiente del solicitante sobre un equipo nuevo (o el indicado).
  async newLoan(equipmentId?: string): Promise<{ id: string; equipmentId: string }> {
    const eq = equipmentId ?? (await this.newProduct()).id;
    const sol = await this.as("solicitante");
    const day = 24 * 3600 * 1000;
    const d = await sol.ok<{ createLoan: { id: string } }>(
      `mutation QaCreateLoan($input: LoanInput!) { createLoan(input: $input) { id } }`,
      {
        input: {
          equipmentId: eq,
          issueDate: new Date(Date.now() + day).toISOString(),
          returnDate: new Date(Date.now() + 2 * day).toISOString(),
        },
      },
    );
    return { id: d.createLoan.id, equipmentId: eq };
  }

  // Solicitud de servicio nueva del solicitante, pendiente.
  async newService(): Promise<string> {
    const sol = await this.as("solicitante");
    const d = await sol.ok<{ createServiceRequest: { id: string } }>(
      `mutation QaCreateService($input: ServiceRequestInput!) { createServiceRequest(input: $input) { id } }`,
      { input: { type: "other", description: this.tag("Instalar un programa en el laboratorio") } },
    );
    return d.createServiceRequest.id;
  }

  // Texto único por corrida, para que los datos que crea la suite se reconozcan.
  tag(label: string): string {
    this.seq += 1;
    return `[QA ${this.runId}-${this.seq}] ${label}`;
  }

  // Valor memoizado dentro de la corrida (ubicación por defecto, equipo de prueba…).
  async once<T>(key: string, make: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, await make());
    return this.cache.get(key) as T;
  }

  // Equipo nuevo y disponible, creado por el técnico para no depender del seed.
  async newProduct(): Promise<{ id: string; machineId: string }> {
    const tec = await this.as("tecnico");
    const location = await this.once("location", async () => {
      const d = await tec.ok<{ locations: { id: string; code: string; deletedAt: string | null }[] }>(
        `query QaLocations { locations { id code deletedAt } }`,
      );
      const active = d.locations.find((l) => !l.deletedAt);
      if (!active) throw new Error("No hay ubicaciones activas en el entorno");
      return active;
    });
    const { products } = await tec.ok<{ products: { machineId: string }[] }>(
      `query QaMachineIds { products { machineId } }`,
    );
    const machineId = suggestMachineId("Laptop", location.code, products.map((p) => p.machineId));
    if (!machineId) throw new Error("No se pudo calcular un ID de equipo");
    this.seq += 1;
    const serial = `QA${this.runId}${this.seq}`.toUpperCase();
    const d = await tec.ok<{ createProduct: { id: string; machineId: string } }>(
      `mutation QaCreateProduct($input: ProductInput!) { createProduct(input: $input) { id machineId } }`,
      {
        input: {
          machineId,
          kind: "Laptop",
          brand: "QA",
          model: "Suite",
          serialNumber: serial,
          partNumber: serial,
          status: "available",
          locationId: location.id,
        },
      },
    );
    return d.createProduct;
  }
}

export function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionError(message);
}
