#!/usr/bin/env bats
# backup.sh. Ciclo REAL contra el PostgreSQL local, con una base propia
# (sgrsitest_bk) que se crea y se borra en cada prueba. Sin PostgreSQL se omite.

load helpers

setup() {
    setup_entorno
    export SGRSI_DB_MODO=host DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=postgres DB_NAME=sgrsitest_bk
    export SGRSI_STACK_USUARIO=""
    export SGRSI_BACKUP_RUTAS="$TMP/conf"
    mkdir -p "$TMP/conf"; echo "valor" > "$TMP/conf/a.conf"
    export SGRSI_BACKUP_MIN_LIBRE_MB=1
}
teardown() {
    if pg_isready -q -h 127.0.0.1 -p 5432 2>/dev/null; then
        psql -X -q -h 127.0.0.1 -U postgres -d postgres -c 'DROP DATABASE IF EXISTS sgrsitest_bk' >/dev/null 2>&1 || true
    fi
    teardown_entorno
}

requiere_pg() {
    command -v pg_dump >/dev/null || skip "pg_dump no instalado"
    pg_isready -q -h 127.0.0.1 -p 5432 || skip "PostgreSQL local no disponible"
}

crear_base() {
    psql -X -q -h 127.0.0.1 -U postgres -d postgres -c 'DROP DATABASE IF EXISTS sgrsitest_bk' -c 'CREATE DATABASE sgrsitest_bk'
    psql -X -q -h 127.0.0.1 -U postgres -d sgrsitest_bk \
        -c 'CREATE TABLE equipos(id int primary key, nombre text)' \
        -c "INSERT INTO equipos SELECT g, 'equipo-' || g FROM generate_series(1,25) g"
}

@test "ayuda y accion desconocida" {
    run "$BACKUP" ayuda
    [ "$status" -eq 0 ]
    run "$BACKUP" volar
    [ "$status" -eq 1 ]
}

@test "--dry-run respaldar no crea archivos" {
    run "$BACKUP" --dry-run respaldar
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] Se respaldaria"* ]]
    [ ! -d "$SGRSI_BACKUP_DIR" ]
}

@test "estado sin respaldos sale con error" {
    run "$BACKUP" estado
    [ "$status" -eq 1 ]
}

@test "ciclo completo: respaldar, comprobar, verificar y restaurar" {
    requiere_pg
    crear_base
    run "$BACKUP" respaldar
    [ "$status" -eq 0 ]
    [[ "$output" == *"completa"* ]]
    ls "$SGRSI_BACKUP_DIR"/lux_*.sql.gz "$SGRSI_BACKUP_DIR"/archivos_*.tar.gz "$SGRSI_BACKUP_DIR"/lux_*.sha256
    # el area temporal queda vacia (todo se movio al destino)
    [ -z "$(ls -A "$SGRSI_BACKUP_DIR/.tmp")" ]

    run "$BACKUP" comprobar
    [ "$status" -eq 0 ]

    SGRSI_VERIFICAR_TABLAS_OBLIGATORIAS=equipos run "$BACKUP" verificar
    [ "$status" -eq 0 ]

    run "$BACKUP" estado
    [ "$status" -eq 0 ]

    # se destruye la tabla y se restaura desde el respaldo
    psql -X -q -h 127.0.0.1 -U postgres -d sgrsitest_bk -c 'DROP TABLE equipos'
    dump="$(ls "$SGRSI_BACKUP_DIR"/lux_*.sql.gz | head -1)"
    run "$BACKUP" restaurar "$dump"
    [ "$status" -eq 0 ]
    run psql -X -A -t -h 127.0.0.1 -U postgres -d sgrsitest_bk -c 'SELECT count(*) FROM equipos'
    [ "$output" = "25" ]
}

@test "verificar falla si falta una tabla obligatoria" {
    requiere_pg
    crear_base
    run "$BACKUP" respaldar
    [ "$status" -eq 0 ]
    SGRSI_VERIFICAR_TABLAS_OBLIGATORIAS="equipos tabla_que_no_existe" run "$BACKUP" verificar
    [ "$status" -ne 0 ]
}

@test "comprobar detecta un archivo alterado" {
    requiere_pg
    crear_base
    "$BACKUP" respaldar
    dump="$(ls "$SGRSI_BACKUP_DIR"/lux_*.sql.gz | head -1)"
    echo "basura" >> "$dump"
    run "$BACKUP" comprobar
    [ "$status" -eq 1 ]
    [[ "$output" == *"NO coinciden"* ]]
}

@test "restaurar rechaza un dump alterado antes de tocar la base" {
    requiere_pg
    crear_base
    "$BACKUP" respaldar
    dump="$(ls "$SGRSI_BACKUP_DIR"/lux_*.sql.gz | head -1)"
    # mismo gzip valido pero distinto contenido: la suma debe delatarlo
    gunzip -c "$dump" | sed 's/equipo-/EQUIPO-/' | gzip > "$TMP/otro.gz"
    cp "$TMP/otro.gz" "$dump"
    run "$BACKUP" restaurar "$dump"
    [ "$status" -eq 1 ]
    [[ "$output" == *"no coincide"* ]]
}

