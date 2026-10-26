# Backend (PostgreSQL) de SGRSI / Lux

> Nota: este documento es texto base generado con asistencia de IA a partir del codigo
> de `api/` y de las corridas de prueba. El equipo debe revisarlo y reescribirlo con sus
> palabras antes de usarlo en una entrega.

Backend real que reemplaza a los mocks de MSW (`src/mocks/*`). Sirve las 64
operaciones GraphQL que consume el frontend, mas rutas REST `/api/v1` con verbos
HTTP y envelope `{status, message, data}` que ejecutan los mismos resolvers.
Persistencia en PostgreSQL, auth por JWT, auditoria de toda escritura y las mismas
reglas de permisos, campos calculados, bajas logicas y avisos que los mocks.

- Stack: Bun + Elysia + GraphQL Yoga + Drizzle + drizzle-kit + PostgreSQL + JWT (HS256)
- GraphQL: `POST /graphql` (GraphiQL en `GET /graphql` solo fuera de produccion)
- REST: `/api/v1/...` (74 rutas, ver "Rutas REST")
- Salud: `GET /health` (proceso vivo) y `GET /ready` (base alcanzable + migraciones
  aplicadas; 200 solo si esta todo bien, 503 si no; la respuesta no describe la causa,
  que queda en el log del servidor)
- Codigo en `api/`. El frontend (`src/`) no se toca.

Equivalencia con la rubrica de Programacion (que pide PHP y JSON generado por el
servidor): el JSON lo genera el servidor Bun + Elysia en vez de PHP; la lista de
verbos GET/POST/PUT/DELETE, el contrato `status/message/data` y los codigos HTTP
estan en las rutas `/api/v1`.

## Requisitos

- Bun >= 1.4
- PostgreSQL con una base y un rol que la posea (el rol corre drizzle-kit y puede
  crear tablas). El documento original indicaba la version 18; las pruebas de esta
  rama corrieron sobre PostgreSQL 16.
- Variables de entorno (ver abajo)

## Variables de entorno

| Variable | Uso | Origen |
| --- | --- | --- |
| `DB_HOST` | host de PostgreSQL | `/home/hermes/deploy/env/lux-dev.env` |
| `DB_PORT` | puerto de PostgreSQL | `lux-dev.env` |
| `DB_NAME` | nombre de la base | `lux-dev.env` |
| `DB_USER` | rol de la base | `lux-dev.env` |
| `DB_PASSWORD` | password del rol | `lux-dev.env` |
| `DATABASE_URL` | alternativa a `DB_*` (URL completa) | entorno |
| `AUTH_SECRET` | firma de los JWT (HS256) | `/home/hermes/deploy/env/lux-api.env` |
| `HOST` | interfaz de escucha (default `127.0.0.1`) | entorno / systemd |
| `PORT` | puerto de escucha (default `4111`) | entorno / systemd |
| `NODE_ENV` | con `production` se cierran GraphiQL y la introspeccion | entorno / systemd |
| `TRUST_PROXY` | con `1`, la IP del cliente es la ultima entrada de `X-Forwarded-For` (la agrega nginx) | entorno / systemd |
| `LOGIN_MAX_ATTEMPTS` | fallos de login por documento antes del bloqueo (default 5) | entorno |
| `LOGIN_LOCK_MINUTES` | minutos del primer bloqueo y de la ventana de conteo (default 15) | entorno |
| `LOGIN_LOCK_MAX_MINUTES` | tope del bloqueo incremental: 15, 30, 60... (default 60) | entorno |
| `LOGIN_IP_MAX_ATTEMPTS` | fallos de login por IP antes del bloqueo (default 50) | entorno |
| `CORS_ORIGINS` | origenes del navegador que pueden llamar a la API, separados por coma (default: `https://lux.eternum.lat`, `https://dev.eternum.lat`, `http://localhost:5173`, `http://127.0.0.1:5173`). Un `*` se ignora | entorno |
| `MAX_BODY_BYTES` | tamano maximo del cuerpo de un request (default 262144, 256 KiB); mas da HTTP 413 | entorno |
| `GRAPHQL_MAX_DEPTH` | profundidad maxima de una operacion GraphQL (default 10) | entorno |
| `GRAPHQL_MAX_ROOT_FIELDS` | campos raiz maximos por operacion, alias incluidos (default 12) | entorno |

No hay credenciales en el repo. La unit de systemd ya exporta `lux-dev.env`; el
codigo ademas lee esos archivos al arrancar (`api/src/env.ts`, override con
`LUX_ENV_DIR`) para que las corridas manuales de `db:seed` / `drizzle-kit migrate`
funcionen sin `source`-ear a mano. `lux-api.env` (chmod 600) guarda solo
`AUTH_SECRET`.

## Comandos

```bash
cd api
bun install            # dependencias

bun run db:generate    # genera SQL de migracion en api/drizzle/ (a partir del schema)
bun run db:migrate     # aplica las migraciones a PostgreSQL
bun run db:seed        # carga el dataset de ejemplo del branch dev (idempotente)
bun run scripts/preflight-integrity.ts   # antes de migrar una base con datos: filas que violarian FK/CHECK

bun run start          # HOST/PORT del entorno; default 127.0.0.1:4111
bun run dev            # igual, con --watch
bun run typecheck      # tsc --noEmit (TypeScript estricto)
bun test               # pruebas unitarias (y de integracion si hay DATABASE_URL)
```

