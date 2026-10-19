# Backend GraphQL (PostgreSQL) — SGRSI / Lux

Backend real que reemplaza a los mocks de MSW (`src/mocks/*`). Sirve las 64
operaciones que consume el frontend, con persistencia en PostgreSQL, auth por JWT
y las mismas reglas de permisos, campos calculados, bajas logicas y avisos que los
mocks.

- Stack: Bun + Elysia + GraphQL Yoga + Drizzle + drizzle-kit + PostgreSQL + JWT (HS256)
- Endpoint: `POST /graphql` (GraphiQL en `GET /graphql`)
- Salud: `GET /health` (proceso vivo) y `GET /ready` (base alcanzable + migraciones
  aplicadas; 200 solo si esta todo bien, 503 si no)
- Codigo en `api/`. El frontend (`src/`) no se toca.

## Requisitos

- Bun >= 1.4
- PostgreSQL 18 con una base y un rol que la posea (el rol corre drizzle-kit y
  puede crear tablas)
- Variables de entorno (ver abajo)

## Variables de entorno

| Variable | Uso | Origen |
| --- | --- | --- |
| `DB_HOST` | host de PostgreSQL | `/home/hermes/deploy/env/lux-dev.env` |
| `DB_PORT` | puerto de PostgreSQL | `lux-dev.env` |
| `DB_NAME` | nombre de la base | `lux-dev.env` |
| `DB_USER` | rol de la base | `lux-dev.env` |
| `DB_PASSWORD` | password del rol | `lux-dev.env` |
| `AUTH_SECRET` | firma de los JWT (HS256) | `/home/hermes/deploy/env/lux-api.env` |
| `HOST` | interfaz de escucha (default `127.0.0.1`) | entorno / systemd |
| `PORT` | puerto de escucha (default `4111`) | entorno / systemd |

No hay credenciales en el repo. La unit de systemd ya exporta `lux-dev.env`; el
codigo ademas lee esos archivos al arrancar (`api/src/env.ts`, override con
`LUX_ENV_DIR`) para que las corridas manuales de `db:seed` / `drizzle-kit migrate`
funcionen sin `source`-ear a mano. `lux-api.env` (chmod 600) guarda solo
`AUTH_SECRET`. En produccion se puede usar `DATABASE_URL` en lugar de `DB_*`.

## Comandos

```bash
cd api
bun install            # dependencias

bun run db:generate    # genera SQL de migracion en api/drizzle/ (a partir del schema)
bun run db:migrate     # aplica las migraciones a PostgreSQL
bun run db:seed        # carga el dataset de ejemplo del branch dev (idempotente)

bun run start          # HOST/PORT del entorno; default 127.0.0.1:4111
bun run dev            # igual, con --watch
bun run typecheck      # tsc --noEmit (TypeScript estricto)
```

`db:migrate` no es interactivo y `db:seed` vacia y recarga las tablas del backend
(no toca otras tablas de la base).

## Esquema

Timestamps: se guardan como texto ISO-8601 UTC (el contrato GraphQL los expone
como `String`; el frontend los ordena con `localeCompare` y los parsea con
`new Date()`). El texto ISO es ordenable y evita conversiones de zona horaria.

| Tabla | Columnas principales |
| --- | --- |
| `users` | id, name, dni (unique), email, role, is_active, password_hash (argon2id) |
| `locations` | id, kind, number, name, code, created_at, updated_at, deleted_at |
| `products` | id, machine_id, kind, brand, model, serial_number, part_number, status, issues, location_id, location, deleted_at |
| `components` | id, name, model, manufacturer, serial_number, part_number, is_factory, is_working, product_id, deleted_at |
| `tickets` | id, title, description, category, status, submitted_by_id, assigned_to_id, equipment_id, diagnosis, corrected, actions_taken, resolved_at |
| `loans` | id, equipment_id, user_id, status, approved_by_id, delivered_by_id, delivered_at, issue_date, return_date, actual_return_date, rejection_reason |
| `loan_components` | loan_id, component_id (PK compuesta) — componentes incluidos en un prestamo |
| `service_requests` | id, type, status, requested_by_id, assigned_to_id, description, lab_number, software_name, equipment_id, resolution_text |
| `interventions` | id, equipment_id, technician_id, type, description, parts_replaced, ticket_id, performed_at |
| `comments` | id, entity_type, entity_id, author_id, body |
| `reservations` | id, resource_type, equipment_id, location_id, user_id, purpose, starts_at, ends_at, status, reviewed_by_id, rejection_reason, cancelled_by_id |
| `notices` | id, user_id, entity_type, entity_id, kind, by_id (un aviso por persona y elemento) |
| `pending_seen` | user_id, section, seen_at (PK compuesta) |
| `activity_logs` | id, user_id, user_name, operation, entity, entity_id, timestamp, details |

