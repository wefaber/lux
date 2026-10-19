#!/usr/bin/env bash
# ssh.sh: Modulo de configuracion del servicio SSH del servidor SGRSI.
# Aplica el endurecimiento documentado (llave publica obligatoria, sin
# contrasena, puerto no estandar, acceso restringido por grupo) y administra
# las llaves publicas del equipo.
#
# Issue: wefaber/eternum#75
# Documentado en: 05-ADMIN-SO/E2/SSH-Configuracion.md

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

# Parametros de la configuracion. Se dejan como variables de entorno para
# que la suite de pruebas pueda apuntarlos a un directorio temporal en vez
# de escribir sobre /etc/ssh del equipo donde se ejecuta.
SGRSI_SSH_DROPIN="${SGRSI_SSH_DROPIN:-/etc/ssh/sshd_config.d/99-sgrsi.conf}"
SGRSI_SSH_PUERTO="${SGRSI_SSH_PUERTO:-52205}"
SGRSI_SSH_GRUPO="${SGRSI_SSH_GRUPO:-sgrsi-tecnicos}"
# Directivas adicionales (multilinea) que se agregan al final del fragmento. Las
# usa el servidor de respaldo para su bloque Match del usuario de rsync.
SGRSI_SSH_CONFIG_EXTRA="${SGRSI_SSH_CONFIG_EXTRA:-}"
SGRSI_SSH_SOCKET_DROPIN="${SGRSI_SSH_SOCKET_DROPIN:-/etc/systemd/system/ssh.socket.d/sgrsi.conf}"

ssh_descripcion() { echo "Endurecimiento de sshd y gestion de llaves publicas"; }

ssh_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh ssh <subcomando> [argumentos]

Subcomandos:
  aplicar [--forzar]                Instala el endurecimiento de sshd y recarga el servicio.
                                    Comprueba antes que haya llaves y que UFW deje pasar el puerto
  verificar                         Comprueba la configuracion efectiva del servicio
  llave-agregar <usuario> <archivo> Instala una llave publica en la cuenta indicada
  llaves [usuario]                  Lista las llaves publicas instaladas
  config                            Muestra la configuracion que aplicaria, sin escribirla

Variables de entorno: SGRSI_SSH_DROPIN, SGRSI_SSH_PUERTO, SGRSI_SSH_GRUPO,
SGRSI_SSH_CONFIG_EXTRA. Con --dry-run valida el fragmento con sshd -t pero no lo instala.
FIN_AYUDA
}

# ssh_config
# Emite por stdout el fragmento de configuracion. Se genera en un unico lugar
# para que la vista previa y la escritura real no puedan divergir.
#
# Nota: no se emite `Protocol 2`, que aparece en la version historica del
# documento. La directiva quedo obsoleta en OpenSSH 7.4 y las versiones
# actuales la rechazan al validar el archivo; SSH-1 ya no esta compilado en
# el servidor, de modo que la linea no agrega seguridad y rompe `sshd -t`.
ssh_config() {
    cat <<FIN_CONFIG
# --- SGRSI: configuracion de acceso administrativo ---
# Generado por lux/scripts/lib/ssh.sh (issue #75). No editar a mano:
# se sobreescribe en la proxima ejecucion de 'admin.sh ssh aplicar'.

Port $SGRSI_SSH_PUERTO

PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
KbdInteractiveAuthentication no

# Limitar a los usuarios que administran el servidor
AllowGroups $SGRSI_SSH_GRUPO sudo

# Endurecimiento adicional
MaxAuthTries 3
LoginGraceTime 30
MaxSessions 4
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitEmptyPasswords no
# VERBOSE registra la huella de la llave usada en cada acceso (auditoria)
LogLevel VERBOSE
FIN_CONFIG
    if [[ -n "$SGRSI_SSH_CONFIG_EXTRA" ]]; then
        printf '\n# --- Bloque adicional del entorno ---\n%s\n' "$SGRSI_SSH_CONFIG_EXTRA"
    fi
}

