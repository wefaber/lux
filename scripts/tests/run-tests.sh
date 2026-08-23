#!/usr/bin/env bash
# run-tests.sh — Suite de pruebas funcionales de los scripts de
# administracion del SGRSI. Ejecuta cada modulo contra el sistema real
# (useradd, groupadd, sshd, pg_dump) usando entidades con prefijo propio que
# se eliminan al terminar.
#
# Uso:  sudo ./tests/run-tests.sh
#
# Requiere root y un sistema Linux con las herramientas de shadow. Las
# pruebas de base de datos se saltan solas si no hay un PostgreSQL accesible,
# para que la suite siga sirviendo en una maquina de desarrollo.
#
# Issues: wefaber/eternum#75, #77, #78

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly TESTS_DIR
SCRIPTS_DIR="$(dirname "$TESTS_DIR")"
readonly SCRIPTS_DIR
readonly ADMIN="$SCRIPTS_DIR/admin.sh"
readonly BACKUP="$SCRIPTS_DIR/backup.sh"

# Entidades de prueba. El prefijo evita cualquier colision con cuentas reales
# del servidor y hace obvio que se pueden borrar.
readonly U1="sgrsitest1"
readonly U2="sgrsitest2"
readonly G1="sgrsitest-grupo"

TMP="$(mktemp -d)"
export SGRSI_LOG="$TMP/admin.log"
export SGRSI_SIN_CONFIRMACION=true

PASADAS=0
FALLADAS=0
SALTADAS=0

verde() { printf '\033[0;32m%s\033[0m\n' "$1"; }
rojo()  { printf '\033[0;31m%s\033[0m\n' "$1"; }
gris()  { printf '\033[0;90m%s\033[0m\n' "$1"; }

ok()     { PASADAS=$((PASADAS + 1)); verde "  ok    $1"; }
falla()  { FALLADAS=$((FALLADAS + 1)); rojo  "  FALLA $1"; [[ -n "${2:-}" ]] && echo "        $2"; }
salta()  { SALTADAS=$((SALTADAS + 1)); gris  "  salta $1 ($2)"; }

seccion() { echo; echo "── $1"; }

# afirmar_exito <descripcion> <comando...>
afirmar_exito() {
    local desc="$1"; shift
    local salida
    if salida="$("$@" 2>&1)"; then
        ok "$desc"
    else
        falla "$desc" "codigo $? — $salida"
    fi
}

# afirmar_falla <descripcion> <comando...>
# Verifica que el comando termine con codigo distinto de cero. Un script que
# se equivoca en silencio es peor que uno que falla, asi que las rutas de
# error se prueban igual que las de exito.
afirmar_falla() {
    local desc="$1"; shift
    local salida
    if salida="$("$@" 2>&1)"; then
        falla "$desc" "termino con exito y se esperaba un error — $salida"
    else
        ok "$desc"
    fi
}

# afirmar_contiene <descripcion> <texto> <comando...>
afirmar_contiene() {
    local desc="$1" texto="$2"; shift 2
    local salida
    salida="$("$@" 2>&1)"
    if grep -qF -- "$texto" <<<"$salida"; then
        ok "$desc"
    else
        falla "$desc" "no aparece '$texto' en la salida"
    fi
}

# afirmar_no_contiene <descripcion> <texto> <comando...>
afirmar_no_contiene() {
    local desc="$1" texto="$2"; shift 2
    local salida
    salida="$("$@" 2>&1)"
    if grep -qF -- "$texto" <<<"$salida"; then
        falla "$desc" "aparece '$texto' y no deberia"
    else
        ok "$desc"
    fi
}

# shellcheck disable=SC2317  # se invoca desde el trap EXIT
limpiar() {
    userdel --remove "$U1" &>/dev/null || true
    userdel --remove "$U2" &>/dev/null || true
    groupdel "$G1" &>/dev/null || true
    rm -rf "$TMP"
}
trap limpiar EXIT

# --- Requisitos ---
if [[ "$(uname -s)" != "Linux" ]]; then
    rojo "Esta suite requiere Linux (usa useradd, groupadd, getent)."
    exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
    rojo "Esta suite requiere root. Ejecutar: sudo $0"
    exit 1
fi

echo "Suite de pruebas — scripts de administracion SGRSI"
echo "Scripts: $SCRIPTS_DIR"
echo "Log de prueba: $SGRSI_LOG"

# Estado limpio por si una corrida anterior quedo a medias.
limpiar_previo() {
    userdel --remove "$U1" &>/dev/null || true
    userdel --remove "$U2" &>/dev/null || true
    groupdel "$G1" &>/dev/null || true
}
limpiar_previo
mkdir -p "$TMP"

