/* oxlint-disable eslint/no-await-in-loop -- un navegador se maneja de a un paso por vez */
// Verificacion de i18n en un navegador real (Chromium + Playwright).
//
// Recorre las pantallas principales de cada rol con la interfaz en ingles (o en
// el idioma de --lang), junta el texto visible y los atributos accesibles
// (placeholder, title, aria-label, alt), y busca palabras en espanol que no
// vengan de los datos de ejemplo. Tambien busca claves del diccionario que
// hayan quedado a la vista (un "tickets.list.empty" suelto es una clave sin
// resolver) y comprueba que el selector de idioma persista.
//
// Uso:
//   bun scripts/i18n-verify.ts                 # levanta vite solo y recorre en ingles
//   bun scripts/i18n-verify.ts --lang es       # mismo recorrido en espanol (busca claves sueltas)
//   bun scripts/i18n-verify.ts --out /tmp/i18n # carpeta para capturas y volcado JSON
//   LUX_URL=http://localhost:5173 bun scripts/i18n-verify.ts   # usar un servidor ya levantado
//
// Navegador: /opt/pw-browsers/chromium (o PW_CHROMIUM). No hace falta
// `playwright install`. Sale con codigo 1 si queda algo sin traducir.
//
// Limites: es una heuristica. Detecta espanol por tildes y por una lista de
// palabras de interfaz, asi que una frase sin tildes ni esas palabras pasa. Los
// datos de ejemplo (nombres, titulos de tickets, etc.) se descuentan porque no
// se traducen a proposito. Solo recorre lo que alcanza sin cargar datos nuevos:
// un estado que exija un flujo largo (ej. un error de servidor real) no se ve.

import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { es } from "../src/i18n/es";
import { mockUsers, mockPasswords } from "../src/mocks/data/users";
import { mockProducts, mockComponents } from "../src/mocks/data/equipment";
import { mockLocations } from "../src/mocks/data/locations";
import { mockTickets } from "../src/mocks/data/tickets";
import { mockServices } from "../src/mocks/data/services";
import { mockLoans } from "../src/mocks/data/loans";
import { mockReservations } from "../src/mocks/data/reservations";
import { mockComments } from "../src/mocks/data/comments";
import { mockInterventions } from "../src/mocks/data/interventions";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LANG = flag("lang", "en");
const OUT = flag("out", "/tmp/lux-i18n-verify");
const PORT = 5199;
const BASE = process.env.LUX_URL ?? `http://localhost:${PORT}`;
const CHROMIUM = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";

// ── Datos de ejemplo: no se traducen, se descuentan antes de buscar espanol ──

function strings(value: unknown, into: Set<string>) {
  if (typeof value === "string") {
    if (value.trim().length >= 3) into.add(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) strings(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) strings(item, into);
  }
}
const DATA = new Set<string>();
for (const source of [
  mockUsers,
  mockProducts,
  mockComponents,
  mockLocations,
  mockTickets,
  mockServices,
  mockLoans,
  mockReservations,
  mockComments,
  mockInterventions,
]) {
  strings(source, DATA);
}
// El saludo usa solo el nombre de pila ("Hello, Nicolás"): tambien es un dato
for (const usuario of mockUsers) {
  for (const parte of usuario.name.split(/\s+/)) if (parte.length >= 3) DATA.add(parte);
}
// Las mas largas primero: "Laboratorio 1 - Planta baja" antes que "Laboratorio"
const DATA_SORTED = [...DATA].toSorted((a, b) => b.length - a.length);

// Texto que no es de la interfaz y se acepta tal cual (nombres de producto,
// siglas, cosas que la API devuelve como dato). Agregar con motivo.
const ALLOWED = new Set<string>([
  "Lux", // nombre del producto
  "Español", // el selector nombra cada idioma en ese idioma
]);

// ── Deteccion de espanol ─────────────────────────────────────────────────────

