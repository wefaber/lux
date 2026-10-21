#!/usr/bin/env bats
# respaldo.sh (cliente remoto): validaciones, cola de pendientes y dry-run.
# El envio real contra un sshd efimero esta en tests/integracion-respaldo.sh.

load helpers

setup() {
    setup_entorno
    export SGRSI_STACK_USUARIO=""
    export SGRSI_RESPALDO_HOST=respaldo.invalido
    export SGRSI_RESPALDO_LLAVE="$TMP/llave"
    export SGRSI_RESPALDO_KNOWN_HOSTS="$TMP/known_hosts"
    mkdir -p "$SGRSI_BACKUP_DIR"
}
teardown() { teardown_entorno; }

corrida_falsa() {
    local id="$1"
    : > "$SGRSI_BACKUP_DIR/lux_$id.sql.gz"; : > "$SGRSI_BACKUP_DIR/lux_$id.sha256"
}

@test "sin SGRSI_RESPALDO_HOST sale con 78" {
    SGRSI_RESPALDO_HOST="" run "$ADMIN" respaldo remoto probar
    [ "$status" -eq 78 ]
}

@test "host con caracteres raros se rechaza" {
    SGRSI_RESPALDO_HOST='a;b' run "$ADMIN" respaldo remoto probar
    [ "$status" -eq 78 ]
    SGRSI_RESPALDO_HOST_ALT='$(id)' run "$ADMIN" respaldo remoto sincronizar
    [ "$status" -eq 78 ]
}

@test "puerto invalido se rechaza" {
    SGRSI_RESPALDO_PUERTO=99999 run "$ADMIN" respaldo remoto probar
    [ "$status" -eq 78 ]
}

@test "sin llave sale con 78 y explica como generarla" {
    run "$ADMIN" respaldo remoto probar
    [ "$status" -eq 78 ]
    [[ "$output" == *"ssh-keygen"* ]]
}

@test "llave con permisos abiertos se rechaza" {
    : > "$SGRSI_RESPALDO_LLAVE"; chmod 644 "$SGRSI_RESPALDO_LLAVE"
    run "$ADMIN" respaldo remoto probar
    [ "$status" -eq 78 ]
    [[ "$output" == *"permisos abiertos"* ]]
}

@test "sin known_hosts propio se rechaza (no se acepta la huella a ciegas)" {
    : > "$SGRSI_RESPALDO_LLAVE"; chmod 600 "$SGRSI_RESPALDO_LLAVE"
    run "$ADMIN" respaldo remoto probar
    [ "$status" -eq 78 ]
    [[ "$output" == *"known_hosts"* ]]
}

@test "sincronizar --dry-run lista las pendientes y no envia" {
    corrida_falsa 20261018_030000
    corrida_falsa 20261019_030000
    run "$ADMIN" --dry-run respaldo remoto sincronizar
    [ "$status" -eq 0 ]
    [[ "$output" == *"20261018_030000"* && "$output" == *"20261019_030000"* ]]
    [[ "$output" == *"sin --delete"* ]]
}

@test "las corridas ya enviadas no vuelven a la cola" {
    corrida_falsa 20261018_030000
    corrida_falsa 20261019_030000
    echo 20261018_030000 > "$SGRSI_BACKUP_DIR/.enviados"
    run "$ADMIN" --dry-run respaldo remoto sincronizar
    [[ "$output" != *"20261018_030000"* ]]
    [[ "$output" == *"20261019_030000"* ]]
}

@test "una corrida sin .sha256 (incompleta) no se considera pendiente" {
    : > "$SGRSI_BACKUP_DIR/lux_20261019_030000.sql.gz"
    run "$ADMIN" --dry-run respaldo remoto sincronizar
    [[ "$output" == *"No hay corridas pendientes"* ]]
}

@test "estado sin alerta sale bien y muestra la cola" {
    corrida_falsa 20261019_030000
    run "$ADMIN" respaldo remoto estado
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pendientes de envio:        1"* ]]
}

@test "estado con alerta abierta sale con error" {
    date > "$SGRSI_BACKUP_DIR/.alerta-remoto"
    run "$ADMIN" respaldo remoto estado
    [ "$status" -eq 1 ]
    [[ "$output" == *"alerta abierta"* ]]
}

@test "restaurar valida el formato del id (sin path traversal)" {
    run "$ADMIN" respaldo remoto restaurar '../../etc'
    [ "$status" -eq 1 ]
    [[ "$output" == *"Identificador invalido"* ]]
}

@test "local delega en backup.sh (estado sin respaldos)" {
    run "$ADMIN" respaldo local estado
    [ "$status" -eq 1 ]
    [[ "$output" == *"No hay ninguna corrida completa"* ]]
}

@test "accion remota desconocida sale con error" {
    run "$ADMIN" respaldo remoto volar
    [ "$status" -ne 0 ]
}