seccion "Despachador (admin.sh) — issue #78"
afirmar_exito     "sin argumentos muestra la ayuda general"        "$ADMIN"
afirmar_contiene  "la ayuda lista los modulos disponibles"         "Modulos disponibles" "$ADMIN"
afirmar_contiene  "la ayuda incluye el modulo ssh"                 "ssh " "$ADMIN" ayuda
afirmar_falla     "un modulo inexistente termina con error"        "$ADMIN" moduloquenoexiste
afirmar_contiene  "un modulo inexistente muestra la ayuda"         "Modulos disponibles" "$ADMIN" moduloquenoexiste

seccion "Modulo usuarios — issue #78"
afirmar_contiene  "usuarios ayuda lista los subcomandos"           "Subcomandos" "$ADMIN" usuarios ayuda
afirmar_falla     "subcomando desconocido termina con error"       "$ADMIN" usuarios noexiste
# Regresion: antes de la correccion, la falta de argumento producia el error
# crudo de bash "unbound variable" en vez del mensaje de validacion.
afirmar_contiene  "alta sin argumento explica que falta el campo"  "es obligatorio" "$ADMIN" usuarios alta
afirmar_no_contiene "alta sin argumento no filtra un error de bash" "unbound variable" "$ADMIN" usuarios alta
afirmar_falla     "alta sin argumento termina con error"           "$ADMIN" usuarios alta

afirmar_exito     "alta crea la cuenta"                            "$ADMIN" usuarios alta "$U1" "Cuenta de prueba"
afirmar_exito     "la cuenta creada existe en el sistema"          id "$U1"
afirmar_exito     "la cuenta creada tiene home"                    test -d "/home/$U1"
afirmar_falla     "alta duplicada es rechazada"                    "$ADMIN" usuarios alta "$U1" "Duplicada"
afirmar_contiene  "info muestra los grupos de la cuenta"           "Grupos:" "$ADMIN" usuarios info "$U1"
afirmar_contiene  "listar incluye la cuenta creada"                "$U1" "$ADMIN" usuarios listar
afirmar_falla     "info de una cuenta inexistente falla"           "$ADMIN" usuarios info sgrsitest-inexistente

# Regresion: `usermod --unlock` sobre una cuenta sin contrasena avisa por
# stderr pero termina con codigo 0. El script debe detectarlo en vez de
# informar un desbloqueo que no ocurrio.
afirmar_contiene  "desbloquear sin contrasena explica el motivo"   "no tiene contrasena" "$ADMIN" usuarios desbloquear "$U1"
afirmar_falla     "desbloquear sin contrasena no reporta exito"    "$ADMIN" usuarios desbloquear "$U1"
afirmar_contiene  "bloquear una cuenta ya bloqueada lo advierte"   "ya estaba bloqueado" "$ADMIN" usuarios bloquear "$U1"

# Con contrasena establecida el ciclo bloqueo/desbloqueo si es observable.
echo "$U1:claveDePrueba123" | chpasswd
afirmar_contiene  "la cuenta con contrasena figura utilizable (P)" " P " passwd -S "$U1"
afirmar_exito     "bloquear la cuenta"                             "$ADMIN" usuarios bloquear "$U1"
afirmar_contiene  "la cuenta queda marcada como bloqueada (L)"     " L " passwd -S "$U1"
afirmar_exito     "desbloquear la cuenta"                          "$ADMIN" usuarios desbloquear "$U1"
afirmar_contiene  "la cuenta vuelve a estar utilizable (P)"        " P " passwd -S "$U1"
afirmar_no_contiene "la cuenta ya no figura bloqueada"             " L " passwd -S "$U1"
afirmar_falla     "bloquear una cuenta inexistente falla"          "$ADMIN" usuarios bloquear sgrsitest-inexistente
afirmar_falla     "desbloquear una cuenta inexistente falla"       "$ADMIN" usuarios desbloquear sgrsitest-inexistente

