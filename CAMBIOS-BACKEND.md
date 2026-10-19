# Cambios del backend (3ra entrega)

> Nota: texto base generado con asistencia de IA a partir del historial de git y de las
> corridas de prueba de esta rama. El equipo debe revisarlo y reescribirlo antes de citarlo
> en documentos de la entrega. Los conteos de pruebas son los de la corrida real descrita
> al final; si el codigo cambia, hay que volver a correrlas.

Rama local `wt/backend` (base `origin/dev` 797f829). Solo se tocaron `api/`, `tests/` y
`docs/BACKEND.md`. No se modifico `src/` ni `.env.production`. El contrato de 64
operaciones GraphQL del frontend no cambio; todo lo nuevo es aditivo salvo `User.dni` y
`User.email`, que pasaron de `String!` a `String` (ver ronda 2, punto 4).

## Commits

| Commit | Contenido |
|---|---|
| 831d605 | catalogo de errores, `maskedErrors`, `/ready` sin detalles |
| f85d807 | transaccion y auditoria en toda mutacion |
| 671a9ef | bajas logicas |
| 757f71a | token de 8 h, bloqueo por intentos, logout con revocacion |
| deaed29 | rutas REST `/api/v1` |
| ceb100c | FK y CHECK (migracion 0003) |
| 66645a9 | servidor GraphQL testeable y script de preflight |
| cdd97b9 | `docs/BACKEND.md` y nota de casos de QA |
| ecff55d | este archivo (ronda 1) |
| 83b5de0 | ronda 2, punto 1: CORS con lista de origenes |
| af1f52c | ronda 2, punto 2: limites de profundidad, alias, campos raiz y body |
| ce64422 | ronda 2, punto 3: `deleteUser` no permite autodesactivarse |
| 41a12ff | ronda 2, punto 4: dni y email solo con relacion |
| aedecbe | ronda 2, punto 5: no se toca el trabajo de otro tecnico |
| 206f795 | ronda 2, punto 6: `changePassword` invalida sesiones (migracion 0004) |
| 2f31c3d | ronda 2, punto 7: bloqueo de login con el mensaje generico |
| 9ceedba | ronda 2, punto 8: cabeceras de seguridad |
| 511c8b4 | ronda 2: correccion de tres chequeos del runner de seguridad |
| 9a7f9f0 | ronda 2: `docs/BACKEND.md` |

## Por punto

### 1. REST `/api/v1`

Hecho:
- 73 rutas con GET, POST, PUT y DELETE sobre usuarios, productos, componentes, ubicaciones, incidencias, prestamos, reservas, solicitudes de servicio, intervenciones, comentarios, avisos, auditoria, reportes, tablero y sesion (la lista exacta esta en `docs/BACKEND.md`).
- Envelope `{status, message, data}` con codigo HTTP real (200, 201, 400, 401, 403, 404, 405 con `Allow`, 409, 422, 429, 500).
- Adaptador fino: cada ruta se compila desde el SDL a un documento GraphQL y se ejecuta con graphql-js contra los mismos resolvers (mismos permisos, validaciones y auditoria que GraphQL).
- Tabla de rutas con roles en `docs/BACKEND.md`.
- Pruebas: `api/src/rest/adapter.test.ts` y casos CP-REST-01 a 05.

No hecho / pendiente: los campos anidados mas alla de profundidad 2 en el selection set de REST se piden por GraphQL.

### 2. Errores y exposicion

Hecho:
- Catalogo: BAD_REQUEST 400, UNAUTHENTICATED 401, INVALID_CREDENTIALS 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409, VALIDATION_ERROR 422, TOO_MANY_ATTEMPTS 429, INTERNAL_ERROR 500, en `extensions.code` y `extensions.status`. GraphQL sigue respondiendo 200 con el status en la extension; REST usa el codigo HTTP real.
- Errores de graphql-js (query o variables invalidas) pasan a BAD_REQUEST; los inesperados salen como INTERNAL_ERROR sin texto de la base; las violaciones de restriccion de PostgreSQL se traducen a 409/422.
- GraphiQL e introspeccion solo fuera de produccion (`NODE_ENV`).
- `/ready` devuelve 200 o 503 sin describir la causa (queda en el log).
- Pruebas: `errors.test.ts`, `graphql/server.test.ts`, CP-RNF-06, 07, 08.

