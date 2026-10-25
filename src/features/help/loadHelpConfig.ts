import { parseHelpConfig, type HelpConfig } from "@/lib/help";

// El contenido lo publica un operador en public/config/help.json: no hace falta
// recompilar ni tocar la API. `no-cache` obliga a revalidar, asi un cambio en el
// archivo se ve al recargar sin pelear con el cache del navegador.
export async function loadHelpConfig(): Promise<HelpConfig> {
  const base = import.meta.env.BASE_URL || "/";
  const response = await fetch(`${base}config/help.json`, {
    headers: { Accept: "application/json" },
    cache: "no-cache",
  });

  if (!response.ok) {
    throw new Error(`help.json returned HTTP ${response.status}`);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error("help.json is not valid JSON");
  }

  const parsed = parseHelpConfig(raw);
  if (!parsed.ok) {
    throw new Error(`invalid help.json: ${parsed.issues.join("; ")}`);
  }
  if (parsed.warnings.length > 0 && import.meta.env.DEV) {
    console.warn("[help] help.json warnings:", parsed.warnings);
  }
  return parsed.config;
}
