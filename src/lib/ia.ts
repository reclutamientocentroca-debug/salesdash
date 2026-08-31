/**
 * SalesDash — acceso a los modelos, vía OpenRouter.
 *
 * Lo comparten el analista y el agente vendedor. Compartirlo no rompe la
 * separación entre los dos: aquí no hay nada que escriba a un cliente de
 * WhatsApp, solo llamadas a modelos de lenguaje.
 *
 * Todas las llamadas registran su consumo en `uso_modelo`, que alimenta el
 * indicador del panel y la salud técnica de la consola de plataforma.
 */
import OpenAI from "openai";
import { registrarUso } from "./db";

const BASE_URL = "https://openrouter.ai/api/v1";

export class ErrorIA extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly esLimite: boolean,
  ) {
    super(message);
    this.name = "ErrorIA";
  }
}

let clienteCache: OpenAI | null = null;

function cliente(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new ErrorIA("Falta OPENROUTER_API_KEY", 500, false);

  return (clienteCache ??= new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    defaultHeaders: {
      // OpenRouter los usa para atribuir el tráfico a la aplicación.
      "HTTP-Referer": process.env.APP_URL ?? "https://salesdash.local",
      "X-Title": "SalesDash",
    },
    maxRetries: 0, // Los reintentos los decidimos nosotros, con el respaldo.
  }));
}

export function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Llamada con respaldo
// ─────────────────────────────────────────────────────────────────────────────

export type Proposito = "agente" | "analisis" | "vision" | "audio";

/**
 * Un trozo de mensaje: texto, una imagen, o un audio.
 *
 * El audio va incrustado en base64 y no por URL, igual que la imagen: los
 * archivos viven en el volumen de este servidor y no son alcanzables desde
 * internet. `format` es la extensión sin punto — WhatsApp manda las notas de
 * voz en ogg.
 */
export type Parte =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export interface Mensaje {
  role: "system" | "user" | "assistant";
  content: string | Parte[];
}

export interface PeticionIA {
  orgId: number;
  proposito: Proposito;
  modelo: string;
  /** Se intenta una sola vez si el principal falla o topa su límite. */
  respaldo?: string | null;
  mensajes: Mensaje[];
  maxTokens?: number;
  temperatura?: number;
  /**
   * Cuánto se espera a esta llamada. Por defecto 60 segundos.
   *
   * Existe porque no todas las llamadas valen lo mismo. Al analista, que corre
   * solo, un minuto no le cuesta nada. A lo que pasa mientras un cliente mira
   * la pantalla esperando respuesta, un minuto le cuesta la venta: ahí se pide
   * un presupuesto corto y, si no llega, se contesta con lo que se tenga.
   */
  timeoutMs?: number;
}

export interface RespuestaIA {
  texto: string;
  modelo: string;
  /** true si respondió el modelo de respaldo. */
  fueRespaldo: boolean;
}

/**
 * Lo que dijo DE VERDAD el proveedor del modelo.
 *
 * OpenRouter envuelve el error del proveedor y deja arriba un «Provider
 * returned error» que no dice absolutamente nada: el mismo texto para una
 * clave sin saldo, un modelo retirado o una petición mal armada. El motivo
 * bueno viaja dentro, en `metadata.raw`, como una cadena JSON del proveedor.
 *
 * Se saca y se pega al mensaje porque ese mensaje es el que acaba en la
 * anomalía que lee el dueño y en el registro del servidor. «Provider returned
 * error» manda a adivinar; «This model does not support assistant message
 * prefill» se arregla en dos minutos.
 */
function motivoDelProveedor(e: unknown): string {
  const bruto = (e as { error?: { metadata?: { raw?: unknown } } }).error?.metadata?.raw;
  if (typeof bruto !== "string") return "";

  try {
    const dentro = JSON.parse(bruto) as { error?: { message?: string }; message?: string };
    const detalle = dentro.error?.message ?? dentro.message;
    return detalle ? ` — ${detalle}` : "";
  } catch {
    // No siempre es JSON. Un trozo del texto crudo sigue siendo mejor que nada.
    return ` — ${bruto.slice(0, 200)}`;
  }
}

async function unaLlamada(p: PeticionIA, modelo: string): Promise<string> {
  try {
    const r = await cliente().chat.completions.create(
      {
        model: modelo,
        messages: p.mensajes as OpenAI.Chat.ChatCompletionMessageParam[],
        max_tokens: p.maxTokens ?? 700,
        temperature: p.temperatura ?? 0.2,
      },
      { timeout: p.timeoutMs ?? 60_000 },
    );

    const texto = r.choices?.[0]?.message?.content ?? "";
    if (!texto.trim()) throw new ErrorIA("El modelo devolvió una respuesta vacía", 502, false);
    return texto;
  } catch (e) {
    if (e instanceof ErrorIA) throw e;

    const status = (e as { status?: number }).status ?? 0;
    const mensaje = `${(e as Error).message ?? "Error del modelo"}${motivoDelProveedor(e)}`;

    // 429 es el caso que hay que distinguir: es el límite diario de los
    // modelos gratuitos, y es exactamente cuando toca usar el respaldo.
    throw new ErrorIA(mensaje, status, status === 429 || /rate limit/i.test(mensaje));
  }
}

