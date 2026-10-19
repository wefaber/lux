import {
  dictionaryFor,
  getLang,
  interpolate,
  plain,
  type Lang,
  type MessageKey,
  type Params,
} from ".";

// La API (y el mock) responden en espanol. Para mostrar el error en el idioma
// activo se prueba, en este orden:
//   1. el codigo (`extensions.code`), si esta en ERROR_CODE_KEYS
//   2. la plantilla de algun mensaje conocido ("error.*" y "validation.*" del
//      diccionario espanol), con sus {parametros}
//   3. el texto original, sin tocar
// Asi un mensaje nuevo en la API nunca se rompe: a lo sumo se ve en espanol.

/** Codigos que la API manda en `extensions.code` y el texto que les corresponde. */
export const ERROR_CODE_KEYS: Record<string, MessageKey> = {
  UNAUTHENTICATED: "error.unauthenticated",
  FORBIDDEN: "error.forbidden",
  INVALID_CREDENTIALS: "error.invalidCredentials",
};

const MESSAGE_PREFIXES = ["error.", "validation."];
// Los parametros que son etiquetas de dominio ("Marca", "En progreso", "aprobar")
// se traducen tambien: se reconocen por su texto en espanol
const LABEL_PREFIXES = ["field.", "status.", "role.", "verb.", "locationKind.", "equipmentKind."];

interface Matcher {
  key: MessageKey;
  regex: RegExp;
  names: string[];
  weight: number;
}

let matchers: Matcher[] | null = null;
let labelKeys: Map<string, MessageKey> | null = null;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "No se puede {action} una reserva \"{status}\"" -> regex con un grupo por marcador
function compile(key: MessageKey, template: string): Matcher {
  const names: string[] = [];
  const parts = template.split(/\{(\w+)\}/);
  const source = parts
    .map((part, i) => {
      if (i % 2 === 0) return escapeRegex(part);
      names.push(part);
      return "(.+?)";
    })
    .join("");
  const literal = parts.filter((_, i) => i % 2 === 0).join("").length;
  return { key, regex: new RegExp(`^${source}$`, "s"), names, weight: literal };
}

function getMatchers(): Matcher[] {
  if (matchers) return matchers;
  const es = dictionaryFor("es");
  matchers = (Object.keys(es) as MessageKey[])
    .filter((key) => MESSAGE_PREFIXES.some((p) => key.startsWith(p)))
    .map((key) => compile(key, es[key]))
    // Primero las plantillas con mas texto fijo: la mas especifica gana
    .toSorted((a, b) => b.weight - a.weight);
  return matchers;
}

function getLabelKeys(): Map<string, MessageKey> {
  if (labelKeys) return labelKeys;
  const es = dictionaryFor("es");
  labelKeys = new Map();
  for (const key of Object.keys(es) as MessageKey[]) {
    if (!LABEL_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (!labelKeys.has(es[key])) labelKeys.set(es[key], key);
  }
  return labelKeys;
}

function translateParam(value: string, lang: Lang): string {
  const key = getLabelKeys().get(value);
  return key ? plain(key, lang) : value;
}

/** Traduce el mensaje de error de la API al idioma activo (o `lang`). */
export function translateError(message: string, code?: string, lang: Lang = getLang()): string {
  const codeKey = code ? ERROR_CODE_KEYS[code] : undefined;
  if (codeKey) return plain(codeKey, lang);
  if (lang === "es") return message; // la API ya habla espanol
  for (const { key, regex, names } of getMatchers()) {
    const match = regex.exec(message);
    if (!match) continue;
    const params: Params = {};
    names.forEach((name, i) => {
      params[name] = translateParam(match[i + 1], lang);
    });
    return interpolate(dictionaryFor(lang)[key], params, lang);
  }
  return message;
}
