/* oxlint-disable no-await-in-loop, no-explicit-any -- el recorrido es secuencial a proposito; page.evaluate maneja el DOM sin tipos */
// Capturas del Manual de usuario (Ingenieria de Software, E3), tomadas del sistema REAL:
// frontend SIN mocks + API Bun/Elysia + PostgreSQL. Recorre los flujos de cada rol con
// Playwright y deja los PNG en la carpeta de imagenes del vault.
//
// Pasos para reproducirlo (desde la raiz del repo):
//   source <env con DATABASE_URL, AUTH_SECRET, PORT>           # ej. /home/claude/pg/env.sh lux_manual 4118
//   (cd api && bun install --frozen-lockfile && bun run db:migrate && bun run db:seed)
//   (cd api && NODE_ENV=production bun run start) &            # API real, modo produccion
//   VITE_ENABLE_MOCKS=false bunx vite build                    # el frontend NO arranca MSW
//   bun scripts/manual-serve.ts --port 4128 --api http://127.0.0.1:4118 &
//   bun scripts/manual-capturas.ts --base http://127.0.0.1:4128 --out <vault>/07-ASSETS/Imagenes/Manual
//
// El recorrido ESCRIBE en la base (crea tickets, prestamos, usuarios): hay que volver a
// sembrar (`bun run db:seed` en api/) antes de repetirlo. Las cuentas salen de
// src/mocks/data/users.ts (datos de ejemplo del seed); ningun documento ni contrasenia se
// escribe en el manual, y las capturas enmascaran las cedulas que aparezcan en pantalla.
// Optimizacion de PNG: ImageMagick (`convert`), si existe; si no, quedan sin optimizar.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mockPasswords, mockUsers } from "../src/mocks/data/users";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:4128").replace(/\/$/, "");
const OUT = arg("out", "./manual-out");
const CHROMIUM = arg("chromium", process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium");
// OpenDyslexic se pide a cdn.jsdelivr.net (src/index.css). Si el equipo de captura no llega a ese
// CDN, --dyslexic-dir apunta a node_modules/@fontsource/opendyslexic (mismo paquete) y se sirve de ahi.
const DYSLEXIC_DIR = arg("dyslexic-dir", "");
const OPTIMIZE = arg("optimize", "1") !== "0";
const ONLY = arg("only", "").split(",").filter(Boolean); // general,solicitante,tecnico,admin,root
const want = (s: string) => ONLY.length === 0 || ONLY.includes(s);
mkdirSync(OUT, { recursive: true });

const SEED_DNIS = mockUsers.map((u) => u.dni);
const manifest: { file: string; width: number }[] = [];
const counters: Record<string, number> = {};

const userOf = (role: string, index = 0) => mockUsers.filter((u) => u.role === role)[index]!;

// ---------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------

/** Reemplaza en pantalla las cedulas del seed (texto y valores de campos) por puntos. */
async function maskDocs(page: Page) {
  await page.evaluate((dnis) => {
    const mask = (s: string) => dnis.reduce((acc, d) => acc.split(d).join("········"), s);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const n of nodes) if (n.nodeValue && dnis.some((d) => n.nodeValue!.includes(d))) n.nodeValue = mask(n.nodeValue);
    for (const el of Array.from(document.querySelectorAll("input"))) {
      if (el.type !== "password" && dnis.some((d) => el.value.includes(d))) el.value = mask(el.value);
    }
  }, SEED_DNIS);
}

async function settle(page: Page, ms = 700) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms); // animaciones de entrada (spring) y skeletons
}

