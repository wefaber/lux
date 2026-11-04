# Rendimiento de la API: lecturas acotadas

Issue #115. Cada query GraphQL cargaba 13 tablas completas (`loadState()`) y filtraba en memoria; el costo por request crecía con los datos. Ahora `tickets`, `products` y `dashboardStats` (staff) piden a Postgres solo lo que necesitan (`api/src/queries.ts`). Las mutaciones no cambian: siguen usando `loadState()` dentro de su transacción (ids correlativos con lock).

## Qué cambió

| Query                          | Antes                                  | Ahora                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tickets`                      | 13 tablas completas, filtro en memoria | `WHERE` por estado, técnico, solicitante, equipo; trae solo los usuarios, equipos, componentes y lugares que citan los tickets. El rango de fechas compara instantes sobre lo ya filtrado |
| `products`                     | 13 tablas completas                    | `WHERE` por estado y lugar; `availableForLoan` con `NOT EXISTS` sobre préstamos abiertos; componentes por `IN (ids)`                                                                      |
| `dashboardStats` (staff)       | 13 tablas completas                    | `COUNT ... GROUP BY` por tabla; solo la fecha de las solicitudes para armar los tramos                                                                                                    |
| `dashboardStats` (solicitante) | 13 tablas completas                    | Sin cambio: sus promedios (`ticketEstimates`) usan los tickets de toda el área                                                                                                            |

`syncOverdueLoans` (marca préstamos vencidos) solo carga la foto completa cuando hay algún préstamo activo con la devolución vencida; en el caso normal hace una lectura de préstamos activos.

Los objetos salen de los mismos mapeadores que `loadState()` (`toTicket`, `toProduct`, `toComponent`), así que la forma de la respuesta no cambia.

## Verificación de equivalencia

- `api/src/queries.test.ts` compara cada query con filtrar la foto completa (varias combinaciones de filtros). Corre con `DATABASE_URL` y el seed cargado; sin base se omite.
- Se comparó además la respuesta HTTP de la rama contra `dev` para `dashboardStats`, `tickets`, `products` y `products(availableForLoan)` con los roles admin, técnico y solicitante: idéntica, con el seed y con la base escalada.

## Medición

Escenario: `bun scripts/qa/throughput.ts --target <url> --auth --only dashboardStats,tickets,products --duration 8 --connections 32 --threads 4`, token de admin.

Hardware: AMD Ryzen 7 5700X (8 núcleos, 16 hilos), 32 GB de RAM, Windows 11. Postgres 18.6 local (puerto 54329). Cliente, servidor y base en la misma máquina: las cifras son una cota inferior y sirven para comparar antes/después, no como cifra de producción. Una API a la vez; mismo Postgres para ambas.

Antes = `dev` (7bf719b). Después = esta rama.

### Con el seed (15 tickets, 24 solicitudes, 20 préstamos, 15 equipos)

| Consulta         | Antes (req/s) | Después (req/s) | p50 antes → después (ms) |
| ---------------- | ------------: | --------------: | -----------------------: |
| `dashboardStats` |           411 |             727 |              77,8 → 44,3 |
| `tickets`        |           402 |             654 |              79,1 → 49,0 |
| `products`       |           413 |           1.040 |              76,8 → 30,8 |

### Base escalada (10.015 tickets, 5.024 solicitudes, 2.020 préstamos, 1.015 equipos, 3.004 comentarios)

| Consulta         | Antes (req/s) | Después (req/s) | p50 antes → después (ms) |
| ---------------- | ------------: | --------------: | -----------------------: |
| `dashboardStats` |            10 |              61 |              3.066 → 525 |
| `tickets`        |             9 |              13 |            3.374 → 2.318 |
| `products`       |            11 |             139 |              2.918 → 230 |

`tickets` sin filtros devuelve los 10.000 tickets: el costo que queda es armar y serializar esa respuesta, no leer tablas ajenas. Con filtros (`status`, `submittedById`) o paginación baja en proporción; la paginación no está en este issue.

## Pendiente

- Repetir la medición contra el servidor real y desde otra máquina (el enunciado del issue pide `--auth` desde otra máquina). Lo de arriba es local.
- `dashboardStats` del solicitante y el resto de las queries (`loans`, `serviceRequests`, `reservations`, `users`, ...) siguen sobre `loadState()`.
- `dashboardStats` todavía trae la columna `created_at` de todas las solicitudes; un `GROUP BY` por tramo la evitaría.
