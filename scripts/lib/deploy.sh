#!/usr/bin/env bash
# deploy.sh: Modulo de despliegue de contenedores del servidor SGRSI. Envuelve
# `podman compose` sobre ops/compose.yaml con las comprobaciones que el comando
# crudo no hace: Podman rootless, archivo de entorno protegido, verificacion de
# /ready despues de levantar, escalado de la API y rollback a la imagen anterior.
#
# Issue: wefaber/eternum#109
# Documentado en: 05-ADMIN-SO/E3/Docker-Compose.md

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

SGRSI_COMPOSE_ARCHIVO="${SGRSI_COMPOSE_ARCHIVO:-$SGRSI_RAIZ/ops/compose.yaml}"
SGRSI_STACK_ENV="${SGRSI_STACK_ENV:-/etc/sgrsi/lux.env}"
SGRSI_DEPLOY_PUERTO="${SGRSI_DEPLOY_PUERTO:-}"                 # vacio: se lee LUX_WEB_PORT del env
SGRSI_DEPLOY_ESPERA="${SGRSI_DEPLOY_ESPERA:-60}"               # segundos maximos esperando /ready
SGRSI_DEPLOY_ROLLBACK_AUTO="${SGRSI_DEPLOY_ROLLBACK_AUTO:-1}"  # 1: revertir solo si /ready no responde
SGRSI_PERMITIR_ROOT="${SGRSI_PERMITIR_ROOT:-0}"                # 1: solo para pruebas en maquinas descartables
SGRSI_UNIDAD_ORIGEN="${SGRSI_UNIDAD_ORIGEN:-$SGRSI_RAIZ/ops/systemd/lux-stack.service}"

deploy_descripcion() { echo "Contenedores (Podman rootless): up, down, estado, escalar, rollback"; }

deploy_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh deploy <subcomando> [argumentos]

Subcomandos:
  up [--sin-build]       Construye (salvo --sin-build), levanta el stack y espera /ready.
                         Si no responde, revierte a la imagen anterior (rollback).
  down                   Detiene y elimina los contenedores (los volumenes se conservan)
  ps                     Contenedores del stack
  estado                 ps + salud de cada contenedor + respuesta de /ready
  logs [servicio] [n]    Ultimas n lineas (db, api, web; sin servicio: todos)
  escalar <n>            Ajusta las replicas de la API (1 a 4)
  rollback               Vuelve a las imagenes etiquetadas "previous"
  seed-demo              Carga los datos de ejemplo (BORRA las tablas; pide confirmacion)
  unidad                 Instala la unidad systemd de usuario que levanta el stack al arrancar

Variables: SGRSI_COMPOSE_ARCHIVO, SGRSI_STACK_ENV (por defecto /etc/sgrsi/lux.env),
SGRSI_DEPLOY_ESPERA, SGRSI_DEPLOY_ROLLBACK_AUTO. Con --dry-run se muestran los comandos.
FIN_AYUDA
}

# --- Comprobaciones previas --------------------------------------------------

# deploy_verificar_rootless
# El stack tiene que correr sin privilegios. Se le pregunta a podman, no se
# adivina por el uid, porque `podman info` refleja el modo real.
deploy_verificar_rootless() {
    if es_dry_run; then
        return 0
    fi
    local rootless
    rootless="$(podman_stack info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo desconocido)"
    if [[ "$rootless" != "true" ]]; then
        if [[ "$SGRSI_PERMITIR_ROOT" == "1" ]]; then
            log WARN "Podman NO esta en modo rootless (SGRSI_PERMITIR_ROOT=1). Usar solo en pruebas descartables."
            return 0
        fi
        log ERROR "Podman no esta en modo rootless (reporta: $rootless). El stack debe correr con la cuenta '${SGRSI_STACK_USUARIO-sgrsi}', no como root."
        return 1
    fi
}

