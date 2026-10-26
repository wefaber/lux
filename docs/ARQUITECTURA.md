# Lux — Arquitectura, Instalacion y Uso

Documento tecnico del Sistema de Gestion de Recursos y Servicios Informaticos (SGRSI).

> Los diagramas de secuencia del camino feliz de cada caso de uso (CU-01 a CU-27) estan en
> [`UML-SECUENCIAS.md`](UML-SECUENCIAS.md). Ese documento tambien registra las diferencias
> entre el modelo UML del vault y la implementacion actual.

---

## 1. Arquitectura general

Lux sigue una arquitectura **cliente-servidor** con separacion estricta entre frontend y backend:

```
[ Navegador ] ─── HTTPS ─── [ Nginx ] ─── proxy ─── [ API GraphQL + REST ]
                                                    [ PostgreSQL ]
```

- **Frontend**: SPA (Single Page Application) en React 19, servida como archivos estaticos desde Nginx.
- **Backend**: API en Bun, Elysia y GraphQL Yoga (carpeta `api/`) con Drizzle sobre PostgreSQL. Expone GraphQL en `/graphql` y un adaptador REST en `/api/v1`. Ver `docs/BACKEND.md`. En desarrollo, MSW simula el backend completo.
- **Base de datos**: PostgreSQL con claves foraneas y restricciones CHECK (migraciones en `api/drizzle/`).

La comunicacion entre frontend y backend es unicamente via GraphQL sobre HTTP. No hay WebSockets ni polling.

---

## 2. Arquitectura del frontend

