#!/usr/bin/env bash
# servidor-respaldo.sh: Scripts del SERVIDOR DE RESPALDO del SGRSI (la segunda
# VM). Instala y configura el servidor, recibe corridas enviadas por el cliente
# (scripts/lib/respaldo.sh), las valida, las rota y permite probar una
# restauracion.
#
# Flujo de una corrida:
#   cliente --rsync/SSH (llave solo escritura, rrsync -wo)--> incoming/<id>/
#   procesar: sha256sum -c + gzip -t --> almacen/<id>/    (o rechazados/<id>/)
#   rotar:    7 dias + 4 semanas (scripts/lib/rotacion.sh, la misma politica del origen)
#
# Estructura (SGRSI_RESP_BASE, por defecto /srv/sgrsi-backups):
#   incoming/    almacenamiento TEMPORAL de lo que llega; nada se usa desde aca
#   almacen/     corridas verificadas (lo que se restaura)
#   rechazados/  corridas que no pasaron la verificacion o quedaron incompletas
#
# Uso:  servidor-respaldo.sh [--dry-run] <accion>
#
# Issue: wefaber/eternum#109
# Documentado en: 05-ADMIN-SO/E3/ServidorRespaldo.md

set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SGRSI_DIR="$(cd "$AQUI/../../scripts" && pwd)"
readonly AQUI SGRSI_DIR

# comun.sh fija SGRSI_LOG como readonly: el valor por defecto se decide antes.
export SGRSI_LOG="${SGRSI_LOG:-/var/log/sgrsi-respaldo/servidor.log}"

# shellcheck source=../../scripts/lib/comun.sh
source "$SGRSI_DIR/lib/comun.sh"
# shellcheck source=../../scripts/lib/rotacion.sh
source "$SGRSI_DIR/lib/rotacion.sh"

BASE="${SGRSI_RESP_BASE:-/srv/sgrsi-backups}"
USUARIO="${SGRSI_RESP_USUARIO:-sgrsi_backup}"
HOME_USUARIO="${SGRSI_RESP_HOME:-/var/lib/sgrsi-backup}"
GRUPO="${SGRSI_RESP_GRUPO:-sgrsi-respaldo}"
DIARIOS="${SGRSI_BACKUP_DIARIOS:-7}"
SEMANAS="${SGRSI_BACKUP_SEMANAS:-4}"
MAX_EDAD_HORAS="${SGRSI_BACKUP_MAX_EDAD_HORAS:-26}"
MAX_USO_PCT="${SGRSI_RESP_MAX_USO_PCT:-85}"
INCOMPLETA_HORAS="${SGRSI_RESP_INCOMPLETA_HORAS:-6}"
ESTABLE_SEGUNDOS="${SGRSI_RESP_ESTABLE_SEGUNDOS:-120}"
RRSYNC="${SGRSI_RRSYNC:-/usr/bin/rrsync}"
PROD_IP="${SGRSI_PROD_IP:-}"                       # unico origen autorizado para enviar
ADMIN_CIDR="${SGRSI_ADMIN_CIDR:-}"                 # red desde la que administran los tecnicos
IMAGEN_PG="${SGRSI_RESP_IMAGEN_PG:-docker.io/library/postgres:17-trixie}"
readonly PATRON_ESTRICTO='^[0-9]{8}_[0-9]{6}$'

umask 077

# --- Instalacion -------------------------------------------------------------

