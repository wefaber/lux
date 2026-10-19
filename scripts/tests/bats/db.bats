#!/usr/bin/env bats
# db.sh. Las pruebas de validacion y dry-run no necesitan base. Las "reales"
# usan el PostgreSQL local (127.0.0.1:5432) SOLO con roles y bases propios
# (prefijo sgrsitest_) que se borran al terminar; si no hay PostgreSQL se omiten.

load helpers

setup() {
    setup_entorno
    export SGRSI_DB_MODO=host
    export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=postgres
    export SGRSI_STACK_USUARIO=""
}
teardown() {
    if pg_isready -q -h 127.0.0.1 -p 5432 2>/dev/null; then
        psql -X -q -h 127.0.0.1 -U postgres -d postgres \
            -c 'DROP DATABASE IF EXISTS sgrsitest_base' -c 'DROP ROLE IF EXISTS sgrsitest_rol' >/dev/null 2>&1 || true
    fi
    teardown_entorno
}

requiere_pg() {
    command -v psql >/dev/null || skip "psql no instalado"
    pg_isready -q -h 127.0.0.1 -p 5432 || skip "PostgreSQL local no disponible"
}

@test "crear-rol sin clave configurada sale con 78" {
    run "$ADMIN" db crear-rol sgrsitest_rol
    [ "$status" -eq 78 ]
}

@test "crear-rol rechaza nombres con caracteres peligrosos" {
    DB_ROLE_PASSWORD=x run "$ADMIN" db crear-rol 'a;DROP TABLE x'
    [ "$status" -ne 0 ]
    DB_ROLE_PASSWORD=x run "$ADMIN" db crear-base 'ok' 'a b'
    [ "$status" -ne 0 ]
}

@test "crear-rol --dry-run no muestra la clave" {
    DB_ROLE_PASSWORD='Secreto-Muy-Unico-123' run "$ADMIN" --dry-run db crear-rol sgrsitest_rol
    [ "$status" -eq 0 ]
    [[ "$output" == *"no se muestra"* ]]
    [[ "$output" != *"Secreto-Muy-Unico-123"* ]]
}

@test "crear-rol con clave en archivo de modo 644 se rechaza" {
    echo "x" > "$TMP/clave"; chmod 644 "$TMP/clave"
    DB_ROLE_PASSWORD_FILE="$TMP/clave" run "$ADMIN" db crear-rol sgrsitest_rol
    [ "$status" -eq 78 ]
}

@test "crear-base --dry-run" {
    run "$ADMIN" --dry-run db crear-base sgrsitest_base sgrsitest_rol
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] CREATE DATABASE"* ]]
}

@test "SGRSI_DB_MODO invalido sale con 78" {
    SGRSI_DB_MODO=cohete run "$ADMIN" db estado
    [ "$status" -eq 78 ]
}

@test "subcomando desconocido sale con error" {
    run "$ADMIN" db explotar
    [ "$status" -ne 0 ]
}

@test "estado contra PostgreSQL real" {
    requiere_pg
    run "$ADMIN" db estado
    [ "$status" -eq 0 ]
    [[ "$output" == *"Conexiones:  aceptadas"* ]]
}

@test "crear-rol y crear-base reales: idempotentes, sin privilegios elevados y sin acceso a PUBLIC" {
    requiere_pg
    export DB_ROLE_PASSWORD='prueba-1'
    run "$ADMIN" db crear-rol sgrsitest_rol
    [ "$status" -eq 0 ]
    # segunda corrida: actualiza la clave y no falla
    DB_ROLE_PASSWORD='prueba-2' run "$ADMIN" db crear-rol sgrsitest_rol
    [ "$status" -eq 0 ]
    run psql -X -A -t -h 127.0.0.1 -U postgres -d postgres \
        -c "SELECT rolsuper, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname='sgrsitest_rol'"
    [ "$output" = "f|f|f|t" ]

    run "$ADMIN" db crear-base sgrsitest_base sgrsitest_rol
    [ "$status" -eq 0 ]
    run "$ADMIN" db crear-base sgrsitest_base sgrsitest_rol
    [ "$status" -eq 0 ]
    run psql -X -A -t -h 127.0.0.1 -U postgres -d postgres \
        -c "SELECT pg_get_userbyid(datdba), has_database_privilege('public','sgrsitest_base','CONNECT') FROM pg_database WHERE datname='sgrsitest_base'"
    [ "$output" = "sgrsitest_rol|f" ]
}

@test "una clave con comillas no rompe ni inyecta SQL" {
    requiere_pg
    DB_ROLE_PASSWORD="a'b\"c;--" run "$ADMIN" db crear-rol sgrsitest_rol
    [ "$status" -eq 0 ]
}

@test "listar, tamano y conexiones corren contra PostgreSQL real" {
    requiere_pg
    run "$ADMIN" db listar
    [ "$status" -eq 0 ]
    [[ "$output" == *"Bases de datos:"* ]]
    run "$ADMIN" db tamano
    [ "$status" -eq 0 ]
    run "$ADMIN" db conexiones
    [ "$status" -eq 0 ]
}
