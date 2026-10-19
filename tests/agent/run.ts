// Nivel 2: un agente recorre la interfaz para cumplir el objetivo de cada caso
// con `ui`. El login es determinístico (sin modelo); el modelo solo decide qué
// pulsar o escribir a partir de la lista de elementos de la pantalla.
//   bun run qa:agent --target https://dev.eternum.lat [--only CP-03] [--provider anthropic|deepseek]
// Corta la corrida si el gasto estimado supera QA_MAX_USD (por defecto 0,50).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import type { CaseResult, Outcome } from "../api/run";
import { CASES } from "../cases";
import type { TestCase } from "../cases/types";
import { ApiCtx, seedCredentials } from "../lib/api";
import { arg, flag } from "../lib/args";
import { type Action, type Provider, makeProvider } from "./providers";

const target = (arg("target") ?? process.env.QA_UI_TARGET ?? "http://localhost:5173").replace(/\/$/, "");
const only = arg("only");
const outDir = arg("out") ?? "tests/out";
const maxSteps = Number(arg("steps") ?? 20);
const maxUsd = Number(process.env.QA_MAX_USD ?? 0.5);
const headed = flag("headed");
// El agente no es determinístico: un caso que falla se reintenta en un contexto limpio.
const retries = Number(arg("retries") ?? 1);
// La API para preparar precondiciones; por defecto la misma URL que la interfaz.
const apiBase = (arg("api") ?? target).replace(/\/$/, "");
const api = new ApiCtx(apiBase.endsWith("/graphql") ? apiBase : `${apiBase}/graphql`);

const SYSTEM = `Sos un tester de QA que usa una aplicación web de gestión de soporte informático (en español).
Recibís un objetivo, lo que ya hiciste y los elementos interactivos de la pantalla actual, cada uno con un número [n].
En cada turno llamás a la herramienta "act" exactamente una vez con la próxima acción:
- click: pulsar el elemento [ref].
- fill: escribir "text" en el campo [ref] (reemplaza lo que tenga).
- select: elegir la opción "text" en el desplegable [ref].
- press: tecla "text" (por ejemplo Enter o Escape).
- goto: ir a la ruta "text" (por ejemplo /dashboard/tickets).
- wait: esperar un momento. Usalo cuando la pantalla muestre "Enviando", "Guardando" o "Cargando": no repitas el click, esperá.
- done: el objetivo está cumplido. En "text" copiá literalmente uno o más fragmentos cortos del texto visible que lo demuestran, separados por " | " (cada fragmento tal cual aparece en pantalla).
- fail: el objetivo no se puede cumplir (error, permiso denegado, función inexistente). Explicá por qué en "reason".
No inventes datos que el objetivo no pida; si un campo obligatorio no está en el objetivo, usá un valor de prueba razonable.
No uses "done" hasta ver en pantalla lo que pide el criterio de éxito.
Los desplegables marcados como combobox no son <select>: hacé click para abrirlos y después click en la opción (role option). "select" solo sirve para elementos select.
Si un click falla porque algo lo tapa, cerrá primero lo que esté abierto (press Escape) o elegí otro elemento.`;

// Marca los elementos interactivos visibles con data-qa-ref y devuelve una línea por elemento.
async function snapshot(page: Page): Promise<{ list: string; text: string }> {
  const items = await page.evaluate(() => {
    const sel = "a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[role=combobox]";
    const out: string[] = [];
    let n = 0;
    // Las marcas del paso anterior quedan en elementos que ya no se ven: se limpian para no confundir referencias.
    for (const old of Array.from(document.querySelectorAll("[data-qa-ref]"))) old.removeAttribute("data-qa-ref");
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || (el as HTMLInputElement).disabled) continue;
      el.setAttribute("data-qa-ref", String(++n));
      const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
      const type = el instanceof HTMLInputElement ? `:${el.type}` : "";
      const label =
        el.getAttribute("aria-label") ??
        (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
        el.getAttribute("placeholder") ??
        el.textContent ??
        "";
      const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? ` = "${el.value.slice(0, 40)}"` : "";
      // Botones iguales en cada fila ("Tomar", "Aprobar"): se indica a qué fila pertenecen.
      const row = el.closest("tr,li,article,[role=row]");
      const ctx = row && row !== el ? ` (fila: ${(row.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 70)})` : "";
      out.push(`[${n}] ${role}${type} "${label.replace(/\s+/g, " ").trim().slice(0, 80)}"${value}${ctx}`);
    }
    return out;
  });
  const text = (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").slice(0, 4000);
  return { list: items.join("\n"), text };
}

