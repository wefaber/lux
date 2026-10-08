-- Fixes aplicados sobre el original:
-- 1. CHECK de longitud: comparaban VARCHAR contra INTEGER (ej. "nombre >= 3"),
--    ahora usan LENGTH(). El original rompía la coercion implicita de MariaDB
--    (ej. 'Oficina Central' se convertia en 0, y 0 >= 3 es falso).
-- 2. equipo.estado / equipo.fallas (JSON) normalizados: "condicion" como
--    columna con CHECK, "fallas" pasa a tabla propia.

CREATE DATABASE IF NOT EXISTS lux;
USE lux;

CREATE TABLE IF NOT EXISTS ubicacion (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    nombre VARCHAR(200) UNIQUE,
    -- 1 a 3 letras: arranca el ID de maquina de sus equipos (L1-PC3)
    codigo VARCHAR(3) NOT NULL UNIQUE,
    -- Baja logica: no se borra para no perder el historial de sus equipos
    fecha_baja DATETIME,
    CHECK (nombre IS NOT NULL AND nombre <> ''),
    CHECK (LENGTH(nombre) BETWEEN 3 AND 200),
    CHECK (codigo REGEXP '^[A-Z]{1,3}$')
);

CREATE TABLE IF NOT EXISTS producto (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    modelo VARCHAR(1000),
    fabricante VARCHAR(1000),
    tipo VARCHAR(100),
    nro_parte VARCHAR(1000) UNIQUE,
    CHECK (modelo IS NOT NULL AND modelo <> ''),
    CHECK (fabricante IS NOT NULL AND fabricante <> '')
);