`db:migrate` no es interactivo y `db:seed` vacia y recarga las tablas del backend
(no toca otras tablas de la base). La suite de QA contra la API en marcha:
`bun run qa:api --target http://127.0.0.1:4111` desde la raiz (ver `tests/README.md`).

## Esquema

Timestamps: se guardan como texto ISO-8601 UTC (el contrato GraphQL los expone
como `String`; el frontend los ordena con `localeCompare` y los parsea con
`new Date()`). El texto ISO es ordenable y evita conversiones de zona horaria.

15 tablas:

| Tabla | Columnas principales |
| --- | --- |
| `users` | id, name, dni (unique), email, role, is_active, password_hash (argon2id), token_version, student_group, student_shift, student_subjects (jsonb, solo solicitantes) |
| `locations` | id, kind, number, name, code, created_at, updated_at, deleted_at |
| `products` | id, machine_id, kind, brand, model, serial_number, part_number, status, issues, location_id, location, deleted_at |
| `components` | id, name, model, manufacturer, serial_number, part_number, is_factory, is_working, product_id, deleted_at |
| `tickets` | id, title, description, category, status, submitted_by_id, assigned_to_id, equipment_id, diagnosis, corrected, actions_taken, resolved_at, deleted_at |
| `loans` | id, equipment_id, user_id, status, approved_by_id, delivered_by_id, delivered_at, issue_date, return_date, actual_return_date, rejection_reason, deleted_at |
| `loan_components` | loan_id, component_id (PK compuesta): componentes incluidos en un prestamo |
| `service_requests` | id, type, status, requested_by_id, assigned_to_id, description, lab_number, software_name, equipment_id, resolution_text, deleted_at |
| `interventions` | id, equipment_id, technician_id, type, description, parts_replaced, ticket_id, performed_at, deleted_at |
| `comments` | id, entity_type, entity_id, author_id, body, deleted_at |
| `reservations` | id, resource_type, equipment_id, location_id, user_id, purpose, starts_at, ends_at, status, reviewed_by_id, rejection_reason, cancelled_by_id |
| `notices` | id, user_id, entity_type, entity_id, kind, by_id (un aviso por persona y elemento) |
| `pending_seen` | user_id, section, seen_at (PK compuesta) |
| `activity_logs` | id, user_id, user_name, operation, entity, entity_id, timestamp, details: auditoria, solo se inserta |
| `revoked_tokens` | jti (PK), user_id, expires_at, revoked_at: sesiones cerradas con `logout` |

### Migraciones

| Migracion | Contenido |
| --- | --- |
| `0000_uneven_proemial_gods` | las 14 tablas originales e indices (sin FK ni CHECK) |
| `0001_soft_delete_columns` | `deleted_at` en tickets, loans, service_requests, interventions y comments |
| `0002_revoked_tokens` | tabla `revoked_tokens` (logout) |
| `0003_integrity_fk_check` | 26 claves foraneas y 16 CHECK |
| `0004_token_version` | `users.token_version` (default 0), para invalidar sesiones al cambiar la contrasena |
| `0005_student_info` | `users.student_group`, `student_shift` (CHECK `matutino`/`vespertino`/`nocturno`) y `student_subjects` (jsonb array, default `[]`); solo el rol `solicitante` puede tener datos |

Las migraciones se aplican en orden y no se reescriben. Antes de aplicar la 0003 a
una base con datos viejos (dev, produccion) correr `scripts/preflight-integrity.ts`:
lista las filas huerfanas o con valores fuera de lista que la migracion rechazaria.

### Integridad referencial (migracion 0003)

Todas con `ON DELETE NO ACTION`: nada se borra fisicamente (las bajas son logicas).

| Tabla.columna | Referencia |
| --- | --- |
| `products.location_id` | `locations.id` |
| `components.product_id` | `products.id` |
| `tickets.submitted_by_id`, `assigned_to_id` | `users.id` |
| `tickets.equipment_id` | `products.id` |
| `loans.user_id`, `approved_by_id`, `delivered_by_id` | `users.id` |
| `loans.equipment_id` | `products.id` |
| `loan_components.loan_id` / `component_id` | `loans.id` / `components.id` |
| `service_requests.requested_by_id`, `assigned_to_id` | `users.id` |
| `service_requests.equipment_id` | `products.id` |
| `interventions.technician_id` | `users.id` |
| `interventions.equipment_id` / `ticket_id` | `products.id` / `tickets.id` |
| `comments.author_id` | `users.id` |
| `reservations.user_id`, `reviewed_by_id`, `cancelled_by_id` | `users.id` |
| `reservations.equipment_id` / `location_id` | `products.id` / `locations.id` |
| `notices.user_id`, `by_id` | `users.id` |
| `pending_seen.user_id` | `users.id` |

Sin FK a proposito: `comments.entity_id` (apunta a un ticket o a una solicitud segun
`entity_type`; la valida el resolver), `notices.entity_id` (polimorfica), y
`activity_logs.user_id` (la auditoria no debe depender de que el usuario exista, y
registra intentos de login de documentos inexistentes).

