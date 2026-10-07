#!/usr/bin/env bash
# grupos.sh — Modulo de gestion de grupos del sistema operativo. Cubre alta,
# baja y administracion de miembros de grupo, invocado por admin.sh.
#
# Issue: wefaber/eternum#78
# Documentado en: 05-ADMIN-SO/E2/Scripts-Bash-V1.md

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

grupos_ayuda() {
    cat <<'EOF'
Uso: admin.sh grupos <subcomando> [argumentos]

Subcomandos:
  alta <grupo>                      Crea un grupo del sistema
  baja <grupo>                      Elimina un grupo existente
  agregar <usuario> <grupo>         Agrega un usuario a un grupo
  quitar <usuario> <grupo>          Quita un usuario de un grupo
  miembros <grupo>                  Lista los miembros de un grupo
  listar                            Lista los grupos con GID >= 1000
EOF
}

grupos_alta() {
    local grupo="${1:-}"
    validar_no_vacio "$grupo" "grupo" || return 1
    requerir_root

    if existe_grupo "$grupo"; then
        log ERROR "El grupo '$grupo' ya existe."
        return 1
    fi

    groupadd "$grupo"
    log INFO "Grupo '$grupo' creado."
}

grupos_baja() {
    local grupo="${1:-}"
    validar_no_vacio "$grupo" "grupo" || return 1
    requerir_root

    if ! existe_grupo "$grupo"; then
        log ERROR "El grupo '$grupo' no existe."
        return 1
    fi

    local miembros
    miembros="$(getent group "$grupo" | cut -d: -f4)"
    if [[ -n "$miembros" ]]; then
        log WARN "El grupo '$grupo' tiene miembros activos: $miembros"
        confirmar "Eliminar el grupo de todas formas" || { log INFO "Operacion cancelada."; return 0; }
    fi

    groupdel "$grupo"
    log INFO "Grupo '$grupo' eliminado."
}

grupos_agregar() {
    local usuario="${1:-}"
    local grupo="${2:-}"
    validar_no_vacio "$usuario" "usuario" || return 1
    validar_no_vacio "$grupo" "grupo" || return 1
    requerir_root

    if ! existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' no existe."
        return 1
    fi
    if ! existe_grupo "$grupo"; then
        log ERROR "El grupo '$grupo' no existe."
        return 1
    fi

    usermod --append --groups "$grupo" "$usuario"
    log INFO "Usuario '$usuario' agregado al grupo '$grupo'."
}

grupos_quitar() {
    local usuario="${1:-}"
    local grupo="${2:-}"
    validar_no_vacio "$usuario" "usuario" || return 1
    validar_no_vacio "$grupo" "grupo" || return 1
    requerir_root

    if ! existe_usuario "$usuario"; then
        log ERROR "El usuario '$usuario' no existe."
        return 1
    fi
    if ! existe_grupo "$grupo"; then
        log ERROR "El grupo '$grupo' no existe."
        return 1
    fi

    # gpasswd --delete falla si el usuario no es miembro. Se comprueba antes
    # para devolver un mensaje que explique el caso, en vez del error crudo
    # de la herramienta.
    if ! id -nG "$usuario" | tr ' ' '\n' | grep -qx "$grupo"; then
        log ERROR "El usuario '$usuario' no es miembro de '$grupo'."
        return 1
    fi

    gpasswd --delete "$usuario" "$grupo"
    log INFO "Usuario '$usuario' removido del grupo '$grupo'."
}

grupos_miembros() {
    local grupo="${1:-}"
    validar_no_vacio "$grupo" "grupo" || return 1

    if ! existe_grupo "$grupo"; then
        log ERROR "El grupo '$grupo' no existe."
        return 1
    fi

    local miembros
    miembros="$(getent group "$grupo" | cut -d: -f4)"

    echo "Miembros de '$grupo':"
    if [[ -z "$miembros" ]]; then
        echo "  (ninguno)"
    else
        echo "$miembros" | tr ',' '\n' | sed 's/^/  /'
    fi
}

grupos_listar() {
    log INFO "Grupos del sistema (GID >= 1000):"
    awk -F: '$3 >= 1000 && $3 < 65534 { printf "  %-20s GID=%s  miembros=%s\n", $1, $3, ($4 == "" ? "-" : $4) }' /etc/group
}

grupos_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        alta)      grupos_alta "$@" ;;
        baja)      grupos_baja "$@" ;;
        agregar)   grupos_agregar "$@" ;;
        quitar)    grupos_quitar "$@" ;;
        miembros)  grupos_miembros "$@" ;;
        listar)    grupos_listar ;;
        ""|ayuda|-h|--help) grupos_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            grupos_ayuda
            return 1
            ;;
    esac
}
