/* oxlint-disable no-await-in-loop, no-explicit-any, consistent-function-scoping -- las pantallas se recorren en serie a propósito; el contenido de axe se tipa a mano */
// Auditoría de accesibilidad (WCAG 2.2 AA) de Lux con axe-core + Playwright/Chromium.
//
// Qué hace, por rol y por pantalla, contra el frontend en modo MSW:
//   1. axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) en 6 modos: base, dark,
//      alto contraste (hc), alto contraste + oscuro (hc-dark), fuente XL (font-xl) y
//      fuente disléxica (dyslexic). Se guardan violaciones e "incomplete".
//   2. axe best-practice (solo modo base).
//   3. Teclado (solo modo base): orden de tabulación, foco visible, trampas, elementos
//      interactivos inalcanzables, tabindex positivo, enlace "saltar al contenido".
//   4. Estructura: lang, title, landmarks, h1, saltos de nivel de encabezados.
//   5. Reflow a 320 px (WCAG 1.4.10) y viewport móvil 375 px con axe.
//   6. prefers-reduced-motion: cantidad de animaciones CSS/WAAPI activas con y sin la
//      preferencia (las animaciones de la librería motion son JS y no se ven acá; ver
//      el informe para el análisis estático).
//
// Uso (desde la raíz del repo):
//   bun run build && bunx vite preview --host 127.0.0.1 --port 4124 --strictPort &
//   bun scripts/a11y-audit.ts --base http://127.0.0.1:4124 --out /tmp/a11y-out
// Opciones: --modes base,dark,...  --roles anon,solicitante,...  --chromium <ruta>
// Variables: AXE_CORE_DIR (carpeta con node_modules/axe-core). Si falta, se instala en
//   $TMPDIR/lux-axe (no toca package.json del repo). Para dejarlo fijo en el repo:
//   bun add -d axe-core.
// Salida: <out>/a11y-results.json y un resumen en consola. Solo lectura sobre src/.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockPasswords, mockUsers } from "../src/mocks/data/users";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = (arg("base", "http://127.0.0.1:4124") as string).replace(/\/$/, "");
const OUT = arg("out", join(tmpdir(), "lux-a11y-out")) as string;
const CHROMIUM = arg("chromium", process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium") as string;

type Mode = "base" | "dark" | "hc" | "hc-dark" | "font-xl" | "dyslexic";
const ALL_MODES: Mode[] = ["base", "dark", "hc", "hc-dark", "font-xl", "dyslexic"];
const MODES = (arg("modes") ? (arg("modes") as string).split(",") : ALL_MODES) as Mode[];

const THEME: Record<Mode, { theme: "light" | "dark"; fontSize: string; highContrast: boolean; dyslexicFont: boolean }> = {
  base: { theme: "light", fontSize: "md", highContrast: false, dyslexicFont: false },
  dark: { theme: "dark", fontSize: "md", highContrast: false, dyslexicFont: false },
  hc: { theme: "light", fontSize: "md", highContrast: true, dyslexicFont: false },
  "hc-dark": { theme: "dark", fontSize: "md", highContrast: true, dyslexicFont: false },
  "font-xl": { theme: "light", fontSize: "xl", highContrast: false, dyslexicFont: false },
  dyslexic: { theme: "light", fontSize: "md", highContrast: false, dyslexicFont: true },
};

type RoleKey = "anon" | "solicitante" | "tecnico" | "admin" | "root_admin";

interface Screen {
  name: string;
  path: string;
  /** Selector del botón que abre un diálogo/formulario en esa pantalla (se audita abierto). */
  dialog?: string;
}
const PLUS = "main button:has(svg.lucide-plus)";
const COMMON: Screen[] = [
  { name: "dashboard", path: "/dashboard" },
  { name: "inventario", path: "/dashboard/inventory" },
  { name: "inventario-detalle", path: "/dashboard/inventory/prod-1" },
  { name: "estado-equipos", path: "/dashboard/equipment-status" },
  { name: "tickets", path: "/dashboard/tickets", dialog: PLUS },
  { name: "ticket-detalle", path: "/dashboard/tickets/tkt-001" },
  { name: "prestamos", path: "/dashboard/loans", dialog: PLUS },
  { name: "servicios", path: "/dashboard/service-requests", dialog: PLUS },
  { name: "servicio-detalle", path: "/dashboard/service-requests/svc-001" },
  { name: "reservas", path: "/dashboard/reservations", dialog: PLUS },
  { name: "perfil", path: "/dashboard/profile" },
];
const STAFF_EXTRA: Screen[] = [
  { name: "ool", path: "/dashboard/tickets/ool" },
  { name: "ubicaciones", path: "/dashboard/locations", dialog: PLUS },
  { name: "equipo-nuevo", path: "/dashboard/inventory/nuevo" },
];
const ADMIN_EXTRA: Screen[] = [
  { name: "admin-inicio", path: "/admin" },
  { name: "admin-usuarios", path: "/admin/users", dialog: PLUS },
  { name: "admin-roles", path: "/admin/roles" },
  { name: "admin-logs", path: "/admin/logs" },
  { name: "admin-reportes", path: "/admin/reports" },
];
const SCREENS: Record<RoleKey, Screen[]> = {
  anon: [
    { name: "login", path: "/login" },
    { name: "splash", path: "/" },
    { name: "error-403", path: "/403" },
    { name: "error-404", path: "/404" },
    { name: "error-500", path: "/500" },
  ],
  solicitante: COMMON,
  tecnico: [...COMMON, ...STAFF_EXTRA],
  admin: [...COMMON, ...STAFF_EXTRA, ...ADMIN_EXTRA],
  root_admin: [{ name: "dashboard", path: "/dashboard" }, ...ADMIN_EXTRA],
};
const ROLES = (arg("roles") ? (arg("roles") as string).split(",") : (Object.keys(SCREENS) as RoleKey[])) as RoleKey[];

// ---------------------------------------------------------------- axe-core
function resolveAxe(): string {
  const dirs = [process.env.AXE_CORE_DIR, process.cwd(), join(tmpdir(), "lux-axe")].filter(Boolean) as string[];
  for (const d of dirs) {
    const f = join(d, "node_modules", "axe-core", "axe.min.js");
    if (existsSync(f)) return f;
  }
  const dir = join(tmpdir(), "lux-axe");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"name":"lux-axe","private":true}');
  const r = Bun.spawnSync(["bun", "add", "axe-core"], { cwd: dir });
  if (r.exitCode !== 0) throw new Error(`No se pudo instalar axe-core: ${r.stderr.toString()}`);
  return join(dir, "node_modules", "axe-core", "axe.min.js");
}
const AXE_SRC = readFileSync(resolveAxe(), "utf8");
const AXE_VERSION = /axe v([\d.]+)/.exec(AXE_SRC)?.[1] ?? "desconocida";

