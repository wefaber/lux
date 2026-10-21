/* oxlint-disable no-await-in-loop, no-explicit-any -- se recorre en serie a propósito; window se lee con any */
// Verificación en navegador de RNF-SEG-003 sin costo y sin clave de API: crea una incidencia con
// título malicioso contra el frontend en modo MSW y comprueba que la lista lo muestra como texto
// (sin elementos creados desde el título y sin ejecutar scripts). Sustituye, solo para este caso,
// al agente de interfaz (nivel 2) de tests/README.md.
//
//   bun run build && bunx vite preview --host 127.0.0.1 --port 4124 --strictPort &
//   bun scripts/qa/xss-ui.ts --base http://127.0.0.1:4124
import { chromium } from "playwright";
import { mockPasswords, mockUsers } from "../../src/mocks/data/users";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:4124").replace(/\/$/, "");
const CHROMIUM = arg("chromium", process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium");
const PAYLOADS = ["<img src=x onerror=window.xssFlag=1>", "<script>window.xssFlag=1</script>", '"><svg onload=window.xssFlag=1>'];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const dialogs: string[] = [];
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  await d.dismiss();
});
const user = mockUsers.find((u) => u.role === "solicitante")!;
await page.goto(`${BASE}/login`);
await page.fill("#dni", user.dni);
await page.fill("#password", mockPasswords[user.dni]);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/);
// El service worker de MSW tarda en tomar el control de la página; sin él /graphql responde 404.
await page.goto(`${BASE}/dashboard/tickets`);
await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15000 });

let failed = 0;
for (const [i, payload] of PAYLOADS.entries()) {
  const title = `${payload} xss-${i}`;
  // Misma llamada que hace gql() en src/lib/utils.ts: POST /graphql, interceptado por MSW.
  const create = () =>
    page.evaluate(
      async ({ text: titleText }) => {
        const auth = JSON.parse(localStorage.getItem("lux_auth") ?? "{}");
        const res = await fetch("/graphql", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({
            query: "mutation CreateTicket($input: TicketInput!) { createTicket(input: $input) { id title } }",
            variables: { input: { title: titleText, description: "Prueba de sanitización de entradas en la interfaz.", category: "other" } },
          }),
        });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return { status: res.status, text: text.slice(0, 200) };
        }
      },
      { text: title },
    );
  let created = await create();
  // El service worker de MSW a veces responde 404 en la primera llamada (ver src/lib/mocks-runtime.ts): un reintento.
  if (!created?.data?.createTicket?.id) {
    await page.waitForTimeout(1500);
    created = await create();
  }
  const id = created?.data?.createTicket?.id;
  await page.goto(`${BASE}/dashboard/tickets`);
  await page.waitForTimeout(1500);
  const visibleAsText = await page.evaluate((needle) => document.body.innerText.includes(needle), `xss-${i}`);
  const injected = await page.evaluate(() => document.querySelectorAll('main img[src="x"], main svg[onload], main script').length);
  const executed = await page.evaluate(() => (window as any).xssFlag === 1);
  const ok = !!id && visibleAsText && injected === 0 && !executed && dialogs.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "CUMPLE" : "NO CUMPLE"}  payload=${JSON.stringify(payload)}  id=${id ?? "(no se creó)"}  textoVisible=${visibleAsText}  elementosInyectados=${injected}  scriptEjecutado=${executed}`);
}
console.log(`\nRNF-SEG-003 en navegador (${new Date().toISOString()}): ${failed === 0 ? "cumple" : `${failed} caso(s) no cumplen`}; diálogos abiertos: ${dialogs.length}`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
