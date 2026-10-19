# Suite de QA

Los casos de prueba se escriben una sola vez en `tests/cases/` y de esa fuente salen la ejecución automática, la matriz CU → RF → CP y el documento de testing de la entrega. Mismo ID (`CP-<CU>-<n>`) en los tres lugares.

## Niveles

| Nivel | Comando | Costo | Qué hace |
|---|---|---|---|
| 1. API | `bun run qa:api` | 0 | Ejecuta la verificación determinística de cada caso contra la API GraphQL real |
| 2. Interfaz | `bun run qa:agent` | Menos de USD 0,10 por corrida completa | Un agente maneja el navegador (Playwright) para cumplir el objetivo del caso |
| 3. Triage | `bun run qa:triage` | 0 | Escribe borradores de issues para fallas en `tests/out/issues/`; no publica nada |
| Documento | `bun run qa:doc` | 0 | Genera el markdown de casos, trazabilidad, tablas de decisión y resultados |

## Correr

```bash
bun run qa:api --target https://dev.eternum.lat
bun run qa:api --only CP-03          # un CU o un caso
bun run qa:agent --list              # objetivos de interfaz
bun run qa:agent --target https://dev.eternum.lat --provider deepseek
```

El nivel 2 necesita un build **sin mocks** (con la API real detrás de `/graphql`): los casos con `setup` crean sus datos por API. Local: `VITE_ENABLE_MOCKS=false bunx vite build`, servir `dist/` y reenviar `/graphql`. Una vez: `bunx playwright install chromium`.

## Credenciales y claves

- Las cuentas salen del seed del repo (`api/src/db/fixtures/data/users.ts`). En otro entorno: `QA_DNI_<ROL>` y `QA_PASSWORD_<ROL>` (`ROOT_ADMIN`, `ADMIN`, `TECNICO`, `SOLICITANTE`).
- Agente: `ANTHROPIC_API_KEY` (Claude Haiku 5.5, `claude-haiku-5-5`) o `DEEPSEEK_API_KEY` (`deepseek-chat`). Sin `--provider` usa Anthropic si hay clave y si no DeepSeek. Nunca se escriben en el repo.
- `QA_MAX_USD` (0,50 por defecto) corta la corrida al superar el gasto estimado. `QA_MODEL`, `QA_PRICE_IN` y `QA_PRICE_OUT` ajustan modelo y tarifa.

## Resultados

`pass`, `fail`, `xfail`, `xpass` y `error`. Un caso con `knownGap` que falla es `xfail` (desvío registrado, no rompe el pipeline); si empieza a pasar es `xpass` y la corrida falla para que se quite la marca. Código de salida distinto de cero con `fail`, `error` o `xpass`.

## Agregar un caso

1. Agregarlo al archivo de su caso de uso en `tests/cases/` con RF, pasos y resultado esperado.
2. `api`: función que lanza `AssertionError` (vía `check`) si el sistema se comporta distinto. `ui`: objetivo y criterio de éxito en lenguaje natural; `setup` para crear la precondición y `expect` para un control determinístico de lo que se ve.
3. Si hoy el sistema no cumple, marcar `knownGap` con la diferencia.
4. `bun run qa:typecheck` y `bun run qa:doc --into <Testing.md>` para regenerar el documento.

Los casos destructivos tienen que restaurar lo que tocan (ver CP-25-02): la suite corre sobre una base persistente.

## Casos de API agregados en la 3ra entrega

- `tests/cases/api.ts` (CP-RNF-06 a 09 y 14, CP-R-02 a 04): catalogo de errores, 401/403, bajas logicas, auditoria.
- `tests/cases/crud.ts` (CP-RNF-10 a 13): altas, cambios y bajas con verificacion de la fila y del registro de auditoria.
- `tests/cases/rest.ts` (CP-REST-01 a 05): rutas `/api/v1`, envelope y codigos HTTP reales.
- Los casos de login fallido consumen el umbral de bloqueo (5 por DNI, 50 por IP en 15 minutos): usan DNI inexistentes o repartidos para no bloquear las cuentas del seed. Si una corrida se repite muchas veces seguidas contra el mismo proceso, reiniciar la API libera los contadores.
