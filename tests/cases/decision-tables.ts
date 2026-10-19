import type { DecisionTable } from "./types";

// Tablas de decisión (S = sí, N = no, - = indiferente). Cada regla apunta a los
// casos de prueba que la ejercitan, así la cobertura de la lógica se verifica.
export const DECISION_TABLES: DecisionTable[] = [
  {
    id: "TD-01",
    title: "Inicio de sesión",
    cu: "CU-01",
    conditions: ["La cuenta existe", "La cuenta está vigente", "La clave verifica", "Intentos fallidos bajo el umbral"],
    actions: ["Establecer sesión con su rol", "Informar 'Credenciales inválidas'", "Rechazar cuenta no habilitada", "Restringir acceso temporalmente"],
    rules: [
      { id: "R1", when: ["S", "S", "S", "S"], acciones: ["X", "", "", ""], cases: ["CP-01-01"] },
      { id: "R2", when: ["N", "-", "-", "S"], acciones: ["", "X", "", ""], cases: ["CP-01-03"] },
      { id: "R3", when: ["S", "S", "N", "S"], acciones: ["", "X", "", ""], cases: ["CP-01-02"] },
      { id: "R4", when: ["S", "N", "-", "S"], acciones: ["", "", "X", ""], cases: ["CP-01-05"] },
      { id: "R5", when: ["S", "-", "-", "N"], acciones: ["", "", "", "X"], cases: ["CP-01-04"] },
    ],
  },
  {
    id: "TD-02",
    title: "Solicitud de préstamo (con CU-V)",
    cu: "CU-05",
    conditions: ["Equipo activo (sin baja)", "Equipo fuera de reparación", "Sin préstamo abierto sobre el equipo", "Devolución posterior al retiro"],
    actions: ["Registrar pedido pendiente", "Informar equipo no disponible", "Rechazar el rango de fechas"],
    rules: [
      { id: "R1", when: ["S", "S", "S", "S"], acciones: ["X", "", ""], cases: ["CP-05-01", "CP-05-04"] },
      { id: "R2", when: ["N", "-", "-", "-"], acciones: ["", "X", ""], cases: ["CP-05-03"] },
      { id: "R3", when: ["S", "N", "-", "-"], acciones: ["", "X", ""], cases: ["CP-V-01"] },
      { id: "R4", when: ["S", "S", "N", "-"], acciones: ["", "X", ""], cases: ["CP-19-05"] },
      { id: "R5", when: ["S", "S", "S", "N"], acciones: ["", "", "X"], cases: ["CP-05-02"] },
    ],
  },
  {
    id: "TD-03",
    title: "Autorización de préstamo",
    cu: "CU-19",
    conditions: ["Quien resuelve es Administrador", "El equipo sigue disponible", "Quien resuelve no es el solicitante", "Decisión: autorizar", "Motivo informado"],
    actions: ["Autorizar y registrar responsable", "Denegar con motivo visible", "Rechazar por permisos", "Informar conflicto de disponibilidad", "Exigir motivo", "Rechazar autoautorización"],
    rules: [
      { id: "R1", when: ["S", "S", "S", "S", "-"], acciones: ["X", "", "", "", "", ""], cases: ["CP-19-01"] },
      { id: "R2", when: ["S", "-", "S", "N", "S"], acciones: ["", "X", "", "", "", ""], cases: ["CP-19-02"] },
      { id: "R3", when: ["S", "-", "S", "N", "N"], acciones: ["", "", "", "", "X", ""], cases: ["CP-19-02"] },
      { id: "R4", when: ["N", "-", "-", "-", "-"], acciones: ["", "", "X", "", "", ""], cases: ["CP-19-04"] },
      { id: "R5", when: ["S", "N", "S", "S", "-"], acciones: ["", "", "", "X", "", ""], cases: ["CP-19-05"] },
      { id: "R6", when: ["S", "S", "N", "S", "-"], acciones: ["", "", "", "", "", "X"], cases: ["CP-19-03"] },
    ],
  },
  {
    id: "TD-04",
    title: "Resolución de incidencia",
    cu: "CU-13",
    conditions: ["Estado en proceso o en resolución", "Diagnóstico informado", "Acciones tomadas informadas", "El problema quedó corregido"],
    actions: ["Resolver con 'corregido = sí'", "Resolver con 'corregido = no'", "Rechazar: falta diagnóstico", "Rechazar: transición inválida"],
    rules: [
      { id: "R1", when: ["S", "S", "S", "S"], acciones: ["X", "", "", ""], cases: ["CP-13-01"] },
      { id: "R2", when: ["S", "S", "S", "N"], acciones: ["", "X", "", ""], cases: ["CP-13-03"] },
      { id: "R3", when: ["S", "N", "-", "-"], acciones: ["", "", "X", ""], cases: ["CP-13-02"] },
      { id: "R4", when: ["N", "-", "-", "-"], acciones: ["", "", "", "X"], cases: ["CP-12-02", "CP-21-03"] },
    ],
  },
  {
    id: "TD-05",
    title: "Cierre de solicitud de servicio",
    cu: "CU-17 / CU-20",
    conditions: ["La solicitud está abierta", "Tiene técnico responsable", "Estado destino: completada", "Texto de resolución informado"],
    actions: ["Completar con el detalle", "Rechazar: falta responsable", "Rechazar: solicitud cerrada", "Rechazar: falta detalle del cierre"],
    rules: [
      { id: "R1", when: ["S", "S", "S", "S"], acciones: ["X", "", "", ""], cases: ["CP-17-01"] },
      { id: "R2", when: ["S", "N", "S", "-"], acciones: ["", "X", "", ""], cases: ["CP-20-02"] },
      { id: "R3", when: ["N", "-", "-", "-"], acciones: ["", "", "X", ""], cases: ["CP-20-01", "CP-20-04"] },
      { id: "R4", when: ["S", "S", "S", "N"], acciones: ["", "", "", "X"], cases: ["CP-20-03"] },
    ],
  },
];
