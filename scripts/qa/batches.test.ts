import { describe, expect, test } from "bun:test";
import { BATCH_SIZE, batchStats, compact, inArrivalOrder, summarize } from "./batches";

const ramp = (n: number) => Float64Array.from({ length: n }, (_, i) => i + 1);

describe("batchStats", () => {
  test("sin solicitudes no hay bloques", () => {
    expect(batchStats(new Float64Array(0))).toEqual([]);
  });

  test("el tamaño por defecto es 1.000", () => {
    expect(BATCH_SIZE).toBe(1_000);
  });

  test("menos de 1.000 solicitudes: un solo bloque parcial", () => {
    const [b, ...rest] = batchStats(ramp(999));
    expect(rest).toEqual([]);
    expect(b).toMatchObject({ index: 1, count: 999, partial: true, min: 1, max: 999 });
  });

  test("justo 1.000: un bloque completo", () => {
    const stats = batchStats(ramp(1_000));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      count: 1_000,
      partial: false,
      min: 1,
      max: 1_000,
      avg: 500.5,
    });
    expect(stats[0]?.avgVsTotalPct).toBeCloseTo(100, 10);
  });

  test("1.001: el último bloque tiene una sola solicitud y es parcial", () => {
    const stats = batchStats(ramp(1_001));
    expect(stats).toHaveLength(2);
    expect(stats[1]).toMatchObject({
      index: 2,
      count: 1,
      partial: true,
      min: 1_001,
      avg: 1_001,
      max: 1_001,
    });
  });

  test("cada bloque tiene su propio mínimo, promedio y máximo", () => {
    const stats = batchStats(ramp(3_000));
    expect(stats.map((s) => [s.min, s.max, s.avg])).toEqual([
      [1, 1_000, 500.5],
      [1_001, 2_000, 1_500.5],
      [2_001, 3_000, 2_500.5],
    ]);
  });

  test("el porcentaje compara el promedio del bloque con el total (100 = igual)", () => {
    // 1.000 solicitudes de 10 ms y 1.000 de 30 ms: total 20 ms
    const values = Float64Array.from({ length: 2_000 }, (_, i) => (i < 1_000 ? 10 : 30));
    const [a, b] = batchStats(values);
    expect(a?.avgVsTotalPct).toBeCloseTo(50, 10);
    expect(b?.avgVsTotalPct).toBeCloseTo(150, 10);
  });

  test("todas iguales: todos los bloques en 100 %", () => {
    const stats = batchStats(new Float64Array(5_000).fill(7));
    expect(stats.every((s) => s.avgVsTotalPct === 100 && s.min === 7 && s.max === 7)).toBe(true);
  });

  test("promedio total 0: el porcentaje es null, no NaN", () => {
    const [b] = batchStats(new Float64Array(10));
    expect(b?.avgVsTotalPct).toBeNull();
  });

  test("tamaño personalizado", () => {
    expect(batchStats(ramp(10), 3).map((s) => s.count)).toEqual([3, 3, 3, 1]);
  });

  test.each([0, -1, 1.5, Number.NaN])("tamaño inválido %p lanza", (size) => {
    expect(() => batchStats(ramp(10), size)).toThrow();
  });
});

describe("inArrivalOrder", () => {
  test("ordena las latencias por el instante en que terminó cada solicitud", () => {
    const out = inArrivalOrder([30, 10, 20], [3, 1, 2]);
    expect([...out]).toEqual([1, 2, 3]);
  });

  test("con el mismo instante conserva el orden de entrada", () => {
    const out = inArrivalOrder([5, 5, 5], [9, 8, 7]);
    expect([...out]).toEqual([9, 8, 7]);
  });

  test("vacío", () => {
    expect(inArrivalOrder([], []).length).toBe(0);
  });

  test("largos distintos lanzan", () => {
    expect(() => inArrivalOrder([1, 2], [1])).toThrow();
  });
});

describe("summarize", () => {
  test("vacío devuelve null", () => {
    expect(summarize([])).toBeNull();
  });

  test("una muestra", () => {
    expect(summarize([4])).toEqual({ count: 1, min: 4, avg: 4, max: 4 });
  });
});

describe("compact", () => {
  const stats = batchStats(ramp(100_000), 1_000); // 100 bloques

  test("hasta el límite no omite nada", () => {
    expect(compact(stats.slice(0, 20), 20)).toEqual({ shown: stats.slice(0, 20), omitted: 0 });
  });

  test("con más bloques deja los primeros, los últimos y el peor, en orden", () => {
    const { shown, omitted } = compact(stats, 20);
    expect(shown.length + omitted).toBe(100);
    expect(shown[0]?.index).toBe(1);
    expect(shown.at(-1)?.index).toBe(100);
    const indexes = shown.map((s) => s.index);
    expect(indexes).toEqual(indexes.toSorted((a, b) => a - b));
  });

  test("incluye el bloque más lento aunque esté en el medio", () => {
    const values = new Float64Array(50_000).fill(1);
    values.fill(500, 25_000, 26_000); // bloque 26
    const { shown } = compact(batchStats(values), 10);
    expect(shown.some((s) => s.index === 26)).toBe(true);
  });
});