# ssh_hay_llave_para_acceso
# Antes de aplicar PasswordAuthentication no hay que estar seguro de que alguien
# puede entrar con llave: alguna cuenta de los grupos permitidos con al menos una
# llave en authorized_keys. Si no, el endurecimiento deja el servidor sin acceso.
ssh_hay_llave_para_acceso() {
    local grupo usuario home miembros
    for grupo in $SGRSI_SSH_GRUPO sudo; do
        miembros="$(getent group "$grupo" 2>/dev/null | cut -d: -f4 | tr ',' ' ')"
        for usuario in $miembros; do
            home="$(getent passwd "$usuario" | cut -d: -f6)"
            if [[ -s "$home/.ssh/authorized_keys" ]]; then
                return 0
            fi
        done
    done
    return 1
}

# ssh_ufw_permite_puerto: si UFW esta activo, el puerto de SSH tiene que estar
# permitido; si UFW no esta instalado o inactivo no hay nada que bloquee.
ssh_ufw_permite_puerto() {
    command -v ufw >/dev/null 2>&1 || return 0
    local estado
    estado="$(ufw status 2>/dev/null || true)"
    grep -q '^Status: active' <<<"$estado" || return 0
    grep -Eq "^${SGRSI_SSH_PUERTO}/tcp +(ALLOW|LIMIT)" <<<"$estado"
}

# ssh_socket_activo: en algunas instalaciones sshd arranca por socket activation
# (ssh.socket) y el Port del sshd_config se ignora hasta ajustar la unidad.
ssh_socket_activo() {
    systemctl is-active --quiet ssh.socket 2>/dev/null
}

ssh_ajustar_socket() {
    if ! ssh_socket_activo; then
        return 0
    fi
    log WARN "ssh.socket esta activo: el puerto se define en la unidad, no en sshd_config. Se agrega un drop-in."
    ejecutar install -d -m 755 "$(dirname "$SGRSI_SSH_SOCKET_DROPIN")"
    if es_dry_run; then
        log INFO "[dry-run] Se escribiria $SGRSI_SSH_SOCKET_DROPIN con ListenStream=$SGRSI_SSH_PUERTO"
    else
        printf '[Socket]\nListenStream=\nListenStream=%s\n' "$SGRSI_SSH_PUERTO" > "$SGRSI_SSH_SOCKET_DROPIN"
    fi
    ejecutar systemctl daemon-reload
    ejecutar systemctl restart ssh.socket
}