# instalar [--llave-escritura ARCHIVO.pub] [--llave-lectura ARCHIVO.pub]
# Deja el servidor listo. Cada paso pasa por `ejecutar`, de modo que con
# --dry-run se ve el plan completo sin tocar nada.
instalar() {
    local llave_w="" llave_r=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --llave-escritura) llave_w="${2:-}"; shift 2 ;;
            --llave-lectura)   llave_r="${2:-}"; shift 2 ;;
            *) log ERROR "Opcion desconocida: $1"; return "$SGRSI_EX_USO" ;;
        esac
    done
    requerir_root
    validar_nombre "$USUARIO" "SGRSI_RESP_USUARIO" || return "$SGRSI_EX_CONFIG"

    if [[ -z "$PROD_IP" ]]; then
        log ERROR "Definir SGRSI_PROD_IP (IP del servidor de produccion): es el unico origen que se autoriza a enviar."
        return "$SGRSI_EX_CONFIG"
    fi
    validar_ipv4 "$PROD_IP" "SGRSI_PROD_IP" || return "$SGRSI_EX_CONFIG"

    log INFO "1/7 Paquetes"
    ejecutar apt-get install -y openssh-server rsync ufw cron gnupg logrotate

    log INFO "2/7 Cuenta de servicio '$USUARIO' y grupo '$GRUPO'"
    existe_grupo "$GRUPO" || ejecutar groupadd --system "$GRUPO"
    if ! existe_usuario "$USUARIO"; then
        ejecutar useradd --system --gid "$GRUPO" --create-home --home-dir "$HOME_USUARIO" \
            --shell /bin/bash --comment "Recepcion de respaldos SGRSI" "$USUARIO"
    fi

    log INFO "3/7 Directorios en $BASE"
    ejecutar install -d -o "$USUARIO" -g "$GRUPO" -m 750 "$BASE" "$BASE/incoming" "$BASE/almacen" "$BASE/rechazados"
    ejecutar install -d -o "$USUARIO" -g "$GRUPO" -m 750 /var/log/sgrsi-respaldo

    log INFO "4/7 Llaves SSH limitadas a rrsync"
    instalar_llaves "$llave_w" "$llave_r"

    log INFO "5/7 sshd endurecido (puerto ${SGRSI_SSH_PUERTO:-52205}) con bloque para '$USUARIO'"
    # shellcheck source=../../scripts/lib/ssh.sh
    source "$SGRSI_DIR/lib/ssh.sh"
    SGRSI_SSH_GRUPO="sgrsi-tecnicos $GRUPO"
    SGRSI_SSH_CONFIG_EXTRA="Match User $USUARIO
    AllowTcpForwarding no
    X11Forwarding no
    PermitTTY no
    AllowAgentForwarding no"
    export SGRSI_SSH_GRUPO SGRSI_SSH_CONFIG_EXTRA
    existe_grupo sgrsi-tecnicos || ejecutar groupadd sgrsi-tecnicos
    ssh_aplicar

    log INFO "6/7 Firewall: SSH solo desde produccion${ADMIN_CIDR:+ y desde $ADMIN_CIDR}"
    # shellcheck source=../../scripts/lib/firewall.sh
    source "$SGRSI_DIR/lib/firewall.sh"
    SGRSI_FW_PUERTOS_WEB=""
    SGRSI_FW_SSH_ORIGEN="$PROD_IP${ADMIN_CIDR:+ $ADMIN_CIDR}"
    SGRSI_FW_PROHIBIDOS="80 443 5432 3306"
    export SGRSI_FW_PUERTOS_WEB SGRSI_FW_SSH_ORIGEN SGRSI_FW_PROHIBIDOS
    firewall_aplicar_base

    log INFO "7/7 Rutinas (cron) y rotacion de logs"
    ejecutar install -o root -g root -m 644 "$AQUI/cron/sgrsi-respaldo-servidor" /etc/cron.d/sgrsi-respaldo-servidor
    if es_dry_run; then
        log INFO "[dry-run] Se instalaria /etc/logrotate.d/sgrsi-respaldo"
    else
        cat > /etc/logrotate.d/sgrsi-respaldo <<FIN_LR
