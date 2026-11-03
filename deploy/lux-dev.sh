#!/usr/bin/env bash
# lux-dev.sh — deploy blue/green de dev.eternum.lat (preview de la rama dev de Lux).
#
#   ./lux-dev.sh [rama]      despliega esa rama (default: dev)
#   ./lux-dev.sh --rollback  vuelve al slot anterior (switch de upstream, sin build)
#   ./lux-dev.sh --status    slot vivo, salud de los dos slots y upstream
#   ./lux-dev.sh --placeholder [slot]   repone el cartel de "sin build"
#
#   La rama TIENE que traer api/: el preview sirve datos reales de Postgres y no
#   publica mocks nunca. Si la rama no trae `api/package.json`, el script muere
#   antes de tocar el slot. (Antes habia un fallback a MSW cuando `api/` no
#   existia; se saco: dev y prod comparten el mismo camino, sin builds simulados.)
#
# Lo corre el workflow .github/workflows/deploy-dev.yml en cada push a dev, y
# tambien se puede correr a mano. Regla: el slot idle se actualiza, se levanta y
# se verifica ANTES de mover el trafico; si la verificacion publica falla, el
# trafico vuelve solo al slot anterior. El slot viejo nunca se apaga, asi que
# volver atras es mover el symlink y el upstream, nunca re-buildear.
set -euo pipefail

BASE=/srv/lux-dev
DOCROOT=/var/www/lux-dev.eternum.lat
# LUX_REPO_URL permite desplegar desde un clon local: sirve para probar una rama
# que todavia no esta en GitHub (LUX_REPO_URL=/home/hermes/repos/lux-backend).
REPO_URL="${LUX_REPO_URL:-https://github.com/wefaber/lux.git}"
UPSTREAM=/etc/nginx/conf.d/lux-dev-upstream.conf
# Insumos del deploy. El script y sus assets viven EN ESTE REPO (deploy/), no en
# el VPS: lo que se mergea es lo que corre. Los .env son secretos y siguen fuera
# del repo (LUX_ENV_DIR permite moverlos de maquina sin editar el script).
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_DIR=${LUX_ENV_DIR:-/home/hermes/deploy/env}
ENV_DB=$ENV_DIR/lux-dev.env
ENV_API=$ENV_DIR/lux-api.env
BANNER=$SELF_DIR/lux-dev-banner.py
PLACEHOLDER=$SELF_DIR/placeholder/index.html.tpl
SITE=https://dev.eternum.lat
TEST_DNI=00000000
TEST_PASS=root2026
declare -A PORT=([blue]=4111 [green]=4112)

