#!/usr/bin/env bash
# backup.sh — Respaldo de la base de datos PostgreSQL del SGRSI (Lux).
# Pensado para invocarse manualmente o desde cron; no requiere una terminal
# interactiva salvo para restaurar, que si pide confirmacion.
#
# Issue: wefaber/eternum#77
# Documentado en: 05-ADMIN-SO/E2/RutinasBackup.md

set -euo pipefail

SGRSI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SGRSI_DIR
# shellcheck source=lib/comun.sh
source "$SGRSI_DIR/lib/comun.sh"

# --- Configuracion, sobreescribible por variables de entorno ---
readonly BACKUP_DIR="${SGRSI_BACKUP_DIR:-/var/backups/sgrsi}"
readonly RETENCION_DIAS="${SGRSI_BACKUP_RETENCION_DIAS:-14}"
readonly DB_NAME="${DB_NAME:-lux}"
readonly DB_USER="${DB_USER:-lux_app}"
readonly DB_HOST="${DB_HOST:-localhost}"
readonly DB_PORT="${DB_PORT:-5432}"
readonly CRON_ORIGEN="$SGRSI_DIR/cron/sgrsi-backup"
readonly CRON_DESTINO="/etc/cron.d/sgrsi-backup"

# requerir_herramienta <comando>
# pg_dump y psql no vienen instalados por defecto: si faltan, conviene decirlo
# de entrada en vez de fallar a mitad de un respaldo.
requerir_herramienta() {
    local herramienta="$1"
    if ! command -v "$herramienta" >/dev/null 2>&1; then
        log ERROR "No se encontro '$herramienta'. Instalar con: apt install postgresql-client"
        return 1
    fi
}

# respaldar
# Genera un dump comprimido con timestamp y verifica que no haya quedado
# vacio (un dump de 0 bytes indica una falla silenciosa de pg_dump que un
# `if` simple no detectaria, porque pg_dump puede devolver 0 igual).
respaldar() {
    requerir_herramienta pg_dump || exit 1
    mkdir -p "$BACKUP_DIR"

    local timestamp archivo
    timestamp="$(date '+%Y%m%d_%H%M%S')"
    archivo="$BACKUP_DIR/lux_${timestamp}.sql.gz"

    log INFO "Iniciando respaldo de '$DB_NAME' hacia $archivo"

    if ! PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
        --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
        --no-password --format=plain "$DB_NAME" | gzip > "$archivo"; then
        log ERROR "pg_dump fallo. Se elimina el archivo parcial."
        rm -f "$archivo"
        exit 1
    fi

    if [[ ! -s "$archivo" ]]; then
        log ERROR "El respaldo se genero vacio. Revisar credenciales y conectividad."
        rm -f "$archivo"
        exit 1
    fi

    # gzip -t detecta un archivo truncado por disco lleno o por una escritura
    # interrumpida, que si tiene tamano mayor a cero y pasaria el chequeo
    # anterior sin ser restaurable.
    if ! gzip -t "$archivo" 2>/dev/null; then
        log ERROR "El respaldo quedo corrupto (gzip -t fallo). Se elimina."
        rm -f "$archivo"
        exit 1
    fi

    log INFO "Respaldo completado: $archivo ($(du -h "$archivo" | cut -f1))"
}

# limpiar_antiguos
# Aplica la politica de retencion: elimina dumps con mas de RETENCION_DIAS
# dias de antiguedad. Se ejecuta despues de un respaldo exitoso, nunca antes,
# para no quedarse sin copias si el respaldo del dia falla.
limpiar_antiguos() {
    local eliminados
    eliminados="$(find "$BACKUP_DIR" -name 'lux_*.sql.gz' -mtime "+$RETENCION_DIAS" -print -delete | wc -l)"

    if [[ "$eliminados" -gt 0 ]]; then
        log INFO "Eliminados $eliminados respaldo(s) con mas de $RETENCION_DIAS dias."
    fi
}

# ultimo_respaldo
# Devuelve el dump mas reciente, usado por `verificar` cuando no se indica uno.
ultimo_respaldo() {
    find "$BACKUP_DIR" -name 'lux_*.sql.gz' -type f -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | head -1 | cut -d' ' -f2-
}

# restaurar <archivo.sql.gz>
# Restauracion manual, nunca automatica. Requiere confirmacion explicita
# porque sobreescribe la base de datos activa.
restaurar() {
    local archivo="${1:-}"
    validar_no_vacio "$archivo" "archivo" || return 1
    requerir_herramienta psql || return 1

    if [[ ! -f "$archivo" ]]; then
        log ERROR "El archivo '$archivo' no existe."
        return 1
    fi

    if ! gzip -t "$archivo" 2>/dev/null; then
        log ERROR "'$archivo' no es un gzip valido o esta corrupto. No se restaura."
        return 1
    fi

    confirmar "Restaurar '$archivo' sobre la base '$DB_NAME', sobreescribiendo su contenido actual" || {
        log INFO "Restauracion cancelada."
        return 0
    }

    log WARN "Restaurando $archivo sobre '$DB_NAME'..."

    # ON_ERROR_STOP es lo que hace que un error de SQL a mitad del volcado
    # aborte la restauracion. Sin esa opcion psql informa el error, sigue con
    # la sentencia siguiente y termina con codigo 0: una restauracion a medias
    # se reportaria como exitosa.
    if ! gunzip -c "$archivo" | PGPASSWORD="${DB_PASSWORD:-}" psql \
        --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
        --no-password --quiet -v ON_ERROR_STOP=1 "$DB_NAME"; then
        log ERROR "La restauracion fallo. La base '$DB_NAME' puede haber quedado a medio restaurar."
        return 1
    fi

    log INFO "Restauracion completada."
}

