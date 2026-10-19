#!/usr/bin/env bash
# red.sh: Modulo de red del servidor SGRSI. Consulta el estado de la interfaz
# principal, comprueba conectividad por capas (gateway, Internet, DNS), verifica
# que la IP fija sea la esperada y genera o aplica la configuracion estatica
# para ifupdown (valor por defecto del instalador de Debian) o systemd-networkd.
#
# Issue: wefaber/eternum#109
# Documentado en: 05-ADMIN-SO/E3/RedYPuertos.md

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

# Direccionamiento propuesto (ver RedYPuertos.md). Los valores reales se
# definen en /etc/sgrsi/sgrsi.conf; aca solo hay valores de ejemplo para que el
# modulo funcione en dry-run. No se aplican si faltan en la configuracion.
SGRSI_RED_IFACE="${SGRSI_RED_IFACE:-}"                      # vacio: se detecta la de la ruta por defecto
SGRSI_RED_IP="${SGRSI_RED_IP:-}"
SGRSI_RED_PREFIJO="${SGRSI_RED_PREFIJO:-24}"
SGRSI_RED_GATEWAY="${SGRSI_RED_GATEWAY:-}"
SGRSI_RED_DNS="${SGRSI_RED_DNS:-}"                          # lista separada por espacios
SGRSI_RED_BACKEND="${SGRSI_RED_BACKEND:-auto}"              # auto | ifupdown | networkd
SGRSI_RED_PING_EXTERNO="${SGRSI_RED_PING_EXTERNO:-9.9.9.9}"
SGRSI_RED_NOMBRE_DNS="${SGRSI_RED_NOMBRE_DNS:-deb.debian.org}"
SGRSI_RED_IFUPDOWN_ARCHIVO="${SGRSI_RED_IFUPDOWN_ARCHIVO:-/etc/network/interfaces}"
SGRSI_RED_NETWORKD_ARCHIVO="${SGRSI_RED_NETWORKD_ARCHIVO:-/etc/systemd/network/10-sgrsi.network}"

red_descripcion() { echo "Estado, conectividad y configuracion de IP fija"; }

red_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh red <subcomando> [argumentos]

Subcomandos:
  estado                  Interfaz por defecto, IP, modo (estatica o dhcp) y gateway
  conectividad            Prueba por capas: gateway, Internet por IP, resolucion DNS
  verificar               Compara la IP actual con SGRSI_RED_IP y avisa si difiere
  config [backend]        Muestra la configuracion estatica que se aplicaria (ifupdown|networkd)
  aplicar [--reload]      Escribe la configuracion (con copia previa). Con --reload la
                          activa y revierte sola si se pierde la conectividad

Variables: SGRSI_RED_IFACE, SGRSI_RED_IP, SGRSI_RED_PREFIJO, SGRSI_RED_GATEWAY,
SGRSI_RED_DNS, SGRSI_RED_BACKEND. Se definen en /etc/sgrsi/sgrsi.conf.
Con --dry-run (opcion global) no se modifica nada.
FIN_AYUDA
}

# red_iface_defecto: interfaz de la ruta por defecto IPv4.
red_iface_defecto() {
    if [[ -n "$SGRSI_RED_IFACE" ]]; then
        echo "$SGRSI_RED_IFACE"
        return 0
    fi
    local iface
    iface="$(ip -4 route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}')"
    if [[ -z "$iface" ]]; then
        log ERROR "No hay ruta por defecto IPv4. Definir SGRSI_RED_IFACE o revisar el cableado y el gateway."
        return 1
    fi
    echo "$iface"
}

# red_ip_actual <iface>: primera direccion IPv4 global en formato IP/prefijo.
red_ip_actual() {
    ip -4 -o addr show dev "${1:-}" scope global 2>/dev/null | awk '{print $4; exit}'
}

