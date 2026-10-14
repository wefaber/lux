import { describe, expect, test } from "bun:test";
import { mockPasswords, mockUsers } from "./data/users";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";

useMockServer();

const { ROOT, ADMIN, TECNICO } = USERS;

const UPDATE = `mutation UpdateUser($id: ID!, $input: UserInput!) { updateUser(id: $id, input: $input) { id dni role isActive } }`;
const CREATE = `mutation CreateUser($input: UserInput!) { createUser(input: $input) { id role } }`;
const CHANGE_PW = `mutation ChangePassword($currentPassword: String!, $newPassword: String!) { changePassword(currentPassword: $currentPassword, newPassword: $newPassword) }`;
const LOGIN = `query Login($dni: String!, $password: String!) { login(dni: $dni, password: $password) { id } }`;

const user = (id: string) => mockUsers.find((u) => u.id === id)!;
const errorOf = (res: { errors?: Array<{ message: string }> }) => res.errors?.[0].message;

// Igual que la pantalla de usuarios: updateUser con los datos actuales y el estado nuevo
function setActive(caller: string, id: string, isActive: boolean) {
  const { name, dni, email, role } = user(id);
  return gqlAs<{ updateUser: { isActive: boolean } }>(caller, UPDATE, {
    id,
    input: { name, dni, email, role, isActive },
  });
}

describe("activar y desactivar usuarios", () => {
  test("un usuario desactivado se puede volver a activar y vuelve a entrar", async () => {
    const target = user("u-sol-3");
    expect(errorOf(await setActive(ADMIN, target.id, false))).toBe(undefined);
    expect(target.isActive).toBe(false);
    const password = mockPasswords[target.dni];
    expect(errorOf(await gqlAs(null, LOGIN, { dni: target.dni, password }))).toBe(
      "Credenciales inválidas",
    );

    const res = await setActive(ADMIN, target.id, true);
    expect(res.data!.updateUser.isActive).toBe(true);
    expect(errorOf(await gqlAs(null, LOGIN, { dni: target.dni, password }))).toBeUndefined();
  });

  test("el root_admin y la propia cuenta no se desactivan", async () => {
    // Un admin ni siquiera edita al root; el root tampoco se desactiva a si mismo
    expect(errorOf(await setActive(ADMIN, ROOT, false))).toBe(FORBIDDEN);
    expect(errorOf(await setActive(ROOT, ROOT, false))).toBe(
      "El Super Admin no se puede desactivar",
    );
    expect(errorOf(await setActive(ADMIN, ADMIN, false))).toBe(
      "No podés desactivar tu propia cuenta",
    );
    expect(user(ROOT).isActive && user(ADMIN).isActive).toBe(true);
  });

  test("solo un admin cambia el estado", async () => {
    expect(errorOf(await setActive(TECNICO, "u-sol-4", false))).toBe(FORBIDDEN);
  });
});

describe("edición de usuarios", () => {
  test("no se puede escalar a root_admin ni tocar campos internos", async () => {
    const target = user("u-sol-5");
    const res = await gqlAs(ADMIN, UPDATE, {
      id: target.id,
      input: { ...target, role: "root_admin", id: "u-hack", createdAt: "1999-01-01" },
    });
    expect(errorOf(res)).toBe("No se puede asignar el rol Super Admin");
    expect(target.role).toBe("solicitante");
    expect(target.id).toBe("u-sol-5");
  });

  test("un admin no edita al root_admin", async () => {
    const root = user(ROOT);
    expect(errorOf(await gqlAs(ADMIN, UPDATE, { id: ROOT, input: { ...root, name: "X Y" } }))).toBe(
      FORBIDDEN,
    );
  });

  test("al cambiar la cédula la contraseña la acompaña", async () => {
    const target = user("u-sol-6");
    const password = mockPasswords[target.dni];
    const res = await gqlAs(ADMIN, UPDATE, {
      id: target.id,
      input: { name: target.name, dni: "99887766", email: target.email, role: target.role },
    });
    expect(errorOf(res)).toBeUndefined();
    expect(errorOf(await gqlAs(null, LOGIN, { dni: "99887766", password }))).toBeUndefined();
  });

  test("cédula y email no se repiten", async () => {
    const [a, b] = [user("u-sol-8"), user("u-sol-9")];
    const dup = await gqlAs(ADMIN, UPDATE, {
      id: a.id,
      input: { name: a.name, dni: b.dni, email: a.email, role: a.role },
    });
    expect(errorOf(dup)).toBe(`Ya existe un usuario con cédula ${b.dni}`);
    const create = await gqlAs(ADMIN, CREATE, {
      input: {
        name: "Lucía Pérez",
        dni: "12121212",
        email: b.email,
        role: "tecnico",
        password: "secreto1",
      },
    });
    expect(errorOf(create)).toBe(`Ya existe un usuario con email ${b.email}`);
  });

  test("se valida el alta y no se crea otro root_admin", async () => {
    const bad = await gqlAs(ADMIN, CREATE, {
      input: {
        name: "Lucía Pérez",
        dni: "123",
        email: "lp@iti.edu.uy",
        role: "tecnico",
        password: "secreto1",
      },
    });
    expect(errorOf(bad)).toBe("Cédula: 8 dígitos, sin puntos ni guión");
    const root = await gqlAs(ADMIN, CREATE, {
      input: {
        name: "Lucía Pérez",
        dni: "13131313",
        email: "lp@iti.edu.uy",
        role: "root_admin",
        password: "secreto1",
      },
    });
    expect(errorOf(root)).toBe("No se puede crear otro Super Admin");
  });
});

describe("cambio de contraseña", () => {
  test("exige la actual y la cambia de verdad", async () => {
    const me = user(TECNICO);
    const current = mockPasswords[me.dni];
    expect(
      errorOf(
        await gqlAs(TECNICO, CHANGE_PW, { currentPassword: "mala", newPassword: "nueva123" }),
      ),
    ).toBe("La contraseña actual no es correcta");
    expect(
      errorOf(await gqlAs(TECNICO, CHANGE_PW, { currentPassword: current, newPassword: "123" })),
    ).toBe("La contraseña debe tener al menos 6 caracteres");
    expect(
      errorOf(
        await gqlAs(TECNICO, CHANGE_PW, { currentPassword: current, newPassword: "nueva123" }),
      ),
    ).toBeUndefined();
    expect(mockPasswords[me.dni]).toBe("nueva123");
  });
});