# verificar [archivo]
# Restaura el dump contra una base de prueba descartable y cuenta las tablas
# recuperadas. Es la unica comprobacion que demuestra que el respaldo sirve:
# ni el tamano del archivo ni el codigo de salida de pg_dump lo garantizan.
verificar() {
    local archivo="${1:-}"
    requerir_herramienta psql || return 1

    if [[ -z "$archivo" ]]; then
        archivo="$(ultimo_respaldo)"
        if [[ -z "$archivo" ]]; then
            log ERROR "No hay respaldos en $BACKUP_DIR para verificar."
            return 1
        fi
        log INFO "Verificando el respaldo mas reciente: $archivo"
    fi

    if [[ ! -f "$archivo" ]]; then
        log ERROR "El archivo '$archivo' no existe."
        return 1
    fi

    local base_prueba="lux_verificacion_$$"
    local psql_base=(psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --no-password --quiet)

    export PGPASSWORD="${DB_PASSWORD:-}"

    log INFO "Creando base de verificacion '$base_prueba'..."
    if ! "${psql_base[@]}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $base_prueba;" >/dev/null; then
        log ERROR "No se pudo crear la base de verificacion."
        return 1
    fi

    local resultado=0
    if gunzip -c "$archivo" | "${psql_base[@]}" -d "$base_prueba" -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
        local tablas
        tablas="$("${psql_base[@]}" -d "$base_prueba" -t -A -c \
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
        if [[ "${tablas:-0}" -gt 0 ]]; then
            log INFO "Respaldo verificado: restauro sin errores y contiene $tablas tabla(s)."
        else
            log ERROR "El respaldo restauro sin errores pero no contiene ninguna tabla."
            resultado=1
        fi
    else
        log ERROR "El respaldo no se pudo restaurar. NO sirve para recuperacion."
        resultado=1
    fi

    "${psql_base[@]}" -d postgres -c "DROP DATABASE IF EXISTS $base_prueba;" >/dev/null 2>&1 || \
        log WARN "No se pudo eliminar la base de verificacion '$base_prueba'. Eliminarla a mano."

    return "$resultado"
}

listar() {
    log INFO "Respaldos disponibles en $BACKUP_DIR:"
    ls -lh "$BACKUP_DIR"/lux_*.sql.gz 2>/dev/null || echo "  (ninguno todavia)"
}

# instalar_cron
# Copia el fragmento versionado a /etc/cron.d. Se versiona el archivo en el
# repositorio en vez de documentar una linea para pegar a mano, para que la
# programacion del respaldo quede bajo control de versiones como el resto.
instalar_cron() {
    requerir_root

    if [[ ! -f "$CRON_ORIGEN" ]]; then
        log ERROR "No se encontro $CRON_ORIGEN"
        return 1
    fi

    # cron descarta en silencio las lineas cuyo usuario no existe: se avisa
    # aca, porque si no el respaldo simplemente no corre y nadie se entera
    # hasta que hace falta restaurar.
    local usuario_cron
    usuario_cron="$(awk '$1 !~ /^#/ && NF >= 7 { print $6; exit }' "$CRON_ORIGEN")"
    if [[ -n "$usuario_cron" ]] && ! existe_usuario "$usuario_cron"; then
        log WARN "La rutina corre como '$usuario_cron', cuenta que no existe en este sistema."
        log WARN "Crearla con: admin.sh usuarios alta $usuario_cron 'Cuenta de servicio SGRSI'"
    fi

    install -o root -g root -m 644 "$CRON_ORIGEN" "$CRON_DESTINO"
    log INFO "Rutina instalada en $CRON_DESTINO"
    log INFO "Contenido:"
    grep -v '^#' "$CRON_DESTINO" | grep -v '^$' | sed 's/^/  /' >&2

    mkdir -p /var/log/sgrsi
    log INFO "Verificar con: run-parts --test /etc/cron.d 2>/dev/null; systemctl status cron"
}

ayuda() {
    cat <<FIN_AYUDA
Uso: backup.sh <accion> [argumentos]

Acciones:
  respaldar              Genera un dump comprimido y aplica la retencion
  restaurar <archivo>    Restaura un dump sobre la base activa (pide confirmacion)
  verificar [archivo]    Restaura contra una base descartable para probar el dump
  listar                 Lista los respaldos existentes
  instalar-cron          Instala la rutina diaria en /etc/cron.d/sgrsi-backup

Variables de entorno relevantes: DB_HOST, DB_PORT, DB_NAME, DB_USER,
DB_PASSWORD, SGRSI_BACKUP_DIR, SGRSI_BACKUP_RETENCION_DIAS.

Respaldo diario a las 03:00 via cron; ver cron/sgrsi-backup y la seccion 3.2
de 05-ADMIN-SO/E2/RutinasBackup.md.
FIN_AYUDA
}

main() {
    local accion="${1:-}"
    shift || true

    case "$accion" in
        respaldar)      respaldar && limpiar_antiguos ;;
        restaurar)      restaurar "$@" ;;
        verificar)      verificar "$@" ;;
        listar)         listar ;;
        instalar-cron)  instalar_cron ;;
        ""|ayuda|-h|--help) ayuda ;;
        *)
            log ERROR "Accion desconocida: '$accion'"
            ayuda
            exit 1
            ;;
    esac
}

main "$@"
