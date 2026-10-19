/* oxlint-disable no-await-in-loop -- los pasos del selector se ejecutan en serie a propósito */
// Verificación en navegador de la sección "Idioma" del informe de accesibilidad: el selector ES / EN
// debe cambiar <html lang>, <title>, el aria-label del grupo y persistir la elección en lux_lang.
//
//   bun run build && bunx vite preview --host 127.0.0.1 --port 4125 --strictPort &
//   bun scripts/qa/lang-probe.ts --base http://127.0.0.1:4125
import { chromium } from "playwright";
import { mockPasswords, mockUsers } from "../../src/mocks/data/users";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:4124").replace(/\/$/, "");
const CHROMIUM = arg("chromium", process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium");

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-UY" })).newPage();

let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${detail}`);
};
const snap = () =>
  page.evaluate(() => ({
    htmlLang: document.documentElement.lang,
    title: document.title,
    stored: localStorage.getItem("lux_lang"),
    group: document.querySelector('[role="group"]:has(button[lang])')?.getAttribute("aria-label") ?? null,
    pressed: [...document.querySelectorAll("button[lang][aria-pressed]")].map((b) => `${b.getAttribute("lang")}=${b.getAttribute("aria-pressed")}`).join(","),
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
  }));

// 1) Login (anonimo): el selector esta en la pantalla de acceso.
await page.goto(`${BASE}/login`);
await page.waitForSelector("button[lang]");
let s = await snap();
console.log("login inicial (navegador es-UY):", JSON.stringify(s));
check("login: lang inicial es", s.htmlLang === "es", `html lang=${s.htmlLang}`);

await page.click('button[lang="en"]');
s = await snap();
console.log("login tras EN:", JSON.stringify(s));
check("login: html lang pasa a en", s.htmlLang === "en", `html lang=${s.htmlLang}`);
check("login: se guarda lux_lang=en", s.stored === "en", `lux_lang=${s.stored}`);
check("login: aria-pressed sigue la seleccion", s.pressed.includes("en=true") && s.pressed.includes("es=false"), s.pressed);
const enGroup = s.group;
const enTitle = s.title;

await page.reload();
await page.waitForSelector("button[lang]");
s = await snap();
check("login: el idioma sobrevive a recargar", s.htmlLang === "en" && s.stored === "en", `html lang=${s.htmlLang}`);

await page.click('button[lang="es"]');
s = await snap();
check("login: vuelve a es", s.htmlLang === "es" && s.stored === "es", `html lang=${s.htmlLang}, lux_lang=${s.stored}`);
check("login: aria-label del grupo cambia con el idioma", !!enGroup && !!s.group && enGroup !== s.group, `en="${enGroup}" es="${s.group}"`);
check("login: title del documento", true, `en="${enTitle}" es="${s.title}" (informativo)`);

// 2) Con sesion: el selector de la barra superior y el del perfil.
const user = mockUsers.find((u) => u.role === "solicitante")!;
await page.fill("#dni", user.dni);
await page.fill("#password", mockPasswords[user.dni]);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/);
await page.waitForSelector("button[lang]");
await page.waitForFunction(() => !!document.querySelector("h1") && document.querySelector("h1")?.textContent !== "Iniciá sesión");
const before = await snap();
await page.click('button[lang="en"]');
await page.waitForTimeout(300);
const after = await snap();
console.log("dashboard es:", JSON.stringify(before));
console.log("dashboard en:", JSON.stringify(after));
check("dashboard: html lang pasa a en", after.htmlLang === "en", `html lang=${after.htmlLang}`);
check("dashboard: el h1 cambia de texto", before.h1 !== after.h1, `es="${before.h1}" en="${after.h1}"`);
await page.goto(`${BASE}/dashboard/profile`);
await page.waitForSelector("button[lang]");
s = await snap();
check("perfil: conserva en tras navegar", s.htmlLang === "en", `html lang=${s.htmlLang}`);
// Los botones del selector declaran su propio idioma (lang="es"/"en"): lectores de pantalla pronuncian bien.
const langs = await page.evaluate(() => [...document.querySelectorAll("button[lang]")].map((b) => b.getAttribute("lang")));
check("selector: cada boton declara su lang", langs.includes("es") && langs.includes("en"), langs.join(","));

await browser.close();
console.log(failed === 0 ? "\nlang-probe: todo OK" : `\nlang-probe: ${failed} falla(s)`);
process.exit(failed === 0 ? 0 : 1);