say()  { printf '\n== %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

current_slot() { basename "$(readlink -f "$DOCROOT/current")"; }
other_slot()   { if [ "$1" = blue ]; then echo green; else echo blue; fi; }

api_ready() { # $1=puerto
  local code
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$1/ready" || true)
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  return 1
}

login_body() { # $1=base-url (http://127.0.0.1:PUERTO o https://dev.eternum.lat)
  curl -s -m 30 -X POST "$1/graphql" -H 'content-type: application/json' \
    --data "{\"operationName\":\"Login\",\"variables\":{\"dni\":\"$TEST_DNI\",\"password\":\"$TEST_PASS\"},\"query\":\"query Login(\$dni: String!, \$password: String!) { login(dni: \$dni, password: \$password) { id token role } }\"}" || true
}

# /ready dice que el proceso y la base estan; el login dice que la API sirve.
api_login_ok() { # $1=puerto
  login_body "http://127.0.0.1:$1" | grep -q '"token"'
}

switch_traffic() { # $1=slot
  local slot=$1 tmp
  tmp=$(mktemp)
  printf '# Upstream de la API de dev.eternum.lat. Lo reescribe ~/deploy/lux-dev.sh\n# cuando cambia de slot; blue = 4111, green = 4112.\nupstream lux_dev_api {\n    server 127.0.0.1:%s;\n    keepalive 16;\n}\n' "${PORT[$slot]}" > "$tmp"
  sudo cp "$tmp" "$UPSTREAM"
  rm -f "$tmp"
  sudo nginx -t
  # symlink atomico: se arma al lado y se mueve encima
  ln -sfn "$DOCROOT/$slot" "$DOCROOT/.current.swap"
  mv -T "$DOCROOT/.current.swap" "$DOCROOT/current"
  sudo systemctl reload nginx
}

# Devuelve 0/1 en lugar de cortar: quien decide es deploy_slot, que revierte el
# trafico si esto falla. Se lee el estado publicado (el worker esta o no) y no
# el modo pedido, para que tambien sirva durante un rollback.
verify_public() { # $1=sha esperado
  local sha=$1 code body
  body=$(curl -4 -s -m 30 "$SITE/BUILD_INFO" || true)
  printf 'BUILD_INFO: %s\n' "${body:-<sin respuesta>}"
  printf '%s' "$body" | grep -q "$sha" || { echo "el sitio no sirve el build $sha" >&2; return 1; }

  # La home se pide a traves de Cloudflare: un solo curl puede volver 000 (sin
  # respuesta HTTP) si el borde corta la conexion, y con el check de una sola
  # pasada eso revertia un build sano (asi murio el deploy de 1bb5afc). Se
  # reintenta, y con -S el error real de curl queda en el log en vez de un 000
  # pelado. El sha ya se verifico arriba, esto solo mide disponibilidad.
  local intento errf
  errf=$(mktemp)
  code=""
  for intento in 1 2 3 4 5; do
    if code=$(curl -4 -sS -o /dev/null -w '%{http_code}' -m 15 "$SITE/" 2>"$errf"); then
      if [ "$code" = "200" ]; then break; fi
    fi
    echo "intento $intento: el sitio respondio ${code:-000} $(tr -d '\n' <"$errf")" >&2
    code=""
    [ "$intento" = 5 ] || sleep 3
  done
  rm -f "$errf"
  [ "$code" = "200" ] || { echo "el sitio no respondio 200 tras 5 intentos" >&2; return 1; }

  # El estado del worker se lee del ORIGEN: Cloudflare cachea los .js por
  # defecto (max-age 4h) y puede estar sirviendo una copia vieja que no dice
  # nada sobre este deploy. Se informa la copia del borde, pero no decide.
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 --resolve "dev.eternum.lat:443:167.114.2.210" "$SITE/mockServiceWorker.js")
  cacheado=$(curl -4 -s -o /dev/null -w '%{http_code}' -m 20 "$SITE/mockServiceWorker.js")
  printf 'worker: origen %s / borde %s\n' "$code" "$cacheado"
  if [ "$code" = "200" ]; then
    # Con el worker publicado manda MSW: si el deploy es API real, el build
    # quedo mal (MSW intercepta /graphql y la API nunca se usa).
    echo "el build quedo con mocks (mockServiceWorker.js publicado) y dev no publica mocks" >&2
    return 1
  fi
  [ "$code" = "404" ] || { echo "mockServiceWorker.js responde $code" >&2; return 1; }

  body=$(login_body "$SITE")
  printf 'login: %s\n' "$(printf '%s' "$body" | head -c 200)"
  printf '%s' "$body" | grep -q '"token"' || { echo "el login contra la API no devolvio token" >&2; return 1; }
  echo "verificacion publica OK (API real, sin mocks)"
}

