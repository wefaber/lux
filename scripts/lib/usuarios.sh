#!/usr/bin/env bash
# usuarios.sh — Modulo de gestion de usuarios del sistema operativo (no
# confundir con los usuarios de la aplicacion Lux, que viven en la tabla
# `usuario` de PostgreSQL). Cubre alta, baja, modificacion y listado de
# cuentas de sistema, invocado por admin.sh.
#
# Issue: wefaber/eternum#78
# Documentado en: 05-ADMIN-SO/E2/Scripts-Bash-V1.md

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

usuarios_ayuda() {
    cat <<'EOF'
Uso: admin.sh usuarios <subcomando> [argumentos]

Subcomandos:
  alta <usuario> [comentario]       Crea un usuario del sistema con home propio
  baja <usuario>                    Elimina un usuario y su directorio home
  bloquear <usuario>                Bloquea el acceso por contrasena sin eliminar la cuenta
  desbloquear <usuario>             Restablece el acceso de una cuenta bloqueada
  listar                            Lista los usuarios con UID >= 1000 (cuentas humanas)
  info <usuario>                    Muestra los grupos y el estado de una cuenta
EOF
}

usuarios_alta() {
    local usuario="${1:-}"
    local comentario="${2:-}"

    validar_no_vacio "$usuario" "usuario" || return 1
    requerir_root

    if existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' ya existe."
        return 1
    fi

    useradd --create-home --shell /bin/bash --comment "$comentario" "$usuario"
    log INFO "Usuario '$usuario' creado con home en /home/$usuario."

    # `passwd` es interactivo por definicion: solo tiene sentido ofrecerlo
    # cuando hay una terminal de entrada. En uso desatendido (cron, otro
    # script, la suite de pruebas) la cuenta queda creada sin contrasena y
    # el aviso queda en el log, en vez de bloquear el script en un prompt
    # que nadie va a responder.
    if [[ -t 0 ]] && confirmar "Establecer contrasena para '$usuario' ahora"; then
        passwd "$usuario" || log WARN "No se pudo establecer la contrasena de '$usuario'."
    else
        log WARN "Usuario '$usuario' creado sin contrasena. Debera establecerse antes del primer acceso."
    fi
}

usuarios_baja() {
    local usuario="${1:-}"

    validar_no_vacio "$usuario" "usuario" || return 1
    requerir_root

    if ! existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' no existe."
        return 1
    fi

    if confirmar "Eliminar el usuario '$usuario' y su directorio home de forma irreversible"; then
        userdel --remove "$usuario"
        log INFO "Usuario '$usuario' eliminado."
    else
        log INFO "Operacion cancelada."
    fi
}

# usuarios_estado <usuario>
# Devuelve la letra de estado de la contrasena que informa `passwd -S`:
# P (contrasena utilizable), L (bloqueada o inexistente), NP (sin contrasena).
usuarios_estado() {
    passwd -S "${1:-}" 2>/dev/null | awk '{print $2}'
}

usuarios_bloquear() {
    local usuario="${1:-}"
    validar_no_vacio "$usuario" "usuario" || return 1
    requerir_root

    if ! existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' no existe."
        return 1
    fi

    if [[ "$(usuarios_estado "$usuario")" == "L" ]]; then
        log WARN "El usuario '$usuario' ya estaba bloqueado o no tiene contrasena. No se modifica nada."
        return 0
    fi

    usermod --lock "$usuario"
    log INFO "Usuario '$usuario' bloqueado. No puede autenticarse por contrasena."
}

usuarios_desbloquear() {
    local usuario="${1:-}"
    validar_no_vacio "$usuario" "usuario" || return 1
    requerir_root

    if ! existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' no existe."
        return 1
    fi

    usermod --unlock "$usuario" 2>/dev/null || true

    # `usermod --unlock` sobre una cuenta que nunca tuvo contrasena avisa por
    # stderr y termina con codigo 0 sin desbloquear nada. Sin esta
    # comprobacion el script informaria un exito que no ocurrio, y la cuenta
    # seguiria sin poder autenticarse.
    if [[ "$(usuarios_estado "$usuario")" == "L" ]]; then
        log ERROR "No se pudo desbloquear '$usuario': la cuenta no tiene contrasena establecida."
        log ERROR "Establecer una primero con: passwd $usuario"
        return 1
    fi

    log INFO "Usuario '$usuario' desbloqueado."
}

usuarios_listar() {
    log INFO "Cuentas humanas del sistema (UID >= 1000):"
    awk -F: '$3 >= 1000 && $3 < 65534 { printf "  %-20s UID=%s  home=%s  shell=%s\n", $1, $3, $6, $7 }' /etc/passwd
}

usuarios_info() {
    local usuario="${1:-}"
    validar_no_vacio "$usuario" "usuario" || return 1

    if ! existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' no existe."
        return 1
    fi

    local estado="(requiere root)"
    if [[ "$(id -u)" -eq 0 ]]; then
        estado="$(passwd -S "$usuario" 2>/dev/null | awk '{print $2}')"
    fi

    echo "Usuario:  $usuario"
    echo "Grupos:   $(id -Gn "$usuario")"
    echo "Estado:   ${estado:-desconocido}"
}

# usuarios_main <subcomando> [argumentos...]
# Punto de entrada del modulo, invocado por admin.sh. Centraliza el
# despacho a cada subcomando para que admin.sh no necesite conocer la
# implementacion interna del modulo, solo su punto de entrada.
usuarios_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        alta)          usuarios_alta "$@" ;;
        baja)          usuarios_baja "$@" ;;
        bloquear)      usuarios_bloquear "$@" ;;
        desbloquear)   usuarios_desbloquear "$@" ;;
        listar)        usuarios_listar ;;
        info)          usuarios_info "$@" ;;
        ""|ayuda|-h|--help) usuarios_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            usuarios_ayuda
            return 1
            ;;
    esac
}
