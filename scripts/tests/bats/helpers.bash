# helpers.bash: preparacion comun de las pruebas bats de los scripts del SGRSI.
#
# Principio: las pruebas NO modifican el sistema donde corren. Los comandos que
# tocan el sistema (useradd, groupadd, usermod, ufw, systemctl, ip, podman, curl,
# ping) se reemplazan por stubs en stubs/, que solo registran como los llamaron
# en $STUB_LOG. Lo que una prueba de "dry-run" afirma es, justamente, que el
# registro quede vacio.

SCRIPTS_DIR="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
RAIZ_DIR="$(dirname "$SCRIPTS_DIR")"
ADMIN="$SCRIPTS_DIR/admin.sh"
BACKUP="$SCRIPTS_DIR/backup.sh"

setup_entorno() {
    TMP="$(mktemp -d)"
    export TMP
    export STUB_LOG="$TMP/stub.log"
    : > "$STUB_LOG"
    export PATH="$BATS_TEST_DIRNAME/stubs:$PATH"
    export SGRSI_LOG="$TMP/admin.log"
    export SGRSI_LOCK_DIR="$TMP"
    export SGRSI_SLEEP=true
    export SGRSI_SIN_CONFIRMACION=true
    export SGRSI_CONF="$TMP/no-existe.conf"
    export SGRSI_BACKUP_DIR="$TMP/backups"
    unset SGRSI_DRY_RUN DB_PASSWORD DB_PASSWORD_FILE SGRSI_DB_MODO
}

teardown_entorno() {
    rm -rf "$TMP"
}

# stub_llamadas <comando>: lineas del registro que empiezan con ese comando
stub_llamadas() {
    grep -c "^$1 " "$STUB_LOG" || true
}
