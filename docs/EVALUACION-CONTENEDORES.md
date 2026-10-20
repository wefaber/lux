# Evaluación: ¿conviene desplegar el SGRSI en contenedores?

Fecha: 20/10/2026. Alcance: `ops/compose.yaml` y `scripts/lib/deploy.sh` sobre Podman.
No se tocó `dev.eternum.lat`, `lux.eternum.lat` ni `.env.production`.

## Veredicto

Sí, para el despliegue del SGRSI (la VM de ASO y la defensa) un deploy basado en
contenedores es una buena elección, con una condición: tratar al `compose.yaml`
como el contrato y a Podman como el motor, no al revés. Razones, en orden de peso:

1. Reproducibilidad: `postgres:17`, `bun:1.4.2` y `nginx:1.28` quedan fijados en versión; la VM de ASO y cualquier otra máquina arrancan idénticas.
2. Aislamiento real y comprobable: tres redes, base sin puertos, API en solo lectura sin capabilities. Se puede demostrar con `ops/verificar-redes.sh`.
3. Rollback barato: las imágenes `previous` permiten volver en segundos, algo que el flujo actual de `lux.eternum.lat` (rsync de archivos estáticos) no tiene.
4. Costo bajo: con el stack arriba (db + 2 réplicas de api + web) el uso de RAM medido fue de unos 90 MB en reposo; el costo real es disco (≈ 710 MB de imágenes propias y de la base) y tiempo de build, no CPU ni memoria.

El deploy actual de producción (GitHub Actions + `generic.sh` + rsync de `dist/`) no usa contenedores y sirve solo el SPA con mocks. Los contenedores no lo reemplazan: son el camino del backend real. Cambiar producción es decisión de Faku y no se tocó.

## Qué se probó

Entorno: Ubuntu 24.04, Podman 4.9.3, podman-compose 1.0.6, netavark/aardvark-dns, ejecutado como root (la sesión no tiene un usuario sin privilegios ni systemd). Producción prevista: Debian 13 con Podman rootless.

| Prueba | Resultado |
|---|---|
| Build `lux-api` y `lux-web` con Podman | OK (15 s y 52 s, con caché de capas de base) |
| `up -d`: db, migrate (sale 0), api, web | OK, `/ready` 200 y `{__typename}` vía `/graphql` |
| Healthchecks (`podman healthcheck run`) | los tres sanos |
| Redes `internal: true` | `api` e `db` sin salida a Internet; DNS interno por nombre funciona |
| Segmentación (`verificar-redes.sh`) | `web -> db` bloqueado; el script falla (exit 1) si se conecta `web` a `lux_data` |
| Escalado a 2 réplicas de `api` | `api` resuelve a 2 IP, `web` reparte |
| `down` + `up` | los datos de PostgreSQL persisten en el volumen |
| `kill -9` del proceso de PostgreSQL | la política `unless-stopped` lo reinició (RestartCount 1) y la API volvió a `/ready` sin intervención |
| `docker compose config` y `podman-compose config` | el mismo archivo valida en ambos |
| `bats scripts/tests/bats/deploy.bats` | 21/21 |

Lo que NO se probó: Podman 5.x rootless en una VM Debian 13, `systemctl --user` con linger, la unidad `lux-stack.service`, y un reinicio del servidor. Es justo lo que la devolución de ASO de E2 pide con capturas, y queda pendiente del hilo de la tercera entrega.

## Cambio incluido

Antes, `db`, `api` y `web` compartían una sola red interna: `web` podía abrir `db:5432` aunque la documentación decía que solo se alcanzaban entre sí. Ahora hay tres redes (`lux_data`, `lux_app`, `lux_edge`) y `web` no ve la base. Detalle en `ops/README.md`.

## Pros

- Sin dependencias en el host: no hay que instalar PostgreSQL, Bun ni nginx a mano ni mantener versiones.
- Rootless: ni el motor ni los procesos corren como root; un escape del contenedor cae en un uid sin privilegios. Docker necesita un daemon con root o configurar su modo rootless aparte.
- Sin daemon: Podman no tiene un servicio central que, si cae, tira todos los contenedores.
- Migraciones como módulo propio (`migrate`) y `/ready` en 503 hasta terminar: el despliegue no queda a medias sin que se note.
- El rollback automático de `deploy.sh` se apoya en etiquetas de imagen, no en copiar archivos.
- El mismo compose sirve para desarrollo, la VM de ASO y la defensa.

## Contras y riesgos

- `podman-compose` 1.0.6 no es Docker Compose: ignora `condition: service_healthy` (solo traduce a `--requires`), no borra réplicas sobrantes ni redes al bajar. Está compensado con un reintento en `migrate`, `deploy_quitar_sobrantes` y la nota de redes huérfanas, pero es deuda a tener presente.
- Los healthchecks de Podman dependen de timers de systemd: sin systemd el estado queda en "starting" aunque el check pase (en esta sesión pasó a mano).
- El contenedor de la API pesa 190 MB (Bun + `devDependencies`, necesarias para `drizzle-kit`); se puede separar la imagen de migración, con costo de mantener dos.
- PostgreSQL en contenedor es un punto delicado para los datos: el volumen es lo único que importa, y el respaldo (`scripts/backup.sh` y el servidor de respaldo) tiene que probarse restaurando, no solo respaldando.
- VPS limitado: cada contenedor suma procesos y capas; con una sola instancia pequeña, el stack completo cabe, pero no conviene correr builds en el mismo servidor que atiende la defensa. Construir fuera y mover la imagen (`podman save`) es más seguro.
- Curva de aprendizaje para el equipo: depurar un problema pasa por `podman logs`, `exec` y redes, no por un archivo en `/var/www`.

## Podman o Docker

| Criterio | Podman rootless | Docker |
|---|---|---|
| Superficie de ataque | sin daemon, sin root | daemon con root (salvo modo rootless aparte) |
| Compose | `podman compose` / `podman-compose` (más limitado) | Compose v2 completo (healthcheck conditions, `down` correcto) |
| Arranque al reiniciar | systemd de usuario (`lux-stack.service`) o Quadlet | `restart:` con el daemon |
| Exigencia de ASO | el compose cumple; hay que decir que el motor es Podman | cumple literalmente |
| Madurez para el equipo | menos conocido | más documentación |

Recomendación: mantener Podman como motor por el modelo de seguridad, y declararlo explícitamente en el documento de ASO: "docker-compose" se cumple con un `compose.yaml` estándar, validado con ambos motores. Si en la VM de ASO hay problemas con `podman-compose`, `docker compose` corre el mismo archivo sin cambios (se validó la sintaxis, no se levantó con Docker en esta sesión).

## Quadlet

Quadlet (`.container`, `.network`, `.volume` en `~/.config/containers/systemd/`) es la forma nativa de Podman 5 para correr contenedores bajo systemd: reinicios, orden de arranque con salud real y logs en `journalctl`. Resolvería las limitaciones de `podman-compose`. No se incluyó: duplicaría la definición del stack (dos fuentes de verdad) y rompería el vínculo con "docker-compose" de la letra. Recomendación: evaluarlo después de la defensa si el stack va a producción real.

## Qué falta decidir (Faku)

1. Si el backend real sale a producción en contenedores, o si `lux.eternum.lat` sigue con mocks hasta después de la defensa.
2. Si en el documento de ASO se declara Podman como motor (recomendado) o se usa Docker en la VM.
3. Hacer la corrida en la VM Debian 13 con capturas (`deploy up`, `estado`, `verificar-redes.sh`).
