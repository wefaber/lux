#!/usr/bin/env bash
# ssh.sh — Modulo de configuracion del servicio SSH del servidor SGRSI.
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

ssh_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh ssh <subcomando> [argumentos]

Subcomandos:
  aplicar                           Instala el endurecimiento de sshd y recarga el servicio
  verificar                         Comprueba la configuracion efectiva del servicio
  llave-agregar <usuario> <archivo> Instala una llave publica en la cuenta indicada
  llaves [usuario]                  Lista las llaves publicas instaladas
  config                            Muestra la configuracion que aplicaria, sin escribirla

Variables de entorno: SGRSI_SSH_DROPIN, SGRSI_SSH_PUERTO, SGRSI_SSH_GRUPO.
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
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
FIN_CONFIG
}

ssh_aplicar() {
    requerir_root

    local destino="$SGRSI_SSH_DROPIN"
    local dir_destino
    dir_destino="$(dirname "$destino")"

    if [[ ! -d "$dir_destino" ]]; then
        log ERROR "No existe '$dir_destino'. Confirmar que openssh-server esta instalado y que sshd_config incluye el directorio de fragmentos."
        return 1
    fi

    # Un AllowGroups que apunte a un grupo inexistente deja fuera a todo el
    # mundo salvo a los miembros de sudo: se avisa antes de escribir, porque
    # el error solo se descubriria al perder el acceso.
    if ! existe_grupo "$SGRSI_SSH_GRUPO"; then
        log WARN "El grupo '$SGRSI_SSH_GRUPO' no existe todavia. Crearlo con: admin.sh grupos alta $SGRSI_SSH_GRUPO"
        confirmar "Aplicar igualmente la configuracion" || { log INFO "Operacion cancelada."; return 0; }
    fi

    local respaldo=""
    if [[ -f "$destino" ]]; then
        respaldo="${destino}.bak-$(date '+%Y%m%d_%H%M%S')"
        cp -p "$destino" "$respaldo"
        log INFO "Configuracion anterior respaldada en $respaldo"
    fi

    ssh_config > "$destino"
    chmod 644 "$destino"

    # Validar antes de recargar: una configuracion invalida que se recarga
    # deja el servicio caido y el servidor inaccesible.
    local salida_test
    if ! salida_test="$(sshd -t 2>&1)"; then
        log ERROR "La configuracion generada no valida. sshd -t informa: $salida_test"
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
    log WARN "Antes de recargar: confirmar que al menos una llave publica esta instalada, o se pierde el acceso remoto."

    if confirmar "Recargar el servicio sshd ahora"; then
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
        "x11forwarding no"; do
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
        aplicar)        ssh_aplicar ;;
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
