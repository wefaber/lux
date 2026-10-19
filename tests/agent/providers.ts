// Proveedores de modelo para el agente de UI. Cada paso es un pedido sin
// historial de mensajes (el historial va resumido en el prompt): el costo por
// paso queda acotado y no crece con la conversación.
import Anthropic from "@anthropic-ai/sdk";

export interface Action {
  action: "click" | "fill" | "select" | "press" | "goto" | "wait" | "done" | "fail";
  ref: number | null;
  text: string | null;
  reason: string;
}

export interface Provider {
  label: string;
  next(system: string, prompt: string): Promise<Action>;
  spentUsd(): number;
}

const SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["click", "fill", "select", "press", "goto", "wait", "done", "fail"] },
    ref: { type: ["integer", "null"], description: "Número [n] del elemento; null si la acción no usa elemento" },
    text: { type: ["string", "null"], description: "Texto a escribir, opción, tecla, ruta o evidencia; null si no aplica" },
    reason: { type: "string", description: "Por qué esta acción, en una frase" },
  },
  required: ["action", "ref", "text", "reason"],
  additionalProperties: false,
} as const;
const DESCRIPTION = "Ejecuta la próxima acción del tester sobre la pantalla actual.";
const NUDGE = "\n\nRespondé llamando a la herramienta act.";

function meter(inPerMTok: number, outPerMTok: number) {
  let usd = 0;
  return {
    add: (input: number, output: number) => {
      usd += (input * inPerMTok + output * outPerMTok) / 1_000_000;
    },
    total: () => usd,
  };
}

function anthropic(): Provider {
  const client = new Anthropic();
  const model = process.env.QA_MODEL ?? "claude-haiku-5-5";
  // Tarifa de Claude Haiku 5.5 con prompts de hasta 100K tokens (USD por millón).
  const cost = meter(Number(process.env.QA_PRICE_IN ?? 0.1), Number(process.env.QA_PRICE_OUT ?? 0.5));
  return {
    label: `anthropic/${model}`,
    spentUsd: cost.total,
    async next(system, prompt) {
      for (const content of [prompt, prompt + NUDGE]) {
        const res = await client.messages.create({
          model,
          max_tokens: 1024,
          system,
          // Elegir el próximo clic no necesita razonamiento extendido: sin thinking el paso es más barato.
          thinking: { type: "disabled" },
          tools: [{ name: "act", description: DESCRIPTION, input_schema: SCHEMA as unknown as Anthropic.Tool.InputSchema, strict: true }],
          messages: [{ role: "user", content }],
        });
        cost.add(res.usage.input_tokens, res.usage.output_tokens);
        if (res.stop_reason === "refusal") throw new Error("el modelo rechazó el pedido");
        const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (call) return call.input as Action;
      }
      throw new Error("el modelo no devolvió ninguna acción");
    },
  };
}

function deepseek(): Provider {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("Falta DEEPSEEK_API_KEY");
  const model = process.env.QA_MODEL ?? "deepseek-chat";
  // Tarifa de referencia de deepseek-chat sin caché (USD por millón); verificar la vigente.
  const cost = meter(Number(process.env.QA_PRICE_IN ?? 0.28), Number(process.env.QA_PRICE_OUT ?? 0.42));
  return {
    label: `deepseek/${model}`,
    spentUsd: cost.total,
    async next(system, prompt) {
      for (const content of [prompt, prompt + NUDGE]) {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [
              { role: "system", content: system },
              { role: "user", content },
            ],
            tools: [{ type: "function", function: { name: "act", description: DESCRIPTION, parameters: SCHEMA } }],
          }),
        });
        if (!res.ok) throw new Error(`DeepSeek respondió HTTP ${res.status}`);
        const body = (await res.json()) as {
          usage?: { prompt_tokens: number; completion_tokens: number };
          choices: { message: { tool_calls?: { function: { arguments: string } }[] } }[];
        };
        cost.add(body.usage?.prompt_tokens ?? 0, body.usage?.completion_tokens ?? 0);
        const args = body.choices[0]?.message.tool_calls?.[0]?.function.arguments;
        if (args) return JSON.parse(args) as Action;
      }
      throw new Error("el modelo no devolvió ninguna acción");
    },
  };
}

// Sin --provider: Anthropic si hay clave, si no DeepSeek.
export function makeProvider(name = process.env.QA_PROVIDER): Provider {
  const pick = name ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.DEEPSEEK_API_KEY ? "deepseek" : null);
  if (pick === "anthropic") return anthropic();
  if (pick === "deepseek") return deepseek();
  throw new Error("Definí ANTHROPIC_API_KEY o DEEPSEEK_API_KEY (o --provider anthropic|deepseek)");
}
