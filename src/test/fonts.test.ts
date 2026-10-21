import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// La fuente para dislexia se rompio dos veces por motivos que no se ven en el
// navegador: el @import a un CDN externo (sin red no hay fuente) y las
// variables de @theme auto-referenciadas (--font-sans: var(--font-sans)), que
// dejan la familia sin valor. Estas pruebas fijan esas dos cosas y que los
// archivos auto-hospedados esten realmente en public/fonts.

const SRC = join(import.meta.dir, "..");
// Los comentarios de index.css explican justamente lo que se rompio (el CDN,
// las variables auto-referenciadas): se sacan para no matchear esas palabras.
const CSS = readFileSync(join(SRC, "index.css"), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
const FONT_DIR = join(SRC, "..", "public", "fonts");

const fontFaces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const openDyslexic = fontFaces.filter((face) => /font-family:\s*"OpenDyslexic"/.test(face));

describe("fuente para dislexia", () => {
  test("se declara local, con los cuatro pesos y estilos y font-display swap", () => {
    const combinaciones = openDyslexic
      .map((face) => {
        const weight = /font-weight:\s*(\d+)/.exec(face)?.[1];
        const style = /font-style:\s*(\w+)/.exec(face)?.[1];
        return `${weight} ${style}`;
      })
      .toSorted();
    expect(combinaciones).toEqual(["400 italic", "400 normal", "700 italic", "700 normal"]);
    for (const face of openDyslexic) expect(face).toContain("font-display: swap");
  });

  test("los archivos son locales y existen en public/fonts", () => {
    const urls = openDyslexic.flatMap((face) =>
      [...face.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replaceAll(/["']/g, "").trim()),
    );
    expect(urls.length).toBe(4);
    for (const url of urls) {
      // Nada de http(s): en un aula sin salida a internet la fuente no carga
      expect(url.startsWith("/fonts/")).toBe(true);
      const file = join(FONT_DIR, url.slice("/fonts/".length));
      expect(existsSync(file)).toBe(true);
      // wOF2: un archivo copiado a medias o una pagina de error no sirve
      expect(readFileSync(file).subarray(0, 4).toString("latin1")).toBe("wOF2");
    }
  });

  test("no queda ningun @import externo para OpenDyslexic", () => {
    const imports = [...CSS.matchAll(/@import\s+[^;]+;/g)].map((m) => m[0]);
    const externos = imports.filter((line) => /opendyslexic|fontsource|jsdelivr/i.test(line));
    expect(externos).toEqual([]);
  });

  test("las variables de tipografia no se auto-referencian", () => {
    for (const name of ["--font-sans", "--font-serif", "--font-mono"]) {
      expect(CSS).not.toContain(`${name}: var(${name})`);
    }
  });

  test("el modo dislexico cambia la familia de todo el texto y le da mas aire", () => {
    const block = /html\[data-dyslexic="true"\]\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    // Familia y utilidades font-*: alcanza body, botones, inputs y tablas
    for (const token of ["--font-family", "--font-sans", "--font-serif", "--font-mono"]) {
      expect(block).toContain(`${token}: var(--font-dyslexic)`);
    }
    // Escala legible: interletrado propio y line-height mas alto en los text-*
    expect(block).toMatch(/--tracking-normal:\s*0\.0[1-9]/);
    expect(block).toMatch(/--text-sm--line-height:\s*calc\(/);
    // word-spacing incluye los controles de formulario, que no lo heredan
    expect(CSS).toMatch(
      /html\[data-dyslexic="true"\] :where\([^)]*button[^)]*\)\s*\{[^}]*word-spacing/,
    );
    // La pila incluye la fuente instalada y la sans del sistema como respaldo
    expect(CSS).toMatch(/--font-dyslexic:\s*"OpenDyslexic",\s*"OpenDyslexic2"/);
    // El body toma la familia de las variables (todo lo demas hereda)
    expect(CSS).toMatch(/font-family:\s*var\(--font-family,\s*var\(--font-sans\)\)/);
  });
});