CREATE TABLE IF NOT EXISTS persona (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    dni VARCHAR(50) UNIQUE,
    nombre VARCHAR(100),
    apellido VARCHAR(100),
    email VARCHAR(500) NOT NULL UNIQUE,
    email_backup VARCHAR(500) UNIQUE,
    telefono VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS usuario (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    persona_id VARCHAR(100) UNIQUE,
    password_hash VARCHAR(2000),
    rol VARCHAR(100),
    fecha_baja DATE,
    activo BOOLEAN,
    CONSTRAINT fk_usuario_persona_id FOREIGN KEY (persona_id) REFERENCES persona(id),
    CHECK (rol IN ('admin', 'tecnico', 'solicitante') OR rol IS NULL),
    CHECK (activo IN (0, 1) OR activo IS NULL)
);

CREATE TABLE IF NOT EXISTS equipo (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    producto_id VARCHAR(100),
    nro_serie VARCHAR(1000),
    condicion VARCHAR(50) NOT NULL DEFAULT 'operativo',
    en_prestamo BOOLEAN,
    ubicacion_id VARCHAR(100),
    CONSTRAINT fk_equipo_producto_id FOREIGN KEY (producto_id) REFERENCES producto(id),
    CONSTRAINT fk_equipo_ubicacion_id FOREIGN KEY (ubicacion_id) REFERENCES ubicacion(id),
    CHECK (condicion IN ('operativo', 'en_reparacion', 'de_baja', 'en_revision')),
    CHECK (en_prestamo IN (0, 1) OR en_prestamo IS NULL)
);

CREATE TABLE IF NOT EXISTS falla (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    equipo_id VARCHAR(100),
    tipo VARCHAR(100),
    descripcion VARCHAR(1000),
    fecha_reporte DATE,
    resuelta BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_falla_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CHECK (resuelta IN (0, 1) OR resuelta IS NULL)
);

CREATE TABLE IF NOT EXISTS ticket (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    solicitante_id VARCHAR(100),
    equipo_id VARCHAR(100),
    ubicacion_id VARCHAR(100),
    titulo VARCHAR(200),
    fecha_creacion DATE,
    prioridad VARCHAR(100),
    estado VARCHAR(100),
    descripcion VARCHAR(2000),
    categoria VARCHAR(100),
    CONSTRAINT fk_ticket_solicitante_id FOREIGN KEY (solicitante_id) REFERENCES persona(id),
    CONSTRAINT fk_ticket_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CONSTRAINT fk_ticket_ubicacion_id FOREIGN KEY (ubicacion_id) REFERENCES ubicacion(id),
    CHECK (prioridad IN ('baja', 'media', 'alta') OR prioridad IS NULL),
    CHECK (estado IN ('abierto', 'en_proceso', 'cerrado') OR estado IS NULL),
    CHECK (categoria IN ('hardware', 'software', 'red', 'otro') OR categoria IS NULL),
    CHECK (titulo IS NOT NULL AND titulo <> ''),
    CHECK (descripcion IS NOT NULL AND descripcion <> '' AND LENGTH(descripcion) <= 2000)
);

CREATE TABLE IF NOT EXISTS prestamo (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    solicitante_id VARCHAR(100),
    equipo_id VARCHAR(100),
    expedido_por_id VARCHAR(100),
    expedido BOOLEAN,
    fecha_entrega DATE,
    fecha_devolucion_pactada DATE,
    fecha_dev_real DATE,
    CONSTRAINT fk_prestamo_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CONSTRAINT fk_prestamo_solicitante_id FOREIGN KEY (solicitante_id) REFERENCES persona(id),
    CONSTRAINT fk_prestamo_expedido_por_id FOREIGN KEY (expedido_por_id) REFERENCES persona(id),
    CHECK (expedido IN (0, 1) OR expedido IS NULL),
    CHECK (fecha_dev_real IS NULL OR fecha_dev_real >= fecha_entrega)
);

CREATE TABLE IF NOT EXISTS asignacion (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    equipo_id VARCHAR(100),
    persona_id VARCHAR(100),
    fecha_desde DATE,
    fecha_hasta DATE,
    motivo VARCHAR(1000),
    CONSTRAINT fk_asignacion_persona_id FOREIGN KEY (persona_id) REFERENCES persona(id),
    CONSTRAINT fk_asignacion_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CHECK (fecha_desde IS NOT NULL),
    CHECK (fecha_hasta IS NULL OR fecha_hasta >= fecha_desde),
    CHECK (motivo IS NOT NULL AND motivo <> '' AND LENGTH(motivo) <= 1000)
);

CREATE TABLE IF NOT EXISTS asignacion_tecnica (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    ticket_id VARCHAR(100),
    tecnico_id VARCHAR(100),
    fecha_planificada DATE,
    fecha_asignacion DATE,
    activa BOOLEAN,
    estado_ejecucion VARCHAR(100),
    motivo_reasignacion VARCHAR(1000),
    CONSTRAINT fk_asigtec_tecnico_id FOREIGN KEY (tecnico_id) REFERENCES persona(id),
    CONSTRAINT fk_asigtec_ticket_id FOREIGN KEY (ticket_id) REFERENCES ticket(id),
    CHECK (activa IN (0, 1) OR activa IS NULL),
    CHECK (estado_ejecucion IN ('pendiente', 'en_proceso', 'finalizado') OR estado_ejecucion IS NULL),
    CHECK (motivo_reasignacion IS NULL OR (motivo_reasignacion <> '' AND LENGTH(motivo_reasignacion) <= 1000))
);

CREATE TABLE IF NOT EXISTS nota_tecnica (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    equipo_id VARCHAR(100),
    tecnico_id VARCHAR(100),
    ticket_id VARCHAR(100),
    contenido VARCHAR(1000),
    timestamp DATETIME,
    CONSTRAINT fk_nota_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CONSTRAINT fk_nota_tecnico_id FOREIGN KEY (tecnico_id) REFERENCES persona(id),
    CONSTRAINT fk_nota_ticket_id FOREIGN KEY (ticket_id) REFERENCES ticket(id),
    CHECK (contenido IS NOT NULL AND contenido <> '' AND LENGTH(contenido) <= 1000),
    CHECK (timestamp IS NOT NULL)
);

-- Reserva de un equipo o de un espacio (ubicacion) por un rango de fechas.
-- Ciclo: pendiente -> aprobada | rechazada -> en_curso -> finalizada | cancelada.
-- Dos reservas aprobadas o en curso del mismo recurso no se superponen (lo
-- controla la aplicacion al crear, aprobar y modificar).
CREATE TABLE IF NOT EXISTS reserva (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    tipo_recurso VARCHAR(20) NOT NULL,
    equipo_id VARCHAR(100),
    ubicacion_id VARCHAR(100),
    usuario_id VARCHAR(100) NOT NULL,
    motivo VARCHAR(300) NOT NULL,
    fecha_inicio DATETIME NOT NULL,
    fecha_fin DATETIME NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    revisada_por VARCHAR(100),
    motivo_rechazo VARCHAR(500),
    cancelada_por VARCHAR(100),
    fecha_creacion DATETIME NOT NULL,
    CONSTRAINT fk_reserva_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CONSTRAINT fk_reserva_ubicacion_id FOREIGN KEY (ubicacion_id) REFERENCES ubicacion(id),
    CONSTRAINT fk_reserva_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario(id),
    CONSTRAINT fk_reserva_revisada_por FOREIGN KEY (revisada_por) REFERENCES usuario(id),
    CONSTRAINT fk_reserva_cancelada_por FOREIGN KEY (cancelada_por) REFERENCES usuario(id),
    CHECK (tipo_recurso IN ('equipo', 'espacio')),
    -- Exactamente un recurso, segun el tipo
    CHECK ((tipo_recurso = 'equipo' AND equipo_id IS NOT NULL AND ubicacion_id IS NULL)
        OR (tipo_recurso = 'espacio' AND ubicacion_id IS NOT NULL AND equipo_id IS NULL)),
    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'en_curso', 'finalizada', 'cancelada')),
    CHECK (fecha_fin > fecha_inicio),
    CHECK (estado <> 'rechazada' OR motivo_rechazo IS NOT NULL)
);
CREATE INDEX idx_reserva_equipo ON reserva (equipo_id, fecha_inicio, fecha_fin);
CREATE INDEX idx_reserva_ubicacion ON reserva (ubicacion_id, fecha_inicio, fecha_fin);

