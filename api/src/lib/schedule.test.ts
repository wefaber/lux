import { describe, expect, test } from "bun:test";
import {
  localMoment,
  scheduleCovers,
  schedulesOverlap,
  timeToMinutes,
  validateSchedule,
} from "./schedule";

describe("timeToMinutes", () => {
  test("convierte HH:MM y rechaza lo demás", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("08:30")).toBe(510);
    expect(timeToMinutes("23:59")).toBe(1439);
    for (const bad of ["24:00", "8:30", "08:60", "08-30", ""])
      expect(timeToMinutes(bad)).toBeNull();
  });
});

describe("validateSchedule", () => {
  const ok = { weekday: 2, startTime: "08:00", endTime: "09:30" };
  test("acepta un horario válido", () => expect(validateSchedule(ok)).toBeNull());
  test("rechaza día fuera de 1 a 7", () => {
    expect(validateSchedule({ ...ok, weekday: 0 })).toContain("Día");
    expect(validateSchedule({ ...ok, weekday: 8 })).toContain("Día");
    expect(validateSchedule({ ...ok, weekday: 1.5 })).toContain("Día");
  });
  test("rechaza horas mal formadas y franjas vacías o invertidas", () => {
    expect(validateSchedule({ ...ok, startTime: "8:00" })).toContain("inicio");
    expect(validateSchedule({ ...ok, endTime: "25:00" })).toContain("fin");
    expect(validateSchedule({ ...ok, endTime: "08:00" })).toContain("posterior");
    expect(validateSchedule({ ...ok, startTime: "10:00" })).toContain("posterior");
  });
  test("limita el largo de materia y grupo", () => {
    expect(validateSchedule({ ...ok, subject: "x".repeat(81) })).toContain("Materia");
    expect(validateSchedule({ ...ok, studentGroup: "x".repeat(81) })).toContain("Grupo");
  });
});

const slot = (startTime: string, endTime: string, weekday = 1, locationId = "loc-1") => ({
  locationId,
  weekday,
  startTime,
  endTime,
});

describe("schedulesOverlap", () => {
  test("franjas que se pisan chocan", () => {
    expect(schedulesOverlap(slot("08:00", "10:00"), slot("09:00", "11:00"))).toBe(true);
    expect(schedulesOverlap(slot("08:00", "12:00"), slot("09:00", "10:00"))).toBe(true);
  });
  test("el fin es exclusivo: una clase que empieza cuando otra termina no choca", () => {
    expect(schedulesOverlap(slot("08:00", "10:00"), slot("10:00", "12:00"))).toBe(false);
  });
  test("otro día u otro lugar no chocan", () => {
    expect(schedulesOverlap(slot("08:00", "10:00"), slot("08:00", "10:00", 2))).toBe(false);
    expect(schedulesOverlap(slot("08:00", "10:00"), slot("08:00", "10:00", 1, "loc-2"))).toBe(
      false,
    );
  });
});

describe("localMoment", () => {
  test("pasa un instante UTC a día y hora de Montevideo (UTC-3)", () => {
    // Lunes 2026-11-02 11:30 UTC = 08:30 locales
    expect(localMoment("2026-11-02T11:30:00.000Z")).toEqual({ weekday: 1, minutes: 510 });
  });
  test("cruza de día según la zona: domingo 02:00 UTC es sábado 23:00 en Montevideo", () => {
    expect(localMoment("2026-11-08T02:00:00.000Z")).toEqual({ weekday: 6, minutes: 23 * 60 });
  });
  test("acepta otra zona y devuelve null con una fecha inválida", () => {
    expect(localMoment("2026-11-02T11:30:00.000Z", "UTC")).toEqual({ weekday: 1, minutes: 690 });
    expect(localMoment("no es una fecha")).toBeNull();
  });
});

describe("scheduleCovers", () => {
  const schedule = { weekday: 1, startTime: "08:00", endTime: "09:30" };
  test("cubre desde el inicio hasta antes del fin", () => {
    expect(scheduleCovers(schedule, { weekday: 1, minutes: 480 })).toBe(true);
    expect(scheduleCovers(schedule, { weekday: 1, minutes: 569 })).toBe(true);
    expect(scheduleCovers(schedule, { weekday: 1, minutes: 570 })).toBe(false);
    expect(scheduleCovers(schedule, { weekday: 1, minutes: 479 })).toBe(false);
  });
  test("no cubre otro día", () => {
    expect(scheduleCovers(schedule, { weekday: 2, minutes: 500 })).toBe(false);
  });
});