const PALABRAS = new Set(
  (
    "el la los las del para por con sin una uno hay nuevo nueva todos todas cargando buscar " +
    "guardar cancelar crear editar eliminar volver usuario usuarios equipo equipos estado " +
    "estados fecha descripcion nombre aprobar rechazar enviar cerrar siguiente anterior " +
    "pendiente resuelto activo inactivo prestamo prestamos solicitud solicitudes reserva " +
    "reservas ubicacion ubicaciones motivo cedula contrasena ingresar ingresa elegi escribi " +
    "ninguno ninguna dias horas ayer inicio perfil salir ayuda reportes devolucion " +
    "vencido vencidos entregar entregado devuelto aprobado rechazado cancelado tecnico " +
    "administrador solicitante inventario ticket tickets comentarios comentario titulo " +
    "categoria modelo marca serie laboratorio salon otro otra"
  ).split(" "),
);
// "ticket", "modelo"... se escriben igual en ingles: solo cuentan si aparecen con
// otra palabra de la lista o con una tilde
const AMBIGUAS = new Set(["ticket", "tickets", "modelo", "marca", "otro", "otra", "laboratorio"]);

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// Las tablas recortan textos largos con "…": la celda es un dato si lo que queda
// antes del "…" es el comienzo de algun dato de ejemplo
function esDatoRecortado(celda: string): boolean {
  if (!celda.endsWith("…")) return false;
  const inicio = celda.slice(0, -1).trim();
  return inicio.length >= 12 && DATA_SORTED.some((dato) => dato.startsWith(inicio));
}

function descontarDatos(linea: string): string {
  // innerText separa las celdas de una tabla con tabuladores
  let resto = linea
    .split("\t")
    .filter((celda) => !esDatoRecortado(celda))
    .join("\t");
  for (const dato of DATA_SORTED) {
    if (resto.includes(dato)) resto = resto.replaceAll(dato, " ");
  }
  return resto;
}