-- Hilo de un ticket o solicitud de servicio. entidad_id apunta a ticket o a
-- solicitud_servicio segun entidad_tipo, por eso no lleva clave foranea.
CREATE TABLE IF NOT EXISTS comentario (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    entidad_tipo VARCHAR(50) NOT NULL,
    entidad_id VARCHAR(100) NOT NULL,
    autor_id VARCHAR(100) NOT NULL,
    cuerpo VARCHAR(1000) NOT NULL,
    fecha_creacion DATETIME NOT NULL,
    CONSTRAINT fk_comentario_autor_id FOREIGN KEY (autor_id) REFERENCES usuario(id),
    CHECK (entidad_tipo IN ('ticket', 'solicitud_servicio')),
    CHECK (cuerpo <> '' AND LENGTH(cuerpo) <= 1000)
);
CREATE INDEX idx_comentario_entidad ON comentario (entidad_tipo, entidad_id, fecha_creacion);

-- Trabajo hecho sobre un equipo (mantenimiento, limpieza, cambio de piezas...).
-- ticket_id es opcional: solo si la intervencion surgio de un ticket.
CREATE TABLE IF NOT EXISTS intervencion (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    equipo_id VARCHAR(100) NOT NULL,
    tecnico_id VARCHAR(100) NOT NULL,
    ticket_id VARCHAR(100),
    tipo VARCHAR(50) NOT NULL,
    descripcion VARCHAR(1000) NOT NULL,
    piezas_reemplazadas VARCHAR(300),
    fecha_realizacion DATETIME NOT NULL,
    fecha_registro DATETIME NOT NULL,
    CONSTRAINT fk_intervencion_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CONSTRAINT fk_intervencion_tecnico_id FOREIGN KEY (tecnico_id) REFERENCES usuario(id),
    CONSTRAINT fk_intervencion_ticket_id FOREIGN KEY (ticket_id) REFERENCES ticket(id),
    CHECK (tipo IN ('mantenimiento_preventivo', 'reparacion', 'cambio_componente', 'limpieza', 'actualizacion_software', 'otra')),
    CHECK (LENGTH(descripcion) BETWEEN 10 AND 1000)
);

CREATE TABLE IF NOT EXISTS solicitud_servicio (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    solicitante_id VARCHAR(100),
    descripcion VARCHAR(200),
    fecha_requerida DATE,
    tipo VARCHAR(100),
    estado VARCHAR(100),
    CONSTRAINT fk_solserv_solicitante_id FOREIGN KEY (solicitante_id) REFERENCES persona(id),
    CHECK (tipo IN ('mantenimiento', 'instalacion', 'reparacion', 'otro') OR tipo IS NULL),
    CHECK (estado IN ('pendiente', 'en_proceso', 'completado', 'cancelado') OR estado IS NULL),
    CHECK (descripcion IS NOT NULL AND descripcion <> '' AND LENGTH(descripcion) <= 200)
);

