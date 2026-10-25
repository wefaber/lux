import { afterEach, describe, expect, test } from "bun:test";
import { es, esParts } from "./es";
import { en } from "./en";
import {
  LANG_STORAGE_KEY,
  detectLang,
  dictionaryFor,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  getLang,
  interpolate,
  resetLang,
  setLang,
  subscribeLang,
  t,
  translate,
  withLang,
  type MessageKey,
} from ".";
import { translateError } from "./errors";
import {
  EQUIPMENT_STATUS_CONFIG,
  NOTICE_KIND_LABELS,
  ROLE_LABELS,
  SERVICE_TYPE_LABELS,
  TICKET_STATUS_CONFIG,
  equipmentKindLabel,
} from "@/lib/constants";
import { validateMachineId, validateName, validateTicket } from "@/lib/validation";
import { ApiError } from "@/lib/utils";

const keys = Object.keys(es) as MessageKey[];
const placeholders = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// Simula localStorage / navigator / document sin DOM, y los deja como estaban
function stubBrowser(options: { stored?: string; languages?: string[] }) {
  const g = globalThis as Record<string, unknown>;
  const original = {
    localStorage: Object.getOwnPropertyDescriptor(g, "localStorage"),
    navigator: Object.getOwnPropertyDescriptor(g, "navigator"),
    document: Object.getOwnPropertyDescriptor(g, "document"),
  };
  const store = new Map<string, string>();
  if (options.stored) store.set(LANG_STORAGE_KEY, options.stored);
  const html = {
    lang: "",
    setAttribute(name: string, value: string) {
      if (name === "lang") this.lang = value;
    },
  };
  Object.defineProperty(g, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
  Object.defineProperty(g, "navigator", {
    configurable: true,
    value: { languages: options.languages ?? [], language: options.languages?.[0] },
  });
  Object.defineProperty(g, "document", { configurable: true, value: { documentElement: html } });
  return {
    store,
    html,
    restore() {
      for (const [name, descriptor] of Object.entries(original)) {
        if (descriptor) Object.defineProperty(g, name, descriptor);
        else delete g[name];
      }
      resetLang();
      setLang("es");
    },
  };
}

afterEach(() => {
  setLang("es");
});

describe("diccionarios", () => {
  test("ingles y espanol tienen exactamente las mismas claves", () => {
    expect(Object.keys(en).toSorted()).toEqual(Object.keys(es).toSorted());
  });

  test("ninguna clave esta vacia", () => {
    for (const lang of ["es", "en"] as const) {
      const dictionary = dictionaryFor(lang);
      const empty = keys.filter((k) => dictionary[k].trim() === "");
      expect(empty).toEqual([]);
    }
  });

  test("ninguna clave se repite entre los archivos del espanol", () => {
    const all = esParts.flatMap((part) => Object.keys(part));
    const repeated = all.filter((key, i) => all.indexOf(key) !== i);
    expect(repeated).toEqual([]);
  });

  test("el ingles solo usa marcadores que existen en el espanol", () => {
    const wrong = keys.filter((k) => {
      const allowed = placeholders(es[k]);
      return [...placeholders(en[k])].some((name) => !allowed.has(name));
    });
    expect(wrong).toEqual([]);
  });

  test("el ingles no repite el espanol salvo en terminos que se escriben igual", () => {
    // Un texto identico en los dos idiomas casi siempre es una traduccion que
    // falto; solo se admiten los nombres propios y tecnicos de esta lista
    const SAME = new Set([
      "language.name.es",
      "language.name.en",
      "role.root_admin",
      "equipmentKind.AIO",
      "equipmentKind.Desktop",
      "equipmentKind.Laptop",
      "equipmentKind.Monitor",
      "equipmentKind.Switch",
      "equipmentKind.Router",
      "equipmentKind.UPS",
      "equipmentKind.Mouse",
      "equipmentKind.Webcam",
      "ticketCategory.hardware",
      "ticketCategory.software",
      "field.partNumber",
      "error.http",
      "common.no",
      "common.error",
      "label.id",
      "label.partNumber",
      "label.email",
      "history.ticket",
      "tickets.title",
      "tickets.ool",
      "dashboard.csv.file",
      "profile.field.email",
      "profile.a11y.fontSizeHelp",
      "app.name",
      "nav.tickets",
      "admin.brand",
      "services.detail.software",
      "reports.hours",
      "reports.resolution.total",
      "reports.top.tickets",
      "activity.entity.Ticket",
      "admin.users.importStatus.error",
    ]);
    const same = keys.filter((k) => en[k] === es[k] && !SAME.has(k));
    expect(same).toEqual([]);
  });
});

describe("traduccion", () => {
  test("interpola parametros", () => {
    expect(translate("es", "validation.min", { label: "Marca", min: 2 })).toBe(
      "Marca: mínimo 2 caracteres",
    );
    expect(translate("en", "validation.min", { label: "Brand", min: 2 })).toBe(
      "Brand: at least 2 characters",
    );
  });

  test("un marcador sin parametro queda sin tocar", () => {
    expect(interpolate("Hola {name} y {other}", { name: "Ana" }, "es")).toBe("Hola Ana y {other}");
  });

  test("pluraliza con Intl.PluralRules segun el idioma", () => {
    const template = "{count} equipo | {count} equipos";
    expect(interpolate(template, { count: 1 }, "es")).toBe("1 equipo");
    expect(interpolate(template, { count: 0 }, "es")).toBe("0 equipos");
    expect(interpolate(template, { count: 3 }, "es")).toBe("3 equipos");
    expect(interpolate("{count} item | {count} items", { count: 1 }, "en")).toBe("1 item");
    expect(interpolate("{count} item | {count} items", { count: 2 }, "en")).toBe("2 items");
  });

  test("t usa el idioma activo y withLang lo fija un momento", () => {
    expect(t("common.cancel")).toBe("Cancelar");
    setLang("en");
    expect(t("common.cancel")).toBe("Cancel");
    expect(withLang("es", () => t("common.cancel"))).toBe("Cancelar");
    expect(t("common.cancel")).toBe("Cancel");
  });

  test("las constantes de dominio siguen al idioma activo", () => {
    expect(TICKET_STATUS_CONFIG.in_progress.label).toBe("En progreso");
    expect(ROLE_LABELS.tecnico).toBe("Técnico");
    setLang("en");
    expect(TICKET_STATUS_CONFIG.in_progress.label).toBe("In progress");
    expect(EQUIPMENT_STATUS_CONFIG.retired.label).toBe("Retired");
    expect(ROLE_LABELS.tecnico).toBe("Technician");
    expect(SERVICE_TYPE_LABELS.lab_preparation).toBe("Lab preparation");
    expect(Object.values(SERVICE_TYPE_LABELS)).toHaveLength(4);
    expect(equipmentKindLabel("Servidor")).toBe("Server");
    expect(equipmentKindLabel("Cosa rara")).toBe("Cosa rara");
  });

  test("los avisos conservan el marcador {o} para resolverlo despues", () => {
    expect(NOTICE_KIND_LABELS.resolved).toBe("L{o} resolvió {by}");
    setLang("en");
    expect(NOTICE_KIND_LABELS.resolved).toBe("Resolved by {by}");
  });
});

describe("selector de idioma", () => {
  test("persiste en lux_lang y actualiza <html lang>", () => {
    const env = stubBrowser({});
    try {
      setLang("en");
      expect(env.store.get(LANG_STORAGE_KEY)).toBe("en");
      expect(env.html.lang).toBe("en");
      expect(getLang()).toBe("en");
      setLang("es");
      expect(env.store.get(LANG_STORAGE_KEY)).toBe("es");
      expect(env.html.lang).toBe("es");
    } finally {
      env.restore();
    }
  });

  test("avisa a los suscriptores del cambio", () => {
    let calls = 0;
    const unsubscribe = subscribeLang(() => calls++);
    setLang("en");
    setLang("es");
    unsubscribe();
    setLang("en");
    expect(calls).toBe(2);
  });

  test("al arrancar usa lo guardado", () => {
    const env = stubBrowser({ stored: "en", languages: ["es-UY"] });
    try {
      expect(detectLang()).toBe("en");
    } finally {
      env.restore();
    }
  });

  test("sin nada guardado usa el idioma del navegador si es es o en", () => {
    let env = stubBrowser({ languages: ["en-US", "es"] });
    try {
      expect(detectLang()).toBe("en");
    } finally {
      env.restore();
    }
    env = stubBrowser({ languages: ["es-AR"] });
    try {
      expect(detectLang()).toBe("es");
    } finally {
      env.restore();
    }
  });

  test("con otro idioma del navegador o un valor guardado invalido cae en espanol", () => {
    let env = stubBrowser({ languages: ["fr-FR", "de"] });
    try {
      expect(detectLang()).toBe("es");
    } finally {
      env.restore();
    }
    env = stubBrowser({ stored: "pt", languages: ["fr"] });
    try {
      expect(detectLang()).toBe("es");
    } finally {
      env.restore();
    }
  });

  test("sin storage disponible no falla", () => {
    // En bun no hay localStorage: leer y guardar tienen que ser inocuos
    expect(() => setLang("en")).not.toThrow();
    expect(getLang()).toBe("en");
  });
});

describe("formatos", () => {
  const iso = "2026-10-08T14:05:00";

  test("fechas y horas con el locale del idioma", () => {
    expect(formatDate(iso, "es")).toBe("08/10/2026");
    expect(formatDate(iso, "en")).toBe("08/10/2026");
    // es-UY usa 12 horas; en-GB, 24
    expect(formatDateTime(iso, "es")).toMatch(/^08\/10\/2026, 02:05/);
    expect(formatDateTime(iso, "en")).toBe("08/10/2026, 14:05");
    expect(formatDateTime("2026-10-08T09:30:00", "en")).toContain("09:30");
  });

  test("numeros con separadores del idioma", () => {
    expect(formatNumber(1234.5, undefined, "en")).toBe("1,234.5");
    expect(formatNumber(1234.5, undefined, "es")).not.toBe("1,234.5");
  });

  test("tiempo relativo", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatRelativeTime(ago(3 * 86_400_000), "es", now)).toBe("hace 3 días");
    expect(formatRelativeTime(ago(3 * 86_400_000), "en", now)).toBe("3 days ago");
    expect(formatRelativeTime(ago(3_600_000), "es", now)).toBe("hace 1 hora");
    expect(formatRelativeTime(ago(2 * 3_600_000), "en", now)).toBe("2 hours ago");
    expect(formatRelativeTime(ago(5 * 60_000), "en", now)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(10_000), "es", now)).toBe("ahora mismo");
    expect(formatRelativeTime(ago(10_000), "en", now)).toBe("just now");
  });
});