# red_modo_actual <iface>: "dhcp" si la direccion tiene concesion (flag
# dynamic), "estatica" en caso contrario, "sin-ip" si no hay direccion.
red_modo_actual() {
    local iface="${1:-}"
    local linea
    linea="$(ip -4 -o addr show dev "$iface" scope global 2>/dev/null | head -n 1)"
    if [[ -z "$linea" ]]; then
        echo "sin-ip"
    elif grep -qw dynamic <<<"$linea"; then
        echo "dhcp"
    else
        echo "estatica"
    fi
}

red_gateway_actual() {
    ip -4 route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "via") { print $(i + 1); exit }}'
}

red_estado() {
    local iface ip modo gw
    iface="$(red_iface_defecto)" || return 1
    ip="$(red_ip_actual "$iface")"
    modo="$(red_modo_actual "$iface")"
    gw="$(red_gateway_actual)"

    echo "Interfaz:  $iface"
    echo "IP:        ${ip:-(sin IP)}"
    echo "Modo:      $modo"
    echo "Gateway:   ${gw:-(sin gateway)}"
    echo "Hostname:  $(hostname 2>/dev/null || echo desconocido)"

    if [[ "$modo" == "dhcp" ]]; then
        log WARN "La interfaz usa DHCP: la IP puede cambiar. El servidor debe tener IP fija (admin.sh red config)."
    fi
}

# red_ping <destino>: un paquete, 2 s de espera.
red_ping() {
    ping -c 1 -W 2 "$1" >/dev/null 2>&1
}

# red_conectividad
# Prueba en orden de capas para ubicar donde se corta: si falla el gateway el
# problema es local; si pasa el gateway pero no el ping externo es el enlace
# del proveedor; si pasa el ping externo y falla el nombre es DNS.
red_conectividad() {
    local fallos=0 gw
    gw="$(red_gateway_actual)"

    if [[ -z "$gw" ]]; then
        echo "  [FALLA] gateway: no hay ruta por defecto"
        fallos=$((fallos + 1))
    elif red_ping "$gw"; then
        echo "  [ok]    gateway $gw responde"
    else
        echo "  [FALLA] gateway $gw no responde (problema de red local)"
        fallos=$((fallos + 1))
    fi

    if red_ping "$SGRSI_RED_PING_EXTERNO"; then
        echo "  [ok]    Internet por IP ($SGRSI_RED_PING_EXTERNO)"
    else
        echo "  [FALLA] sin salida a $SGRSI_RED_PING_EXTERNO (enlace o firewall del proveedor)"
        fallos=$((fallos + 1))
    fi

    if getent hosts "$SGRSI_RED_NOMBRE_DNS" >/dev/null 2>&1; then
        echo "  [ok]    DNS resuelve $SGRSI_RED_NOMBRE_DNS"
    else
        echo "  [FALLA] DNS no resuelve $SGRSI_RED_NOMBRE_DNS (revisar /etc/resolv.conf)"
        fallos=$((fallos + 1))
    fi

    if [[ "$fallos" -gt 0 ]]; then
        log ERROR "Conectividad incompleta: $fallos prueba(s) fallaron."
        return 1
    fi
    log INFO "Conectividad completa."
}

# red_verificar: la IP configurada es la esperada y no es DHCP.
red_verificar() {
    validar_no_vacio "$SGRSI_RED_IP" "SGRSI_RED_IP" || return "$SGRSI_EX_CONFIG"
    local iface actual modo
    iface="$(red_iface_defecto)" || return 1
    actual="$(red_ip_actual "$iface")"
    modo="$(red_modo_actual "$iface")"

    if [[ "${actual%%/*}" != "$SGRSI_RED_IP" ]]; then
        log ERROR "La IP actual de $iface es '${actual:-ninguna}' y la esperada es '$SGRSI_RED_IP'."
        return 1
    fi
    if [[ "$modo" == "dhcp" ]]; then
        log ERROR "La IP coincide pero fue concedida por DHCP. Debe ser estatica."
        return 1
    fi
    log INFO "IP fija correcta: $iface $actual (modo $modo)."
}