seccion "Modulo grupos — issue #78"
afirmar_contiene  "grupos ayuda lista los subcomandos"             "Subcomandos" "$ADMIN" grupos ayuda
afirmar_falla     "subcomando desconocido termina con error"       "$ADMIN" grupos noexiste
afirmar_exito     "alta crea el grupo"                             "$ADMIN" grupos alta "$G1"
afirmar_exito     "el grupo creado existe"                         getent group "$G1"
afirmar_falla     "alta duplicada es rechazada"                    "$ADMIN" grupos alta "$G1"
afirmar_contiene  "miembros de un grupo vacio lo dice"             "(ninguno)" "$ADMIN" grupos miembros "$G1"
afirmar_exito     "agregar el usuario al grupo"                    "$ADMIN" grupos agregar "$U1" "$G1"
afirmar_contiene  "el usuario figura entre los miembros"           "$U1" "$ADMIN" grupos miembros "$G1"
afirmar_contiene  "el sistema confirma la membresia"               "$G1" id -nG "$U1"
afirmar_falla     "agregar un usuario inexistente falla"           "$ADMIN" grupos agregar sgrsitest-inexistente "$G1"
afirmar_falla     "agregar a un grupo inexistente falla"           "$ADMIN" grupos agregar "$U1" sgrsitest-grupo-inexistente
afirmar_exito     "quitar el usuario del grupo"                    "$ADMIN" grupos quitar "$U1" "$G1"
afirmar_no_contiene "el usuario ya no es miembro"                  "$G1" id -nG "$U1"
afirmar_falla     "quitar dos veces es rechazado"                  "$ADMIN" grupos quitar "$U1" "$G1"
afirmar_contiene  "listar incluye el grupo creado"                 "$G1" "$ADMIN" grupos listar
afirmar_exito     "baja elimina el grupo"                          "$ADMIN" grupos baja "$G1"
afirmar_falla     "el grupo ya no existe"                          getent group "$G1"

seccion "Invocacion independiente de los modulos — issue #78"
# El criterio de aceptacion pide que cada modulo se pueda usar sin pasar por
# el despachador; se comprueba sourceandolo en un shell aparte.
afirmar_contiene  "usuarios.sh funciona sourceado sin admin.sh"    "$U1" \
    bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; source '$SCRIPTS_DIR/lib/usuarios.sh'; usuarios_main listar"
afirmar_contiene  "grupos.sh funciona sourceado sin admin.sh"      "Subcomandos" \
    bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; source '$SCRIPTS_DIR/lib/grupos.sh'; grupos_main ayuda"
# Regresion: comun.sh declara variables readonly, cargarlo dos veces abortaba.
afirmar_exito     "comun.sh tolera cargarse dos veces"             \
    bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; source '$SCRIPTS_DIR/lib/comun.sh'; log INFO 'doble carga ok'"

seccion "Funciones compartidas (lib/comun.sh)"
afirmar_exito     "log escribe en el archivo de log"               \
    bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; log INFO 'linea de prueba'; grep -q 'linea de prueba' '$SGRSI_LOG'"
afirmar_falla     "log rechaza un nivel desconocido"               \
    bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; log RARO 'nivel invalido'"
# Regresion: sin terminal y sin SGRSI_SIN_CONFIRMACION, `read` colgaba el
# script esperando una respuesta que nunca llega.
afirmar_falla     "confirmar sin terminal no se cuelga y rechaza"  \
    bash -c "unset SGRSI_SIN_CONFIRMACION; source '$SCRIPTS_DIR/lib/comun.sh'; confirmar 'seguro' < /dev/null"

seccion "Modulo ssh — issue #75"
afirmar_contiene  "ssh ayuda lista los subcomandos"                "Subcomandos" "$ADMIN" ssh ayuda
afirmar_falla     "subcomando desconocido termina con error"       "$ADMIN" ssh noexiste
afirmar_contiene  "config deshabilita la autenticacion por clave"  "PasswordAuthentication no" "$ADMIN" ssh config
afirmar_contiene  "config habilita la autenticacion por llave"     "PubkeyAuthentication yes"  "$ADMIN" ssh config
afirmar_contiene  "config prohibe el acceso directo de root"       "PermitRootLogin no"        "$ADMIN" ssh config
afirmar_contiene  "config usa el puerto no estandar documentado"   "Port 52205"                "$ADMIN" ssh config
afirmar_contiene  "config restringe el acceso por grupo"           "AllowGroups sgrsi-tecnicos sudo" "$ADMIN" ssh config
# Regresion: la version documentada incluia `Protocol 2`, obsoleta desde
# OpenSSH 7.4; con esa linea `sshd -t` rechaza el archivo entero.
afirmar_no_contiene "config no emite la directiva obsoleta Protocol" "Protocol 2" "$ADMIN" ssh config

