# Scripts de administración del servidor SGRSI

Scripts de administración del servidor Debian que hospeda el SGRSI (Lux),
correspondientes a la segunda entrega de Administración de Sistemas Operativos.

| Issue | Criterio de rúbrica | Archivos |
|---|---|---|
| [#75](https://github.com/wefaber/eternum/issues/75) | Configuración del servicio SSH | `lib/ssh.sh` |
| [#77](https://github.com/wefaber/eternum/issues/77) | Rutinas de backup y scripts | `backup.sh`, `cron/sgrsi-backup` |
| [#78](https://github.com/wefaber/eternum/issues/78) | Script de administración modular | `admin.sh`, `lib/*.sh` |

## Estructura

```
scripts/
├── admin.sh              Despachador. Punto de entrada único.
├── backup.sh             Respaldo de PostgreSQL. Se invoca también desde cron.
├── cron/
│   └── sgrsi-backup      Fragmento para /etc/cron.d, versionado.
├── lib/
│   ├── comun.sh          Logging, requerir_root, confirmar, validaciones.
│   ├── usuarios.sh       Ciclo de vida de las cuentas del sistema.
│   ├── grupos.sh         Grupos y membresías.
│   └── ssh.sh            Endurecimiento de sshd y llaves públicas.
└── tests/
    └── run-tests.sh      Suite funcional. Requiere root y Linux.
```

`backup.sh` no pasa por el despachador porque corre desde cron sin
intervención humana; los módulos de `lib/` solo tienen sentido en uso
interactivo o administrado.

## Uso

```bash
./admin.sh                                   # ayuda general
./admin.sh usuarios ayuda                    # ayuda del módulo
sudo ./admin.sh usuarios alta tecnico1 "Técnico de coordinación"
sudo ./admin.sh grupos alta sgrsi-tecnicos
sudo ./admin.sh grupos agregar tecnico1 sgrsi-tecnicos
sudo ./admin.sh ssh llave-agregar tecnico1 /tmp/tecnico1.pub
sudo ./admin.sh ssh aplicar
sudo ./admin.sh ssh verificar

sudo ./backup.sh respaldar
sudo ./backup.sh verificar
sudo ./backup.sh restaurar /var/backups/sgrsi/lux_20260823_030000.sql.gz
sudo ./backup.sh instalar-cron
```

Cada módulo se puede usar sin el despachador, siempre que `comun.sh` esté
cargado:

```bash
source lib/comun.sh
source lib/usuarios.sh
usuarios_main listar
```

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `SGRSI_LOG` | `/var/log/sgrsi/admin.log` | Destino del log de operaciones |
| `SGRSI_SIN_CONFIRMACION` | `false` | `true` salta las confirmaciones interactivas |
| `SGRSI_BACKUP_DIR` | `/var/backups/sgrsi` | Directorio de respaldos |
| `SGRSI_BACKUP_RETENCION_DIAS` | `14` | Días de retención de dumps |
| `SGRSI_SSH_DROPIN` | `/etc/ssh/sshd_config.d/99-sgrsi.conf` | Destino del fragmento de sshd |
| `SGRSI_SSH_PUERTO` | `52205` | Puerto administrativo |
| `SGRSI_SSH_GRUPO` | `sgrsi-tecnicos` | Grupo con acceso SSH |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | `localhost` `5432` `lux` `lux_app` — | Conexión a PostgreSQL |

## Pruebas

```bash
sudo ./tests/run-tests.sh
```

La suite crea usuarios y grupos con prefijo `sgrsitest`, los ejerce y los
elimina al terminar. Las pruebas de base de datos se saltan solas si no hay
un PostgreSQL accesible con las credenciales de `DB_*`.

Para correr también el ciclo completo de respaldo y restauración:

```bash
sudo DB_USER=lux_app DB_PASSWORD=... ./tests/run-tests.sh
```

Linter: `shellcheck --shell=bash --external-sources admin.sh backup.sh lib/*.sh tests/*.sh`

## Documentación

El diseño y las decisiones están en el vault (`wefaber/ethernum-obsidian`):

- `05-ADMIN-SO/E2/Scripts-Bash-V1.md` — estructura modular y despachador
- `05-ADMIN-SO/E2/RutinasBackup.md` — medios de respaldo, retención y cron
- `05-ADMIN-SO/E2/SSH-Configuracion.md` — configuración de sshd y llaves