# red_validar_parametros: nada se genera con datos invalidos, porque una IP
# mal escrita en /etc/network/interfaces deja al servidor sin red.
red_validar_parametros() {
    validar_no_vacio "$SGRSI_RED_IP" "SGRSI_RED_IP" || return "$SGRSI_EX_CONFIG"
    validar_no_vacio "$SGRSI_RED_GATEWAY" "SGRSI_RED_GATEWAY" || return "$SGRSI_EX_CONFIG"
    validar_ipv4 "$SGRSI_RED_IP" "SGRSI_RED_IP" || return "$SGRSI_EX_CONFIG"
    validar_ipv4 "$SGRSI_RED_GATEWAY" "SGRSI_RED_GATEWAY" || return "$SGRSI_EX_CONFIG"
    validar_prefijo "$SGRSI_RED_PREFIJO" "SGRSI_RED_PREFIJO" || return "$SGRSI_EX_CONFIG"
    local dns
    for dns in $SGRSI_RED_DNS; do
        validar_ipv4 "$dns" "SGRSI_RED_DNS" || return "$SGRSI_EX_CONFIG"
    done
}

# red_backend_efectivo: resuelve "auto" mirando que gestiona la red.
red_backend_efectivo() {
    case "$SGRSI_RED_BACKEND" in
        ifupdown|networkd) echo "$SGRSI_RED_BACKEND"; return 0 ;;
        auto) ;;
        *) log ERROR "SGRSI_RED_BACKEND invalido: '$SGRSI_RED_BACKEND' (auto, ifupdown o networkd)."; return "$SGRSI_EX_CONFIG" ;;
    esac
    if systemctl is-active --quiet systemd-networkd 2>/dev/null; then
        echo networkd
    else
        echo ifupdown
    fi
}

# red_config [backend]: emite la configuracion por stdout.
red_config() {
    local backend="${1:-}"
    local iface
    red_validar_parametros || return $?
    [[ -n "$backend" ]] || backend="$(red_backend_efectivo)" || return $?
    iface="$(red_iface_defecto)" || return 1

    case "$backend" in
        ifupdown)
            cat <<FIN_IFUPDOWN
# Generado por lux/scripts/lib/red.sh (SGRSI). IP fija del servidor.
# Los valores salen de /etc/sgrsi/sgrsi.conf; no editar a mano.
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

auto $iface
iface $iface inet static
    address $SGRSI_RED_IP/$SGRSI_RED_PREFIJO
    gateway $SGRSI_RED_GATEWAY
$([[ -n "$SGRSI_RED_DNS" ]] && echo "    dns-nameservers $SGRSI_RED_DNS")
FIN_IFUPDOWN
            ;;
        networkd)
            {
                cat <<FIN_NETWORKD
# Generado por lux/scripts/lib/red.sh (SGRSI). IP fija del servidor.
[Match]
Name=$iface

[Network]
Address=$SGRSI_RED_IP/$SGRSI_RED_PREFIJO
Gateway=$SGRSI_RED_GATEWAY
FIN_NETWORKD
                local dns
                for dns in $SGRSI_RED_DNS; do
                    echo "DNS=$dns"
                done
            }
            ;;
        *)
            log ERROR "Backend desconocido: '$backend' (ifupdown o networkd)."
            return "$SGRSI_EX_USO"
            ;;
    esac
}

