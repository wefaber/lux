import { mockUsers, mockPasswords } from "./data/users";
import { mockProducts, mockComponents } from "./data/equipment";
import { mockLocations } from "./data/locations";
import { mockInterventions } from "./data/interventions";
import { mockComments } from "./data/comments";
import { mockReservations } from "./data/reservations";
import { mockTickets } from "./data/tickets";
import { mockLoans } from "./data/loans";
import { mockServices } from "./data/services";
import { mockActivityLogs } from "./generators";

// Los datos de prueba viven en memoria: sin esto, al recargar la pagina todo
// vuelve a como arranca. Se guardan en localStorage despues de cada respuesta
// del mock y se recuperan al iniciar.
//
// Subir VERSION cuando cambien los datos de ejemplo o su forma: lo guardado con
// otra version se descarta y se arranca de cero.
const STORAGE_KEY = "lux_mock_data";
const VERSION = 1;

const ARRAYS = {
  users: mockUsers,
  products: mockProducts,
  components: mockComponents,
  locations: mockLocations,
  interventions: mockInterventions,
  comments: mockComments,
  reservations: mockReservations,
  tickets: mockTickets,
  loans: mockLoans,
  services: mockServices,
  activityLogs: mockActivityLogs,
} as const;

type Store = { [K in keyof typeof ARRAYS]: unknown[] } & { passwords: Record<string, string> };

// Un prestamo apunta al MISMO objeto que el equipo de la lista de equipos (y
// los handlers cambian el estado del equipo a traves del prestamo). JSON a
// secas lo duplicaria, asi que cada objeto se guarda una sola vez y las demas
// apariciones quedan como { $ref: n }.
export function encode(root: unknown): unknown {
  const ids = new Map<object, number>();
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    const seen = ids.get(value);
    if (seen !== undefined) return { $ref: seen };
    const id = ids.size;
    ids.set(value, id);
    if (Array.isArray(value)) return { $id: id, $items: value.map(walk) };
    const out: Record<string, unknown> = { $id: id };
    for (const [key, item] of Object.entries(value)) out[key] = walk(item);
    return out;
  };
  return walk(root);
}

export function decode(data: unknown): unknown {
  const objects = new Map<number, object>();
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    if ("$ref" in node) return objects.get(node.$ref as number);
    if ("$items" in node) {
      const arr: unknown[] = [];
      objects.set(node.$id as number, arr);
      for (const item of node.$items as unknown[]) arr.push(walk(item));
      return arr;
    }
    const out: Record<string, unknown> = {};
    objects.set(node.$id as number, out);
    for (const [key, item] of Object.entries(node)) {
      if (key !== "$id") out[key] = walk(item);
    }
    return out;
  };
  return walk(data);
}

// Tras restablecer no se vuelve a guardar: la recarga dispara pagehide
let resetting = false;

export function saveMockData(): void {
  if (resetting) return;
  const store: Store = { ...ARRAYS, passwords: mockPasswords };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, data: encode(store) }));
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): sigue andando en memoria
  }
}

// Reemplaza el contenido de las colecciones en el lugar: los handlers tienen
// importadas estas mismas listas
export function restoreMockData(): void {
  let saved: { version?: number; data?: unknown } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || saved.version !== VERSION || !saved.data) return;
  const store = decode(saved.data) as Partial<Store>;
  for (const [name, target] of Object.entries(ARRAYS) as [keyof typeof ARRAYS, unknown[]][]) {
    const items = store[name];
    if (Array.isArray(items)) target.splice(0, target.length, ...items);
  }
  if (store.passwords) {
    for (const key of Object.keys(mockPasswords)) delete mockPasswords[key];
    Object.assign(mockPasswords, store.passwords);
  }
}

// Vuelve a los datos de ejemplo (al recargar la pagina)
export function clearMockData(): void {
  resetting = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada guardado que borrar
  }
}
