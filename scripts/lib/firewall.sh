#!/usr/bin/env bash
# firewall.sh: Modulo de firewall (UFW) del servidor SGRSI. Aplica la politica
# base documentada (denegar todo lo entrante, permitir lo saliente, abrir solo
# SSH en puerto no estandar, HTTP y HTTPS), gestiona reglas por puerto y verifica
# que el estado real coincida con lo documentado.
#
# Protecciones contra quedarse afuera (R5 de la auditoria de E2):
#   - La regla de SSH se agrega SIEMPRE antes de habilitar UFW.
#   - No se cierra el 22 si sshd todavia escucha solo en el 22.
#   - No se elimina ni se deniega el puerto SSH sin --forzar.
#
# Issue: wefaber/eternum#109
# Documentado en: 05-ADMIN-SO/E3/RedYPuertos.md

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

SGRSI_SSH_PUERTO="${SGRSI_SSH_PUERTO:-52205}"
SGRSI_FW_PUERTOS_WEB="${SGRSI_FW_PUERTOS_WEB:-80 443}"
SGRSI_FW_SSH_ORIGEN="${SGRSI_FW_SSH_ORIGEN:-}"      # CIDR(s) opcionales (separados por espacio) que pueden entrar por SSH
SGRSI_FW_PROHIBIDOS="${SGRSI_FW_PROHIBIDOS:-5432 3306 4111 8080}"  # nunca deben estar abiertos al exterior

firewall_descripcion() { echo "UFW: politica base, reglas por puerto y verificacion"; }

firewall_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh firewall <subcomando> [argumentos]

Subcomandos:
  estado                          ufw status verbose
  aplicar-base                    Politica base: deny incoming, allow outgoing,
                                  SSH (limitado), 80, 443; cierra el 22 si es seguro
  permitir <puerto>[/proto] [txt] Abre un puerto (tcp por defecto)
  denegar <puerto>[/proto]        Deniega un puerto
  eliminar <puerto>[/proto]       Quita la regla de un puerto
  verificar                       Comprueba que el estado coincida con lo documentado
  ayuda                           Esta ayuda

Opciones: --forzar (permite tocar el puerto SSH). Con --dry-run no se ejecuta ufw.
Variables: SGRSI_SSH_PUERTO, SGRSI_FW_PUERTOS_WEB, SGRSI_FW_SSH_ORIGEN.
FIN_AYUDA
}

# firewall_validar_puerto <puerto[/proto]>
firewall_validar_puerto() {
    local spec="${1:-}"
    if [[ ! "$spec" =~ ^([0-9]{1,5})(/(tcp|udp))?$ ]]; then
        log ERROR "Puerto invalido: '$spec' (usar 443 o 443/tcp)."
        return 1
    fi
    validar_puerto "${BASH_REMATCH[1]}" "puerto" || return 1
}

# firewall_puertos_sshd: puertos en los que sshd realmente escucha. Prefiere la
# configuracion efectiva (sshd -T) y cae a ss si no se puede leer.
firewall_puertos_sshd() {
    local puertos=""
    if command -v sshd >/dev/null 2>&1; then
        puertos="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' | sort -u | tr '\n' ' ')"
    fi
    if [[ -z "$puertos" ]] && command -v ss >/dev/null 2>&1; then
        puertos="$(ss -H -tlnp 2>/dev/null | awk '/sshd/ { n = split($4, a, ":"); print a[n] }' | sort -u | tr '\n' ' ')"
    fi
    echo "$puertos"
}

firewall_estado() {
    requerir_comando ufw || return 1
    ufw status verbose
}

firewall_aplicar_base() {
    requerir_root
    requerir_comando ufw || return 1
    validar_puerto "$SGRSI_SSH_PUERTO" "SGRSI_SSH_PUERTO" || return "$SGRSI_EX_CONFIG"
    local p
    for p in $SGRSI_FW_PUERTOS_WEB; do
        validar_puerto "$p" "SGRSI_FW_PUERTOS_WEB" || return "$SGRSI_EX_CONFIG"
    done

    # Politicas por defecto: explicitas, no dependen de lo que traiga el paquete.
    ejecutar ufw default deny incoming
    ejecutar ufw default allow outgoing

    # 1) SSH primero. `limit` frena fuerza bruta (6 conexiones por 30 s por origen).
    if [[ -n "$SGRSI_FW_SSH_ORIGEN" ]]; then
        local origen
        for origen in $SGRSI_FW_SSH_ORIGEN; do
            if [[ ! "$origen" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]]; then
                log ERROR "Origen SSH invalido: '$origen' (usar 192.0.2.10 o 192.0.2.0/24)."
                return "$SGRSI_EX_CONFIG"
            fi
            ejecutar ufw limit from "$origen" to any port "$SGRSI_SSH_PUERTO" proto tcp comment 'SSH administrativo (origen restringido)'
        done
    else
        ejecutar ufw limit "$SGRSI_SSH_PUERTO/tcp" comment 'SSH administrativo'
    fi

    # 2) Web.
    for p in $SGRSI_FW_PUERTOS_WEB; do
        ejecutar ufw allow "$p/tcp" comment "Web $p"
    done

    # 3) Cerrar el 22 solo si sshd ya no depende de el.
    local escuchando
    escuchando="$(firewall_puertos_sshd)"
    if [[ " $escuchando " == *" $SGRSI_SSH_PUERTO "* && " $escuchando " != *" 22 "* ]]; then
        ejecutar ufw deny 22/tcp comment 'SSH por defecto cerrado'
    elif es_dry_run; then
        log WARN "[dry-run] sshd escucha en: ${escuchando:-desconocido}. NO se cerraria el 22 (hasta que sshd deje de escuchar en el)."
    else
        log WARN "sshd escucha en: ${escuchando:-desconocido}. NO se cierra el 22 para no perder el acceso."
        log WARN "Aplicar primero 'admin.sh ssh aplicar', probar una sesion nueva en el $SGRSI_SSH_PUERTO y repetir aplicar-base."
    fi

    # 4) Habilitar al final, con las reglas de acceso ya cargadas.
    ejecutar ufw --force enable
    log INFO "Politica base aplicada. Verificar con: admin.sh firewall verificar"
}