Relaciones resueltas por el backend (no hay FKs declaradas en el schema, las
integridades las valida la capa de resolvers igual que los mocks):

- `Product.components` = componentes con `product_id = product.id` y `deleted_at IS NULL`
- `Loan.components` = `loan_components`
- `Ticket.submittedBy` / `assignedTo` / `equipment`; `Loan.equipment` / `user` /
  `approvedBy` / `deliveredBy`; `ServiceRequest.requestedBy` / `assignedTo`;
  `Reservation.equipment` / `location` / `user` / `reviewedBy` / `cancelledBy`;
  `Comment.author`; `Notice.by`; `Intervention.technician`
- `Location.productCount` se calcula en cada lectura

## Autenticacion y permisos

- `login(dni, password)` valida contra `users.password_hash` (argon2id via
  `Bun.password.verify`) y devuelve un JWT firmado con `AUTH_SECRET`.
- El frontend manda el token en `Authorization: Bearer <token>`. El backend lo
  verifica, carga el usuario y arma `caller` en el contexto de cada request.
- Reglas de rol (iguales a los mocks):
  - `root_admin`, `admin`: ABM de usuarios, reportes y logs.
  - `tecnico` tambien es staff: tickets, prestamos, solicitudes, inventario,
    ubicaciones, intervenciones, reservas (gestionar).
  - `solicitante`: solo ve lo suyo (tickets, prestamos, solicitudes, reservas) y
    crea pedidos.
