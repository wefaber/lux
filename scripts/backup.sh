#!/usr/bin/env bash
# backup.sh: Respaldo del SGRSI (Lux). Version final (E3): ademas del dump de
# PostgreSQL respalda los archivos de configuracion del servidor, opcionalmente
# un paquete cifrado con los secretos, y deja un archivo de sumas de control
# (SHA-256) por corrida. Se invoca a mano o desde cron.
#
# Cada corrida tiene un identificador YYYYmmdd_HHMMSS y produce, en BACKUP_DIR:
#   lux_<id>.sql.gz          dump logico de la base
#   archivos_<id>.tar.gz     configuracion del servidor (sin secretos)
#   secretos_<id>.tar.gz.gpg secretos cifrados (solo si hay clave configurada)
#   lux_<id>.sha256          sumas de control de lo anterior (marca de corrida completa)
#
# Los archivos se arman primero en BACKUP_DIR/.tmp (almacenamiento temporal) y
# se mueven al destino recien cuando pasan sus comprobaciones, de modo que
# nadie (ni la sincronizacion remota) ve un archivo a medio escribir.
#
# Issues: wefaber/eternum#77 (base), #109 (version final)
# Documentado en: 05-ADMIN-SO/E3/ServidorRespaldo.md

set -euo pipefail

# Si admin.sh (u otro modulo) ya definio SGRSI_DIR, se respeta: este archivo
# tambien se carga con `source` desde lib/respaldo.sh.
if [[ -z "${SGRSI_DIR:-}" ]]; then
    SGRSI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    readonly SGRSI_DIR
fi
# shellcheck source=lib/comun.sh
source "$SGRSI_DIR/lib/comun.sh"
# shellcheck source=lib/db.sh
source "$SGRSI_DIR/lib/db.sh"
# shellcheck source=lib/rotacion.sh
source "$SGRSI_DIR/lib/rotacion.sh"

# --- Configuracion, sobreescribible por /etc/sgrsi/sgrsi.conf o el entorno ---
BACKUP_DIR="${SGRSI_BACKUP_DIR:-/var/backups/sgrsi}"
RETENCION_DIARIOS="${SGRSI_BACKUP_DIARIOS:-7}"
RETENCION_SEMANAS="${SGRSI_BACKUP_SEMANAS:-4}"
MIN_LIBRE_MB="${SGRSI_BACKUP_MIN_LIBRE_MB:-500}"
MAX_EDAD_HORAS="${SGRSI_BACKUP_MAX_EDAD_HORAS:-26}"
# Rutas de configuracion a respaldar (las que no existan se omiten con aviso).
RUTAS_ARCHIVOS="${SGRSI_BACKUP_RUTAS:-/etc/sgrsi /etc/ssh/sshd_config.d /etc/ufw /etc/network/interfaces /etc/cron.d /etc/logrotate.d/sgrsi /etc/hostname /etc/hosts /etc/fstab /var/spool/cron/crontabs $SGRSI_RAIZ/ops $SGRSI_RAIZ/scripts}"
# Lo que NUNCA entra en archivos_*.tar.gz porque son secretos.
EXCLUIR_ARCHIVOS="${SGRSI_BACKUP_EXCLUIR:-/etc/sgrsi/lux.env /etc/sgrsi/secrets}"
# Secretos: se cifran con gpg simetrico si existe la clave; si no, se omiten.
RUTAS_SECRETOS="${SGRSI_BACKUP_SECRETOS:-/etc/sgrsi/lux.env /etc/sgrsi/secrets}"
CLAVE_ARCHIVO="${SGRSI_BACKUP_CLAVE_ARCHIVO:-}"
# Tablas que deben existir y tener filas en un respaldo valido (vacio: solo se
# exige que el dump tenga alguna fila en alguna tabla).
TABLAS_OBLIGATORIAS="${SGRSI_VERIFICAR_TABLAS_OBLIGATORIAS:-}"
RESTAURACION_DIR="${SGRSI_RESTAURACION_DIR:-/var/backups/sgrsi/restauracion}"
CRON_ORIGEN="$SGRSI_DIR/cron/sgrsi-backup"
CRON_DESTINO="/etc/cron.d/sgrsi-backup"
USUARIO_SERVICIO="${SGRSI_STACK_USUARIO-sgrsi}"

PATRON_ID='[0-9]{8}_[0-9]{6}'