# red_aplicar [--reload]
red_aplicar() {
    local recargar=0
    [[ "${1:-}" == "--reload" ]] && recargar=1

    requerir_root
    red_validar_parametros || return $?

    local backend archivo
    backend="$(red_backend_efectivo)" || return $?
    case "$backend" in
        ifupdown) archivo="$SGRSI_RED_IFUPDOWN_ARCHIVO" ;;
        networkd) archivo="$SGRSI_RED_NETWORKD_ARCHIVO" ;;
    esac

    local nuevo respaldo=""
    nuevo="$(mktemp)"
    # shellcheck disable=SC2064
    trap "rm -f '$nuevo'" RETURN
    red_config "$backend" > "$nuevo"

    # Defensa contra una IP que ya esta en uso en la LAN: arping si existe.
    if command -v arping >/dev/null 2>&1 && ! es_dry_run; then
        if arping -D -c 2 -w 3 -I "$(red_iface_defecto)" "$SGRSI_RED_IP" >/dev/null 2>&1; then
            :
        else
            log WARN "arping indica que $SGRSI_RED_IP podria estar en uso por otro equipo. Verificar antes de activar."
        fi
    fi

    if es_dry_run; then
        log INFO "[dry-run] Se escribiria $archivo ($backend) con:"
        sed 's/^/    | /' "$nuevo" >&2
        log INFO "[dry-run] Se haria copia previa de $archivo"
        if [[ "$recargar" -eq 1 ]]; then
            log INFO "[dry-run] Se activaria la configuracion y se revertiria sola si falla la conectividad."
        fi
        return 0
    fi

    if [[ -f "$archivo" ]]; then
        respaldo="${archivo}.bak-$(date '+%Y%m%d_%H%M%S')"
        cp -p "$archivo" "$respaldo"
        log INFO "Configuracion anterior respaldada en $respaldo"
    fi
    install -m 644 "$nuevo" "$archivo"
    log INFO "Configuracion escrita en $archivo ($backend)."

    if [[ "$recargar" -eq 0 ]]; then
        log WARN "No se activo. Revisar el archivo y activar con: admin.sh red aplicar --reload (o reiniciar la red desde la consola de la VM, no por SSH)."
        return 0
    fi

    red_recargar "$backend" "$archivo" "$respaldo"
}

# red_recargar <backend> <archivo> <respaldo>
# Activa la configuracion y comprueba el gateway. Si no responde en 20 s,
# restaura el archivo anterior y vuelve a activarlo. Ignora SIGHUP para que una
# caida de la sesion SSH (esperable al cambiar la IP) no interrumpa la reversion.
red_recargar() {
    local backend="$1" archivo="$2" respaldo="$3"
    trap '' HUP
    log WARN "Activando la nueva configuracion. Si esta sesion es por SSH se puede cortar."
    red_reiniciar_servicio "$backend" || true
    ${SGRSI_SLEEP:-sleep} 5

    local intento
    # shellcheck disable=SC2034  # solo cuenta los intentos
    for intento in 1 2 3 4; do
        if red_ping "$SGRSI_RED_GATEWAY"; then
            log INFO "Gateway $SGRSI_RED_GATEWAY alcanzable con la nueva configuracion."
            return 0
        fi
        ${SGRSI_SLEEP:-sleep} 5
    done

    log ERROR "Sin respuesta del gateway tras activar. Se revierte."
    if [[ -n "$respaldo" && -f "$respaldo" ]]; then
        cp -p "$respaldo" "$archivo"
        red_reiniciar_servicio "$backend" || true
        log WARN "Configuracion anterior restaurada desde $respaldo"
    else
        log ERROR "No hay copia previa para restaurar: corregir $archivo desde la consola de la VM."
    fi
    return 1
}

red_reiniciar_servicio() {
    case "$1" in
        ifupdown)
            if command -v ifreload >/dev/null 2>&1; then
                ejecutar ifreload -a
            else
                ejecutar systemctl restart networking
            fi
            ;;
        networkd)
            ejecutar networkctl reload
            ;;
    esac
}

red_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        estado)        red_estado ;;
        conectividad)  red_conectividad ;;
        verificar)     red_verificar ;;
        config)        red_config "$@" ;;
        aplicar)       red_aplicar "$@" ;;
        ""|ayuda|-h|--help) red_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            red_ayuda
            return 1
            ;;
    esac
}
