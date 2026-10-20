#!/usr/bin/env bash
# comun.sh: Funciones compartidas por todos los modulos del script de
# administracion del SGRSI (Lux). Ningun modulo implementa su propio logging
# ni su propio manejo de errores: todos incluyen este archivo con `source`.
#
# Version final (E3): agrega modo --dry-run, reintentos con espera creciente,
# bloqueo contra ejecuciones simultaneas, carga de configuracion externa,
# lectura de secretos fuera de los argumentos y validadores de entrada.
#
# Issue: wefaber/eternum#78 (base) y #109 (version final)
# Documentado en: 05-ADMIN-SO/E3/Script-Final.md

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

# Raiz del repositorio (donde viven scripts/ y ops/). Se deduce de la ubicacion
# de este archivo (scripts/lib/comun.sh), asi funciona igual en /opt/sgrsi/lux
# que en un clon de desarrollo.
SGRSI_RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly SGRSI_RAIZ
export SGRSI_RAIZ

# Codigos de salida compartidos (convencion sysexits.h donde aplica).
# shellcheck disable=SC2034  # parte de la convencion; lo usan los modulos
readonly SGRSI_EX_USO=2        # uso incorrecto del comando
readonly SGRSI_EX_TEMP=75      # fallo temporal: reintentar mas tarde (destino remoto caido)
readonly SGRSI_EX_CONFIG=78    # configuracion ausente o invalida

# Ruta del log de operaciones administrativas. Se puede redirigir con la
# variable de entorno SGRSI_LOG, que es lo que hacen las pruebas para no
# requerir privilegios sobre /var/log.
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

# --- Modo dry-run ------------------------------------------------------------

# es_dry_run
# Verdadero si SGRSI_DRY_RUN vale 1 o true. admin.sh lo activa con --dry-run.
# En este modo ninguna accion que modifique el sistema se ejecuta: se informa
# que se haria. Es lo que permite probar usuarios, UFW, red y SSH sin tocar
# la maquina donde corren las pruebas.
es_dry_run() {
    [[ "${SGRSI_DRY_RUN:-0}" == "1" || "${SGRSI_DRY_RUN:-}" == "true" ]]
}

# ejecutar <comando> [argumentos...]
# Unico punto por el que pasan los comandos que modifican el sistema. En
# dry-run imprime el comando y devuelve 0; fuera de dry-run lo ejecuta tal
# cual. Los argumentos no se reinterpretan (no hay eval).
ejecutar() {
    if es_dry_run; then
        log INFO "[dry-run] $*"
        return 0
    fi
    "$@"
}

# hecho <mensaje>
# Informa un resultado ya conseguido ("usuario creado"). En dry-run no se dice
# nada, porque no paso: ejecutar() ya mostro lo que se haria.
hecho() {
    es_dry_run && return 0
    log INFO "$@"
}

# --- Logging -----------------------------------------------------------------

_SGRSI_LOG_AVISADO=0

# log <nivel> <mensaje>
# Escribe en stderr con color y ademas en el log del sistema, con timestamp.
# Los tres niveles admitidos son INFO, WARN y ERROR.
# Si el log no se puede escribir se avisa una sola vez por stderr (antes el
# fallo era silencioso y las corridas de cron quedaban sin registro). En
# dry-run no se escribe el archivo.
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

    if es_dry_run; then
        return 0
    fi

    if [[ -d "$SGRSI_LOG_DIR" ]] || mkdir -p "$SGRSI_LOG_DIR" 2>/dev/null; then
        if echo "$timestamp [$nivel] $mensaje" >> "$SGRSI_LOG" 2>/dev/null; then
            return 0
        fi
    fi

    if [[ "$_SGRSI_LOG_AVISADO" -eq 0 ]]; then
        _SGRSI_LOG_AVISADO=1
        echo -e "${C_AMARILLO}[WARN]${C_RESET} No se puede escribir el log '$SGRSI_LOG'. Los mensajes solo salen por pantalla." >&2
    fi
    return 0
}

# --- Privilegios y confirmacion ----------------------------------------------

