import { describe, expect, test } from "bun:test";
import { MIN_TAIL_SAMPLES, percentile, samplesNeeded, tailLatencies } from "./percentiles";

// 1..n ms: el percentil p de n muestras es exactamente ceil(p/100 * n)
const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i + 1);

describe("percentile", () => {
  test("sin muestras devuelve null", () => {
    expect(percentile(new Float32Array(0), 99)).toBeNull();
  });

  test("una sola muestra es todos los percentiles", () => {
    const one = Float32Array.of(7);
    for (const p of [0.01, 50, 99, 99.9, 99.99, 100]) expect(percentile(one, p)).toBe(7);
  });

  test("p fuera de (0, 100] o no finito devuelve null", () => {
    const xs = ramp(100);
    for (const p of [0, -1, 100.0001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(percentile(xs, p)).toBeNull();
    }
  });

  test("p100 es el máximo y un p mínimo es la primera muestra", () => {
    const xs = ramp(1000);
    expect(percentile(xs, 100)).toBe(1000);
    expect(percentile(xs, 0.0001)).toBe(1);
  });

  test("p50 de 100 muestras es la 50ª, no la 51ª", () => {
    expect(percentile(ramp(100), 50)).toBe(50);
  });

  test("p99.99 de 10 000 muestras es la 9 999ª, no el máximo (error de coma flotante)", () => {
    expect(percentile(ramp(10_000), 99.99)).toBe(9_999);
  });

  test("p99.9 de 1 000 muestras es la 999ª, no el máximo", () => {
    expect(percentile(ramp(1_000), 99.9)).toBe(999);
  });

  test("p99 de 100 muestras es la 99ª", () => {
    expect(percentile(ramp(100), 99)).toBe(99);
  });

  test("todas las muestras iguales dan ese valor en toda la cola", () => {
    const xs = new Float32Array(100_000).fill(3);
    for (const t of tailLatencies(xs)) expect(t.ms).toBe(3);
  });

  test("un solo valor atípico aparece en p99.99 pero no en p99.9 ni en p99", () => {
    const xs = new Float32Array(100_000).fill(1);
    xs[xs.length - 1] = 5_000;
    const [p99, p999, p9999] = tailLatencies(xs);
    expect(p99?.ms).toBe(1);
    expect(p999?.ms).toBe(1);
    expect(p9999?.ms).toBe(1); // 1 de 100 000 es el 0.001 %: ni la cola del 0.01 % lo ve
    expect(percentile(xs, 100)).toBe(5_000);
  });

  test("diez valores atípicos de 100 000 (0.01 %) sí mueven p99.99 solamente", () => {
    const xs = new Float32Array(100_000).fill(1);
    xs.fill(5_000, xs.length - 11);
    const [p99, p999, p9999] = tailLatencies(xs);
    expect(p99?.ms).toBe(1);
    expect(p999?.ms).toBe(1);
    expect(p9999?.ms).toBe(5_000);
  });
});

describe("tailLatencies", () => {
  test("pide al menos 10 solicitudes en la cola de cada percentil", () => {
    expect(MIN_TAIL_SAMPLES).toBe(10);
    expect(samplesNeeded(1)).toBe(1_000);
    expect(samplesNeeded(0.1)).toBe(10_000);
    expect(samplesNeeded(0.01)).toBe(100_000);
  });

  test("justo debajo del mínimo devuelve null y justo en el mínimo devuelve dato", () => {
    const below = tailLatencies(ramp(99_999));
    expect(below.map((t) => t.ms === null)).toEqual([false, false, true]);
    const exact = tailLatencies(ramp(100_000));
    expect(exact.every((t) => t.ms !== null)).toBe(true);
  });

  test("sin muestras ningún percentil tiene dato", () => {
    expect(tailLatencies(new Float32Array(0)).every((t) => t.ms === null)).toBe(true);
  });

  test("con 999 muestras ni siquiera p99 tiene dato", () => {
    expect(tailLatencies(ramp(999)).every((t) => t.ms === null)).toBe(true);
  });

  test("las colas son monótonas: p99 <= p99.9 <= p99.99", () => {
    const xs = Float32Array.from({ length: 200_000 }, (_, i) => (i * i) % 9973);
    xs.sort();
    const [a, b, c] = tailLatencies(xs).map((t) => t.ms as number);
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
  });
});