### 3. Baja logica y auditoria

Hecho:
- `softDeleteTicket`, `softDeleteLoan`, `softDeleteServiceRequest`, `softDeleteIntervention`, `softDeleteComment` (columna `deleted_at`, migracion 0001). Las filas dadas de baja no aparecen en queries y siguen en la base; sus ids no se reutilizan.
- Regla: no se da de baja un prestamo en curso.
- Auditoria en toda mutacion, en la misma transaccion que el cambio. Un intento sin permiso deja `<OP>_DENIED`.
- Se quito `knownGap` de CP-R-01 (toda escritura deja traza). Hay casos nuevos CP-R-02, 03, 04 y CP-RNF-10 a 13.

No hecho: otras reglas de negocio marcadas `knownGap` (ver "Fallas conocidas que quedan"); no estaban en el alcance.

### 4. Transacciones

Hecho:
- Toda mutacion corre en una transaccion (`withTransaction`): el cambio y su fila de auditoria se confirman o se revierten juntos. Si falla, no queda traza ni cambios (CP-R-04, `db/transaction.test.ts`).
- Un advisory lock global serializa mutaciones y el estado se recarga dentro del lock, lo que ademas elimina la carrera de `nextId` (CP-RNF-09, altas concurrentes sin ids repetidos).

Limitacion: una sola mutacion a la vez; recarga completa del dominio por mutacion. Documentado en "Limitaciones y pendientes".

### 5. Autenticacion

Hecho:
- Token de 8 h con `jti`.
- Bloqueo: 5 fallos por DNI y 50 por IP en ventana de 15 minutos, 429 con `retryAfterSeconds`. Contadores en memoria (se pierden al reiniciar y no se comparten entre instancias). IP del cliente con `TRUST_PROXY=1` detras de nginx.
- Ecualizacion de tiempos entre DNI inexistente y contrasena incorrecta, mismo mensaje.
- `logout` revoca el token (tabla `revoked_tokens`, migracion 0002) y deja traza de auditoria.
- `nextId` sin colisiones (ver punto 4).
- Pruebas: `login-guard.test.ts`, CP-01-04, CP-02-02, CP-27-03, CP-REST-04.

Pendiente: expiracion por inactividad configurable (CP-27-02 sigue como `knownGap`: el token vence a las 8 h fijas); no hay refresh token.

### 6. FK y CHECK

Hecho:
- Migracion 0003: 26 claves foraneas (`ON DELETE NO ACTION`) y 16 CHECK de estados y roles, generados desde `db/enums.ts` con una guarda de exhaustividad de tipos.
- Aplicada sobre una base con datos acumulados de QA y sobre una base nueva con seed, sin revertir nada. `api/scripts/preflight-integrity.ts` lista filas que violarian las restricciones antes de migrar.
- Pruebas: `db/constraints.test.ts`, CP-RNF-14.

Pendiente: los nombres de restriccion los genera drizzle-kit; no se revisaron uno por uno contra el modelo de datos de Base de Datos E3.

## Ronda 2: seguridad (runner de ataques de Ciberseguridad)

El runner `tests/security/run.ts` (traido con `git merge wt/cib`, solo agrega `tests/security/`)
marcaba 7 ataques vulnerables sobre la API de la ronda 1. Cada punto lleva prueba en
`tests/cases/security.ts` (CP-SEG-01 a 06) o en `api/src/`.

