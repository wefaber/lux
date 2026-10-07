import { describe, expect, test } from "bun:test";
import { suggestMachineId, validateCode, validateMachineId, validateName } from "./validation";
import { mockComponents, mockProducts } from "@/mocks/data/equipment";
import { validateComponent, validateProduct } from "./validation";

describe("validateName", () => {
  test.each([
    "HP",
    "MSI",
    "BenQ",
    "TP-Link",
    "Lenovo IdeaCentre AIO 3",
    "TL-WR841N",
    "Épson",
    "Liberty",
  ])("acepta %p", (name) => expect(validateName(name, "Marca")).toBeNull());
  test.each(["JJSJS", "aaaa", "...", "kjhgf", "asdasd", "qwerty", "x"])("rechaza %p", (name) =>
    expect(validateName(name, "Marca")).not.toBeNull(),
  );
});

describe("validateMachineId", () => {
  test("respeta ubicación y tipo", () => {
    expect(validateMachineId("L1-PC3", "AIO", "Laboratorios")).toBeNull();
    expect(validateMachineId("A2-IMP1", "Impresora", "Administración")).toBeNull();
    expect(validateMachineId("L0-PC1", "AIO", "Laboratorios")).toBe("Los números arrancan en 1");
    expect(validateMachineId("L1-PRY1", "AIO", "Laboratorios")).not.toBeNull();
  });

  test("sugiere el próximo número libre", () => {
    expect(suggestMachineId("AIO", "Laboratorios", ["L1-PC1", "L1-PC4", "S1-PC9"])).toBe("L1-PC5");
    expect(suggestMachineId("Proyector", "Salones", [])).toBe("S1-PRY1");
  });
});

describe("validateCode", () => {
  test("exige formato y al menos un número", () => {
    expect(validateCode("AIO-DELL-001", "Serie")).toBeNull();
    expect(validateCode("ABC", "Serie")).not.toBeNull();
    expect(validateCode("12", "Serie")).not.toBeNull();
    expect(validateCode("SN 123", "Serie")).not.toBeNull();
  });
});

test("todos los equipos y componentes de la semilla cumplen la nomenclatura", () => {
  for (const p of mockProducts) expect(validateProduct(p)).toEqual({});
  for (const c of mockComponents) expect(validateComponent(c)).toEqual({});
});