CHECK (los valores salen de `api/src/db/enums.ts`, que no compila si los tipos del
dominio cambian): `users.role`, `locations.kind`, `products.status`,
`tickets.status` y `category`, `loans.status`, `service_requests.type` y `status`,
`interventions.type`, `comments.entity_type`, `reservations.resource_type` y
`status`, `notices.entity_type` y `kind`, `pending_seen.section`, y la forma de
`reservations` (de un equipo o de un espacio, nunca de los dos ni de ninguno). Son
CHECK y no tipos `ENUM` de PostgreSQL para poder agregar un valor con una migracion
simple. Las FK y los CHECK son la ultima defensa: los resolvers validan antes y
contestan 422 con un mensaje propio.

Relaciones resueltas por el backend:

- `Product.components` = componentes con `product_id = product.id` y `deleted_at IS NULL`
- `Loan.components` = `loan_components`
- `Ticket.submittedBy` / `assignedTo` / `equipment`; `Loan.equipment` / `user` /
  `approvedBy` / `deliveredBy`; `ServiceRequest.requestedBy` / `assignedTo`;
  `Reservation.equipment` / `location` / `user` / `reviewedBy` / `cancelledBy`;
  `Comment.author`; `Notice.by`; `Intervention.technician`
- `Location.productCount` se calcula en cada lectura

Deuda de normalizacion conocida: `products.location` repite `locations.name` (el
contrato GraphQL la expone como `Product.location: String!` y `updateLocation`
la mantiene sincronizada). Con eso el esquema no llega a 3FN estricta.

## Autenticacion y permisos

- `login(dni, password)` (GraphQL) o `POST /api/v1/auth/login` valida contra
  `users.password_hash` (argon2id via `Bun.password.verify`) y devuelve un JWT HS256
  firmado con `AUTH_SECRET`. El token trae `sub`, `role`, `ver` (version de credenciales), `jti` y `exp`.
- **Vigencia: 8 horas** absolutas desde el login (no hay renovacion ni expiracion por
  inactividad: el caso CP-27-02 sigue marcado como falla conocida).
- El frontend manda el token en `Authorization: Bearer <token>`. En cada request el
  backend lo verifica (firma, algoritmo, vencimiento), comprueba que su `jti` no este
  en `revoked_tokens` y carga al usuario (debe seguir activo y su `token_version` tiene
  que coincidir con la `ver` del token): de ahi sale `caller`.
- **Cambio de contrasena**: `changePassword` (o el restablecimiento por un administrador
  con `updateUser` y `password`) sube `users.token_version`. Todos los tokens emitidos
  antes, la sesion que hizo el cambio incluida, dejan de autenticar (`me` devuelve
  `null`, el resto responde `UNAUTHENTICATED`) y hay que volver a iniciar sesion. Queda
  pendiente que el frontend, tras `changePassword`, lleve a la pantalla de login.
- **Logout**: la mutation `logout` / `POST /api/v1/auth/logout` guarda el `jti` en
  `revoked_tokens` hasta que el token venza. Desde ese momento el token da 401. Deja
  `LOGOUT` en la auditoria. Queda pendiente que el frontend llame a `logout` al
  cerrar sesion (hoy solo borra el token del navegador).
- **Bloqueo por intentos fallidos**: 5 fallos por documento en 15 minutos bloquean ese
  documento (`TOO_MANY_ATTEMPTS`, HTTP 429, cabecera `Retry-After`); el bloqueo es
  incremental (15, 30, 60 minutos... con tope `LOGIN_LOCK_MAX_MINUTES`, default 60).
  La respuesta ya bloqueada es igual exista o no la cuenta, y su mensaje es el mismo
  "Credenciales inválidas" de una clave erronea: el bloqueo se reconoce por `code`,
  `status` y `retryAfterSeconds`, no por el texto. Un login correcto limpia el
  contador y la escalada de ese documento; un dia sin fallos tambien vuelve al bloqueo
  base. Ademas hay un umbral por IP (50 fallos en 15 minutos) contra
  el rociado de contrasenas. Cada fallo deja `LOGIN_FAILED` y el bloqueo `ACCOUNT_LOCKED`.
  **Limitacion**: el contador vive en la memoria del proceso; se pierde al reiniciar y
  no se comparte entre los slots del deploy blue/green. Bloquear por documento permite
  que un tercero deje fuera a una cuenta ajena durante el bloqueo (compromiso aceptado
  frente a la fuerza bruta).
- Para que la IP por socket sea la del cliente y no la de nginx hay que arrancar con
  `TRUST_PROXY=1`; sin eso, todos los usuarios comparten la IP del proxy.
- Reglas de rol (iguales a los mocks):
  - `root_admin`, `admin`: ABM de usuarios, reportes y logs.
  - `tecnico` tambien es staff: tickets, prestamos, solicitudes, inventario,
    ubicaciones, intervenciones, reservas (gestionar).
  - `solicitante`: solo ve lo suyo (tickets, prestamos, solicitudes, reservas) y
    crea pedidos.
