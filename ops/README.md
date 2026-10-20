# Despliegue con contenedores (Podman)

El stack de Lux se define en un solo `compose.yaml` (Compose Specification) y
corre con Podman rootless. El mismo archivo valida con `docker compose config`,
así que la exigencia de ASO ("docker-compose, aplicación + base de datos") se
cumple con el archivo, no con el motor.

## Módulos y redes

Un contenedor por módulo:

| Servicio | Imagen | Función | Redes | Publica |
|---|---|---|---|---|
| `db` | `postgres:17-trixie` | PostgreSQL, volumen `lux_pgdata` | `lux_data` | nada |
| `migrate` | `lux-api` | `drizzle-kit migrate`, una vez por despliegue | `lux_data` | nada |
| `api` | `lux-api` (Bun, solo lectura) | GraphQL + REST `/api/v1`, 1 a 4 réplicas | `lux_data`, `lux_app` | nada |
| `web` | `lux-web` (nginx sin privilegios) | SPA + proxy a `api` | `lux_app`, `lux_edge` | `127.0.0.1:${LUX_WEB_PORT}` |

```
Internet --> Nginx del host (TLS, 80/443) --> 127.0.0.1:8080 --> web
                                                                  |  lux_app (interna)
                                                                  v
                                                                 api
                                                                  |  lux_data (interna)
                                                                  v
                                                                  db
```

`lux_data` y `lux_app` son `internal: true`: sin gateway, sin salida a Internet.
`web` no pertenece a `lux_data`, así que no tiene ruta hacia la base aunque
quedara comprometido. La única red con salida es `lux_edge`, y solo `web` está en ella.

## Flujo de despliegue

```bash
# 1. Variables (fuera del repo, modo 600). Ver env/lux.env.example.
sudo install -d -m 750 /etc/sgrsi && sudo cp ops/env/lux.env.example /etc/sgrsi/lux.env
# completar [COMPLETAR] con: openssl rand -base64 32

# 2. Levantar (como la cuenta rootless "sgrsi"). Construye, migra, espera /ready
#    y, si no responde, vuelve a las imagenes "previous".
scripts/admin.sh deploy up

# 3. Verificar que las redes hacen lo que dice el YAML
ops/verificar-redes.sh

# 4. Operar
scripts/admin.sh deploy estado | logs api 50 | escalar 2 | rollback | down
scripts/admin.sh deploy unidad          # arranque automatico con systemd (linger)
```

Equivalente crudo: `podman compose --env-file /etc/sgrsi/lux.env -f ops/compose.yaml up -d --build`.

## Qué verifica `verificar-redes.sh`

Sobre el stack en ejecución: `api -> db` alcanza; `web -> api` alcanza;
`web -> db` no; `db` y `api` no salen a Internet; `db` y `api` no publican
puertos; `web` publica solo en loopback. Sale con 1 si algo difiere. Sirve como
captura de evidencia para la carpeta de ASO.

## Si cambian las redes

`podman-compose down` no borra las redes, así que al renombrar una quedan
huérfanas: `podman network ls` y `podman network rm <red>` (con el stack abajo).

La evaluación completa (pros, contras, Podman vs Docker, Quadlet) está en
`docs/EVALUACION-CONTENEDORES.md`.
