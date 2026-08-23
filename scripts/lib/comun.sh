#!/usr/bin/env bash
# comun.sh — Funciones compartidas por todos los modulos del script de
# administracion del SGRSI (Lux). Ningun modulo implementa su propio logging
# ni su propio manejo de errores: todos incluyen este archivo con `source`.
#
# Issue: wefaber/eternum#78
# Documentado en: 05-ADMIN-SO/E2/Scripts-Bash-V1.md

set -euo pipefail

# Guarda de carga: comun.sh puede quedar incluido dos veces cuando un modulo
# se sourcea de forma independiente dentro de una sesion que ya cargo el
# despachador. Sin esta guarda, la segunda carga aborta al reasignar las
# variables declaradas como readonly mas abajo.
if [[ -n "${SGRSI_COMUN_CARGADO:-}" ]]; then
    # shellcheck disable=SC2317  # el `exit` solo corre si el archivo se ejecuta en vez de sourcearse
    return 0 2>/dev/null || exit 0
fi
readonly SGRSI_COMUN_CARGADO=1

# Ruta del log de operaciones administrativas. Se puede redirigir con la
# variable de entorno SGRSI_LOG, que es lo que hace la suite de pruebas para
# no requerir privilegios sobre /var/log.
SGRSI_LOG="${SGRSI_LOG:-/var/log/sgrsi/admin.log}"
readonly SGRSI_LOG
SGRSI_LOG_DIR="$(dirname "$SGRSI_LOG")"
readonly SGRSI_LOG_DIR

# Colores para salida en terminal interactiva. Se desactivan si la salida no
# es una terminal (por ejemplo, cuando el script corre desde cron).
if [[ -t 2 ]]; then
    readonly C_ROJO='\033[0;31m'
    readonly C_VERDE='\033[0;32m'
    readonly C_AMARILLO='\033[0;33m'
    readonly C_RESET='\033[0m'
else
    readonly C_ROJO=''
    readonly C_VERDE=''
    readonly C_AMARILLO=''
    readonly C_RESET=''
fi

# log <nivel> <mensaje>
# Escribe en stderr con color y ademas en el log del sistema, con timestamp.
# Los tres niveles admitidos son INFO, WARN y ERROR.
log() {
    local nivel="${1:-}"
    shift || true
    local mensaje="$*"
    local color=""
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"

    case "$nivel" in
        INFO)  color="$C_VERDE" ;;
        WARN)  color="$C_AMARILLO" ;;
        ERROR) color="$C_ROJO" ;;
        *)
            echo "log: nivel desconocido '$nivel'" >&2
            return 1
            ;;
    esac

    echo -e "${color}[$nivel]${C_RESET} $mensaje" >&2

    if [[ -d "$SGRSI_LOG_DIR" ]] || mkdir -p "$SGRSI_LOG_DIR" 2>/dev/null; then
        echo "$timestamp [$nivel] $mensaje" >> "$SGRSI_LOG" 2>/dev/null || true
    fi
}

# requerir_root
# Aborta con mensaje claro si el script no corre como root. La mayoria de los
# modulos (usuarios, grupos, ssh) modifican archivos del sistema y requieren
# privilegios; centralizar la verificacion evita repetirla en cada modulo.
requerir_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        log ERROR "Este modulo requiere privilegios de administrador. Ejecutar con sudo."
        exit 1
    fi
}

# confirmar <pregunta>
# Pide confirmacion interactiva antes de una operacion irreversible. Devuelve
# 0 (exito) si el usuario confirma, 1 en caso contrario. Se salta la
# confirmacion si la variable SGRSI_SIN_CONFIRMACION esta en "true", para
# permitir uso no interactivo desde otros scripts o desde cron.
confirmar() {
    local pregunta="${1:-Confirmar}"

    if [[ "${SGRSI_SIN_CONFIRMACION:-false}" == "true" ]]; then
        return 0
    fi

    # Sin terminal de entrada no hay a quien preguntar: se rechaza la
    # operacion en vez de bloquear el script esperando un `read` que nunca
    # va a recibir respuesta.
    if [[ ! -t 0 ]]; then
        log ERROR "Se requiere confirmacion pero no hay terminal interactiva. Usar SGRSI_SIN_CONFIRMACION=true si la operacion es deliberada."
        return 1
    fi

    local respuesta
    read -r -p "$pregunta [s/N] " respuesta
    [[ "$respuesta" =~ ^[sS]$ ]]
}

# validar_no_vacio <valor> <nombre_campo>
# Rechaza un argumento vacio con un mensaje que identifica el campo, en lugar
# de dejar que el error aparezca mas adelante como un fallo confuso de useradd
# o de groupadd.
validar_no_vacio() {
    local valor="${1:-}"
    local nombre_campo="${2:-argumento}"

    if [[ -z "$valor" ]]; then
        log ERROR "El campo '$nombre_campo' es obligatorio."
        return 1
    fi
}

# existe_usuario <usuario> / existe_grupo <grupo>
# Consultas de existencia usadas por varios modulos. Viven aca para que la
# comprobacion sea identica en todos y no se repita con variantes.
existe_usuario() {
    id "${1:-}" &>/dev/null
}

existe_grupo() {
    getent group "${1:-}" &>/dev/null
}
