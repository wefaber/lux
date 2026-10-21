import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Heuristica: busca literales en espanol que quedaron escritos a mano en los
// componentes en vez de salir del diccionario (src/i18n). NO es una prueba de
// que todo este traducido. Limites conocidos:
//   - solo mira literales entre comillas, plantillas y texto JSX; un texto
//     armado por partes ("Hola " + nombre) o que viene de la API no se ve
//   - detecta espanol por tildes, por " ¿ ¡ ñ " o por una lista corta de
//     palabras de interfaz: una frase sin tildes ni esas palabras pasa
//   - ignora src/i18n (es la fuente), src/mocks (datos de ejemplo y textos
//     de la "API"), src/test y los *.test.*
// Si una frase legitima da falso positivo, agregarla a EXCEPCIONES con el motivo.

const SRC = join(import.meta.dir, "..");

// archivo relativo a src -> literales exactos permitidos
const EXCEPCIONES: Record<string, string[]> = {};

const PALABRAS = new Set(
  (
    "el la los las del para por con sin una uno hay nuevo nueva buscar guardar cancelar crear " +
    "editar eliminar todos todas volver cargando usuario usuarios equipo equipos estado fecha " +
    "descripcion nombre aprobar rechazar enviar cerrar siguiente anterior pendiente resuelto " +
    "activo inactivo contrasena prestamo prestamos solicitud solicitudes reserva reservas " +
    "ubicacion motivo cedula elegi escribi ingresa error"
  ).split(" "),
);

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    const rel = relative(SRC, ruta).replaceAll("\\", "/");
    if (entrada.isDirectory()) {
      if (["i18n", "mocks", "test"].includes(rel.split("/")[0])) continue;
      salida.push(...archivos(ruta));
    } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      salida.push(ruta);
    }
  }
  return salida;
}

// Saca los comentarios (que estan en espanol a proposito) sin tocar "https://"
function sinComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .split("\n")
    .map((linea) => linea.replace(/(^|[\s;{(,])\/\/.*$/, "$1"))
    .join("\n");
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function pareceEspanol(texto: string): boolean {
  if (/[¿¡ñÑ]/.test(texto)) return true;
  if (/[áéíóúÁÉÍÓÚ]/.test(texto)) return true;
  const palabras = sinTildes(texto)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  // Una palabra sola ("nuevo", "hardware") suele ser un valor de datos: se
  // pide una frase con al menos una palabra de la lista
  return palabras.length >= 2 && palabras.some((p) => PALABRAS.has(p));
}

function sospechosos(codigo: string): string[] {
  const limpio = sinComentarios(codigo);
  const encontrados: string[] = [];
  // Literales entre comillas o backticks, en una sola linea
  for (const m of limpio.matchAll(/"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`/g)) {
    const texto = m[1] ?? m[2] ?? m[3];
    // Rutas, ids y clases sueltas (sin espacios) no son frases: solo cuentan con tildes
    if (!/\s/.test(texto.trim()) && !/[áéíóúñ¿¡]/i.test(texto)) continue;
    if (pareceEspanol(texto)) encontrados.push(texto.trim());
  }
  // Texto JSX entre etiquetas: >Texto aca<
  for (const m of limpio.matchAll(/>([^<>{}\n]*[A-Za-zÁÉÍÓÚáéíóúñ][^<>{}\n]*)</g)) {
    if (pareceEspanol(m[1])) encontrados.push(m[1].trim());
  }
  // Renglon que es solo texto JSX (el formateador parte los textos largos)
  for (const linea of limpio.split("\n")) {
    if (
      /^\s*[A-ZÁÉÍÓÚ¿¡][^<>{}=;()"`]*[a-zñáéíóú.?!:]\s*$/.test(linea) &&
      /\s/.test(linea.trim())
    ) {
      if (!/^\s*(import|export|return|const|let|type|interface|case|default)\b/.test(linea)) {
        if (pareceEspanol(linea)) encontrados.push(linea.trim());
      }
    }
  }
  return encontrados;
}

describe("literales en espanol sin traducir", () => {
  test("detecta tildes, signos de apertura y palabras de interfaz", () => {
    expect(pareceEspanol("Guardar cambios")).toBe(true);
    expect(pareceEspanol("¿Seguro?")).toBe(true);
    expect(pareceEspanol("Descripción")).toBe(true);
    expect(pareceEspanol("Save changes")).toBe(false);
    expect(pareceEspanol("hardware")).toBe(false);
    expect(pareceEspanol("flex items-center gap-2")).toBe(false);
  });

  test("el detector ve un literal escrito a mano en JSX", () => {
    const codigo = `export const A = () => <p title="Cerrar ventana">Todavía no hay datos</p>;`;
    expect(sospechosos(codigo)).toEqual(["Cerrar ventana", "Todavía no hay datos"]);
  });

  test("ignora comentarios en espanol", () => {
    const codigo = `// Esto es un comentario con tildes: está bien\nconst a = 1; /* otro más */`;
    expect(sospechosos(codigo)).toEqual([]);
  });

  test("ningun componente ni modulo tiene literales en espanol sin pasar por el diccionario", () => {
    const hallazgos: string[] = [];
    for (const ruta of archivos(SRC)) {
      const rel = relative(SRC, ruta).replaceAll("\\", "/");
      const permitidos = EXCEPCIONES[rel] ?? [];
      for (const texto of sospechosos(readFileSync(ruta, "utf8").replaceAll("\r\n", "\n"))) {
        if (!permitidos.includes(texto)) hallazgos.push(`${rel}: ${texto}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });
});