| Punto | Que se hizo | Prueba |
|---|---|---|
| 1. CORS | `CORS_ORIGINS` (default: lux, dev y vite local); Yoga ya no refleja el `Origin`; preflight ajeno 403 | `cors.test.ts`, `server.test.ts`, CP-SEG-06 |
| 2. Introspeccion, alias, body | introspeccion y GraphiQL ya estaban cerrados con `NODE_ENV=production` (queda con prueba); limites de 10 niveles, 12 campos raiz, 3 repeticiones y 1 `login` por request; body de 256 KiB (HTTP 413) | `limits.test.ts`, `server.test.ts`, CP-SEG-06 |
| 3. `deleteUser` | reusa `activationError` (las reglas de `canToggleUserActive`) | CP-SEG-01 |
| 4. dni y email | resolvers de campo en `graphql/privacy.ts`: admin todo, tecnico solo relacionados (tickets y solicitudes asignados, prestamos entregados o aprobados), cada uno lo propio; el resto `null`. `dni` y `email` pasan a nullable en el SDL (frontend: `UserSearchSelect` ya tolera `dni` ausente; `UserManagement` es solo de admin) | CP-SEG-02 |
| 5. Trabajo de otro tecnico | `updateTicket`, `changeTicketStatus`, `completeTicket`, `assignTicket`, `updateServiceRequest` y `assignServiceRequest` dan `FORBIDDEN` si lo asignado es de otro tecnico (admin exceptuado). Lo sin asignar se reclama: `claim*` o `updateServiceRequest` con `in_progress` o `completed`. Documentado en `docs/BACKEND.md` | CP-SEG-03 |
| 6. `changePassword` | columna `users.token_version` (migracion 0004) y claim `ver` en el JWT; el cambio de contrasena (y el reset de un admin) sube la version y corta todas las sesiones, la actual incluida | CP-SEG-04 |
| 7. Login generico | el bloqueo responde con el mismo texto "Credenciales inválidas"; se distingue por `code` TOO_MANY_ATTEMPTS, status 429 y `Retry-After` en REST; vale igual para documentos inexistentes | CP-SEG-05 |
| 8. Cabeceras | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'`, HSTS con `TRUST_PROXY=1` | `security-headers.test.ts`, CP-SEG-06 |

### Antes y despues del runner (`bun tests/security/run.ts --target http://127.0.0.1:4112`, `NODE_ENV=production`)

Antes (codigo de la ronda 1, base `lux_backend` con datos acumulados):

```
1 resisten · 7 vulnerables · 1 parciales · 0 no ejecutables en este entorno
PASS AT-02 ; FAIL AT-01, AT-03, AT-04, AT-05, AT-06, AT-08, AT-09 ; PARCIAL AT-07
```

Despues (base `lux_backend` re-sembrada con `bun run db:seed`, API reiniciada antes de la corrida):

```
PASS    AT-01  Fuerza bruta y credential stuffing sobre login
PASS    AT-02  Inyección SQL y GraphQL
PASS    AT-03  Abuso de GraphQL: introspección y batching por alias
PARCIAL AT-04  Manipulación de JWT y reutilización de sesión
PARCIAL AT-05  XSS almacenado
PASS    AT-06  IDOR, BOLA y escalada de privilegios
PARCIAL AT-07  DoS sobre /graphql
FAIL    AT-08  Compromiso de datos: respaldo y detección
PASS    AT-09  CORS (transversal)
5 resisten · 1 vulnerables · 3 parciales · 0 no ejecutables en este entorno
```

Aclaraciones para no sobreestimar el resultado:

- Re-sembrar la base fue necesario porque el chequeo "los fallos de login quedan en activity_logs" compara
  `activityLogs { id }`, que la API topa en 1000 filas; con la base acumulada de QA daba 1000 antes y 1000 despues
  aunque `LOGIN_FAILED` se escribe (CP-R-02 lo prueba). Es un artefacto de la medicion, no del control.
- Se corrigieron tres chequeos del runner (commit 511c8b4) porque median algo distinto del control: AT-06 contaba
  filas devueltas en vez de dni/email visibles; AT-04 (e) tomaba `{data:{me:null}}` como sesion valida (el chequeo (f)
  del mismo runner ya leia `me`); y AT-03 no tenia estado pass para un request rechazado entero. Corriendo el runner
  **original** (2597091) sobre el mismo codigo y base re-sembrada: 3 resisten, 3 vulnerables (AT-04 e, AT-06 lista de
  usuarios, AT-08), 3 parciales. Las dos primeras son las que se corrigieron en la medicion; el agente de
  Ciberseguridad debe llevarse ese cambio a `wt/cib`.
