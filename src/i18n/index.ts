import { es } from "./es";
import { en } from "./en";

// Internacionalizacion liviana, sin dependencias. El espanol es la fuente: de
// sus claves sale el tipo MessageKey y de sus {marcadores} el tipo de los
// parametros, asi que una clave que falta en ingles (o un parametro mal
// escrito) rompe el typecheck.

export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "es";
export const LANG_STORAGE_KEY = "lux_lang";

export type MessageKey = keyof typeof es;
type Dictionary = Record<MessageKey, string>;

// "{count} equipo | {count} equipos" -> nombres de los marcadores del texto
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never;
export type Params = Record<string, string | number>;
// Distributivo: con una clave dinamica (union de claves) alcanza con no pasar
// parametros; con una clave literal se exigen los de su marcador
type ParamsFor<K extends MessageKey> = K extends MessageKey
  ? [Placeholders<(typeof es)[K]>] extends [never]
    ? [params?: Params]
    : [params: Record<Placeholders<(typeof es)[K]>, string | number> & Params]
  : never;
export type TArgs<K extends MessageKey> = ParamsFor<K>;
export type TFunction = <K extends MessageKey>(key: K, ...args: TArgs<K>) => string;

const DICTIONARIES: Record<Lang, Dictionary> = { es, en };

// Locale de Intl de cada idioma. En ingles se usa en-GB: fecha dia/mes/anio y
// 24 horas, igual que el formato local (en-US invertiria dia y mes)
export const LOCALES: Record<Lang, string> = { es: "es-UY", en: "en-GB" };

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

// ── Idioma activo ────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let current: Lang | null = null;
let forced: Lang | null = null;

function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : null;
  } catch {
    return null; // sin storage (modo privado, tests): se usa el del navegador
  }
}

/** Lo guardado; si no hay, el idioma del navegador cuando es es/en; si no, espanol. */
export function detectLang(): Lang {
  const stored = readStoredLang();
  if (stored) return stored;
  try {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of candidates) {
      const base = tag?.toLowerCase().split("-")[0];
      if (isLang(base)) return base;
    }
  } catch {
    // sin navigator: espanol
  }
  return DEFAULT_LANG;
}

export function getLang(): Lang {
  if (forced) return forced;
  current ??= detectLang();
  return current;
}

function applyToDocument(lang: Lang): void {
  try {
    document.documentElement.setAttribute("lang", lang);
  } catch {
    // sin DOM (tests de logica)
  }
}

/** Cambia el idioma, lo guarda y avisa a quienes lo escuchan (el proveedor). */
export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // sin storage: el cambio vale solo para esta sesion
  }
  applyToDocument(lang);
  for (const listener of listeners) listener();
}

/** Aplica el idioma al <html lang> sin guardarlo (arranque de la app). */
export function syncDocumentLang(): void {
  applyToDocument(getLang());
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ejecuta `fn` con otro idioma (sincronico): para generar un texto en un idioma fijo. */
export function withLang<T>(lang: Lang, fn: () => T): T {
  const previous = forced;
  forced = lang;
  try {
    return fn();
  } finally {
    forced = previous;
  }
}

/** Solo para tests: vuelve al estado inicial (sin idioma elegido ni cacheado). */
export function resetLang(): void {
  current = null;
  forced = null;
}

// ── Traduccion ───────────────────────────────────────────────────────────────

// Plural simple: "uno | otros". Se usa cuando hay un parametro numerico `count`
function pickPlural(template: string, count: number, lang: Lang): string {
  const forms = template.split(" | ");
  if (forms.length < 2) return template;
  const index = new Intl.PluralRules(LOCALES[lang]).select(count) === "one" ? 0 : 1;
  return forms[index] ?? forms[forms.length - 1];
}

export function interpolate(template: string, params: Params | undefined, lang: Lang): string {
  const text =
    typeof params?.count === "number" ? pickPlural(template, params.count, lang) : template;
  if (!params) return text;
  // Un marcador sin parametro queda tal cual: asi un texto con {o} o {by} se
  // puede resolver en dos pasos (ver NOTICE_KIND_LABELS)
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function translate<K extends MessageKey>(lang: Lang, key: K, ...args: TArgs<K>): string {
  const template = DICTIONARIES[lang][key] ?? DICTIONARIES[DEFAULT_LANG][key] ?? key;
  return interpolate(template, args[0], lang);
}

/** Traduce al idioma activo. Para codigo que no es un componente (validaciones, constantes). */
export const t: TFunction = (key, ...args) => translate(getLang(), key, ...args);

/** Texto de una clave dinamica, sin parametros (los marcadores quedan sin resolver). */
export function plain(key: MessageKey, lang: Lang = getLang()): string {
  return interpolate(
    DICTIONARIES[lang][key] ?? DICTIONARIES[DEFAULT_LANG][key] ?? key,
    undefined,
    lang,
  );
}

export function dictionaryFor(lang: Lang): Readonly<Dictionary> {
  return DICTIONARIES[lang];
}

// ── Formatos ─────────────────────────────────────────────────────────────────

export function getLocale(lang: Lang = getLang()): string {
  return LOCALES[lang];
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export function formatDate(iso: string | Date, lang: Lang = getLang()): string {
  return new Date(iso).toLocaleDateString(LOCALES[lang], DATE_OPTIONS);
}

export function formatTime(iso: string | Date, lang: Lang = getLang()): string {
  return new Date(iso).toLocaleTimeString(LOCALES[lang], TIME_OPTIONS);
}

export function formatDateTime(iso: string | Date, lang: Lang = getLang()): string {
  return new Date(iso).toLocaleString(LOCALES[lang], { ...DATE_OPTIONS, ...TIME_OPTIONS });
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  lang: Lang = getLang(),
): string {
  return new Intl.NumberFormat(LOCALES[lang], options).format(value);
}

/** "hace 3 dias" / "3 days ago"; menos de un minuto: "ahora mismo" / "just now". */
export function formatRelativeTime(iso: string, lang: Lang = getLang(), now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const rtf = new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: "always" });
  if (days > 0) return rtf.format(-days, "day");
  if (hours > 0) return rtf.format(-hours, "hour");
  if (minutes > 0) return rtf.format(-minutes, "minute");
  return translate(lang, "time.justNow");
}
