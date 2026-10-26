import { describe, expect, test } from "bun:test";
import { mockUsers } from "./data/users";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { User } from "@/lib/types";

// Misma forma que devuelve la mutación (no se importa el componente de la UI)
interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  rows: Array<{ line: number; status: string; userId: string | null; error: string | null }>;
}

useMockServer();

const { ADMIN, SOLICITANTE } = USERS;

const GET_USERS = `
  query GetUsers($role: String, $studentGroup: String, $studentShift: String, $subject: String) {
    users(role: $role, studentGroup: $studentGroup, studentShift: $studentShift, subject: $subject) {
      id role studentGroup studentShift studentSubjects
    }
  }
`;
const CREATE = `
  mutation CreateUser($input: UserInput!) {
    createUser(input: $input) { id role studentGroup studentShift studentSubjects }
  }
`;
const UPDATE = `
  mutation UpdateUser($id: ID!, $input: UserInput!) {
    updateUser(id: $id, input: $input) { id role studentGroup studentShift studentSubjects }
  }
`;
const IMPORT = `
  mutation ImportUsers($rows: [UserImportRow!]!) {
    importUsers(rows: $rows) {
      created updated failed
      rows { line status userId error }
    }
  }
`;
const LOGIN = `query Login($dni: String!, $password: String!) { login(dni: $dni, password: $password) { id } }`;

const user = (id: string) => mockUsers.find((u) => u.id === id)!;
const errorOf = (res: { errors?: Array<{ message: string }> }) => res.errors?.[0].message;

describe("filtros de la ficha de estudiante", () => {
  test("filtra por grupo, turno y materia con los mismos argumentos que la API", async () => {
    const byGroup = await gqlAs<{ users: User[] }>(ADMIN, GET_USERS, { studentGroup: "1°B" });
    expect(byGroup.errors).toBeUndefined();
    expect(byGroup.data!.users.length).toBeGreaterThan(0);
    expect(byGroup.data!.users.every((u) => u.studentGroup === "1°B")).toBe(true);
    expect(byGroup.data!.users.map((u) => u.id)).toContain("u-sol-1");

    const byShift = await gqlAs<{ users: User[] }>(ADMIN, GET_USERS, { studentShift: "nocturno" });
    expect(byShift.data!.users.map((u) => u.id)).toEqual(["u-sol-5", "u-sol-6", "u-sol-10"]);

    const bySubject = await gqlAs<{ users: User[] }>(ADMIN, GET_USERS, { subject: "redes" });
    expect(bySubject.data!.users.map((u) => u.id)).toEqual(["u-sol-2", "u-sol-4", "u-sol-8", "u-sol-9"]);

    const combined = await gqlAs<{ users: User[] }>(ADMIN, GET_USERS, {
      role: "solicitante",
      studentGroup: "2°A",
      studentShift: "vespertino",
    });
    expect(combined.data!.users.map((u) => u.id)).toEqual(["u-sol-3", "u-sol-4"]);
  });

  test("un solicitante no puede listar usuarios", async () => {
    expect(errorOf(await gqlAs(SOLICITANTE, GET_USERS, {}))).toBe(FORBIDDEN);
  });
});

describe("alta y edición de la ficha", () => {
  test("crea un estudiante con grupo, turno y materias", async () => {
    const res = await gqlAs<{ createUser: User }>(ADMIN, CREATE, {
      input: {
        name: "Lucía Fagúndez",
        dni: "30000001",
        email: "lfagundez@iti.edu.uy",
        role: "solicitante",
        password: "secreto1",
        studentGroup: "1°C",
        studentShift: "matutino",
        studentSubjects: ["Matemática", "Redes"],
      },
    });
    expect(res.errors).toBeUndefined();
    expect(res.data!.createUser).toMatchObject({
      role: "solicitante",
      studentGroup: "1°C",
      studentShift: "matutino",
      studentSubjects: ["Matemática", "Redes"],
    });
    expect(user(res.data!.createUser.id).studentGroup).toBe("1°C");
  });

  test("rechaza un turno inventado y no guarda datos de estudiante en otros roles", async () => {
    const bad = await gqlAs(ADMIN, CREATE, {
      input: {
        name: "Pedro Malo",
        dni: "30000002",
        email: "pmalo@iti.edu.uy",
        role: "solicitante",
        password: "secreto1",
        studentShift: "mañana",
      },
    });
    expect(errorOf(bad)).toBe("Turno inválido");

    const staff = await gqlAs<{ createUser: User }>(ADMIN, CREATE, {
      input: {
        name: "Técnica Nueva",
        dni: "30000003",
        email: "tnueva@iti.edu.uy",
        role: "tecnico",
        password: "secreto1",
        studentGroup: "1°C",
        studentShift: "matutino",
        studentSubjects: ["Redes"],
      },
    });
    expect(staff.errors).toBeUndefined();
    expect(staff.data!.createUser).toMatchObject({
      role: "tecnico",
      studentGroup: null,
      studentShift: null,
      studentSubjects: [],
    });
  });

  test("edita la ficha y al cambiar de rol la vacía", async () => {
    const created = await gqlAs<{ createUser: User }>(ADMIN, CREATE, {
      input: {
        name: "Sofía Editable",
        dni: "30000004",
        email: "seditable@iti.edu.uy",
        role: "solicitante",
        password: "secreto1",
        studentGroup: "1°A",
        studentShift: "matutino",
        studentSubjects: ["Matemática"],
      },
    });
    const target = created.data!.createUser;

    // Sin campos de estudiante en el input se conserva la ficha
    const renamed = await gqlAs<{ updateUser: User }>(ADMIN, UPDATE, {
      id: target.id,
      input: { name: "Sofía Editada", dni: "30000004", email: "seditable@iti.edu.uy", role: "solicitante" },
    });
    expect(renamed.data!.updateUser.studentGroup).toBe("1°A");

    const changed = await gqlAs<{ updateUser: User }>(ADMIN, UPDATE, {
      id: target.id,
      input: {
        name: "Sofía Editada",
        dni: "30000004",
        email: "seditable@iti.edu.uy",
        role: "solicitante",
        studentGroup: "2°B",
        studentShift: "nocturno",
        studentSubjects: ["Redes", "Base de Datos"],
      },
    });
    expect(changed.data!.updateUser).toMatchObject({
      studentGroup: "2°B",
      studentShift: "nocturno",
      studentSubjects: ["Redes", "Base de Datos"],
    });

    // Pasar a técnico borra la ficha (la base también lo exige)
    const promoted = await gqlAs<{ updateUser: User }>(ADMIN, UPDATE, {
      id: target.id,
      input: { name: "Sofía Editada", dni: "30000004", email: "seditable@iti.edu.uy", role: "tecnico" },
    });
    expect(promoted.data!.updateUser).toMatchObject({
      role: "tecnico",
      studentGroup: null,
      studentShift: null,
      studentSubjects: [],
    });
  });

  test("un solicitante no puede crear ni editar usuarios", async () => {
    const create = await gqlAs(SOLICITANTE, CREATE, {
      input: {
        name: "Intruso",
        dni: "30000009",
        email: "intruso@iti.edu.uy",
        role: "solicitante",
        password: "secreto1",
      },
    });
    expect(errorOf(create)).toBe(FORBIDDEN);
    const update = await gqlAs(SOLICITANTE, UPDATE, {
      id: SOLICITANTE,
      input: { name: "Ana", dni: "67890123", email: "agarcia@iti.edu.uy", role: "solicitante", studentGroup: "9°Z" },
    });
    expect(errorOf(update)).toBe(FORBIDDEN);
    expect(user(SOLICITANTE).studentGroup).toBe("1°B");
  });
});