deploy_slot() { # $1=slot $2=rama
  local slot=$1 branch=$2
  local repo="$BASE/$slot/repo" sha version prev
  prev=$(current_slot)

  say "slot $slot: checkout de $branch"
  if [ -d "$repo/.git" ]; then
    # El origen del slot sigue a REPO_URL: un deploy desde un clon local apunta
    # a ese clon y no a GitHub (si no, el fetch busca la rama en el remoto viejo).
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

  # Sin api/ no hay preview: dev ya no cae a MSW. Se corta antes de publicar nada.
  [ -f "$repo/api/package.json" ] || die "la rama $branch no trae api/package.json: dev sirve datos reales de Postgres y no publica mocks. Elegir una rama con backend."
  echo "commit: $sha (version $version)"

  say "slot $slot: build del SPA (VITE_ENABLE_MOCKS=false)"
  # .env.production se pisa en el checkout del slot: el preview sirve la API real,
  # nunca MSW (el archivo versionado no manda).
  (
    cd "$repo"
    printf '# Pisado por ~/deploy/lux-dev.sh: este slot sirve la API real.\nVITE_ENABLE_MOCKS=false\n' > .env.production
    bun install --frozen-lockfile
    bun run build
    rm -f dist/mockServiceWorker.js
    printf '%s %s\n' "$sha" "$(date -u +%FT%TZ)" > dist/BUILD_INFO
  )

  say "slot $slot: disclaimer de preview"
  python3 "$BANNER" "$repo/dist/index.html" \
    --branch "$branch" --commit "$sha" --version "$version" --slot "$slot" \
    --mode real \
    --built "$(date -u '+%Y-%m-%d %H:%M UTC')"

  say "slot $slot: publicacion del build"
  rsync -a --delete "$repo/dist/" "$DOCROOT/$slot/"

  say "slot $slot: API (migraciones expand/contract)"
  (
    set -a; . "$ENV_DB"; set +a
    cd "$repo/api"
    bun install --frozen-lockfile
    bun run db:migrate
  )

  say "slot $slot: levantar la API y esperar /ready"
  sudo systemctl restart "lux-api@$slot"
  api_ready "${PORT[$slot]}" || die "la API del slot $slot no llego a /ready (journalctl -u lux-api@$slot)"
  # Todavia no movimos trafico: si el login no anda, no hay nada que revertir.
  api_login_ok "${PORT[$slot]}" || die "la API del slot $slot responde /ready pero el login falla en :${PORT[$slot]}"
  echo "login contra la API del slot $slot OK (datos reales)"

  say "slot $slot: mover el trafico"
  switch_traffic "$slot"
  if ! verify_public "$sha"; then
    say "la verificacion publica fallo: vuelvo al slot $prev"
    switch_traffic "$prev"
    die "deploy revertido al slot $prev; el slot $slot quedo arriba pero sin trafico (revisar antes de reintentar)"
  fi
  printf '\nLISTO: %s sirviendo el slot %s (api :%s, rama %s, commit %s)\n' "$SITE" "$slot" "${PORT[$slot]}" "$branch" "$sha"
  printf 'Rollback: ~/deploy/lux-dev.sh --rollback\n'
}

placeholder() { # $1=slot (default: el idle)
  local slot="${1:-$(other_slot "$(current_slot)")}"
  [ -f "$PLACEHOLDER" ] || die "falta $PLACEHOLDER"
  sed "s/{{SLOT}}/$slot/g" "$PLACEHOLDER" > "$DOCROOT/$slot/index.html"
  printf 'placeholder repuesto en %s/%s/index.html\n' "$DOCROOT" "$slot"
}

rollback() {
  local cur other sha
  cur=$(current_slot)
  other=$(other_slot "$cur")
  say "rollback: $cur -> $other"
  api_ready "${PORT[$other]}" || true
  switch_traffic "$other"
  sha=$(awk '{print $1}' "$DOCROOT/$other/BUILD_INFO" 2>/dev/null || true)
  if [ -n "$sha" ]; then verify_public "$sha" || echo "aviso: la verificacion publica del slot $other fallo"; fi
  printf '\nLISTO: %s sirviendo el slot %s\n' "$SITE" "$other"
}

status() {
  local cur other code
  cur=$(current_slot); other=$(other_slot "$cur")
  printf 'slot vivo:   %s\n' "$cur"
  printf 'slot idle:   %s\n' "$other"
  printf 'upstream:    %s\n' "$(grep -o 'server 127.0.0.1:[0-9]*' "$UPSTREAM" | awk '{print $2}')"
  printf 'docroot:     %s -> %s\n' "$DOCROOT/current" "$(readlink -f "$DOCROOT/current")"
  for s in blue green; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:${PORT[$s]}/ready" || true)
    printf 'health %-5s : %s (:%s)\n' "$s" "${code:-sin respuesta}" "${PORT[$s]}"
  done
  printf 'BUILD_INFO : %s\n' "$(curl -4 -s -m 15 "$SITE/BUILD_INFO" || echo '<sin respuesta>')"
}

case "${1:-}" in
  --rollback) rollback ;;
  --status)   status ;;
  --placeholder) placeholder "${2:-}" ;;
  ""|--*)     [ -f "$ENV_API" ] || die "falta $ENV_API (AUTH_SECRET de la API). Revisar antes de desplegar."
              [ -f "$ENV_DB" ] || die "falta $ENV_DB (credenciales de Postgres)."
              cur=$(current_slot)
              deploy_slot "$(other_slot "$cur")" dev ;;
  *)          [ -f "$ENV_API" ] || die "falta $ENV_API (AUTH_SECRET de la API). Revisar antes de desplegar."
              [ -f "$ENV_DB" ] || die "falta $ENV_DB (credenciales de Postgres)."
              cur=$(current_slot)
              deploy_slot "$(other_slot "$cur")" "$1" ;;
esac
