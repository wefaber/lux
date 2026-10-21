import { describe, expect, test } from "bun:test";
import {
  EMPTY_DATE_RANGE,
  dateRangeBounds,
  dateRangeError,
  endOfDayIso,
  inDateRange,
  isDateInput,
  isDateRangeActive,
  overlapsDateRange,
  startOfDayIso,
  withinInstantRange,
  type DateRange,
} from "./date-range";

// Instante ISO a partir de una fecha/hora local, que es como la ve el usuario
function localIso(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
): string {
  return new Date(year, month - 1, day, hours, minutes, seconds, ms).toISOString();
}

const range = (from: string, to: string): DateRange => ({ from, to });

describe("input de fecha", () => {
  test("acepta fechas reales y rechaza las que no existen", () => {
    expect(isDateInput("2026-10-21")).toBe(true);
    expect(isDateInput("2024-02-29")).toBe(true);
    expect(isDateInput("2026-02-29")).toBe(false);
    expect(isDateInput("2026-13-01")).toBe(false);
    expect(isDateInput("2026-04-31")).toBe(false);
    expect(isDateInput("")).toBe(false);
    expect(isDateInput("21/10/2026")).toBe(false);
    expect(isDateInput("2026-1-1")).toBe(false);
  });

  test("un rango vacio no esta activo y no filtra", () => {
    expect(isDateRangeActive(EMPTY_DATE_RANGE)).toBe(false);
    expect(dateRangeBounds(EMPTY_DATE_RANGE)).toBeNull();
    expect(inDateRange(localIso(2026, 10, 21, 12), EMPTY_DATE_RANGE)).toBe(true);
  });

  test("desde mayor que hasta queda en error y no filtra", () => {
    const inverted = range("2026-10-21", "2026-10-20");
    expect(dateRangeError(inverted)).toBe("order");
    expect(dateRangeBounds(inverted)).toBeNull();
    expect(inDateRange(localIso(2026, 10, 21, 12), inverted)).toBe(true);
  });

  test("desde igual a hasta no es un error", () => {
    expect(dateRangeError(range("2026-10-21", "2026-10-21"))).toBeNull();
  });
});

describe("limites del dia local", () => {
  const day = range("2026-10-21", "2026-10-21");

  test("incluye desde la medianoche hasta el ultimo milisegundo", () => {
    expect(inDateRange(localIso(2026, 10, 21, 0, 0, 0, 0), day)).toBe(true);
    expect(inDateRange(localIso(2026, 10, 21, 12, 0), day)).toBe(true);
    expect(inDateRange(localIso(2026, 10, 21, 23, 59, 59, 999), day)).toBe(true);
  });

  test("deja afuera el dia anterior y el siguiente", () => {
    expect(inDateRange(localIso(2026, 10, 20, 23, 59, 59, 999), day)).toBe(false);
    expect(inDateRange(localIso(2026, 10, 22, 0, 0, 0, 0), day)).toBe(false);
  });

  test("los instantes de la API son la medianoche y el fin del dia local", () => {
    expect(dateRangeBounds(day)).toEqual({
      startDate: localIso(2026, 10, 21, 0, 0, 0, 0),
      endDate: localIso(2026, 10, 21, 23, 59, 59, 999),
    });
    expect(startOfDayIso("2026-10-21")).toBe(localIso(2026, 10, 21));
    expect(endOfDayIso("2026-10-21")).toBe(localIso(2026, 10, 21, 23, 59, 59, 999));
  });

  test("un solo extremo deja el otro lado abierto", () => {
    expect(inDateRange(localIso(2026, 1, 1), range("2026-10-21", ""))).toBe(false);
    expect(inDateRange(localIso(2027, 1, 1), range("2026-10-21", ""))).toBe(true);
    expect(inDateRange(localIso(2026, 10, 21, 23, 59), range("", "2026-10-21"))).toBe(true);
    expect(inDateRange(localIso(2026, 10, 22), range("", "2026-10-21"))).toBe(false);
  });
});

describe("reservas que se solapan", () => {
  const day = range("2026-10-21", "2026-10-21");

  test("una reserva que empieza antes y termina dentro aparece", () => {
    expect(
      overlapsDateRange(localIso(2026, 10, 20, 22), localIso(2026, 10, 21, 2), day),
    ).toBe(true);
  });

  test("una reserva que empieza dentro y termina despues aparece", () => {
    expect(
      overlapsDateRange(localIso(2026, 10, 21, 22), localIso(2026, 10, 22, 2), day),
    ).toBe(true);
  });

  test("tocar el borde del rango alcanza", () => {
    expect(
      overlapsDateRange(localIso(2026, 10, 21, 0), localIso(2026, 10, 21, 1), day),
    ).toBe(true);
    expect(
      overlapsDateRange(localIso(2026, 10, 20, 0), localIso(2026, 10, 21, 0), day),
    ).toBe(true);
  });

  test("las reservas de otros dias quedan afuera", () => {
    expect(
      overlapsDateRange(localIso(2026, 10, 19, 22), localIso(2026, 10, 20, 2), day),
    ).toBe(false);
    expect(
      overlapsDateRange(localIso(2026, 10, 22, 0), localIso(2026, 10, 22, 2), day),
    ).toBe(false);
  });
});

describe("comparacion de instantes de la API", () => {
  test("los extremos son inclusivos", () => {
    const start = localIso(2026, 10, 21);
    const end = localIso(2026, 10, 21, 23, 59, 59, 999);
    expect(withinInstantRange(start, start, end)).toBe(true);
    expect(withinInstantRange(end, start, end)).toBe(true);
    expect(withinInstantRange(localIso(2026, 10, 20, 23, 59, 59, 999), start, end)).toBe(false);
    expect(withinInstantRange(localIso(2026, 10, 22), start, end)).toBe(false);
  });

  test("un extremo invalido se ignora", () => {
    expect(withinInstantRange("2026-10-21T12:00:00Z", "no-es-fecha", undefined)).toBe(true);
    expect(withinInstantRange("2026-10-21T12:00:00Z", undefined, "no-es-fecha")).toBe(true);
    expect(withinInstantRange("no-es-fecha")).toBe(false);
  });
});