async function login(page: Page, c: TestCase): Promise<void> {
  const { dni, password } = seedCredentials(c.ui!.as);
  await page.goto(`${target}/login`);
  await page.locator("#dni").fill(dni);
  await page.locator("#password").fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

async function perform(page: Page, a: Action): Promise<void> {
  if (["click", "fill", "select"].includes(a.action) && a.ref == null) throw new Error(`"${a.action}" necesita el número [n] del elemento`);
  const el = () => page.locator(`[data-qa-ref="${a.ref}"]`).first();
  switch (a.action) {
    case "click":
      await el().click({ timeout: 5_000 });
      break;
    case "fill":
      await el().fill(a.text ?? "", { timeout: 5_000 });
      break;
    case "select":
      await el().selectOption({ label: a.text ?? "" }, { timeout: 5_000 });
      break;
    case "press":
      await page.keyboard.press(a.text ?? "Enter");
      break;
    case "wait":
      await page.waitForTimeout(1_500);
      break;
    case "goto":
      await page.goto(`${target}${a.text?.startsWith("/") ? a.text : `/${a.text ?? ""}`}`);
      break;
  }
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
}

async function runCase(page: Page, c: TestCase, llm: Provider): Promise<{ outcome: Outcome; detail?: string; steps: number }> {
  const ui = { ...c.ui! };
  if (ui.setup) {
    let vars: Record<string, string>;
    try {
      vars = await ui.setup(api);
    } catch (error) {
      return { outcome: "error", detail: `no se pudo preparar la precondición por API: ${(error as Error).message}`, steps: 0 };
    }
    const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`);
    Object.assign(ui, { start: fill(ui.start), goal: fill(ui.goal), success: fill(ui.success) });
  }
  // Un alert() inesperado es señal de script inyectado (XSS); los confirm() se aceptan.
  const alerts: string[] = [];
  page.on("dialog", (d) => {
    if (d.type() === "alert") alerts.push(d.message());
    void d.accept().catch(() => {});
  });
  await login(page, c);
  await page.goto(`${target}${ui.start}`);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const history: string[] = [];
  for (let step = 1; step <= maxSteps; step++) {
    if (llm.spentUsd() > maxUsd) return { outcome: "error", detail: `tope de gasto alcanzado (USD ${maxUsd})`, steps: step - 1 };
    const { list, text } = await snapshot(page);
    const prompt = [
      `Objetivo: ${ui.goal}`,
      `Criterio de éxito: ${ui.success}`,
      `Ruta actual: ${new URL(page.url()).pathname}`,
      `Acciones previas:\n${history.join("\n") || "(ninguna)"}`,
      `Elementos interactivos:\n${list || "(ninguno)"}`,
      `Texto visible:\n${text}`,
    ].join("\n\n");
    if (alerts.length > 0) return { outcome: c.knownGap ? "xfail" : "fail", detail: `la página ejecutó alert("${alerts[0]}")`, steps: step - 1 };
    const a = await llm.next(SYSTEM, prompt);
    if (process.env.QA_DEBUG) console.log(`       ${step}. ${a.action} ${a.ref ?? ""} ${a.text ?? ""} — ${a.reason}`);
    if (a.action === "done") {
      // Lo que el modelo cita tiene que estar realmente en pantalla: evita dar por bueno un éxito inventado.
      const raw = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const visible = raw.toLowerCase();
      const quote = (a.text ?? "").replace(/\s+/g, " ").trim();
      const parts = quote.split(/\s*[|/·]\s*/).filter((p) => p.length >= 3);
      const missing = parts.filter((p) => !visible.includes(p.toLowerCase()));
      if (ui.expect && !ui.expect.test(raw)) {
        history.push(`${step}. done rechazado: la pantalla no cumple el criterio de éxito`);
        continue;
      }
      if (parts.length > 0 && missing.length === 0) return { outcome: c.knownGap ? "xpass" : "pass", detail: `evidencia: "${quote}"`, steps: step };
      history.push(`${step}. done rechazado: no aparece en pantalla ${missing.map((m) => `"${m}"`).join(", ") || "(sin evidencia)"}; citá fragmentos literales separados por " | "`);
      continue;
    }
    if (a.action === "fail") return { outcome: c.knownGap ? "xfail" : "fail", detail: a.reason, steps: step };
    try {
      await perform(page, a);
      history.push(`${step}. ${a.action}${a.ref ? ` [${a.ref}]` : ""}${a.text ? ` "${a.text}"` : ""} — ${a.reason}`);
    } catch (error) {
      history.push(`${step}. ${a.action} [${a.ref}] falló: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  return { outcome: c.knownGap ? "xfail" : "fail", detail: `no cumplió el objetivo en ${maxSteps} pasos; últimas acciones: ${history.slice(-4).join(" · ")}`, steps: maxSteps };
}

const selected = CASES.filter((c) => c.ui && (!only || c.id.startsWith(only) || c.cu === only));
if (flag("list")) {
  for (const c of selected) console.log(`${c.id.padEnd(10)} ${c.ui!.as.padEnd(12)} ${c.ui!.goal}`);
  process.exit(0);
}

const llm = makeProvider(arg("provider"));
const shots = join(outDir, "ui");
if (!existsSync(shots)) mkdirSync(shots, { recursive: true });
console.log(`QA UI · ${target} · ${selected.length} casos · ${llm.label} · tope USD ${maxUsd}\n`);

const browser = await chromium.launch({ headless: !headed });
const results: CaseResult[] = [];
for (const c of selected) {
  const start = performance.now();
  let r: { outcome: Outcome; detail?: string; steps: number } = { outcome: "error", steps: 0 };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const context = await browser.newContext({ locale: "es-UY", viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      r = await runCase(page, c, llm);
    } catch (error) {
      r = { outcome: "error", detail: (error as Error).message.split("\n")[0], steps: 0 };
    }
    await page.screenshot({ path: join(shots, `${c.id}.png`), fullPage: true }).catch(() => {});
    await context.close();
    if (r.outcome !== "fail" && r.outcome !== "error") {
      if (attempt > 0) r.detail = `${r.detail ?? ""} (en el reintento ${attempt})`;
      break;
    }
  }
  const ms = Math.round(performance.now() - start);
  results.push({ id: c.id, cu: c.cu, title: c.title, outcome: r.outcome, ms, detail: r.detail, knownGap: c.knownGap });
  const mark = { pass: "PASS ", fail: "FAIL ", xfail: "XFAIL", xpass: "XPASS", error: "ERROR" }[r.outcome];
  console.log(`${mark} ${c.id.padEnd(10)} ${c.title} (${r.steps} pasos, ${ms} ms)${r.detail ? `\n       ${r.detail}` : ""}`);
}
await browser.close();

const count = (o: Outcome) => results.filter((x) => x.outcome === o).length;
const summary = { pass: count("pass"), fail: count("fail"), xfail: count("xfail"), xpass: count("xpass"), error: count("error") };
console.log(`\n${summary.pass} pasan · ${summary.fail} fallan · ${summary.error} errores · gasto estimado USD ${llm.spentUsd().toFixed(4)} (${llm.label})`);
const report = { target, provider: llm.label, costUsd: llm.spentUsd(), at: new Date().toISOString(), summary, results };
writeFileSync(join(outDir, "ui-results.json"), JSON.stringify(report, null, 2));
console.log(`Reporte: ${join(outDir, "ui-results.json")} · capturas en ${shots}`);
process.exitCode = summary.fail + summary.error + summary.xpass > 0 ? 1 : 0;