// ---------------------------------------------------------------- helpers
interface AxeNode {
  html: string;
  target: string[];
  failureSummary?: string;
}
interface AxeIssue {
  id: string;
  impact: string | null;
  help: string;
  tags: string[];
  nodes: AxeNode[];
}

async function runAxe(page: Page, tags: string[]): Promise<{ violations: AxeIssue[]; incomplete: AxeIssue[] }> {
  await page.evaluate(AXE_SRC);
  return page.evaluate(async (runTags) => {
    // @ts-expect-error axe lo inyecta el script
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: runTags }, resultTypes: ["violations", "incomplete"] });
    const slim = (list: any[]) =>
      list.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        tags: v.tags,
        nodes: v.nodes.slice(0, 12).map((n: any) => ({ html: String(n.html).slice(0, 240), target: n.target.map(String), failureSummary: n.failureSummary })),
        nodeCount: v.nodes.length,
      }));
    return { violations: slim(res.violations), incomplete: slim(res.incomplete) };
  }, tags);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // espera a que terminen las transiciones de entrada (motion) y los skeletons
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0, undefined, { timeout: 5000 }).catch(() => {});
}

async function structure(page: Page) {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const count = (sel: string) => [...document.querySelectorAll(sel)].filter(vis).length;
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(vis).map((h) => Number(h.tagName[1]) || Number(h.getAttribute("aria-level")) || 2);
    let skipped = 0;
    for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skipped++;
    const meta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
    return {
      lang: document.documentElement.lang,
      title: document.title,
      h1: count("h1"),
      headings: hs,
      headingLevelsSkipped: skipped,
      main: count("main,[role=main]"),
      nav: count("nav,[role=navigation]"),
      banner: count("header,[role=banner]"),
      contentinfo: count("footer,[role=contentinfo]"),
      complementary: count("aside,[role=complementary]"),
      liveRegions: count("[role=status],[role=alert],[aria-live]"),
      viewportMeta: meta,
      zoomBlocked: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(meta),
      fontOpenDyslexicLoaded: [...document.fonts].some((f) => f.family.includes("OpenDyslexic") && f.status === "loaded"),
    };
  });
}

