#!/usr/bin/env bash
# shellcheck disable=SC1090,SC1091
# lux-prod.sh — deploy blue/green de produccion (lux.eternum.lat) con API Bun + Postgres.
#
#   ./lux-prod.sh                     despliega main en el slot idle (rama default: main)
#   ./lux-prod.sh --branch <rama>     despliega esa rama (override de main)
#   ./lux-prod.sh --no-switch         deploya y verifica el slot idle en su puerto
#                                     local, SIN tocar nginx ni el symlink current
#   ./lux-prod.sh --status            slot vivo, salud de los dos slots, upstream y
#                                     sha publicado. Nunca falla.
#   ./lux-prod.sh --rollback          vuelve al slot anterior (switch, sin build)
#
# Diferencias con lux-dev.sh (preview):
#   * No existe el modo mocks. Si la rama no trae api/, el deploy muere: produccion
#     nunca publica MSW. El build va siempre con VITE_ENABLE_MOCKS=false.
#   * Sin banner de preview (el banner es de dev: dice "datos simulados").
#   * Migraciones contra la base lux_prod y, si el repo lo trae, primer admin via
#     `bun run db:create-admin` con lux-prod-admin.env. Nunca db:seed.
#   * El chequeo de API no loguea: en produccion no existe el usuario de prueba.
#     Mira /ready (200 + "ok":true) y POST /graphql { __typename } = 200.
#   * El primer switch reemplaza el vhost estatico de lux.eternum.lat por el vhost
#     blue/green, y guarda el viejo en backups/nginx/. Si ese primer switch falla,
#     el script restaura el vhost viejo y el sitio sigue como estaba.
#
# Lo corre .github/workflows/deploy.yml en cada push a main. Regla: el slot idle se
# actualiza, se levanta y se verifica ANTES de mover el trafico; si la verificacion
# publica falla, el trafico vuelve solo al slot anterior. El slot viejo nunca se
# apaga: volver atras es mover el symlink y el upstream, nunca re-buildear.
set -euo pipefail

BASE=/srv/lux-prod
DOCROOT=/var/www/lux-prod.eternum.lat
STATIC_DOCROOT=/var/www/lux.eternum.lat
REPO_URL="${LUX_REPO_URL:-https://github.com/wefaber/lux.git}"
UPSTREAM=/etc/nginx/conf.d/lux-prod-upstream.conf
# El vhost de prod es un archivo del deploy, no de /etc/nginx: sites-enabled/
# lux.eternum.lat es un symlink a este path (dev.eternum.lat, en cambio, vive en
# sites-available).
VHOST=/home/hermes/deploy/nginx/lux.eternum.lat
VHOST_BAK_DIR=/home/hermes/deploy/nginx/backups
# Insumos del deploy: el script vive EN ESTE REPO (deploy/), no en el VPS. Los
# .env son secretos y siguen fuera del repo (LUX_ENV_DIR permite moverlos).
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_DIR=${LUX_ENV_DIR:-/home/hermes/deploy/env}
ENV_DB=$ENV_DIR/lux-prod.env
ENV_API=$ENV_DIR/lux-prod-api.env
ENV_ADMIN=$ENV_DIR/lux-prod-admin.env
SITE=https://lux.eternum.lat
ORIGIN_IP=167.114.2.210
BRANCH=main
NO_SWITCH=0
declare -A PORT=([blue]=4211 [green]=4212)

say()  { printf '\n== %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }

# Sin symlink current (primer deploy de prod) no hay slot vivo todavia.
current_slot() {
  if [ -L "$DOCROOT/current" ]; then basename "$(readlink -f "$DOCROOT/current")"; fi
}
other_slot() { if [ "$1" = blue ]; then echo green; else echo blue; fi; }

api_ready() { # $1=puerto  -> 200 y cuerpo con "ok":true
  local body
  for _ in $(seq 1 30); do
    body=$(curl -s -m 3 "http://127.0.0.1:$1/ready" || true)
    printf '%s' "$body" | grep -q '"ok":true' && return 0
    sleep 1
  done
  return 1
}

# Produccion no tiene usuario de prueba: el smoke test es una query trivial.
api_graphql_ok() { # $1=base-url
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST "$1/graphql" \
    -H 'content-type: application/json' --data '{"query":"{ __typename }"}' || true)
  printf 'POST %s/graphql -> %s\n' "$1" "${code:-sin respuesta}"
  [ "$code" = "200" ]
}

