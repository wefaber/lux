// Horarios de ejemplo: dos docentes (u-sol-1 y u-sol-2) con clases en el
// Laboratorio 1 y el Salón 1. Horas en hora local de la institucion.
const stamp = "2024-03-04T10:00:00Z";

export const mockClassSchedules = [
  {
    id: "cls-1",
    locationId: "loc-1",
    teacherId: "u-sol-1",
    weekday: 1,
    startTime: "08:00",
    endTime: "09:30",
    subject: "Programación",
    studentGroup: "1°B",
  },
  {
    id: "cls-2",
    locationId: "loc-1",
    teacherId: "u-sol-2",
    weekday: 1,
    startTime: "09:30",
    endTime: "11:00",
    subject: "Redes",
    studentGroup: "2°A",
  },
  {
    id: "cls-3",
    locationId: "loc-1",
    teacherId: "u-sol-1",
    weekday: 3,
    startTime: "08:00",
    endTime: "09:30",
    subject: "Programación",
    studentGroup: "1°B",
  },
  {
    id: "cls-4",
    locationId: "loc-2",
    teacherId: "u-sol-2",
    weekday: 2,
    startTime: "14:00",
    endTime: "15:30",
    subject: "Matemática",
    studentGroup: "2°A",
  },
  {
    id: "cls-5",
    locationId: "loc-2",
    teacherId: "u-sol-1",
    weekday: 4,
    startTime: "14:00",
    endTime: "15:30",
    subject: "Matemática",
    studentGroup: "1°B",
  },
].map((row) => ({ ...row, createdAt: stamp, updatedAt: stamp }));