describe("validaciones en el idioma activo", () => {
  test("espanol por defecto", () => {
    expect(validateName("a", "Marca")).toBe("Marca: mínimo 2 caracteres");
  });

  test("ingles al cambiar el idioma", () => {
    setLang("en");
    expect(validateName("a", t("field.brand"))).toBe("Brand: at least 2 characters");
    expect(validateMachineId("xx", "Desktop", { name: "Laboratorio 1", code: "L1" })).toBe(
      "Invalid format. E.g.: L1-PC1",
    );
    expect(validateMachineId("L1-MON1", "Servidor", { name: "Laboratorio 1", code: "L1" })).toBe(
      'A Server uses the code "SRV". E.g.: L1-SRV1',
    );
    expect(validateTicket({ title: "", description: "", category: "x" })).toEqual({
      title: "Title: at least 3 characters",
      description: "Description: at least 5 characters",
      category: "Choose a category",
    });
  });
});

describe("errores de la API", () => {
  test("en espanol el mensaje no se toca", () => {
    expect(translateError("Ticket no encontrado")).toBe("Ticket no encontrado");
    expect(translateError("Mensaje que no conocemos")).toBe("Mensaje que no conocemos");
  });

  test("se traduce por plantilla a ingles", () => {
    setLang("en");
    expect(translateError("Ticket no encontrado")).toBe("Ticket not found");
    expect(translateError("No tenés permisos para esta acción")).toBe(
      "You do not have permission for this action",
    );
  });

  test("traduce los parametros y las etiquetas de estado", () => {
    setLang("en");
    expect(translateError('No se puede pasar un ticket de "En progreso" a "Resuelto"')).toBe(
      'A ticket cannot go from "In progress" to "Resolved"',
    );
    expect(translateError('No se puede aprobar una reserva "Finalizada"')).toBe(
      'Cannot approve a reservation with status "Finished"',
    );
    expect(translateError("Ya existe un equipo con ID L1-PC3")).toBe(
      "Equipment with ID L1-PC3 already exists",
    );
    expect(translateError("Marca: mínimo 2 caracteres")).toBe("Brand: at least 2 characters");
  });

  test("un nombre propio dentro del mensaje queda como vino", () => {
    setLang("en");
    expect(translateError("La solicitud ya la tomó Ana Pérez")).toBe(
      "The request was already taken by Ana Pérez",
    );
  });

  test("el codigo tiene prioridad sobre el texto", () => {
    setLang("en");
    expect(translateError("Texto cualquiera", "FORBIDDEN")).toBe(
      "You do not have permission for this action",
    );
    // un codigo que no conocemos no pisa al texto
    expect(translateError("Ticket no encontrado", "ALGO_NUEVO")).toBe("Ticket not found");
  });

  test("el texto desconocido vuelve tal cual", () => {
    setLang("en");
    expect(translateError("Algo que la API dijo y no sabemos")).toBe(
      "Algo que la API dijo y no sabemos",
    );
  });

  test("ApiError guarda el texto original y el codigo", () => {
    setLang("en");
    const error = new ApiError("Credenciales inválidas", "INVALID_CREDENTIALS");
    expect(error.message).toBe("Invalid credentials");
    expect(error.original).toBe("Credenciales inválidas");
    expect(error.code).toBe("INVALID_CREDENTIALS");
  });
});
