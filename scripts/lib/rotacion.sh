#!/usr/bin/env bash
# rotacion.sh: Politica de retencion de respaldos, compartida por el servidor
# de produccion (backup.sh) y por el servidor de respaldo (ops/backup-server).
# Es una funcion pura: recibe identificadores de corrida y devuelve cuales
# borrar. No toca el disco, por eso se prueba con fechas inventadas.
#
# Politica (decision de E3, unifica E2 y la guia): 7 dias de respaldos
# diarios completos + 4 semanas de respaldos semanales (el mas reciente de cada
# una de las 4 semanas ISO mas recientes que ya salieron de la ventana diaria). Todo lo demas se elimina.
#
# Un identificador de corrida es la marca de tiempo del nombre del archivo:
# YYYYmmdd_HHMMSS (por ejemplo 20261019_030000).
#
# Documentado en: 05-ADMIN-SO/E3/ServidorRespaldo.md (seccion Rotacion)

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

# rotacion_ids_a_borrar <hoy YYYYmmdd> <dias_diarios> <semanas>
# Lee identificadores por stdin (uno por linea) e imprime por stdout los que
# deben eliminarse. Un identificador con formato invalido NUNCA se propone para
# borrado (se ignora y se avisa), para que un archivo ajeno no se pierda.
rotacion_ids_a_borrar() {
    local hoy="${1:?falta la fecha de referencia}"
    local diarios="${2:-7}"
    local semanas="${3:-4}"

    local hoy_epoch limite_diario limite_semanal
    hoy_epoch="$(date -u -d "${hoy:0:4}-${hoy:4:2}-${hoy:6:2}" +%s)"
    # Ventana diaria: hoy y los (diarios - 1) dias anteriores.
    limite_diario=$((hoy_epoch - (diarios - 1) * 86400))
    # Ventana semanal: `semanas` semanas calendario antes del fin de la diaria.
    # Sin este limite, una corrida de hace años sobreviviria como "semanal" si
    # fuera la unica que queda. Ademas se conservan como maximo `semanas`.
    limite_semanal=$((limite_diario - semanas * 7 * 86400))

    local id fecha epoch semana
    local -A mejor_por_semana=()
    local -a todos=()

    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        if [[ ! "$id" =~ ^[0-9]{8}_[0-9]{6}$ ]]; then
            echo "rotacion: identificador ignorado (formato invalido): $id" >&2
            continue
        fi
        todos+=("$id")
        fecha="${id:0:8}"
        epoch="$(date -u -d "${fecha:0:4}-${fecha:4:2}-${fecha:6:2}" +%s 2>/dev/null)" || {
            echo "rotacion: fecha invalida, se ignora: $id" >&2
            continue
        }
        if ((epoch >= limite_diario)); then
            continue  # dentro de la ventana diaria: se conserva
        fi
        if ((epoch < limite_semanal)); then
            continue  # fuera de la ventana semanal: se elimina
        fi
        semana="$(date -u -d "${fecha:0:4}-${fecha:4:2}-${fecha:6:2}" +%G-W%V)"
        # Candidato semanal: el mas reciente de cada semana ISO (comparacion
        # lexica del identificador, que es cronologica por construccion).
        if [[ -z "${mejor_por_semana[$semana]:-}" || "$id" > "${mejor_por_semana[$semana]}" ]]; then
            mejor_por_semana[$semana]="$id"
        fi
    done

    # Se conservan las `semanas` semanas mas recientes que tengan candidato.
    local -A conservar=()
    local n=0
    while IFS= read -r semana; do
        [[ -z "$semana" ]] && continue
        if ((n < semanas)); then
            conservar["${mejor_por_semana[$semana]}"]=1
            n=$((n + 1))
        fi
    done < <(printf '%s\n' "${!mejor_por_semana[@]}" | sort -r)

    for id in "${todos[@]}"; do
        fecha="${id:0:8}"
        epoch="$(date -u -d "${fecha:0:4}-${fecha:4:2}-${fecha:6:2}" +%s 2>/dev/null)" || continue
        if ((epoch >= limite_diario)); then
            continue
        fi
        if [[ -n "${conservar[$id]:-}" ]]; then
            continue
        fi
        echo "$id"
    done
}