El frontend esta organizado en tres capas logicas, como define el issue [FS-E1 #20](https://github.com/itica-lat/eternum/issues/20):

```
┌─────────────────────────────────────────────┐
│  PRESENTACION                               │
│  features/   → paginas y modulos            │
│  components/ → UI reutilizable              │
│  (JSX puro, sin logica de negocio)          │
├─────────────────────────────────────────────┤
│  ESTADO / LOGICA                            │
│  hooks/ → useAuth, useTheme, useHaptics     │
│  (Context API, reglas de negocio, efectos)  │
├─────────────────────────────────────────────┤
│  INFRAESTRUCTURA                            │
│  lib/     → tipos, constantes, gql()        │
│  mocks/   → MSW (schema + handlers)         │
│  router/  → arbol de rutas y guards         │
└─────────────────────────────────────────────┘
```

### Reglas de separacion

1. Ningun componente en `features/` contiene logica de negocio. Delegacion a hooks.
2. Estilos completamente separados del markup. TailwindCSS por clases utilitarias. Sin CSS-in-JS.
3. La funcion `gql()` es el unico punto de entrada a la API. Ningun componente llama a `fetch()` directamente.
4. Las rutas protegidas usan `<ProtectedRoute roles={[...]}>` que redirige a `/403` si el rol no coincide.

Los flujos de navegación por actor (pantallas, menú, rutas y guards) están documentados en
[`FLUJO-NAVEGACION.md`](FLUJO-NAVEGACION.md).

### Flujo de datos

```
Usuario → Componente → gql(query, variables) → MSW (dev) / API (prod) → GraphQL → Estado → Re-render
```

En desarrollo, MSW intercepta todas las requests GraphQL y responde con datos mock basados en el schema (ver `src/mocks/schema.ts`). No se requiere backend real para desarrollar el frontend.

---

## 3. Modelo de datos

El sistema modela seis entidades principales, disenadas segun el DER definido en [FS-E1 #22](https://github.com/itica-lat/eternum/issues/22). Todas las interfaces estan en `src/lib/types.ts`.

### Entidades

| Entidad | Descripcion | Relaciones clave |
|---------|------------|------------------|
| **User** | Usuarios del sistema con rol (`root_admin`, `admin`, `tecnico`, `solicitante`) | 1:N con Tickets, Loans, ServiceRequests |
| **Product** | Equipo informatico (AIO, laptop, monitor, servidor, etc.) | 1:N con Components; 1:N con Tickets, Loans |
| **Component** | Componente interno de un equipo (RAM, disco, fuente, etc.) | N:1 con Product |
| **Ticket** | Incidencia de soporte tecnico | N:1 con User (solicitante, tecnico); N:1 con Product |
| **Loan** | Prestamo de equipo | N:1 con User (solicitante, aprobador); N:1 con Product |
| **ServiceRequest** | Solicitud de servicio (preparacion de lab, instalacion de software, etc.) | N:1 con User |
| **ActivityLog** | Registro de auditoria de acciones en el sistema | N:1 con User |

### Flujos de estado

**Ticket**: `pending` → `in_progress` (asignado/claim) → `in_resolution` (diagnostico) → `resolved`

**Loan**: `pending` → `approved` → `active` → `returned` (o `overdue` si vence)

**ServiceRequest**: `pending` → `approved` → `in_progress` → `completed` (o `rejected`)

**Product**: `available` ↔ `in_use` ↔ `in_repair` → `retired` (soft delete)

### API GraphQL

El schema GraphQL (ver `src/mocks/schema.ts`) expone:

- **Queries**: `login`, `me`, `users`, `products`, `components`, `tickets`, `oolTickets`, `loans`, `serviceRequests`, `dashboardStats`, `activityLogs`
- **Mutations**: CRUD para todas las entidades + operaciones de dominio (`claimTicket`, `completeTicket`, `approveLoan`, `returnLoan`, `rejectLoan`, `changePassword`)

Todas las mutaciones de eliminacion son **soft delete** (marcan `deletedAt` sin borrar el registro fisicamente).

### Archivos SQL (`docs/sql/`)

| Archivo | Contenido |
|---------|-----------|
| `proyecto.sql` | Schema real de la base `lux` (DDL en MariaDB, **legado**: no corresponde al esquema PostgreSQL vigente de `api/src/db/schema.ts`) |
| `queries.sql` | **No es parte del sistema.** Resolucion de un ejercicio de practica de SQL (`docs/18+07+Actividad+SQL.pdf`) adaptado al schema de `lux` |

> **Nota de vigencia.** Las secciones 4 y 6 describen la instalacion original y se mantienen como referencia; el procedimiento vigente (Podman rootless, `ops/compose.yaml`, respaldo por rsync) esta en `ops/` y `scripts/README.md`, y en el manual de instalacion del vault de documentacion.

Ver `docs/CAMBIOS.md` para el detalle de las correcciones aplicadas a ambos archivos.

---

## 4. Instalacion del servidor

> Definido en los issues [ASO-E1 #23](https://github.com/itica-lat/eternum/issues/23) al [#26](https://github.com/itica-lat/eternum/issues/26).

### 4.1 Sistema operativo

**Debian 13 "Trixie"** (netinst), elegido tras comparativa con Ubuntu Server LTS y Rocky Linux.

Criterios de eleccion:
- Ciclo de vida estable y predecible (Debian Stable)
- Repositorios oficiales con todas las dependencias necesarias (Nginx, PostgreSQL, Podman)
- Comunidad activa y documentacion extensa
- Compatibilidad total con Podman para contenedores rootless
- Sin sobrecarga de snaps o servicios innecesarios que vienen con Ubuntu Server

### 4.2 Particionado

Esquema para hardware tipico de laboratorio (500 GB+):

| Particion | Tamano | Sistema de archivos | Proposito |
|-----------|--------|---------------------|-----------|
| `/boot` | 512 MB | ext4 | Kernel y GRUB |
| `swap` | 2 GB | swap | Memoria de intercambio |
| `/` | resto | ext4 | Sistema y datos |

La swap de 2 GB esta dimensionada para equipos con 4-8 GB de RAM fisica.

### 4.3 Configuracion de red

IP estatica configurada via **Netplan** (`/etc/netplan/00-sgrsi-static.yaml`):

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    enp3s0:
      addresses:
        - <IP_ASIGNADA>/24
      routes:
        - to: default
          via: <GATEWAY>
      nameservers:
        addresses:
          - <DNS_PRIMARIO>
          - <DNS_SECUNDARIO>
```

Aplicar con `sudo netplan apply`.

### 4.4 Puertos y firewall

UFW configurado con politica `deny incoming, allow outgoing`:

| Puerto | Servicio | Justificacion |
|--------|---------|---------------|
| 80/tcp | HTTP | Redireccion a HTTPS |
| 443/tcp | HTTPS | API GraphQL y frontend |
| 52205/tcp | SSH | Acceso administrativo (puerto no estandar) |

PostgreSQL (5432) **no se expone**. El backend se conecta por la red interna de Podman. La API GraphQL corre dentro de un contenedor Podman rootless con red interna.

### 4.5 Paquetes del sistema

Instalados via `apt`:

| Paquete | Version | Proposito |
|---------|---------|-----------|
| `nginx` | >= 1.26 | Servidor web y proxy reverso |
| `postgresql` | 17 | Base de datos relacional (en el stack de `ops/compose.yaml` corre como contenedor) |
| `podman` | >= 5.0 | Contenedores rootless para el backend |
| `curl` | >= 8.0 | Herramientas de red y verificacion |
| `git` | >= 2.43 | Control de versiones y despliegue |
| `ufw` | >= 0.36 | Firewall |
| `certbot` | >= 2.0 | Certificados SSL/TLS (Let's Encrypt) |

### 4.6 Post-instalacion

```bash
# Verificar red
ip addr show enp3s0
ip route show
ping -c 4 1.1.1.1

# Verificar Nginx
curl -I http://localhost

# Verificar la API y la base
curl -s http://localhost:4111/ready

# Verificar Podman
podman run --rm hello-world

# Verificar UFW
sudo ufw status verbose
```

---

## 5. Uso del sistema

### 5.1 Roles y permisos

| Rol | Acceso | Capacidades |
|-----|--------|-------------|
| **root_admin** | Todo el sistema | Gestion de usuarios, roles, eliminacion de datos |
| **admin** | Panel admin + app | Gestion de usuarios (excepto root_admin), configuracion |
| **tecnico** | App (areas restringidas) | Gestion de tickets, prestamos, servicios, inventario |
| **solicitante** | App (basico) | Crear tickets, solicitar prestamos y servicios, ver perfil |

### 5.2 Flujos principales

#### Crear un ticket de soporte (solicitante)

1. Iniciar sesion con DNI y clave
2. Ir a Tickets → Nuevo ticket
3. Completar el wizard multi-step: tipo de incidencia → diagnostico inicial → estado del equipo → historial → resumen
4. Confirmar creacion. El ticket aparece en la bandeja OOL para que un tecnico lo reclame.

#### Gestionar un ticket (tecnico)

1. Ir a Tickets → OOL (sin asignar)
2. Reclamar ticket con "Asignarme"
3. Diagnosticar, actualizar estado y completar acciones tomadas
4. Resolver ticket

#### Registrar equipo en inventario (tecnico/admin)

1. Ir a Inventario → Nuevo equipo
2. Completar: tipo, marca, modelo, numero de serie, ubicacion
3. Opcional: agregar componentes internos (RAM, disco, etc.)
4. Guardar

#### Solicitar prestamo (solicitante)

1. Ir a Prestamos → Nuevo prestamo
2. Seleccionar equipo, fecha de retiro y devolucion
3. Enviar solicitud
4. Un admin/tecnico aprueba o rechaza

### 5.3 Accesibilidad

El sistema incluye controles de accesibilidad accesibles desde cualquier pagina (sidebar inferior o topbar):

- **Tema**: claro ↔ oscuro
- **Tamano de fuente**: sm / md / lg / xl
- **Alto contraste**: activa/desactiva relaciones de contraste WCAG AA
- **Fuente dislexica**: cambia la tipografia a OpenDyslexic

Las preferencias se persisten en `localStorage` y se aplican via atributos `data-*` en `<html>`.

---

## 6. Mantenimiento

### Actualizacion del sistema

```bash
sudo apt update && sudo apt upgrade
sudo podman auto-update          # Actualiza contenedores con politica de auto-update
```

### Backup de base de datos

```bash
sudo scripts/backup.sh respaldar   # ver scripts/README.md
```

### Logs

- **Nginx**: `/var/log/nginx/access.log`, `/var/log/nginx/error.log`
- **PostgreSQL**: `podman logs <contenedor-db>`
- **Podman**: `podman logs <contenedor>`
- **UFW**: `/var/log/ufw.log`