ssh_aplicar() {
    local forzar=""
    [[ "${1:-}" == "--forzar" ]] && forzar="--forzar"

    requerir_root

    local destino="$SGRSI_SSH_DROPIN"
    local dir_destino
    dir_destino="$(dirname "$destino")"

    if [[ ! -d "$dir_destino" ]] && ! es_dry_run; then
        log ERROR "No existe '$dir_destino'. Confirmar que openssh-server esta instalado y que sshd_config incluye el directorio de fragmentos."
        return 1
    fi

    # Un AllowGroups que apunte a un grupo inexistente deja fuera a todo el
    # mundo salvo a los miembros de sudo: se avisa antes de escribir, porque
    # el error solo se descubriria al perder el acceso.
    # SGRSI_SSH_GRUPO puede traer varios grupos separados por espacio.
    local grupo_ssh
    for grupo_ssh in $SGRSI_SSH_GRUPO; do
        if ! existe_grupo "$grupo_ssh"; then
            log WARN "El grupo '$grupo_ssh' no existe todavia. Crearlo con: admin.sh grupos alta $grupo_ssh"
            confirmar "Aplicar igualmente la configuracion" || { log INFO "Operacion cancelada."; return 0; }
            break
        fi
    done

    # Salvaguardas contra el bloqueo (R5 de la auditoria de E2).
    if ! es_dry_run && [[ -z "$forzar" ]]; then
        if ! ssh_hay_llave_para_acceso; then
            log ERROR "Ninguna cuenta de '$SGRSI_SSH_GRUPO' ni de 'sudo' tiene una llave publica instalada. Con PasswordAuthentication no se perderia el acceso."
            log ERROR "Instalar una primero: admin.sh ssh llave-agregar <usuario> <archivo.pub>  (o repetir con --forzar si hay consola de la VM)."
            return 1
        fi
        if ! ssh_ufw_permite_puerto; then
            log ERROR "UFW esta activo y no permite $SGRSI_SSH_PUERTO/tcp. Abrirlo antes: admin.sh firewall permitir $SGRSI_SSH_PUERTO"
            return 1
        fi
    fi

    local nuevo
    nuevo="$(mktemp)"
    # shellcheck disable=SC2064
    trap "rm -f '$nuevo'" RETURN
    ssh_config > "$nuevo"

    # Validar ANTES de instalar: una configuracion invalida que se recarga
    # deja el servicio caido y el servidor inaccesible. `sshd -t -f` sobre el
    # fragmento solo (es una configuracion completa valida) no modifica nada.
    local salida_test
    if command -v sshd >/dev/null 2>&1; then
        if ! salida_test="$(sshd -t -f "$nuevo" 2>&1)"; then
            log ERROR "La configuracion generada no valida. sshd -t informa: $salida_test"
            return 1
        fi
        log INFO "Fragmento validado con sshd -t."
    else
        log WARN "sshd no esta instalado: no se pudo validar el fragmento."
    fi

    if es_dry_run; then
        log INFO "[dry-run] Se instalaria $destino con:"
        sed 's/^/    | /' "$nuevo" >&2
        ssh_ajustar_socket
        return 0
    fi

    local respaldo=""
    if [[ -f "$destino" ]]; then
        respaldo="${destino}.bak-$(date '+%Y%m%d_%H%M%S')"
        cp -p "$destino" "$respaldo"
        log INFO "Configuracion anterior respaldada en $respaldo"
    fi
    install -m 644 "$nuevo" "$destino"

    # Segunda validacion, ahora con el sshd_config real y todos los includes.
    if ! salida_test="$(sshd -t 2>&1)"; then
        log ERROR "La configuracion completa no valida. sshd -t informa: $salida_test"
        if [[ -n "$respaldo" ]]; then
            mv "$respaldo" "$destino"
            log WARN "Se restauro la configuracion anterior."
        else
            rm -f "$destino"
            log WARN "Se elimino el fragmento invalido."
        fi
        return 1
    fi

    log INFO "Configuracion escrita en $destino y validada con sshd -t."
    log WARN "Mantener ABIERTA esta sesion y probar una sesion nueva en el puerto $SGRSI_SSH_PUERTO antes de cerrarla."

    if confirmar "Recargar el servicio sshd ahora"; then
        ssh_ajustar_socket
        if systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null; then
            log INFO "Servicio sshd recargado. Escucha ahora en el puerto $SGRSI_SSH_PUERTO."
        else
            log WARN "No se pudo recargar via systemctl. Recargar manualmente: systemctl reload ssh"
        fi
    else
        log INFO "Configuracion escrita pero no aplicada. Recargar con: systemctl reload ssh"
    fi
}

# ssh_verificar
# Lee la configuracion efectiva con `sshd -T` (que resuelve includes y
# valores por defecto) en vez de releer el archivo, porque lo que importa es
# lo que el servicio realmente aplica, no lo que dice el fragmento escrito.
ssh_verificar() {
    requerir_root

    local efectiva
    if ! efectiva="$(sshd -T 2>/dev/null)"; then
        log ERROR "No se pudo leer la configuracion efectiva. Revisar 'sshd -t'."
        return 1
    fi

    local fallos=0
    local esperado
    for esperado in \
        "port $SGRSI_SSH_PUERTO" \
        "passwordauthentication no" \
        "pubkeyauthentication yes" \
        "permitrootlogin no" \
        "maxauthtries 3" \
        "x11forwarding no" \
        "logingracetime 30" \
        "allowtcpforwarding no" \
        "permitemptypasswords no" \
        "loglevel VERBOSE"; do
        if grep -qix -- "$esperado" <<<"$efectiva"; then
            echo "  [ok]    $esperado"
        else
            echo "  [FALLA] $esperado"
            fallos=$((fallos + 1))
        fi
    done

    if [[ "$fallos" -gt 0 ]]; then
        log ERROR "$fallos directiva(s) no coinciden con la configuracion documentada."
        return 1
    fi

    log INFO "La configuracion efectiva de sshd coincide con la documentada."
}