/var/log/sgrsi-respaldo/*.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    su $USUARIO $GRUPO
    create 0660 $USUARIO $GRUPO
}
FIN_LR
    fi
    log INFO "Servidor de respaldo instalado. Falta (manual): registrar la huella del servidor en produccion y probar con 'admin.sh respaldo remoto probar'."
}

# authorized_keys: cada llave solo puede ejecutar rrsync sobre un directorio.
#  - escritura (produccion): rrsync -wo incoming/, solo desde PROD_IP
#  - lectura (tecnicos, para restaurar): rrsync -ro almacen/
# `restrict` desactiva pty, forwarding, X11 y agent; no queda shell.
instalar_llaves() {
    local llave_w="$1" llave_r="$2"
    local dir_ssh="$HOME_USUARIO/.ssh"
    local autorizadas="$dir_ssh/authorized_keys"
    local contenido=""

    if [[ -n "$llave_w" ]]; then
        [[ -f "$llave_w" ]] || { log ERROR "No existe '$llave_w'."; return 1; }
        ssh-keygen -l -f "$llave_w" >/dev/null 2>&1 || { log ERROR "'$llave_w' no es una llave publica valida."; return 1; }
        contenido+="from=\"$PROD_IP\",restrict,command=\"$RRSYNC -wo $BASE/incoming\" $(cat "$llave_w")"$'\n'
    else
        log WARN "Sin --llave-escritura: produccion todavia no puede enviar."
    fi
    if [[ -n "$llave_r" ]]; then
        [[ -f "$llave_r" ]] || { log ERROR "No existe '$llave_r'."; return 1; }
        ssh-keygen -l -f "$llave_r" >/dev/null 2>&1 || { log ERROR "'$llave_r' no es una llave publica valida."; return 1; }
        contenido+="${ADMIN_CIDR:+from=\"$ADMIN_CIDR\",}restrict,command=\"$RRSYNC -ro $BASE/almacen\" $(cat "$llave_r")"$'\n'
    else
        log WARN "Sin --llave-lectura: nadie podra traer corridas con 'respaldo remoto restaurar'."
    fi

    ejecutar install -d -o "$USUARIO" -g "$GRUPO" -m 700 "$dir_ssh"
    if es_dry_run; then
        log INFO "[dry-run] authorized_keys quedaria asi:"
        printf '%s' "$contenido" | sed 's/^/    | /' >&2
        return 0
    fi
    printf '%s' "$contenido" > "$autorizadas"
    chown "$USUARIO:$GRUPO" "$autorizadas"
    chmod 600 "$autorizadas"
}

# --- Recepcion ------------------------------------------------------------------

# ids_en <directorio>: nombres de subdirectorios con formato de corrida.
ids_en() {
    [[ -d "$1" ]] || return 0
    find "$1" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E "$PATRON_ESTRICTO" | sort || true
}

# procesar
# Para cada corrida en incoming/: espera a que deje de cambiar, comprueba las
# sumas y el gzip, y la promueve a almacen/ (rename atomico en el mismo
# filesystem). Una corrida que no pasa va a rechazados/ con el motivo en el log.
procesar() {
    adquirir_lock procesar || return $?
    local id dir fallos=0 ahora
    ahora="$(date +%s)"

    for id in $(ids_en "$BASE/incoming"); do
        dir="$BASE/incoming/$id"

        # Defensa: el origen es remoto. Fuera cualquier symlink o archivo raro.
        find "$dir" -type l -delete 2>/dev/null || true

        # Todavia esta llegando
        if [[ -n "$(find "$dir" -newermt "${ESTABLE_SEGUNDOS} seconds ago" -print -quit 2>/dev/null)" ]]; then
            log INFO "Corrida $id: sigue recibiendose, se revisa en la proxima pasada."
            continue
        fi

        if [[ ! -f "$dir/lux_${id}.sha256" ]]; then
            local edad_h=$(( (ahora - $(stat -c %Y "$dir")) / 3600 ))
            if (( edad_h >= INCOMPLETA_HORAS )); then
                log ERROR "Corrida $id incompleta hace ${edad_h} h (falta lux_${id}.sha256). Se mueve a rechazados."
                rechazar "$id" "incompleta"
                fallos=$((fallos + 1))
            else
                log INFO "Corrida $id: aun sin archivo de sumas (${edad_h} h)."
            fi
            continue
        fi

        rm -rf "$dir/.rsync-partial"
        if validar_corrida "$dir" "$id"; then
            if [[ -e "$BASE/almacen/$id" ]]; then
                log WARN "Corrida $id ya existe en el almacen. Se descarta la copia duplicada."
                rm -rf "$dir"
            else
                mv "$dir" "$BASE/almacen/$id"
                log INFO "Corrida $id verificada y almacenada."
            fi
        else
            rechazar "$id" "verificacion fallida"
            fallos=$((fallos + 1))
        fi
    done

    rotar
    [[ "$fallos" -eq 0 ]]
}

# validar_corrida <directorio> <id>: SHA-256 de todos los archivos y gzip -t del dump.
validar_corrida() {
    local dir="$1" id="$2"
    if ! (cd "$dir" && sha256sum --check --quiet "lux_${id}.sha256" 2>&1); then
        log ERROR "Corrida $id: las sumas SHA-256 NO coinciden."
        return 1
    fi
    if [[ ! -f "$dir/lux_${id}.sql.gz" ]]; then
        log ERROR "Corrida $id: no contiene el dump de la base."
        return 1
    fi
    if ! gzip -t "$dir/lux_${id}.sql.gz" 2>/dev/null; then
        log ERROR "Corrida $id: el dump no es un gzip valido."
        return 1
    fi
}

rechazar() {
    local id="$1" motivo="$2"
    local destino="$BASE/rechazados/$id"
    [[ -e "$destino" ]] && destino="${destino}.$(date +%s)"
    mv "$BASE/incoming/$id" "$destino"
    echo "$(date '+%Y-%m-%d %H:%M:%S') $motivo" > "$destino/MOTIVO.txt"
    log ERROR "Corrida $id rechazada ($motivo): $destino"
}

# --- Rotacion ---------------------------------------------------------------------

rotar() {
    local hoy borrar id n=0
    hoy="$(date '+%Y%m%d')"
    borrar="$(ids_en "$BASE/almacen" | rotacion_ids_a_borrar "$hoy" "$DIARIOS" "$SEMANAS")"
    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        ejecutar rm -rf -- "${BASE:?}/almacen/$id"
        n=$((n + 1))
    done <<<"$borrar"
    if [[ "$n" -gt 0 ]]; then
        log INFO "Rotacion: $n corrida(s) eliminadas del almacen ($DIARIOS dias + $SEMANAS semanas)."
    fi
}

# --- Verificacion y estado --------------------------------------------------------

# verificar: audita TODO el almacen. Detecta corrupcion silenciosa (bit rot).
verificar() {
    local id fallos=0 total=0
    for id in $(ids_en "$BASE/almacen"); do
        total=$((total + 1))
        if validar_corrida "$BASE/almacen/$id" "$id"; then
            log INFO "Corrida $id: integra."
        else
            fallos=$((fallos + 1))
        fi
    done
    if [[ "$total" -eq 0 ]]; then
        log ERROR "El almacen esta vacio: no hay nada que verificar."
        return 1
    fi
    if [[ "$fallos" -gt 0 ]]; then
        log ERROR "Auditoria: $fallos de $total corrida(s) con errores."
        return 1
    fi
    log INFO "Auditoria: $total corrida(s) integras."
}

estado() {
    local ultimo n uso
    ultimo="$(ids_en "$BASE/almacen" | tail -n 1)"
    n="$(ids_en "$BASE/almacen" | wc -l)"
    echo "Corridas en el almacen:  $n"
    echo "Rechazadas:              $(ids_en "$BASE/rechazados" | wc -l)"
    echo "En recepcion:            $(ids_en "$BASE/incoming" | wc -l)"
    uso="$(df --output=pcent "$BASE" 2>/dev/null | tail -n 1 | tr -dc '0-9')"
    echo "Uso del disco:           ${uso:-?}%"

    local rc=0
    if [[ -z "$ultimo" ]]; then
        log ERROR "No hay ninguna corrida en el almacen."
        return 1
    fi
    local fecha edad_h
    fecha="${ultimo:0:4}-${ultimo:4:2}-${ultimo:6:2} ${ultimo:9:2}:${ultimo:11:2}:${ultimo:13:2}"
    edad_h=$(( ($(date +%s) - $(date -d "$fecha" +%s)) / 3600 ))
    echo "Ultima corrida:          $ultimo (hace ${edad_h} h)"
    if (( edad_h > MAX_EDAD_HORAS )); then
        log ERROR "La ultima corrida tiene ${edad_h} h (maximo ${MAX_EDAD_HORAS} h): el origen dejo de enviar."
        rc=1
    fi
    if [[ -n "$uso" ]] && (( uso >= MAX_USO_PCT )); then
        log ERROR "El disco esta al ${uso}% (umbral ${MAX_USO_PCT}%)."
        rc=1
    fi
    return "$rc"
}

# --- Prueba de restauracion ---------------------------------------------------------

# probar_restauracion [id]
# Restaura el dump de una corrida en un PostgreSQL DESCARTABLE (contenedor
# efimero, sin puertos) y cuenta tablas y filas. Es la prueba de que lo
# almacenado sirve, hecha en el servidor de respaldo y no en produccion.
probar_restauracion() {
    local id="${1:-}"
    [[ -n "$id" ]] || id="$(ids_en "$BASE/almacen" | tail -n 1)"
    if [[ -z "$id" || ! "$id" =~ $PATRON_ESTRICTO ]]; then
        log ERROR "No hay corrida valida para restaurar (id: '${id:-}')."
        return 1
    fi
    local dump="$BASE/almacen/$id/lux_${id}.sql.gz"
    [[ -f "$dump" ]] || { log ERROR "No existe $dump"; return 1; }
    validar_corrida "$BASE/almacen/$id" "$id" || return 1

    requerir_comando podman podman || return 1
    # backup.sh aporta verificar_contenido (conteo de filas) y db_psql.
    # shellcheck source=../../scripts/backup.sh
    source "$SGRSI_DIR/backup.sh"

    local nombre="lux-restauracion-$$" clave tiempo_inicio
    clave="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"   # efimera, solo vive en este contenedor
    tiempo_inicio="$(date +%s)"
    log INFO "Levantando PostgreSQL descartable ($IMAGEN_PG)..."
    podman run -d --rm --name "$nombre" --network none \
        -e POSTGRES_PASSWORD="$clave" -e POSTGRES_DB=lux_restauracion "$IMAGEN_PG" >/dev/null
    # shellcheck disable=SC2064
    trap "podman stop -t 2 '$nombre' >/dev/null 2>&1 || true" RETURN

    local intento
    # shellcheck disable=SC2034  # solo cuenta los intentos
    for intento in $(seq 1 30); do
        podman exec "$nombre" pg_isready -U postgres -d lux_restauracion >/dev/null 2>&1 && break
        sleep 1
    done

    export SGRSI_DB_MODO=contenedor SGRSI_DB_CONTENEDOR="$nombre"
    log INFO "Restaurando $dump..."
    if ! gunzip -c "$dump" | db_psql postgres lux_restauracion >/dev/null 2>&1; then
        log ERROR "La restauracion de $id FALLO."
        return 1
    fi
    local resultado
    resultado="$(verificar_contenido postgres lux_restauracion)"
    log INFO "Restauracion de la corrida $id probada en $(( $(date +%s) - tiempo_inicio )) s."
    [[ "$resultado" == "0" ]]
}

ayuda() {
    cat <<'FIN_AYUDA'
Uso: servidor-respaldo.sh [--dry-run] <accion>

Acciones:
  instalar [--llave-escritura F.pub] [--llave-lectura F.pub]
                          Prepara el servidor (usuario, directorios, llaves
                          limitadas a rrsync, sshd, UFW, cron). Requiere SGRSI_PROD_IP.
  procesar                Valida lo recibido en incoming/ y lo pasa al almacen (cron: 10 min)
  rotar                   Aplica la rotacion 7 dias + 4 semanas al almacen
  verificar               Audita las sumas SHA-256 y el gzip de TODO el almacen
  estado                  Corridas, antiguedad, espacio (error si hay atraso o disco lleno)
  probar-restauracion [id]
                          Restaura una corrida en un PostgreSQL descartable y cuenta filas

Variables: SGRSI_RESP_BASE, SGRSI_PROD_IP, SGRSI_ADMIN_CIDR, SGRSI_SSH_PUERTO,
SGRSI_BACKUP_DIARIOS, SGRSI_BACKUP_SEMANAS, SGRSI_RESP_MAX_USO_PCT.
FIN_AYUDA
}

main() {
    if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
        export SGRSI_DRY_RUN=1
        shift
    fi
    cargar_config || exit $?
    instalar_trap_errores

    local accion="${1:-}"
    shift || true

    case "$accion" in
        instalar)             instalar "$@" ;;
        procesar)             procesar ;;
        rotar)                rotar ;;
        verificar)            verificar ;;
        estado)               estado ;;
        probar-restauracion)  probar_restauracion "$@" ;;
        ""|ayuda|-h|--help)   ayuda ;;
        *)
            log ERROR "Accion desconocida: '$accion'"
            ayuda
            exit 1
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
