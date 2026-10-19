#!/usr/bin/env bash
# respaldo.sh: Modulo de respaldos del servidor SGRSI. "local" delega en
# backup.sh (dump, configuracion, sumas, rotacion). "remoto" es el CLIENTE de la
# sincronizacion con el servidor de respaldo: envia cada corrida por rsync sobre
# SSH, verifica la integridad en destino y guarda la cola de lo pendiente.
#
# Diseno (detalle en 05-ADMIN-SO/E3/ServidorRespaldo.md):
#   - Sin --delete: un origen vacio o desmontado no puede vaciar el destino
#     (G7 de la auditoria). La rotacion la hace cada lado por su cuenta.
#   - La llave de envio es de solo escritura: el servidor de respaldo la limita
#     con `rrsync -wo` a su directorio de recepcion (G14). Si roban la llave de
#     este servidor, no pueden leer ni borrar respaldos ya almacenados.
#   - Almacenamiento temporal: cada corrida se enlaza (hardlinks) en
#     BACKUP_DIR/.tmp/envio_<id> y se envia desde ahi; el archivo .sha256, que
#     marca la corrida completa, viaja ultimo.
#   - Fallbacks: reintentos con espera creciente, servidor alterno, cola de
#     pendientes y codigo de salida 75 (fallo temporal) para monitoreo.
#
# Issue: wefaber/eternum#109
# Documentado en: 05-ADMIN-SO/E3/ServidorRespaldo.md

# Requiere que comun.sh ya este cargado por quien invoca este modulo.
# shellcheck source=../backup.sh
source "$SGRSI_RAIZ/scripts/backup.sh"

SGRSI_RESPALDO_HOST="${SGRSI_RESPALDO_HOST:-}"
SGRSI_RESPALDO_HOST_ALT="${SGRSI_RESPALDO_HOST_ALT:-}"
SGRSI_RESPALDO_PUERTO="${SGRSI_RESPALDO_PUERTO:-52205}"
SGRSI_RESPALDO_USUARIO="${SGRSI_RESPALDO_USUARIO:-sgrsi_backup}"
SGRSI_RESPALDO_LLAVE="${SGRSI_RESPALDO_LLAVE:-$HOME/.ssh/id_ed25519_respaldo}"
SGRSI_RESPALDO_LLAVE_LECTURA="${SGRSI_RESPALDO_LLAVE_LECTURA:-$HOME/.ssh/id_ed25519_restauracion}"
SGRSI_RESPALDO_KNOWN_HOSTS="${SGRSI_RESPALDO_KNOWN_HOSTS:-$HOME/.ssh/known_hosts_respaldo}"
SGRSI_RESPALDO_BWLIMIT_KBPS="${SGRSI_RESPALDO_BWLIMIT_KBPS:-0}"
SGRSI_RESPALDO_REINTENTOS="${SGRSI_RESPALDO_REINTENTOS:-3}"

respaldo_descripcion() { echo "Respaldos: local (backup.sh) y remoto (rsync al servidor de respaldo)"; }

respaldo_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh respaldo <local|remoto> <accion> [argumentos]

  local <accion>           Delega en backup.sh (respaldar, comprobar, restaurar,
                           verificar, estado, listar, instalar-cron)
  remoto sincronizar       Envia al servidor de respaldo las corridas pendientes
  remoto estado            Cola de pendientes, ultimo envio y alertas
  remoto verificar [id]    Compara por checksum lo enviado contra el destino (rsync -c)
  remoto probar            Prueba la conexion y la autenticacion sin enviar nada
  remoto restaurar <id> [destino]
                           Trae una corrida desde el servidor de respaldo (llave de lectura)
                           y comprueba sus sumas SHA-256

Variables: SGRSI_RESPALDO_HOST, SGRSI_RESPALDO_HOST_ALT, SGRSI_RESPALDO_PUERTO,
SGRSI_RESPALDO_USUARIO, SGRSI_RESPALDO_LLAVE, SGRSI_RESPALDO_LLAVE_LECTURA,
SGRSI_RESPALDO_KNOWN_HOSTS, SGRSI_RESPALDO_BWLIMIT_KBPS, SGRSI_RESPALDO_REINTENTOS.
Codigo de salida 75: el destino no respondio; las corridas quedan pendientes.
FIN_AYUDA
}

# --- Piezas de conexion ----------------------------------------------------------

# rr_ssh <llave>: linea de ssh para rsync -e. StrictHostKeyChecking=yes con un
# known_hosts propio: la huella del servidor de respaldo se fija una vez (a
# mano, comprobandola por otro canal) y desde entonces un cambio aborta.
rr_ssh() {
    local llave="$1"
    echo "ssh -p $SGRSI_RESPALDO_PUERTO -i $llave -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$SGRSI_RESPALDO_KNOWN_HOSTS -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"
}

