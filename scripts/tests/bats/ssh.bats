#!/usr/bin/env bats
# ssh.sh: el fragmento generado se valida con el sshd REAL (sshd -t / -T -f, que
# no tocan el servicio); la aplicacion se prueba con stubs y rutas temporales.

load helpers

setup() {
    setup_entorno
    export SGRSI_SSH_DROPIN="$TMP/sshd_config.d/99-sgrsi.conf"
    export SGRSI_SSH_SOCKET_DROPIN="$TMP/socket.d/sgrsi.conf"
    mkdir -p "$TMP/sshd_config.d"
    export SGRSI_SSH_GRUPO="root"
}
teardown() { teardown_entorno; }

# sshd real, sin los stubs del PATH
sshd_real() { PATH="/usr/sbin:/usr/bin:/bin" /usr/sbin/sshd "$@"; }

config_con_hostkey() {
    ssh-keygen -q -t ed25519 -N '' -f "$TMP/hk"
    "$ADMIN" ssh config > "$TMP/cfg"
    echo "HostKey $TMP/hk" >> "$TMP/cfg"
}

@test "el fragmento generado lo acepta el sshd real (sshd -t -f)" {
    [ -x /usr/sbin/sshd ] || skip "sshd no instalado"
    config_con_hostkey
    run sshd_real -t -f "$TMP/cfg"
    [ "$status" -eq 0 ]
}

@test "la configuracion efectiva (sshd -T -f) tiene el endurecimiento esperado" {
    [ -x /usr/sbin/sshd ] || skip "sshd no instalado"
    config_con_hostkey
    run sshd_real -T -f "$TMP/cfg"
    [ "$status" -eq 0 ]
    [[ "$output" == *"port 52205"* ]]
    [[ "$output" == *"passwordauthentication no"* ]]
    [[ "$output" == *"permitrootlogin no"* ]]
    [[ "$output" == *"pubkeyauthentication yes"* ]]
    [[ "$output" == *"authenticationmethods publickey"* ]]
    [[ "$output" == *"maxauthtries 3"* ]]
    [[ "$output" == *"allowtcpforwarding no"* ]]
}

@test "el fragmento no incluye 'Protocol 2' (obsoleta, rompe sshd -t)" {
    run "$ADMIN" ssh config
    [[ "$output" != *"Protocol 2"* ]]
}

@test "SGRSI_SSH_GRUPO admite varios grupos en AllowGroups" {
    SGRSI_SSH_GRUPO="uno dos" run "$ADMIN" ssh config
    [[ "$output" == *"AllowGroups uno dos sudo"* ]]
}

@test "SGRSI_SSH_CONFIG_EXTRA se agrega al final" {
    SGRSI_SSH_CONFIG_EXTRA=$'Match User respaldo\n    AllowTcpForwarding no' run "$ADMIN" ssh config
    [[ "$output" == *"Match User respaldo"* ]]
}

@test "aplicar --dry-run valida, muestra y no escribe" {
    run "$ADMIN" --dry-run ssh aplicar
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] Se instalaria"* ]]
    [ ! -e "$SGRSI_SSH_DROPIN" ]
    ! grep -Eq '^systemctl (reload|restart|daemon-reload)' "$STUB_LOG"
}

@test "aplicar sin llaves de acceso se rechaza (R5)" {
    run "$ADMIN" ssh aplicar
    [ "$status" -eq 1 ]
    [[ "$output" == *"llave publica instalada"* ]]
    [ ! -e "$SGRSI_SSH_DROPIN" ]
}

@test "aplicar rechaza si UFW esta activo y no permite el puerto" {
    # una cuenta con llave, para pasar la primera salvaguarda
    ssh_home="$TMP/home"; mkdir -p "$ssh_home/.ssh"; echo "ssh-ed25519 AAAA x" > "$ssh_home/.ssh/authorized_keys"
    printf 'Status: active\n\n22/tcp  ALLOW  Anywhere\n' > "$TMP/ufw.status"
    export STUB_UFW_STATUS="$TMP/ufw.status"
    # getent simulado: el grupo "root" tiene un miembro con llave
    mkdir -p "$TMP/bin"
    cat > "$TMP/bin/getent" <<FIN
#!/usr/bin/env bash
case "\$1" in
  group)  [[ "\$2" == root ]] && echo "root:x:0:tester" ;;
  passwd) [[ "\$2" == tester ]] && echo "tester:x:1000:1000::$ssh_home:/bin/bash" ;;
esac
exit 0
FIN
    chmod +x "$TMP/bin/getent"
    PATH="$TMP/bin:$PATH" run "$ADMIN" ssh aplicar
    [ "$status" -eq 1 ]
    [[ "$output" == *"no permite 52205/tcp"* ]]
    [ ! -e "$SGRSI_SSH_DROPIN" ]
}

@test "aplicar --forzar escribe, respalda lo anterior y recarga" {
    echo "# viejo" > "$SGRSI_SSH_DROPIN"
    run "$ADMIN" ssh aplicar --forzar
    [ "$status" -eq 0 ]
    grep -q '^Port 52205$' "$SGRSI_SSH_DROPIN"
    ls "$SGRSI_SSH_DROPIN".bak-* >/dev/null
    grep -Eq '^systemctl (reload ssh|reload sshd)' "$STUB_LOG"
}

@test "si sshd -t falla con el fragmento, no se instala nada" {
    STUB_SSHD_T_RC=1 STUB_SSHD_ERROR="linea 3: opcion invalida" run "$ADMIN" ssh aplicar --forzar
    [ "$status" -eq 1 ]
    [[ "$output" == *"no valida"* ]]
    [ ! -e "$SGRSI_SSH_DROPIN" ]
}

@test "con ssh.socket activo se agrega el drop-in del puerto" {
    STUB_SYSTEMCTL_ACTIVE_RC=0 run "$ADMIN" ssh aplicar --forzar
    [ "$status" -eq 0 ]
    grep -q '^ListenStream=52205$' "$SGRSI_SSH_SOCKET_DROPIN"
    grep -q 'systemctl restart ssh.socket' "$STUB_LOG"
}

@test "verificar detecta una directiva que no coincide" {
    # sshd -T simulado solo informa el puerto: las demas directivas faltan
    run "$ADMIN" ssh verificar
    [ "$status" -eq 1 ]
    [[ "$output" == *"[FALLA]"* ]]
}

@test "llave-agregar rechaza usuario inexistente y archivo inexistente" {
    run "$ADMIN" ssh llave-agregar usuarioquenoexiste "$TMP/x.pub"
    [ "$status" -eq 1 ]
    run "$ADMIN" ssh llave-agregar root "$TMP/no-hay.pub"
    [ "$status" -eq 1 ]
}

@test "llave-agregar rechaza una llave truncada" {
    echo "ssh-ed25519 AAAA-truncada" > "$TMP/mala.pub"
    run "$ADMIN" --dry-run ssh llave-agregar root "$TMP/mala.pub"
    [ "$status" -eq 1 ]
}
