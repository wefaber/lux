# Issue Tracker (errores de la app)

Seguimiento de los errores que ocurren en el navegador: se capturan, se agrupan
por huella, se triagean desde `/admin/issues` y se puede abrir un issue en
GitHub con un borrador detallado. El LLM es opcional: sin él se usa una
plantilla local.

## Arquitectura

```
Error no atrapado / promesa rechazada / ErrorBoundary
        │
        ▼
src/lib/error-tracker.ts        dedupe por huella, tope por sesión, saneo
        │  POST /api/v1/errors (keepalive, sin bloquear)
        ▼
api/src/rest/routes.ts → reportError (GraphQL) → upsert por fingerprint
        │
        ▼
error_reports (PostgreSQL)
        │
        ├── /admin/issues: listado, detalle, triage
        └── createGithubIssue: GitHub REST + LLM opcional
```

Decisiones:

- **Sin dependencias nuevas.** `fetch` nativo para el POST, el LLM y GitHub.
- **El cliente no es confiable.** La API valida y vuelve a sanear todo (roles,
  largos, credenciales embebidas) aunque el navegador ya lo haya hecho.
- **Una fila por clase de error.** `fingerprint` es único; cada reaparición
  incrementa `occurrences` y actualiza `last_seen`.
- **Nada de datos personales.** Solo mensaje, stack, ruta (sin query string),
  user-agent y rol. No se envían cuerpos de formulario, contraseñas, tokens ni
  correos (se reemplazan por `<redacted>`, `<token>` y `<email>`).
- **El LLM y GitHub nunca bloquean el resto.** Timeout corto, fallback silencioso
  a la plantilla local y ningún token en respuestas, errores o logs.

## Modelo de datos

`api/src/db/schema.ts` → tabla `error_reports`, migración
`api/drizzle/0005_cute_grey_gargoyle.sql`.

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text PK | `err-<timestamp>-<random>` |
| `fingerprint` | text unique | hash de mensaje + stack normalizado |
| `message` | text | recortado a 1000 caracteres |
| `stack` | text nullable | recortado a 16000 |
| `route` | text | path del navegador, sin query string |
| `user_agent` | text nullable | recortado a 500 |
| `role` | text nullable | `root_admin`/`admin`/`tecnico`/`solicitante`/`anonymous` |
| `first_seen`, `last_seen` | text ISO | ordenables |
| `occurrences` | integer | 1 en el alta, +1 por reaparición |
| `status` | text | `new` / `triaged` / `resolved` (CHECK) |
| `github_issue_url` | text nullable | se completa al crear el issue |
| `created_at`, `updated_at` | text ISO | |

La tabla está en `REQUIRED_TABLES` (`api/src/index.ts`): si falta la migración,
`/ready` responde 503 y el deploy no recibe tráfico.

## Endpoints

### REST (`/api/v1`)

| Método | Ruta | Quién | Qué hace |
| --- | --- | --- | --- |
| `POST` | `/errors` | público | Alta/upsert por huella. Rate limit por IP y validación de tamaño. |
| `GET` | `/error-reports` | admin | Lista con `status`, `search`, `limit`. |
| `GET` | `/error-reports/:id` | admin | Detalle. |
| `GET` | `/error-reports/:id/draft` | admin | Borrador Markdown local. |
| `PUT` | `/error-reports/:id/status` | admin | Cambia el estado (`{"status":"triaged"}`). |
| `POST` | `/error-reports/:id/github-issue` | admin | Crea el issue en GitHub. |
| `GET` | `/error-report-settings` | admin | Integraciones configuradas (sin credenciales). |

El adaptador REST ejecuta las mismas operaciones GraphQL, así que permisos,
validaciones y auditoría son idénticos.

### GraphQL

```graphql
query {
  errorReports(status: "new", search: "inventory", limit: 100) { ... }
  errorReport(id: "err-...") { ... }
  errorReportSettings { githubConfigured llmConfigured repository }
  githubIssueDraft(id: "err-...")
}

mutation {
  reportError(input: { fingerprint, message, stack, route, userAgent, role }) { ... }
  updateErrorReportStatus(id: "err-...", status: "triaged") { ... }
  createGithubIssue(id: "err-...") { url usedLlm alreadyExisted }
}
```

`reportError` es la única operación pública. Las demás exigen `admin` o
`root_admin` (un técnico o solicitante recibe `FORBIDDEN`). El triage y la
creación del issue quedan en `activity_logs`; el reporte público no, para no
inundar la auditoría.

### Límites

- `ERROR_REPORT_RATE_LIMIT` reportes por IP cada
  `ERROR_REPORT_RATE_WINDOW_MINUTES` (default 30 por minuto).