- **Trabajo de otro tecnico**: un `tecnico` no puede cambiar de estado, editar,
  completar ni reasignar (`updateTicket`, `changeTicketStatus`, `completeTicket`,
  `assignTicket`, `updateServiceRequest`, `assignServiceRequest`) un ticket o una
  solicitud asignados a otro tecnico (`FORBIDDEN`); los administradores si. Lo que esta
  **sin asignar** lo puede trabajar cualquier tecnico: `claimTicket` /
  `claimServiceRequest` lo toman, y `updateServiceRequest` con estado `in_progress` o
  `completed` sobre una solicitud sin asignar la reclama para quien la actualiza. Una vez
  asignado, solo el asignado y los administradores la operan. No se aplica todavia a las
  intervenciones (ver "Limitaciones").
- **Datos de contacto (protocolo 8.1)**: `User.dni` y `User.email` ahora son opcionales
  en el SDL y salen `null` cuando quien consulta no tiene relacion con la persona. Los
  ven: el propio usuario, los administradores y, para el tecnico, quienes pidieron un
  ticket o una solicitud que tiene asignados o un prestamo que entrego o aprobo. El
  nombre, el rol y el resto de los campos no cambian. El `AuthUser` del login siempre
  trae los datos propios.

## Codigos de error

Todo error trae `extensions.code` (estable, para que el cliente decida) y
`extensions.status` (HTTP equivalente). Los mensajes son los mismos textos en
castellano que ya consumia el frontend en `errors[0].message`.

| `code` | `status` | Cuando |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | JSON invalido, variable faltante o de tipo equivocado, consulta mal formada |
| `UNAUTHENTICATED` | 401 | sin token, token vencido, alterado o revocado, usuario desactivado |
| `INVALID_CREDENTIALS` | 401 | DNI o contrasena incorrectos (mismo mensaje en ambos casos) |
| `FORBIDDEN` | 403 | autenticado pero sin permiso para esa accion |
| `NOT_FOUND` | 404 | el recurso no existe o no es visible para quien pregunta |
| `CONFLICT` | 409 | choca con el estado actual: duplicado, transicion invalida, recurso en uso, superposicion |
| `VALIDATION_ERROR` | 422 | los datos no cumplen las reglas de negocio (formato, referencia inexistente, valor fuera de lista) |
| `TOO_MANY_ATTEMPTS` | 429 | documento o IP bloqueados por intentos de login fallidos (el mensaje es el de una clave erronea) |
| `INTERNAL_ERROR` | 500 | error inesperado: el detalle queda en el log del servidor y no sale en la respuesta |

Ademas, en REST el metodo no admitido responde 405 con `Allow` y `code: BAD_REQUEST`.

GraphQL responde HTTP 200 cuando ejecuto la operacion (convencion de GraphQL sobre
HTTP) y deja el codigo en la extension:

```json
{"errors":[{"message":"No tenés permisos para esta acción","path":["users"],
  "extensions":{"code":"FORBIDDEN","status":403}}],"data":null}
```

Los errores inesperados (caida de la base, bug) salen como `INTERNAL_ERROR` con el
mensaje generico "Error interno del servidor". Las violaciones de restriccion de
PostgreSQL se traducen sin exponer el nombre de la restriccion: UNIQUE a `CONFLICT`,
FK y CHECK a `VALIDATION_ERROR`.

## Endurecimiento HTTP

- **CORS** con lista de origenes (`CORS_ORIGINS`, `api/src/cors.ts`): solo esos origenes
  reciben `Access-Control-Allow-Origin` (con credenciales). Un origen ajeno recibe 403 en
  el preflight y las respuestas sin cabeceras CORS. Se desactivo el CORS por defecto de
  Yoga, que devolvia cualquier `Origin` recibido. Sin cabecera `Origin` (curl, servidor a
  servidor) no se agrega nada. Si el frontend se sirve del mismo origen que la API
  (nginx), CORS no interviene.
- **GraphiQL e introspeccion** solo fuera de produccion (`NODE_ENV=production` los
  cierra; una consulta `__schema` falla con `BAD_REQUEST`).
- **Forma de la operacion** (`api/src/graphql/limits.ts`): hasta 10 niveles de
  profundidad, 12 campos raiz (alias incluidos) y 3 repeticiones del mismo campo raiz;
  `login` y `changePassword` una sola vez por request. Antes se podian hacer 15 logins en
  un POST. Las 125 operaciones del frontend caben con holgura (profundidad maxima 4). El
  rechazo es `BAD_REQUEST` y no ejecuta ningun resolver. No se aceptan arreglos de
  operaciones (batching).
- **Tamano del body**: 256 KiB (`MAX_BODY_BYTES`); mas devuelve HTTP 413 sin cuerpo, lo
  corta el servidor antes de llegar a la aplicacion.
- **Cabeceras** (`api/src/security-headers.ts`) en toda respuesta: `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none';
  form-action 'none'` (la API no sirve HTML). `Strict-Transport-Security` (1 anio,
  `includeSubDomains`) solo con `TRUST_PROXY=1`, o sea cuando hay nginx adelante
  terminando TLS. Fuera de produccion la pagina de GraphiQL no lleva CSP. Las respuestas
  413 las genera el servidor y no llevan estas cabeceras.

