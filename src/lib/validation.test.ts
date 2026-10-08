import { describe, expect, test } from "bun:test";
import { suggestMachineId, validateCode, validateMachineId, validateName } from "./validation";
import { mockComponents, mockProducts } from "@/mocks/data/equipment";
import { mockLocations } from "@/mocks/data/locations";
import { validateComponent, validateLocation, validateProduct } from "./validation";

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

const LAB = { name: "Laboratorios", code: "L" };
const ADM = { name: "Administración", code: "A" };

describe("validateMachineId", () => {
  test("respeta ubicación y tipo", () => {
    expect(validateMachineId("L1-PC3", "AIO", LAB)).toBeNull();
    expect(validateMachineId("A2-IMP1", "Impresora", ADM)).toBeNull();
    expect(validateMachineId("L0-PC1", "AIO", LAB)).toBe("Los números arrancan en 1");
    expect(validateMachineId("L1-PRY1", "AIO", LAB)).not.toBeNull();
    expect(validateMachineId("S1-PC1", "AIO", LAB)).toBe(
      'Un equipo en Laboratorios empieza con "L". Ej: L1-PC1',
    );
  });

  test("acepta códigos de ubicación de hasta 3 letras", () => {
    const taller = { name: "Taller", code: "TAL" };
    expect(validateMachineId("TAL2-PC1", "Desktop", taller)).toBeNull();
    expect(validateMachineId("TA2-PC1", "Desktop", taller)).not.toBeNull();
  });

  test("sin ubicación válida no hay ID válido", () => {
    expect(validateMachineId("L1-PC1", "AIO", undefined)).toBe("Ubicación inválida");
  });

  test("sugiere el próximo número libre", () => {
    expect(suggestMachineId("AIO", "L", ["L1-PC1", "L1-PC4", "S1-PC9"])).toBe("L1-PC5");
    expect(suggestMachineId("Proyector", "S", [])).toBe("S1-PRY1");
    expect(suggestMachineId("AIO", undefined, [])).toBeNull();
  });
});

describe("validateLocation", () => {
  test("acepta nombre legible y código de 1 a 3 letras", () => {
    expect(validateLocation({ name: "Laboratorio 2", code: "L" })).toEqual({});
    expect(validateLocation({ name: "Taller", code: "tal" })).toEqual({});
  });

  test("rechaza códigos con números o largos y nombres sin sentido", () => {
    expect(validateLocation({ name: "Taller", code: "L2" }).code).toBeDefined();
    expect(validateLocation({ name: "Taller", code: "LABO" }).code).toBeDefined();
    expect(validateLocation({ name: "Taller", code: "" }).code).toBeDefined();
    expect(validateLocation({ name: "asdasd", code: "A" }).name).toBeDefined();
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
  for (const p of mockProducts) {
    const location = mockLocations.find((l) => l.id === p.locationId);
    expect(location?.name).toBe(p.location);
    expect(validateProduct({ ...p, location })).toEqual({});
  }
  for (const l of mockLocations) expect(validateLocation(l)).toEqual({});
  for (const c of mockComponents) expect(validateComponent(c)).toEqual({});
});