- Lo que queda, y por que:
  - AT-04 parcial: "token firmado con el AUTH_SECRET real" nunca puede ser pass en este runner (es el supuesto de
    secreto filtrado); el servidor igual lo rechaza porque ese token no trae `jti`. Control: gestion del secreto.
  - AT-05 parcial: el servidor guarda el texto tal cual y la defensa es el escape de React; la CSP ahora existe.
    Sanitizar HTML en el servidor corromperia datos legitimos.
  - AT-07 parcial: no hay limite de tasa general. Lo correcto es `limit_req` en nginx; los umbrales los decide el
    equipo. El tope de body (413) y de forma de operacion ya estan.
  - AT-08 vulnerable: el respaldo `pg_dump | gzip` sin cifrar es de `scripts/backup.sh`, fuera de `api/` y de este rol.

## Fallas conocidas que quedan (7 xfail, antes 10)

Son reglas de negocio que los mocks tampoco cumplian y que no estaban en el alcance de esta tarea:
CP-03-02 y CP-03-03 (validacion de largo y ubicacion en incidencias), CP-05-03 (mensaje al pedir un equipo dado de baja), CP-19-03 y CP-19-04 (autorizacion de prestamos), CP-20-03 y CP-20-04 (cierre y transiciones de solicitudes de servicio). Siguen ademas como `knownGap` los casos de exportacion PDF/XLSX, afectacion (CU-23), comprobante PDF, i18n e inactividad (esos casos no aparecen entre los 7 xfail de la corrida de API, es decir que no se ejecutan en `qa:api`).

## Conflictos de rubrica y stack

La rubrica de Programacion/FS habla de PHP y MariaDB; el stack real es Bun + Elysia + PostgreSQL (ADR-002). La equivalencia esta escrita al principio de `docs/BACKEND.md`. No se resolvio el conflicto de fondo.

## Verificacion real (2026-10-19, tras la ronda 2)

Con la API levantada en `http://127.0.0.1:4112` sobre `lux_backend` (migraciones 0001 a 0004 aplicadas al arrancar,
`NODE_ENV=production`) y `DATABASE_URL` exportada para las pruebas que usan la base:

| Comando | Resultado |
|---|---|
| `bun run typecheck` (raiz) | sin errores |
| `bun test` (raiz) | 242 pass, 0 fail, 24 archivos |
| `cd api && bun run typecheck` | sin errores |
| `cd api && bun test` | 72 pass, 0 fail, 9 archivos |
| `cd api && bun run scripts/check-frontend-docs.ts` | 125 documentos del frontend, 0 errores de validacion |
| `bun run qa:api --target http://127.0.0.1:4112` | 92 pasan, 0 fallan, 7 fallas conocidas, 0 xpass, 0 errores de entorno (99 casos; baseline original: 65 pass, 10 xfail) |
| `bun tests/security/run.ts --target http://127.0.0.1:4112` | 5 resisten, 1 vulnerable, 3 parciales (ver ronda 2) |

Sin `DATABASE_URL` en el entorno, `bun test` marca 9 pruebas como `skip` (las de base de datos): los 242 y 72 de arriba son con la variable.

## Pendiente de Faku

- Decidir si se agrega `/api/v1` al proxy de nginx del servidor real (hoy solo `/graphql`).
- Definir `AUTH_SECRET`, `NODE_ENV=production` y `TRUST_PROXY=1` en el entorno de produccion; no se tocaron.
- Aplicar las migraciones 0001 a 0004 en la base real (correr antes `api/scripts/preflight-integrity.ts`).
- Decidir si el bloqueo por intentos fallidos debe persistir entre reinicios o instancias (hoy en memoria).
- Revisar y reescribir este texto y `docs/BACKEND.md` con palabras del equipo.
- Definir `CORS_ORIGINS` en produccion si el frontend se sirve desde un origen distinto de los del default.
- En `src/`: tras `changePassword` llevar a la pantalla de login (la sesion actual deja de valer), llamar a `logout` al cerrar sesion, y mostrar un aviso propio cuando el login devuelva `code: TOO_MANY_ATTEMPTS` (el texto del bloqueo ya no lo distingue). No se toco `src/`.
- Decidir los umbrales de `limit_req` en nginx (no hay limite de tasa general) y si el respaldo se cifra (`scripts/backup.sh`).
- Decidir si tambien se aplica la regla "no tocar lo de otro tecnico" a intervenciones y comentarios.
