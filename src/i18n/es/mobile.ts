// Vista telefono (#98): escaneo QR, notas, incidencia rapida, tickets y prestamos;
// plantillas de incidencia; y textos compartidos que esas pantallas estrenan
export const mobile = {
  // Prioridad de los tickets y estados de las plantillas
  "label.priority": "Prioridad",
  "status.priority.low": "Baja",
  "status.priority.medium": "Media",
  "status.priority.high": "Alta",
  "status.priority.critical": "Crítica",
  "status.template.draft": "Borrador",
  "status.template.testing": "En prueba",
  "status.template.approved": "Aprobada",
  "status.template.retired": "Retirada",
  "nav.incidentTemplates": "Plantillas de incidencia",

  // Lector QR
  "ui.qr.manualLabel": "ID del equipo",
  "ui.qr.manualPlaceholder": "L1-PC3",
  "ui.qr.manualSubmit": "Buscar",
  "ui.qr.problem.denied":
    "No tenemos permiso para usar la cámara. Habilitala en los ajustes del navegador o escribí el ID del equipo.",
  "ui.qr.problem.unavailable": "No se pudo abrir la cámara. Escribí el ID del equipo.",
  "ui.qr.problem.insecure":
    "La cámara solo funciona en una conexión segura (HTTPS). Escribí el ID del equipo.",

  // Estructura de la vista telefono
  "mobile.home": "Inicio",
  "mobile.tab.tickets": "Tickets",
  "mobile.tab.scan": "Escanear",
  "mobile.tab.loan": "Préstamo",
  "mobile.offline":
    "Sin conexión. Lo que hagas se guarda en el teléfono y se envía al volver la conexión.",
  "mobile.locked": "Solo para el personal del área",
  "mobile.outbox.pendingLabel":
    "{count} operación pendiente de enviar | {count} operaciones pendientes de enviar",
  "mobile.outbox.retry": "Reintentar el envío",
  "mobile.outbox.failed":
    "{count} operación fue rechazada por el servidor y no se envió. | {count} operaciones fueron rechazadas por el servidor y no se enviaron.",
  "mobile.outbox.discard": "Descartar",

  // Inicio
  "mobile.home.greeting": "Hola, {name}",
  "mobile.home.subtitle": "¿Qué necesitás hacer?",
  "mobile.home.scanInventory": "Escanear en inventario",
  "mobile.home.scanInventoryHelp": "Ficha, notas y bajas",
  "mobile.home.scanIncident": "Escanear para una incidencia",
  "mobile.home.scanIncidentHelp": "Adjuntar el equipo a un ticket",
  "mobile.home.quickIncident": "Incidencia rápida",
  "mobile.home.quickIncidentHelp": "Crear un ticket desde una plantilla",
  "mobile.home.tickets": "Tickets",
  "mobile.home.ticketsHelp": "Ver el estado",
  "mobile.home.scanLoan": "Pedir un préstamo",
  "mobile.home.scanLoanHelp": "Escaneá el equipo o elegilo de la lista",

  // Escaneo
  "mobile.context.inventory": "Inventario",
  "mobile.context.incident": "Incidencia",
  "mobile.context.loan": "Préstamo",
  "mobile.scan.title": "Escanear QR",
  "mobile.scan.subtitle": "Apuntá la cámara al código del equipo o escribí su ID.",
  "mobile.scan.contextLabel": "Para qué escaneás",
  "mobile.scan.attachingTo": "Vas a adjuntar el equipo al ticket {id}.",
  "mobile.scan.useLoan": "Escanear para un préstamo",
  "mobile.scan.failed": "No se pudo registrar el escaneo",
  "mobile.scan.looking": "Buscando {id}...",
  "mobile.scan.queued":
    "Sin conexión: el escaneo quedó guardado y se registrará al volver la conexión.",
  "mobile.scan.again": "Escanear otro",
  "mobile.scan.notFound": "No hay ningún equipo con ese ID.",

  // Resultado en inventario
  "mobile.inventory.unknown": "Ese ID no está en el inventario.",
  "mobile.inventory.register": "Dar de alta con este ID",
  "mobile.inventory.retire": "Dar de baja el equipo",
  "mobile.inventory.retired": "El equipo se dio de baja.",
  "mobile.inventory.reason": "Motivo de la baja",
  "mobile.inventory.reasonPlaceholder": "Por ejemplo: sin reparación posible",
  "mobile.inventory.reasonShort": "Escribí el motivo de la baja (mínimo {min} caracteres).",

  // Notas privadas
  "mobile.notes.title": "Mis notas",
  "mobile.notes.add": "Nueva nota",
  "mobile.notes.private": "Solo las ves vos.",
  "mobile.notes.empty": "Todavía no hay notas de este equipo.",
  "mobile.notes.label": "Nota",
  "mobile.notes.placeholder": "Escribí una nota...",
  "mobile.notes.delete": "Eliminar nota",
  "mobile.notes.saving": "Guardando...",
  "mobile.notes.saved": "Guardado",
  "mobile.notes.queued": "Guardada en el teléfono; se envía al volver la conexión",
  "mobile.notes.saveFailed": "No se pudo guardar la nota",
  "mobile.notes.deleteFailed": "No se pudo eliminar la nota",

  // Incidencia
  "mobile.incident.title": "Incidencia rápida",
  "mobile.incident.subtitle": "Elegí una plantilla y ajustá lo que haga falta.",
  "mobile.incident.quick": "Incidencia rápida con este equipo",
  "mobile.incident.attachExisting": "Adjuntar a un ticket existente",
  "mobile.incident.attachTo": "Adjuntar al ticket {id}",
  "mobile.incident.attached": "El equipo quedó adjunto al ticket {id}.",
  "mobile.incident.attachFailed": "No se pudo adjuntar el equipo",
  "mobile.incident.pickTicket": "Elegí el ticket",
  "mobile.incident.noCandidates": "No hay tickets abiertos sin equipo.",
  "mobile.incident.viewTicket": "Ver el ticket",
  "mobile.incident.created": "Se creó el ticket {id}.",
  "mobile.incident.queued":
    "Sin conexión: la incidencia quedó guardada y se crea al volver la conexión.",
  "mobile.incident.change": "Cambiar",
  "mobile.incident.scanEquipment": "Escanear el equipo",
  "mobile.incident.templates": "Plantilla",
  "mobile.incident.noTemplate": "Sin plantilla",
  "mobile.incident.noTemplates": "Todavía no hay plantillas disponibles.",
  "mobile.incident.location": "Ubicación del incidente",
  "mobile.incident.locationHelp": "Es la del equipo. Cambiala solo si lo movieron.",
  "mobile.incident.locationMoved": "Vas a registrar una ubicación distinta a la del equipo.",

  // Tickets
  "mobile.tickets.title": "Tickets",
  "mobile.tickets.subtitleStaff": "Los que tenés asignados y los que esperan técnico",
  "mobile.tickets.subtitleRequester": "El estado de tus tickets",
  "mobile.tickets.view": "Vista",
  "mobile.tickets.mine": "Asignados a mí",
  "mobile.tickets.unassigned": "Sin asignar",
  "mobile.tickets.back": "Tickets",
  "mobile.tickets.updated": "Actualizado",
  "mobile.tickets.attachEquipment": "Adjuntar equipo",

  // Préstamo
  "mobile.loan.title": "Pedir un préstamo",
  "mobile.loan.subtitle": "Escaneá el equipo o elegilo de la lista.",
  "mobile.loan.scan": "Escanear el equipo",
  "mobile.loan.done": "Pedido enviado. El área lo va a revisar.",

  // Plantillas de incidencia (escritorio)
  "templates.title": "Plantillas de incidencia",
  "templates.subtitleAdmin": "Revisá, aprobá o retirá las plantillas que usan los técnicos.",
  "templates.subtitleTech":
    "Creá plantillas para incidencias frecuentes y probalas desde el teléfono. El administrador las aprueba.",
  "templates.new": "Nueva plantilla",
  "templates.edit": "Editar plantilla",
  "templates.empty": "No hay plantillas.",
  "templates.author": "Autor",
  "templates.updated": "Actualizada",
  "templates.actions": "Acciones",
  "templates.submit": "Enviar a prueba",
  "templates.approve": "Aprobar",
  "templates.reject": "Rechazar",
  "templates.retire": "Retirar",
  "templates.formHelp": "Estos datos se precargan al crear una incidencia rápida.",
  "templates.name": "Nombre de la plantilla",
  "templates.namePlaceholder": "Por ejemplo: Monitor sin imagen",
  "templates.ticketTitle": "Título del ticket",
  "templates.ticketDescription": "Descripción del ticket",
  "templates.actionFailed": "No se pudo completar la acción",
  "templates.saveFailed": "No se pudo guardar la plantilla",
  "templates.reason": "Motivo",
  "templates.reasonShort": "Escribí el motivo (mínimo {min} caracteres).",
  "templates.rejectTitle": "Rechazar plantilla",
  "templates.rejectHelp": "«{name}» vuelve a borrador. Indicá qué tiene que corregir su autor.",
  "templates.retireTitle": "Retirar plantilla",
  "templates.retireHelp": "«{name}» deja de ofrecerse en la incidencia rápida.",
};
