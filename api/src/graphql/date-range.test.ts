import { describe, expect, test } from "bun:test";
import { exclusiveEnd, overlapsRange, withinInstantRange } from "./date-range";

const START = "2026-10-21T03:00:00.000Z"; // medianoche en UTC-3
const END = "2026-10-22T02:59:59.999Z"; // ultimo ms del dia en UTC-3

describe("rango inclusivo de instantes", () => {
  test("incluye los dos extremos", () => {
    expect(withinInstantRange(START, START, END)).toBe(true);
    expect(withinInstantRange(END, START, END)).toBe(true);
    expect(withinInstantRange("2026-10-21T12:00:00Z", START, END)).toBe(true);
  });

  test("deja afuera lo anterior y lo posterior", () => {
    expect(withinInstantRange("2026-10-21T02:59:59.999Z", START, END)).toBe(false);
    expect(withinInstantRange("2026-10-22T03:00:00.000Z", START, END)).toBe(false);
  });

  test("los extremos son opcionales y los invalidos se ignoran", () => {
    expect(withinInstantRange("2026-10-21T12:00:00Z")).toBe(true);
    expect(withinInstantRange("2026-10-21T12:00:00Z", undefined, END)).toBe(true);
    expect(withinInstantRange("2026-10-21T12:00:00Z", START)).toBe(true);
    expect(withinInstantRange("2026-10-21T12:00:00Z", "ayer", "mañana")).toBe(true);
    expect(withinInstantRange("no-es-fecha", START, END)).toBe(false);
  });
});

describe("reservas que se solapan", () => {
  test("alcanza con tocar el borde del rango", () => {
    expect(overlapsRange("2026-10-20T22:00:00Z", "2026-10-21T03:00:00Z", START, END)).toBe(true);
    expect(overlapsRange(END, "2026-10-22T05:00:00Z", START, END)).toBe(true);
  });

  test("las de otros dias quedan afuera", () => {
    expect(overlapsRange("2026-10-19T22:00:00Z", "2026-10-20T02:00:00Z", START, END)).toBe(false);
    expect(overlapsRange("2026-10-22T03:00:00Z", "2026-10-22T05:00:00Z", START, END)).toBe(false);
  });

  test("sin rango valido se incluye todo", () => {
    expect(overlapsRange("2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z")).toBe(true);
    expect(overlapsRange("no-es-fecha", "2020-01-02T00:00:00Z", START, END)).toBe(false);
  });
});

describe("fin exclusivo para la base", () => {
  test("suma un milisegundo para que el ultimo instante entre con <", () => {
    const next = exclusiveEnd(END)!;
    expect(Date.parse(next)).toBe(Date.parse(END) + 1);
    expect(Date.parse(END) < Date.parse(next)).toBe(true);
  });

  test("un texto invalido no genera fin", () => {
    expect(exclusiveEnd("no-es-fecha")).toBeNull();
  });
});
