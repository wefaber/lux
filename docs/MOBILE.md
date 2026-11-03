# Vista mobile

Issue #98 (uso 1: escaneo QR, notas, incidencias por plantilla). El uso 2 (salas y
checklist) es el issue #99. Decisiones tomadas con Faku el 2026-11-02.

## Cuándo es mobile

Por ancho de viewport: `< 768px` (breakpoint `md`), con `useIsMobile()`
(`src/hooks/useMediaQuery.ts`). En mobile `AppLayout` y `AdminLayout` delegan en
`MobileLayout` y cualquier ruta fuera de `/dashboard/m/*` redirige a
`/dashboard/m`. Desktop no cambia.

## Qué ofrece

| Ruta | Función | Roles |
| --- | --- | --- |
| `/dashboard/m` | Accesos según rol | todos |
| `/dashboard/m/tickets` | Estado de tickets (solicitante: los propios; staff: asignados / abiertos) | todos |
| `/dashboard/m/scan?context=inventory` | Ficha, alta prellenada si el código no existe, baja con motivo, notas | staff |
| `/dashboard/m/scan?context=incident` | Incidencia rápida con el equipo o adjuntarlo a un ticket (`ticketId`) | staff |
| `/dashboard/m/scan?context=loan` | Prellena la solicitud de préstamo | todos |
| `/dashboard/m/incident` | Incidencia rápida desde plantilla | staff |
| `/dashboard/m/loan` | Solicitud de préstamo | todos |

La cámara usa `QrScanner` en variante de página. Si el permiso se niega, se avisa y
queda el ingreso manual del código de equipo (`machineId`, el contenido del QR).

## Escaneo

Cada lectura llama a `recordScan` y queda en `scan_events`: quién, equipo (o el
código si no existe), contexto, user agent y fecha, más una fila `SCAN_EQUIPMENT`
en ActivityLog. Un solicitante solo puede escanear en contexto `loan`.

## Notas rápidas

Privadas por técnico: toda lectura filtra por autor, ni un admin las ve. Viven en
la base (`equipment_notes`), así que el técnico las ve en todas sus sesiones. Se
guardan solas (autosave con debounce). La auditoría registra la acción, nunca el
texto.

## Plantillas de incidencia

Ciclo `draft → testing → approved → retired`:

- Un técnico crea la plantilla (`draft`) y la envía a prueba (`testing`); en prueba
  solo la usan su autor y los admins.
- Un admin la aprueba (la usa todo el staff) o la rechaza con motivo (vuelve a `draft`).
- Retirar no borra: el autor retira las no aprobadas; un admin, cualquiera.

Gestión: `/admin/incident-templates` (admin) y `/dashboard/incident-templates`
(técnico: las propias y las aprobadas).

Una incidencia rápida precarga categoría, prioridad, título y descripción de la
plantilla. La ubicación sale del equipo y el staff la cambia solo si el equipo se
movió (`tickets.location_id`).

## Prioridad

`low | medium | high | critical`, default `medium`, en tickets y plantillas.

## Sin conexión

`src/lib/outbox.ts`: escaneos, notas e incidencias rápidas que fallan por red quedan
en `localStorage` (`lux_outbox`). Se reintentan con backoff exponencial, al volver
`online` y al volver a la pestaña. Cada envío lleva un `clientId`: el servidor
devuelve el registro ya creado en vez de duplicarlo. Un rechazo del servidor no se
reintenta: pasa a `lux_outbox_failed` y se muestra en la barra superior. No hay
service worker propio (PWA y offline completo quedan para otro issue).

## Fuera de alcance

- Fotos como evidencia (requiere almacenamiento de archivos).
- PWA instalable / offline completo.
- Uso de las plantillas por Ether.
