/**
 * SalesDash — acceso a FreeLLMAPI (gratis), solo para la IA de vigilancia.
 *
 * La vigilante, el analista y el revisor no comparten proveedor con el agente
 * vendedor: el vendedor sale por OpenRouter (`ia.ts`) y esto sale por
 * FreeLLMAPI. Este módulo NO importa `ia.ts` a propósito: así la vigilante no
 * puede acabar llamando a OpenRouter por un descuido.
 *
 * FreeLLMAPI habla el formato de chat de OpenAI, así que se usa el mismo
 * cliente `openai` apuntando a otra dirección. Se configura con:
 *   FREELLMAPI_BASE_URL  p. ej. https://tu-servidor/v1
 *   FREELLMAPI_API_KEY   la clave que te dio ese servicio
 *   FREELLMAPI_MODEL     opcional; por defecto «auto»
 */
import OpenAI from "openai";

export class ErrorFreeLLM extends Error {
  constructor(message: string, readonly status: number = 0) {
    super(message);
    this.name = "ErrorFreeLLM";
  }
}

export function freeLlmConfigurado(): boolean {
  return Boolean(process.env.FREELLMAPI_BASE_URL && process.env.FREELLMAPI_API_KEY);
}

let clienteCache: OpenAI | null = null;

function cliente(): OpenAI {
  const baseURL = process.env.FREELLMAPI_BASE_URL;
  const apiKey = process.env.FREELLMAPI_API_KEY;
  if (!baseURL || !apiKey) throw new ErrorFreeLLM("Falta FREELLMAPI_BASE_URL o FREELLMAPI_API_KEY");

  return (clienteCache ??= new OpenAI({ apiKey, baseURL, maxRetries: 0 }));
}

/** Solo para las pruebas: el cliente guarda la dirección y la clave del momento. */
export function _olvidarClienteFreeLLM(): void {
  clienteCache = null;
}

export interface MensajeFreeLLM {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Una llamada, con tope de tiempo DURO. El `timeout` del cliente corta la
 * conexión, pero un proveedor que gotea bytes lentamente puede pasarse; la
 * carrera con `AbortSignal.timeout` lo garantiza.
 */
export async function completarFreeLLM(p: {
  mensajes: MensajeFreeLLM[];
  temperatura?: number;
  maxTokens?: number;
  timeoutMs: number;
}): Promise<string> {
  const senal = AbortSignal.timeout(p.timeoutMs);

  try {
    const r = await cliente().chat.completions.create(
      {
        model: process.env.FREELLMAPI_MODEL || "auto",
        messages: p.mensajes,
        temperature: p.temperatura ?? 0.2,
        max_tokens: p.maxTokens ?? 900,
      },
      { timeout: p.timeoutMs, signal: senal },
    );

    const texto = r.choices?.[0]?.message?.content ?? "";
    if (!texto.trim()) throw new ErrorFreeLLM("FreeLLMAPI devolvió una respuesta vacía", 502);
    return texto;
  } catch (e) {
    if (e instanceof ErrorFreeLLM) throw e;
    if (senal.aborted) throw new ErrorFreeLLM(`FreeLLMAPI tardó más de ${Math.round(p.timeoutMs / 1000)} s`, 408);
    throw new ErrorFreeLLM((e as Error).message || "Error de FreeLLMAPI", (e as { status?: number }).status ?? 0);
  }
}
