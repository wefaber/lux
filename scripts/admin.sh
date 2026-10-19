#!/usr/bin/env bash
# admin.sh: Script de administracion del servidor SGRSI (Lux), version final
# (E3). Punto de entrada unico que despacha a modulos pequenos y reutilizables
# en lib/, cada uno responsable de un area: usuarios, grupos, ssh, red, db,
# firewall, logs, deploy y respaldo.
#
# Escalabilidad: los modulos se DESCUBREN. Cualquier lib/<nombre>.sh que defina
# la funcion <nombre>_main queda disponible como `admin.sh <nombre>`, sin editar
# este archivo. Agregar un modulo no toca a los existentes; y si un modulo
# falla al cargarse, el resto sigue funcionando (se informa y se omite).
#
# Uso:
#   ./admin.sh [--dry-run] [--config ARCHIVO] <modulo> <subcomando> [argumentos]
#   ./admin.sh ayuda
#
#   --dry-run, -n     Muestra lo que haria sin modificar el sistema.
#   --config ARCHIVO  Archivo de configuracion (por defecto /etc/sgrsi/sgrsi.conf).
#
# Issues: wefaber/eternum#78 (base) y #109 (version final)
# Documentado en: 05-ADMIN-SO/E3/Script-Final.md

set -euo pipefail

SGRSI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SGRSI_DIR

# shellcheck source=lib/comun.sh
source "$SGRSI_DIR/lib/comun.sh"

# Bibliotecas que no son modulos (no definen <nombre>_main).
readonly LIBS_NO_MODULO=" comun rotacion "

MODULOS_CARGADOS=()

# cargar_modulos
# Carga cada lib/*.sh y registra los que exponen <nombre>_main. Un modulo con
# errores de sintaxis o de carga se omite con aviso: no tumba al resto.
cargar_modulos() {
    local archivo nombre
    for archivo in "$SGRSI_DIR"/lib/*.sh; do
        nombre="$(basename "$archivo" .sh)"
        [[ "$LIBS_NO_MODULO" == *" $nombre "* ]] && continue
        # shellcheck disable=SC1090
        if ! (source "$archivo") 2>/dev/null; then
            log WARN "El modulo '$nombre' no se pudo cargar y se omite (revisar con: bash -n $archivo)."
            continue
        fi
        # shellcheck disable=SC1090
        source "$archivo"
        if declare -F "${nombre}_main" >/dev/null; then
            MODULOS_CARGADOS+=("$nombre")
        fi
    done
}

ayuda_general() {
    echo "admin.sh: Script de administracion del servidor SGRSI (version final)"
    echo
    echo "Uso: $0 [--dry-run] [--config ARCHIVO] <modulo> [subcomando] [argumentos]"
    echo
    echo "Modulos disponibles:"
    local m descripcion
    for m in "${MODULOS_CARGADOS[@]}"; do
        descripcion=""
        if declare -F "${m}_descripcion" >/dev/null; then
            descripcion="$("${m}_descripcion")"
        fi
        printf '  %-11s %s\n' "$m" "$descripcion"
    done
    cat <<'FIN_AYUDA'

Opciones globales:
  --dry-run, -n       No modifica el sistema: muestra cada comando que ejecutaria
  --config ARCHIVO    Configuracion (por defecto /etc/sgrsi/sgrsi.conf; sin secretos)

Ejemplos:
  admin.sh usuarios alta tecnico1 "Tecnico de coordinacion"
  admin.sh --dry-run firewall aplicar-base
  admin.sh red verificar
  admin.sh db estado
  admin.sh deploy up
  admin.sh respaldo remoto sincronizar
  admin.sh <modulo> ayuda      Ayuda especifica del modulo

Codigos de salida: 0 ok, 1 error, 2 uso incorrecto, 75 fallo temporal (destino
remoto caido), 78 configuracion invalida.
FIN_AYUDA
}

main() {
    # Opciones globales, antes del modulo.
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run|-n) export SGRSI_DRY_RUN=1; shift ;;
            --config)
                [[ -n "${2:-}" ]] || { echo "Falta el archivo despues de --config" >&2; exit "$SGRSI_EX_USO"; }
                export SGRSI_CONF="$2"; shift 2 ;;
            *) break ;;
        esac
    done

    cargar_config || exit $?
    instalar_trap_errores
    cargar_modulos

    local modulo="${1:-}"

    if [[ -z "$modulo" || "$modulo" == "ayuda" || "$modulo" == "-h" || "$modulo" == "--help" ]]; then
        ayuda_general
        exit 0
    fi

    shift

    local m
    for m in "${MODULOS_CARGADOS[@]}"; do
        if [[ "$m" == "$modulo" ]]; then
            if es_dry_run; then
                log INFO "[dry-run] Modo ensayo: no se modificara el sistema."
            fi
            "${m}_main" "$@"
            return
        fi
    done

    log ERROR "Modulo desconocido: '$modulo'"
    ayuda_general
    exit 1
}

main "$@"
