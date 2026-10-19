# Scripts de administración del servidor SGRSI

Scripts de administración del servidor Debian 13 que hospeda el SGRSI (Lux).
La segunda entrega dejó la base (usuarios, grupos, SSH, respaldo local); la
tercera suma red, base de datos, firewall, logs, despliegue de contenedores y
respaldo remoto. La composición de contenedores y el servidor de respaldo
viven en `ops/` (ver `ops/compose.yaml` y `ops/backup-server/`).

| Entrega | Tema | Archivos |
|---|---|---|
| E2 | SSH, respaldo local, script modular | `lib/ssh.sh`, `backup.sh`, `admin.sh` |
| E3 | Red, DB, UFW, logs, despliegue, respaldo remoto | `lib/red.sh`, `lib/db.sh`, `lib/firewall.sh`, `lib/logs.sh`, `lib/deploy.sh`, `lib/respaldo.sh`, `lib/rotacion.sh` |

## Estructura

```
scripts/
├── admin.sh              Despachador. Descubre solos los módulos de lib/.
├── backup.sh             Respaldo (dump + configuración + secretos cifrados + SHA-256). También desde cron.
├── conf/sgrsi.conf.example   Ejemplo de /etc/sgrsi/sgrsi.conf (sin secretos).
├── cron/sgrsi-backup     Fragmento para /etc/cron.d, versionado.
├── lib/
│   ├── comun.sh          Logging, --dry-run, validaciones, reintentos, locks, secretos, podman.
│   ├── rotacion.sh       Política 7 diarios + 4 semanales (función pura, testeable).
│   ├── usuarios.sh  grupos.sh  ssh.sh
│   ├── red.sh  firewall.sh  db.sh  logs.sh  deploy.sh  respaldo.sh
└── tests/
    ├── bats/             Pruebas con stubs en PATH (no tocan el sistema). 169 casos.
    ├── integracion-respaldo.sh   Cliente y servidor de respaldo contra un sshd efímero.
    └── run-tests.sh      Suite de E2: crea usuarios reales; requiere root y una máquina descartable.
```

Un módulo nuevo es un archivo `lib/<nombre>.sh` que define `<nombre>_main`,
`<nombre>_descripcion` y `<nombre>_ayuda`: `admin.sh` lo descubre sin editarse,
y si un módulo no carga (error de sintaxis) lo informa y sigue con los demás.

## Uso

```bash
./admin.sh                                   # ayuda general y lista de módulos
./admin.sh --dry-run ufw aplicar-base        # muestra lo que haría, no modifica nada
sudo ./admin.sh usuarios alta tecnico1 "Técnico de coordinación"
sudo ./admin.sh ssh llave-agregar tecnico1 /tmp/tecnico1.pub
sudo ./admin.sh ssh aplicar
sudo ./admin.sh firewall aplicar-base
sudo ./admin.sh red config                   # IP fija que se aplicaría
sudo ./admin.sh deploy up                    # build + up + espera /ready (rollback si no responde)
sudo ./admin.sh respaldo local respaldar
sudo ./admin.sh respaldo remoto sincronizar
```

Opciones globales: `--dry-run` (nada se modifica) y `--config <archivo>`.
Códigos de salida: 0 correcto, 1 error, 2 uso, 75 fallo temporal (destino de
respaldo caído, reintentar), 78 configuración ausente o inválida.

## Configuración

Los valores por defecto están en cada módulo; se sobreescriben con
`/etc/sgrsi/sgrsi.conf` (ver `conf/sgrsi.conf.example`) o con variables de
entorno. **Las claves nunca van en el repositorio ni en el `.conf`**: se
entregan por `*_FILE` (archivo de modo 600) o por entorno (`DB_PASSWORD`,
`DB_PASSWORD_FILE`, `DB_ROLE_PASSWORD(_FILE)`, `SGRSI_BACKUP_CLAVE_ARCHIVO`).

Variables principales: `SGRSI_SSH_PUERTO`, `SGRSI_SSH_GRUPO`, `SGRSI_RED_IP`,
`SGRSI_RED_GATEWAY`, `SGRSI_FW_SSH_ORIGEN`, `SGRSI_DB_MODO`, `SGRSI_STACK_ENV`,
`SGRSI_BACKUP_DIR`, `SGRSI_BACKUP_DIARIOS` (7), `SGRSI_BACKUP_SEMANAS` (4),
`SGRSI_RESPALDO_HOST`, `SGRSI_RESPALDO_LLAVE`. La lista completa está en la
ayuda de cada módulo (`./admin.sh <módulo> ayuda`).

## Pruebas

```bash
cd tests
bats bats/*.bats                 # sin privilegios, no modifica el sistema
bash integracion-respaldo.sh     # sshd efímero en 127.0.0.1, sin root
shellcheck -x -S style $(find .. ../../ops -name '*.sh')
```

Las pruebas con `bats` reemplazan `useradd`, `ufw`, `ip`, `podman`, etc. por
stubs que solo registran cómo los llamaron: lo que afirma una prueba de
`--dry-run` es que el registro queda sin llamadas al comando que modifica. Las
de `ssh` validan el fragmento generado con el `sshd` real (`sshd -t -f`, `sshd -T -f`).
Las de `db` y `backup` usan el PostgreSQL local con bases propias (`sgrsitest_*`)
que se borran al terminar, y se omiten solas si no hay PostgreSQL.

`tests/run-tests.sh` (E2) ejecuta de verdad `useradd`, `groupadd` y `sshd`:
solo en una máquina virtual descartable.

## Documentación

El diseño y las decisiones están en el vault (`05-ADMIN-SO/E3/`): `Script-Final.md`,
`Docker-Compose.md`, `ServidorRespaldo.md`, `ManualInstalacion.md`, `SSH.md`, `RedYPuertos.md`.