CREATE TABLE IF NOT EXISTS solicitud_detalle (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    solicitud_id VARCHAR(100),
    ubicacion_id VARCHAR(100),
    equipo_id VARCHAR(100),
    software JSON,
    especificacion VARCHAR(1000),
    CONSTRAINT fk_detalle_solicitud_id FOREIGN KEY (solicitud_id) REFERENCES solicitud_servicio(id),
    CONSTRAINT fk_detalle_ubicacion_id FOREIGN KEY (ubicacion_id) REFERENCES ubicacion(id),
    CONSTRAINT fk_detalle_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CHECK (especificacion IS NOT NULL AND especificacion <> '' AND LENGTH(especificacion) <= 1000)
);

CREATE TABLE IF NOT EXISTS asignacion_solicitud (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    solicitud_id VARCHAR(100),
    tecnico_id VARCHAR(100),
    fecha_planificada DATE,
    observaciones VARCHAR(1000),
    CONSTRAINT fk_asigsol_solicitud_id FOREIGN KEY (solicitud_id) REFERENCES solicitud_servicio(id),
    CONSTRAINT fk_asigsol_tecnico_id FOREIGN KEY (tecnico_id) REFERENCES persona(id),
    CHECK (observaciones IS NULL OR (observaciones <> '' AND LENGTH(observaciones) <= 1000))
);

CREATE TABLE IF NOT EXISTS solicitud_recurso_fisico (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    solicitud_id VARCHAR(100),
    equipo_id VARCHAR(100),
    observacion VARCHAR(2000),
    CONSTRAINT fk_recfisico_solicitud_id FOREIGN KEY (solicitud_id) REFERENCES solicitud_servicio(id),
    CONSTRAINT fk_recfisico_equipo_id FOREIGN KEY (equipo_id) REFERENCES equipo(id),
    CHECK (observacion IS NOT NULL AND observacion <> '' AND LENGTH(observacion) <= 2000)
);

CREATE TABLE IF NOT EXISTS solicitud_recurso_logico (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    solicitud_id VARCHAR(100),
    descripcion VARCHAR(2000),
    CONSTRAINT fk_reclogico_solicitud_id FOREIGN KEY (solicitud_id) REFERENCES solicitud_servicio(id),
    CHECK (descripcion IS NOT NULL AND descripcion <> '' AND LENGTH(descripcion) <= 2000)
);

-- entidad_id es una referencia polimorfica (Ticket, Equipo, Prestamo, etc.
-- segun el valor de "entidad"), por eso no lleva FK real.
CREATE TABLE IF NOT EXISTS log_auditoria (
    id VARCHAR(100) PRIMARY KEY NOT NULL,
    entidad VARCHAR(100),
    entidad_id VARCHAR(100),
    accion VARCHAR(100),
    datos_json JSON,
    usuario_id VARCHAR(100),
    timestamp DATETIME,
    CONSTRAINT fk_log_usuario_id FOREIGN KEY (usuario_id) REFERENCES usuario(id),
    CHECK (timestamp IS NOT NULL)
);

--- Inserts

INSERT INTO ubicacion (id, nombre, codigo) VALUES
('1', 'Oficina Central', 'OC'),
('2', 'Sucursal Norte', 'SN'),
('3', 'Sucursal Sur', 'SS');

INSERT INTO producto (id, modelo, fabricante, tipo, nro_parte) VALUES
('1', 'Laptop Pro 15', 'TechCorp', 'Laptop', 'TC-LP15-001'),
('2', 'Desktop Elite', 'CompuWorks', 'Desktop', 'CW-DE-002'),
('3', 'Router X2000', 'NetGear', 'Networking', 'NG-RX2000-003');

INSERT INTO persona (id, dni, nombre, apellido, email, email_backup, telefono) VALUES
('1', '12345678', 'Juan', 'Perez', 'juan.perez@company.com', 'juan.perez.backup@company.com', '123-456-7890'),
('2', '87654321', 'Maria', 'Gomez', 'maria.gomez@company.com', 'maria.gomez.backup@company.com', '098-765-4321');

INSERT INTO usuario (id, persona_id, password_hash, rol, fecha_baja, activo) VALUES
('1', '1', 'hashed_password_juan', 'admin', NULL, 1),
('2', '2', 'hashed_password_maria', 'tecnico', NULL, 1);