/** Captura el viewport (o la pagina entera) y registra el archivo. */
async function shot(page: Page, role: string, topic: string, opts: { full?: boolean; mask?: boolean; wait?: number } = {}) {
  await settle(page, opts.wait ?? 700);
  // Los contenedores que se desplazan vuelven arriba (un clic en un boton los habia movido)
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("*"))) if (el.scrollTop > 0 && !el.closest("[role=dialog]")) el.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  if (opts.mask !== false) await maskDocs(page);
  counters[role] = (counters[role] ?? 0) + 1;
  const file = `ManualUsuario-${role}-${String(counters[role]).padStart(2, "0")}-${topic}.png`;
  const vp = page.viewportSize()!;
  if (opts.full) {
    // El contenido se desplaza dentro de un contenedor (no del documento): se agranda el viewport
    const needed = await page.evaluate(() => {
      let max = document.documentElement.scrollHeight;
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const cs = getComputedStyle(el);
        if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
          max = Math.max(max, window.innerHeight + (el.scrollHeight - el.clientHeight));
        }
      }
      return max;
    });
    const height = Math.min(Math.max(needed + 8, vp.height), 2400);
    if (height > vp.height) await page.setViewportSize({ width: vp.width, height });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, file) });
    await page.setViewportSize(vp);
    await page.waitForTimeout(400); // el layout se reacomoda al volver al tamanio original
  } else {
    await page.screenshot({ path: join(OUT, file) });
  }
  manifest.push({ file, width: vp.width });
  console.log(`  captura ${file}`);
}

async function newCtx(browser: Browser, opts: { width?: number; height?: number; lang?: string } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    locale: opts.lang ?? "es-UY",
    timezoneId: "America/Montevideo",
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 },
  });
  if (DYSLEXIC_DIR) {
    await ctx.route(/cdn\.jsdelivr\.net\/fontsource\/fonts\/opendyslexic@latest\//, (route) => {
      const rel = new URL(route.request().url()).pathname.split("opendyslexic@latest/")[1]!;
      return route.fulfill({ path: join(DYSLEXIC_DIR, rel), headers: { "access-control-allow-origin": "*" } });
    });
  }
  return ctx;
}

async function login(page: Page, dni: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.fill("#dni", dni);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 15000 });
}
const loginAs = (page: Page, role: string, index = 0) => {
  const u = userOf(role, index);
  return login(page, u.dni, mockPasswords[u.dni]!);
};

async function go(page: Page, path: string) {
  await page.goto(`${BASE}${path}`);
  await settle(page, 400);
}

/** Elige una opcion de un buscador (SearchSelect) escribiendo y tocando la primera coincidencia. */
async function pickSearch(page: Page, selector: string, text: string) {
  await page.locator(selector).click();
  await page.locator(selector).fill(text);
  await page.locator('[role="option"]').first().click();
}

/** Elige una opcion de un desplegable (Radix Select) por su disparador. */
async function pickSelect(page: Page, trigger: ReturnType<Page["locator"]>, optionName: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: optionName }).first().click();
}

const dialog = (page: Page) => page.getByRole("dialog");
/** Espera a que el dialogo se cierre; si no, imprime lo que muestra (suele ser un error de validacion). */
async function closed(page: Page) {
  await dialog(page)
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(async (e) => {
      console.log("DIALOGO ABIERTO:", (await dialog(page).innerText()).replace(/\n+/g, " | "));
      throw e;
    });
}
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name });