interface Stop {
  tag: string;
  role: string | null;
  name: string;
  top: number;
  left: number;
  focusVisible: boolean;
  inDialog: boolean;
}

async function keyboard(page: Page) {
  // Punto de partida de la navegación secuencial: un ancla temporal al inicio del body,
  // así el primer Tab cae en el primer elemento enfocable aunque haya autofocus.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    const a = document.createElement("span");
    a.tabIndex = -1;
    a.id = "kbdStart";
    document.body.prepend(a);
    a.focus();
    a.remove();
  });
  const stops: Stop[] = [];
  let first: string | null = null;
  let wrapped = false;
  let sameCount = 0;
  let prevKey = "";
  for (let i = 0; i < 140; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return null;
      const snap = (e: HTMLElement) => {
        const c = getComputedStyle(e);
        return `${c.outlineStyle}|${c.outlineWidth}|${c.outlineColor}|${c.boxShadow}|${c.borderColor}|${c.backgroundColor}|${c.color}|${c.textDecorationLine}`;
      };
      const focused = snap(el);
      const outline = getComputedStyle(el);
      const hasOutline = outline.outlineStyle !== "none" && parseFloat(outline.outlineWidth) > 0;
      el.blur();
      const unfocused = snap(el);
      el.focus();
      const r = el.getBoundingClientRect();
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLInputElement).placeholder || el.textContent || "";
      // id estable por elemento: evita confundir enlaces repetidos ("Ver detalle", "Editar")
      const w = window as unknown as { kbdIds?: WeakMap<Element, number>; kbdN?: number };
      w.kbdIds ??= new WeakMap();
      w.kbdN ??= 0;
      if (!w.kbdIds.has(el)) w.kbdIds.set(el, ++w.kbdN);
      const path = (e: Element): string => `#${w.kbdIds!.get(e)}`;
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        name: label.trim().replace(/\s+/g, " ").slice(0, 50),
        top: Math.round(r.top + window.scrollY),
        left: Math.round(r.left),
        focusVisible: hasOutline || focused !== unfocused,
        inDialog: !!el.closest('[role="dialog"],[role="alertdialog"]'),
        key: path(el) + "|" + label.trim().slice(0, 30),
      };
    });
    if (!s) {
      // el foco salió del documento (barra del navegador): la lista cerró el ciclo
      wrapped = true;
      break;
    }
    const { key, ...stop } = s as Stop & { key: string };
    if (first === null) first = key;
    else if (key === first) {
      wrapped = true;
      break;
    }
    sameCount = key === prevKey ? sameCount + 1 : 0;
    prevKey = key;
    stops.push(stop);
    if (sameCount >= 3) break; // trampa: el foco no avanza
  }
  const trap = !wrapped && stops.length >= 3 && sameCount >= 3;
  let backwards = 0;
  for (let i = 1; i < stops.length; i++) if (stops[i].top < stops[i - 1].top - 40 && !stops[i].inDialog) backwards++;
  const interactive = await page.evaluate(() => {
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const nameOf = (e: Element) => (e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const all = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[tabindex]")].filter(vis);
    const tabindexNeg = all.filter((e) => e.getAttribute("tabindex") === "-1" && !e.closest('[role="presentation"]') && !(e as HTMLButtonElement).disabled && ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(e.tagName)).map((e) => `${e.tagName.toLowerCase()} "${nameOf(e)}"`);
    const positive = all.filter((e) => Number(e.getAttribute("tabindex")) > 0).length;
    const scrollers = [...document.querySelectorAll("*")]
      .filter((e) => {
        const s = getComputedStyle(e);
        return (s.overflowY === "auto" || s.overflowY === "scroll" || s.overflowX === "auto" || s.overflowX === "scroll") && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
      })
      .map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""} tabindex=${e.getAttribute("tabindex")} focusableDescendant=${!!e.querySelector("a[href],button,input,select,textarea,[tabindex='0']")}`);
    return { total: all.length, tabindexNeg, positive, scrollers };
  });
  const noIndicator = stops.filter((s) => !s.focusVisible).map((s) => `${s.tag} "${s.name}"`);
  const firstStop = stops[0];
  return {
    stops: stops.length,
    wrapped,
    trap,
    backwardsJumps: backwards,
    firstStop: firstStop ? `${firstStop.tag} "${firstStop.name}"` : null,
    hasSkipLink: !!firstStop && /salt|skip|contenido/i.test(firstStop.name),
    noFocusIndicator: noIndicator,
    interactiveVisible: interactive.total,
    tabindexNegativeOnControls: interactive.tabindexNeg,
    tabindexPositive: interactive.positive,
    scrollRegions: interactive.scrollers,
    sequence: stops.slice(0, 40).map((s) => `${s.tag}:${s.name}`),
  };
}

// Abre el diálogo, audita con axe, comprueba que el foco entra, que Tab no sale y que
// Escape lo cierra devolviendo el foco al disparador.
async function dialogAudit(page: Page, selector: string) {
  const trigger = page.locator(selector).first();
  if ((await trigger.count()) === 0) return { opened: false as const, note: "sin disparador" };
  const open = async () => {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.locator('[role="dialog"]').first().waitFor({ state: "visible", timeout: 3000 });
    await page.waitForTimeout(700);
  };
  try {
    await open();
  } catch {
    return { opened: false as const, note: "no abrió diálogo" };
  }
  // Primero Escape directo (cierre y devolución del foco), después se vuelve a abrir
  // (tras recargar) para axe y la prueba de trampa. Así Escape no depende de dónde quedó el foco tras tabular.
  await page.keyboard.press("Escape");
  // La animación de salida puede tardar: se espera hasta 3 s a que el diálogo salga del DOM.
  const closed = await page
    .locator('[role="dialog"]')
    .first()
    .waitFor({ state: "detached", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(200);
  const focusReturned = await page.evaluate((sel) => {
    const el = document.activeElement;
    return !!el && el !== document.body && el === document.querySelector(sel);
  }, selector);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  try {
    await open();
  } catch {
    return { opened: true as const, closedWithEscape: closed, focusReturnedToTrigger: focusReturned, note: "no se pudo reabrir para axe" };
  }
  const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  const hasName = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return !!(d && (d.getAttribute("aria-label") || d.getAttribute("aria-labelledby")));
  });
  const ax = await runAxe(page, WCAG_TAGS);
  let escaped = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (!(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) escaped++;
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  return { opened: true as const, focusInside, hasName, tabsOutsideDialog: escaped, closedWithEscape: closed, focusReturnedToTrigger: focusReturned, violations: ax.violations, incomplete: ax.incomplete };
}

async function reflow320(page: Page) {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide: string[] = [];
    document.querySelectorAll("body *").forEach((e) => {
      const b = e.getBoundingClientRect();
      if (b.right > window.innerWidth + 1 && b.width > 0 && wide.length < 5) wide.push(`${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(" ").slice(0, 3).join(".")} right=${Math.round(b.right)}`);
    });
    const main = document.querySelector("main");
    return {
      pageHScroll: doc.scrollWidth > window.innerWidth + 1,
      pageScrollWidth: doc.scrollWidth,
      mainHScroll: !!main && main.scrollWidth > main.clientWidth + 1,
      wide,
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  return r;
}

async function motionCount(page: Page) {
  return page.evaluate(() => {
    const anims = document.getAnimations();
    const infinite = anims.filter((a) => (a.effect?.getComputedTiming().iterations ?? 1) === Infinity && a.playState === "running");
    return { running: anims.filter((a) => a.playState === "running").length, infinite: infinite.length, reduceMatches: matchMedia("(prefers-reduced-motion: reduce)").matches };
  });
}

// ---------------------------------------------------------------- sesión
async function newContext(browser: Browser, opts: { mode: Mode; auth?: string; reducedMotion?: boolean; width?: number; height?: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 },
    reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
    locale: "es-UY",
    serviceWorkers: "allow",
  });
  await ctx.addInitScript(
    ({ theme, auth }) => {
      try {
        localStorage.setItem("lux_theme", JSON.stringify(theme));
        if (auth) localStorage.setItem("lux_auth", auth);
      } catch {
        /* ignore */
      }
    },
    { theme: THEME[opts.mode], auth: opts.auth ?? null },
  );
  return ctx;
}

async function loginAndGetAuth(browser: Browser, role: Exclude<RoleKey, "anon">): Promise<string> {
  const u = mockUsers.find((x) => x.role === role)!;
  const ctx = await newContext(browser, { mode: "base" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.waitForSelector("#dni");
  await page.fill("#dni", u.dni);
  await page.fill("#password", mockPasswords[u.dni]);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 15000 });
  const auth = await page.evaluate(() => localStorage.getItem("lux_auth"));
  await ctx.close();
  if (!auth) throw new Error(`Sin sesión para ${role}`);
  return auth;
}

// ---------------------------------------------------------------- corrida
interface ScreenResult {
  role: RoleKey;
  screen: string;
  path: string;
  mode: Mode;
  finalUrl: string;
  violations: AxeIssue[];
  incomplete: AxeIssue[];
  bestPractice?: AxeIssue[];
  structure?: Awaited<ReturnType<typeof structure>>;
  keyboard?: Awaited<ReturnType<typeof keyboard>>;
  reflow320?: Awaited<ReturnType<typeof reflow320>>;
  dialog?: Awaited<ReturnType<typeof dialogAudit>>;
  mobile375?: { violations: AxeIssue[] };
  motion?: { normal: Awaited<ReturnType<typeof motionCount>>; reduced: Awaited<ReturnType<typeof motionCount>> };
  error?: string;
}

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function auditRole(browser: Browser, role: RoleKey): Promise<ScreenResult[]> {
  const results: ScreenResult[] = [];
  const auth = role === "anon" ? undefined : await loginAndGetAuth(browser, role);
  for (const mode of MODES) {
    const ctx = await newContext(browser, { mode, auth });
    const page = await ctx.newPage();
    for (const screen of SCREENS[role]) {
      const res: ScreenResult = { role, screen: screen.name, path: screen.path, mode, finalUrl: "", violations: [], incomplete: [] };
      try {
        await page.goto(`${BASE}${screen.path}`, { waitUntil: "domcontentloaded" });
        if (screen.path === "/") await page.waitForTimeout(2600); // splash redirige a los 1800 ms
        await settle(page);
        res.finalUrl = new URL(page.url()).pathname;
        const ax = await runAxe(page, WCAG_TAGS);
        res.violations = ax.violations;
        res.incomplete = ax.incomplete;
        if (mode === "base") {
          res.bestPractice = (await runAxe(page, ["best-practice"])).violations;
          res.structure = await structure(page);
          res.keyboard = await keyboard(page);
          res.reflow320 = await reflow320(page);
          if (screen.dialog) {
            res.dialog = await dialogAudit(page, screen.dialog);
            await page.goto(`${BASE}${screen.path}`, { waitUntil: "domcontentloaded" });
            await settle(page);
          }
          // móvil 375
          await page.setViewportSize({ width: 375, height: 812 });
          await page.waitForTimeout(600);
          res.mobile375 = { violations: (await runAxe(page, WCAG_TAGS)).violations };
          await page.setViewportSize({ width: 1280, height: 800 });
          // reduced motion: contexto aparte, recarga la misma pantalla
          const rctx = await newContext(browser, { mode, auth, reducedMotion: true });
          const rpage = await rctx.newPage();
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForTimeout(300);
          const normal = await motionCount(page);
          await rpage.goto(`${BASE}${screen.path}`, { waitUntil: "domcontentloaded" });
          await rpage.waitForTimeout(300);
          res.motion = { normal, reduced: await motionCount(rpage) };
          await rctx.close();
        }
      } catch (e) {
        res.error = (e as Error).message.split("\n")[0];
      }
      results.push(res);
      console.log(`${role.padEnd(11)} ${mode.padEnd(8)} ${screen.name.padEnd(20)} ${res.error ? "ERROR " + res.error : `v=${res.violations.length} inc=${res.incomplete.length}`}`);
    }
    await ctx.close();
  }
  return results;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const started = new Date().toISOString();
const all = (await Promise.all(ROLES.map((r) => auditRole(browser, r)))).flat();
await browser.close();
writeFileSync(join(OUT, "a11y-results.json"), JSON.stringify({ base: BASE, axe: AXE_VERSION, startedAt: started, finishedAt: new Date().toISOString(), modes: MODES, roles: ROLES, results: all }, null, 2));
console.log(`\nListo: ${all.length} corridas. Resultado: ${join(OUT, "a11y-results.json")}`);
