# Roles y permisos (RBAC)

Fuente de verdad: los resolvers de `api/src/graphql/resolvers.ts` (`requireRole`, `requireAuth`, `canReserve`) y `src/lib/roles.ts`. Esta tabla describe lo que el código hace hoy.

## Roles

Jerarquía: `root_admin` > `admin` > `tecnico` > `solicitante`.

- **Personal del área (staff):** `root_admin`, `admin`, `tecnico`.
- **Administradores:** `root_admin`, `admin`.
- **Docente:** no es un rol. Es el flag `isTeacher` sobre un `solicitante` (issue #100). Solo existe en solicitantes: la base lo exige (`users_teacher_role_check`) y al cambiar el rol de la persona el flag se baja solo. Se asigna desde Administración > Usuarios.

Por qué un flag y no un rol: el docente no se ubica en la jerarquía (no administra ni opera el área), solo habilita dos capacidades extra a un solicitante. Un flag no toca el enum de roles, ni los prefijos de ids, ni los permisos del resto del sistema.

## Matriz

`✓` puede. `propio` solo lo suyo. `—` no puede. Docente = solicitante con `isTeacher`.

| Capacidad                                                      | Admin | Técnico | Docente | Solicitante |
| -------------------------------------------------------------- | :---: | :-----: | :-----: | :---------: |
| Ver usuarios (nombre, rol)                                     |   ✓   |    ✓    | propio  |   propio    |
| Crear, editar, dar de baja e importar usuarios                 |   ✓   |    —    |    —    |      —      |
| Ver equipos, componentes y ubicaciones                         |   ✓   |    ✓    |    ✓    |      ✓      |
| Crear, editar y dar de baja equipos, componentes y ubicaciones |   ✓   |    ✓    |    —    |      —      |
| Crear una incidencia                                           |   ✓   |    ✓    |    ✓    |      ✓      |
| Ver incidencias                                                | todas |  todas  | propio  |   propio    |
| Gestionar incidencias (editar, estado, asignar, tomar)         |   ✓   |    ✓    |    —    |      —      |
| Pedir un préstamo                                              |   ✓   |    ✓    |    ✓    |      ✓      |
| Aprobar, rechazar, entregar y recibir préstamos                |   ✓   |    ✓    |    —    |      —      |
| Crear una solicitud de servicio                                |   ✓   |    ✓    |    ✓    |      ✓      |
| Gestionar solicitudes de servicio                              |   ✓   |    ✓    |    —    |      —      |
| **Crear una reserva (salón, laboratorio, equipo)**             |   ✓   |    ✓    |  **✓**  |    **—**    |
| Ver reservas                                                   | todas |  todas  | propio  |   propio    |
| Aprobar, rechazar y editar reservas                            |   ✓   |    ✓    |    —    |      —      |
| Cancelar una reserva                                           |   ✓   |    ✓    | propio  |   propio    |
| Ver horarios de clase y el docente a cargo                     |   ✓   |    ✓    |    —    |      —      |
| Crear, editar y borrar horarios de clase                       |   ✓   |    —    |    —    |      —      |
| Plantillas de incidencia (crear, usar)                         |   ✓   |    ✓    |    —    |      —      |
| Aprobar plantillas de incidencia                               |   ✓   |    —    |    —    |      —      |
| Reportes, registro de actividad y errores                      |   ✓   |    —    |    —    |      —      |

Una reserva ya existente de alguien que deja de ser docente se mantiene; solo se le impide crear nuevas.

## Reservas (#100)

Antes cualquier usuario autenticado podía reservar. Ahora `createReservation` exige `canReserve(user)`: personal del área o solicitante con `isTeacher`. Un solicitante común recibe `FORBIDDEN` ("Solo los docentes y el personal del área pueden hacer reservas") y la pantalla de reservas no le muestra el botón "Nueva reserva". Los mocks (`src/mocks`) aplican la misma regla.

## Horarios de clase y docente a cargo (#100)

Tabla `class_schedules`: lugar, docente, día de la semana (1 = lunes a 7 = domingo), franja `HH:MM`, materia y grupo opcionales. Reglas:

- El docente tiene que ser un usuario activo con `isTeacher`.
- Dos horarios del mismo lugar y día no pueden pisarse (el fin es exclusivo: una clase puede empezar cuando otra termina).
- No se le quita el flag a un docente que figura en algún horario: hay que reasignar antes.
- Los horarios se cargan en hora local de la institución (`INSTITUTION_TZ`, por defecto `America/Montevideo`).

Para asociar un alumno con el docente de una incidencia ocurrida en el salón X a la hora Y:

```graphql
{
  teacherInCharge(locationId: "loc-1", at: "2026-11-02T11:30:00.000Z") {
    teacher {
      id
      name
    }
    subject
    studentGroup
    startTime
    endTime
  }
}
```

Devuelve el horario cuyo día y franja cubren `at` (ISO; por defecto, ahora) o `null` si no había clase. Solo para personal del área. REST: `GET /locations/:id/teacher-in-charge?at=...`.

Operaciones nuevas: `classSchedules(locationId, teacherId)`, `teacherInCharge(locationId, at)`, `createClassSchedule`, `updateClassSchedule`, `deleteClassSchedule` (REST: `/class-schedules`).

## Fuera de este cambio

- Pantalla de administración de horarios de clase y mostrar el docente a cargo en el detalle de una incidencia (hoy solo por API).
- Los mocks (`bun dev` con MSW) no tienen los horarios de clase: son solo de la API real.
- Importación CSV de usuarios: no lee el flag docente; se marca desde el formulario.