# requerir_root
# Aborta con mensaje claro si el script no corre como root. La mayoria de los
# modulos modifican archivos del sistema y requieren privilegios; centralizar
# la verificacion evita repetirla en cada modulo. En dry-run no se exige:
# nada se va a modificar, y asi se puede ensayar sin sudo.
requerir_root() {
    if es_dry_run; then
        return 0
    fi
    if [[ "$(id -u)" -ne 0 ]]; then
        log ERROR "Este modulo requiere privilegios de administrador. Ejecutar con sudo."
        exit 1
    fi
}

# confirmar <pregunta>
# Pide confirmacion interactiva antes de una operacion irreversible. Devuelve
# 0 (exito) si el usuario confirma, 1 en caso contrario. Se salta la
# confirmacion si la variable SGRSI_SIN_CONFIRMACION esta en "true", para
# permitir uso no interactivo desde otros scripts o desde cron. En dry-run
# se da por confirmada, porque no hay nada que perder.
confirmar() {
    local pregunta="${1:-Confirmar}"

    if [[ "${SGRSI_SIN_CONFIRMACION:-false}" == "true" ]] || es_dry_run; then
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

# --- Validaciones de entrada -------------------------------------------------

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

# validar_nombre <valor> <campo>
# Nombres de usuario, grupo, rol o base: minusculas, digitos, guion y guion
# bajo, hasta 32 caracteres, sin empezar por digito. Evita que un valor con
# espacios o metacaracteres llegue a un comando o a una sentencia SQL.
validar_nombre() {
    local valor="${1:-}"
    local campo="${2:-nombre}"
    if [[ ! "$valor" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
        log ERROR "El campo '$campo' no es un nombre valido: '$valor' (minusculas, digitos, '-' y '_', max. 32)."
        return 1
    fi
}

# validar_ipv4 <valor> <campo>
validar_ipv4() {
    local valor="${1:-}"
    local campo="${2:-ip}"
    local octeto
    if [[ ! "$valor" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
        log ERROR "El campo '$campo' no es una direccion IPv4 valida: '$valor'"
        return 1
    fi
    local IFS=.
    for octeto in $valor; do
        if ((10#$octeto > 255)); then
            log ERROR "El campo '$campo' tiene un octeto fuera de rango: '$valor'"
            return 1
        fi
    done
}

# validar_prefijo <valor> <campo>   (longitud de mascara 8 a 30)
validar_prefijo() {
    local valor="${1:-}"
    local campo="${2:-prefijo}"
    if [[ ! "$valor" =~ ^[0-9]{1,2}$ ]] || ((10#$valor < 8 || 10#$valor > 30)); then
        log ERROR "El campo '$campo' debe ser un prefijo entre 8 y 30: '$valor'"
        return 1
    fi
}

# validar_puerto <valor> <campo>
validar_puerto() {
    local valor="${1:-}"
    local campo="${2:-puerto}"
    if [[ ! "$valor" =~ ^[0-9]{1,5}$ ]] || ((10#$valor < 1 || 10#$valor > 65535)); then
        log ERROR "El campo '$campo' no es un puerto valido: '$valor'"
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

# --- Dependencias, configuracion y secretos ---------------------------------

# requerir_comando <comando> [paquete]
# Falla con el nombre del paquete a instalar si falta una herramienta.
requerir_comando() {
    local comando="${1:-}"
    local paquete="${2:-$comando}"
    if ! command -v "$comando" >/dev/null 2>&1; then
        log ERROR "No se encontro '$comando'. Instalar con: apt install $paquete"
        return 1
    fi
}

# cargar_config
# Carga el archivo de configuracion (solo asignaciones de variables, sin
# secretos). Orden de busqueda: $SGRSI_CONF, /etc/sgrsi/sgrsi.conf. Si no hay
# archivo se usan los valores por defecto de cada modulo. El archivo se
# ejecuta con `source` como root, asi que se rechaza si pertenece a otro
# usuario o es escribible por el grupo o por todos.
cargar_config() {
    local archivo="${SGRSI_CONF:-/etc/sgrsi/sgrsi.conf}"
    [[ -f "$archivo" ]] || return 0

    local dueno modo
    dueno="$(stat -c '%u' "$archivo")"
    modo="$(stat -c '%a' "$archivo")"
    if [[ "$dueno" != "$(id -u)" && "$dueno" != "0" ]]; then
        log ERROR "El archivo de configuracion '$archivo' no pertenece a root ni al usuario actual. No se carga."
        return "$SGRSI_EX_CONFIG"
    fi
    if (( (8#$modo & 8#022) != 0 )); then
        log ERROR "El archivo de configuracion '$archivo' es escribible por otros (modo $modo). No se carga."
        return "$SGRSI_EX_CONFIG"
    fi
    # shellcheck disable=SC1090
    source "$archivo"
}

# leer_secreto <NOMBRE_VARIABLE>
# Devuelve por stdout un secreto sin pasarlo nunca por argumentos de linea de
# comandos (visibles en `ps`). Orden: variable de entorno NOMBRE, o archivo
# indicado por NOMBRE_FILE (debe tener modo 600 o mas restrictivo).
leer_secreto() {
    local nombre="${1:-}"
    local archivo_var="${nombre}_FILE"
    local valor="${!nombre:-}"
    local archivo="${!archivo_var:-}"

    if [[ -n "$valor" ]]; then
        printf '%s' "$valor"
        return 0
    fi
    if [[ -n "$archivo" ]]; then
        if [[ ! -r "$archivo" ]]; then
            log ERROR "No se puede leer el archivo de secreto '$archivo' ($archivo_var)."
            return 1
        fi
        if (( (8#$(stat -c '%a' "$archivo") & 8#077) != 0 )); then
            log ERROR "El archivo de secreto '$archivo' debe tener modo 600."
            return 1
        fi
        head -n 1 "$archivo" | tr -d '\r\n'
        return 0
    fi
    log ERROR "Falta el secreto: definir $nombre o $archivo_var."
    return 1
}

# --- Resiliencia -------------------------------------------------------------

# reintentar <intentos> <espera_inicial_s> <comando...>
# Ejecuta el comando hasta `intentos` veces, duplicando la espera entre
# intentos (backoff exponencial). Devuelve el codigo del ultimo intento. La
# espera usa ${SGRSI_SLEEP:-sleep}, que las pruebas reemplazan por `true`.
reintentar() {
    local intentos="${1:-3}"
    local espera="${2:-2}"
    shift 2
    local n=1 rc=0
    while true; do
        rc=0
        "$@" || rc=$?
        [[ "$rc" -eq 0 ]] && return 0
        if [[ "$n" -ge "$intentos" ]]; then
            log ERROR "Fallo tras $n intento(s): $*"
            return "$rc"
        fi
        log WARN "Intento $n/$intentos fallo (codigo $rc). Reintento en ${espera}s: $*"
        ${SGRSI_SLEEP:-sleep} "$espera"
        espera=$((espera * 2))
        n=$((n + 1))
    done
}

# adquirir_lock <nombre>
# Evita dos ejecuciones simultaneas de la misma rutina (por ejemplo, dos
# respaldos pisandose). Usa flock sobre un descriptor que queda abierto hasta
# que termina el proceso. Si no se puede crear el archivo en /run/lock, cae a
# un directorio temporal del usuario.
adquirir_lock() {
    local nombre="${1:-sgrsi}"
    local dir="${SGRSI_LOCK_DIR:-/run/lock}"
    [[ -w "$dir" ]] || dir="${TMPDIR:-/tmp}"
    requerir_comando flock util-linux || return 1
    exec {SGRSI_LOCK_FD}>"$dir/sgrsi-$nombre.lock"
    if ! flock -n "$SGRSI_LOCK_FD"; then
        log ERROR "Ya hay otra ejecucion de '$nombre' en curso ($dir/sgrsi-$nombre.lock)."
        return "$SGRSI_EX_TEMP"
    fi
}

# instalar_trap_errores
# Registra un trap ERR que informa archivo y linea del comando que fallo. No
# reemplaza al manejo explicito de errores de cada funcion: es la red de
# seguridad para lo que no se previo.
instalar_trap_errores() {
    set -E
    trap '_sgrsi_error_inesperado $? "${BASH_SOURCE[0]##*/}" "$LINENO" "$BASH_COMMAND"' ERR
}

_sgrsi_error_inesperado() {
    # Un `return N` o `exit N` explicito ya informo su motivo con log ERROR;
    # el trap solo debe hablar de lo que nadie previo.
    case "$4" in
        return*|exit*) return 0 ;;
    esac
    log ERROR "Error inesperado (codigo $1) en ${2}:${3}: $4"
}

# --- Contenedores (Podman rootless) -----------------------------------------

# asegurar_sesion_stack
# Podman rootless necesita /run/user/<uid> (XDG_RUNTIME_DIR). Una cuenta de
# servicio sin sesion abierta no lo tiene, y `podman info` falla ("lstat
# /run/user/<uid>"). Con "linger" systemd lo crea y lo mantiene; es lo mismo que
# deja `deploy unidad`, pero hace falta ya en el primer `deploy up`.
asegurar_sesion_stack() {
    local usuario="${SGRSI_STACK_USUARIO-sgrsi}" uid
    if [[ -z "$usuario" || "$(id -u)" -ne 0 ]] || ! existe_usuario "$usuario"; then
        return 0
    fi
    uid="$(id -u "$usuario")"
    [[ -d "/run/user/$uid" ]] && return 0

    log INFO "'$usuario' no tiene sesion de systemd: se habilita linger para crear /run/user/$uid."
    loginctl enable-linger "$usuario" || return 1
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        [[ -d "/run/user/$uid" ]] && return 0
        ${SGRSI_SLEEP:-sleep} 1
    done
    log ERROR "No se creo /run/user/$uid despues de habilitar linger para '$usuario'."
    return 1
}

# podman_stack <argumentos de podman...>
# Ejecuta podman como el usuario de servicio que corre el stack rootless
# (SGRSI_STACK_USUARIO, por defecto "sgrsi"). Si ya somos ese usuario, o la
# cuenta no existe (maquina de desarrollo), corre como el usuario actual. Nunca
# cambia a root: el stack no debe correr con privilegios.
podman_stack() {
    local usuario="${SGRSI_STACK_USUARIO-sgrsi}"
    local actual
    actual="$(id -un)"

    if [[ -z "$usuario" || "$actual" == "$usuario" ]] || ! existe_usuario "$usuario"; then
        podman "$@"
    elif [[ "$(id -u)" -eq 0 ]]; then
        # cd /: runuser conserva el directorio actual, y el home de quien invoca
        # (modo 700 en Debian) no es accesible para la cuenta del stack.
        (cd / && runuser -u "$usuario" -- env XDG_RUNTIME_DIR="/run/user/$(id -u "$usuario")" podman "$@")
    else
        log ERROR "Para administrar los contenedores hay que ser '$usuario' o root (sudo)."
        return 1
    fi
}

# comando_compose
# Imprime el proveedor de compose. `podman compose` es solo un envoltorio que
# delega en "docker-compose" si esta instalado (y ese necesita el socket de la
# API de Podman) o, si no, en podman-compose. Para que el resultado no dependa
# de que paquetes haya, se prefiere llamar a podman-compose directamente.
# SGRSI_COMPOSE_PROVEEDOR ("podman-compose" o "podman compose") lo fuerza.
comando_compose() {
    case "${SGRSI_COMPOSE_PROVEEDOR:-}" in
        "podman-compose"|"podman compose") echo "$SGRSI_COMPOSE_PROVEEDOR"; return 0 ;;
        "") ;;
        *) log ERROR "SGRSI_COMPOSE_PROVEEDOR invalido: '$SGRSI_COMPOSE_PROVEEDOR' (podman-compose o 'podman compose')."; return "$SGRSI_EX_CONFIG" ;;
    esac
    if command -v podman-compose >/dev/null 2>&1; then
        echo "podman-compose"
    elif podman compose version >/dev/null 2>&1; then
        echo "podman compose"
    else
        log ERROR "No hay proveedor de compose. Instalar con: apt install podman-compose"
        return 1
    fi
}

# compose_stack <argumentos de compose...>
# Ejecuta compose (podman compose o podman-compose) como el usuario del stack.
compose_stack() {
    local proveedor
    proveedor="$(comando_compose)" || return 1
    if [[ "$proveedor" == "podman compose" ]]; then
        podman_stack compose "$@"
        return
    fi
    local usuario="${SGRSI_STACK_USUARIO-sgrsi}"
    if [[ -z "$usuario" || "$(id -un)" == "$usuario" ]] || ! existe_usuario "$usuario"; then
        podman-compose "$@"
    elif [[ "$(id -u)" -eq 0 ]]; then
        (cd / && runuser -u "$usuario" -- env XDG_RUNTIME_DIR="/run/user/$(id -u "$usuario")" podman-compose "$@")
    else
        log ERROR "Para administrar los contenedores hay que ser '$usuario' o root (sudo)."
        return 1
    fi
}