# deploy_verificar_entorno
# El archivo de entorno tiene las claves: debe existir, ser legible y no ser
# accesible a "otros".
deploy_verificar_entorno() {
    if [[ ! -f "$SGRSI_STACK_ENV" ]]; then
        log ERROR "No existe el archivo de entorno '$SGRSI_STACK_ENV'. Copiar ops/env/lux.env.example y completarlo."
        return "$SGRSI_EX_CONFIG"
    fi
    if (( (8#$(stat -c '%a' "$SGRSI_STACK_ENV") & 8#007) != 0 )); then
        log ERROR "'$SGRSI_STACK_ENV' es accesible por otros (modo $(stat -c '%a' "$SGRSI_STACK_ENV")). Corregir con: chmod 640 (root:sgrsi) o 600."
        return "$SGRSI_EX_CONFIG"
    fi
    if grep -q '\[COMPLETAR\]' "$SGRSI_STACK_ENV"; then
        log ERROR "'$SGRSI_STACK_ENV' todavia tiene valores [COMPLETAR]."
        return "$SGRSI_EX_CONFIG"
    fi
}

# deploy_compose <argumentos de compose>
deploy_compose() {
    compose_stack --env-file "$SGRSI_STACK_ENV" -f "$SGRSI_COMPOSE_ARCHIVO" "$@"
}

deploy_preflight() {
    if [[ ! -f "$SGRSI_COMPOSE_ARCHIVO" ]]; then
        log ERROR "No existe el compose '$SGRSI_COMPOSE_ARCHIVO'."
        return "$SGRSI_EX_CONFIG"
    fi
    if es_dry_run; then
        return 0
    fi
    requerir_comando podman || return 1
    comando_compose >/dev/null || return 1
    deploy_verificar_entorno || return $?
    deploy_verificar_rootless || return 1
}

deploy_puerto() {
    if [[ -n "$SGRSI_DEPLOY_PUERTO" ]]; then
        echo "$SGRSI_DEPLOY_PUERTO"
        return 0
    fi
    local p=""
    if [[ -r "$SGRSI_STACK_ENV" ]]; then
        p="$(sed -n 's/^LUX_WEB_PORT=\([0-9]\{1,5\}\)$/\1/p' "$SGRSI_STACK_ENV" | tail -n 1)"
    fi
    echo "${p:-8080}"
}

# deploy_esperar_ready
# Consulta /ready (expuesto por el contenedor web hacia la API) hasta que
# responda 200 o se agote SGRSI_DEPLOY_ESPERA.
deploy_esperar_ready() {
    local puerto limite inicio
    puerto="$(deploy_puerto)"
    validar_puerto "$puerto" "puerto web" || return 1
    limite="$SGRSI_DEPLOY_ESPERA"
    inicio="$(date +%s)"

    log INFO "Esperando /ready en 127.0.0.1:$puerto (maximo ${limite}s)..."
    while true; do
        if curl -fsS -m 5 "http://127.0.0.1:$puerto/ready" >/dev/null 2>&1; then
            log INFO "La API responde /ready (HTTP 200)."
            return 0
        fi
        if (( $(date +%s) - inicio >= limite )); then
            log ERROR "La API no respondio /ready en ${limite}s."
            return 1
        fi
        ${SGRSI_SLEEP:-sleep} 3
    done
}

# deploy_etiquetar_previa: antes de reconstruir, la imagen vigente queda como
# `previous` para poder volver. Si todavia no hay imagen (primer despliegue),
# no es un error.
deploy_etiquetar_previa() {
    local img
    for img in lux-api lux-web; do
        if podman_stack image exists "localhost/$img:latest" 2>/dev/null; then
            ejecutar podman_stack tag "localhost/$img:latest" "localhost/$img:previous"
        fi
    done
}

# --- Subcomandos -------------------------------------------------------------

deploy_up() {
    local build=(--build)
    [[ "${1:-}" == "--sin-build" ]] && build=()

    deploy_preflight || return $?
    # La etiqueta "previous" solo se mueve al reconstruir: un reinicio del
    # servidor (--sin-build) no debe pisar la version de respaldo.
    if [[ "${#build[@]}" -gt 0 ]] && ! es_dry_run; then
        deploy_etiquetar_previa
    fi

    log INFO "Levantando el stack..."
    if ! ejecutar deploy_compose up -d "${build[@]}"; then
        log ERROR "compose up fallo."
        deploy_fallback
        return 1
    fi

    if es_dry_run; then
        return 0
    fi

    if ! deploy_esperar_ready; then
        deploy_compose ps || true
        deploy_compose logs --tail 30 api || true
        deploy_fallback
        return 1
    fi
    log INFO "Despliegue correcto."
}

# deploy_fallback: segunda oportunidad con la imagen anterior, si corresponde.
deploy_fallback() {
    if [[ "$SGRSI_DEPLOY_ROLLBACK_AUTO" != "1" ]]; then
        log WARN "Rollback automatico desactivado. Revertir a mano con: admin.sh deploy rollback"
        return 0
    fi
    log WARN "Se intenta volver a la version anterior (rollback automatico)."
    deploy_rollback || log ERROR "El rollback tambien fallo. Revisar: admin.sh logs servicio api"
}

deploy_rollback() {
    deploy_preflight || return $?
    local img
    if ! es_dry_run; then
        for img in lux-api lux-web; do
            if ! podman_stack image exists "localhost/$img:previous" 2>/dev/null; then
                log ERROR "No hay imagen 'localhost/$img:previous' para revertir (primer despliegue o imagenes purgadas)."
                return 1
            fi
        done
    fi
    log WARN "Volviendo a las imagenes 'previous'."
    LUX_IMAGE_TAG=previous ejecutar deploy_compose up -d --no-build || return 1
    if ! es_dry_run; then
        deploy_esperar_ready
    fi
}

deploy_down() {
    deploy_preflight || return $?
    ejecutar deploy_compose down
    log INFO "Stack detenido. Los volumenes (datos de PostgreSQL) se conservan."
}

deploy_ps() {
    deploy_preflight || return $?
    deploy_compose ps
}

deploy_estado() {
    deploy_preflight || return $?
    deploy_compose ps
    echo
    echo "Salud de los contenedores:"
    podman_stack ps --filter label=io.podman.compose.project=lux \
        --format '  {{.Names}}: {{.Status}}' 2>/dev/null || true
    echo
    if curl -fsS -m 5 "http://127.0.0.1:$(deploy_puerto)/ready" 2>/dev/null; then
        echo
        log INFO "/ready responde 200."
    else
        log ERROR "/ready no responde: la API o la base no estan disponibles."
        return 1
    fi
}

deploy_logs() {
    deploy_preflight || return $?
    local servicio="${1:-}" lineas="${2:-100}"
    if [[ ! "$lineas" =~ ^[0-9]{1,5}$ ]]; then
        log ERROR "El numero de lineas debe ser un entero: '$lineas'"
        return 1
    fi
    if [[ -n "$servicio" && ! "$servicio" =~ ^(db|api|web|migrate)$ ]]; then
        log ERROR "Servicio desconocido: '$servicio' (db, api, web, migrate)."
        return 1
    fi
    deploy_compose logs --tail "$lineas" ${servicio:+"$servicio"}
}

# deploy_escalar <n>
# Replicas de la API. El contenedor web resuelve `api` por DNS en cada pedido
# (resolver dinamico en default.conf.template), de modo que reparte entre ellas.
deploy_escalar() {
    local n="${1:-}"
    validar_no_vacio "$n" "replicas" || return 1
    if [[ ! "$n" =~ ^[1-4]$ ]]; then
        log ERROR "Las replicas deben estar entre 1 y 4: '$n'"
        return 1
    fi
    deploy_preflight || return $?
    ejecutar deploy_compose up -d --no-recreate --scale "api=$n"
    log INFO "API escalada a $n replica(s)."
}

deploy_seed_demo() {
    deploy_preflight || return $?
    log WARN "db:seed VACIA y recarga las tablas del backend con datos de ejemplo (cuentas con claves conocidas)."
    log WARN "Solo para demostraciones. NO ejecutar sobre datos reales."
    confirmar "Cargar los datos de ejemplo borrando el contenido actual" || { log INFO "Operacion cancelada."; return 0; }
    ejecutar deploy_compose run --rm api bun run db:seed
}

# deploy_unidad: instala la unidad systemd de USUARIO. Con "linger" el stack se
# levanta al arrancar el servidor sin sesion abierta.
deploy_unidad() {
    local usuario="${SGRSI_STACK_USUARIO-sgrsi}"
    requerir_root
    if [[ ! -f "$SGRSI_UNIDAD_ORIGEN" ]]; then
        log ERROR "No existe la unidad '$SGRSI_UNIDAD_ORIGEN'."
        return "$SGRSI_EX_CONFIG"
    fi
    if ! es_dry_run && ! existe_usuario "$usuario"; then
        log ERROR "No existe la cuenta '$usuario'. Crearla con: admin.sh usuarios alta $usuario 'Cuenta de servicio SGRSI'"
        return 1
    fi
    local home
    home="$(getent passwd "$usuario" | cut -d: -f6 || true)"
    home="${home:-/home/$usuario}"
    ejecutar install -d -o "$usuario" -g "$usuario" -m 755 "$home/.config/systemd/user"
    ejecutar install -o "$usuario" -g "$usuario" -m 644 "$SGRSI_UNIDAD_ORIGEN" "$home/.config/systemd/user/lux-stack.service"
    ejecutar loginctl enable-linger "$usuario"
    log INFO "Unidad instalada. Activar como '$usuario': systemctl --user daemon-reload && systemctl --user enable --now lux-stack.service podman-restart.service"
}

deploy_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        up)         deploy_up "$@" ;;
        down)       deploy_down ;;
        ps)         deploy_ps ;;
        estado)     deploy_estado ;;
        logs)       deploy_logs "$@" ;;
        escalar)    deploy_escalar "$@" ;;
        rollback)   deploy_rollback ;;
        seed-demo)  deploy_seed_demo ;;
        unidad)     deploy_unidad ;;
        ""|ayuda|-h|--help) deploy_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            deploy_ayuda
            return 1
            ;;
    esac
}
