#!/usr/bin/env bats
# Politica de rotacion: 7 dias + 4 semanas, funcion pura.

load helpers

setup()    { setup_entorno; source "$SCRIPTS_DIR/lib/comun.sh"; source "$SCRIPTS_DIR/lib/rotacion.sh"; }
teardown() { teardown_entorno; }

ids_diarios() { # <hoy> <cantidad de dias hacia atras>
    local d
    for d in $(seq 0 "$2"); do echo "$(date -u -d "$1 -$d days" +%Y%m%d)_030000"; done
}

@test "con 61 dias de historia quedan 7 diarios + 4 semanales" {
    ids_diarios 2026-10-19 60 > "$TMP/ids"
    rotacion_ids_a_borrar 20261019 7 4 < "$TMP/ids" > "$TMP/borrar"
    conservados="$(grep -vxFf "$TMP/borrar" "$TMP/ids" | wc -l)"
    [ "$conservados" -eq 11 ]
}

@test "los ultimos 7 dias se conservan completos" {
    ids_diarios 2026-10-19 60 > "$TMP/ids"
    rotacion_ids_a_borrar 20261019 7 4 < "$TMP/ids" > "$TMP/borrar"
    for d in 0 1 2 3 4 5 6; do
        id="$(date -u -d "2026-10-19 -$d days" +%Y%m%d)_030000"
        ! grep -qx "$id" "$TMP/borrar"
    done
}

@test "de las semanas anteriores se conserva el respaldo mas reciente de cada una" {
    ids_diarios 2026-10-19 60 > "$TMP/ids"
    rotacion_ids_a_borrar 20261019 7 4 < "$TMP/ids" > "$TMP/borrar"
    ! grep -qx 20261012_030000 "$TMP/borrar"    # lunes 12/10 (semana 42)
    ! grep -qx 20261011_030000 "$TMP/borrar"    # domingo 11/10 (semana 41)
    grep -qx 20261010_030000 "$TMP/borrar"      # sabado 10/10 sobra
}

@test "lo muy viejo se elimina" {
    printf '20200101_030000\n20261019_030000\n' | rotacion_ids_a_borrar 20261019 7 4 > "$TMP/borrar"
    grep -qx 20200101_030000 "$TMP/borrar"
    ! grep -qx 20261019_030000 "$TMP/borrar"
}

@test "varias corridas el mismo dia dentro de la ventana diaria se conservan" {
    printf '20261019_030000\n20261019_150000\n' | rotacion_ids_a_borrar 20261019 7 4 > "$TMP/borrar"
    [ ! -s "$TMP/borrar" ]
}

@test "un identificador invalido nunca se propone para borrar" {
    run bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; source '$SCRIPTS_DIR/lib/rotacion.sh'; printf 'basura\n../../etc\n20200101_030000\n' | rotacion_ids_a_borrar 20261019 7 4 2>/dev/null"
    [ "$output" = "20200101_030000" ]
}

@test "sin historia no propone nada" {
    run bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; source '$SCRIPTS_DIR/lib/rotacion.sh'; : | rotacion_ids_a_borrar 20261019 7 4"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}