/**
 * Llama al modelo principal y, si falla, reintenta UNA vez con el respaldo.
 * Si no hay respaldo o también falla, lanza: quien llame decide qué hacer.
 * El agente se calla; el analista manda la conversación a revisión.
 */
export async function completar(p: PeticionIA): Promise<RespuestaIA> {
  const dia = hoyISO();

  try {
    const texto = await unaLlamada(p, p.modelo);
    registrarUso(p.orgId, { dia, modelo: p.modelo, proposito: p.proposito, ok: true });
    return { texto, modelo: p.modelo, fueRespaldo: false };
  } catch (principal) {
    registrarUso(p.orgId, { dia, modelo: p.modelo, proposito: p.proposito, ok: false });

    if (!p.respaldo || p.respaldo === p.modelo) throw principal;

    try {
      const texto = await unaLlamada(p, p.respaldo);
      registrarUso(p.orgId, { dia, modelo: p.respaldo, proposito: p.proposito, ok: true });
      return { texto, modelo: p.respaldo, fueRespaldo: true };
    } catch (respaldo) {
      registrarUso(p.orgId, { dia, modelo: p.respaldo, proposito: p.proposito, ok: false });
      throw respaldo;
    }
  }
}

/**
 * Igual que `completar`, pero devuelve el JSON ya parseado, o `null` si el
 * modelo no devolvió JSON válido. Nunca lanza por JSON mal formado: quien
 * llama decide (el analista manda la conversación a revisión).
 */
export async function completarJson<T>(p: PeticionIA): Promise<{ datos: T | null; modelo: string }> {
  const r = await completar(p);
  return { datos: extraerJson<T>(r.texto), modelo: r.modelo };
}

/**
 * Los modelos añaden vallas de código o una frase antes del JSON por más que
 * se les pida que no. Se limpia lo previsible en vez de descartar la
 * respuesta entera.
 */
export function extraerJson<T>(texto: string): T | null {
  const limpio = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(limpio) as T;
  } catch {
    // Segundo intento: el primer objeto equilibrado que aparezca.
    const inicio = limpio.indexOf("{");
    if (inicio === -1) return null;

    let nivel = 0;
    let enTexto = false;
    let escapado = false;

    for (let i = inicio; i < limpio.length; i++) {
      const c = limpio[i]!;
      if (enTexto) {
        if (escapado) escapado = false;
        else if (c === "\\") escapado = true;
        else if (c === '"') enTexto = false;
        continue;
      }
      if (c === '"') enTexto = true;
      else if (c === "{") nivel++;
      else if (c === "}") {
        nivel--;
        if (nivel === 0) {
          try {
            return JSON.parse(limpio.slice(inicio, i + 1)) as T;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de modelos
//
// Se carga de OpenRouter, no se escribe a mano: la lista cambia cada pocas
// semanas y una lista fija envejece mal.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModeloDisponible {
  id: string;
  nombre: string;
  gratis: boolean;
  /** Dólares por millón de tokens. null en los gratuitos. */
  precioEntrada: number | null;
  precioSalida: number | null;
  contexto: number | null;
  /** Si acepta imágenes: hace falta para el modelo de visión. */
  vision: boolean;
  /** Si acepta audio. Son bastantes menos que los que aceptan imágenes. */
  audio: boolean;
}

interface ModeloOpenRouter {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; modality?: string };
}

const CACHE_MS = 24 * 60 * 60 * 1000;
let cacheModelos: { cuando: number; lista: ModeloDisponible[] } | null = null;

export async function listarModelos(): Promise<ModeloDisponible[]> {
  if (cacheModelos && Date.now() - cacheModelos.cuando < CACHE_MS) return cacheModelos.lista;

  const r = await fetch(`${BASE_URL}/models`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!r.ok) throw new ErrorIA(`OpenRouter respondió ${r.status}`, r.status, r.status === 429);

  const cuerpo = (await r.json()) as { data?: ModeloOpenRouter[] };

  const lista = (cuerpo.data ?? []).map((m): ModeloDisponible => {
    const entrada = Number(m.pricing?.prompt ?? "0");
    const salida = Number(m.pricing?.completion ?? "0");
    // Gratis por precio cero o por el sufijo :free del identificador.
    const gratis = m.id.endsWith(":free") || (entrada === 0 && salida === 0);

    const modalidades = m.architecture?.input_modalities ?? [];

    return {
      id: m.id,
      nombre: m.name ?? m.id,
      gratis,
      // El precio viene por token; se muestra por millón, que es como se lee.
      precioEntrada: gratis ? null : entrada * 1_000_000,
      precioSalida: gratis ? null : salida * 1_000_000,
      contexto: m.context_length ?? null,
      vision:
        modalidades.includes("image") || (m.architecture?.modality ?? "").includes("image"),
      // Bastantes menos modelos oyen que ven, por eso son dos listas.
      audio: modalidades.includes("audio"),
    };
  });

  lista.sort((a, b) => {
    if (a.gratis !== b.gratis) return a.gratis ? -1 : 1;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  cacheModelos = { cuando: Date.now(), lista };
  return lista;
}

/** Para las pruebas y para forzar una recarga desde el panel. */
export function _vaciarCacheModelos(): void {
  cacheModelos = null;
}