if command -v sshd >/dev/null 2>&1; then
    # Se valida el fragmento generado con el propio sshd, contra un archivo
    # temporal: nunca contra /etc/ssh del equipo donde corre la suite.
    CONF_PRUEBA="$TMP/sshd_config_prueba"
    ssh-keygen -q -t ed25519 -N "" -f "$TMP/host_ed25519" </dev/null
    {
        echo "HostKey $TMP/host_ed25519"
        "$ADMIN" ssh config
    } > "$CONF_PRUEBA"
    chmod 600 "$CONF_PRUEBA" "$TMP/host_ed25519"
    afirmar_exito "el fragmento generado valida con sshd -t"        sshd -t -f "$CONF_PRUEBA"
else
    salta "validacion del fragmento con sshd -t" "sshd no instalado"
fi

if command -v ssh-keygen >/dev/null 2>&1; then
    LLAVE="$TMP/prueba_ed25519"
    ssh-keygen -q -t ed25519 -N "" -C "prueba@sgrsi" -f "$LLAVE" </dev/null
    afirmar_exito     "instala una llave publica valida"            "$ADMIN" ssh llave-agregar "$U1" "$LLAVE.pub"
    afirmar_exito     "authorized_keys queda creado"                test -f "/home/$U1/.ssh/authorized_keys"
    afirmar_contiene  "authorized_keys queda con permisos 600"      "600" stat -c '%a' "/home/$U1/.ssh/authorized_keys"
    afirmar_contiene  ".ssh queda con permisos 700"                 "700" stat -c '%a' "/home/$U1/.ssh"
    afirmar_contiene  "authorized_keys pertenece al usuario"        "$U1" stat -c '%U' "/home/$U1/.ssh/authorized_keys"
    afirmar_contiene  "reinstalar la misma llave no la duplica"     "ya estaba instalada" "$ADMIN" ssh llave-agregar "$U1" "$LLAVE.pub"
    afirmar_exito     "sigue habiendo una sola llave"               \
        bash -c "[[ \$(wc -l < '/home/$U1/.ssh/authorized_keys') -eq 1 ]]"
    afirmar_contiene  "llaves informa la llave instalada"           "$U1" "$ADMIN" ssh llaves "$U1"
    echo "esto no es una llave" > "$TMP/rota.pub"
    afirmar_falla     "una llave invalida es rechazada"             "$ADMIN" ssh llave-agregar "$U1" "$TMP/rota.pub"
    afirmar_falla     "un archivo inexistente es rechazado"         "$ADMIN" ssh llave-agregar "$U1" "$TMP/no-existe.pub"
    afirmar_falla     "una cuenta inexistente es rechazada"         "$ADMIN" ssh llave-agregar sgrsitest-inexistente "$LLAVE.pub"
else
    salta "gestion de llaves publicas" "ssh-keygen no instalado"
fi

seccion "Respaldo (backup.sh) — issue #77"
export SGRSI_BACKUP_DIR="$TMP/backups"
afirmar_exito     "sin argumentos muestra la ayuda"                "$BACKUP"
afirmar_contiene  "la ayuda lista las acciones"                    "instalar-cron" "$BACKUP" ayuda
afirmar_falla     "una accion desconocida termina con error"       "$BACKUP" accioninexistente
mkdir -p "$SGRSI_BACKUP_DIR"
afirmar_contiene  "listar sin respaldos lo informa"                "(ninguno todavia)" "$BACKUP" listar
afirmar_falla     "restaurar sin argumento es rechazado"           "$BACKUP" restaurar
afirmar_falla     "restaurar un archivo inexistente es rechazado"  "$BACKUP" restaurar "$TMP/no-existe.sql.gz"
echo "no soy un gzip" > "$TMP/falso.sql.gz"
afirmar_falla     "restaurar un archivo corrupto es rechazado"     "$BACKUP" restaurar "$TMP/falso.sql.gz"
afirmar_falla     "verificar sin respaldos disponibles falla"      "$BACKUP" verificar

seccion "Rutina de cron — issue #77"
afirmar_exito     "el fragmento de cron esta versionado"           test -f "$SCRIPTS_DIR/cron/sgrsi-backup"
afirmar_contiene  "programa el respaldo diario a las 03:00"        "0 3 * * *" cat "$SCRIPTS_DIR/cron/sgrsi-backup"
afirmar_contiene  "programa la verificacion semanal"               "0 4 * * 0" cat "$SCRIPTS_DIR/cron/sgrsi-backup"
afirmar_contiene  "registra la salida en el log de cron"           "/var/log/sgrsi/backup-cron.log" cat "$SCRIPTS_DIR/cron/sgrsi-backup"
# /etc/cron.d exige el campo de usuario entre el horario y el comando; sin el,
# cron descarta la linea en silencio.
afirmar_exito     "las lineas de cron tienen el campo de usuario"  \
    bash -c "awk '\$1 ~ /^[0-9*]/ && NF < 7 { exit 1 }' '$SCRIPTS_DIR/cron/sgrsi-backup'"

