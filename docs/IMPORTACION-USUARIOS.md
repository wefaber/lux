# Importación de usuarios y estudiantes (CSV)

La gestión de usuarios permite dar de alta personas en lote y completar la ficha
de estudiante (grupo, turno y materias) desde un archivo CSV. No hace falta otra
herramienta: Excel abre y guarda CSV.

- Pantalla: **Administración → Usuarios → Importar CSV** (solo `admin` y
  `root_admin`).
- Plantilla: el botón **Descargar plantilla** genera el archivo con los
  encabezados y una fila de ejemplo.
- Código: `src/lib/csv.ts` (lectura y validación), `src/features/admin/UserImportDialog.tsx`
  (pantalla), mutación `importUsers` en `api/src/graphql/resolvers.ts` y en
  `src/mocks/handlers.ts`.

## Formato

CSV en UTF-8 separado por **punto y coma (`;`)**, que es lo que exporta Excel en
es-UY. El lector también acepta coma o tabulador si el encabezado los usa.

### Encabezados

```csv
nombre;documento;email;rol;grupo;turno;materias;activo;contrasena
```

| Columna | Obligatoria | Formato |
| --- | --- | --- |
| `nombre` | sí | Nombre completo, mínimo 2 caracteres |
| `documento` | sí | Cédula de 8 dígitos, sin puntos ni guión. Es el usuario de login |
| `email` | sí | Un email por persona; no se repite |
| `rol` | no | `solicitante` (por defecto), `tecnico` o `admin`. `root_admin` no se puede importar |
| `grupo` | no | Texto corto, hasta 20 caracteres (`1°B`, `2°A`, `3°C`) |
| `turno` | no | `matutino`, `vespertino` o `nocturno` |
| `materias` | no | Lista separada por `\|` (`Matemática\|Programación`). Hasta 20 materias de 60 caracteres |
| `activo` | no | `sí`/`no` (también `true`/`false`, `1`/`0`). Por defecto `sí` |
| `contrasena` | no | Mínimo 6 caracteres. Si falta en un alta, la clave inicial es el documento |

Los encabezados no distinguen mayúsculas ni tildes y aceptan alias habituales:
`cédula`/`cedula`/`dni` por `documento`, `correo` por `email`, `clave` por
`contrasena`, `materias`/`asignaturas` por `materias` y `estado` por `activo`.

### Ejemplo

```csv
nombre;documento;email;rol;grupo;turno;materias;activo;contrasena
Ana García;67890123;agarcia@iti.edu.uy;solicitante;1°B;matutino;Matemática|Programación;sí;
Carlos Suárez;78901234;csuarez@iti.edu.uy;solicitante;2°A;vespertino;Redes;sí;
Laura Martínez;89012345;lmartinez@iti.edu.uy;solicitante;3°C;nocturno;Base de Datos|Inglés Técnico;sí;
Jorge Méndez;23456789;jmendez@iti.edu.uy;admin;;;;sí;
```

Las materias que contienen `;` o comillas van entre comillas dobles (regla
estándar de CSV); conviene usar `|` como separador interno para no necesitarlas.

## Reglas de importación

1. **Fila por fila**: una fila inválida se informa en pantalla con su número y
   motivo, y no aborta el resto del archivo.
2. **Altas**: si el documento y el email no existen, se crea la persona. El rol
   por defecto es `solicitante`; los datos de estudiante solo se aceptan para
   ese rol.
3. **Actualizaciones**: si el documento **o** el email ya existen, no se crea un
   duplicado: se actualizan solo los datos de estudiante. No se cambia el rol,
   el documento, el email ni la contraseña de una persona existente.
4. **Celdas vacías en una actualización**: dejan el dato anterior como estaba.
   No se puede borrar un grupo o una materia con una celda vacía; eso se hace
   desde el formulario de edición.
5. **Duplicados en el archivo**: el segundo documento o email repetido se
   reporta como error (con la fila donde apareció primero).
6. **Personas que ya existen con otro rol** (por ejemplo un admin): se reportan
   como error para no cambiarle el rol ni mezclar datos de estudiante.
7. **Seguridad**: solo `admin` y `root_admin` pueden importar. Un `solicitante`
   no puede crear ni editar usuarios ni su propia ficha por la API.
8. **Auditoría**: cada importación deja una fila en el registro de actividad con
   el resumen (creados, actualizados y con error).

## Excel

No se agregan dependencias para leer `.xlsx`. El flujo es:

1. En Excel: **Archivo → Guardar como → CSV UTF-8 (delimitado por comas)**.
2. Si Excel guarda con comas, el lector las detecta; si usa punto y coma, también.
3. En la pantalla, elegir el `.csv` y revisar el resumen antes de confirmar.

Un archivo `.xlsx` se rechaza con el aviso de guardarlo como CSV.
