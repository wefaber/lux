# Rendimiento de la API: lecturas acotadas

Issue #115. Cada query GraphQL cargaba 13 tablas completas (`loadState()`) y filtraba en memoria; el costo por request crecía con los datos. Ahora `tickets`, `products` y `dashboardStats` (staff y solicitante) piden a Postgres solo lo que necesitan (`api/src/queries.ts`). Las mutaciones no cambian: siguen usando `loadState()` dentro de su transacción (ids correlativos con lock).

## Qué cambió

| Query                          | Antes                                  | Ahora                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tickets`                      | 13 tablas completas, filtro en memoria | `WHERE` por estado, técnico, solicitante, equipo; trae solo los usuarios, equipos, componentes y lugares que citan los tickets. El rango de fechas compara instantes sobre lo ya filtrado |
| `products`                     | 13 tablas completas                    | `WHERE` por estado y lugar; `availableForLoan` con `NOT EXISTS` sobre préstamos abiertos; componentes por `IN (ids)`                                                                      |
| `dashboardStats` (staff)       | 13 tablas completas                    | `COUNT ... GROUP BY` por tabla; de las solicitudes solo la fecha de las del período (`created_at >= since`)                                                                               |
| `dashboardStats` (solicitante) | 13 tablas completas                    | Solo sus filas (tickets, préstamos, solicitudes, reservas) más lo del área que necesitan sus promedios: tickets resueltos (4 columnas) y equipos de las áreas que usa                     |

`syncOverdueLoans` (marca préstamos vencidos) solo carga la foto completa cuando hay algún préstamo activo con la devolución vencida; en el caso normal hace una lectura de préstamos activos.

Los objetos salen de los mismos mapeadores que `loadState()` (`toTicket`, `toProduct`, `toComponent`), así que la forma de la respuesta no cambia.

Arma el tablero a partir de esos datos `api/src/graphql/dashboard.ts`, sin acceso a la base: se prueba con datos en memoria (base vacía, límites de cada tramo, período desconocido).

### Contacto del técnico (`dni`, `email`)

Las queries acotadas no cargan la foto, así que `ctx.state` queda vacío. `canSeeContact` (`api/src/graphql/privacy.ts`) decidía por la foto y, sin ella, un técnico dejaba de ver el `dni` y el `email` de las personas con las que trabaja (los devolvía `null` en `tickets`). Ahora, sin foto, consulta la relación directo en la base (`relatedUserIdsFromDb`, una vez por request); con foto (mutaciones) usa la foto como antes. La regla es la misma: tickets y solicitudes asignados al técnico, préstamos que entregó o aprobó.

### Período del tablero

- `period` se busca con `Object.hasOwn`. Con `PERIOD_BUCKETS[period]`, un valor como `"constructor"` o `"__proto__"` devolvía una propiedad heredada de `Object` y la serie `servicesByPeriod` salía vacía.
- `periodSince(period)` es el inicio del primer tramo menos un día de margen. Las solicitudes anteriores no entran en la serie, así que no se leen: antes `staffCounts` traía la fecha de todas las solicitudes de la tabla.

## Verificación de equivalencia

- `api/src/queries.test.ts` compara cada query con filtrar la foto completa. Corre con `DATABASE_URL` y datos cargados; sin base se omite. Cubre:
  - `tickets` y `products` con varias combinaciones de filtros;
  - los conteos del tablero del staff y la serie de solicitudes con y sin el corte por período (7d, 30d, 90d, y un corte en el futuro);
  - el tablero del solicitante contra el calculado sobre la foto, para cada solicitante (una muestra si hay más de 12);
  - `relatedUserIdsFromDb` contra `relatedUserIds` de la foto, para cada técnico;
  - regresión: el técnico ve el contacto de sus personas con `ctx.state` vacío (el test falla contra el `privacy.ts` anterior).
- `api/src/graphql/dashboard.test.ts`: lógica del tablero sin base (bordes de tramos, 90d, fechas inválidas, base vacía, período `"constructor"` / `"__proto__"`, `periodSince`).
- `scripts/qa/percentiles.test.ts` y `scripts/qa/batches.test.ts`: la cuenta de colas y de bloques que usa el benchmark.
- Se comparó la respuesta HTTP de la rama contra `dev` (con 20.000 tickets) para `dashboardStats`, `tickets`, `products` y `products(availableForLoan)` con admin, técnico y solicitante: idéntica, salvo el contacto del técnico, que es la diferencia buscada.

## Medición

Escenario: `bun scripts/qa/throughput.ts --target <url> --auth --only <escenarios> --connections <n> --threads <t> --duration <s>`, token de admin (o `--role solicitante`).

Hardware: AMD Ryzen 7 5700X (8 núcleos, 16 hilos), 32 GB de RAM, Windows 11, Bun 1.4.4, PostgreSQL 18.6 local. Cliente, servidor y base en la misma máquina: las cifras son una cota para esa PC y sirven para comparar antes/después, no como cifra de producción. Una API a la vez; mismo Postgres para todas.

### Primera etapa (PR #116): `tickets`, `products`, `dashboardStats` del staff

Antes = `dev` (7bf719b). Después = #116. Datos y método en ese PR.

#### Con el seed (15 tickets, 24 solicitudes, 20 préstamos, 15 equipos)

| Consulta         | Antes (req/s) | Después (req/s) | p50 antes → después (ms) |
| ---------------- | ------------: | --------------: | -----------------------: |
| `dashboardStats` |           411 |             727 |              77,8 → 44,3 |
| `tickets`        |           402 |             654 |              79,1 → 49,0 |
| `products`       |           413 |           1.040 |              76,8 → 30,8 |

#### Base escalada (10.015 tickets, 5.024 solicitudes, 2.020 préstamos, 1.015 equipos, 3.004 comentarios)

| Consulta         | Antes (req/s) | Después (req/s) | p50 antes → después (ms) |
| ---------------- | ------------: | --------------: | -----------------------: |
| `dashboardStats` |            10 |              61 |              3.066 → 525 |
| `tickets`        |             9 |              13 |            3.374 → 2.318 |
| `products`       |            11 |             139 |              2.918 → 230 |

`tickets` sin filtros devuelve todos los tickets: el costo que queda es armar y serializar esa respuesta, no leer tablas ajenas. Con filtros (`status`, `submittedById`) o paginación baja en proporción; la paginación no está en este issue.

### Segunda etapa: tablero del solicitante, corte por período y contacto del técnico

Antes = `dev` con #116 (`bb5f6eb`). Después = esta rama. `tickets`, `products` y `locations` no cambian en esta etapa (mismo código), por eso no se vuelven a comparar.

Base **grande**: el seed más `scripts/qa/bulk-data.sql` (2.018 usuarios, 3.015 equipos, 20.015 tickets, 10.020 préstamos, 10.024 solicitudes, 5.004 comentarios). Corridas de 15 s, con 3 s de calentamiento.

#### `dashboardStats`, costo de un request (1 conexión, sin cola)

| Rol         | req/s antes → después | p50 antes → después (ms) | máximo antes → después (ms) |
| ----------- | --------------------: | -----------------------: | --------------------------: |
| Staff       |               26 → 84 |              37,4 → 11,2 |                 62,1 → 26,3 |
| Solicitante |                2 → 18 |             572,9 → 55,1 |                884,4 → 79,0 |

#### `dashboardStats`, 64 conexiones

| Rol         | req/s antes → después | p50 antes → después |
| ----------- | --------------------: | ------------------: |
| Staff       |              28 → 177 |      2.258 → 354 ms |
| Solicitante |                2 → 17 |      29,5 s → 3,6 s |

El solicitante queda en ~55 ms por request porque el promedio por categoría (`ticketEstimates`) usa los tickets resueltos de toda el área; ya no trae sus columnas pesadas pero sí recorre esas filas.

#### Tope y usuarios equivalentes (barrido de conexiones, `dashboardStats` del staff, base grande)

10 s por punto. Aparece el tope con pocas conexiones y después solo sube la latencia (cola):

| Conexiones | Antes req/s | Antes p50 (ms) | Después req/s | Después p50 (ms) |
| ---------: | ----------: | -------------: | ------------: | ---------------: |
|          1 |          26 |           37,4 |            93 |             10,2 |
|          2 |          27 |           72,2 |           140 |             13,7 |
|          4 |          28 |          140,4 |           146 |             26,0 |
|          8 |          28 |          284,4 |        47 (*) |            108,6 |
|         16 |          27 |          585,6 |           152 |            104,2 |
|         32 |          24 |        1.180,8 |           156 |            203,1 |
|         64 |          28 |        2.257,7 |        99 (*) |            436,6 |
|        128 |          22 |        5.608,5 |           147 |            847,5 |

(*) Puntos con p95 y máximo muy por encima del resto (1.049 ms y 3.454 ms de máximo): ruido de la máquina o de puertos locales en `TIME_WAIT` (ver más abajo), no del servidor. Una corrida aparte con 64 conexiones dio 177 req/s.

- **Tope medido en esta PC:** antes ≈ **28 req/s**, después ≈ **150 a 175 req/s**. El de `dev` se alcanza ya con 1 conexión (agregar más solo suma cola); el nuevo, con 2 a 4.
- **Usuarios equivalentes** (1 request cada 10 s por usuario): ≈ 280 antes, ≈ 1.500 a 1.750 después, para esta consulta sola.
- **Qué lo limita:** el tope aparece con pocas conexiones, lo que apunta a un único proceso de Bun y al pool de 10 conexiones a Postgres. No se midió el uso de CPU por separado, así que es una inferencia.
- **Extrapolación al servidor:** no se puede pasar de esta PC al VPS sin medir en él. Si el límite es un solo proceso, el tope se mueve con la velocidad de un núcleo y se multiplica con instancias adicionales hasta que Postgres o la red se saturen; ese último punto no está medido.

#### Lo que queda

- `tickets` sigue en 4 a 5 req/s con datos grandes: devuelve los 20.000 tickets (≈ 5,9 MB) con usuarios y equipo anidados. Solo escala con paginación (`LIMIT`), que cambia el contrato con el frontend.
- `products` ronda los 50 req/s por la misma razón (3.000 equipos con componentes), en menor medida.
- Las queries que siguen sobre `loadState()` (`loans`, `serviceRequests`, `reservations`, `users`, `reports`, `locations`, ...) tienen el costo de antes: 4 a 6 req/s con datos grandes.
- No se midió una mezcla real de uso ni mutaciones; los usuarios equivalentes son por endpoint.

## Cómo medir

```bash
bun scripts/qa/throughput.ts --auth --target http://SERVIDOR:4114 --duration 60 --connections 128
```

Con 60 s hay suficientes solicitudes para las colas finas. Para una cifra defendible, el cliente va en otra máquina de la misma red. En Windows, corridas seguidas agotan los puertos locales (`TIME_WAIT`): esperar un par de minutos entre corridas.

### Por endpoint y por bloque de 1.000 solicitudes

Cada escenario es un endpoint: `health`, `ready`, `typename`, `me`, `dashboardStats`, `tickets`, `products`, `locations`, `loans`, `serviceRequests`, `reports`. Para cada uno el script imprime mínimo, promedio y máximo de toda la corrida y, además, una tabla por **bloque de 1.000 solicitudes consecutivas** (en orden de llegada): mínimo, promedio y máximo del bloque, y el promedio del bloque como % del promedio total (100 % = igual al promedio). Sirve para ver si la latencia se degrada mientras corre.

```bash
# Costo por solicitud sin cola: una conexión
bun scripts/qa/throughput.ts --auth --target http://SERVIDOR:4114 --connections 1 --duration 30 --csv bloques-1conn.csv

