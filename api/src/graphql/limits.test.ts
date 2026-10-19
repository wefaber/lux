import { describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { checkLimits } from "./limits";

const limits = { maxDepth: 4, maxRootFields: 5, maxRepeatedRootField: 2 };
const check = (query: string) => checkLimits(parse(query), limits);

describe("limites de la operacion GraphQL", () => {
  test("una operacion normal pasa", () => {
    expect(check("{ tickets { id assignedTo { id name } } me { id } }")).toBeNull();
  });

  test("15 login por alias en un request se rechaza", () => {
    const fields = Array.from({ length: 15 }, (_, i) => `a${i}: login(dni: "1", password: "x") { token }`).join(" ");
    expect(check(`{ ${fields} }`)).toContain("demasiados campos");
  });

  test("login no puede repetirse ni dos veces", () => {
    const message = check(`{ a: login(dni: "1", password: "x") { token } b: login(dni: "1", password: "y") { token } }`);
    expect(message).toContain('"login"');
    expect(message).toContain("máximo 1");
  });

  test("un campo comun se puede repetir hasta el tope", () => {
    expect(check("{ a: me { id } b: me { id } }")).toBeNull();
    expect(check("{ a: me { id } b: me { id } c: me { id } }")).toContain("máximo 2");
  });

  test("el arbol demasiado profundo se rechaza", () => {
    expect(check("{ a { b { c { d { e } } } } }")).toContain("demasiado profunda");
    expect(check("{ a { b { c { d } } } }")).toBeNull();
  });

  test("los fragmentos cuentan para la profundidad y los alias", () => {
    const deep = "fragment F on T { b { c { d { e } } } } { a { ...F } }";
    expect(check(deep)).toContain("demasiado profunda");
    const wide = "fragment F on Query { a b c d e f } { ...F }";
    expect(check(wide)).toContain("demasiados campos");
  });

  test("un ciclo de fragmentos no cuelga el chequeo", () => {
    expect(() => check("fragment A on T { ...B } fragment B on T { ...A } { x { ...A } }")).not.toThrow();
  });

  test("la introspeccion no cuenta como campo", () => {
    expect(check("{ __schema { queryType { name } } me { id } }")).toBeNull();
  });
});