/** datetime-local a partir de ahora + dias/horas, en hora local del navegador (Montevideo). */
function dt(days: number, hour: number, minute = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${parts}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------
// General: ingreso, errores, idioma
// ---------------------------------------------------------------------------------------
async function general(browser: Browser) {
  console.log("general");
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await shot(page, "general", "ingreso");

  // Campos vacios
  await btn(page, "Ingresar").click();

  // Cedula con formato invalido
  await page.fill("#dni", "123");
  await page.fill("#password", "abc");
  await btn(page, "Ingresar").click();

  // Credenciales incorrectas (documento inexistente: no consume el contador de las cuentas del seed)
  await page.fill("#dni", "99999999");
  await page.fill("#password", "clave-incorrecta");
  await page.click("button[aria-label='Mostrar contraseña']");
  await btn(page, "Ingresar").click();
  await shot(page, "general", "ingreso-credenciales-invalidas");

  // Ingles
  await page.getByRole("button", { name: "English" }).click();
  await shot(page, "general", "ingreso-ingles");
  await page.getByRole("button", { name: "Español" }).click();

  // Ruta que no existe y acceso denegado
  await go(page, "/ruta-que-no-existe");
  await ctx.close();

  // Telefono
  const m = await newCtx(browser, { width: 390, height: 844 });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/login`);
  await shot(mp, "general", "ingreso-movil");
  await m.close();
}

// ---------------------------------------------------------------------------------------
// Solicitante
// ---------------------------------------------------------------------------------------
async function solicitante(browser: Browser) {
  console.log("solicitante");
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await loginAs(page, "solicitante", 0);
  await shot(page, "solicitante", "inicio");

  // Menu de usuario (cierre de sesion)
  await page.locator("header button", { hasText: "Solicitante" }).click();
  await shot(page, "solicitante", "menu-usuario");
  await page.keyboard.press("Escape");

  // --- Reportar incidencia
  await go(page, "/dashboard/tickets");
  await btn(page, "Nuevo ticket").click();
  await dialog(page).getByPlaceholder("Descripción breve del problema").fill("El mouse de la PC 3 del laboratorio no responde");
  await dialog(page).getByPlaceholder("Describí el problema en detalle...").fill("Desde ayer el cursor no se mueve. Probé con otro puerto USB y sigue igual.");
  await pickSelect(page, dialog(page).getByRole("combobox").first(), "Hardware");
  const eq = dialog(page).getByRole("combobox").last();
  await eq.click();
  await eq.fill("L1-PC3");
  await page.locator('[role="option"]').first().click();
  await shot(page, "solicitante", "ticket-nuevo-formulario");
  await btn(page, "Enviar ticket").click();
  await closed(page);
  await shot(page, "solicitante", "ticket-creado-en-lista");

  // --- Seguimiento: detalle de solo lectura y comentario
  await page.getByRole("link", { name: /El mouse de la PC 3/ }).click();
  await page.waitForURL(/tickets\/tkt-/);
  await settle(page);
  await page.getByPlaceholder("Escribí un comentario...").fill("Si hace falta, la máquina queda libre esta tarde.");
  await btn(page, "Comentar").click();
  await page.getByText("Si hace falta, la máquina queda libre esta tarde.").waitFor();
  await shot(page, "solicitante", "ticket-comentario", { full: true });

  // Ticket con avance (seed): se ve diagnostico y trabajo realizado
  await go(page, "/dashboard/tickets/tkt-015");
  await shot(page, "solicitante", "ticket-resuelto-seguimiento", { full: true });

  // --- Prestamo
  await go(page, "/dashboard/loans");
  await btn(page, "Solicitar préstamo").click();
  await dialog(page).locator("#loan-equipment").click();
  await page.getByRole("option").first().click();
  await dialog(page).locator("#loan-issue").fill(dt(2, 9));
  await dialog(page).locator("#loan-return").fill(dt(4, 17));
  await shot(page, "solicitante", "prestamo-solicitar");
  await dialog(page).getByRole("button", { name: "Solicitar préstamo" }).click();
  await closed(page);
  await pickSelect(page, page.getByRole("combobox", { name: "Filtrar por estado" }), "Pendiente");
  await shot(page, "solicitante", "prestamo-solicitado");

  // --- Solicitud de servicio
  await go(page, "/dashboard/service-requests");
  await btn(page, "Nueva solicitud").click();
  await dialog(page).getByRole("button", { name: "Instalación de software" }).click();
  await dialog(page).locator("#software").fill("Wireshark 4.4");
  await dialog(page).locator("#description").fill("Hace falta para la práctica de análisis de tráfico de la semana próxima en los equipos del laboratorio 1.");
  await shot(page, "solicitante", "solicitud-nueva-formulario");
  await dialog(page).getByRole("button", { name: "Enviar solicitud" }).click();
  await closed(page);
  await page.getByPlaceholder("Buscar por descripción, tipo o ID (svc-004)...").fill("análisis de tráfico");
  await settle(page, 500);
  await page.getByRole("link", { name: "Ver detalle" }).first().click();
  await page.waitForURL(/service-requests\/svc-/);
  await shot(page, "solicitante", "solicitud-detalle", { full: true });

  // --- Reservas
  await go(page, "/dashboard/reservations");
  await btn(page, "Nueva reserva").click();
  await dialog(page).getByRole("radio", { name: "Espacio" }).click();
  await pickSearch(page, "#rsv-resource", "laboratorio 2");
  await dialog(page).locator("#rsv-start").fill(dt(3, 14));
  await dialog(page).locator("#rsv-end").fill(dt(3, 16));
  await dialog(page).locator("#rsv-purpose").fill("Evaluación práctica de bases de datos");
  await shot(page, "solicitante", "reserva-nueva-formulario");
  await dialog(page).getByRole("button", { name: "Pedir reserva" }).click();
  await closed(page);

  // Error frecuente: fecha de inicio en el pasado
  await btn(page, "Nueva reserva").click();
  await dialog(page).getByRole("radio", { name: "Espacio" }).click();
  await pickSearch(page, "#rsv-resource", "laboratorio 2");
  await dialog(page).locator("#rsv-start").fill(dt(-1, 9));
  await dialog(page).locator("#rsv-end").fill(dt(-1, 11));
  await dialog(page).locator("#rsv-purpose").fill("Prueba con fecha pasada");
  await dialog(page).getByRole("button", { name: "Pedir reserva" }).click();
  await settle(page, 500);
  await shot(page, "solicitante", "reserva-error-fecha-pasada");
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();
  await closed(page);

  // Cancelar la reserva propia (la accion es un icono con tooltip)
  const cancelBtn = page.getByRole("row", { name: /Laboratorio 2/ }).getByRole("button", { name: "Cancelar", exact: true });
  await cancelBtn.hover();
  await settle(page, 600);
  await cancelBtn.click();
  await settle(page, 500);
  await shot(page, "solicitante", "reserva-cancelar");
  await page.keyboard.press("Escape");

  // --- Acceso denegado a la zona de administracion
  await go(page, "/admin");
  await shot(page, "solicitante", "acceso-denegado");

  // --- Perfil, contrasenia y accesibilidad
  await go(page, "/dashboard/profile");
  await shot(page, "solicitante", "perfil", { full: true });

  // Error frecuente: contrasenias que no coinciden
  await page.locator("#current-pw").fill("clave-actual");
  await page.locator("#new-pw").fill("nueva-clave-1");
  await page.locator("#confirm-pw").fill("otra-clave-2");
  await btn(page, "Actualizar contraseña").click();
  await shot(page, "solicitante", "perfil-contrasenias-distintas", { full: true });

  // Accesibilidad: oscuro, alto contraste, fuente muy grande, OpenDyslexic
  await go(page, "/dashboard");
  await page.getByRole("button", { name: "Cambiar a modo oscuro" }).click();
  await shot(page, "solicitante", "modo-oscuro");
  await page.getByRole("button", { name: "Cambiar a modo claro" }).click();
  await go(page, "/dashboard/profile");
  await page.getByRole("button", { name: "Alternar alto contraste" }).first().click();
  await go(page, "/dashboard/tickets");
  await shot(page, "solicitante", "alto-contraste");
  await go(page, "/dashboard/profile");
  await page.getByRole("button", { name: "Alternar alto contraste" }).first().click();
  await go(page, "/dashboard/tickets");
  await page.getByRole("button", { name: "Tamaño de fuente muy grande" }).first().click();
  await shot(page, "solicitante", "fuente-muy-grande");
  await page.getByRole("button", { name: "Tamaño de fuente mediano" }).first().click();
  await go(page, "/dashboard/profile");
  await page.getByRole("switch").click();
  await page.waitForTimeout(1200); // la fuente se descarga al activar el modo
  await go(page, "/dashboard/tickets");
  await shot(page, "solicitante", "fuente-opendyslexic", { wait: 1500 });
  await go(page, "/dashboard/profile");
  await page.getByRole("switch").click();

  // Idioma ingles
  await go(page, "/dashboard");
  await page.getByRole("button", { name: "English" }).first().click();
  await shot(page, "solicitante", "idioma-ingles");
  await page.getByRole("button", { name: "Español" }).first().click();

  // Cierre de sesion
  await page.locator("header button", { hasText: "Solicitante" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/login/);
  await ctx.close();

  // Telefono
  const m = await newCtx(browser, { width: 390, height: 844 });
  const mp = await m.newPage();
  await loginAs(mp, "solicitante", 0);
  await shot(mp, "solicitante", "movil-inicio");
  await go(mp, "/dashboard/tickets");
  await shot(mp, "solicitante", "movil-tickets");
  await m.close();
}

// ---------------------------------------------------------------------------------------
// Tecnico
// ---------------------------------------------------------------------------------------
async function tecnico(browser: Browser) {
  console.log("tecnico");
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await loginAs(page, "tecnico", 0);
  await shot(page, "tecnico", "inicio");

  // --- Inventario
  await go(page, "/dashboard/inventory");
  await shot(page, "tecnico", "inventario-equipos");
  await page.getByRole("tab", { name: /Componentes/ }).click();
  await page.getByRole("tab", { name: /Equipos/ }).click();
  await page.getByPlaceholder("Buscar por marca, modelo, serie o ubicación...").fill("ProDesk");
  await settle(page, 500);
  await page.getByRole("link", { name: /HP ProDesk/ }).first().click();
  await page.waitForURL(/inventory\//);
  await shot(page, "tecnico", "equipo-detalle", { full: true });

  // Intervencion
  await btn(page, "Registrar intervención").click();
  await dialog(page).getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Cambio de componente" }).click();
  await dialog(page).locator("textarea").first().fill("Reemplazo del cable de video del monitor y prueba de imagen completa.");
  await shot(page, "tecnico", "intervencion-registrar");
  await dialog(page).getByRole("button", { name: "Registrar" }).click();
  await closed(page);

  // Nuevo equipo
  await go(page, "/dashboard/inventory/nuevo");
  await page.locator("#kind").click();
  await page.getByRole("option", { name: "Laptop" }).click();
  await pickSearch(page, "#location", "laboratorio 2");
  await page.locator("#brand").fill("Dell");
  await page.locator("#model").fill("Latitude 5440");
  await page.locator("#serialNumber").fill("LAP-DELL-016");
  await shot(page, "tecnico", "equipo-nuevo-formulario", { full: true });
  // Error frecuente: faltan el ID de maquina y el part number
  await btn(page, "Guardar").click();
  await settle(page, 600);
  await shot(page, "tecnico", "equipo-error-campos", { full: true });
  await page.locator("#machineId").fill("L2-PC1");
  await page.locator("#partNumber").fill("LAT-5440-16");
  await btn(page, "Guardar").click();
  await page.waitForURL(/\/dashboard\/inventory$/, { timeout: 10000 }).catch(async (e) => {
    console.log("FORMULARIO:", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 800));
    throw e;
  });
  await page.getByPlaceholder("Buscar por marca, modelo, serie o ubicación...").fill("Latitude");
  await settle(page, 500);
  await page.getByRole("link", { name: /Latitude 5440/ }).first().click();
  await page.waitForURL(/inventory\/(?!nuevo)/);
  await settle(page);

  // Dar de baja (se muestra el dialogo y se cancela)
  await btn(page, "Dar de baja").click();
  await shot(page, "tecnico", "equipo-dar-de-baja");
  await dialog(page).getByRole("button", { name: "Cancelar" }).click();

  // --- Estado de equipos y ubicaciones
  await go(page, "/dashboard/equipment-status");
  await shot(page, "tecnico", "estado-de-equipos", { full: true });
  await go(page, "/dashboard/locations");
  await shot(page, "tecnico", "ubicaciones");
  await btn(page, "Nueva ubicación").click();
  await dialog(page).locator("#loc-kind").click();
  await page.getByRole("option", { name: "Laboratorio" }).click();
  await dialog(page).locator("#loc-number").fill("3");
  await dialog(page).locator("#loc-name").fill("Laboratorio 3");
  await shot(page, "tecnico", "ubicacion-nueva");
  await dialog(page).getByRole("button", { name: "Crear ubicación" }).click();
  await closed(page);

  // --- Tickets: cola OOL, tomar, asistente y resolver
  await go(page, "/dashboard/tickets");
  await page.getByRole("link", { name: /OOL/ }).click();
  await page.waitForURL(/ool/);
  await shot(page, "tecnico", "tickets-ool", { wait: 1800 }); // las filas entran con animacion escalonada
  await page.getByRole("row", { name: /PC no enciende en laboratorio/ }).getByRole("button", { name: "Tomar" }).click();
  await settle(page, 700);
  await go(page, "/dashboard/tickets");
  await page.getByRole("link", { name: "PC no enciende en laboratorio" }).click();
  await page.waitForURL(/tickets\/tkt-/);
  await shot(page, "tecnico", "ticket-asistente-incidente", { full: true });
  await page.getByRole("button", { name: /Estado del equipo/ }).click();
  await shot(page, "tecnico", "ticket-asistente-estado-equipo", { full: true });
  await page.getByRole("button", { name: /Historial/ }).click();
  await page.getByRole("button", { name: /Diagnóstico/ }).click();
  await page.getByPlaceholder("Describí el diagnóstico técnico...").fill("La fuente de alimentación no entrega tensión; el resto de los componentes responde.");
  await page.getByRole("button", { name: "Sí", exact: true }).first().click().catch(() => {});
  await shot(page, "tecnico", "ticket-asistente-diagnostico", { full: true });
  await page.getByRole("button", { name: /Resumen/ }).click();
  await page.getByPlaceholder("Describí las acciones tomadas para resolver el ticket...").fill("Se reemplazó la fuente por una de repuesto y se verificó el arranque.");
  await shot(page, "tecnico", "ticket-asistente-resumen", { full: true });
  await btn(page, "Marcar como completado").click();
  await page.getByText("Resuelto").first().waitFor();

  // --- Prestamos: aprobar, rechazar, entregar, devolver
  await go(page, "/dashboard/loans");
  await shot(page, "tecnico", "prestamos-lista");
  await page.getByRole("row", { name: /loan-003/ }).getByRole("button", { name: "Aprobar" }).click();
  await settle(page, 600);
  await page.getByRole("row", { name: /loan-008/ }).getByRole("button", { name: "Rechazar" }).click();
  await dialog(page).locator("textarea").fill("El equipo está reservado para un examen ese día");
  await shot(page, "tecnico", "prestamo-rechazar");
  await dialog(page).getByRole("button", { name: "Rechazar" }).click();
  await closed(page);
  await page.getByRole("row", { name: /loan-007/ }).getByRole("button", { name: "Registrar entrega" }).click();
  await settle(page, 600);
  await page.getByRole("row", { name: /loan-004/ }).getByRole("button", { name: "Devolver" }).click();
  await dialog(page).getByRole("checkbox").check().catch(() => {});
  await dialog(page).locator("textarea").fill("La pantalla no enciende después del traslado").catch(() => {});
  await shot(page, "tecnico", "prestamo-devolucion");
  await dialog(page).getByRole("button", { name: /Confirmar|Registrar devolución|Devolver/ }).last().click();
  await closed(page);
  await btn(page, "Registrar préstamo").click();
  await pickSearch(page, "#loan-user", "Paola");
  await dialog(page).locator("#loan-equipment").click();
  await page.getByRole("option").first().click();
  await dialog(page).locator("#loan-issue").fill(dt(0, 15));
  await dialog(page).locator("#loan-return").fill(dt(2, 15));
  await shot(page, "tecnico", "prestamo-registrar");
  await dialog(page).getByRole("button", { name: "Registrar préstamo" }).click();
  await closed(page);

  // --- Solicitudes de servicio: tomar y resolver
  await go(page, "/dashboard/service-requests");
  await page.getByRole("row").filter({ hasText: "svc-004" }).getByRole("link", { name: "Ver detalle" }).click().catch(async () => {
    await page.getByText("svc-004").first().click();
  });
  await page.waitForURL(/service-requests\/svc-004/);
  await btn(page, "Tomar solicitud").click();
  await settle(page, 700);
  await shot(page, "tecnico", "solicitud-tomada", { full: true });
  await page.locator("button[role=combobox]").click();
  await page.getByRole("option", { name: "Completado" }).click();
  await page.getByPlaceholder("Describí la resolución o motivo de rechazo...").fill("Laboratorio 1 preparado con el entorno de Python y acceso a GitLab verificado en los 15 equipos.");
  await shot(page, "tecnico", "solicitud-actualizar-estado", { full: true });
  await btn(page, "Actualizar").click();
  await settle(page, 800);

  // --- Reservas: aprobar / rechazar
  await go(page, "/dashboard/reservations");
  const approveBtn = page.getByRole("row", { name: /rsv-007/ }).getByRole("button", { name: "Aprobar" });
  await approveBtn.hover();
  await settle(page, 600);
  await approveBtn.click();
  await settle(page, 700);
  await page.getByRole("row", { name: /rsv-003/ }).getByRole("button", { name: "Rechazar" }).click();
  await dialog(page).locator("textarea, input").last().fill("El proyector está asignado a otra actividad ese día");
  await shot(page, "tecnico", "reserva-rechazar");
  await dialog(page).getByRole("button", { name: "Rechazar" }).click();
  await closed(page);
  await pickSelect(page, page.getByRole("combobox", { name: "Filtrar por estado" }), "Rechazada");

  // --- Acceso denegado al panel de administracion
  await go(page, "/admin");

  await ctx.close();
}

// ---------------------------------------------------------------------------------------
// Administrador
// ---------------------------------------------------------------------------------------
async function admin(browser: Browser) {
  console.log("admin");
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await loginAs(page, "admin", 0);
  await shot(page, "admin", "inicio-dashboard");
  await page.locator("header button", { hasText: "Administrador" }).click();
  await shot(page, "admin", "menu-usuario-panel-admin");
  await page.getByRole("menuitem", { name: "Panel Admin" }).click();
  await page.waitForURL(/\/admin/);
  await shot(page, "admin", "panel");

  // Usuarios: lista, alta, edicion, desactivacion
  await go(page, "/admin/users");
  await shot(page, "admin", "usuarios-lista", { full: true });
  await btn(page, "Nuevo usuario").click();
  await dialog(page).locator("#uf-name").fill("Gabriela Ejemplo");
  await dialog(page).locator("#uf-dni").fill("99887766");
  await dialog(page).locator("#uf-email").fill("gejemplo@iti.edu.uy");
  await dialog(page).locator("#uf-password").fill("clave-inicial-1");
  await shot(page, "admin", "usuario-nuevo", { mask: false });
  await dialog(page).getByRole("button", { name: "Crear usuario" }).click();
  await closed(page);

  // Error frecuente: documento repetido
  await btn(page, "Nuevo usuario").click();
  await dialog(page).locator("#uf-name").fill("Gabriela Repetida");
  await dialog(page).locator("#uf-dni").fill("99887766");
  await dialog(page).locator("#uf-email").fill("grepetida@iti.edu.uy");
  await dialog(page).locator("#uf-password").fill("clave-inicial-1");
  await dialog(page).getByRole("button", { name: "Crear usuario" }).click();
  await settle(page, 500);
  await shot(page, "admin", "usuario-error-documento-repetido", { mask: false });
  await dialog(page).getByRole("button", { name: /Cancelar|Cerrar/ }).first().click().catch(() => page.keyboard.press("Escape"));

  await page.getByPlaceholder("Buscar por nombre, cédula, email...").fill("Gabriela");
  await settle(page, 500);
  await page.getByRole("button", { name: "Editar" }).first().click();
  await shot(page, "admin", "usuario-editar");
  await dialog(page).locator("#uf-role").click();
  await page.keyboard.press("Escape");
  await dialog(page).getByRole("button", { name: /Cancelar|Cerrar/ }).first().click().catch(() => page.keyboard.press("Escape"));
  // Desactivar pide confirmacion con el confirm() nativo del navegador (no sale en una captura): se cancela
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Desactivar" }).first().click();

  await go(page, "/admin/roles");
  await shot(page, "admin", "roles-y-permisos", { full: true });
  await go(page, "/admin/logs");
  await shot(page, "admin", "registro-de-actividad");
  await page.getByPlaceholder("Buscar por usuario, operación...").fill("Inicio de sesión");
  await go(page, "/admin/reports");
  await shot(page, "admin", "reportes", { full: true });

  // Exportar CSV desde el dashboard
  await go(page, "/dashboard");

  await ctx.close();

  // Primer ingreso de la cuenta creada y cambio de contrasenia (cierra la sesion)
  const c2 = await newCtx(browser);
  const p2 = await c2.newPage();
  await login(p2, "99887766", "clave-inicial-1");
  await go(p2, "/dashboard/profile");
  await p2.locator("#current-pw").fill("clave-inicial-1");
  await p2.locator("#new-pw").fill("clave-nueva-2");
  await p2.locator("#confirm-pw").fill("clave-nueva-2");
  await btn(p2, "Actualizar contraseña").click();
  await p2.getByText("Contraseña actualizada correctamente.").waitFor();
  await shot(p2, "admin", "cambio-contrasenia-exito", { full: true, mask: false });
  await p2.waitForURL(/login/, { timeout: 8000 });
  await c2.close();
}

// ---------------------------------------------------------------------------------------
// Administrador raiz
// ---------------------------------------------------------------------------------------
async function root(browser: Browser) {
  console.log("root");
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await loginAs(page, "root_admin", 0);
  await go(page, "/admin/users");
  await shot(page, "root", "usuarios-lista");
  await page.getByPlaceholder("Buscar por nombre, cédula, email...").fill("Sistema");
  await settle(page, 500);
  await page.getByRole("button", { name: "Editar" }).first().click();
  await shot(page, "root", "usuario-raiz-editar");
  await page.keyboard.press("Escape");
  await go(page, "/admin");
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--lang=es-UY"] });
try {
  if (want("general")) await general(browser);
  if (want("solicitante")) await solicitante(browser);
  if (want("tecnico")) await tecnico(browser);
  if (want("admin")) await admin(browser);
  if (want("root")) await root(browser);
} finally {
  await browser.close();
}

// Optimiza los PNG (cuantizacion a 8 bits, sin metadatos) si ImageMagick esta disponible
const files = readdirSync(OUT).filter((f) => f.endsWith(".png"));
let optimized = 0;
for (const f of files) {
  const p = join(OUT, f);
  if (!OPTIMIZE) break;
  const r = Bun.spawnSync(["convert", p, "-strip", "+dither", "-colors", "256", "PNG8:" + p + ".tmp"]);
  if (r.exitCode === 0) {
    Bun.spawnSync(["mv", p + ".tmp", p]);
    optimized++;
  }
}
const total = files.reduce((acc, f) => acc + statSync(join(OUT, f)).size, 0);
const MANIFEST = arg("manifest", "");
if (MANIFEST) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`${files.length} capturas, ${optimized} optimizadas, ${(total / 1024 / 1024).toFixed(2)} MB`);