# Otro rol: el tablero del solicitante usa otro camino
bun scripts/qa/throughput.ts --auth --role solicitante --only dashboardStats --target http://SERVIDOR:4114
```

`--batch 500` cambia el tamaño del bloque, `--all-batches` imprime todos, `--csv` guarda los bloques. Con más de 20 bloques se muestran los primeros, los últimos y el más lento. El primer bloque suele salir alto (conexiones nuevas, JIT) y el último puede ser parcial. La lógica está en `scripts/qa/batches.ts`.

### Colas de latencia: 1 %, 0,1 % y 0,01 %

| Columna  | Qué es                     | Solicitudes mínimas en la corrida |
| -------- | -------------------------- | --------------------------------: |
| `p99`    | supera el 1 % más lento    |                             1.000 |
| `p99.9`  | supera el 0,1 % más lento  |                            10.000 |
| `p99.99` | supera el 0,01 % más lento |                           100.000 |

Se piden 10 solicitudes dentro de la cola para que el número no sea ruido. Con menos, la columna dice `n/d`: subir `--duration` o `--connections`. La cuenta está en `scripts/qa/percentiles.ts`.

### Reproducir con datos grandes

```bash
# Base descartable (no usar una con datos reales)
initdb -D pgdata -U lux -A trust -E UTF8 --no-locale
pg_ctl start -D pgdata -o "-p 55432 -c listen_addresses=127.0.0.1"
psql -h 127.0.0.1 -p 55432 -U lux -d postgres -c "create database lux_bench"

# Valores de prueba
export DATABASE_URL=postgres://lux@127.0.0.1:55432/lux_bench AUTH_SECRET=<cadena-larga>
cd api && bun run db:migrate && bun run db:seed
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../scripts/qa/bulk-data.sql   # datos grandes

PORT=4122 bun run src/index.ts &                                         # API
bun ../scripts/qa/throughput.ts --auth --target http://127.0.0.1:4122
```

`scripts/qa/bulk-data.sql` termina con la sección para quitar lo que agregó.

## Pendiente

- Repetir la medición contra el servidor real y desde otra máquina (el enunciado del issue pide `--auth` desde otra máquina). Lo de arriba es local.
- Migrar el resto de las queries sobre `loadState()` (`loans`, `serviceRequests`, `reservations`, `users`, `reports`, `locations`, ...) y paginar `tickets` y `products`. Quedan para otro issue.
