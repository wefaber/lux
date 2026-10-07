#!/usr/bin/env bash
# admin.sh — Script de administracion del servidor SGRSI (Lux), primera
# version. Punto de entrada unico que despacha a modulos pequenos y
# reutilizables en lib/, cada uno responsable de un area especifica.
#
# Version modular: cada area (usuarios, grupos, ssh, y las que se agreguen en
# E3 — redes, base de datos, firewall, logs) vive en su propio archivo de
# lib/, invocable de forma independiente ademas de a traves de este
# despachador. Esto facilita mantenimiento, depuracion y escalabilidad: un
# modulo se prueba y se corrige sin tocar los demas.
#
# Uso:
#   ./admin.sh <modulo> <subcomando> [argumentos]
#   ./admin.sh ayuda
#
# Issue: wefaber/eternum#78
# Documentado en: 05-ADMIN-SO/E2/Scripts-Bash-V1.md

set -euo pipefail

SGRSI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SGRSI_DIR

# shellcheck source=lib/comun.sh
source "$SGRSI_DIR/lib/comun.sh"
# shellcheck source=lib/usuarios.sh
source "$SGRSI_DIR/lib/usuarios.sh"
# shellcheck source=lib/grupos.sh
source "$SGRSI_DIR/lib/grupos.sh"
# shellcheck source=lib/ssh.sh
source "$SGRSI_DIR/lib/ssh.sh"

ayuda_general() {
    cat <<FIN_AYUDA
admin.sh — Script de administracion del servidor SGRSI (primera version)

Uso: $0 <modulo> [subcomando] [argumentos]

Modulos disponibles:
  usuarios    Alta, baja, bloqueo y consulta de cuentas del sistema
  grupos      Alta, baja y gestion de miembros de grupo
  ssh         Endurecimiento del servicio SSH y gestion de llaves publicas

Ejemplos:
  $0 usuarios alta tecnico1 "Tecnico de coordinacion"
  $0 grupos agregar tecnico1 sgrsi-tecnicos
  $0 ssh llave-agregar tecnico1 /tmp/tecnico1.pub
  $0 usuarios listar
  $0 <modulo> ayuda        Muestra la ayuda especifica del modulo

El respaldo de la base de datos vive en un script aparte (backup.sh) porque
se invoca tambien desde cron, sin intervencion humana.

Los modulos de redes, base de datos, firewall y logs se agregan en la
version final del script (tercera entrega, issue #109).
FIN_AYUDA
}

main() {
    local modulo="${1:-}"

    if [[ -z "$modulo" || "$modulo" == "ayuda" || "$modulo" == "-h" || "$modulo" == "--help" ]]; then
        ayuda_general
        exit 0
    fi

    shift

    case "$modulo" in
        usuarios) usuarios_main "$@" ;;
        grupos)   grupos_main "$@" ;;
        ssh)      ssh_main "$@" ;;
        *)
            log ERROR "Modulo desconocido: '$modulo'"
            ayuda_general
            exit 1
            ;;
    esac
}

main "$@"