## Rutas REST (`/api/v1`)

Cada ruta es un adaptador fino (`api/src/rest/`): se compila a una operacion del
esquema GraphQL y la ejecuta con `execute()` sobre los mismos resolvers, asi que los
permisos, validaciones, transaccion y auditoria son exactamente los de GraphQL. El
documento y el selection set salen del propio esquema.

Convencion: `GET` lee, `POST` crea (201) o ejecuta (login, logout), `PUT` cambia, con las
transiciones de estado como sub-recurso (`PUT /tickets/:id/claim`), y `DELETE` da de baja
(logica, 200). Los argumentos se toman del path (`:id`), del cuerpo JSON (en altas y
cambios, el cuerpo entero es el `input` de la operacion) o de la query string (filtros de
lectura). `PUT` reemplaza con el mismo `input` completo que pide GraphQL.

Envelope de toda respuesta:

```json
{ "status": 200, "message": "OK", "data": { "...": "..." } }
{ "status": 404, "message": "No encontrado", "data": null, "code": "NOT_FOUND" }
```

`status` repite el codigo HTTP de la respuesta; `code` (solo en errores) es el del
catalogo de arriba. Lecturas 200, altas 201, cambios y bajas 200. Una baja devuelve
`data: { "id": "...", "deleted": true }`. Un `GET` por id que no encuentra nada
responde 404. Cuerpo maximo: 1 MB.

| Metodo | Ruta | Operacion GraphQL | Roles |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | `login` | Público |
| POST | `/api/v1/auth/logout` | `logout` | Autenticado |
| GET | `/api/v1/auth/me` | `me` | Autenticado |
| PUT | `/api/v1/auth/password` | `changePassword` | Autenticado |
| GET | `/api/v1/users` | `users` | Staff |
| GET | `/api/v1/users/:id` | `user` | Staff, o el propio usuario |
| POST | `/api/v1/users` | `createUser` | Admin |
| PUT | `/api/v1/users/:id` | `updateUser` | Admin |
| DELETE | `/api/v1/users/:id` | `deleteUser` | Admin |
| POST | `/api/v1/users/import` | `importUsers` | Admin |
| GET | `/api/v1/locations` | `locations` | Autenticado |
| GET | `/api/v1/locations/:id` | `location` | Autenticado |
| POST | `/api/v1/locations` | `createLocation` | Staff |
| PUT | `/api/v1/locations/:id` | `updateLocation` | Staff |
| DELETE | `/api/v1/locations/:id` | `softDeleteLocation` | Staff |
| GET | `/api/v1/products` | `products` | Autenticado |
| GET | `/api/v1/products/by-machine-id/:machineId` | `productByMachineId` | Autenticado |
| GET | `/api/v1/products/:id` | `product` | Autenticado |
| POST | `/api/v1/products` | `createProduct` | Staff |
| PUT | `/api/v1/products/:id` | `updateProduct` | Staff |
| DELETE | `/api/v1/products/:id` | `softDeleteProduct` | Staff |
| GET | `/api/v1/components` | `components` | Autenticado |
| GET | `/api/v1/components/:id` | `component` | Autenticado |
| POST | `/api/v1/components` | `createComponent` | Staff |
| PUT | `/api/v1/components/:id` | `updateComponent` | Staff |
| DELETE | `/api/v1/components/:id` | `softDeleteComponent` | Staff |
| GET | `/api/v1/tickets` | `tickets` | Autenticado (solicitante: solo los suyos) |
| GET | `/api/v1/tickets/unassigned` | `oolTickets` | Staff |
| GET | `/api/v1/tickets/:id` | `ticket` | Staff, o el dueño |
| POST | `/api/v1/tickets` | `createTicket` | Autenticado |
| PUT | `/api/v1/tickets/:id` | `updateTicket` | Staff |
| PUT | `/api/v1/tickets/:id/status` | `changeTicketStatus` | Staff |
| PUT | `/api/v1/tickets/:id/claim` | `claimTicket` | Staff |
| PUT | `/api/v1/tickets/:id/assign` | `assignTicket` | Staff |
| PUT | `/api/v1/tickets/:id/complete` | `completeTicket` | Staff |
| DELETE | `/api/v1/tickets/:id` | `softDeleteTicket` | Admin, o el dueño si está pendiente y sin tomar |
| GET | `/api/v1/loans` | `loans` | Autenticado (solicitante: solo los suyos) |
| GET | `/api/v1/loans/:id` | `loan` | Staff, o el dueño |
| POST | `/api/v1/loans` | `createLoan` | Autenticado |
| PUT | `/api/v1/loans/:id/approve` | `approveLoan` | Staff |
| PUT | `/api/v1/loans/:id/reject` | `rejectLoan` | Staff |
| PUT | `/api/v1/loans/:id/deliver` | `deliverLoan` | Staff |
| PUT | `/api/v1/loans/:id/return` | `returnLoan` | Staff |
| DELETE | `/api/v1/loans/:id` | `softDeleteLoan` | Admin, o el dueño si está pendiente; nunca en curso |
| GET | `/api/v1/service-requests` | `serviceRequests` | Autenticado (solicitante: solo las suyas) |
| GET | `/api/v1/service-requests/:id` | `serviceRequest` | Staff, o el dueño |
| POST | `/api/v1/service-requests` | `createServiceRequest` | Autenticado |
| PUT | `/api/v1/service-requests/:id` | `updateServiceRequest` | Staff |
| PUT | `/api/v1/service-requests/:id/claim` | `claimServiceRequest` | Staff |
| PUT | `/api/v1/service-requests/:id/assign` | `assignServiceRequest` | Staff |
| DELETE | `/api/v1/service-requests/:id` | `softDeleteServiceRequest` | Admin, o el dueño si está pendiente y sin tomar; nunca en curso |
| GET | `/api/v1/interventions` | `interventions` | Staff |
| GET | `/api/v1/interventions/:id` | `intervention` | Staff |
| POST | `/api/v1/interventions` | `createIntervention` | Staff |
| PUT | `/api/v1/interventions/:id` | `updateIntervention` | Staff |
| DELETE | `/api/v1/interventions/:id` | `softDeleteIntervention` | Admin, o el técnico autor |
| GET | `/api/v1/comments` | `comments` | Quien ve el ticket o la solicitud |
| GET | `/api/v1/comments/:id` | `comment` | Quien ve el ticket o la solicitud |
| POST | `/api/v1/comments` | `createComment` | Quien ve el ticket o la solicitud |
| DELETE | `/api/v1/comments/:id` | `softDeleteComment` | Admin, o el autor |
| GET | `/api/v1/reservations` | `reservations` | Autenticado (solicitante: solo las suyas) |
| GET | `/api/v1/reservations/:id` | `reservation` | Staff, o el dueño |
| POST | `/api/v1/reservations` | `createReservation` | Autenticado |
| PUT | `/api/v1/reservations/:id` | `updateReservation` | Staff |
| PUT | `/api/v1/reservations/:id/approve` | `approveReservation` | Staff |
| PUT | `/api/v1/reservations/:id/reject` | `rejectReservation` | Staff |
| DELETE | `/api/v1/reservations/:id` | `cancelReservation` | El dueño de la reserva |
| GET | `/api/v1/notices` | `notices` | Autenticado (los propios) |
| DELETE | `/api/v1/notices/:id` | `acknowledgeNotice` | El destinatario |
| GET | `/api/v1/pending-news` | `pendingNews` | Autenticado (vacío si no es staff) |
| PUT | `/api/v1/pending-news/:section` | `markPendingSeen` | Staff |
| GET | `/api/v1/activity-logs` | `activityLogs` | Admin |
| GET | `/api/v1/dashboard/stats` | `dashboardStats` | Autenticado |
| GET | `/api/v1/reports` | `reports` | Admin |