# El vhost blue/green es el que tiene el docroot del slot. Si todavia apunta al
# build estatico, este es el primer switch: se respalda el viejo antes de pisarlo.
vhost_is_bluegreen() { grep -q "root $DOCROOT/current;" "$VHOST" 2>/dev/null; }

# Imprime el vhost blue/green en stdout. Separado de write_vhost para poder
# validarlo con --print-vhost sin tocar /etc/nginx.
emit_vhost() {
  cat <<VHOSTEOF
# lux.eternum.lat — produccion de Lux (blue/green con API Bun + Postgres).
# Calcado del vhost de dev.eternum.lat. El docroot activo es el symlink
# current -> blue|green y el upstream de /graphql, /health, /ready y /api/ vive en
# $UPSTREAM: los dos los mueve ~/deploy/lux-prod.sh antes del reload, asi el
# rollback es un switch, no un build. Sin /db (el panel es solo de dev).

server {
    listen 80;
    listen [::]:80;
    server_name lux.eternum.lat;
    return 301 https://\$host\$request_uri;
}

server {
    listen $ORIGIN_IP:443 ssl;
    listen [2607:5300:205:200::716d]:443 ssl;
    server_name lux.eternum.lat;
    include /etc/nginx/snippets/security-headers.conf;
    include /etc/nginx/snippets/wellknown.conf;

    ssl_certificate /etc/letsencrypt/live/lux.eternum.lat/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/lux.eternum.lat/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    root $DOCROOT/current;
    index index.html;

    # API GraphQL real contra Postgres. lux_prod_api apunta al slot vivo
    # (blue 4211 / green 4212).
    location = /graphql {
        proxy_pass http://lux_prod_api/graphql;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /health { proxy_pass http://lux_prod_api/health; }
    location = /ready  { proxy_pass http://lux_prod_api/ready; }

    # Prefijo /api/ hacia la misma API (health/ready y lo que agregue el backend).
    location /api/ {
        proxy_pass http://lux_prod_api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Assets con hash en el nombre: cambian en cada build, se pueden cachear.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files \$uri =404;
    }

    # Lo que NO se puede cachear nunca: con Cloudflare guardando el index.html o
    # el BUILD_INFO viejo, el deploy queda invisible detras de la copia anterior.
    location = /index.html {
        add_header Cache-Control "no-store" always;
    }
    location = /mockServiceWorker.js {
        add_header Cache-Control "no-store" always;
    }
    location = /BUILD_INFO {
        add_header Cache-Control "no-store" always;
    }

    # SPA con fallback: las rutas las resuelve React Router.
    location / {
        add_header Cache-Control "no-store" always;
        try_files \$uri \$uri/ /index.html;
    }

    add_header X-Frame-Options DENY always;
    add_header Strict-Transport-Security "max-age=63072000" always;
}
VHOSTEOF
}

# Respalda el vhost actual y lo reemplaza por el blue/green. El respaldo es lo que
# usa restore_static_vhost si el primer switch falla.
write_vhost() {
  local tmp
  mkdir -p "$VHOST_BAK_DIR"
  cp -a "$VHOST" "$VHOST_BAK_DIR/lux.eternum.lat.static-$(date -u +%Y%m%dT%H%M%SZ).conf"
  # conservar solo los 3 respaldos mas nuevos de esta familia
  ls -1t "$VHOST_BAK_DIR"/lux.eternum.lat.static-*.conf 2>/dev/null | tail -n +4 | xargs -r rm -f
  tmp=$(mktemp)
  emit_vhost > "$tmp"
  cp "$tmp" "$VHOST"
  chmod 664 "$VHOST"
  rm -f "$tmp"
}

switch_traffic() { # $1=slot
  local slot=$1 tmp
  tmp=$(mktemp)
  printf '# Upstream de la API de produccion (lux.eternum.lat). Lo reescribe\n# ~/deploy/lux-prod.sh cuando cambia de slot; blue = 4211, green = 4212.\nupstream lux_prod_api {\n    server 127.0.0.1:%s;\n    keepalive 16;\n}\n' "${PORT[$slot]}" > "$tmp"
  sudo cp "$tmp" "$UPSTREAM"
  rm -f "$tmp"

  if ! vhost_is_bluegreen; then
    say "primer switch: reemplazo el vhost estatico de lux.eternum.lat"
    write_vhost
    echo "vhost viejo respaldado en $VHOST_BAK_DIR/"
  fi

  sudo nginx -t || die "nginx -t fallo: no se movio el trafico"
  # symlink atomico: se arma al lado y se mueve encima
  ln -sfn "$DOCROOT/$slot" "$DOCROOT/.current.swap"
  mv -T "$DOCROOT/.current.swap" "$DOCROOT/current"
  sudo systemctl reload nginx
}

# Restaura el sitio como estaba antes del primer switch: vhost estatico + trafico
# al docroot viejo. Solo aplica si el vhost viejo estaba en uso.
restore_static_vhost() {
  local bak
  bak=$(ls -1t "$VHOST_BAK_DIR"/lux.eternum.lat.static-*.conf 2>/dev/null | head -1 || true)
  [ -n "$bak" ] || { warn "no hay vhost viejo en $VHOST_BAK_DIR: no puedo restaurarlo"; return 1; }
  cp "$bak" "$VHOST"
  sudo nginx -t && sudo systemctl reload nginx
  echo "vhost estatico restaurado desde $bak"
}

# La home se pide a traves de Cloudflare: un solo curl puede volver 000 (sin
# respuesta HTTP) si el borde corta la conexion, y con el check de una sola
# pasada eso revierte un build sano (asi murio el deploy de dev de 1bb5afc).
# Se reintenta, y con -S el error real de curl queda en el log en vez de un 000
# pelado. Imprime el ultimo codigo HTTP; 000 si nunca hubo respuesta.
verify_home() {
  local intento code errf
  errf=$(mktemp)
  for intento in 1 2 3 4 5; do
    code=$(curl -4 -sS -o /dev/null -w '%{http_code}' -m 20 "$SITE/" 2>"$errf") || code=""
    [ "$code" = "200" ] && break
    printf 'intento %s: GET / respondio %s %s\n' "$intento" "${code:-000}" "$(tr -d '\n' <"$errf")" >&2
    [ "$intento" = 5 ] || sleep 3
  done
  rm -f "$errf"
  printf '%s' "${code:-000}"
}

# Devuelve 0/1 en lugar de cortar: quien decide es deploy_slot, que revierte si falla.
verify_public() { # $1=sha esperado
  local sha=$1 code body asset tmpb
  body=$(curl -4 -s -m 30 "$SITE/BUILD_INFO" || true)
  printf 'BUILD_INFO: %s\n' "${body:-<sin respuesta>}"
  printf '%s' "$body" | grep -q "$sha" || { echo "el sitio no sirve el build $sha" >&2; return 1; }

  code=$(verify_home)
  printf 'GET / -> %s\n' "$code"
  [ "$code" = "200" ] || { echo "el sitio no respondio 200 tras 5 intentos (ultimo: $code)" >&2; return 1; }

  # API viva: se mira el cuerpo, no solo el 200 (el fallback del SPA responde 200
  # con index.html en cualquier ruta que nginx no proxee).
  body=$(curl -4 -s -m 20 "$SITE/ready" || true)
  printf '/ready: %s\n' "$(printf '%s' "$body" | head -c 120)"
  printf '%s' "$body" | grep -q '"ok":true' || { echo "la API no responde /ready en produccion" >&2; return 1; }
  api_graphql_ok "$SITE" || { echo "POST /graphql no responde 200" >&2; return 1; }

  # Bundle sin mocks: si aparece la credencial de prueba, MSW se colo en el build.
  tmpb=$(mktemp)
  if curl -4 -fsS -m 35 -o "$tmpb" "$SITE/"; then
    asset=$(grep -o '/assets/index-[^"]*\.js' "$tmpb" | head -1 || true)
    if [ -n "$asset" ] && curl -4 -fsS -m 35 -o "$tmpb.bundle" "$SITE$asset"; then
      if grep -q "root2026" "$tmpb.bundle"; then
        rm -f "$tmpb" "$tmpb.bundle"
        echo "el bundle publicado trae los mocks (root2026)" >&2
        return 1
      fi
      printf 'bundle %s: sin root2026 (%s bytes)\n' "$asset" "$(wc -c < "$tmpb.bundle")"
      rm -f "$tmpb.bundle"
    else
      rm -f "$tmpb" "$tmpb.bundle"
      echo "no pude descargar el bundle principal ($SITE$asset)" >&2
      return 1
    fi
  else
    rm -f "$tmpb"
    echo "no pude descargar el index de produccion" >&2
    return 1
  fi
  rm -f "$tmpb"

  # El estado del worker se lee del ORIGEN: Cloudflare cachea los .js y puede
  # estar sirviendo una copia vieja, que no dice nada sobre este deploy.
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 --resolve "lux.eternum.lat:443:$ORIGIN_IP" "$SITE/mockServiceWorker.js" || true)
  printf 'worker en origen -> %s\n' "$code"
  if [ "$code" = "200" ]; then
    body=$(curl -s -m 20 --resolve "lux.eternum.lat:443:$ORIGIN_IP" "$SITE/mockServiceWorker.js" || true)
    printf '%s' "$body" | grep -qi '<!doctype html' || { echo "produccion publica /mockServiceWorker.js como JS" >&2; return 1; }
    echo "worker: sirve el fallback del SPA, no el worker (correcto)"
  elif [ "$code" != "404" ]; then
    echo "mockServiceWorker.js responde $code" >&2
    return 1
  fi

  echo "verificacion publica OK (API real, sin mocks)"
}

deploy_slot() { # $1=slot $2=rama
  local slot=$1 branch=$2
  local repo="$BASE/$slot/repo" sha version prev origen_actual
  prev=$(current_slot)

  # Produccion no publica mocks: se corta antes de tocar el slot.
  say "slot $slot: chequeo previo de la rama $branch"
  # /srv es de root: el primer deploy crea BASE y el slot. Mismo grupo que dev
  # (hermes:devs) asi faku y hermes pueden trabajar el checkout.
  if [ ! -d "$BASE/$slot" ]; then
    sudo mkdir -p "$BASE/$slot"
    sudo chown hermes:devs "$BASE" "$BASE/$slot"
    sudo chmod 2775 "$BASE" "$BASE/$slot"
  fi
  if [ -d "$repo/.git" ]; then
    origen_actual=$(git -C "$repo" remote get-url origin || true)
    [ "$origen_actual" = "$REPO_URL" ] || git -C "$repo" remote set-url origin "$REPO_URL"
    git -C "$repo" fetch --depth 1 origin "$branch"
    git -C "$repo" reset --hard FETCH_HEAD
    git -C "$repo" clean -fd
  elif [ -d "$repo" ]; then
    die "$repo existe y no es un repo git: revisar a mano"
  else
    git clone --depth 1 --branch "$branch" "$REPO_URL" "$repo"
  fi
  sha=$(git -C "$repo" rev-parse --short HEAD)
  version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$repo/package.json" | head -1)

  [ -f "$repo/api/package.json" ] || die "la rama $branch no trae api/package.json: produccion no se despliega con mocks. main todavia no tiene backend; esperar la release dev->main."
  grep -q '"db:migrate"' "$repo/api/package.json" || die "api/package.json de $branch no define db:migrate"
  echo "commit: $sha (version $version, mocks off)"

  say "slot $slot: build del SPA (VITE_ENABLE_MOCKS=false)"
  (
    cd "$repo"
    printf '# Pisado por ~/deploy/lux-prod.sh: produccion sirve la API real, nunca MSW.\nVITE_ENABLE_MOCKS=false\n' > .env.production
    bun install --frozen-lockfile
    bun run build
    rm -f dist/mockServiceWorker.js
    printf '%s %s\n' "$sha" "$(date -u +%FT%TZ)" > dist/BUILD_INFO
  )
  if grep -rq "root2026" "$repo/dist"; then
    die "el build de $branch contiene las credenciales de prueba (root2026): no se publica"
  fi

  say "slot $slot: publicacion del build"
  if [ ! -d "$DOCROOT" ]; then sudo mkdir -p "$DOCROOT"; sudo chown hermes:hermes "$DOCROOT"; fi
  rsync -a --delete "$repo/dist/" "$DOCROOT/$slot/"

  say "slot $slot: API (migraciones expand/contract)"
  (
    set -a; . "$ENV_DB"; set +a
    # api/src/env.ts cae a lux-dev.env si una variable falta en el entorno. Con
    # lux-prod.env completo no pasa, pero que un typo no migre la base equivocada.
    [ "${DB_NAME:-}" = "lux_prod" ] || { echo "ERROR: DB_NAME='${DB_NAME:-}' y produccion exige lux_prod" >&2; exit 1; }
    cd "$repo/api"
    bun install --frozen-lockfile
    bun run db:migrate
  )

  # Primer admin de produccion. Idempotente en el repo; solo corre si existe.
  if [ -f "$repo/api/scripts/create-admin.ts" ]; then
    say "slot $slot: admin inicial (db:create-admin)"
    (
      set -a; . "$ENV_DB"; . "$ENV_ADMIN"; set +a
      cd "$repo/api"
      bun run db:create-admin
    ) || warn "db:create-admin fallo: revisar el log; el resto del deploy sigue"
  else
    warn "la rama $branch no trae api/scripts/create-admin.ts: me salteo el admin inicial"
  fi

  say "slot $slot: levantar la API y esperar /ready"
  sudo systemctl restart "lux-prod-api@$slot"
  api_ready "${PORT[$slot]}" || die "la API del slot $slot no llego a /ready (journalctl -u lux-prod-api@$slot)"
  api_graphql_ok "http://127.0.0.1:${PORT[$slot]}" || die "la API del slot $slot responde /ready pero POST /graphql no da 200 en :${PORT[$slot]}"
  echo "API del slot $slot OK en 127.0.0.1:${PORT[$slot]} (Postgres lux_prod)"

  if [ "$NO_SWITCH" = "1" ]; then
    say "slot $slot: --no-switch, no se toca nginx ni el symlink"
    printf '\nLISTO (sin switch): slot %s con %s (commit %s) en 127.0.0.1:%s\n' "$slot" "$branch" "$sha" "${PORT[$slot]}"
    printf 'El sitio publico sigue como estaba (%s).\n' "$SITE"
    return 0
  fi

  say "slot $slot: mover el trafico"
  switch_traffic "$slot"
  if ! verify_public "$sha"; then
    say "la verificacion publica fallo"
    if [ -n "$prev" ]; then
      say "vuelvo al slot $prev"
      switch_traffic "$prev"
      die "deploy revertido al slot $prev; el slot $slot quedo arriba pero sin trafico (revisar antes de reintentar)"
    else
      say "no habia slot anterior: restauro el vhost estatico"
      restore_static_vhost || true
      die "primer switch revertido: lux.eternum.lat vuelve a servir el build estatico. El slot $slot quedo arriba en :${PORT[$slot]}"
    fi
  fi
  printf '\nLISTO: %s sirviendo el slot %s (api :%s, rama %s, commit %s)\n' "$SITE" "$slot" "${PORT[$slot]}" "$branch" "$sha"
  printf 'Rollback: ~/deploy/lux-prod.sh --rollback\n'
}

rollback() {
  local cur other sha
  cur=$(current_slot)
  [ -n "$cur" ] || die "no hay slot vivo: produccion sigue en modo estatico, no hay nada a lo que volver"
  other=$(other_slot "$cur")
  say "rollback: $cur -> $other"
  api_ready "${PORT[$other]}" || warn "el slot $other no responde /ready"
  switch_traffic "$other"
  sha=$(awk '{print $1}' "$DOCROOT/$other/BUILD_INFO" 2>/dev/null || true)
  if [ -n "$sha" ]; then verify_public "$sha" || warn "la verificacion publica del slot $other fallo"; fi
  printf '\nLISTO: %s sirviendo el slot %s\n' "$SITE" "$other"
}

status() {
  local cur other code up vh
  cur=$(current_slot || true)
  if [ -n "$cur" ]; then other=$(other_slot "$cur"); else other=blue; fi
  printf 'slot vivo:   %s\n' "${cur:-<ninguno: prod sirve el build estatico>}"
  printf 'slot idle:   %s\n' "$other"
  if [ -f "$UPSTREAM" ]; then
    up=$(grep -o 'server 127.0.0.1:[0-9]*' "$UPSTREAM" | awk '{print $2}')
  else
    up="<sin upstream: no existe $UPSTREAM>"
  fi
  printf 'upstream:    %s\n' "$up"
  if [ -L "$DOCROOT/current" ]; then
    printf 'docroot:     %s -> %s\n' "$DOCROOT/current" "$(readlink -f "$DOCROOT/current")"
  else
    printf 'docroot:     <sin symlink current en %s>\n' "$DOCROOT"
  fi
  if vhost_is_bluegreen; then vh="blue/green"; else vh="estatico ($STATIC_DOCROOT)"; fi
  printf 'vhost:       %s\n' "$vh"
  for s in blue green; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:${PORT[$s]}/ready" || true)
    printf 'health %-5s : %s (:%s)\n' "$s" "${code:-sin respuesta}" "${PORT[$s]}"
  done
  printf 'BUILD_INFO : %s\n' "$(curl -4 -s -m 15 "$SITE/BUILD_INFO" 2>/dev/null | head -1 || echo '<sin respuesta>')"
  printf 'POST /graphql: %s\n' "$(curl -4 -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$SITE/graphql" -H 'content-type: application/json' --data '{"query":"{ __typename }"}' 2>/dev/null || echo '<sin respuesta>')"
  return 0
}

# --- flags ---
while [ $# -gt 0 ]; do
  case "$1" in
    --status)    status; exit 0 ;;
    --rollback)  rollback; exit 0 ;;
    --print-vhost) emit_vhost; exit 0 ;;
    --no-switch) NO_SWITCH=1; shift ;;
    --branch)    [ -n "${2:-}" ] || die "--branch necesita un nombre de rama"; BRANCH="$2"; shift 2 ;;
    --branch=*)  BRANCH="${1#--branch=}"; shift ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    -*)          die "flag desconocida: $1" ;;
    *)           BRANCH="$1"; shift ;;
  esac
done

[ -f "$ENV_DB" ] || die "falta $ENV_DB (credenciales de la base lux_prod)"
[ -f "$ENV_API" ] || die "falta $ENV_API (AUTH_SECRET de produccion)"
[ -f "$ENV_ADMIN" ] || warn "falta $ENV_ADMIN: el admin inicial no se va a crear"

cur=$(current_slot)
if [ -n "$cur" ]; then deploy_slot "$(other_slot "$cur")" "$BRANCH"; else deploy_slot blue "$BRANCH"; fi
