# Cambios del backend (3ra entrega)

> Nota: texto base generado con asistencia de IA a partir del historial de git y de las
> corridas de prueba de esta rama. El equipo debe revisarlo y reescribirlo antes de citarlo
> en documentos de la entrega. Los conteos de pruebas son los de la corrida real descrita
> al final; si el codigo cambia, hay que volver a correrlas.

Rama local `wt/backend` (base `origin/dev` 797f829). Solo se tocaron `api/`, `tests/` y
`docs/BACKEND.md`. No se modifico `src/` ni `.env.production`. El contrato de 64
operaciones GraphQL del frontend no cambio; todo lo nuevo es aditivo.

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

## Fallas conocidas que quedan (7 xfail, antes 10)

Son reglas de negocio que los mocks tampoco cumplian y que no estaban en el alcance de esta tarea:
CP-03-02 y CP-03-03 (validacion de largo y ubicacion en incidencias), CP-05-03 (mensaje al pedir un equipo dado de baja), CP-19-03 y CP-19-04 (autorizacion de prestamos), CP-20-03 y CP-20-04 (cierre y transiciones de solicitudes de servicio). Siguen ademas como `knownGap` los casos de exportacion PDF/XLSX, afectacion (CU-23), comprobante PDF, i18n e inactividad (esos casos no aparecen entre los 7 xfail de la corrida de API, es decir que no se ejecutan en `qa:api`).

## Conflictos de rubrica y stack

La rubrica de Programacion/FS habla de PHP y MariaDB; el stack real es Bun + Elysia + PostgreSQL (ADR-002). La equivalencia esta escrita al principio de `docs/BACKEND.md`. No se resolvio el conflicto de fondo.

## Verificacion real (2026-10-19)

Con la API levantada en `http://127.0.0.1:4112` sobre `lux_backend` (migraciones aplicadas al arrancar):

| Comando | Resultado |
|---|---|
| `bun run typecheck` (raiz) | sin errores |
| `bun test` (raiz) | 219 pass, 0 fail, 21 archivos |
| `cd api && bun run typecheck` | sin errores |
| `cd api && bun test` | 49 pass, 0 fail, 6 archivos |
| `bun run qa:api --target http://127.0.0.1:4112` | 86 pasan, 0 fallan, 7 fallas conocidas, 0 xpass, 0 errores de entorno (baseline: 65 pass, 10 xfail). Corrida repetida dos veces seguidas con el mismo resultado |

## Pendiente de Faku

- Decidir si se agrega `/api/v1` al proxy de nginx del servidor real (hoy solo `/graphql`).
- Definir `AUTH_SECRET`, `NODE_ENV=production` y `TRUST_PROXY=1` en el entorno de produccion; no se tocaron.
- Aplicar las migraciones 0001 a 0003 en la base real (correr antes `api/scripts/preflight-integrity.ts`).
- Decidir si el bloqueo por intentos fallidos debe persistir entre reinicios o instancias (hoy en memoria).
- Revisar y reescribir este texto y `docs/BACKEND.md` con palabras del equipo.
