#!/usr/bin/env bats
load helpers

setup() {
    setup_entorno
    export SGRSI_STACK_USUARIO=""
    export SGRSI_LOGROTATE_DESTINO="$TMP/logrotate-sgrsi"
}
teardown() { teardown_entorno; }

@test "ver sin log todavia avisa y sale bien" {
    run "$ADMIN" logs ver
    [ "$status" -eq 0 ]
}

@test "ver muestra las ultimas lineas" {
    printf 'uno\ndos\ntres\n' > "$SGRSI_LOG"
    run "$ADMIN" logs ver 2
    [ "$status" -eq 0 ]
    [[ "$output" == *"dos"* && "$output" == *"tres"* && "$output" != *"uno"* ]]
}

@test "ver rechaza lineas no numericas" {
    run "$ADMIN" logs ver '5; rm -rf /'
    [ "$status" -ne 0 ]
}

@test "servicio rechaza nombres desconocidos" {
    run "$ADMIN" logs servicio ../../etc/passwd
    [ "$status" -ne 0 ]
}

@test "servicio db pasa por compose (stub podman)" {
    run "$ADMIN" logs servicio db 20
    grep -q 'logs --tail 20 db' "$STUB_LOG"
}

@test "errores y ssh-fallidos validan el parametro 'desde'" {
    command -v journalctl >/dev/null || skip "sin journalctl"
    run "$ADMIN" logs errores '1 hour ago; id'
    [ "$status" -ne 0 ]
    run "$ADMIN" logs ssh-fallidos '$(id)'
    [ "$status" -ne 0 ]
}

@test "logrotate --dry-run muestra la configuracion y no escribe" {
    run "$ADMIN" --dry-run logs logrotate
    [ "$status" -eq 0 ]
    [[ "$output" == *"weekly"* ]]
    [ ! -e "$SGRSI_LOGROTATE_DESTINO" ]
}

@test "logrotate instala una configuracion que logrotate acepta (-d)" {
    command -v logrotate >/dev/null || skip "logrotate no instalado"
    SGRSI_LOGROTATE_USUARIO=root SGRSI_LOGROTATE_GRUPO=root run "$ADMIN" logs logrotate
    [ "$status" -eq 0 ]
    [ -f "$SGRSI_LOGROTATE_DESTINO" ]
}

@test "logrotate con un usuario inexistente se rechaza y no instala" {
    command -v logrotate >/dev/null || skip "logrotate no instalado"
    SGRSI_LOGROTATE_USUARIO=noexiste-sgrsi run "$ADMIN" logs logrotate
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown user"* ]]
    [ ! -e "$SGRSI_LOGROTATE_DESTINO" ]
}
