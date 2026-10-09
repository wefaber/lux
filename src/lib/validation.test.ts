import { describe, expect, test } from "bun:test";
import { suggestMachineId, validateCode, validateMachineId, validateName } from "./validation";
import { mockComponents, mockProducts } from "@/mocks/data/equipment";
import { mockLocations } from "@/mocks/data/locations";
import { locationCode, validateComponent, validateLocation, validateProduct } from "./validation";

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

const LAB1 = { name: "Laboratorio 1", code: "L1" };
const ADM1 = { name: "Administración 1", code: "A1" };

describe("validateMachineId", () => {
  test("respeta ubicación y tipo: L1-PC3 es la PC 3 del Laboratorio 1", () => {
    expect(validateMachineId("L1-PC3", "AIO", LAB1)).toBeNull();
    expect(validateMachineId("A1-IMP1", "Impresora", ADM1)).toBeNull();
    expect(validateMachineId("L1-PC0", "AIO", LAB1)).toBe("Los números arrancan en 1");
    expect(validateMachineId("L1-PRY1", "AIO", LAB1)).not.toBeNull();
    expect(validateMachineId("S1-PC1", "AIO", LAB1)).toBe(
      'Un equipo en Laboratorio 1 empieza con "L1-". Ej: L1-PC1',
    );
  });

  test("el número del laboratorio es parte del código: L2 no es el Laboratorio 1", () => {
    expect(validateMachineId("L2-PC1", "AIO", LAB1)).not.toBeNull();
    const lab12 = { name: "Laboratorio 12", code: "L12" };
    expect(validateMachineId("L12-PC1", "Desktop", lab12)).toBeNull();
  });

  test("sin ubicación válida no hay ID válido", () => {
    expect(validateMachineId("L1-PC1", "AIO", undefined)).toBe("Ubicación inválida");
  });

  test("sugiere el próximo número libre de esa ubicación", () => {
    expect(suggestMachineId("AIO", "L1", ["L1-PC1", "L1-PC4", "L2-PC7", "S1-PC9"])).toBe("L1-PC5");
    expect(suggestMachineId("AIO", "L2", ["L1-PC1", "L1-PC4", "L2-PC7"])).toBe("L2-PC8");
    expect(suggestMachineId("Proyector", "S1", [])).toBe("S1-PRY1");
    expect(suggestMachineId("AIO", undefined, [])).toBeNull();
  });
});

describe("locationCode", () => {
  test("es la letra del tipo más el número", () => {
    expect(locationCode("laboratory", 2)).toBe("L2");
    expect(locationCode("classroom", 10)).toBe("S10");
    expect(locationCode("administration", 1)).toBe("A1");
    expect(locationCode("laboratory", 0)).toBeNull();
    expect(locationCode("laboratory", 100)).toBeNull();
    expect(locationCode("pasillo", 1)).toBeNull();
  });
});

describe("validateLocation", () => {
  test("acepta tipo, número y nombre legible", () => {
    expect(validateLocation({ kind: "laboratory", number: 2, name: "Laboratorio 2" })).toEqual({});
    expect(
      validateLocation({ kind: "laboratory", number: 3, name: "Laboratorio 3 (Electrónica)" }),
    ).toEqual({});
  });

  test("rechaza tipo desconocido, número fuera de rango y nombres sin sentido", () => {
    expect(validateLocation({ kind: "pasillo", number: 1, name: "Pasillo" }).kind).toBeDefined();
    expect(validateLocation({ kind: "laboratory", number: 0, name: "Lab" }).number).toBeDefined();
    expect(validateLocation({ kind: "laboratory", number: 1.5, name: "Lab" }).number).toBeDefined();
    expect(validateLocation({ kind: "laboratory", number: 1, name: "asdasd" }).name).toBeDefined();
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
  for (const l of mockLocations) {
    expect(validateLocation(l)).toEqual({});
    expect(l.code).toBe(locationCode(l.kind, l.number)!);
  }
  for (const c of mockComponents) expect(validateComponent(c)).toEqual({});
});