INSERT INTO equipo (id, producto_id, nro_serie, condicion, en_prestamo, ubicacion_id) VALUES
('1', '1', 'SN1234567890', 'operativo', 0, '1'),
('2', '2', 'SN0987654321', 'en_reparacion', 0, '2');

INSERT INTO falla (id, equipo_id, tipo, descripcion, fecha_reporte, resuelta) VALUES
('1', '2', 'hardware', 'Problema de hardware', '2024-06-02', 0);

INSERT INTO ticket (id, solicitante_id, equipo_id, ubicacion_id, titulo, fecha_creacion, prioridad, estado, descripcion, categoria) VALUES
('1', '1', '1', '1', 'Problema con la laptop', '2024-06-01', 'alta', 'abierto', 'La laptop no enciende.', 'hardware'),
('2', '2', '2', '2', 'Falla en el escritorio', '2024-06-02', 'media', 'en_proceso', 'El escritorio tiene problemas de rendimiento.', 'software');

INSERT INTO prestamo (id, solicitante_id, equipo_id, expedido_por_id, expedido, fecha_entrega, fecha_devolucion_pactada, fecha_dev_real) VALUES
('1', '1', '1', '2', 1, '2024-06-03', '2024-06-10', NULL),
('2', '2', '2', '1', 0, NULL, NULL, NULL);

INSERT INTO asignacion (id, equipo_id, persona_id, fecha_desde, fecha_hasta, motivo) VALUES
('1', '1', '1', '2024-06-01', NULL, 'Asignación inicial del equipo.'),
('2', '2', '2', '2024-06-02', NULL, 'Asignación para mantenimiento.');

INSERT INTO asignacion_tecnica (id, ticket_id, tecnico_id, fecha_planificada, fecha_asignacion, activa, estado_ejecucion, motivo_reasignacion) VALUES
('1', '1', '2', '2024-06-04', '2024-06-03', 1, 'pendiente', NULL),
('2', '2', '1', '2024-06-05', '2024-06-04', 1, 'en_proceso', NULL);

INSERT INTO nota_tecnica (id, equipo_id, tecnico_id, ticket_id, contenido, timestamp) VALUES
('1', '1', '2', '1', 'Se realizó diagnóstico inicial del equipo.', '2024-06-04 10:00:00'),
('2', '2', '1', '2', 'Se identificó un problema de software que requiere actualización.', '2024-06-05 11:30:00');

INSERT INTO solicitud_servicio (id, solicitante_id, descripcion, fecha_requerida, tipo, estado) VALUES
('1', '1', 'Solicitud de mantenimiento para la laptop.', '2024-06-15', 'mantenimiento', 'pendiente'),
('2', '2', 'Solicitud de instalación de software en el escritorio.', '2024-06-20', 'instalacion', 'en_proceso');

INSERT INTO solicitud_detalle (id, solicitud_id, ubicacion_id, equipo_id, software, especificacion) VALUES
('1', '1', '1', '1', NULL, 'Mantenimiento preventivo del equipo.'),
('2', '2', '2', '2', '{"software": "Antivirus"}', 'Instalación de software de seguridad.');

INSERT INTO asignacion_solicitud (id, solicitud_id, tecnico_id, fecha_planificada, observaciones) VALUES
('1', '1', '2', '2024-06-16', 'Asignación para mantenimiento de la laptop.'),
('2', '2', '1', '2024-06-21', 'Asignación para instalación de software en el escritorio.');

INSERT INTO solicitud_recurso_fisico (id, solicitud_id, equipo_id, observacion) VALUES
('1', '1', '1', 'Se requiere el equipo para mantenimiento.'),
('2', '2', '2', 'Se requiere el equipo para instalación de software.');

INSERT INTO solicitud_recurso_logico (id, solicitud_id, descripcion) VALUES
('1', '1', 'Se requiere acceso a la red interna para realizar el mantenimiento.'),
('2', '2', 'Se requiere acceso a la cuenta de administrador para instalar el software.');

INSERT INTO log_auditoria (id, entidad, entidad_id, accion, datos_json, usuario_id, timestamp) VALUES
('1', 'ticket', '1', 'creacion', '{"titulo": "Problema con la laptop", "estado": "abierto"}', '1', '2024-06-01 09:00:00'),
('2', 'prestamo', '1', 'actualizacion', '{"expedido": true}', '2', '2024-06-03 14:30:00');