import type { Loan, Reservation, ServiceRequest, Ticket, User } from "./types";

// Lo que tenes asignado queda fijado arriba de la lista mientras siga abierto, y
// se desfija al cerrarse. La unica excepcion son las reservas: si la cancela el
// solicitante, quien la aprobo no se entera de otra forma, asi que le queda
// fijada con un aviso hasta que la marca como vista.
export type PinState = "active" | "notice" | null;

function isMine(responsible: Pick<User, "id"> | null, userId?: string): boolean {
  return !!userId && responsible?.id === userId;
}

export function ticketPin(t: Ticket, userId?: string): PinState {
  return isMine(t.assignedTo, userId) && t.status !== "resolved" ? "active" : null;
}

export function servicePin(s: ServiceRequest, userId?: string): PinState {
  const open = s.status !== "completed" && s.status !== "rejected";
  return isMine(s.assignedTo, userId) && open ? "active" : null;
}

// En un prestamo el responsable es quien lo aprobo: lo sigue hasta la devolucion
export function loanPin(l: Loan, userId?: string): PinState {
  const open = l.status === "approved" || l.status === "active" || l.status === "overdue";
  return isMine(l.approvedBy, userId) && open ? "active" : null;
}

// En una reserva, quien la aprobo: la sigue hasta que termina o se cancela
export function reservationPin(r: Reservation, userId?: string): PinState {
  if (!isMine(r.reviewedBy, userId)) return null;
  if (r.status === "approved" || r.status === "active") return "active";
  return r.status === "cancelled" && r.unseenCancellation ? "notice" : null;
}

const PIN_ORDER: Record<Exclude<PinState, null>, number> = { notice: 0, active: 1 };

// Fijados primero (los avisos sin ver arriba de todo); el resto en su orden
export function pinnedFirst<T>(items: T[], pin: (item: T) => PinState): T[] {
  const rank = (item: T) => {
    const state = pin(item);
    return state ? PIN_ORDER[state] : 2;
  };
  return items.toSorted((a, b) => rank(a) - rank(b));
}

// Solo cuenta como busqueda por ID algo con forma de ID ("tkt-007", "tkt-00",
// "7"): si no, una "t" suelta traeria todo lo cerrado. Devuelve null si el
// termino no es un ID.
export function idQuery(term: string, prefix: string): string | null {
  const shape = new RegExp(`^(${prefix}-?)?\\d*$`);
  return shape.test(term) && (/\d/.test(term) || term.startsWith(prefix)) ? term : null;
}