# --- Utilidades ---------------------------------------------------------------

# requerir_herramienta <comando>: conserva el nombre de E2 (los tests lo usan).
requerir_herramienta() {
    requerir_comando "$1" "${2:-postgresql-client}"
}

# ids_existentes: identificadores de corrida presentes en BACKUP_DIR, sin repetir.
ids_existentes() {
    [[ -d "$BACKUP_DIR" ]] || return 0
    find "$BACKUP_DIR" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null \
        | sed -nE "s/^(lux|archivos|secretos)_(${PATRON_ID})\..*/\2/p" | sort -u
}

# ultimo_respaldo: dump mas reciente, usado por `verificar` y `restaurar` sin argumento.
ultimo_respaldo() {
    find "$BACKUP_DIR" -maxdepth 1 -name 'lux_*.sql.gz' -type f -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | head -1 | cut -d' ' -f2-
}

# espacio_suficiente: aborta temprano si el disco no da para un respaldo, en vez
# de dejar un archivo truncado.
espacio_suficiente() {
    local libre_kb
    libre_kb="$(df --output=avail -k "$BACKUP_DIR" 2>/dev/null | tail -n 1 | tr -d ' ')"
    if [[ -z "$libre_kb" ]]; then
        log WARN "No se pudo medir el espacio libre de $BACKUP_DIR."
        return 0
    fi
    if (( libre_kb / 1024 < MIN_LIBRE_MB )); then
        log ERROR "Quedan $((libre_kb / 1024)) MB libres en $BACKUP_DIR y el minimo es $MIN_LIBRE_MB MB. Se cancela el respaldo."
        return 1
    fi
}

preparar_directorios() {
    if ! mkdir -p "$BACKUP_DIR/.tmp" 2>/dev/null; then
        log ERROR "No se puede crear $BACKUP_DIR. Ejecutar 'sudo backup.sh instalar-cron' para dejar los directorios con el dueno correcto."
        return 1
    fi
    chmod 700 "$BACKUP_DIR/.tmp" 2>/dev/null || true
}

# --- Respaldo -------------------------------------------------------------------

# respaldar_db <id>
# Dump comprimido con tres comprobaciones: codigo de pg_dump (pipefail), tamano
# no nulo y gzip -t (detecta truncado por disco lleno).
respaldar_db() {
    local id="$1"
    local tmp="$BACKUP_DIR/.tmp/lux_${id}.sql.gz"
    local destino="$BACKUP_DIR/lux_${id}.sql.gz"

    log INFO "Dump de '$DB_NAME' (modo $(db_modo_efectivo))..."
    if ! db_pg_dump --format=plain --clean --if-exists --no-owner --no-privileges "$DB_NAME" | gzip > "$tmp"; then
        log ERROR "pg_dump fallo. Se elimina el archivo parcial."
        rm -f "$tmp"
        return 1
    fi
    if [[ ! -s "$tmp" ]]; then
        log ERROR "El dump se genero vacio. Revisar credenciales y conectividad."
        rm -f "$tmp"
        return 1
    fi
    if ! gzip -t "$tmp" 2>/dev/null; then
        log ERROR "El dump quedo corrupto (gzip -t fallo). Se elimina."
        rm -f "$tmp"
        return 1
    fi
    mv "$tmp" "$destino"
    log INFO "Dump listo: $destino ($(du -h "$destino" | cut -f1))"
}