# firewall_es_puerto_ssh <spec>
firewall_es_puerto_ssh() {
    [[ "${1%%/*}" == "$SGRSI_SSH_PUERTO" ]]
}

# firewall_regla <accion> <spec> [comentario] [--forzar]
firewall_regla() {
    local accion="$1" spec="${2:-}"
    shift 2 || true
    local comentario="" forzar="" arg
    for arg in "$@"; do
        if [[ "$arg" == "--forzar" ]]; then forzar="--forzar"; else comentario="$arg"; fi
    done
    firewall_validar_puerto "$spec" || return 1
    requerir_root
    requerir_comando ufw || return 1

    if [[ "$accion" != "allow" ]] && firewall_es_puerto_ssh "$spec" && [[ "$forzar" != "--forzar" ]]; then
        log ERROR "El puerto $spec es el de SSH. Cerrarlo deja el servidor sin acceso remoto. Repetir con --forzar si es deliberado."
        return 1
    fi

    case "$accion" in
        allow|deny)
            [[ "$spec" == */* ]] || spec="$spec/tcp"
            if [[ -n "$comentario" ]]; then
                ejecutar ufw "$accion" "$spec" comment "$comentario"
            else
                ejecutar ufw "$accion" "$spec"
            fi
            ;;
        delete)
            [[ "$spec" == */* ]] || spec="$spec/tcp"
            # `ufw delete` necesita la regla tal como se creo; se prueban las dos acciones.
            ejecutar ufw --force delete allow "$spec" || true
            ejecutar ufw --force delete deny "$spec" || true
            ;;
    esac
    log INFO "Regla $accion $spec aplicada."
}

# firewall_verificar: contrasta ufw status verbose con la politica documentada.
firewall_verificar() {
    requerir_comando ufw || return 1
    local salida fallos=0
    if ! salida="$(ufw status verbose 2>&1)"; then
        log ERROR "No se pudo leer el estado de ufw: $salida"
        return 1
    fi

    comprobar() {
        local descripcion="$1" patron="$2" esperado="${3:-presente}"
        if grep -Eq -- "$patron" <<<"$salida"; then
            if [[ "$esperado" == "presente" ]]; then echo "  [ok]    $descripcion"; else echo "  [FALLA] $descripcion"; fallos=$((fallos + 1)); fi
        else
            if [[ "$esperado" == "presente" ]]; then echo "  [FALLA] $descripcion"; fallos=$((fallos + 1)); else echo "  [ok]    $descripcion"; fi
        fi
    }

    comprobar "firewall activo" '^Status: active'
    comprobar "entrante denegado por defecto" 'deny \(incoming\)'
    comprobar "saliente permitido por defecto" 'allow \(outgoing\)'
    comprobar "SSH en $SGRSI_SSH_PUERTO/tcp" "^${SGRSI_SSH_PUERTO}/tcp +(ALLOW|LIMIT)"
    local p
    for p in $SGRSI_FW_PUERTOS_WEB; do
        comprobar "$p/tcp abierto" "^${p}/tcp +ALLOW"
    done
    comprobar "22/tcp cerrado" '^22/tcp +DENY'
    for p in $SGRSI_FW_PROHIBIDOS; do
        comprobar "$p/tcp no expuesto" "^${p}(/tcp)? +ALLOW" ausente
    done

    if [[ "$fallos" -gt 0 ]]; then
        log ERROR "$fallos comprobacion(es) del firewall no coinciden con lo documentado."
        return 1
    fi
    log INFO "El firewall coincide con la politica documentada."
}

firewall_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        estado)        firewall_estado ;;
        aplicar-base)  firewall_aplicar_base ;;
        permitir)      firewall_regla allow "$@" ;;
        denegar)       firewall_regla deny "$@" ;;
        eliminar)      firewall_regla delete "$@" ;;
        verificar)     firewall_verificar ;;
        ""|ayuda|-h|--help) firewall_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            firewall_ayuda
            return 1
            ;;
    esac
}
