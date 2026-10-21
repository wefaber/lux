#!/usr/bin/env bash
# db.sh: Modulo de base de datos del servidor SGRSI (PostgreSQL). Estado, roles,
# bases y conexiones. Funciona contra PostgreSQL dentro del contenedor del stack
# (modo "contenedor", el de produccion) o contra una instancia instalada en el
# host (modo "host"). Tambien exporta los helpers de conexion que usa backup.sh,
# para que haya un unico lugar que sabe como llegar a la base.
#
# Reglas de seguridad del modulo:
#   - Las contrasenas nunca viajan en argumentos de linea de comandos: se leen
#     de variable de entorno o archivo (leer_secreto) y se pasan a psql por
#     entorno (\getenv), no por -v.
#   - Los identificadores se validan (validar_nombre) y se escapan en el SQL con
#     format(%I / %L), no por interpolacion de texto.
#
# Issue: wefaber/eternum#109
# Documentado en: 05-ADMIN-SO/E3/Script-Final.md (modulo db)

# Requiere que comun.sh ya este cargado por quien invoca este modulo.

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-lux}"
DB_USER="${DB_USER:-lux_app}"
SGRSI_DB_MODO="${SGRSI_DB_MODO:-auto}"                 # auto | contenedor | host
SGRSI_DB_CONTENEDOR="${SGRSI_DB_CONTENEDOR:-lux-db}"
SGRSI_DB_ADMIN_USER="${SGRSI_DB_ADMIN_USER:-}"          # vacio: postgres en modo contenedor, DB_USER en modo host

db_descripcion() { echo "PostgreSQL: estado, roles, bases y conexiones"; }

db_ayuda() {
    cat <<'FIN_AYUDA'
Uso: admin.sh db <subcomando> [argumentos]

Subcomandos:
  estado                         Servicio o contenedor, aceptacion de conexiones, version
  listar                         Bases de datos y roles
  tamano                         Tamano de cada base
  conexiones                     Conexiones activas por base
  crear-rol <rol>                Crea un rol de aplicacion sin privilegios elevados
                                 (clave en DB_ROLE_PASSWORD o DB_ROLE_PASSWORD_FILE)
  crear-base <base> <duenio>     Crea una base con el rol indicado como duenio y
                                 le quita el acceso a PUBLIC
  ayuda                          Esta ayuda

Variables: SGRSI_DB_MODO (auto|contenedor|host), SGRSI_DB_CONTENEDOR, DB_HOST,
DB_PORT, DB_NAME, DB_USER, SGRSI_DB_ADMIN_USER. Contrasenas: DB_PASSWORD o
DB_PASSWORD_FILE (modo 600); si faltan se usa ~/.pgpass.
FIN_AYUDA
}

# db_modo_efectivo: resuelve "auto". Si hay un contenedor del stack corriendo
# se usa; si no, se asume PostgreSQL en el host.
db_modo_efectivo() {
    case "$SGRSI_DB_MODO" in
        contenedor|host) echo "$SGRSI_DB_MODO"; return 0 ;;
        auto) ;;
        *) log ERROR "SGRSI_DB_MODO invalido: '$SGRSI_DB_MODO' (auto, contenedor o host)."; return "$SGRSI_EX_CONFIG" ;;
    esac
    if command -v podman >/dev/null 2>&1 \
        && podman_stack ps --filter "name=^${SGRSI_DB_CONTENEDOR}\$" --filter status=running --format '{{.Names}}' 2>/dev/null \
            | grep -qx "$SGRSI_DB_CONTENEDOR"; then
        echo contenedor
    else
        echo host
    fi
}

# db_exportar_password
# Si hay secreto configurado lo deja en PGPASSWORD para el proceso actual. Si no
# hay ninguno no es un error: libpq usa ~/.pgpass (documentado en el manual).
db_exportar_password() {
    local clave
    [[ -n "${DB_PASSWORD:-}" || -n "${DB_PASSWORD_FILE:-}" ]] || return 0
    clave="$(leer_secreto DB_PASSWORD)" || return 1
    export PGPASSWORD="$clave"
}

# db_psql <usuario> <base> [argumentos de psql...]
# psql contra la base, segun el modo. SQL por stdin o con -c/-f.
db_psql() {
    local usuario="$1" base="$2"
    shift 2
    local modo
    modo="$(db_modo_efectivo)" || return $?
    if [[ "$modo" == "contenedor" ]]; then
        podman_stack exec -i -e SGRSI_ROL_CLAVE "$SGRSI_DB_CONTENEDOR" \
            psql -X -q -v ON_ERROR_STOP=1 -U "$usuario" -d "$base" "$@"
    else
        requerir_comando psql postgresql-client || return 1
        db_exportar_password
        psql -X -q -v ON_ERROR_STOP=1 --no-password \
            --host="$DB_HOST" --port="$DB_PORT" --username="$usuario" --dbname="$base" "$@"
    fi
}

# db_usuario_admin: quien puede crear bases y roles. En el contenedor es el
# superusuario "postgres" (socket local, sin clave); en el host, el que se
# configure en SGRSI_DB_ADMIN_USER o, si no, el propio DB_USER.
db_usuario_admin() {
    if [[ -n "$SGRSI_DB_ADMIN_USER" ]]; then
        echo "$SGRSI_DB_ADMIN_USER"
    elif [[ "$(db_modo_efectivo)" == "contenedor" ]]; then
        echo postgres
    else
        echo "$DB_USER"
    fi
}