seccion "Ciclo completo de respaldo contra PostgreSQL — issue #77"
# Estas pruebas necesitan un PostgreSQL accesible con permisos para crear
# bases. Si no lo hay, se saltan: la suite tiene que seguir sirviendo en una
# maquina de desarrollo sin motor instalado.
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-lux_app}"
export DB_HOST DB_PORT DB_USER
readonly DB_PRUEBA="sgrsitest_lux"

psql_admin() {
    PGPASSWORD="${DB_PASSWORD:-}" psql --host="$DB_HOST" --port="$DB_PORT" \
        --username="$DB_USER" --no-password --quiet -v ON_ERROR_STOP=1 "$@"
}

if ! command -v pg_dump >/dev/null 2>&1; then
    salta "ciclo de respaldo y restauracion" "pg_dump no instalado"
elif ! psql_admin -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    salta "ciclo de respaldo y restauracion" "sin conexion a PostgreSQL como $DB_USER@$DB_HOST:$DB_PORT"
else
    psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB_PRUEBA;" >/dev/null 2>&1
    psql_admin -d postgres -c "CREATE DATABASE $DB_PRUEBA;" >/dev/null
    psql_admin -d "$DB_PRUEBA" -c "
        CREATE TABLE ticket_prueba (id serial PRIMARY KEY, titulo text NOT NULL);
        INSERT INTO ticket_prueba (titulo) VALUES ('proyector del salon 12'), ('pc 3 no enciende');
    " >/dev/null

    export DB_NAME="$DB_PRUEBA"

    afirmar_exito    "respaldar genera el dump"                    "$BACKUP" respaldar
    afirmar_exito    "el dump quedo en el directorio de respaldos"  \
        bash -c "ls '$SGRSI_BACKUP_DIR'/lux_*.sql.gz >/dev/null 2>&1"
    afirmar_contiene "listar muestra el respaldo generado"         "lux_" "$BACKUP" listar
    afirmar_exito    "el dump es un gzip integro"                   \
        bash -c "gzip -t \$(ls -t '$SGRSI_BACKUP_DIR'/lux_*.sql.gz | head -1)"
    afirmar_exito    "verificar restaura el dump contra una base descartable" "$BACKUP" verificar
    afirmar_contiene "verificar informa las tablas recuperadas"    "tabla(s)" "$BACKUP" verificar

    # Restauracion real: se borra el contenido y se recupera desde el dump.
    # shellcheck disable=SC2012  # los nombres los genera el propio script, sin espacios
    DUMP="$(ls -t "$SGRSI_BACKUP_DIR"/lux_*.sql.gz | head -1)"
    psql_admin -d "$DB_PRUEBA" -c "DROP TABLE ticket_prueba;" >/dev/null
    afirmar_exito    "restaurar aplica el dump sobre la base activa" "$BACKUP" restaurar "$DUMP"
    afirmar_contiene "los datos volvieron tras la restauracion"    "proyector del salon 12" \
        psql_admin -d "$DB_PRUEBA" -t -A -c "SELECT titulo FROM ticket_prueba ORDER BY id;"
    afirmar_contiene "la restauracion recupero las dos filas"      "2" \
        psql_admin -d "$DB_PRUEBA" -t -A -c "SELECT count(*) FROM ticket_prueba;"

    # Politica de retencion: un dump con fecha anterior al limite se elimina
    # en la corrida siguiente, y el del dia se conserva.
    ANTIGUO="$SGRSI_BACKUP_DIR/lux_20200101_030000.sql.gz"
    cp "$DUMP" "$ANTIGUO"
    touch -d "60 days ago" "$ANTIGUO"
    afirmar_exito    "una nueva corrida aplica la retencion"       "$BACKUP" respaldar
    afirmar_falla    "el respaldo vencido fue eliminado"           test -f "$ANTIGUO"
    afirmar_exito    "los respaldos vigentes se conservan"         test -f "$DUMP"

    psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB_PRUEBA;" >/dev/null 2>&1
    unset DB_NAME
fi

seccion "Resumen"
echo "  pasadas:  $PASADAS"
echo "  falladas: $FALLADAS"
echo "  saltadas: $SALTADAS"
echo

if [[ "$FALLADAS" -gt 0 ]]; then
    rojo "La suite fallo: $FALLADAS prueba(s) no pasaron."
    exit 1
fi

verde "Todas las pruebas pasaron ($PASADAS)."
exit 0
