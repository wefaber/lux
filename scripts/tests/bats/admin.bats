#!/usr/bin/env bats
# Despachador: ayuda, descubrimiento de modulos y aislamiento de fallos.

load helpers

setup()    { setup_entorno; }
teardown() { teardown_entorno; }

@test "sin argumentos muestra la ayuda general y sale con 0" {
    run "$ADMIN"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Modulos disponibles"* ]]
}

@test "la ayuda lista los 9 modulos del script final" {
    run "$ADMIN" ayuda
    for m in usuarios grupos ssh red db firewall logs deploy respaldo; do
        [[ "$output" == *"  $m "* ]]
    done
}

@test "un modulo inexistente sale con error y muestra la ayuda" {
    run "$ADMIN" moduloquenoexiste
    [ "$status" -eq 1 ]
    [[ "$output" == *"Modulo desconocido"* ]]
    [[ "$output" == *"Modulos disponibles"* ]]
}

@test "cada modulo tiene ayuda propia" {
    for m in usuarios grupos ssh red db firewall logs deploy respaldo; do
        run "$ADMIN" "$m" ayuda
        [ "$status" -eq 0 ]
        [[ "$output" == *"Uso:"* ]]
    done
}

@test "--dry-run se propaga y se anuncia" {
    run "$ADMIN" --dry-run usuarios listar
    [[ "$output" == *"[dry-run] Modo ensayo"* ]]
}

@test "--config sin argumento es un error de uso (2)" {
    run "$ADMIN" --config
    [ "$status" -eq 2 ]
}

@test "ESCALABILIDAD: un modulo nuevo se descubre sin editar admin.sh ni los demas" {
    cp -r "$SCRIPTS_DIR" "$TMP/scripts"
    cat > "$TMP/scripts/lib/demo.sh" <<'FIN'
demo_descripcion() { echo "Modulo de demostracion"; }
demo_main() { echo "hola desde demo: $*"; }
FIN
    run "$TMP/scripts/admin.sh" demo uno dos
    [ "$status" -eq 0 ]
    [ "$output" = "hola desde demo: uno dos" ]
    run "$TMP/scripts/admin.sh" ayuda
    [[ "$output" == *"demo"*"Modulo de demostracion"* ]]
    # los archivos existentes no cambiaron
    diff -q "$SCRIPTS_DIR/admin.sh" "$TMP/scripts/admin.sh"
    diff -q "$SCRIPTS_DIR/lib/usuarios.sh" "$TMP/scripts/lib/usuarios.sh"
}

@test "FALLBACK: un modulo roto se omite con aviso y el resto sigue funcionando" {
    cp -r "$SCRIPTS_DIR" "$TMP/scripts"
    printf 'roto_main() { echo "no cierra\n' > "$TMP/scripts/lib/roto.sh"
    run "$TMP/scripts/admin.sh" usuarios ayuda
    [ "$status" -eq 0 ]
    [[ "$output" == *"El modulo 'roto' no se pudo cargar"* ]]
    [[ "$output" == *"Uso: admin.sh usuarios"* ]]
}
