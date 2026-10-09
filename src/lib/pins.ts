import type { ClosureNotice, Loan, Reservation, ServiceRequest, Ticket, User } from "./types";

// Lo que tenes asignado queda fijado arriba de la lista mientras siga abierto.
// Si lo cierra otra persona (el solicitante u otro del staff) sigue fijado con
// un aviso hasta que lo marcas como visto; si lo cerras vos, se desfija solo.
export type PinState = "active" | "notice" | null;

interface Pinnable {
  responsible: Pick<User, "id"> | null;
  open: boolean;
  closureNotice?: ClosureNotice | null;
}

function pinState({ responsible, open, closureNotice }: Pinnable, userId?: string): PinState {
  if (!userId || responsible?.id !== userId) return null;
  if (open) return "active";
  return closureNotice ? "notice" : null;
}

export function ticketPin(t: Ticket, userId?: string): PinState {
  return pinState(
    { responsible: t.assignedTo, open: t.status !== "resolved", closureNotice: t.closureNotice },
    userId,
  );
}

export function servicePin(s: ServiceRequest, userId?: string): PinState {
  return pinState(
    {
      responsible: s.assignedTo,
      open: s.status !== "completed" && s.status !== "rejected",
      closureNotice: s.closureNotice,
    },
    userId,
  );
}

// En un prestamo el responsable es quien lo aprobo: lo sigue hasta la devolucion
export function loanPin(l: Loan, userId?: string): PinState {
  return pinState(
    {
      responsible: l.approvedBy,
      open: l.status === "approved" || l.status === "active" || l.status === "overdue",
      closureNotice: l.closureNotice,
    },
    userId,
  );
}

// En una reserva, quien la aprobo: la sigue hasta que termina o se cancela
export function reservationPin(r: Reservation, userId?: string): PinState {
  return pinState(
    {
      responsible: r.reviewedBy,
      open: r.status === "approved" || r.status === "active",
      closureNotice: r.closureNotice,
    },
    userId,
  );
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