# respaldar_archivos <id>
# Configuracion del servidor. Las rutas ausentes se omiten (un servidor sin
# /var/spool/cron/crontabs no debe romper el respaldo). Incluye la lista de
# paquetes instalados para poder reconstruir el sistema.
respaldar_archivos() {
    local id="$1"
    local tmp="$BACKUP_DIR/.tmp/archivos_${id}.tar.gz"
    local destino="$BACKUP_DIR/archivos_${id}.tar.gz"
    local stage="$BACKUP_DIR/.tmp/stage_${id}"
    local ruta
    local -a incluir=() excluir=()

    mkdir -p "$stage"
    if command -v dpkg-query >/dev/null 2>&1; then
        dpkg-query -W -f='${binary:Package} ${Version}\n' > "$stage/paquetes.txt" 2>/dev/null || true
    fi
    if command -v podman >/dev/null 2>&1; then
        podman_stack images --format '{{.Repository}}:{{.Tag}} {{.ID}}' > "$stage/imagenes-podman.txt" 2>/dev/null || true
    fi
    hostnamectl status > "$stage/sistema.txt" 2>/dev/null || uname -a > "$stage/sistema.txt"

    for ruta in $RUTAS_ARCHIVOS; do
        if [[ -e "$ruta" ]]; then
            incluir+=("${ruta#/}")
        else
            log WARN "Se omite '$ruta': no existe en este servidor."
        fi
    done
    for ruta in $EXCLUIR_ARCHIVOS; do
        excluir+=("--exclude=${ruta#/}")
    done

    log INFO "Archivos de configuracion (${#incluir[@]} rutas)..."
    local rc=0
    # tar devuelve 1 si un archivo cambio mientras se leia: es un aviso, no un fallo.
    tar -czf "$tmp" --warning=no-file-changed "${excluir[@]}" -C / "${incluir[@]}" -C "$stage" . 2>"$BACKUP_DIR/.tmp/tar_${id}.err" || rc=$?
    if [[ "$rc" -gt 1 ]]; then
        log ERROR "tar fallo (codigo $rc): $(head -n 3 "$BACKUP_DIR/.tmp/tar_${id}.err")"
        rm -f "$tmp"
        rm -rf "$stage"
        return 1
    fi
    rm -rf "$stage" "$BACKUP_DIR/.tmp/tar_${id}.err"
    if ! gzip -t "$tmp" 2>/dev/null || [[ ! -s "$tmp" ]]; then
        log ERROR "El archivo de configuracion quedo vacio o corrupto. Se elimina."
        rm -f "$tmp"
        return 1
    fi
    mv "$tmp" "$destino"
    log INFO "Archivos listos: $destino ($(du -h "$destino" | cut -f1))"
}

