// Estadísticas por bloque de N solicitudes (por defecto 1.000) para throughput.ts.
// Sirve para ver si la latencia se degrada a medida que corre la prueba: cada bloque
// agrupa las solicitudes consecutivas (por orden de llegada de la respuesta) y se
// compara con el promedio de toda la corrida.

export const BATCH_SIZE = 1_000;

export interface BatchStat {
  /** 1, 2, 3... */
  index: number;
  count: number;
  /** El último bloque puede tener menos solicitudes que el tamaño pedido. */
  partial: boolean;
  min: number;
  avg: number;
  max: number;
  /** Promedio del bloque como % del promedio total (100 = igual al promedio). null si el promedio total es 0. */
  avgVsTotalPct: number | null;
}

export interface Summary {
  count: number;
  min: number;
  avg: number;
  max: number;
}

/** Orden de llegada: ordena las latencias `ms` según el instante `at` en que terminó cada solicitud. */
export function inArrivalOrder(at: ArrayLike<number>, ms: ArrayLike<number>): Float64Array {
  if (at.length !== ms.length) throw new Error("at y ms tienen que tener el mismo largo");
  const order = Array.from({ length: at.length }, (_, i) => i).sort(
    (a, b) => (at[a] ?? 0) - (at[b] ?? 0) || a - b,
  );
  return Float64Array.from(order, (i) => ms[i] ?? 0);
}

export function summarize(values: ArrayLike<number>): Summary | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
    total += v;
  }
  return { count: values.length, min, avg: total / values.length, max };
}

/** Parte `ordered` (ya en orden de llegada) en bloques de `size` y calcula mínimo, promedio y máximo de cada uno. */
export function batchStats(ordered: ArrayLike<number>, size: number = BATCH_SIZE): BatchStat[] {
  if (!Number.isInteger(size) || size < 1)
    throw new Error("el tamaño del bloque tiene que ser un entero >= 1");
  const total = summarize(ordered);
  if (!total) return [];
  const out: BatchStat[] = [];
  for (let from = 0, index = 1; from < ordered.length; from += size, index++) {
    const block = summarize(
      Array.prototype.slice.call(ordered, from, from + size) as number[],
    ) as Summary;
    out.push({
      index,
      count: block.count,
      partial: block.count < size,
      min: block.min,
      avg: block.avg,
      max: block.max,
      avgVsTotalPct: total.avg > 0 ? (block.avg / total.avg) * 100 : null,
    });
  }
  return out;
}

/**
 * Para no imprimir cientos de filas: si hay más de `limit`, deja los primeros y los últimos bloques
 * y el de mayor promedio (el peor), en orden. Devuelve también cuántos se omitieron.
 */
export function compact(stats: BatchStat[], limit = 20): { shown: BatchStat[]; omitted: number } {
  if (stats.length <= limit) return { shown: stats, omitted: 0 };
  const edge = Math.max(1, Math.floor((limit - 1) / 2));
  const keep = new Set<number>();
  for (let i = 0; i < edge; i++) keep.add(i);
  for (let i = stats.length - edge; i < stats.length; i++) keep.add(i);
  let worst = 0;
  stats.forEach((s, i) => {
    if (s.avg > (stats[worst]?.avg ?? 0)) worst = i;
  });
  keep.add(worst);
  const shown = [...keep].sort((a, b) => a - b).map((i) => stats[i] as BatchStat);
  return { shown, omitted: stats.length - shown.length };
}
