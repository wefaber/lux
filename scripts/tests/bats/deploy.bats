#!/usr/bin/env bats
# deploy.sh con podman simulado: se prueba la logica (rootless, entorno,
# escalado, rollback), no los contenedores. Los contenedores reales se probaron
# aparte (ver Docker-Compose.md).

load helpers

setup() {
    setup_entorno
    export SGRSI_STACK_USUARIO="" SGRSI_COMPOSE_PROVEEDOR="podman compose"
    export SGRSI_STACK_ENV="$TMP/lux.env"
    printf 'POSTGRES_PASSWORD=x\nLUX_WEB_PORT=8099\n' > "$SGRSI_STACK_ENV"
    chmod 600 "$SGRSI_STACK_ENV"
    export SGRSI_DEPLOY_ESPERA=1
}
teardown() { teardown_entorno; }

@test "ayuda lista los subcomandos" {
    run "$ADMIN" deploy ayuda
    [ "$status" -eq 0 ]
    [[ "$output" == *"escalar <n>"* ]]
    [[ "$output" == *"rollback"* ]]
}

@test "se rehusa si podman no es rootless" {
    STUB_PODMAN_ROOTLESS=false run "$ADMIN" deploy up
    [ "$status" -ne 0 ]
    [[ "$output" == *"no esta en modo rootless"* ]]
    ! grep -q 'compose.* up' "$STUB_LOG"
}

@test "SGRSI_PERMITIR_ROOT=1 permite seguir con aviso" {
    STUB_PODMAN_ROOTLESS=false SGRSI_PERMITIR_ROOT=1 SGRSI_DEPLOY_ROLLBACK_AUTO=0 run "$ADMIN" deploy ps
    [[ "$output" == *"NO esta en modo rootless"* ]]
    grep -q 'compose' "$STUB_LOG"
}

@test "sin archivo de entorno sale con 78" {
    rm "$SGRSI_STACK_ENV"
    run "$ADMIN" deploy up
    [ "$status" -eq 78 ]
    [[ "$output" == *"No existe el archivo de entorno"* ]]
}

@test "entorno accesible por otros se rechaza" {
    chmod 644 "$SGRSI_STACK_ENV"
    run "$ADMIN" deploy up
    [ "$status" -eq 78 ]
    [[ "$output" == *"accesible por otros"* ]]
}

@test "entorno con [COMPLETAR] se rechaza" {
    echo 'AUTH_SECRET=[COMPLETAR]' >> "$SGRSI_STACK_ENV"
    run "$ADMIN" deploy up
    [ "$status" -eq 78 ]
    [[ "$output" == *"[COMPLETAR]"* ]]
}

@test "up --dry-run muestra el comando y no llama a podman" {
    run "$ADMIN" --dry-run deploy up
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run]"* ]]
    [[ "$output" == *"up -d --build"* ]]
    ! grep -q '^podman' "$STUB_LOG"
}

@test "up (stub) levanta con --env-file y -f, y espera /ready" {
    SGRSI_DEPLOY_ROLLBACK_AUTO=0 run "$ADMIN" deploy up
    grep -q "compose --env-file $SGRSI_STACK_ENV -f .*ops/compose.yaml up -d --build" "$STUB_LOG"
    grep -q 'curl' "$STUB_LOG"
}

@test "up con build recrea los contenedores (podman-compose no reemplaza los existentes)" {
    SGRSI_DEPLOY_ROLLBACK_AUTO=0 run "$ADMIN" deploy up
    grep -q 'compose.* up -d --build --force-recreate' "$STUB_LOG"
}

@test "up --sin-build no fuerza la recreacion" {
    SGRSI_DEPLOY_ROLLBACK_AUTO=0 run "$ADMIN" deploy up --sin-build
    ! grep -q 'force-recreate' "$STUB_LOG"
}

@test "escalar valida el rango" {
    run "$ADMIN" deploy escalar 0
    [ "$status" -ne 0 ]
    run "$ADMIN" deploy escalar 9
    [ "$status" -ne 0 ]
    run "$ADMIN" deploy escalar dos
    [ "$status" -ne 0 ]
    run "$ADMIN" deploy escalar
    [ "$status" -ne 0 ]
}

