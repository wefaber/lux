#!/usr/bin/env bash
# logs.sh: Modulo de logs del servidor SGRSI. Unifica la consulta de las fuentes
# que hay en el servidor (journal del sistema, contenedores del stack, log de
# este script, firewall, SSH) y configura la rotacion de /var/log/sgrsi.
#
# Issue: wefaber/eternum#109
# Documentado en: 05-ADMIN-SO/E3/Script-Final.md (modulo logs)

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

SGRSI_LOGROTATE_DESTINO="${SGRSI_LOGROTATE_DESTINO:-/etc/logrotate.d/sgrsi}"
SGRSI_COMPOSE_ARCHIVO="${SGRSI_COMPOSE_ARCHIVO:-$SGRSI_RAIZ/ops/compose.yaml}"
SGRSI_UFW_LOG="${SGRSI_UFW_LOG:-/var/log/ufw.log}"

logs_descripcion() { echo "Consulta de logs (sistema, contenedores, SSH, UFW) y logrotate"; }

logs_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh logs <subcomando> [argumentos]

Subcomandos:
  ver [lineas]                 Ultimas lineas del log de este script (por defecto 50)
  servicio <nombre> [lineas]   Log de un servicio. Nombres: db, api, web (contenedores),
                               ssh, ufw, cron, sistema (journal del host)
  errores [desde]              Resumen de errores desde un momento ("1 hour ago" por defecto)
  ssh-fallidos [desde]         Intentos de acceso SSH rechazados, agrupados por IP
  logrotate                    Instala la rotacion semanal de /var/log/sgrsi/*.log
  ayuda                        Esta ayuda

Variables: SGRSI_LOG, SGRSI_COMPOSE_ARCHIVO, SGRSI_UFW_LOG.
FIN_AYUDA
}

# logs_validar_lineas <valor>: solo enteros, para no pasar basura a tail/journalctl.
logs_validar_lineas() {
    if [[ ! "${1:-}" =~ ^[0-9]{1,5}$ ]]; then
        log ERROR "El numero de lineas debe ser un entero: '${1:-}'"
        return 1
    fi
}

logs_ver() {
    local lineas="${1:-50}"
    logs_validar_lineas "$lineas" || return 1
    if [[ ! -f "$SGRSI_LOG" ]]; then
        log WARN "Todavia no existe $SGRSI_LOG (no se registro ninguna operacion)."
        return 0
    fi
    tail -n "$lineas" "$SGRSI_LOG"
}

# logs_contenedor <servicio> <lineas>
# Usa compose para no depender del nombre del contenedor (que cambia al escalar).
logs_contenedor() {
    local servicio="$1" lineas="$2"
    compose_stack -f "$SGRSI_COMPOSE_ARCHIVO" logs --tail "$lineas" "$servicio"
}

logs_servicio() {
    local nombre="${1:-}" lineas="${2:-100}"
    validar_no_vacio "$nombre" "servicio" || return 1
    logs_validar_lineas "$lineas" || return 1

    case "$nombre" in
        db|api|web) logs_contenedor "$nombre" "$lineas" ;;
        ssh)        requerir_comando journalctl systemd || return 1; journalctl -u ssh -n "$lineas" --no-pager ;;
        ufw)
            if [[ -r "$SGRSI_UFW_LOG" ]]; then
                tail -n "$lineas" "$SGRSI_UFW_LOG"
            else
                requerir_comando journalctl systemd || return 1
                journalctl -k --grep 'UFW' -n "$lineas" --no-pager
            fi
            ;;
        cron)       requerir_comando journalctl systemd || return 1; journalctl -u cron -n "$lineas" --no-pager ;;
        sistema)    requerir_comando journalctl systemd || return 1; journalctl -n "$lineas" --no-pager ;;
        *)
            log ERROR "Servicio desconocido: '$nombre' (db, api, web, ssh, ufw, cron, sistema)."
            return 1
            ;;
    esac
}

# logs_errores [desde]: cuenta mensajes de prioridad error o peor y muestra los ultimos.
logs_errores() {
    local desde="${1:-1 hour ago}"
    requerir_comando journalctl systemd || return 1
    if [[ ! "$desde" =~ ^[A-Za-z0-9\ :.-]{1,40}$ ]]; then
        log ERROR "Valor de 'desde' invalido: '$desde'"
        return 1
    fi
    local total
    total="$(journalctl -p err --since "$desde" --no-pager -q 2>/dev/null | wc -l)"
    echo "Mensajes de prioridad error o peor desde '$desde': $total"
    if [[ "$total" -gt 0 ]]; then
        journalctl -p err --since "$desde" --no-pager -q -n 20
    fi
}

# logs_ssh_fallidos [desde]: intentos rechazados agrupados por IP de origen.
logs_ssh_fallidos() {
    local desde="${1:-24 hours ago}"
    requerir_comando journalctl systemd || return 1
    if [[ ! "$desde" =~ ^[A-Za-z0-9\ :.-]{1,40}$ ]]; then
        log ERROR "Valor de 'desde' invalido: '$desde'"
        return 1
    fi
    echo "Intentos SSH rechazados desde '$desde' (cantidad, origen):"
    journalctl -u ssh --since "$desde" --no-pager -q 2>/dev/null \
        | grep -E 'Failed|Invalid user|Connection closed by authenticating' \
        | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | sort | uniq -c | sort -rn | head -n 10 \
        | sed 's/^/  /' || true
}

logs_logrotate_contenido() {
    cat <<'FIN_LOGROTATE'
# Instalado por lux/scripts/lib/logs.sh (admin.sh logs logrotate).
/var/log/sgrsi/*.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    su sgrsi adm
    create 0660 sgrsi adm
}
FIN_LOGROTATE
}

logs_logrotate() {
    requerir_root
    local nuevo
    nuevo="$(mktemp)"
    # shellcheck disable=SC2064
    trap "rm -f '$nuevo'" RETURN
    logs_logrotate_contenido > "$nuevo"

    if es_dry_run; then
        log INFO "[dry-run] Se instalaria $SGRSI_LOGROTATE_DESTINO con:"
        sed 's/^/    | /' "$nuevo" >&2
        return 0
    fi

    if command -v logrotate >/dev/null 2>&1; then
        if ! logrotate -d "$nuevo" >/dev/null 2>&1; then
            log ERROR "logrotate rechazo la configuracion generada. No se instala."
            return 1
        fi
    else
        log WARN "logrotate no esta instalado (apt install logrotate). Se instala la configuracion sin validarla."
    fi
    install -m 644 "$nuevo" "$SGRSI_LOGROTATE_DESTINO"
    log INFO "Rotacion instalada en $SGRSI_LOGROTATE_DESTINO (semanal, 8 copias, comprimida)."
}

logs_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        ver)           logs_ver "$@" ;;
        servicio)      logs_servicio "$@" ;;
        errores)       logs_errores "$@" ;;
        ssh-fallidos)  logs_ssh_fallidos "$@" ;;
        logrotate)     logs_logrotate ;;
        ""|ayuda|-h|--help) logs_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            logs_ayuda
            return 1
            ;;
    esac
}