rr_validar_config() {
    validar_no_vacio "$SGRSI_RESPALDO_HOST" "SGRSI_RESPALDO_HOST" || return "$SGRSI_EX_CONFIG"
    validar_puerto "$SGRSI_RESPALDO_PUERTO" "SGRSI_RESPALDO_PUERTO" || return "$SGRSI_EX_CONFIG"
    validar_nombre "$SGRSI_RESPALDO_USUARIO" "SGRSI_RESPALDO_USUARIO" || return "$SGRSI_EX_CONFIG"
    local host
    for host in "$SGRSI_RESPALDO_HOST" "$SGRSI_RESPALDO_HOST_ALT"; do
        if [[ -n "$host" && ! "$host" =~ ^[A-Za-z0-9.-]{1,253}$ ]]; then
            log ERROR "Host de respaldo invalido: '$host'"
            return "$SGRSI_EX_CONFIG"
        fi
    done
}

# rr_validar_llave <archivo>: debe existir y no ser legible por otros.
rr_validar_llave() {
    local llave="$1"
    if [[ ! -f "$llave" ]]; then
        log ERROR "No existe la llave '$llave'. Generarla con: ssh-keygen -t ed25519 -f $llave -N ''"
        return "$SGRSI_EX_CONFIG"
    fi
    if (( (8#$(stat -c '%a' "$llave") & 8#077) != 0 )); then
        log ERROR "La llave '$llave' tiene permisos abiertos. Corregir con: chmod 600 $llave"
        return "$SGRSI_EX_CONFIG"
    fi
    if [[ ! -f "$SGRSI_RESPALDO_KNOWN_HOSTS" ]]; then
        log ERROR "Falta $SGRSI_RESPALDO_KNOWN_HOSTS. Registrar la huella del servidor de respaldo: ssh-keyscan -p $SGRSI_RESPALDO_PUERTO <host> > ese archivo (y comprobarla por otro canal)."
        return "$SGRSI_EX_CONFIG"
    fi
}

# rr_puerto_abierto <host> <puerto>: prueba TCP con 5 s de limite, sin ssh.
rr_puerto_abierto() {
    timeout 5 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null
}

# rr_rsync <llave> <argumentos de rsync...>
rr_rsync() {
    local llave="$1"
    shift
    local -a opciones=(-rt --partial --partial-dir=.rsync-partial --timeout=60
        --chmod=Du=rwx,Dg=,Do=,Fu=rw,Fg=,Fo=
        -e "$(rr_ssh "$llave")")
    if [[ "$SGRSI_RESPALDO_BWLIMIT_KBPS" -gt 0 ]]; then
        opciones+=(--bwlimit="$SGRSI_RESPALDO_BWLIMIT_KBPS")
    fi
    rsync "${opciones[@]}" "$@"
}

# --- Cola de pendientes -----------------------------------------------------------

rr_archivo_enviados() { echo "$BACKUP_DIR/.enviados"; }

# rr_ids_completos: corridas con .sha256 (completas), de la mas vieja a la nueva.
rr_ids_completos() {
    find "$BACKUP_DIR" -maxdepth 1 -name 'lux_*.sha256' -type f -printf '%f\n' 2>/dev/null \
        | sed -nE "s/^lux_(${PATRON_ID})\.sha256$/\1/p" | sort
}

rr_ids_pendientes() {
    local enviados
    enviados="$(rr_archivo_enviados)"
    [[ -f "$enviados" ]] || : > "$enviados"
    rr_ids_completos | grep -vxFf "$enviados" || true
}

# --- Envio -----------------------------------------------------------------------

# rr_preparar_envio <id>: enlaza los archivos de la corrida en un directorio
# temporal. Devuelve la ruta por stdout.
rr_preparar_envio() {
    local id="$1"
    local stage="$BACKUP_DIR/.tmp/envio_${id}"
    rm -rf "$stage"
    mkdir -p "$stage"
    local f
    for f in "$BACKUP_DIR/lux_${id}."* "$BACKUP_DIR/archivos_${id}."* "$BACKUP_DIR/secretos_${id}."*; do
        [[ -f "$f" ]] || continue
        ln "$f" "$stage/" 2>/dev/null || cp -p "$f" "$stage/"
    done
    echo "$stage"
}

# rr_enviar_id <host> <id>
# 1) datos, 2) .sha256 (marca de completa), 3) verificacion por checksum.
rr_enviar_id() {
    local host="$1" id="$2"
    local stage destino
    stage="$(rr_preparar_envio "$id")"
    destino="${SGRSI_RESPALDO_USUARIO}@${host}:${id}/"
    # shellcheck disable=SC2064
    trap "rm -rf '$stage'" RETURN

    if [[ ! -f "$stage/lux_${id}.sha256" ]]; then
        log ERROR "La corrida $id no tiene archivo de sumas: no se envia."
        return 1
    fi

    log INFO "Enviando la corrida $id a $host..."
    local -a datos=()
    local f
    for f in "$stage"/*; do
        [[ "$f" == *.sha256 ]] || datos+=("$f")
    done

    rr_rsync "$SGRSI_RESPALDO_LLAVE" "${datos[@]}" "$destino" || return 1
    rr_rsync "$SGRSI_RESPALDO_LLAVE" "$stage/lux_${id}.sha256" "$destino" || return 1

    rr_verificar_destino "$host" "$id" "$stage"
}

# rr_verificar_destino <host> <id> <stage>
# rsync -rcn compara por checksum (no por fecha ni tamano). Si no lista ninguna
# diferencia, lo que esta en destino es identico bit a bit a lo local.
rr_verificar_destino() {
    local host="$1" id="$2" stage="$3"
    local diferencias
    if ! diferencias="$(rr_rsync "$SGRSI_RESPALDO_LLAVE" -c -n --itemize-changes "$stage/" "${SGRSI_RESPALDO_USUARIO}@${host}:${id}/" 2>&1)"; then
        log ERROR "No se pudo verificar la corrida $id en $host: $diferencias"
        return 1
    fi
    if [[ -n "$diferencias" ]]; then
        log ERROR "Verificacion por checksum: la corrida $id difiere en $host:"
        echo "$diferencias" | sed 's/^/    /' >&2
        return 1
    fi
    log INFO "Corrida $id verificada por checksum en $host (sin diferencias)."
}

respaldo_remoto_sincronizar() {
    rr_validar_config || return $?
    requerir_comando rsync rsync || return 1
    requerir_comando ssh openssh-client || return 1

    local pendientes
    pendientes="$(rr_ids_pendientes)"
    if [[ -z "$pendientes" ]]; then
        log INFO "No hay corridas pendientes de envio."
        return 0
    fi
    log INFO "Corridas pendientes: $(wc -l <<<"$pendientes")"

    if es_dry_run; then
        local id
        while IFS= read -r id; do
            log INFO "[dry-run] rsync lux/archivos/secretos_${id}.* -> ${SGRSI_RESPALDO_USUARIO}@${SGRSI_RESPALDO_HOST}:${id}/ (sin --delete), luego verificacion -c"
        done <<<"$pendientes"
        return 0
    fi

    rr_validar_llave "$SGRSI_RESPALDO_LLAVE" || return $?
    adquirir_lock respaldo-remoto || return $?

    local host id entregadas=0 hosts=("$SGRSI_RESPALDO_HOST")
    [[ -n "$SGRSI_RESPALDO_HOST_ALT" ]] && hosts+=("$SGRSI_RESPALDO_HOST_ALT")

    for host in "${hosts[@]}"; do
        if ! rr_puerto_abierto "$host" "$SGRSI_RESPALDO_PUERTO"; then
            log WARN "$host:$SGRSI_RESPALDO_PUERTO no responde. Se prueba el siguiente destino, si hay."
            continue
        fi
        local falla=0
        while IFS= read -r id; do
            [[ -z "$id" ]] && continue
            if reintentar "$SGRSI_RESPALDO_REINTENTOS" 5 rr_enviar_id "$host" "$id"; then
                echo "$id" >> "$(rr_archivo_enviados)"
                entregadas=$((entregadas + 1))
            else
                falla=1
                break
            fi
        done <<<"$pendientes"
        if [[ "$falla" -eq 0 ]]; then
            date '+%Y-%m-%d %H:%M:%S' > "$BACKUP_DIR/.ultimo-envio"
            rm -f "$BACKUP_DIR/.alerta-remoto"
            log INFO "Sincronizacion completa: $entregadas corrida(s) entregadas a $host."
            return 0
        fi
    done

    date '+%Y-%m-%d %H:%M:%S' > "$BACKUP_DIR/.alerta-remoto"
    log ERROR "No se pudo entregar a ningun servidor de respaldo. Las corridas quedan pendientes (se reintenta en la proxima ejecucion)."
    return "$SGRSI_EX_TEMP"
}

respaldo_remoto_estado() {
    local pendientes
    pendientes="$(rr_ids_pendientes)"
    echo "Destino:      ${SGRSI_RESPALDO_USUARIO}@${SGRSI_RESPALDO_HOST:-[sin configurar]}:${SGRSI_RESPALDO_PUERTO}"
    echo "Corridas locales completas: $(rr_ids_completos | wc -l)"
    echo "Pendientes de envio:        $(printf '%s' "$pendientes" | grep -c . || true)"
    if [[ -f "$BACKUP_DIR/.ultimo-envio" ]]; then
        echo "Ultimo envio correcto:      $(cat "$BACKUP_DIR/.ultimo-envio")"
    else
        echo "Ultimo envio correcto:      (nunca)"
    fi
    if [[ -f "$BACKUP_DIR/.alerta-remoto" ]]; then
        log ERROR "Hay una alerta abierta desde $(cat "$BACKUP_DIR/.alerta-remoto"): el ultimo intento de envio fallo."
        return 1
    fi
}

respaldo_remoto_verificar() {
    local id="${1:-}"
    rr_validar_config || return $?
    rr_validar_llave "$SGRSI_RESPALDO_LLAVE" || return $?
    [[ -n "$id" ]] || id="$(rr_ids_completos | tail -n 1)"
    if [[ -z "$id" ]]; then
        log ERROR "No hay corridas locales completas para verificar."
        return 1
    fi
    local stage
    stage="$(rr_preparar_envio "$id")"
    # shellcheck disable=SC2064
    trap "rm -rf '$stage'" RETURN
    rr_verificar_destino "$SGRSI_RESPALDO_HOST" "$id" "$stage"
}

respaldo_remoto_probar() {
    rr_validar_config || return $?
    rr_validar_llave "$SGRSI_RESPALDO_LLAVE" || return $?
    local host="$SGRSI_RESPALDO_HOST"

    if rr_puerto_abierto "$host" "$SGRSI_RESPALDO_PUERTO"; then
        echo "  [ok]    TCP $host:$SGRSI_RESPALDO_PUERTO"
    else
        echo "  [FALLA] TCP $host:$SGRSI_RESPALDO_PUERTO no responde"
        return "$SGRSI_EX_TEMP"
    fi

    local sonda
    sonda="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$sonda'" RETURN
    echo "sonda" > "$sonda/sonda.txt"
    if rr_rsync "$SGRSI_RESPALDO_LLAVE" -n "$sonda/sonda.txt" "${SGRSI_RESPALDO_USUARIO}@${host}:sonda/" >/dev/null 2>&1; then
        echo "  [ok]    autenticacion y rsync (ensayo sin escribir)"
    else
        echo "  [FALLA] autenticacion o rsync (revisar llave, known_hosts y authorized_keys del destino)"
        return 1
    fi
    log INFO "Conexion con el servidor de respaldo correcta."
}

respaldo_remoto_restaurar() {
    local id="${1:-}" destino="${2:-}"
    validar_no_vacio "$id" "id de corrida" || return 1
    if [[ ! "$id" =~ ^${PATRON_ID}$ ]]; then
        log ERROR "Identificador invalido: '$id' (formato YYYYmmdd_HHMMSS)."
        return 1
    fi
    rr_validar_config || return $?
    rr_validar_llave "$SGRSI_RESPALDO_LLAVE_LECTURA" || return $?
    destino="${destino:-$RESTAURACION_DIR/remoto_$id}"
    mkdir -p "$destino"

    log INFO "Trayendo la corrida $id desde $SGRSI_RESPALDO_HOST..."
    reintentar "$SGRSI_RESPALDO_REINTENTOS" 5 \
        rr_rsync "$SGRSI_RESPALDO_LLAVE_LECTURA" "${SGRSI_RESPALDO_USUARIO}@${SGRSI_RESPALDO_HOST}:${id}/" "$destino/" || return 1

    if (cd "$destino" && sha256sum --check --quiet "lux_${id}.sha256"); then
        log INFO "Sumas SHA-256 correctas en $destino. Restaurar la base con: backup.sh restaurar $destino/lux_${id}.sql.gz"
    else
        log ERROR "Las sumas de la corrida descargada NO coinciden. No usarla."
        return 1
    fi
}

respaldo_main() {
    local ambito="${1:-}"
    shift || true

    case "$ambito" in
        local)
            if [[ "${1:-}" == "" ]]; then
                respaldo_ayuda
            else
                "$SGRSI_RAIZ/scripts/backup.sh" "$@"
            fi
            ;;
        remoto)
            local accion="${1:-}"
            shift || true
            case "$accion" in
                sincronizar) respaldo_remoto_sincronizar ;;
                estado)      respaldo_remoto_estado ;;
                verificar)   respaldo_remoto_verificar "$@" ;;
                probar)      respaldo_remoto_probar ;;
                restaurar)   respaldo_remoto_restaurar "$@" ;;
                ""|ayuda)    respaldo_ayuda ;;
                *)
                    log ERROR "Accion remota desconocida: '$accion'"
                    respaldo_ayuda
                    return 1
                    ;;
            esac
            ;;
        ""|ayuda|-h|--help) respaldo_ayuda ;;
        *)
            log ERROR "Ambito desconocido: '$ambito' (local o remoto)"
            respaldo_ayuda
            return 1
            ;;
    esac
}
