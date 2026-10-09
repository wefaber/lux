import { describe, expect, test } from "bun:test";
import { decode, encode } from "./persist";
import { mockLoans } from "./data/loans";
import { mockProducts } from "./data/equipment";

function roundTrip<T>(value: T): T {
  return decode(JSON.parse(JSON.stringify(encode(value)))) as T;
}

describe("datos de prueba guardados en el navegador", () => {
  test("un préstamo sigue apuntando al mismo equipo de la lista", () => {
    const { loans, products } = roundTrip({ loans: mockLoans, products: mockProducts });
    const loan = loans[0];
    const product = products.find((p) => p.id === loan.equipment.id)!;
    expect(loan.equipment).toBe(product);
    // Cambiar el equipo desde el prestamo se ve en la lista de equipos
    loan.equipment.status = "in_repair";
    expect(product.status).toBe("in_repair");
  });

  test("conserva valores, nulos y listas vacías", () => {
    const data = { a: 1, b: null, c: "x", d: [], e: { f: [1, { g: true }] } };
    expect(roundTrip(data)).toEqual(data);
  });
});
