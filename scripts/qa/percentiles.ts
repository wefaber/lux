// Percentiles de latencia para throughput.ts. Aparte del script para poder probarlos sin levantar la API.
//
// Colas que se reportan (a veces llamadas "1 % low", "0.1 % low" y "0.01 % low"):
//   p99    = la latencia que supera el 1 % más lento de las solicitudes
//   p99.9  = ídem para el 0.1 % más lento
//   p99.99 = ídem para el 0.01 % más lento

/** Cuántas solicitudes tiene que haber en la cola para que el percentil no sea ruido. */
export const MIN_TAIL_SAMPLES = 10;

/** Cola (en %) de cada percentil reportado. */
export const TAILS = [
  { label: "p99", percentile: 99, tailPercent: 1 },
  { label: "p99.9", percentile: 99.9, tailPercent: 0.1 },
  { label: "p99.99", percentile: 99.99, tailPercent: 0.01 },
] as const;

/**
 * Percentil por rango más cercano sobre un arreglo ya ordenado de menor a mayor.
 * Devuelve null si no hay muestras o si `p` no está en (0, 100]. Con p = 100 devuelve el máximo.
 */
export function percentile(sorted: ArrayLike<number>, p: number): number | null {
  const n = sorted.length;
  if (n === 0 || !Number.isFinite(p) || p <= 0 || p > 100) return null;
  // Con coma flotante, 99.99 / 100 * 10000 da 9999.000000000002 y ceil() saltaba al máximo.
  // La tolerancia cubre ese error sin mover rangos que sí caen entre dos enteros.
  const rank = Math.ceil((p / 100) * n - 1e-9);
  return sorted[Math.min(n - 1, Math.max(0, rank - 1))] ?? null;
}

/** Mínimo de muestras para que la cola tenga al menos MIN_TAIL_SAMPLES solicitudes. */
export function samplesNeeded(tailPercent: number): number {
  return Math.ceil((MIN_TAIL_SAMPLES * 100) / tailPercent);
}

export interface TailValue {
  label: string;
  /** null si hay pocas muestras para ese percentil: mejor sin dato que un dato engañoso. */
  ms: number | null;
  samplesNeeded: number;
}

export function tailLatencies(sorted: ArrayLike<number>): TailValue[] {
  return TAILS.map(({ label, percentile: p, tailPercent }) => {
    const needed = samplesNeeded(tailPercent);
    return {
      label,
      ms: sorted.length >= needed ? percentile(sorted, p) : null,
      samplesNeeded: needed,
    };
  });
}
