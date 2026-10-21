#!/usr/bin/env bats
# Usuarios y grupos con stubs: nunca se crea ni se borra una cuenta real.

load helpers

setup()    { setup_entorno; }
teardown() { teardown_entorno; }

@test "usuarios alta --dry-run muestra el useradd y NO lo ejecuta" {
    run "$ADMIN" --dry-run usuarios alta tecnico1 "Tecnico de coordinacion"
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] useradd --create-home --shell /bin/bash"* ]]
    [ ! -s "$STUB_LOG" ]
}

@test "usuarios alta real (con stub) llama a useradd con los argumentos correctos" {
    run "$ADMIN" usuarios alta tecnico1 "Tecnico de coordinacion"
    [ "$status" -eq 0 ]
    grep -q '^useradd --create-home --shell /bin/bash --comment Tecnico de coordinacion tecnico1$' "$STUB_LOG"
}

@test "usuarios alta rechaza nombres invalidos sin llamar a useradd" {
    run "$ADMIN" usuarios alta 'Tec Nico; id'
    [ "$status" -ne 0 ]
    [ ! -s "$STUB_LOG" ]
}

@test "usuarios alta sin argumento es rechazado" {
    run "$ADMIN" usuarios alta
    [ "$status" -ne 0 ]
    [[ "$output" == *"obligatorio"* ]]
}

@test "usuarios alta de un usuario que ya existe falla" {
    run "$ADMIN" usuarios alta root
    [ "$status" -ne 0 ]
    [[ "$output" == *"ya existe"* ]]
    [ ! -s "$STUB_LOG" ]
}

@test "usuarios baja de un usuario inexistente falla" {
    run "$ADMIN" usuarios baja noexisteesteusuario
    [ "$status" -ne 0 ]
    [ ! -s "$STUB_LOG" ]
}

@test "usuarios baja --dry-run de un usuario existente no ejecuta userdel" {
    run "$ADMIN" --dry-run usuarios baja root
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] userdel --remove root"* ]]
    [ ! -s "$STUB_LOG" ]
}

@test "usuarios bloquear --dry-run" {
    STUB_PASSWD_ESTADO=P run "$ADMIN" --dry-run usuarios bloquear nobody
    [ "$status" -eq 0 ]
    [[ "$output" == *"[dry-run] usermod --lock nobody"* ]]
    [ ! -s "$STUB_LOG" ]
}

@test "usuarios listar y info funcionan sin privilegios" {
    run "$ADMIN" usuarios listar
    [ "$status" -eq 0 ]
    run "$ADMIN" usuarios info root
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usuario:  root"* ]]
}

@test "grupos alta --dry-run no ejecuta groupadd" {
    run "$ADMIN" --dry-run grupos alta sgrsi-tecnicos
    [[ "$output" == *"[dry-run] groupadd sgrsi-tecnicos"* ]]
    [ ! -s "$STUB_LOG" ]
}

@test "grupos alta de un grupo existente falla" {
    run "$ADMIN" grupos alta root
    [ "$status" -ne 0 ]
    [[ "$output" == *"ya existe"* ]]
}

@test "grupos alta rechaza nombres con metacaracteres" {
    run "$ADMIN" grupos alta 'g; rm -rf /'
    [ "$status" -ne 0 ]
    [ ! -s "$STUB_LOG" ]
}

@test "grupos agregar real (stub) usa usermod --append" {
    run "$ADMIN" grupos agregar root daemon
    [ "$status" -eq 0 ]
    grep -q '^usermod --append --groups daemon root$' "$STUB_LOG"
}

@test "grupos agregar con usuario inexistente falla" {
    run "$ADMIN" grupos agregar noexisteesteusuario root
    [ "$status" -ne 0 ]
}

@test "grupos miembros y listar" {
    run "$ADMIN" grupos miembros root
    [ "$status" -eq 0 ]
    run "$ADMIN" grupos listar
    [ "$status" -eq 0 ]
}
