import { describe, expect, test } from "bun:test";
import {
  USER_IMPORT_COLUMNS,
  parseCsv,
  parseUserImportCsv,
  toCsv,
  userImportTemplate,
  validateImportRow,
} from "./csv";

describe("parseCsv", () => {
  test("separa por punto y coma y respeta comillas y saltos de línea", () => {
    const csv = 'nombre;materias\r\n"García, Ana";"Redes|Base de Datos"\r\n';
    expect(parseCsv(csv)).toEqual([
      ["nombre", "materias"],
      ["García, Ana", "Redes|Base de Datos"],
    ]);
    expect(parseCsv('a;b\n"linea 1\nlinea 2";c')).toEqual([
      ["a", "b"],
      ["linea 1\nlinea 2", "c"],
    ]);
  });

  test("acepta coma o tabulador si el encabezado los usa", () => {
    expect(parseCsv("nombre,email\nAna,ana@x.uy")).toEqual([
      ["nombre", "email"],
      ["Ana", "ana@x.uy"],
    ]);
    expect(parseCsv("nombre\temail\nAna\tana@x.uy")).toEqual([
      ["nombre", "email"],
      ["Ana", "ana@x.uy"],
    ]);
  });

  test("ignora el BOM y las filas vacías", () => {
    expect(parseCsv("\uFEFFnombre;email\r\n\r\nAna;ana@x.uy\r\n")).toEqual([
      ["nombre", "email"],
      ["Ana", "ana@x.uy"],
    ]);
  });

  test("escapa comillas al serializar", () => {
    expect(toCsv([['Nombre; "comillas"', "ok"]])).toBe('"Nombre; ""comillas""";ok');
  });
});

const HEADER = "nombre;documento;email;rol;grupo;turno;materias;activo;contrasena";

describe("parseUserImportCsv", () => {
  test("lee una fila completa y normaliza los datos de estudiante", () => {
    const parsed = parseUserImportCsv(
      `${HEADER}\nAna García;67890123;AGARCIA@iti.edu.uy;;1°B;Matutino;"Matemática|Programación";sí;\n`,
    );
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        name: "Ana García",
        dni: "67890123",
        email: "agarcia@iti.edu.uy",
        role: "solicitante",
        password: null,
        isActive: true,
        studentGroup: "1°B",
        studentShift: "matutino",
        studentSubjects: ["Matemática", "Programación"],
      },
    ]);
  });

  test("acepta encabezados con alias y acentos, en cualquier orden", () => {
    const parsed = parseUserImportCsv(
      "Cédula;Correo;Nombre completo;Turno;Grupo;Materias\r\n12345678;ana@x.uy;Ana Pérez;vespertino;2°A;Redes\r\n",
    );
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows[0]?.dni).toBe("12345678");
    expect(parsed.rows[0]?.role).toBe("solicitante");
    expect(parsed.rows[0]?.studentShift).toBe("vespertino");
  });

  test("reporta las columnas obligatorias que faltan sin intentar leer filas", () => {
    const parsed = parseUserImportCsv("nombre;email\nAna;ana@x.uy");
    expect(parsed.missingColumns).toEqual(["dni"]);
    expect(parsed.rows).toEqual([]);
  });

  test("una fila mala no descarta el resto del archivo", () => {
    const parsed = parseUserImportCsv(
      [
        HEADER,
        "Ana García;67890123;ana@x.uy;;1°B;matutino;Redes;sí;",
        "Sin Documento;123;mal@x.uy;;1°B;matutino;Redes;sí;",
        "Carlos Suárez;78901234;carlos@x.uy;;2°A;nocturno;Redes;no;",
      ].join("\n"),
    );
    expect(parsed.rows.map((r) => r.dni)).toEqual(["67890123", "78901234"]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.line).toBe(3);
    expect(parsed.errors[0]?.message).toContain("Cédula");
    expect(parsed.rows[1]?.isActive).toBe(false);
  });

  test("valida turno, activo, rol y datos de estudiante por fila", () => {
    const parsed = parseUserImportCsv(
      [
        HEADER,
        "Ana;67890123;ana@x.uy;;1°B;mañana;Redes;sí;",
        "Beto;78901234;beto@x.uy;;1°B;matutino;Redes;tal vez;",
        "Carla;89012345;carla@x.uy;root_admin;;;;sí;",
        "Diego;90123456;diego@x.uy;admin;1°B;;;sí;",
      ].join("\n"),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(parsed.errors.map((e) => e.message)).toEqual([
      "Turno inválido",
      "Activo: usá sí o no",
      "Rol inválido",
      "Solo los solicitantes tienen datos de estudiante",
    ]);
  });

  test("marca documentos y emails repetidos dentro del archivo", () => {
    const parsed = parseUserImportCsv(
      [
        HEADER,
        "Ana;67890123;ana@x.uy;;1°B;matutino;Redes;sí;",
        "Otra Ana;67890123;ana2@x.uy;;1°B;matutino;Redes;sí;",
        "Carlos;78901234;ANA@x.uy;;1°B;matutino;Redes;sí;",
      ].join("\n"),
    );
    expect(parsed.rows.map((r) => r.dni)).toEqual(["67890123"]);
    expect(parsed.errors.map((e) => e.message)).toEqual([
      "Documento 67890123 repetido en la fila 2",
      "Email ana@x.uy repetido en la fila 2",
    ]);
  });

  test("la plantilla tiene las columnas documentadas", () => {
    const [header, example] = userImportTemplate();
    expect(header).toEqual([...USER_IMPORT_COLUMNS]);
    expect(header).toContain("materias");
    expect(example).toHaveLength(USER_IMPORT_COLUMNS.length);
  });
});

describe("validateImportRow", () => {
  test("la contraseña es opcional, pero si viene se valida", () => {
    const base = {
      line: 2,
      name: "Ana García",
      dni: "67890123",
      email: "ana@x.uy",
      role: "solicitante",
      studentGroup: null,
      studentShift: null,
      studentSubjects: [],
    };
    expect("row" in validateImportRow({ ...base, password: null })).toBe(true);
    expect(validateImportRow({ ...base, password: "123" })).toEqual({
      error: "La contraseña debe tener al menos 6 caracteres",
    });
  });

  test("no permite crear otro Super Admin ni emails inválidos", () => {
    expect(
      validateImportRow({
        line: 2,
        name: "Ana García",
        dni: "67890123",
        email: "ana@x.uy",
        role: "root_admin",
      }),
    ).toEqual({ error: "Rol inválido" });
    expect(
      validateImportRow({
        line: 2,
        name: "Ana García",
        dni: "67890123",
        email: "sin-arroba",
      }),
    ).toEqual({ error: "Email inválido" });
  });
});
