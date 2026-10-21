#!/usr/bin/env bash
# verificar-redes.sh: Comprueba contra el stack EN EJECUCION que la segmentacion
# de redes de ops/compose.yaml se cumple de verdad (no solo que el YAML la
# declare). Sirve como evidencia del despliegue: imprime una matriz
# origen -> destino con lo esperado y lo observado, y sale con 1 si algo difiere.
#
#   web --lux_app--> api --lux_data--> db         web tambien en lux_edge
#
# Uso:  ops/verificar-redes.sh [proyecto]      (proyecto de compose, por defecto "lux")
# Variable: SGRSI_CONTENEDORES  podman (por defecto) o docker.
#
# Documentado en: ops/README.md

set -euo pipefail

PROYECTO="${1:-lux}"
CLI="${SGRSI_CONTENEDORES:-podman}"
FALLAS=0

# contenedor <servicio>: primer contenedor del servicio (podman-compose y
# docker-compose etiquetan igual com.docker.compose.*).
contenedor() {
    # sed -n 1p y no head -n 1: con varias replicas head cierra la tuberia antes
    # de que podman termine de escribir, y pipefail corta el script (rc=141).
    "$CLI" ps -q \
        --filter "label=com.docker.compose.project=$PROYECTO" \
        --filter "label=com.docker.compose.service=$1" | sed -n 1p
}

# alcanza <contenedor> <host> <puerto>: 0 si abre una conexion TCP. Usa bash
# (/dev/tcp) y no nc porque la imagen de PostgreSQL no trae nc.
alcanza() {
    "$CLI" exec "$1" sh -c "timeout 3 bash -c 'exec 3<>/dev/tcp/$2/$3' 2>/dev/null || timeout 3 nc -z -w 3 '$2' '$3' 2>/dev/null"
}

# esperar <descripcion> <si|no> <contenedor> <host> <puerto>
esperar() {
    local desc="$1" esperado="$2" observado=no
    shift 2
    if alcanza "$@" >/dev/null 2>&1; then observado=si; fi
    if [[ "$observado" == "$esperado" ]]; then
        printf '  OK    %-46s esperado=%s observado=%s\n' "$desc" "$esperado" "$observado"
    else
        printf '  FALLA %-46s esperado=%s observado=%s\n' "$desc" "$esperado" "$observado"
        FALLAS=$((FALLAS + 1))
    fi
}

DB="$(contenedor db)"
API="$(contenedor api)"
WEB="$(contenedor web)"
for par in "db:$DB" "api:$API" "web:$WEB"; do
    if [[ -z "${par#*:}" ]]; then
        echo "No hay contenedor en ejecucion para el servicio '${par%%:*}' (proyecto '$PROYECTO')." >&2
        exit 2
    fi
done

echo "Alcanzabilidad entre modulos:"
esperar "api -> db:5432 (lux_data)"              si "$API" db 5432
esperar "web -> api:4111 (lux_app)"              si "$WEB" api 4111
esperar "web -> db:5432 (sin red en comun)"      no "$WEB" db 5432

echo "Salida a Internet (las redes internas no tienen gateway):"
esperar "db  -> 1.1.1.1:443"                     no "$DB"  1.1.1.1 443
esperar "api -> 1.1.1.1:443"                     no "$API" 1.1.1.1 443

echo "Puertos publicados en el host:"
publicado() { "$CLI" port "$1" 2>/dev/null || true; }
if [[ -n "$(publicado "$DB")$(publicado "$API")" ]]; then
    echo "  FALLA db o api publican puertos en el host"
    FALLAS=$((FALLAS + 1))
else
    echo "  OK    db y api no publican nada"
fi
if publicado "$WEB" | grep -v '127\.0\.0\.1' >/dev/null; then
    echo "  FALLA web publica en otra interfaz que loopback:"
    publicado "$WEB" | sed 's/^/        /'
    FALLAS=$((FALLAS + 1))
else
    echo "  OK    web solo en loopback: $(publicado "$WEB" | tr '\n' ' ')"
fi

echo
if (( FALLAS > 0 )); then
    echo "$FALLAS comprobacion(es) fallaron."
    exit 1
fi
echo "Segmentacion de redes verificada."
