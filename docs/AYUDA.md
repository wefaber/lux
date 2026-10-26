# Lux: centro de ayuda configurable

La sección **Ayuda** (`/dashboard/help`) muestra preguntas frecuentes y los canales de contacto. El contenido **no está en el código**: se lee en tiempo de ejecución desde `public/config/help.json`. Un operador puede cambiarlo sin recompilar ni reiniciar nada.

## Cómo lo edita un operador

1. Editar `public/config/help.json` en el repositorio (o, en un sitio ya publicado, `dist/config/help.json` en el servidor).
2. Guardar. No hace falta `bun run build` si se edita el archivo publicado: es estático.
3. Recargar la página. La petición usa `cache: "no-cache"`, así el navegador revalida el archivo; si un proxy lo cachea, puede tardar hasta que expire su TTL.

La página tiene tres estados: cargando, contenido y error. Si el archivo falta, no es JSON válido o no cumple el esquema, muestra "No pudimos cargar la ayuda" con un botón para reintentar y el detalle técnico plegado. Nunca se rompe la aplicación.

## Esquema

```jsonc
{
  "contact": {
    "email": "soporte@iti.edu.uy",          // obligatorio, con formato de correo
    "schedule": { "es": "Lunes a viernes, de 9:00 a 17:00", "en": "Monday to Friday..." },
    "responseTime": { "es": "Respondemos en 24 horas hábiles", "en": "..." }
  },
  "guide": {                                 // opcional: enlace a una guía u onboarding
    "url": "/dashboard",                     // interno ("/...") o externo ("https://...")
    "label": { "es": "Empezar por el panel", "en": "Start at the dashboard" }
  },
  "categories": [                            // obligatorio, al menos una con preguntas
    {
      "id": "tickets",                       // tickets | loans | services | reservations | account
      "items": [
        {
          "id": "crear-ticket",              // opcional; si falta se genera "<categoria>-<n>"
          "question": { "es": "¿Cómo creo un ticket?", "en": "How do I create a ticket?" },
          "answer": { "es": "...", "en": "..." }
        }
      ]
    }
  ]
}
```

### Textos en uno o dos idiomas

Cada texto (`schedule`, `responseTime`, `label`, `question`, `answer`) acepta:

- un string: se usa en los dos idiomas, o
- un objeto `{ "es": "...", "en": "..." }`: el operador puede mantener una versión por idioma.

El español es obligatorio. Si falta el inglés, la interfaz en inglés muestra el español (nunca queda vacío). La interfaz (títulos, botones, etiquetas de categoría) sale de `src/i18n`; el contenido de las FAQ es dato y se muestra tal como lo escribió el operador.

### Categorías

Las categorías conocidas tienen etiqueta traducida en la interfaz y se muestran en el orden del JSON:

| id | Español | Inglés |
| --- | --- | --- |
| `tickets` | Tickets | Tickets and support |
| `loans` | Préstamos | Loans |
| `services` | Solicitudes | Service requests |
| `reservations` | Reservas | Reservations |
| `account` | Cuenta y accesibilidad | Account and accessibility |

Una categoría con otro `id` se muestra igual: usa su `label` del JSON o, si no tiene, el `id` tal cual. Así se puede sumar una categoría nueva sin tocar el código. El `id` solo puede tener letras, números, `-` y `_` (se usa como identificador del DOM); si no, la categoría se descarta con un warning.

El `guide.url` tiene que empezar con `/` (interno) o `http(s)://` (externo). Cualquier otro esquema se descarta por seguridad.

### Validación y tolerancia a errores

- **Falla toda la configuración** (`ok: false`) si no hay `contact.email` válido o si no queda ninguna categoría con al menos una pregunta usable. La página muestra el estado de error.
- **Se descarta solo lo inválido** (con un warning interno) si una categoría o una pregunta suelta está mal: por ejemplo una pregunta sin `answer` no se muestra, pero el resto de la página funciona.

Los tests de esta lógica están en `src/lib/help.test.ts` (archivo inválido, campos faltantes, correo inválido, categorías vacías, textos por idioma y filtro de búsqueda).

## Buscador y accesibilidad

- El buscador filtra por todas las palabras ingresadas, sin distinguir mayúsculas ni tildes ("prestamo" encuentra "préstamo"), sobre la pregunta y la respuesta del idioma activo.
- Mientras hay una búsqueda, las respuestas de las coincidencias se muestran abiertas; sin búsqueda, cada pregunta es un `<details>/<summary>` que se abre con teclado o clic.
- El estado vacío muestra la búsqueda, un botón para limpiarla y el correo de contacto.
- El enlace de correo es un `mailto:` al valor configurado, con asunto traducido.

## Por qué JSON estático y no GraphQL

Se eligió `public/config/help.json` porque:

- **Lo más simple**: no requiere tabla, mutación, permisos ni cambios en la API o en el mock de MSW.
- **Editable sin recompilar**: se cambia el archivo en el servidor y se recarga.
- **Funciona igual en desarrollo y producción**, con o sin backend real.
- **Sin riesgo de seguridad**: es contenido público de solo lectura; no hay datos de usuarios.

El costo: no hay historial de cambios ni edición desde la aplicación, y el archivo se sirve sin autenticación (cualquiera con la URL puede leerlo, igual que la página). Si más adelante se necesita editar desde el panel de administración, auditoría o contenido por rol, el paso natural es una query `helpCenter` en GraphQL respaldada por una tabla; el contrato `HelpConfig` de `src/lib/help.ts` se puede mantener y solo cambia de dónde se carga (`loadHelpConfig`).
