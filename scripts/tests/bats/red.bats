#!/usr/bin/env bats
# Red con stub de ip/ping: estado, verificacion de IP fija y generacion de configuracion.

load helpers

setup() {
    setup_entorno
    export SGRSI_RED_IP=192.168.50.10 SGRSI_RED_PREFIJO=24 SGRSI_RED_GATEWAY=192.168.50.1 SGRSI_RED_DNS="9.9.9.9 1.1.1.1"
    export SGRSI_RED_IFUPDOWN_ARCHIVO="$TMP/interfaces" SGRSI_RED_NETWORKD_ARCHIVO="$TMP/10-sgrsi.network"
}
teardown() { teardown_entorno; }

@test "estado con IP estatica" {
    STUB_IP_MODO=estatica run "$ADMIN" red estado
    [ "$status" -eq 0 ]
    [[ "$output" == *"Interfaz:  ens18"* ]]
    [[ "$output" == *"IP:        192.168.50.10/24"* ]]
    [[ "$output" == *"Modo:      estatica"* ]]
    [[ "$output" == *"Gateway:   192.168.50.1"* ]]
}

@test "estado con DHCP avisa que la IP puede cambiar" {
    STUB_IP_MODO=dhcp run "$ADMIN" red estado
    [[ "$output" == *"Modo:      dhcp"* ]]
    [[ "$output" == *"usa DHCP"* ]]
}

@test "estado sin ruta por defecto falla con mensaje claro" {
    STUB_IP_MODO=sinruta run "$ADMIN" red estado
    [ "$status" -ne 0 ]
    [[ "$output" == *"No hay ruta por defecto"* ]]
}

@test "verificar: IP fija correcta" {
    STUB_IP_MODO=estatica run "$ADMIN" red verificar
    [ "$status" -eq 0 ]
    [[ "$output" == *"IP fija correcta"* ]]
}

@test "verificar: IP distinta de la esperada falla" {
    STUB_IP_MODO=estatica STUB_IP_ADDR=192.168.50.99 run "$ADMIN" red verificar
    [ "$status" -ne 0 ]
    [[ "$output" == *"la esperada es '192.168.50.10'"* ]]
}

@test "verificar: IP correcta pero por DHCP falla" {
    STUB_IP_MODO=dhcp STUB_IP_ADDR=192.168.50.10 run "$ADMIN" red verificar
    [ "$status" -ne 0 ]
    [[ "$output" == *"DHCP"* ]]
}

@test "verificar sin SGRSI_RED_IP configurada sale con 78" {
    SGRSI_RED_IP="" run "$ADMIN" red verificar
    [ "$status" -eq 78 ]
}

@test "conectividad: todo bien" {
    SGRSI_RED_NOMBRE_DNS=localhost STUB_PING_RC=0 run "$ADMIN" red conectividad
    [[ "$output" == *"[ok]    gateway 192.168.50.1 responde"* ]]
    [[ "$output" == *"Conectividad completa"* ]]
}

@test "conectividad: gateway caido se reporta como problema local" {
    STUB_PING_RC=1 run "$ADMIN" red conectividad
    [ "$status" -ne 0 ]
    [[ "$output" == *"problema de red local"* ]]
}

@test "config ifupdown genera la IP fija" {
    run "$ADMIN" red config ifupdown
    [ "$status" -eq 0 ]
    [[ "$output" == *"iface ens18 inet static"* ]]
    [[ "$output" == *"address 192.168.50.10/24"* ]]
    [[ "$output" == *"gateway 192.168.50.1"* ]]
    [[ "$output" == *"dns-nameservers 9.9.9.9 1.1.1.1"* ]]
}

@test "config networkd genera el archivo .network" {
    run "$ADMIN" red config networkd
    [[ "$output" == *"[Match]"*"Name=ens18"* ]]
    [[ "$output" == *"Address=192.168.50.10/24"* ]]
    [[ "$output" == *"DNS=1.1.1.1"* ]]
}

@test "config rechaza IP invalida y no genera nada" {
    SGRSI_RED_IP="192.168.50.300" run "$ADMIN" red config ifupdown
    [ "$status" -eq 78 ]
    [[ "$output" != *"iface"* ]]
}

@test "config rechaza un gateway con inyeccion" {
    SGRSI_RED_GATEWAY="1.1.1.1
    post-up rm -rf /" run "$ADMIN" red config ifupdown
    [ "$status" -eq 78 ]
}

@test "aplicar --dry-run no escribe nada" {
    run "$ADMIN" --dry-run red aplicar --reload
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] Se escribiria"* ]]
    [ ! -e "$TMP/interfaces" ]
    [ ! -s "$STUB_LOG" ] || ! grep -q 'ifreload\|systemctl restart' "$STUB_LOG"
}

@test "aplicar sin --reload escribe el archivo, hace copia previa y no activa" {
    echo "contenido anterior" > "$TMP/interfaces"
    SGRSI_RED_BACKEND=ifupdown run "$ADMIN" red aplicar
    [ "$status" -eq 0 ]
    grep -q "address 192.168.50.10/24" "$TMP/interfaces"
    ls "$TMP"/interfaces.bak-* >/dev/null
    grep -q "contenido anterior" "$TMP"/interfaces.bak-*
    ! grep -q 'systemctl restart\|ifreload' "$STUB_LOG"
}

@test "aplicar --reload REVIERTE si el gateway no responde despues de activar" {
    echo "config vieja" > "$TMP/interfaces"
    SGRSI_RED_BACKEND=ifupdown STUB_PING_RC=1 run "$ADMIN" red aplicar --reload
    [ "$status" -ne 0 ]
    [[ "$output" == *"Se revierte"* ]]
    grep -q "config vieja" "$TMP/interfaces"
    [ "$(grep -c 'systemctl restart networking' "$STUB_LOG")" -eq 2 ]
}

@test "aplicar --reload conserva la config nueva si el gateway responde" {
    echo "config vieja" > "$TMP/interfaces"
    SGRSI_RED_BACKEND=ifupdown STUB_PING_RC=0 run "$ADMIN" red aplicar --reload
    [ "$status" -eq 0 ]
    grep -q "address 192.168.50.10/24" "$TMP/interfaces"
    [ "$(grep -c 'systemctl restart networking' "$STUB_LOG")" -eq 1 ]
}