# db_psql_admin <base> [argumentos]: igual, con el usuario administrador.
db_psql_admin() {
    local base="$1"
    shift
    db_psql "$(db_usuario_admin)" "$base" "$@"
}

# db_pg_dump [argumentos]: pg_dump como el usuario de la aplicacion.
db_pg_dump() {
    local modo
    modo="$(db_modo_efectivo)" || return $?
    if [[ "$modo" == "contenedor" ]]; then
        podman_stack exec -i "$SGRSI_DB_CONTENEDOR" pg_dump -U "$DB_USER" "$@"
    else
        requerir_comando pg_dump postgresql-client || return 1
        db_exportar_password
        pg_dump --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --no-password "$@"
    fi
}

db_estado() {
    local modo
    modo="$(db_modo_efectivo)" || return $?
    echo "Modo:        $modo"

    if [[ "$modo" == "contenedor" ]]; then
        local salud
        salud="$(podman_stack inspect --format '{{.State.Health.Status}}' "$SGRSI_DB_CONTENEDOR" 2>/dev/null || echo desconocida)"
        echo "Contenedor:  $SGRSI_DB_CONTENEDOR (salud: $salud)"
    else
        local activo
        activo="$(systemctl is-active postgresql 2>/dev/null || true)"
        echo "Servicio:    postgresql (${activo:-desconocido})"
    fi

    local version
    if version="$(db_psql_admin postgres -t -A -c 'SHOW server_version;' 2>/dev/null)"; then
        echo "Conexiones:  aceptadas"
        echo "Version:     $version"
    else
        echo "Conexiones:  NO responde"
        log ERROR "PostgreSQL no acepta conexiones. Ver: admin.sh logs db"
        return 1
    fi
}

db_listar() {
    echo "Bases de datos:"
    db_psql_admin postgres -t -A -F ' | ' -c \
        "SELECT datname, pg_get_userbyid(datdba) AS duenio FROM pg_database WHERE NOT datistemplate ORDER BY 1;" \
        | sed 's/^/  /'
    echo "Roles:"
    db_psql_admin postgres -t -A -F ' | ' -c \
        "SELECT rolname, CASE WHEN rolsuper THEN 'superusuario' ELSE 'comun' END, CASE WHEN rolcanlogin THEN 'login' ELSE 'sin login' END FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY 1;" \
        | sed 's/^/  /'
}

db_tamano() {
    db_psql_admin postgres -t -A -F ' | ' -c \
        "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE NOT datistemplate ORDER BY pg_database_size(datname) DESC;" \
        | sed 's/^/  /'
}

db_conexiones() {
    db_psql_admin postgres -t -A -F ' | ' -c \
        "SELECT coalesce(datname, '(sin base)'), count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' GROUP BY 1 ORDER BY 2 DESC;" \
        | sed 's/^/  /'
}

# db_crear_rol <rol>
# Rol de aplicacion: LOGIN, sin superusuario, sin CREATEDB, sin CREATEROLE.
# Idempotente: si existe, actualiza la clave. La clave se lee de
# DB_ROLE_PASSWORD(_FILE) y llega a psql por entorno (\getenv).
db_crear_rol() {
    local rol="${1:-}"
    validar_no_vacio "$rol" "rol" || return 1
    validar_nombre "$rol" "rol" || return 1

    local clave
    clave="$(leer_secreto DB_ROLE_PASSWORD)" || return "$SGRSI_EX_CONFIG"

    if es_dry_run; then
        log INFO "[dry-run] CREATE ROLE '$rol' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE (clave tomada del entorno, no se muestra)"
        return 0
    fi

    SGRSI_ROL_CLAVE="$clave" db_psql_admin postgres -v "rol=$rol" <<'SQL'
\getenv clave SGRSI_ROL_CLAVE
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'rol', :'clave')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'rol') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'rol', :'clave')
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'rol') \gexec
SQL
    log INFO "Rol '$rol' listo (LOGIN, sin privilegios elevados)."
}

# db_crear_base <base> <duenio>
db_crear_base() {
    local base="${1:-}" duenio="${2:-}"
    validar_no_vacio "$base" "base" || return 1
    validar_no_vacio "$duenio" "duenio" || return 1
    validar_nombre "$base" "base" || return 1
    validar_nombre "$duenio" "duenio" || return 1

    if es_dry_run; then
        log INFO "[dry-run] CREATE DATABASE '$base' OWNER '$duenio'; REVOKE ALL ON DATABASE '$base' FROM PUBLIC"
        return 0
    fi

    db_psql_admin postgres -v "base=$base" -v "duenio=$duenio" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'base', :'duenio')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'base') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'base') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'base', :'duenio') \gexec
SQL
    log INFO "Base '$base' lista (duenio '$duenio', sin acceso para PUBLIC)."
}

db_main() {
    local subcomando="${1:-}"
    shift || true

    case "$subcomando" in
        estado)       db_estado ;;
        listar)       db_listar ;;
        tamano)       db_tamano ;;
        conexiones)   db_conexiones ;;
        crear-rol)    db_crear_rol "$@" ;;
        crear-base)   db_crear_base "$@" ;;
        ""|ayuda|-h|--help) db_ayuda ;;
        *)
            log ERROR "Subcomando desconocido: '$subcomando'"
            db_ayuda
            return 1
            ;;
    esac
}
