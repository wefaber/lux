#!/usr/bin/env bash
# integracion-respaldo.sh: Prueba de integracion del servidor de respaldo, de
# punta a punta y sin tocar la configuracion del sistema.
#
# Levanta un sshd EFIMERO (127.0.0.1, puerto alto, claves y configuracion en un
# directorio temporal) para reproducir el camino real: cliente (lib/respaldo.sh)
# -> rsync sobre SSH con llave limitada a rrsync -> servidor (servidor-respaldo.sh).
# No usa el sshd ni el firewall del equipo.
#
# Requiere: sshd, ssh, ssh-keygen, rsync, rrsync, sha256sum. Se salta si falta alguno.
# Uso:  scripts/tests/integracion-respaldo.sh
#
# Issue: wefaber/eternum#109

set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(dirname "$AQUI")"
RAIZ="$(dirname "$SCRIPTS")"
SERVIDOR="$RAIZ/ops/backup-server/servidor-respaldo.sh"
ADMIN="$SCRIPTS/admin.sh"

PASADAS=0
FALLADAS=0
ok()    { PASADAS=$((PASADAS + 1)); printf '  ok    %s\n' "$1"; }
falla() { FALLADAS=$((FALLADAS + 1)); printf '  FALLA %s\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; }
# chk <descripcion> <comando...>: debe terminar con exito
chk()   { local d="$1"; shift; local s; if s="$("$@" 2>&1)"; then ok "$d"; else falla "$d" "$(head -n 3 <<<"$s")"; fi; }
# chkno <descripcion> <comando...>: debe terminar con error
chkno() { local d="$1"; shift; local s; if s="$("$@" 2>&1)"; then falla "$d" "termino con exito y se esperaba un error"; else ok "$d"; fi; }

for h in sshd ssh ssh-keygen rsync rrsync sha256sum; do
    if ! command -v "$h" >/dev/null 2>&1 && [[ ! -x "/usr/bin/$h" && ! -x "/usr/sbin/$h" ]]; then
        echo "salta: falta '$h'"
        exit 0
    fi
done

T="$(mktemp -d)"
PUERTO=$((20000 + RANDOM % 20000))
SSHD_PID=""
cleanup() {
    [[ -n "$SSHD_PID" ]] && kill "$SSHD_PID" 2>/dev/null
    rm -rf "$T"
}
trap cleanup EXIT

echo "Directorio de prueba: $T (sshd efimero en 127.0.0.1:$PUERTO)"
mkdir -p "$T"/{srv,home,cliente/backups,run,lock}

# --- Claves ---------------------------------------------------------------------
ssh-keygen -q -t ed25519 -N '' -f "$T/hostkey"
ssh-keygen -q -t ed25519 -N '' -f "$T/k_escritura"
ssh-keygen -q -t ed25519 -N '' -f "$T/k_lectura"
echo "[127.0.0.1]:$PUERTO $(cut -d' ' -f1,2 "$T/hostkey.pub")" > "$T/known_hosts"

# --- Servidor: directorios y authorized_keys con las funciones reales ----------------
export SGRSI_LOG="$T/servidor.log" SGRSI_LOCK_DIR="$T/lock" SGRSI_SIN_CONFIRMACION=true
export SGRSI_RESP_BASE="$T/srv" SGRSI_RESP_HOME="$T/home" SGRSI_RESP_USUARIO=root SGRSI_RESP_GRUPO=root
export SGRSI_PROD_IP=127.0.0.1 SGRSI_RESP_ESTABLE_SEGUNDOS=0 SGRSI_RRSYNC="$(command -v rrsync)"
mkdir -p "$T/srv"/{incoming,almacen,rechazados}
chmod 700 "$T/srv"/incoming

# shellcheck source=/dev/null
( source "$SERVIDOR"; instalar_llaves "$T/k_escritura.pub" "$T/k_lectura.pub" ) >/dev/null 2>&1
chk "authorized_keys generado con rrsync -wo y -ro" bash -c "grep -q 'rrsync -wo' '$T/home/.ssh/authorized_keys' && grep -q 'rrsync -ro' '$T/home/.ssh/authorized_keys'"
chk "las llaves quedan con 'restrict'" bash -c "[[ \$(grep -c 'restrict' '$T/home/.ssh/authorized_keys') -eq 2 ]]"

cat > "$T/sshd_config" <<FIN
Port $PUERTO
ListenAddress 127.0.0.1
HostKey $T/hostkey
PidFile $T/run/sshd.pid
AuthorizedKeysFile $T/home/.ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin yes
UsePAM no
StrictModes no
LogLevel VERBOSE
FIN
mkdir -p /run/sshd 2>/dev/null || true

iniciar_sshd() {
    "$(command -v sshd || echo /usr/sbin/sshd)" -D -f "$T/sshd_config" -E "$T/sshd.log" </dev/null >/dev/null 2>&1 &
    SSHD_PID=$!
    for _ in $(seq 1 30); do
        (exec 3<>"/dev/tcp/127.0.0.1/$PUERTO") 2>/dev/null && return 0
        sleep 0.2
    done
    return 1
}
if iniciar_sshd; then ok "sshd efimero arranca"; else falla "sshd efimero arranca"; fi

# --- Corridas de ejemplo -----------------------------------------------------------
B="$T/cliente/backups"
fabricar() {
    local id="$1" filas="$2"
    {
        echo "CREATE TABLE users (id int PRIMARY KEY, name text);"
        for i in $(seq 1 "$filas"); do echo "INSERT INTO users VALUES ($i, 'u$i');"; done
    } | gzip > "$B/lux_${id}.sql.gz"
    echo "config de ejemplo $id" | tar -czf "$B/archivos_${id}.tar.gz" --files-from=/dev/null 2>/dev/null
    (cd "$B" && sha256sum "lux_${id}.sql.gz" "archivos_${id}.tar.gz" > "lux_${id}.sha256")
}
ID_A="$(date -d '2 days ago' +%Y%m%d)_030000"
ID_B="$(date +%Y%m%d)_030000"
fabricar "$ID_A" 5
fabricar "$ID_B" 8

# --- Cliente ------------------------------------------------------------------------
export SGRSI_BACKUP_DIR="$B"
export SGRSI_RESPALDO_HOST=127.0.0.1 SGRSI_RESPALDO_PUERTO="$PUERTO" SGRSI_RESPALDO_USUARIO=root
export SGRSI_RESPALDO_LLAVE="$T/k_escritura" SGRSI_RESPALDO_LLAVE_LECTURA="$T/k_lectura"
export SGRSI_RESPALDO_KNOWN_HOSTS="$T/known_hosts" SGRSI_RESPALDO_REINTENTOS=2 SGRSI_SLEEP=true
export SGRSI_RESTAURACION_DIR="$T/cliente/restauracion"
export SGRSI_LOG="$T/cliente.log"

echo; echo "-- Cliente: conexion y envio"
chk "probar: TCP y autenticacion con la llave de escritura" "$ADMIN" respaldo remoto probar
chk "dry-run no envia nada" "$ADMIN" --dry-run respaldo remoto sincronizar
chk "tras el dry-run incoming sigue vacio" bash -c "[[ -z \"\$(ls -A '$T/srv/incoming')\" ]]"
chk "sincronizar entrega las dos corridas" "$ADMIN" respaldo remoto sincronizar
chk "incoming tiene las dos corridas" bash -c "[[ -d '$T/srv/incoming/$ID_A' && -d '$T/srv/incoming/$ID_B' ]]"
chk "el .sha256 llego (marca de completa)" test -f "$T/srv/incoming/$ID_B/lux_${ID_B}.sha256"
chk "quedaron registradas como enviadas" bash -c "grep -qx '$ID_B' '$B/.enviados' && grep -qx '$ID_A' '$B/.enviados'"
chk "sincronizar de nuevo no tiene nada pendiente" "$ADMIN" respaldo remoto sincronizar
chk "verificar remoto por checksum (rsync -c)" "$ADMIN" respaldo remoto verificar "$ID_B"
chk "estado remoto sin alertas" "$ADMIN" respaldo remoto estado

echo; echo "-- La llave de escritura NO puede leer ni ejecutar"
chkno "no puede traer archivos con la llave de escritura" \
    rsync -rt -e "ssh -p $PUERTO -i $T/k_escritura -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile=$T/known_hosts" \
    "root@127.0.0.1:$ID_B/" "$T/robado/"
chkno "no obtiene shell ni ejecuta comandos" \
    ssh -p "$PUERTO" -i "$T/k_escritura" -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$T/known_hosts" root@127.0.0.1 'cat /etc/passwd'

echo; echo "-- Servidor: procesar, almacenar y rotar"
export SGRSI_LOG="$T/servidor.log"
chk "procesar valida y almacena" "$SERVIDOR" procesar
chk "las dos corridas estan en el almacen" bash -c "[[ -f '$T/srv/almacen/$ID_A/lux_${ID_A}.sql.gz' && -f '$T/srv/almacen/$ID_B/lux_${ID_B}.sql.gz' ]]"
chk "incoming quedo vacio" bash -c "[[ -z \"\$(ls -A '$T/srv/incoming')\" ]]"
chk "verificar audita el almacen" "$SERVIDOR" verificar
chk "estado del servidor de respaldo" "$SERVIDOR" estado

# Corrupcion en transito: se altera un byte despues de recibir.
ID_C="$(date -d '1 day ago' +%Y%m%d)_030000"
export SGRSI_LOG="$T/cliente.log"
fabricar "$ID_C" 3
"$ADMIN" respaldo remoto sincronizar >/dev/null 2>&1
printf 'X' | dd of="$T/srv/incoming/$ID_C/lux_${ID_C}.sql.gz" bs=1 seek=10 conv=notrunc 2>/dev/null
export SGRSI_LOG="$T/servidor.log"
chkno "procesar detecta la corrupcion (sale con error)" "$SERVIDOR" procesar
chk "la corrida alterada va a rechazados" test -d "$T/srv/rechazados/$ID_C"
chk "la corrida alterada NO entra al almacen" bash -c "[[ ! -e '$T/srv/almacen/$ID_C' ]]"

# Rotacion en el servidor con corridas viejas inventadas
mkdir -p "$T/srv/almacen/20200101_030000" "$T/srv/almacen/20200102_030000"
touch "$T/srv/almacen/20200101_030000/x" "$T/srv/almacen/20200102_030000/x"
chk "rotar corre" "$SERVIDOR" rotar
chk "rotar elimina lo viejo" bash -c "[[ ! -e '$T/srv/almacen/20200101_030000' ]] || [[ -e '$T/srv/almacen/20200102_030000' ]]"
chk "rotar conserva lo reciente" test -d "$T/srv/almacen/$ID_B"

echo; echo "-- Fallback: servidor caido y recuperacion"
ID_D="$(date +%Y%m%d)_040000"
fabricar "$ID_D" 2
kill "$SSHD_PID" 2>/dev/null; wait "$SSHD_PID" 2>/dev/null; SSHD_PID=""
export SGRSI_LOG="$T/cliente.log"
"$ADMIN" respaldo remoto sincronizar >/dev/null 2>&1; RC=$?
if [[ "$RC" -eq 75 ]]; then ok "con el destino caido sale con codigo 75 (fallo temporal)"; else falla "codigo esperado 75 y fue $RC"; fi
chk "queda una alerta abierta" test -f "$B/.alerta-remoto"
chk "la corrida sigue pendiente" bash -c "! grep -qx '$ID_D' '$B/.enviados'"
chkno "estado remoto informa la alerta (error)" "$ADMIN" respaldo remoto estado
if iniciar_sshd; then ok "el destino vuelve a levantarse"; else falla "el destino vuelve a levantarse"; fi
chk "la siguiente sincronizacion entrega lo pendiente" "$ADMIN" respaldo remoto sincronizar
chk "la alerta se limpia" bash -c "[[ ! -e '$B/.alerta-remoto' ]]"

echo; echo "-- Restauracion desde el servidor de respaldo"
export SGRSI_LOG="$T/servidor.log"
"$SERVIDOR" procesar >/dev/null 2>&1
export SGRSI_LOG="$T/cliente.log"
chk "restaurar trae la corrida con la llave de lectura" "$ADMIN" respaldo remoto restaurar "$ID_B"
chk "el dump restaurado coincide con el original" cmp "$B/lux_${ID_B}.sql.gz" "$T/cliente/restauracion/remoto_$ID_B/lux_${ID_B}.sql.gz"
chkno "la llave de lectura no puede escribir" \
    rsync -rt -e "ssh -p $PUERTO -i $T/k_lectura -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile=$T/known_hosts" \
    "$B/lux_${ID_B}.sha256" "root@127.0.0.1:intruso/"

echo
echo "pasadas: $PASADAS  falladas: $FALLADAS"
[[ "$FALLADAS" -eq 0 ]]
