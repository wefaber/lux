# Deploy de Lux

Los dos deploys de Lux son scripts blue/green versionados acá. **Lo que se
mergea es lo que corre**: los workflows no ejecutan nada fuera del repo.

| archivo | sitio | workflow | slot vivo |
|---|---|---|---|
| `lux-dev.sh` | https://dev.eternum.lat (rama `dev`) | `.github/workflows/deploy-dev.yml` | `/srv/lux-dev`, API `:4111` / `:4112` |
| `lux-prod.sh` | https://lux.eternum.lat (rama `main`) | `.github/workflows/deploy.yml` | `/srv/lux-prod`, API `:4211` / `:4212` |
| `lux-dev-banner.py` | cartel de "preview" inyectado en `dist/index.html` de dev | — | — |
| `placeholder/index.html.tpl` | cartel de "sin build" para un slot vacío | — | — |

## Cómo funciona un deploy

1. Se actualiza el **slot idle** (`blue` o `green`, nunca el que sirve tráfico).
2. Build del SPA (`bun install`, `tsc -b && vite build`) y `drizzle-kit migrate`.
3. Se levanta la API del slot y se espera `/ready`.
4. Recién ahí se mueven el symlink `current` y el upstream de nginx (reload atómico).
5. Verificación pública contra el sitio real. Si falla, vuelve solo al slot anterior:
   el slot viejo nunca se apaga, así que el rollback es un switch, no un rebuild.

## Uso manual

```bash
./deploy/lux-dev.sh --status      # slot vivo, salud de los dos slots, upstream
./deploy/lux-dev.sh --rollback    # vuelve al slot anterior (sin build)
./deploy/lux-dev.sh [rama]        # despliega esa rama en el slot idle
```

`lux-prod.sh` acepta lo mismo más `--no-switch` (deja el slot listo sin mover
tráfico).

## Qué NO vive en el repo

Los secretos: `/home/hermes/deploy/env/lux-dev.env`, `lux-api.env`,
`lux-prod.env`, `lux-prod-api.env`, `lux-prod-admin.env`. Se leen de
`${LUX_ENV_DIR:-/home/hermes/deploy/env}`. Tampoco se versiona el vhost de
producción (`/home/hermes/deploy/nginx/lux.eternum.lat`), que el script de prod
restaura desde su backup si el reload falla.

## Regla de verificación

La verificación pública pega contra el borde de Cloudflare, y el borde puede
cortar una conexión (`000`, sin status HTTP) con el sitio sano. Por eso la home
se pide **5 veces**, 3 s aparte, con `-sS` para que el error real de curl quede
en el log: un solo `curl` nunca decide un rollback. La identidad del build
(`BUILD_INFO`) se valida antes, y el estado de MSW se lee del origen, no del
caché del borde.
