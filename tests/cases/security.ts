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
];