export function espanolEn(linea: string): string[] {
  if (ALLOWED.has(linea.trim())) return [];
  const resto = descontarDatos(linea);
  const hallazgos = new Set<string>();
  for (const palabra of resto.match(/[\p{L}¿¡]+/gu) ?? []) {
    if (/[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(palabra)) hallazgos.add(palabra);
  }
  const palabras = (
    sinTildes(resto)
      .toLowerCase()
      .match(/[a-z]+/g) ?? []
  ).filter(Boolean);
  const claras = palabras.filter((p) => PALABRAS.has(p) && !AMBIGUAS.has(p));
  for (const p of claras) hallazgos.add(p);
  return [...hallazgos];
}

const CLAVES = new Set<string>(Object.keys(es));

// ── Recorrido ────────────────────────────────────────────────────────────────

interface Captura {
  rol: string;
  ruta: string;
  paso: string;
  lineas: string[];
  atributos: string[];
  htmlLang: string;
  titulo: string;
}

interface Hallazgo {
  rol: string;
  ruta: string;
  paso: string;
  tipo: "espanol" | "clave" | "vacia";
  texto: string;
  detalle: string[];
}

const capturas: Captura[] = [];
const hallazgos: Hallazgo[] = [];

async function leer(page: Page, rol: string, ruta: string, paso: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // La pagina puede estar todavia montando (Vite recarga al optimizar dependencias)
  await page
    .waitForFunction(() => document.body.innerText.trim().length > 20, null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(700); // animaciones de entrada y skeletons
  const { lineas, atributos, htmlLang, titulo } = await page.evaluate(() => {
    const texto = document.body.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const attrs: string[] = [];
    for (const el of document.querySelectorAll("[placeholder],[title],[aria-label],[alt]")) {
      for (const a of ["placeholder", "title", "aria-label", "alt"]) {
        const v = el.getAttribute(a);
        if (v) attrs.push(v.trim());
      }
    }
    return {
      lineas: texto,
      atributos: attrs,
      htmlLang: document.documentElement.lang,
      titulo: document.title,
    };
  });
  const captura: Captura = { rol, ruta, paso, lineas, atributos, htmlLang, titulo };
  capturas.push(captura);
  if (lineas.length === 0) {
    hallazgos.push({ rol, ruta, paso, tipo: "vacia", texto: "(pantalla sin texto)", detalle: [] });
  }
  for (const texto of new Set([...lineas, ...atributos, titulo])) {
    if (CLAVES.has(texto)) {
      hallazgos.push({ rol, ruta, paso, tipo: "clave", texto, detalle: [] });
      continue;
    }
    if (LANG !== "en") continue;
    const hit = espanolEn(texto);
    if (hit.length > 0) hallazgos.push({ rol, ruta, paso, tipo: "espanol", texto, detalle: hit });
  }
  const archivo = `${rol}${ruta.replaceAll("/", "_")}${paso ? "." + paso : ""}.png`.replaceAll(
    /[?=&]/g,
    "-",
  );
  await page.screenshot({ path: join(OUT, archivo), fullPage: true });
}

async function ir(page: Page, rol: string, ruta: string, paso = "") {
  await page.goto(`${BASE}${ruta}`);
  await leer(page, rol, ruta, paso);
}

// Envia el formulario abierto vacio: muestra los mensajes de validacion
async function enviarVacio(page: Page, rol: string, ruta: string, paso: string) {
  const boton = page.locator('[role="dialog"] button[type="submit"], form button[type="submit"]');
  if ((await boton.count()) === 0) return;
  await boton
    .first()
    .click({ force: true })
    .catch(() => {});
  await leer(page, rol, ruta, paso);
}

// Abre los dialogos que cuelgan de los botones de la pantalla (aprobar, rechazar,
// cancelar, editar...) y captura su texto. Solo abre: el que ejecuta algo directo
// cambia datos del mock en este navegador, que son descartables.
async function abrirAcciones(page: Page, rol: string, ruta: string) {
  await page.goto(`${BASE}${ruta}`);
  await page.waitForTimeout(900);
  const botones = page.locator("main button:visible:not([disabled])");
  const total = Math.min(await botones.count(), 14);
  for (let i = 0; i < total; i++) {
    const boton = page.locator("main button:visible:not([disabled])").nth(i);
    const nombre = (
      (await boton.getAttribute("aria-label")) ?? (await boton.innerText().catch(() => ""))
    )
      .trim()
      .slice(0, 30);
    if (
      /^(es|en)$/i.test(nombre) ||
      /csv|download|sign out|log out|theme|dark mode|collapse|font size/i.test(nombre)
    ) {
      continue;
    }
    try {
      await boton.click({ timeout: 2000 });
      await page.waitForTimeout(400);
      if ((await page.locator('[role="dialog"], [role="alertdialog"]').count()) > 0) {
        await leer(page, rol, ruta, `accion-${i}-${nombre.replace(/\W+/g, "_")}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      if (!page.url().endsWith(ruta)) await page.goto(`${BASE}${ruta}`);
    } catch {
      /* el boton cambio de lugar o ya no esta: se sigue con el proximo */
    }
  }
}

async function login(context: BrowserContext, dni: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#dni", dni);
  await page.fill("#password", mockPasswords[dni]);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 15_000 });
  return page;
}

const usuario = (rol: string) => mockUsers.find((u) => u.role === rol && u.isActive)!;
const ticketId = mockTickets[0].id;
const servicioId = mockServices[0].id;
const productoId = mockProducts[0].id;
const componenteId = mockComponents[0].id;

const COMUNES = [
  "/dashboard",
  "/dashboard/inventory",
  `/dashboard/inventory/${productoId}`,
  `/dashboard/inventory/componente/${componenteId}`,
  "/dashboard/equipment-status",
  "/dashboard/tickets",
  `/dashboard/tickets/${ticketId}`,
  "/dashboard/loans",
  "/dashboard/service-requests",
  `/dashboard/service-requests/${servicioId}`,
  "/dashboard/reservations",
  "/dashboard/profile",
];
const STAFF = [
  "/dashboard/locations",
  "/dashboard/tickets/ool",
  "/dashboard/inventory/nuevo",
  "/dashboard/inventory/nuevo-componente",
  `/dashboard/inventory/${productoId}/editar`,
];
const ADMIN = ["/admin", "/admin/users", "/admin/roles", "/admin/logs", "/admin/reports"];
const FORMULARIOS = [
  "/dashboard/tickets?nuevo=1",
  "/dashboard/service-requests?nuevo=1",
  "/dashboard/reservations?nuevo=1",
];

async function recorrer(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const roles: Array<{ rol: string; rutas: string[] }> = [
    { rol: "solicitante", rutas: [...COMUNES, ...FORMULARIOS] },
    { rol: "tecnico", rutas: [...COMUNES, ...STAFF, ...FORMULARIOS] },
    { rol: "root_admin", rutas: [...COMUNES, ...STAFF, ...ADMIN, ...FORMULARIOS] },
  ];
  for (const { rol, rutas } of roles) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await context.addInitScript((lang) => {
      try {
        if (!localStorage.getItem("lux_lang")) localStorage.setItem("lux_lang", lang);
      } catch {
        /* sin storage: queda el idioma del navegador */
      }
    }, LANG);
    const page = await login(context, usuario(rol).dni);
    console.log(`- ${rol}: sesion iniciada`);
    for (const ruta of rutas) {
      await ir(page, rol, ruta);
      if (ruta.includes("nuevo=1") || ruta.endsWith("/nuevo") || ruta.endsWith("/editar")) {
        await enviarVacio(page, rol, ruta, "validacion");
      }
    }
    // Dialogos de acciones sobre las filas de las listas
    const accionables = [
      "/dashboard/reservations",
      "/dashboard/loans",
      "/dashboard/service-requests",
      "/dashboard/tickets",
    ];
    for (const ruta of accionables) await abrirAcciones(page, rol, ruta);
    if (rol !== "solicitante") {
      for (const ruta of [
        "/dashboard/locations",
        "/dashboard/inventory",
        `/dashboard/inventory/${productoId}`,
        `/dashboard/tickets/${ticketId}`,
      ]) {
        await abrirAcciones(page, rol, ruta);
      }
    }
    if (rol === "root_admin") await abrirAcciones(page, rol, "/admin/users");
    // Pantalla de prestamos: abrir el formulario de alta
    await page.goto(`${BASE}/dashboard/loans`);
    const nuevo = page.getByRole("button", { name: /(request|register|new) loan/i });
    if ((await nuevo.count()) > 0) {
      await nuevo.first().click();
      await leer(page, rol, "/dashboard/loans", "formulario");
      await enviarVacio(page, rol, "/dashboard/loans", "validacion");
    }
    await context.close();
  }
}

// Sin sesion: login, splash, espera y paginas de error
async function recorrerPublico(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await context.addInitScript((lang) => {
    try {
      if (!localStorage.getItem("lux_lang")) localStorage.setItem("lux_lang", lang);
    } catch {
      /* igual que arriba */
    }
  }, LANG);
  const page = await context.newPage();
  for (const ruta of ["/", "/login", "/wait", "/403", "/404", "/500", "/ruta-que-no-existe"]) {
    await ir(page, "publico", ruta);
  }
  // Credenciales equivocadas: mensaje de error del login
  await page.goto(`${BASE}/login`);
  await page.fill("#dni", "99999999");
  await page.fill("#password", "mala-clave");
  await page.click('button[type="submit"]');
  await leer(page, "publico", "/login", "credenciales-malas");
  await page.fill("#dni", "");
  await page.click('button[type="submit"]');
  await leer(page, "publico", "/login", "validacion");
  await context.close();
}

// El selector cambia el idioma, lo recuerda tras recargar y fija <html lang>
async function verificarSelector(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const fallos: string[] = [];
  const context = await browser.newContext({ locale: "fr-FR" });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(500);
  const inicial = await page.evaluate(() => document.documentElement.lang);
  if (inicial !== "es")
    fallos.push(`sin preferencia y navegador fr, <html lang> esperado es y fue ${inicial}`);

  const selector = page
    .getByRole("radio", { name: /english/i })
    .or(page.getByRole("button", { name: /english/i }));
  if ((await selector.count()) === 0) {
    fallos.push("no se encontro el selector de idioma en el login");
  } else {
    await selector.first().click();
    await page.waitForTimeout(400);
    const tras = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      guardado: localStorage.getItem("lux_lang"),
    }));
    if (tras.lang !== "en" || tras.guardado !== "en") {
      fallos.push(`tras elegir English: html lang=${tras.lang}, lux_lang=${tras.guardado}`);
    }
    await page.reload();
    await page.waitForTimeout(500);
    const recargado = await page.evaluate(() => document.documentElement.lang);
    if (recargado !== "en")
      fallos.push(`tras recargar, <html lang> esperado en y fue ${recargado}`);
  }
  await context.close();

  const ingles = await browser.newContext({ locale: "en-US" });
  const paginaIngles = await ingles.newPage();
  await paginaIngles.goto(`${BASE}/login`);
  await paginaIngles.waitForTimeout(500);
  const detectado = await paginaIngles.evaluate(() => document.documentElement.lang);
  if (detectado !== "en")
    fallos.push(`navegador en-US sin preferencia: lang esperado en y fue ${detectado}`);
  await ingles.close();
  return fallos;
}

async function esperarServidor() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* todavia no */
    }
    await Bun.sleep(500);
  }
  throw new Error(`el servidor no respondio en ${BASE}`);
}

mkdirSync(OUT, { recursive: true });
let servidor: ReturnType<typeof Bun.spawn> | null = null;
if (!process.env.LUX_URL) {
  servidor = Bun.spawn(["bunx", "vite", "--port", String(PORT), "--strictPort"], {
    cwd: join(import.meta.dir, ".."),
    stdout: "ignore",
    stderr: "ignore",
  });
}

let codigo = 0;
try {
  await esperarServidor();
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  console.log(`Idioma: ${LANG} | ${BASE} | salida: ${OUT}`);
  await recorrerPublico(browser);
  await recorrer(browser);
  const selector = LANG === "en" ? await verificarSelector(browser) : [];
  await browser.close();

  writeFileSync(join(OUT, "capturas.json"), JSON.stringify(capturas, null, 2));
  writeFileSync(join(OUT, "hallazgos.json"), JSON.stringify(hallazgos, null, 2));

  const pantallas = new Set(
    capturas.map((c) => `${c.rol} ${c.ruta}${c.paso ? " [" + c.paso + "]" : ""}`),
  );
  const langs = new Set(capturas.map((c) => c.htmlLang));
  console.log(
    `\nPantallas capturadas: ${pantallas.size} | <html lang> vistos: ${[...langs].join(", ")}`,
  );
  const unicos = new Map<string, Hallazgo>();
  for (const h of hallazgos) unicos.set(`${h.tipo}|${h.texto}`, h);
  for (const h of unicos.values()) {
    console.log(
      `[${h.tipo}] ${h.rol} ${h.ruta}${h.paso ? " [" + h.paso + "]" : ""}: "${h.texto}" ${h.detalle.join(",")}`,
    );
  }
  for (const f of selector) console.log(`[selector] ${f}`);
  console.log(`\nHallazgos distintos: ${unicos.size} | fallos del selector: ${selector.length}`);
  if (unicos.size > 0 || selector.length > 0) codigo = 1;
} catch (error) {
  console.error(error);
  codigo = 2;
} finally {
  servidor?.kill();
}
process.exit(codigo);