@test "restaurar rechaza un gzip corrupto" {
    echo "no soy gzip" > "$TMP/malo.sql.gz"
    run "$BACKUP" restaurar "$TMP/malo.sql.gz"
    [ "$status" -eq 1 ]
}

@test "restaurar --dry-run no toca la base" {
    requiere_pg
    crear_base
    "$BACKUP" respaldar
    dump="$(ls "$SGRSI_BACKUP_DIR"/lux_*.sql.gz | head -1)"
    psql -X -q -h 127.0.0.1 -U postgres -d sgrsitest_bk -c 'DELETE FROM equipos'
    run "$BACKUP" --dry-run restaurar "$dump"
    [ "$status" -eq 0 ]
    run psql -X -A -t -h 127.0.0.1 -U postgres -d sgrsitest_bk -c 'SELECT count(*) FROM equipos'
    [ "$output" = "0" ]
}

@test "con clave configurada, los secretos salen cifrados y no se leen sin ella" {
    requiere_pg
    command -v gpg >/dev/null || skip "gpg no instalado"
    crear_base
    mkdir -p "$TMP/sec"; echo "CLAVE_SECRETA_XYZ=1" > "$TMP/sec/lux.env"
    echo "frase-de-prueba" > "$TMP/frase"; chmod 600 "$TMP/frase"
    export SGRSI_BACKUP_SECRETOS="$TMP/sec" SGRSI_BACKUP_CLAVE_ARCHIVO="$TMP/frase"
    run "$BACKUP" respaldar
    [ "$status" -eq 0 ]
    cif="$(ls "$SGRSI_BACKUP_DIR"/secretos_*.tar.gz.gpg)"
    ! grep -a -q CLAVE_SECRETA_XYZ "$cif"
    # los secretos NO aparecen en el paquete de configuracion
    ! tar -xzOf "$(ls "$SGRSI_BACKUP_DIR"/archivos_*.tar.gz)" 2>/dev/null | grep -a -q CLAVE_SECRETA_XYZ
    run "$BACKUP" restaurar-archivos "$cif" "$TMP/rest"
    [ "$status" -eq 0 ]
    grep -rq CLAVE_SECRETA_XYZ "$TMP/rest"
}

@test "rotacion: con 10 dias de historial, respaldar deja solo los que corresponden" {
    requiere_pg
    crear_base
    mkdir -p "$SGRSI_BACKUP_DIR"
    for d in 1 2 3 4 5 6 7 8 9 10; do
        f="$(date -d "-$d days" +%Y%m%d)_030000"
        for p in "lux_$f.sql.gz" "archivos_$f.tar.gz" "lux_$f.sha256"; do : > "$SGRSI_BACKUP_DIR/$p"; done
    done
    SGRSI_BACKUP_DIARIOS=3 SGRSI_BACKUP_SEMANAS=0 run "$BACKUP" respaldar
    [ "$status" -eq 0 ]
    n="$(ls "$SGRSI_BACKUP_DIR"/lux_*.sha256 | wc -l)"
    [ "$n" -le 5 ]
    [ "$n" -ge 3 ]
}

@test "rotacion --dry-run lista lo que borraria y no borra" {
    requiere_pg
    mkdir -p "$SGRSI_BACKUP_DIR"
    f="$(date -d '-40 days' +%Y%m%d)_030000"
    : > "$SGRSI_BACKUP_DIR/lux_$f.sql.gz"
    run bash -c "source '$BACKUP'; SGRSI_DRY_RUN=1; limpiar_antiguos"
    [ -e "$SGRSI_BACKUP_DIR/lux_$f.sql.gz" ]
}

@test "espacio insuficiente cancela el respaldo antes de empezar" {
    SGRSI_BACKUP_MIN_LIBRE_MB=999999999 run "$BACKUP" respaldar
    [ "$status" -eq 1 ]
    [[ "$output" == *"minimo es"* ]]
}

@test "instalar-cron --dry-run no escribe /etc/cron.d" {
    run "$BACKUP" --dry-run instalar-cron
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run]"* ]]
    [ ! -e /etc/cron.d/sgrsi-backup ]
}

@test "un solo respaldo a la vez (lock)" {
    mkdir -p "$SGRSI_BACKUP_DIR"
    exec 9>"$SGRSI_LOCK_DIR/sgrsi-backup.lock"
    flock -n 9
    run "$BACKUP" respaldar
    exec 9>&-
    [ "$status" -eq 75 ]
    [[ "$output" == *"Ya hay otra ejecucion"* ]]
}
