import type { CuInfo } from "./types";

// Correspondencia CU (UML-CasosDeUso.md, E2) -> RF (ERS IEEE 830 v1.2).
// Es la tabla que pidió Ingeniería en la devolución de E2: cada caso de uso
// referencia los requisitos donde se definió la funcionalidad.
export const CATALOG: CuInfo[] = [
  { id: "CU-01", name: "Iniciar sesión", actor: "Solicitante (y todos los humanos)", rf: ["RF-AUTH-001", "RF-AUTH-002", "RF-AUTH-006", "RF-AUTH-007"], status: "parcial", note: "Sin bloqueo por intentos fallidos (RF-AUTH-007)" },
  { id: "CU-02", name: "Cerrar sesión", actor: "Solicitante", rf: ["RF-AUTH-004"], status: "parcial", note: "Logout del lado del cliente; el JWT no se revoca en el servidor" },
  { id: "CU-03", name: "Reportar incidencia", actor: "Solicitante", rf: ["RF-TKT-001"], status: "parcial", note: "La API no valida extensión mínima ni referente (RN-04)" },
  { id: "CU-04", name: "Consultar mis pedidos", actor: "Solicitante", rf: ["RF-TKT-005", "RF-SERV-004", "RF-PRES-006"], status: "implementado" },
  { id: "CU-05", name: "Solicitar préstamo", actor: "Solicitante", rf: ["RF-PRES-001", "RF-PRES-002"], status: "implementado" },
  { id: "CU-06", name: "Solicitar servicio", actor: "Solicitante", rf: ["RF-SERV-001", "RF-SERV-002"], status: "implementado" },
  { id: "CU-07", name: "Consultar inventario", actor: "Solicitante", rf: ["RF-INV-005", "RF-INV-007", "RF-PRES-006"], status: "implementado" },
  { id: "CU-08", name: "Registrar equipo", actor: "Técnico", rf: ["RF-INV-001", "RF-INV-002"], status: "implementado" },
  { id: "CU-09", name: "Dar de baja equipo", actor: "Técnico", rf: ["RF-INV-003"], status: "implementado" },
  { id: "CU-10", name: "Registrar falla", actor: "Técnico", rf: ["RF-INV-004", "RF-MANT-002"], status: "parcial", note: "La falla se registra como intervención o como 'issues' del equipo" },
  { id: "CU-11", name: "Tomar incidencia", actor: "Técnico", rf: ["RF-TKT-002", "RF-TKT-006"], status: "implementado" },
  { id: "CU-12", name: "Diagnosticar incidencia", actor: "Técnico", rf: ["RF-TKT-004"], status: "implementado" },
  { id: "CU-13", name: "Resolver incidencia", actor: "Técnico", rf: ["RF-TKT-004"], status: "implementado" },
  { id: "CU-14", name: "Registrar nota técnica", actor: "Técnico", rf: ["RF-INV-004"], status: "implementado", note: "Implementado como intervención sobre el equipo" },
  { id: "CU-15", name: "Entregar equipo prestado", actor: "Técnico", rf: ["RF-PRES-001", "RF-PRES-004"], status: "parcial", note: "Sin comprobante PDF (RF-PRES-003)" },
  { id: "CU-16", name: "Registrar devolución", actor: "Técnico", rf: ["RF-PRES-005"], status: "implementado" },
  { id: "CU-17", name: "Ejecutar servicio", actor: "Técnico", rf: ["RF-SERV-003", "RF-SERV-005"], status: "implementado" },
  { id: "CU-18", name: "Gestionar usuarios", actor: "Administrador", rf: ["RF-USR-001", "RF-USR-002", "RF-USR-003"], status: "implementado" },
  { id: "CU-19", name: "Autorizar préstamo", actor: "Administrador", rf: ["RF-PRES-001", "RF-PRES-002"], status: "parcial", note: "Lo autoriza cualquier técnico y no se impide autorizar el propio pedido (RN-17)" },
  { id: "CU-20", name: "Resolver solicitud", actor: "Administrador", rf: ["RF-SERV-003", "RF-SERV-005"], status: "implementado" },
  { id: "CU-21", name: "Reasignar incidencia", actor: "Administrador", rf: ["RF-TKT-003"], status: "implementado" },
  { id: "CU-22", name: "Consultar indicadores", actor: "Administrador", rf: ["RF-DASH-001", "RF-DASH-002", "RF-DASH-003", "RF-DASH-004", "RF-DASH-005"], status: "parcial", note: "Reportes exportan CSV; faltan PDF y XLSX (RF-DASH-005)" },
  { id: "CU-23", name: "Gestionar afectación", actor: "Administrador", rf: ["RF-INV-004", "RF-PRES-006"], status: "no implementado", note: "No existe la entidad afectación permanente" },
  { id: "CU-24", name: "Auditar sistema", actor: "Administrador raíz", rf: ["RF-TRZ-002", "RF-TRZ-003", "RF-TRZ-004", "RF-TRZ-005"], status: "parcial", note: "Consulta y filtros sí; exportación CSV no" },
  { id: "CU-25", name: "Gestionar cuentas administrativas", actor: "Administrador raíz", rf: ["RF-USR-004", "RF-USR-005"], status: "parcial" },
  { id: "CU-26", name: "Vencer préstamo", actor: "Reloj", rf: ["RF-PRES-006"], status: "implementado", note: "Se evalúa al consultar préstamos, no por un proceso programado" },
  { id: "CU-27", name: "Expirar sesión", actor: "Reloj", rf: ["RF-AUTH-003"], status: "parcial", note: "El token vence a las 12 h fijas, no por inactividad" },
  { id: "CU-V", name: "Verificar disponibilidad", actor: "(incluido)", rf: ["RF-PRES-002", "RF-MANT-003"], status: "implementado" },
  { id: "CU-N", name: "Notificar acuse", actor: "(incluido)", rf: ["RF-TKT-001", "RF-SERV-002"], status: "implementado" },
  { id: "CU-R", name: "Registrar en auditoría", actor: "(incluido)", rf: ["RF-TRZ-001", "RF-INV-006"], status: "implementado", note: "Toda mutación inserta una fila en activity_logs dentro de su transacción" },
];
