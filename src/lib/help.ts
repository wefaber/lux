import type { MessageKey } from "@/i18n";

// Centro de ayuda configurable en runtime: el contenido sale de
// public/config/help.json (ver docs/AYUDA.md). Este modulo no hace fetch: solo
// define la forma de los datos y valida lo que llega, para poder testearlo sin
// navegador ni red.

/** Texto que puede venir en un solo idioma o con una version por idioma. */
export interface HelpText {
  readonly es: string;
  readonly en?: string;
}

export interface HelpFaq {
  readonly id: string;
  readonly question: HelpText;
  readonly answer: HelpText;
}

export interface HelpCategory {
  /** Id de la categoria; las conocidas tienen etiqueta en el diccionario. */
  readonly id: string;
  /** Etiqueta propia, solo para categorias que no estan en el diccionario. */
  readonly label?: HelpText;
  readonly items: HelpFaq[];
}

export interface HelpConfig {
  readonly contact: {
    readonly email: string;
    readonly schedule?: HelpText;
    readonly responseTime?: HelpText;
  };
  readonly guide?: {
    readonly url: string;
    readonly label?: HelpText;
  };
  readonly categories: HelpCategory[];
}

export interface HelpParseSuccess {
  readonly ok: true;
  readonly config: HelpConfig;
  /** Contenido descartado por invalido: la pagina sigue funcionando. */
  readonly warnings: string[];
}

export interface HelpParseFailure {
  readonly ok: false;
  readonly issues: string[];
}

export type HelpParseResult = HelpParseSuccess | HelpParseFailure;

// Etiqueta de las categorias que conoce la interfaz. Una categoria con otro id
// se muestra con su `label` del JSON o, si no tiene, con el id tal cual.
export const HELP_CATEGORY_LABEL_KEYS = {
  tickets: "help.category.tickets",
  loans: "help.category.loans",
  services: "help.category.services",
  reservations: "help.category.reservations",
  account: "help.category.account",
} as const satisfies Record<string, MessageKey>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Acepta "texto" (sirve para los dos idiomas) o { es, en }.
function readText(value: unknown, path: string, warnings: string[]): HelpText | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      warnings.push(`${path} must not be empty`);
      return null;
    }
    return { es: text };
  }
  if (!isRecord(value)) {
    warnings.push(`${path} must be a string or an object with an "es" text`);
    return null;
  }
  const es = nonEmptyString(value.es);
  if (!es) {
    warnings.push(`${path}.es is required`);
    return null;
  }
  const en = nonEmptyString(value.en);
  return en ? { es, en } : { es };
}

function readOptionalText(
  value: unknown,
  path: string,
  warnings: string[],
): HelpText | undefined {
  if (value === undefined || value === null) return undefined;
  return readText(value, path, warnings) ?? undefined;
}

/** Texto en el idioma activo; si esa version falta se usa el espanol. */
export function helpTextFor(text: HelpText, lang: string): string {
  return lang === "en" && text.en ? text.en : text.es;
}

function parseGuide(raw: unknown, warnings: string[]): HelpConfig["guide"] {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    warnings.push("guide must be an object");
    return undefined;
  }
  const url = nonEmptyString(raw.url);
  if (!url) {
    warnings.push("guide.url is required when guide is present");
    return undefined;
  }
  if (!url.startsWith("/") && !isExternalHelpUrl(url)) {
    warnings.push("guide.url must start with / or http(s)://");
    return undefined;
  }
  const label = readOptionalText(raw.label, "guide.label", warnings);
  return label ? { url, label } : { url };
}

function parseFaq(
  raw: unknown,
  categoryId: string,
  index: number,
  warnings: string[],
): HelpFaq | null {
  const path = `categories[${categoryId}].items[${index}]`;
  if (!isRecord(raw)) {
    warnings.push(`${path} is not an object`);
    return null;
  }
  const question = readText(raw.question, `${path}.question`, warnings);
  const answer = readText(raw.answer, `${path}.answer`, warnings);
  if (!question || !answer) return null;
  const explicitId = nonEmptyString(raw.id);
  return { id: explicitId || `${categoryId}-${index + 1}`, question, answer };
}