- El frontend manda como máximo 20 reportes por sesión y como mucho uno por
  huella cada 30 s. Los errores de validación/red conocidos no se reportan.
- El cuerpo del request tiene el tope global `MAX_BODY_BYTES` (256 KiB).

## Variables de entorno (API)

Se leen de `LUX_ENV_DIR` (`/home/hermes/deploy/env` por defecto) o del entorno
del proceso. Nunca se commitean.

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `GITHUB_TOKEN` | para crear issues | Token con permiso `issues:write` sobre el repo. |
| `GITHUB_REPO` | para crear issues | `owner/repo`. |
| `LLM_ENDPOINT` | no | URL compatible con chat completions (OpenAI, Ollama, etc.). |
| `LLM_API_KEY` | no | Se manda como `Authorization: Bearer`. |
| `LLM_MODEL` | no | Default `gpt-4o-mini`. |
| `ERROR_REPORT_RATE_LIMIT` | no | Default `30`. |
| `ERROR_REPORT_RATE_WINDOW_MINUTES` | no | Default `1`. |

Sin `GITHUB_TOKEN`/`GITHUB_REPO`, la UI muestra el borrador y explica qué
configurar; el botón de crear issue no aparece. Sin `LLM_ENDPOINT` el borrador
sale de la plantilla local.

## Flujo de creación del issue

1. Un admin abre `/admin/issues`, filtra y entra al detalle.
2. Ve contexto, stack y borrador. Puede copiarlo al portapapeles siempre.
3. Si GitHub está configurado, `createGithubIssue`:
   - arma la plantilla local;
   - si hay `LLM_ENDPOINT`, pide un borrador más detallado (timeout 6 s); si
     falla o responde raro, sigue con la plantilla;
   - crea el issue con `POST https://api.github.com/repos/<repo>/issues`
     (timeout 8 s);
   - guarda `github_issue_url` en la fila.
4. Si el reporte ya tiene issue, la mutación devuelve `alreadyExisted: true` y
   no vuelve a crearlo.

El request al LLM y a GitHub corre fuera de la transacción/`advisory lock`
para no bloquear escrituras mientras se espera a un servicio externo.

## UI

- Ruta `/admin/issues`, ítem “Errores” en el menú del panel admin y tarjeta en
  el inicio del panel (solo `admin`/`root_admin`).
- Listado con huella, mensaje, ruta, ocurrencias, último visto y estado; filtro
  por estado y búsqueda local por mensaje/ruta/huella.
- Detalle en diálogo con contexto, stack, acciones de triage/resolver/reabrir y
  la sección de GitHub (borrador, copiar, crear/abrir issue).
- Responsive: las tablas pasan a tarjetas con `useResponsiveTables`; textos y
  botones se apilan en el teléfono. Los diálogos de Radix manejan foco y
  `Esc`, y los botones tienen `aria-label`.

## Tests

- `src/lib/error-fingerprint.test.ts`: misma huella para el mismo error, distinta
  para otro stack, saneo de tokens/contraseñas/correos y errores esperados.
- `src/mocks/errors.test.ts`: POST + upsert/ocurrencias, saneo, validación,
  permisos (técnico/solicitante), cambio de estado, borrador y creación sin
  credenciales.
- `api/src/issue-tracker.test.ts`: validación/saneo, rate limiter, builder del
  issue con y sin LLM, creación en GitHub (incluido que un fallo no filtre el
  token) y permisos.

## Sentry como alternativa

Si el equipo prefiere Sentry hosted en vez de mantener el tracker:

1. Crear un proyecto Sentry (React) y definir `VITE_SENTRY_DSN`; instalar
   `@sentry/react` (hoy no está en el repo).
2. En `main.tsx`, inicializar Sentry antes de montar React y reemplazar
   `installGlobalErrorTracking()` por `Sentry.init({ dsn, environment, tracesSampleRate })`.
3. En `ErrorBoundary.componentDidCatch`, llamar `Sentry.captureException(error)`.
4. Para el flujo de issues, usar la integración GitHub de Sentry o una regla de
   alerta; el endpoint `POST /api/v1/errors` y la tabla pueden quedar como
   respaldo o eliminarse.
5. Revisar el scrubber de Sentry (`beforeSend`) para seguir sin enviar tokens,
   contraseñas ni cuerpos de formulario.

El resto de este documento (modelo, permisos, UI de triage) no aplica si se
reemplaza por Sentry; la alternativa acordada en el issue era justamente el
tracker sin LLM, que es lo que queda funcionando sin credenciales.