- Errores de permisos/validacion se devuelven como `errors[0].message`, igual que
  los mocks, con los mismos textos ("No autenticado", "No tenés permisos para esta
  acción", etc.).

## Operaciones (contrato del frontend)

Las 64 operaciones del frontend estan implementadas con el mismo nombre y shape
que el SDL de los mocks (`api/src/graphql/schema.ts` es copia fiel de
`src/mocks/schema.ts`).

**Queries (26):** Login, GetMe, GetUsers, GetUser, GetProducts, GetProduct,
GetProductByMachineId, GetComponents, GetComponent, GetTickets, GetTicket,
GetOolTickets, GetLoans, GetLoan, GetServiceRequests, GetServiceRequest,
GetDashboardStats, GetReports, GetActivityLogs, GetComments, GetInterventions,
GetLocations, GetReservations, GetReservation, GetNotices, GetPendingNews.

**Mutations (38):** CreateUser, UpdateUser, DeleteUser, CreateProduct,
UpdateProduct, SoftDeleteProduct, CreateComponent, UpdateComponent,
SoftDeleteComponent, CreateTicket, UpdateTicket, AssignTicket, ClaimTicket,
CompleteTicket, ChangeTicketStatus, CreateLoan, ApproveLoan, RejectLoan,
DeliverLoan, ReturnLoan, CreateServiceRequest, UpdateServiceRequest,
ClaimServiceRequest, AssignServiceRequest, ChangePassword, CreateComment,
CreateIntervention, UpdateIntervention, CreateLocation, UpdateLocation,
SoftDeleteLocation, CreateReservation, UpdateReservation, ApproveReservation,
RejectReservation, CancelReservation, AcknowledgeNotice, MarkPendingSeen.

Comportamiento que el backend reproduce en cada lectura, igual que los mocks:

- Prestamos entregados con fecha vencida pasan a `overdue` y generan aviso.
- Reservas `approved`/`active` avanzan solas a `active`/`completed` con el tiempo.
- Los avisos (`notices`) se reemplazan por persona y elemento; marcarlos como
  vistos los borra. `pendingNews` lista las secciones con pedidos pendientes que el
  staff no vio.
- Bajas logicas: `deleted_at` en productos, componentes y ubicaciones; un equipo
  dado de baja pasa a `retired`.
- `ChangePassword` verifica la contraseña actual (los mocks devolvian `true` sin
  chequear) y guarda el nuevo hash argon2id.

### Verificacion de selection sets

`bun run scripts/check-frontend-docs.ts` recorre `src/`, extrae todos los documentos
GraphQL (121 plantillas, 62 operaciones) y los valida contra el SDL servido. Da 0
errores: ningun selection set de la app queda sin resolver. Los otros dos nombres
del contrato (`GetMe`, `GetProductByMachineId`) estan implementados pero hoy no
aparecen como plantilla en `src/`.

## Cuentas de prueba

Los hashes argon2id se generan en el seed a partir de los passwords de
`src/mocks/data/users.ts`. Password compartido de prueba: `root2026`.

| Rol | DNI | Password | Usuario |
| --- | --- | --- | --- |
| root_admin | `00000000` | `root2026` | Sistema Raiz |
| admin | `12345678` | `admin2026` | Marcela Rodriguez |
| admin | `23456789` | `admin2026` | Jorge Mendez |
| tecnico | `34567890` | `tecnico2026` | Nicolas Ferreira |
| tecnico | `45678901` | `tecnico2026` | Valentina Cruz |
| tecnico | `56789012` | `tecnico2026` | Sebastian Nunez |
| solicitante | `67890123` | `sol2026` | Ana Garcia |
| solicitante | `78901234` | `sol2026` | Carlos Suarez |
| solicitante | `89012345` | `sol2026` | Laura Martinez |
| solicitante | `90123456` | `sol2026` | Diego Romero |
| solicitante | `01234567` | `sol2026` | Paola Viera |
| solicitante | `11223344` | `sol2026` | Martin Pereira |
| solicitante | `22334455` | `sol2026` | Camila Acosta (inactiva) |
| solicitante | `33445566` | `sol2026` | Roberto Silva |
| solicitante | `44556677` | `sol2026` | Florencia Lopez |
| solicitante | `55667788` | `sol2026` | Andres Delgado |
| solicitante | `66778899` | `sol2026` | Sofia Cabrera |
| solicitante | `77889900` | `sol2026` | Fernando Torres |

Ejemplo:

```bash
curl -s localhost:4111/health
curl -s localhost:4111/ready

TOKEN=$(curl -s -X POST localhost:4111/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query Login($dni: String!, $password: String!) { login(dni: $dni, password: $password) { token } }","variables":{"dni":"00000000","password":"root2026"}}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["login"]["token"])')

curl -s -X POST localhost:4111/graphql -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"query { tickets { id title status } }"}'
```

## Estructura

```
api/
  drizzle.config.ts        config de drizzle-kit
  drizzle/                 migraciones SQL generadas (se commitean)
  scripts/check-frontend-docs.ts  valida los documentos GraphQL de src/
  src/
    index.ts               Elysia + GraphQL Yoga; /graphql, /health, /ready
    env.ts                 carga de entorno (DB_*, AUTH_SECRET, HOST, PORT)
    auth.ts                firma/verificacion de JWT (jose, HS256)
    state.ts               carga la base y arma los objetos del dominio
    graphql/schema.ts      SDL (contrato del frontend)
    graphql/resolvers.ts   queries y mutations (espejo de src/mocks/handlers.ts)
    lib/                   types/constants/validation compartidos (copia de src/lib)
    db/schema.ts           tablas de Drizzle
    db/client.ts           pool de pg + drizzle
    db/seed.ts             carga del dataset de ejemplo
    db/fixtures/           dataset del branch dev (copia de src/mocks/data)
```

## Notas de integracion

- Nginx ya proxea `https://dev.eternum.lat/graphql` al slot activo; el backend
  escucha en `127.0.0.1:$PORT` y el deploy blue/green usa `/ready` antes de mover
  el trafico.
- El trabajo se hizo en el worktree `feat/backend-postgres` (base `origin/dev`).
  Esta _branch_ de backend reemplaza a los mocks; para usarla se sirve la API real
  en lugar de MSW. No modifica `src/`.
