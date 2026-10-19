#!/usr/bin/env bats
# Funciones compartidas: dry-run, logging, reintentos, validadores, secretos, lock.

load helpers

setup()    { setup_entorno; }
teardown() { teardown_entorno; }

cargar() { source "$SCRIPTS_DIR/lib/comun.sh"; }

@test "log escribe en el archivo de log" {
    cargar
    log INFO "linea de prueba" 2>/dev/null
    grep -q "linea de prueba" "$SGRSI_LOG"
}

@test "log rechaza un nivel desconocido" {
    cargar
    run log RARO "x"
    [ "$status" -ne 0 ]
}

@test "log avisa UNA vez por pantalla si no puede escribir el log (R3)" {
    run bash -c "
        export SGRSI_LOG=/proc/no-se-puede/escribir/admin.log
        source '$SCRIPTS_DIR/lib/comun.sh'
        log INFO uno; log INFO dos; log INFO tres" 
    [ "$status" -eq 0 ]
    [ "$(grep -c 'No se puede escribir el log' <<<"$output")" -eq 1 ]
}

@test "en dry-run log no escribe el archivo" {
    export SGRSI_DRY_RUN=1
    cargar
    log INFO "no debe quedar" 2>/dev/null
    [ ! -e "$SGRSI_LOG" ]
}

@test "ejecutar en dry-run no ejecuta el comando" {
    cargar
    export SGRSI_DRY_RUN=1
    run ejecutar touch "$TMP/no-debe-existir"
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] touch"* ]]
    [ ! -e "$TMP/no-debe-existir" ]
}

@test "ejecutar fuera de dry-run ejecuta el comando" {
    cargar
    ejecutar touch "$TMP/debe-existir" 2>/dev/null
    [ -e "$TMP/debe-existir" ]
}

@test "requerir_root se relaja en dry-run" {
    run bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; SGRSI_DRY_RUN=1; requerir_root; echo paso"
    [[ "$output" == *"paso"* ]]
}

@test "comun.sh tolera cargarse dos veces" {
    run bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; source '$SCRIPTS_DIR/lib/comun.sh'; echo ok"
    [ "$status" -eq 0 ]
}

@test "confirmar sin terminal y sin variable rechaza" {
    run bash -c "unset SGRSI_SIN_CONFIRMACION; source '$SCRIPTS_DIR/lib/comun.sh'; confirmar 'seguro' < /dev/null"
    [ "$status" -ne 0 ]
}

@test "reintentar: exito tras fallos transitorios" {
    cargar
    echo 0 > "$TMP/n"
    flaky() { local n; n=$(<"$TMP/n"); echo $((n + 1)) > "$TMP/n"; [ "$n" -ge 2 ]; }
    run reintentar 5 1 flaky
    [ "$status" -eq 0 ]
    [ "$(<"$TMP/n")" -eq 3 ]
}

@test "reintentar: agota los intentos y devuelve el codigo del comando" {
    cargar
    run reintentar 3 1 bash -c 'exit 7'
    [ "$status" -eq 7 ]
    [[ "$output" == *"Fallo tras 3 intento(s)"* ]]
}

@test "validar_ipv4 acepta y rechaza" {
    cargar
    validar_ipv4 192.168.50.10 ip 2>/dev/null
    run validar_ipv4 192.168.50.256 ip;  [ "$status" -ne 0 ]
    run validar_ipv4 192.168.50 ip;      [ "$status" -ne 0 ]
    run validar_ipv4 'a.b.c.d' ip;       [ "$status" -ne 0 ]
    run validar_ipv4 '1.2.3.4; rm -rf /' ip; [ "$status" -ne 0 ]
}

@test "validar_puerto y validar_prefijo" {
    cargar
    validar_puerto 52205 p 2>/dev/null
    run validar_puerto 0 p;      [ "$status" -ne 0 ]
    run validar_puerto 70000 p;  [ "$status" -ne 0 ]
    run validar_puerto 22x p;    [ "$status" -ne 0 ]
    validar_prefijo 24 p 2>/dev/null
    run validar_prefijo 33 p;    [ "$status" -ne 0 ]
}

@test "validar_nombre rechaza espacios, metacaracteres y mayusculas" {
    cargar
    validar_nombre tecnico1 n 2>/dev/null
    validar_nombre sgrsi-tecnicos n 2>/dev/null
    run validar_nombre 'Tecnico' n;      [ "$status" -ne 0 ]
    run validar_nombre 'a b' n;          [ "$status" -ne 0 ]
    run validar_nombre 'x;id' n;         [ "$status" -ne 0 ]
    run validar_nombre '1abc' n;         [ "$status" -ne 0 ]
}

@test "leer_secreto: variable de entorno" {
    cargar
    MI_CLAVE="valor secreto" run leer_secreto MI_CLAVE
    [ "$output" = "valor secreto" ]
}

@test "leer_secreto: archivo con modo 600" {
    cargar
    printf 'desde-archivo\n' > "$TMP/s"; chmod 600 "$TMP/s"
    MI_CLAVE_FILE="$TMP/s" run leer_secreto MI_CLAVE
    [ "$status" -eq 0 ]
    [ "$output" = "desde-archivo" ]
}

@test "leer_secreto: rechaza un archivo legible por otros" {
    cargar
    printf 'x' > "$TMP/s"; chmod 644 "$TMP/s"
    MI_CLAVE_FILE="$TMP/s" run leer_secreto MI_CLAVE
    [ "$status" -ne 0 ]
    [[ "$output" == *"modo 600"* ]]
}

@test "leer_secreto: sin ninguna fuente falla con mensaje claro" {
    cargar
    run leer_secreto NO_DEFINIDA
    [ "$status" -ne 0 ]
    [[ "$output" == *"NO_DEFINIDA_FILE"* ]]
}

@test "cargar_config rechaza un archivo escribible por otros" {
    printf 'SGRSI_PRUEBA=1\n' > "$TMP/c.conf"; chmod 666 "$TMP/c.conf"
    run bash -c "export SGRSI_CONF='$TMP/c.conf'; source '$SCRIPTS_DIR/lib/comun.sh'; cargar_config"
    [ "$status" -eq 78 ]
}

@test "cargar_config carga un archivo seguro" {
    printf 'SGRSI_PRUEBA=cargado\n' > "$TMP/c.conf"; chmod 640 "$TMP/c.conf"
    run bash -c "export SGRSI_CONF='$TMP/c.conf'; source '$SCRIPTS_DIR/lib/comun.sh'; cargar_config; echo \$SGRSI_PRUEBA"
    [ "$output" = "cargado" ]
}

@test "adquirir_lock: la segunda ejecucion simultanea sale con 75" {
    cargar
    adquirir_lock prueba 2>/dev/null
    run bash -c "export SGRSI_LOCK_DIR='$TMP' SGRSI_LOG='$TMP/x.log'; source '$SCRIPTS_DIR/lib/comun.sh'; adquirir_lock prueba"
    [ "$status" -eq 75 ]
}

@test "hecho no habla en dry-run" {
    cargar
    export SGRSI_DRY_RUN=1
    run hecho "creado"
    [ -z "$output" ]
}

@test "comando_compose respeta SGRSI_COMPOSE_PROVEEDOR y rechaza valores raros" {
    run bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; SGRSI_COMPOSE_PROVEEDOR='podman compose' comando_compose"
    [ "$status" -eq 0 ]
    [ "$output" = "podman compose" ]
    run bash -c "source '$SCRIPTS_DIR/lib/comun.sh'; SGRSI_COMPOSE_PROVEEDOR='docker-compose' comando_compose"
    [ "$status" -eq 78 ]
}