# respaldar_secretos <id>
# Paquete cifrado con los secretos del stack. Sin clave configurada se omite
# con aviso: los secretos se reconstruyen desde el gestor de contrasenas del
# equipo (ver ServidorRespaldo.md). La clave NO se guarda en el servidor que
# respalda; se entrega por archivo con modo 600.
respaldar_secretos() {
    local id="$1"
    local tmp="$BACKUP_DIR/.tmp/secretos_${id}.tar.gz.gpg"
    local destino="$BACKUP_DIR/secretos_${id}.tar.gz.gpg"
    local ruta
    local -a incluir=()

    if [[ -z "$CLAVE_ARCHIVO" ]]; then
        log WARN "Sin SGRSI_BACKUP_CLAVE_ARCHIVO: los secretos NO se respaldan. Reconstruirlos desde el gestor de contrasenas."
        return 0
    fi
    if [[ ! -r "$CLAVE_ARCHIVO" ]] || (( (8#$(stat -c '%a' "$CLAVE_ARCHIVO") & 8#077) != 0 )); then
        log ERROR "La clave '$CLAVE_ARCHIVO' no es legible o tiene un modo distinto de 600."
        return 1
    fi
    requerir_comando gpg gnupg || return 1

    for ruta in $RUTAS_SECRETOS; do
        [[ -e "$ruta" ]] && incluir+=("${ruta#/}")
    done
    if [[ "${#incluir[@]}" -eq 0 ]]; then
        log WARN "No hay secretos en $RUTAS_SECRETOS. Se omite el paquete cifrado."
        return 0
    fi

    if ! tar -czf - -C / "${incluir[@]}" 2>/dev/null \
        | gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
              --passphrase-file "$CLAVE_ARCHIVO" -o "$tmp"; then
        log ERROR "No se pudo generar el paquete cifrado de secretos."
        rm -f "$tmp"
        return 1
    fi
    chmod 600 "$tmp"
    mv "$tmp" "$destino"
    log INFO "Secretos cifrados: $destino"
}

# escribir_sumas <id>: SHA-256 de todo lo generado en la corrida. El archivo
# .sha256 se escribe al final y marca la corrida como completa.
escribir_sumas() {
    local id="$1"
    local -a archivos=()
    local f
    for f in "$BACKUP_DIR/lux_${id}.sql.gz" "$BACKUP_DIR/archivos_${id}.tar.gz" "$BACKUP_DIR/secretos_${id}.tar.gz.gpg"; do
        [[ -f "$f" ]] && archivos+=("$(basename "$f")")
    done
    if [[ "${#archivos[@]}" -eq 0 ]]; then
        log ERROR "La corrida $id no genero ningun archivo."
        return 1
    fi
    (cd "$BACKUP_DIR" && sha256sum "${archivos[@]}" > ".tmp/lux_${id}.sha256" && mv ".tmp/lux_${id}.sha256" "lux_${id}.sha256")
    log INFO "Sumas de control: $BACKUP_DIR/lux_${id}.sha256 (${#archivos[@]} archivo(s))"
}

# respaldar
# Corrida completa. Cada parte es independiente: si falla una, las otras se
# intentan igual (un servidor con el dump bien y la configuracion mal igual
# merece su dump), y el resultado final es error si fallo cualquiera.
respaldar() {
    adquirir_lock backup || exit $?
    requerir_herramienta tar coreutils || exit 1
    preparar_directorios || exit 1
    espacio_suficiente || exit 1

    local id fallos=0
    id="$(date '+%Y%m%d_%H%M%S')"
    log INFO "Corrida de respaldo $id iniciada."

    respaldar_db "$id" || fallos=$((fallos + 1))
    respaldar_archivos "$id" || fallos=$((fallos + 1))
    respaldar_secretos "$id" || fallos=$((fallos + 1))

    escribir_sumas "$id" || fallos=$((fallos + 1))

    if [[ "$fallos" -gt 0 ]]; then
        log ERROR "La corrida $id termino con $fallos parte(s) fallida(s). No se aplica la rotacion."
        exit 1
    fi
    log INFO "Corrida $id completa."
}

# limpiar_antiguos: rotacion por fecha en el nombre (ver lib/rotacion.sh).
# Se ejecuta despues de un respaldo exitoso, nunca antes, para no quedarse sin
# copias si el del dia falla.
limpiar_antiguos() {
    local hoy borrar id eliminados=0
    hoy="$(date '+%Y%m%d')"
    borrar="$(ids_existentes | rotacion_ids_a_borrar "$hoy" "$RETENCION_DIARIOS" "$RETENCION_SEMANAS")"
    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        rm -f -- "$BACKUP_DIR/lux_${id}."* "$BACKUP_DIR/archivos_${id}."* "$BACKUP_DIR/secretos_${id}."*
        eliminados=$((eliminados + 1))
    done <<<"$borrar"

    if [[ "$eliminados" -gt 0 ]]; then
        log INFO "Rotacion: eliminadas $eliminados corrida(s) fuera de la politica ($RETENCION_DIARIOS dias + $RETENCION_SEMANAS semanas)."
    fi
}

# --- Comprobacion y restauracion ----------------------------------------------

# comprobar [id]
# Verifica las sumas SHA-256 de una corrida (la ultima por defecto) o de todas
# con "todas". Detecta corrupcion en disco o alteracion posterior.
comprobar() {
    local objetivo="${1:-}"
    local -a sumas=()
    local s fallos=0

    if [[ "$objetivo" == "todas" ]]; then
        mapfile -t sumas < <(find "$BACKUP_DIR" -maxdepth 1 -name 'lux_*.sha256' -type f | sort)
    elif [[ -n "$objetivo" ]]; then
        sumas=("$BACKUP_DIR/lux_${objetivo}.sha256")
    else
        mapfile -t sumas < <(find "$BACKUP_DIR" -maxdepth 1 -name 'lux_*.sha256' -type f | sort | tail -n 1)
    fi
    if [[ "${#sumas[@]}" -eq 0 ]]; then
        log ERROR "No hay archivos de sumas de control en $BACKUP_DIR."
        return 1
    fi
    for s in "${sumas[@]}"; do
        if [[ ! -f "$s" ]]; then
            log ERROR "No existe $s"
            fallos=$((fallos + 1))
            continue
        fi
        if (cd "$BACKUP_DIR" && sha256sum --check --quiet "$(basename "$s")" 2>&1); then
            log INFO "Sumas correctas: $(basename "$s")"
        else
            log ERROR "Las sumas NO coinciden: $(basename "$s")"
            fallos=$((fallos + 1))
        fi
    done
    [[ "$fallos" -eq 0 ]]
}

# estado
# Para monitoreo: error si no hay respaldo, o si el ultimo es mas viejo que
# MAX_EDAD_HORAS.
estado() {
    local ultimo
    ultimo="$(find "$BACKUP_DIR" -maxdepth 1 -name 'lux_*.sha256' -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
    if [[ -z "$ultimo" ]]; then
        log ERROR "No hay ninguna corrida completa en $BACKUP_DIR."
        return 1
    fi
    local edad_h
    edad_h=$(( ($(date +%s) - $(stat -c %Y "$ultimo")) / 3600 ))
    echo "Ultima corrida completa: $(basename "$ultimo") (hace ${edad_h} h)"
    echo "Corridas almacenadas:   $(ids_existentes | wc -l)"
    if (( edad_h > MAX_EDAD_HORAS )); then
        log ERROR "El ultimo respaldo tiene ${edad_h} h y el maximo tolerado es ${MAX_EDAD_HORAS} h."
        return 1
    fi
}

# restaurar <archivo.sql.gz>
# Restauracion manual, nunca automatica. Requiere confirmacion explicita
# porque sobreescribe la base de datos activa.
restaurar() {
    local archivo="${1:-}"
    validar_no_vacio "$archivo" "archivo" || return 1

    if [[ ! -f "$archivo" ]]; then
        log ERROR "El archivo '$archivo' no existe."
        return 1
    fi

    if ! gzip -t "$archivo" 2>/dev/null; then
        log ERROR "'$archivo' no es un gzip valido o esta corrupto. No se restaura."
        return 1
    fi

    # Si hay sumas de control junto al archivo, se comprueban antes de tocar la base.
    local base_nombre sumas
    base_nombre="$(basename "$archivo")"
    sumas="$(dirname "$archivo")/${base_nombre%.sql.gz}.sha256"
    if [[ -f "$sumas" ]]; then
        if ! (cd "$(dirname "$archivo")" && grep -F "  $base_nombre" "$(basename "$sumas")" | sha256sum --check --quiet - 2>/dev/null); then
            log ERROR "La suma SHA-256 de '$base_nombre' no coincide con $sumas. No se restaura."
            return 1
        fi
        log INFO "Suma SHA-256 verificada antes de restaurar."
    fi

    confirmar "Restaurar '$archivo' sobre la base '$DB_NAME', sobreescribiendo su contenido actual" || {
        log INFO "Restauracion cancelada."
        return 0
    }

    log WARN "Restaurando $archivo sobre '$DB_NAME'..."

    # ON_ERROR_STOP es lo que hace que un error de SQL a mitad del volcado
    # aborte la restauracion. Sin esa opcion psql informa el error, sigue con
    # la sentencia siguiente y termina con codigo 0: una restauracion a medias
    # se reportaria como exitosa.
    if ! gunzip -c "$archivo" | db_psql "$DB_USER" "$DB_NAME"; then
        log ERROR "La restauracion fallo. La base '$DB_NAME' puede haber quedado a medio restaurar."
        return 1
    fi

    log INFO "Restauracion completada."
}

# restaurar_archivos <archivos_*.tar.gz[.gpg]> [destino]
# Extrae la configuracion en un directorio de PRUEBA, nunca sobre "/". El
# administrador copia luego lo que necesite. Si el paquete esta cifrado
# (secretos_*), usa la clave de SGRSI_BACKUP_CLAVE_ARCHIVO.
restaurar_archivos() {
    local archivo="${1:-}"
    validar_no_vacio "$archivo" "archivo" || return 1
    [[ -f "$archivo" ]] || { log ERROR "El archivo '$archivo' no existe."; return 1; }

    local id destino
    id="$(basename "$archivo" | sed -nE "s/.*_(${PATRON_ID})\..*/\1/p")"
    destino="${2:-$RESTAURACION_DIR/$id}"
    if [[ "$destino" == "/" ]]; then
        log ERROR "No se restaura sobre '/'. Indicar un directorio de prueba."
        return 1
    fi
    mkdir -p "$destino"

    if [[ "$archivo" == *.gpg ]]; then
        [[ -n "$CLAVE_ARCHIVO" ]] || { log ERROR "Falta SGRSI_BACKUP_CLAVE_ARCHIVO para descifrar."; return 1; }
        gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$CLAVE_ARCHIVO" --decrypt "$archivo" \
            | tar -xzf - -C "$destino"
    else
        tar -xzf "$archivo" -C "$destino"
    fi
    log INFO "Extraido en $destino ($(find "$destino" -type f | wc -l) archivos)."
}

# verificar [archivo]
# Restaura el dump contra una base de prueba descartable y comprueba (1) que
# restaura sin errores, (2) que hay tablas, (3) que las tablas obligatorias
# existen y tienen filas, (4) que no esta todo vacio. Es la unica comprobacion
# que demuestra que el respaldo sirve: ni el tamano ni el codigo de salida de
# pg_dump lo garantizan.
verificar() {
    local archivo="${1:-}"

    if [[ -z "$archivo" ]]; then
        archivo="$(ultimo_respaldo)"
        if [[ -z "$archivo" ]]; then
            log ERROR "No hay respaldos en $BACKUP_DIR para verificar."
            return 1
        fi
        log INFO "Verificando el respaldo mas reciente: $archivo"
    fi

    if [[ ! -f "$archivo" ]]; then
        log ERROR "El archivo '$archivo' no existe."
        return 1
    fi

    local base_prueba="lux_verificacion_$$"
    local admin
    admin="$(db_usuario_admin)" || return 1

    log INFO "Creando base de verificacion '$base_prueba'..."
    if ! db_psql "$admin" postgres -c "CREATE DATABASE $base_prueba;" >/dev/null; then
        log ERROR "No se pudo crear la base de verificacion (el usuario '$admin' necesita CREATEDB)."
        return 1
    fi

    local resultado=0
    if gunzip -c "$archivo" | db_psql "$admin" "$base_prueba" >/dev/null 2>&1; then
        resultado=$(verificar_contenido "$admin" "$base_prueba") || resultado=1
    else
        log ERROR "El respaldo no se pudo restaurar. NO sirve para recuperacion."
        resultado=1
    fi

    db_psql "$admin" postgres -c "DROP DATABASE IF EXISTS $base_prueba;" >/dev/null 2>&1 || \
        log WARN "No se pudo eliminar la base de verificacion '$base_prueba'. Eliminarla a mano."

    [[ "$resultado" == "0" ]]
}

# verificar_contenido <admin> <base>: imprime 0 (ok) o 1 (falla) por stdout;
# los mensajes van por stderr (log).
verificar_contenido() {
    local admin="$1" base="$2"
    local tablas total tabla filas
    tablas="$(db_psql "$admin" "$base" -t -A -c \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")"

    if [[ "${tablas:-0}" -eq 0 ]]; then
        log ERROR "El respaldo restauro sin errores pero no contiene ninguna tabla."
        echo 1
        return 0
    fi

    # Filas por tabla (conteo exacto). Se muestran como evidencia en el log.
    total=0
    local salida_conteo
    salida_conteo="$(db_psql "$admin" "$base" -t -A -F '|' -c \
        "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
           FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1;")"
    while IFS='|' read -r tabla filas; do
        [[ -z "$tabla" ]] && continue
        log INFO "  tabla $tabla: $filas fila(s)"
        total=$((total + filas))
    done <<<"$salida_conteo"

    local fallo=0
    for tabla in $TABLAS_OBLIGATORIAS; do
        filas="$(awk -F'|' -v t="$tabla" '$1 == t { print $2 }' <<<"$salida_conteo")"
        if [[ -z "$filas" ]]; then
            log ERROR "Falta la tabla obligatoria '$tabla' en el respaldo."
            fallo=1
        elif [[ "$filas" -eq 0 ]]; then
            log ERROR "La tabla obligatoria '$tabla' esta vacia en el respaldo."
            fallo=1
        fi
    done

    if [[ "$total" -eq 0 ]]; then
        log ERROR "El respaldo tiene $tablas tabla(s) pero ninguna tiene filas: es un dump vacio."
        fallo=1
    fi

    if [[ "$fallo" -eq 0 ]]; then
        log INFO "Respaldo verificado: restauro sin errores y contiene $tablas tabla(s) con $total fila(s)."
    fi
    echo "$fallo"
}

listar() {
    log INFO "Respaldos disponibles en $BACKUP_DIR:"
    # shellcheck disable=SC2012  # nombres generados por este script, sin espacios
    ls -lh "$BACKUP_DIR"/lux_*.sql.gz 2>/dev/null || echo "  (ninguno todavia)"
}

# instalar_cron
# Copia el fragmento versionado a /etc/cron.d y deja los directorios con el
# dueno correcto. Sin esto el cron (que corre como el usuario de servicio)
# no puede escribir en /var/log/sgrsi ni en /var/backups/sgrsi y falla sin dejar
# registro (R2 de la auditoria de E2).
instalar_cron() {
    requerir_root

    if [[ ! -f "$CRON_ORIGEN" ]]; then
        log ERROR "No se encontro $CRON_ORIGEN"
        return 1
    fi

    # cron descarta en silencio las lineas cuyo usuario no existe: se avisa
    # aca, porque si no el respaldo simplemente no corre y nadie se entera
    # hasta que hace falta restaurar.
    local usuario_cron
    usuario_cron="$(awk '$1 !~ /^#/ && NF >= 7 { print $6; exit }' "$CRON_ORIGEN")"
    if [[ -n "$usuario_cron" ]] && ! existe_usuario "$usuario_cron"; then
        log WARN "La rutina corre como '$usuario_cron', cuenta que no existe en este sistema."
        log WARN "Crearla con: admin.sh usuarios alta $usuario_cron 'Cuenta de servicio SGRSI'"
    fi

    if existe_usuario "${usuario_cron:-$USUARIO_SERVICIO}"; then
        local dueno="${usuario_cron:-$USUARIO_SERVICIO}"
        ejecutar install -d -o "$dueno" -g "$dueno" -m 750 "$BACKUP_DIR" "$BACKUP_DIR/.tmp"
        ejecutar install -d -o "$dueno" -g "$dueno" -m 750 "$SGRSI_LOG_DIR"
    else
        ejecutar install -d -m 750 "$BACKUP_DIR" "$BACKUP_DIR/.tmp" "$SGRSI_LOG_DIR"
    fi

    ejecutar install -o root -g root -m 644 "$CRON_ORIGEN" "$CRON_DESTINO"
    log INFO "Rutina instalada en $CRON_DESTINO"
    log INFO "Contenido:"
    grep -v '^#' "$CRON_ORIGEN" | grep -v '^$' | sed 's/^/  /' >&2

    log INFO "Verificar con: run-parts --test /etc/cron.d 2>/dev/null; systemctl status cron"
}

ayuda() {
    cat <<FIN_AYUDA
Uso: backup.sh [--dry-run] <accion> [argumentos]

Acciones:
  respaldar              Corrida completa: dump de la base + configuracion + secretos
                         (si hay clave) + sumas SHA-256; luego aplica la rotacion
  comprobar [id|todas]   Verifica las sumas SHA-256 de la ultima corrida (o de una / todas)
  restaurar <archivo>    Restaura un dump sobre la base activa (pide confirmacion)
  restaurar-archivos <archivo> [destino]
                         Extrae la configuracion (o los secretos) en un directorio de prueba
  verificar [archivo]    Restaura contra una base descartable y cuenta tablas y filas
  estado                 Edad de la ultima corrida (error si supera ${MAX_EDAD_HORAS} h)
  listar                 Lista los dumps existentes
  instalar-cron          Instala la rutina en /etc/cron.d/sgrsi-backup y crea los directorios

Politica: ${RETENCION_DIARIOS} dias de respaldos diarios + ${RETENCION_SEMANAS} semanas de semanales.
Variables: SGRSI_CONF, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD(_FILE),
SGRSI_DB_MODO, SGRSI_BACKUP_DIR, SGRSI_BACKUP_DIARIOS, SGRSI_BACKUP_SEMANAS,
SGRSI_BACKUP_RUTAS, SGRSI_BACKUP_CLAVE_ARCHIVO, SGRSI_VERIFICAR_TABLAS_OBLIGATORIAS.
FIN_AYUDA
}

main() {
    if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
        export SGRSI_DRY_RUN=1
        shift
    fi
    cargar_config || exit $?
    instalar_trap_errores

    local accion="${1:-}"
    shift || true

    case "$accion" in
        respaldar)           respaldar && limpiar_antiguos ;;
        comprobar)           comprobar "$@" ;;
        restaurar)           restaurar "$@" ;;
        restaurar-archivos)  restaurar_archivos "$@" ;;
        verificar)           verificar "$@" ;;
        estado)              estado ;;
        listar)              listar ;;
        instalar-cron)       instalar_cron ;;
        ""|ayuda|-h|--help)  ayuda ;;
        *)
            log ERROR "Accion desconocida: '$accion'"
            ayuda
            exit 1
            ;;
    esac
}

# Solo se ejecuta si el archivo se invoca; si se hace `source`, las funciones
# quedan disponibles (lo usa el modulo `respaldo` y las pruebas).
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
