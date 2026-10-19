#!/usr/bin/env bats
# UFW con stub: se verifica el ORDEN de las reglas y las salvaguardas.

load helpers

setup() {
    setup_entorno
    export SGRSI_SSH_PUERTO=52205
}
teardown() { teardown_entorno; }

linea() { grep -n "$1" "$STUB_LOG" | head -1 | cut -d: -f1; }

@test "aplicar-base --dry-run no llama a ufw" {
    run "$ADMIN" --dry-run firewall aplicar-base
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] ufw default deny incoming"* ]]
    # puede haber lecturas (sshd -T), pero ninguna llamada a ufw
    ! grep -q '^ufw ' "$STUB_LOG"
}

@test "aplicar-base: politicas por defecto explicitas (G23)" {
    STUB_SSHD_PUERTOS="52205" run "$ADMIN" firewall aplicar-base
    [ "$status" -eq 0 ]
    grep -q '^ufw default deny incoming$' "$STUB_LOG"
    grep -q '^ufw default allow outgoing$' "$STUB_LOG"
}

@test "aplicar-base: la regla de SSH se carga ANTES de habilitar ufw (R5)" {
    STUB_SSHD_PUERTOS="52205" run "$ADMIN" firewall aplicar-base
    ssh_l="$(linea 'ufw limit 52205/tcp')"
    en_l="$(linea 'ufw --force enable')"
    [ -n "$ssh_l" ]
    [ -n "$en_l" ]
    [ "$ssh_l" -lt "$en_l" ]
}

@test "aplicar-base abre solo 52205, 80 y 443" {
    STUB_SSHD_PUERTOS="52205" run "$ADMIN" firewall aplicar-base
    grep -q '^ufw allow 80/tcp' "$STUB_LOG"
    grep -q '^ufw allow 443/tcp' "$STUB_LOG"
    ! grep -q '^ufw allow 22/tcp' "$STUB_LOG"
    ! grep -Eq '^ufw (allow|limit) (5432|3306|4111|8080)' "$STUB_LOG"
}

@test "aplicar-base cierra el 22 si sshd ya escucha solo en 52205 (G3)" {
    STUB_SSHD_PUERTOS="52205" run "$ADMIN" firewall aplicar-base
    grep -q '^ufw deny 22/tcp' "$STUB_LOG"
}

@test "aplicar-base NO cierra el 22 si sshd todavia escucha en el 22 (anti-bloqueo)" {
    STUB_SSHD_PUERTOS="22" run "$ADMIN" firewall aplicar-base
    [ "$status" -eq 0 ]
    ! grep -q '^ufw deny 22/tcp' "$STUB_LOG"
    [[ "$output" == *"NO se cierra el 22"* ]]
    grep -q '^ufw --force enable' "$STUB_LOG"
}

@test "aplicar-base NO cierra el 22 si sshd escucha en ambos" {
    STUB_SSHD_PUERTOS="22 52205" run "$ADMIN" firewall aplicar-base
    ! grep -q '^ufw deny 22/tcp' "$STUB_LOG"
}

@test "aplicar-base con origen restringido usa 'from' para SSH" {
    STUB_SSHD_PUERTOS="52205" SGRSI_FW_SSH_ORIGEN="192.168.50.0/24 192.168.50.20" run "$ADMIN" firewall aplicar-base
    grep -q '^ufw limit from 192.168.50.0/24 to any port 52205 proto tcp' "$STUB_LOG"
    grep -q '^ufw limit from 192.168.50.20 to any port 52205 proto tcp' "$STUB_LOG"
}

@test "aplicar-base rechaza un origen SSH invalido" {
    STUB_SSHD_PUERTOS="52205" SGRSI_FW_SSH_ORIGEN="cualquiera; id" run "$ADMIN" firewall aplicar-base
    [ "$status" -ne 0 ]
    ! grep -q 'enable' "$STUB_LOG"
}

@test "permitir un puerto valido" {
    run "$ADMIN" firewall permitir 8443 "panel"
    [ "$status" -eq 0 ]
    grep -q '^ufw allow 8443/tcp comment panel$' "$STUB_LOG"
}

@test "permitir rechaza puertos invalidos" {
    run "$ADMIN" firewall permitir 99999
    [ "$status" -ne 0 ]
    run "$ADMIN" firewall permitir 'abc'
    [ "$status" -ne 0 ]
    [ ! -s "$STUB_LOG" ]
}

@test "denegar el puerto SSH exige --forzar" {
    run "$ADMIN" firewall denegar 52205
    [ "$status" -ne 0 ]
    [[ "$output" == *"--forzar"* ]]
    [ ! -s "$STUB_LOG" ]
    run "$ADMIN" firewall denegar 52205 --forzar
    [ "$status" -eq 0 ]
    grep -q '^ufw deny 52205/tcp' "$STUB_LOG"
}

@test "eliminar la regla del puerto SSH exige --forzar" {
    run "$ADMIN" firewall eliminar 52205
    [ "$status" -ne 0 ]
}

@test "verificar: estado correcto" {
    cat > "$TMP/ufw-ok.txt" <<'FIN'
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
52205/tcp                  LIMIT IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
22/tcp                     DENY IN     Anywhere
FIN
    STUB_UFW_STATUS="$TMP/ufw-ok.txt" run "$ADMIN" firewall verificar
    [ "$status" -eq 0 ]
    [[ "$output" == *"coincide con la politica"* ]]
}

@test "verificar: detecta la base de datos expuesta y el 22 abierto" {
    cat > "$TMP/ufw-mal.txt" <<'FIN'
Status: active
Default: deny (incoming), allow (outgoing), disabled (routed)

To                         Action      From
--                         ------      ----
52205/tcp                  LIMIT IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
5432/tcp                   ALLOW IN    Anywhere
22/tcp                     ALLOW IN    Anywhere
FIN
    STUB_UFW_STATUS="$TMP/ufw-mal.txt" run "$ADMIN" firewall verificar
    [ "$status" -ne 0 ]
    [[ "$output" == *"[FALLA] 5432/tcp no expuesto"* ]]
    [[ "$output" == *"[FALLA] 22/tcp cerrado"* ]]
}

@test "verificar: ufw inactivo falla" {
    printf 'Status: inactive\n' > "$TMP/ufw-off.txt"
    STUB_UFW_STATUS="$TMP/ufw-off.txt" run "$ADMIN" firewall verificar
    [ "$status" -ne 0 ]
    [[ "$output" == *"[FALLA] firewall activo"* ]]
}

@test "aplicar-base --dry-run anticipa la decision sobre el 22 segun lo que escucha sshd" {
    STUB_SSHD_PUERTOS="22" run "$ADMIN" --dry-run firewall aplicar-base
    [[ "$output" == *"NO se cerraria el 22"* ]]
    [[ "$output" != *"ufw deny 22/tcp"* ]]
    STUB_SSHD_PUERTOS="52205" run "$ADMIN" --dry-run firewall aplicar-base
    [[ "$output" == *"[dry-run] ufw deny 22/tcp"* ]]
}