ssh_llave_agregar() {
    local usuario="${1:-}"
    local archivo="${2:-}"

    validar_no_vacio "$usuario" "usuario" || return 1
    validar_no_vacio "$archivo" "archivo de llave publica" || return 1
    requerir_root

    if ! existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' no existe. Crearlo con: admin.sh usuarios alta $usuario"
        return 1
    fi

    if [[ ! -f "$archivo" ]]; then
        log ERROR "El archivo '$archivo' no existe."
        return 1
    fi

    # Una llave mal copiada (truncada, con saltos de linea de mas) se detecta
    # aca y no cuando el integrante no logra conectarse.
    if ! ssh-keygen -l -f "$archivo" >/dev/null 2>&1; then
        log ERROR "'$archivo' no es una llave publica SSH valida."
        return 1
    fi

    local home
    home="$(getent passwd "$usuario" | cut -d: -f6)"
    if [[ -z "$home" || ! -d "$home" ]]; then
        log ERROR "La cuenta '$usuario' no tiene un directorio home valido."
        return 1
    fi

    local dir_ssh="$home/.ssh"
    local autorizadas="$dir_ssh/authorized_keys"

    mkdir -p "$dir_ssh"
    touch "$autorizadas"

    local llave
    llave="$(cat "$archivo")"

    if grep -qxF -- "$llave" "$autorizadas"; then
        log WARN "La llave ya estaba instalada para '$usuario'. No se duplica."
    else
        printf '%s\n' "$llave" >> "$autorizadas"
        log INFO "Llave instalada para '$usuario'."
    fi

    # sshd rechaza en silencio un authorized_keys con permisos abiertos o con
    # dueno equivocado, sin decir por que falla la autenticacion.
    chown -R "$usuario:$(id -gn "$usuario")" "$dir_ssh"
    chmod 700 "$dir_ssh"
    chmod 600 "$autorizadas"
}

ssh_llaves() {
    local objetivo="${1:-}"
    local usuarios=()

    if [[ -n "$objetivo" ]]; then
        existe_usuario "$objetivo" || { log ERROR "El usuario '$objetivo' no existe."; return 1; }
        usuarios=("$objetivo")
    else
        mapfile -t usuarios < <(awk -F: '$3 >= 1000 && $3 < 65534 { print $1 }' /etc/passwd)
    fi

    if [[ "${#usuarios[@]}" -eq 0 ]]; then
        echo "  (no hay cuentas humanas en el sistema)"
        return 0
    fi

    local usuario home autorizadas
    for usuario in "${usuarios[@]}"; do
        home="$(getent passwd "$usuario" | cut -d: -f6)"
        autorizadas="$home/.ssh/authorized_keys"
        if [[ -r "$autorizadas" && -s "$autorizadas" ]]; then
            echo "$usuario:"
            ssh-keygen -l -f "$autorizadas" 2>/dev/null | sed 's/^/  /' || echo "  (llaves ilegibles)"
        else
            echo "$usuario: (sin llaves instaladas)"
        fi
    done
}

ssh_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        aplicar)        ssh_aplicar "$@" ;;
        verificar)      ssh_verificar ;;
        llave-agregar)  ssh_llave_agregar "$@" ;;
        llaves)         ssh_llaves "$@" ;;
        config)         ssh_config ;;
        ""|ayuda|-h|--help) ssh_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            ssh_ayuda
            return 1
            ;;
    esac
}