function parseCategory(
  raw: unknown,
  index: number,
  warnings: string[],
): HelpCategory | null {
  if (!isRecord(raw)) {
    warnings.push(`categories[${index}] is not an object`);
    return null;
  }
  const id = nonEmptyString(raw.id);
  if (!id) {
    warnings.push(`categories[${index}].id is required`);
    return null;
  }
  // Se usa como id del DOM en aria-labelledby: tiene que ser un identificador
  // simple, no texto libre.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
    warnings.push(`categories[${index}].id must contain only letters, numbers, "-" or "_"`);
    return null;
  }
  if (!Array.isArray(raw.items)) {
    warnings.push(`categories[${index}].items must be an array`);
    return null;
  }
  const items: HelpFaq[] = [];
  raw.items.forEach((rawItem, itemIndex) => {
    const item = parseFaq(rawItem, id, itemIndex, warnings);
    if (item) items.push(item);
  });
  if (items.length === 0) {
    warnings.push(`categories[${index}] has no valid FAQ items`);
    return null;
  }
  const label = readOptionalText(raw.label, `categories[${index}].label`, warnings);
  return label ? { id, label, items } : { id, items };
}

/**
 * Valida el JSON del operador.
 *
 * - Falla entero (`ok: false`) cuando no hay canal de contacto o no queda
 *   ninguna categoria usable: sin eso la pagina no tiene sentido.
 * - Descarta solo lo invalido (`warnings`) cuando es una pregunta o una
 *   categoria suelta, asi un error de tipeo no deja la pagina vacia.
 */
export function parseHelpConfig(raw: unknown): HelpParseResult {
  if (!isRecord(raw)) {
    return { ok: false, issues: ["help config must be a JSON object"] };
  }

  const issues: string[] = [];
  const warnings: string[] = [];

  let email = "";
  let schedule: HelpText | undefined;
  let responseTime: HelpText | undefined;
  if (!isRecord(raw.contact)) {
    issues.push("contact is required");
  } else {
    email = nonEmptyString(raw.contact.email);
    if (!email) issues.push("contact.email is required");
    else if (!EMAIL_PATTERN.test(email)) issues.push("contact.email is not a valid email address");
    schedule = readOptionalText(raw.contact.schedule, "contact.schedule", warnings);
    responseTime = readOptionalText(raw.contact.responseTime, "contact.responseTime", warnings);
  }

  const guide = parseGuide(raw.guide, warnings);

  const categories: HelpCategory[] = [];
  if (!Array.isArray(raw.categories)) {
    issues.push("categories must be an array");
  } else {
    raw.categories.forEach((rawCategory, index) => {
      const category = parseCategory(rawCategory, index, warnings);
      if (category) categories.push(category);
    });
    if (categories.length === 0) {
      issues.push("categories must include at least one category with FAQ items");
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    config: { contact: { email, schedule, responseTime }, guide, categories },
    warnings,
  };
}

/** Minusculas y sin tildes: "préstamo" y "prestamo" buscan lo mismo. */
export function normalizeHelpSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtra las preguntas por texto libre. Todas las palabras de la busqueda
 * tienen que aparecer en la pregunta o en la respuesta del idioma activo.
 * Devuelve solo las categorias que conservan alguna pregunta.
 */
export function filterHelpCategories(
  categories: HelpCategory[],
  query: string,
  lang: string,
): HelpCategory[] {
  const words = normalizeHelpSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return categories;

  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        const haystack = normalizeHelpSearch(
          `${helpTextFor(item.question, lang)} ${helpTextFor(item.answer, lang)}`,
        );
        return words.every((word) => haystack.includes(word));
      }),
    }))
    .filter((category) => category.items.length > 0);
}

export function countHelpItems(categories: HelpCategory[]): number {
  return categories.reduce((total, category) => total + category.items.length, 0);
}

/** true para guias externas (se abren en otra pestana). */
export function isExternalHelpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
