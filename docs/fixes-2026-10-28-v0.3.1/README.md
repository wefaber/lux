# Fixes 2026-10-28 v0.3.1: auditoría QA y feedback

Origen: auditoría QA de Lux sobre `dev @ 3feaab5` (v0.3.1, 15 hallazgos) más el feedback de Faku del mismo día (UI, UX mobile, usuarios, branding, roadmap).
Seguimiento: project [Lux Roadmap](https://github.com/orgs/wefaber/projects/13). Labels de origen: `auditoria-qa` y `roadmap`.

Leyenda: `[ ]` pendiente · `[~]` parcial · `[x]` hecho y verificado.

## Auditoría QA

- [ ] **01. Técnico ejecuta operaciones de admin.** Se acepta como comportamiento correcto. Pendiente: actualizar `RBAC-Roles.md §2` (vault de eternum) para que la matriz diga lo mismo. Sin issue.
- [ ] **02. 2FA.** Login con app autenticadora y recuperación de cuenta; step-up para acciones sensibles. #76
- [ ] **02. Promoción a admin.** Exige 2FA y queda pendiente durante un período de espera, cancelable por root_admin. Bloqueado por #76. #77
- [ ] **03. Aprobación de préstamos.** Nadie aprueba su propio pedido; doble confirmación y validación de un técnico. #78
- [ ] **04. Bajas lógicas de datos históricos.** Solo root_admin (`canRetire`). #79
- [ ] **05. Sesión vencida.** Evento global ante `UNAUTHENTICATED` y vuelta al login con animación de salida. #80
- [ ] **06. Errores del login.** Mensaje distinto por causa: credenciales, bloqueo, red, 5xx, mocks, 2FA. #81
- [ ] **07. Zona horaria.** Fechas con la zona de la institución (`America/Montevideo`), no la del host. #82
- [ ] **08. Workflow de QA.** Que corra tras cada deploy a dev; arreglar CP-26-01, CP-26-02 y CP-05-02. #83
- [ ] **09. Alto contraste.** Redefinir los tokens de texto, no solo `--border`. #84
- [ ] **10. Flash de tema claro.** Script inline en `index.html` antes del primer paint. #85
- [ ] **11. Contraste de la paleta.** Test en CI con umbrales WCAG y corrección de tokens y badges. #86
- [ ] **12. Cabeceras de seguridad.** CSP, X-Frame-Options y HSTS en el frontend, verificadas con `curl -I` en dev y producción. #87
- [ ] **13. Validación de la API.** Validar usuarios, tickets, solicitudes y componentes; auditoría de vulnerabilidades; revisar CORS. #88
- [ ] **14. Bloqueo del login.** Bloqueo por usuario y `TRUST_PROXY` en el despliegue. #89
- [ ] **15. Filtros en pantallas chicas.** Variantes de layout o scroll a 360 px con fuente XL. #90

## Otros

- [ ] **Credenciales en dev.** dev.eternum.lat no muestra las credenciales de prueba: el build con API real las deja fuera. #91
- [ ] **Branding.** Nuevo logo Lux desde el CDN, en un único `<LuxLogo>`. Bloqueado hasta que los assets estén en el CDN. #92

## UI

- [ ] **Onboarding y diálogos.** Overlay según el tema y animación de salida al completar o saltar. #93
- [ ] **Sidebar.** El logo y los iconos no se mueven ni cambian de tamaño al colapsar. #94
- [ ] **Ayuda.** Acordeones animados al abrir y cerrar; carga en cascada con fade-in. #95
- [ ] **Carga de datos.** Transición suave de skeleton a valores; números tabulares. #96
- [ ] **Cambio de idioma.** Actualizar los textos sin remontar la app. #97

## UX

- [ ] **Mobile, uso 1.** Escaneo QR con sesión, notas rápidas sobre el equipo, incidencia rápida por template (técnicos). #98
- [ ] **Mobile, uso 2.** Incidencias y preparación de salones con checklist por sala; verificar estado de laboratorios y salones. #99

## Usuarios

- [ ] **Docente.** Rol o capacidad para reservar salones y laboratorios y asociar alumno y docente en una incidencia. Decisión abierta en el issue. #100

## Roadmap

- [ ] **Ask Ether.** Resúmenes de estado, funcionalidades, salud del sistema y pendientes. #101
- [ ] **Code Mode.** Tareas con agentes de IA. #102
- [ ] **Export masivo.** Export de datos y extrapolación por períodos. #103
- [ ] **ETA.** Previsión de tareas complejas según tiempos previos. #104
- [ ] **Asistencia personalizada.** Gestión de tickets según el historial del usuario. #105
- [ ] **Lux desktop (Tauri).** Logs de equipos con acceso directo a Windows. #106

## Deuda

- [ ] **React Doctor.** 59 hallazgos acumulados en `dev`: triage y corrección de los errores del Compiler primero. #107

## Sesiones

Una sesión (Sonnet) por grupo. Cada grupo es una rama con su PR a `dev`. Los grupos no comparten archivos, así que pueden correr en paralelo.

1. **Login y sesión:** #80, #81, #91.
2. **Tokens y tema:** #84, #86, #85.
3. **Diálogos, Ayuda y skeleton:** #93, #95, #96. Tocan archivos distintos, así que pueden ser tres sesiones.
4. **Sidebar y branding:** #94, #92. Arranca cuando los assets estén en el CDN.
5. **i18n:** #97.
6. **Préstamos y bajas (API):** #78, #79.
7. **Seguridad de auth:** #76, luego #77, luego #89.
8. **Endurecimiento de la API:** #88, #82.
9. **Infra y QA:** #87, #83.
10. **Responsive:** #90.

Largo plazo, cada uno con su sesión de diseño: #98, #99, #100, #101 a #106, #107.

## Notas

- `lux.eternum.lat` sirve `main`, que va 182 commits atrás de `dev`. #87 se verifica en producción solo después de promover `dev` a `main`.