"Staff" = `tecnico`, `admin` y `root_admin`; "Admin" = `admin` y `root_admin`.
Ejemplo:

```bash
TOKEN=$(curl -s -X POST localhost:4111/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"dni":"00000000","password":"root2026"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')
curl -s -X POST localhost:4111/api/v1/tickets -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Monitor sin imagen","description":"No enciende desde la manana","category":"hardware"}'
curl -s -X DELETE localhost:4111/api/v1/tickets/tkt-016 -H "Authorization: Bearer $TOKEN"
```

## Operaciones GraphQL (contrato del frontend)

Las 64 operaciones del frontend estan implementadas con el mismo nombre y shape que el
SDL de los mocks. `api/src/graphql/schema.ts` es el SDL de los mocks mas operaciones
**aditivas** que la app no usa (los mocks MSW no las tienen):

- Bajas logicas: `softDeleteTicket`, `softDeleteLoan`, `softDeleteServiceRequest`,
  `softDeleteIntervention`, `softDeleteComment`.
- Sesion: `logout`.
- Lecturas por id: `location(id)`, `intervention(id)`, `comment(id)`.

**Queries (26 + 3):** Login, GetMe, GetUsers, GetUser, GetProducts, GetProduct,
GetProductByMachineId, GetComponents, GetComponent, GetTickets, GetTicket,
GetOolTickets, GetLoans, GetLoan, GetServiceRequests, GetServiceRequest,
GetDashboardStats, GetReports, GetActivityLogs, GetComments, GetInterventions,
GetLocations, GetReservations, GetReservation, GetNotices, GetPendingNews.

**Mutations (38 + 6):** CreateUser, UpdateUser, DeleteUser, CreateProduct,
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
- `ChangePassword` verifica la contraseña actual (los mocks devolvian `true` sin
  chequear) y guarda el nuevo hash argon2id.

### Verificacion de selection sets

`bun run scripts/check-frontend-docs.ts` recorre `src/`, extrae todos los documentos
GraphQL y los valida contra el SDL servido. Corrida del 2026-10-19 sobre esta rama:
125 documentos, 62 operaciones, 0 errores. Los otros dos nombres del contrato (`GetMe`,
`GetProductByMachineId`) estan implementados pero hoy no aparecen como plantilla en `src/`.

## CRUD y bajas logicas