describe("importación CSV", () => {
  test("crea las filas válidas, reporta las malas y no duplica dentro del archivo", async () => {
    const res = await gqlAs<{ importUsers: ImportResult }>(ADMIN, IMPORT, {
      rows: [
        {
          line: 2,
          name: "Bruno Importado",
          dni: "40000001",
          email: "bimportado@iti.edu.uy",
          role: "solicitante",
          studentGroup: "1°D",
          studentShift: "vespertino",
          studentSubjects: ["Redes"],
        },
        {
          line: 3,
          name: "Fila Mala",
          dni: "123",
          email: "mala@iti.edu.uy",
          role: "solicitante",
        },
        {
          line: 4,
          name: "Carla Importada",
          dni: "40000002",
          email: "cimportada@iti.edu.uy",
          role: "solicitante",
          studentGroup: "3°B",
          studentShift: "nocturno",
          studentSubjects: ["Base de Datos", "Programación"],
        },
        {
          line: 5,
          name: "Bruno Repetido",
          dni: "40000001",
          email: "otro@iti.edu.uy",
          role: "solicitante",
        },
      ],
    });
    expect(res.errors).toBeUndefined();
    const result = res.data!.importUsers;
    expect([result.created, result.updated, result.failed]).toEqual([2, 0, 2]);
    expect(result.rows.map((r) => r.status)).toEqual(["created", "error", "created", "error"]);
    expect(result.rows[3]?.error).toBe("Documento 40000001 repetido en la fila 2");
    expect(mockUsers.filter((u) => u.dni === "40000001")).toHaveLength(1);
    expect(user(result.rows[0]!.userId!).studentSubjects).toEqual(["Redes"]);
    // Sin contraseña en el archivo, la clave inicial es el documento
    expect(
      (await gqlAs(null, LOGIN, { dni: "40000001", password: "40000001" })).data,
    ).toBeDefined();
  });

  test("actualiza la ficha de un estudiante existente sin duplicarlo", async () => {
    const before = mockUsers.length;
    const target = user("u-sol-9");
    const res = await gqlAs<{ importUsers: ImportResult }>(ADMIN, IMPORT, {
      rows: [
        {
          line: 2,
          name: "Florencia López",
          dni: target.dni,
          email: target.email,
          role: "solicitante",
          studentGroup: "4°Z",
          studentShift: "nocturno",
          studentSubjects: ["Redes"],
        },
      ],
    });
    expect(res.data!.importUsers.updated).toBe(1);
    expect(mockUsers).toHaveLength(before);
    expect(target.studentGroup).toBe("4°Z");
    expect(target.studentShift).toBe("nocturno");
    expect(target.studentSubjects).toEqual(["Redes"]);
  });

  test("no convierte a un admin en estudiante ni le pisa el rol", async () => {
    const res = await gqlAs<{ importUsers: ImportResult }>(ADMIN, IMPORT, {
      rows: [
        {
          line: 2,
          name: "Marcela Rodríguez",
          dni: "12345678",
          email: "mrodriguez@iti.edu.uy",
          role: "solicitante",
          studentGroup: "1°A",
        },
      ],
    });
    expect(res.data!.importUsers.failed).toBe(1);
    expect(res.data!.importUsers.rows[0]?.error).toBe("La persona ya existe con rol admin");
    expect(user("u-admin-1").role).toBe("admin");
    expect(user("u-admin-1").studentGroup).toBeNull();
  });

  test("solo un administrador puede importar", async () => {
    expect(
      errorOf(await gqlAs(SOLICITANTE, IMPORT, { rows: [] })),
    ).toBe(FORBIDDEN);
  });
});
