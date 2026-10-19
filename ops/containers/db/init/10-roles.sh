#!/bin/sh
# Inicializacion de PostgreSQL. La imagen oficial la ejecuta UNA sola vez, al
# crear el directorio de datos vacio. Crea el rol de la aplicacion SIN
# privilegios elevados y su base; la API no usa el superusuario.
#
# La clave llega por el entorno del contenedor (\getenv), nunca por argumentos,
# y los identificadores se escapan con format(%I / %L).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v app_user="$LUX_DB_USER" -v app_db="$LUX_DB_NAME" <<'SQL'
\getenv app_pass LUX_DB_PASSWORD
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_user', :'app_pass') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app_db') \gexec
SQL