Ninguna fila se borra: `users` se da de baja con `is_active = false` y
`locations`, `products`, `components`, `tickets`, `loans`, `service_requests`,
`interventions` y `comments` con `deleted_at`. La API deja de mostrar la fila dada de
baja (no aparece en listas, reportes ni por id), pero la fila sigue en la base, su id
**no se reutiliza** (`nextId` la cuenta) y la baja queda en la auditoria.
Reglas de quien puede dar de baja y cuando:

| Operacion | Quien | No se puede si |
| --- | --- | --- |
| `softDeleteTicket` | admin; el dueño si esta pendiente y sin tomar | (admin: siempre) |
| `softDeleteLoan` | admin; el dueño si esta pendiente | esta entregado o vencido (primero se devuelve) |
| `softDeleteServiceRequest` | admin; el dueño si esta pendiente y sin tomar | esta en curso (`in_progress`) |
| `softDeleteIntervention` | admin; el tecnico autor | |
| `softDeleteComment` | admin; el autor | |

`reservations` se "elimina" con `cancelReservation` (estado `cancelled`), `notices` con
`acknowledgeNotice` (borrado fisico: es un aviso efimero) y `loan_components` solo se
escribe dentro de `createLoan`. Los comentarios no tienen edicion por diseño: una
correccion es una baja mas un comentario nuevo.

## Auditoria

Cada mutation inserta una fila en `activity_logs` (`id`, `user_id`, `user_name`,
`operation`, `entity`, `entity_id`, `timestamp`, `details`) **dentro de la misma
transaccion** que la escritura: si la mutation falla no queda traza ni cambios; si
tiene exito quedan los dos. `operation` es el nombre de la mutation en mayusculas
(`CREATE_TICKET`, `SOFT_DELETE_LOAN`...), `entity` la entidad (`Ticket`, `Loan`,
`Session`...) y `details` un texto corto sin datos sensibles (por ejemplo los nombres
de los campos cambiados, nunca los valores ni contraseñas). Ademas:

- `LOGIN`, `LOGIN_FAILED`, `ACCOUNT_LOCKED` (en el login, fuera de transaccion).
- `<OPERACION>_DENIED` cuando un usuario autenticado intenta una mutation sin permiso
  (queda registrada aunque la operacion haga rollback).
- El mapa `AUDIT` de `api/src/graphql/resolvers.ts` esta tipado por
  `keyof typeof Mutation`: una mutation nueva sin su fila de auditoria no compila.

La consulta `activityLogs` lee la tabla directo, con filtros parametrizados
(`userId`, `operation`, `startDate`, `endDate`), mas nuevos primero y tope de 1000
filas. Las filas solo se insertan: ninguna operacion de la API las modifica ni borra.

## Transacciones y concurrencia

- Cada mutation corre en **una transaccion** (`api/src/graphql/wrap.ts`, `db/client.ts`):
  `createLoan` (loans + loan_components), `deliverLoan` y `returnLoan` (loans + products
  + avisos), `updateLocation` (locations + products), todas las que notifican, y la fila
  de auditoria, o se confirman juntas o no queda nada. La transaccion activa viaja en un
  `AsyncLocalStorage`: los resolvers siguen usando `db` y este apunta a la transaccion.
- Las mutations se **serializan** con `pg_advisory_xact_lock` (un solo escritor a la vez,
  tambien entre los dos slots del deploy porque el lock es de la base) y el estado se
  recarga ya con el lock tomado. Con eso `nextId` (maximo + 1) no puede entregar el mismo
  id a dos requests concurrentes y las validaciones ("el equipo ya esta comprometido")
  ven la mutation anterior. Costo: las escrituras no corren en paralelo; para el tamaño
  de este sistema es aceptable. No se uso una secuencia de PostgreSQL porque los ids
  tienen prefijo y formato (`tkt-016`) y los del seed ya ocupan numeros.
- Las queries cargan la foto del estado una vez por request (no hay lock). Lecturas que
  actualizan estado derivado (`overdue`, reservas) siguen siendo escrituras sueltas.

## Seguridad de datos

- Consultas preparadas: todo el acceso a datos pasa por Drizzle sobre `pg`, que envia
  sentencias parametrizadas (`$1`, `$2`...). No hay SQL armado con entrada del usuario;
  las unicas cadenas SQL son constantes (`select 1`, el lock, los CHECK de la migracion,
  construidos solo con las listas de `enums.ts`).
- Ningun mensaje de error devuelve texto del motor de base de datos ni trazas.
- GraphiQL e introspeccion cerrados con `NODE_ENV=production`.
- Cuerpo maximo de 1 MB; contraseña de hasta 512 caracteres para verificar.
- Las contraseñas se guardan con argon2id (parametros por defecto de `Bun.password`).

## Cuentas de prueba