@test "escalar escribe LUX_API_REPLICAS en el env y hace up -d" {
    run "$ADMIN" deploy escalar 3
    [ "$status" -eq 0 ]
    grep -q '^LUX_API_REPLICAS=3$' "$SGRSI_STACK_ENV"
    grep -q 'compose.* up -d$' "$STUB_LOG"
    run "$ADMIN" deploy escalar 2
    [ "$(grep -c '^LUX_API_REPLICAS=' "$SGRSI_STACK_ENV")" -eq 1 ]
    grep -q '^LUX_API_REPLICAS=2$' "$SGRSI_STACK_ENV"
}

@test "escalar --dry-run no toca el env" {
    run "$ADMIN" --dry-run deploy escalar 3
    [ "$status" -eq 0 ]
    ! grep -q LUX_API_REPLICAS "$SGRSI_STACK_ENV"
}

@test "rollback usa LUX_IMAGE_TAG=previous y --no-build" {
    run "$ADMIN" deploy rollback
    grep -q 'podman\[tag=previous\] compose .* up -d --no-build' "$STUB_LOG"
}

@test "rollback sin imagen previous avisa y falla" {
    STUB_IMAGE_EXISTS_RC=1 run "$ADMIN" deploy rollback
    [ "$status" -ne 0 ]
    [[ "$output" == *"No hay imagen"* ]]
    ! grep -q 'up -d --no-build' "$STUB_LOG"
}

@test "si /ready no responde, up intenta el rollback automatico" {
    STUB_CURL_RC=22 run "$ADMIN" deploy up
    [ "$status" -ne 0 ]
    [[ "$output" == *"rollback automatico"* ]]
    grep -q 'podman\[tag=previous\] compose .* up -d --no-build' "$STUB_LOG"
}

@test "con SGRSI_DEPLOY_ROLLBACK_AUTO=0 no se revierte solo" {
    STUB_CURL_RC=22 SGRSI_DEPLOY_ROLLBACK_AUTO=0 run "$ADMIN" deploy up
    [ "$status" -ne 0 ]
    ! grep -q 'tag=previous' "$STUB_LOG"
}

@test "up --sin-build no mueve la etiqueta previous" {
    run "$ADMIN" deploy up --sin-build
    ! grep -q 'podman\[tag=\] tag ' "$STUB_LOG"
}

@test "up con build etiqueta la imagen vigente como previous" {
    run "$ADMIN" deploy up
    grep -q 'tag localhost/lux-api:latest localhost/lux-api:previous' "$STUB_LOG"
}

@test "logs valida servicio y cantidad de lineas" {
    run "$ADMIN" deploy logs inexistente
    [ "$status" -ne 0 ]
    run "$ADMIN" deploy logs api abc
    [ "$status" -ne 0 ]
}

@test "unidad --dry-run muestra la instalacion y el linger" {
    run "$ADMIN" --dry-run deploy unidad
    [ "$status" -eq 0 ]
    [[ "$output" == *"loginctl enable-linger"* ]]
}

@test "subcomando desconocido sale con error" {
    run "$ADMIN" deploy volar
    [ "$status" -ne 0 ]
}

@test "escalar a menos replicas quita las sobrantes (nombres lux_api_N)" {
    # podman simulado que lista tres replicas
    mkdir -p "$TMP/bin"
    cat > "$TMP/bin/podman" <<'FIN'
#!/usr/bin/env bash
echo "podman[tag=${LUX_IMAGE_TAG:-}] $*" >> "$STUB_LOG"
case "$1" in
  info) echo true ;;
  compose) [[ "$2" == version ]] && echo stub ;;
  ps) printf 'lux-db\nlux_api_1\nlux_api_2\nlux_api_3\nlux_web_1\n' ;;
esac
exit 0
FIN
    chmod +x "$TMP/bin/podman"
    PATH="$TMP/bin:$PATH" run "$ADMIN" deploy escalar 1
    [ "$status" -eq 0 ]
    grep -q 'rm -f lux_api_2' "$STUB_LOG"
    grep -q 'rm -f lux_api_3' "$STUB_LOG"
    ! grep -q 'rm -f lux_api_1' "$STUB_LOG"
    ! grep -q 'rm -f lux-db' "$STUB_LOG"
}