Los hashes argon2id se generan en el seed a partir de los passwords de
`src/mocks/data/users.ts`. Password compartido de prueba: `root2026`. Son cuentas
de desarrollo: un entorno publicado no debe cargar este seed (ver "Limitaciones y
pendientes").

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
  drizzle/                 migraciones SQL (0001 a 0004) y meta; se commitean
  scripts/
    check-frontend-docs.ts valida los documentos GraphQL de src/
    preflight-integrity.ts busca filas que violarian las FK/CHECK antes de migrar
  src/
    index.ts               Elysia: /graphql, /api/v1, /health, /ready
    env.ts                 carga de entorno (DB_*, AUTH_SECRET, HOST, PORT, TRUST_PROXY)
    auth.ts                firma/verificacion de JWT (jose, HS256, 8 h, jti)
    sessions.ts            tokens revocados (logout)
    login-guard.ts         bloqueo por intentos fallidos (en memoria)
    net.ts                 IP del cliente (respeta TRUST_PROXY)
    cors.ts                CORS con lista de origenes (CORS_ORIGINS)
    security-headers.ts    cabeceras de seguridad de toda respuesta
    errors.ts              catalogo de errores (code, status) y clasificacion de errores inesperados
    audit.ts               escritura de activity_logs dentro de la transaccion
    context.ts             contexto por pedido (usuario autenticado, IP)
    state.ts               carga la base (sin filas dadas de baja) y arma los objetos del dominio
    graphql/schema.ts      SDL (contrato del frontend)
    graphql/resolvers.ts   queries y mutations (espejo de src/mocks/handlers.ts)
    graphql/limits.ts      limites de profundidad, campos raiz y alias por operacion
    graphql/privacy.ts     dni/email de User visibles solo con relacion (protocolo 8.1)
    graphql/wrap.ts        withState (queries) y withTransaction (mutations, auditoria, rollback)
    graphql/server.ts      configuracion de Yoga (maskedErrors, graphiql, codigos para errores de graphql-js)
    rest/routes.ts         tabla de rutas /api/v1 y su operacion GraphQL
    rest/adapter.ts        compila cada ruta a un documento GraphQL y arma el envelope
    rest/plugin.ts         plugin de Elysia que monta las rutas
    lib/                   types/constants/validation compartidos (copia de src/lib)
    db/schema.ts           tablas de Drizzle (FK, CHECK, deleted_at)
    db/enums.ts            estados y roles validos (fuente de los CHECK)
    db/client.ts           pool de pg + drizzle; `db` que se redirige a la transaccion activa
    db/seed.ts             carga del dataset de ejemplo
    db/fixtures/           dataset del branch dev (copia de src/mocks/data)
    **/*.test.ts           pruebas unitarias y de integracion (`cd api && bun test`)
tests/
  cases/                   casos de QA por CU, RNF, REST y seguridad (`bun run qa:api`)
  security/run.ts          runner de ataques de Ciberseguridad (`bun tests/security/run.ts --target ...`)
  lib/api.ts               clientes GraphQL y REST para los casos
```

## Limitaciones y pendientes

- El bloqueo por intentos fallidos y la revocacion de tokens por logout viven en
  memoria y en la tabla `revoked_tokens` respectivamente. El contador de intentos se
  pierde al reiniciar el proceso y no se comparte entre instancias (blue/green mantiene
  una sola activa a la vez, pero un reinicio libera los bloqueos). Para varias
  instancias haria falta moverlo a la base o a Redis.
- La serializacion de mutaciones usa un unico advisory lock global. Es correcta y
  simple para la carga del proyecto, pero limita el throughput de escrituras a una
  mutacion por vez.
- El estado del dominio se recarga completo dentro de cada mutacion. Es aceptable con
  el dataset actual; no escala a decenas de miles de filas.
- Las claves foraneas usan `ON DELETE NO ACTION`: no hay borrado fisico en la API, las
  bajas son logicas. Un borrado fisico manual de un registro referenciado falla.
- Las rutas REST se generan desde el SDL con profundidad 2 en el selection set; los
  campos mas anidados se piden por GraphQL.
- No hay rate limit general (solo el de login), ni refresh token: al vencer las 8 h hay
  que volver a iniciar sesion.
- Sin limite de tasa general: solo el bloqueo de login y el tope de forma/tamano de cada
  request. Un limite por IP (`limit_req` de nginx) es la capa adecuada y depende de
  umbrales que decide el equipo; el runner de seguridad lo sigue marcando parcial (AT-07).
- Las intervenciones y los comentarios no tienen aun la regla de "no tocar lo de otro
  tecnico": cualquier tecnico puede editar una intervencion ajena.
- El almacenamiento de texto es tal cual (no se sanitiza HTML en el servidor): la
  defensa contra XSS es el escape de React y la CSP. El respaldo con `pg_dump` sin cifrar
  (`scripts/backup.sh`) queda fuera de `api/` y sigue marcado vulnerable en AT-08.
- Tras `changePassword` la sesion actual tambien se invalida; el frontend tiene que
  llevar a la pantalla de login (pendiente en `src/`).
- La rubrica de Programacion habla de PHP; el stack real es Bun + Elysia (ADR-002).
  La equivalencia esta documentada arriba.

## Notas de integracion

- Nginx ya proxea `https://dev.eternum.lat/graphql` al slot activo; el backend
  escucha en `127.0.0.1:$PORT` y el deploy blue/green usa `/ready` antes de mover
  el trafico. Para exponer REST hay que proxear tambien `/api/v1`.
- Con `NODE_ENV=production` GraphiQL queda deshabilitado.
- Esta _branch_ de backend reemplaza a los mocks; para usarla se sirve la API real
  en lugar de MSW. No modifica `src/`.
