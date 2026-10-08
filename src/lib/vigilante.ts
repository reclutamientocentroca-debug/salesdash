/**
 * SalesDash — LA IA VIGILANTE.
 *
 * Lee la respuesta que el agente vendedor quiere mandar, ANTES de que salga, y
 * decide: o está bien y sale tal cual, o la reescribe como la daría la mejor
 * vendedora y sale la reescrita. El cliente no nota nada. La vigilante nunca
 * manda un mensaje propio: solo aprueba o reemplaza el del agente.
 *
 * Va por FreeLLMAPI (`freellm.ts`), nunca por OpenRouter. Convive con el
 * revisor de `revisor.ts`: aquel ya paró lo que rompe reglas mecánicas
 * (moneda, envío, resumen con huecos); esta mira la FORMA de vender según la
 * guía y las reglas fijas que escribe la dueña en el panel.
 *
 * FALLO SEGURO — la regla que no se negocia: si la vigilante tarda más de 20 s,
 * da error o devuelve algo ilegible, se envía la respuesta ORIGINAL y se anota
 * el fallo. El cliente nunca se queda sin respuesta por culpa de esta capa.
 */
import {
  obtenerVigilanteConfig,
  registrarVigilancia,
  type Mensaje,
  type ModoVigilante,
  type VeredictoVigilante,
} from "./db";
import { completarFreeLLM, freeLlmConfigurado, type MensajeFreeLLM } from "./freellm";
import { extraerJson } from "./ia";
import { conLoVistoYOido } from "./percepcion";

/** Lo máximo que se espera a la vigilante. Pasado esto, sale la original. */
export const TIEMPO_MAXIMO_MS = 20_000;
/** Cuántos mensajes de la conversación ve. */
const MENSAJES_DE_CONTEXTO = 15;

// ─────────────────────────────────────────────────────────────────────────────
// Textos de fábrica (lo que la pantalla enseña hasta que la dueña escribe lo suyo)
// ─────────────────────────────────────────────────────────────────────────────

export const PROMPT_DEFECTO = `Eres la supervisora de calidad de ventas de SalesDash. NO hablas con el cliente.
Revisas la respuesta que el agente vendedor quiere enviar y decides si está bien.

Revisa en este orden:
1. ¿Responde exactamente lo que el cliente preguntó en su último mensaje? No puede ignorar la pregunta.
2. ¿Termina con UNA sola pregunta que acerque la venta? No puede bombardear al cliente con varias preguntas.
3. ¿El precio es exactamente el del producto? Nunca puede inventar, cambiar ni redondear montos.
4. ¿Cumple todas las REGLAS FIJAS? Estas reglas mandan por encima de la guía.
5. ¿Sigue el estilo de la GUÍA DE VENTA? Frases cortas y seguras, amable, máximo 1 o 2 emojis.
6. ¿Repite algo que ya se dijo en la conversación (precio, envío, saludo)? No debe repetir.
7. ¿Pide un dato que el cliente ya dio? No debe pedirlo otra vez.
8. ¿Toma como respuesta algo que no lo es? Por ejemplo, tomar un teléfono como si fuera una dirección.

Si todo está bien → veredicto APROBADA y respuesta_final igual a la original, sin tocar ni una coma.
Si algo está mal → veredicto CORREGIDA y escribes la respuesta como la daría la mejor vendedora:
- Corriges solo lo necesario. Mantienes lo que estaba bien.
- No inventas productos, precios, colores, tallas ni políticas que no estén en la información dada.
- Nunca mencionas que eres una revisora, ni la palabra "anuncio", ni reglas internas.
- Si la respuesta correcta es pasar el chat al representante (según las reglas), la corrección debe hacer eso.

Responde SOLO con el JSON pedido.`;

export const REGLAS_FIJAS_DEFECTO = `Tratar al cliente siempre de usted, sin tutear ni vosear, también en Costa Rica.
Frases cortas y seguras, sin exceso de cortesía. Cada cosa se dice una sola vez.
El precio es el del producto. Nunca se inventa ni se cambia. Nunca se dice la palabra "anuncio" al cliente.
No preguntar cuántas unidades desea. Se asume 1 y solo se cambia si el cliente dice otra cantidad.
Desde 3 unidades se aplica el precio por mayor si viene en la descripción del producto. Si no viene, se pasa al representante.
Talla y color solo se preguntan si el producto los lleva y el cliente no los ha dicho.
Orden de la conversación: saludo → talla → color → a dónde lo enviamos → dirección exacta → costo de envío + teléfono en el mismo mensaje → nombre → resumen.
Nunca pedir el teléfono sin haber dicho antes el costo de envío.
No usar el nombre del perfil de WhatsApp. Solo usar el nombre que el cliente dé.
No enviar el resumen si falta talla, color (cuando aplica) o el nombre real.
Tienda virtual sin local físico: envío a todo el país. RD: pago contra entrega o tarjeta con link de pago. Nunca decir que no se acepta tarjeta.
No se reservan pedidos. Si el cliente quiere el pedido para otra fecha, se avisa al representante con esa fecha.
Si piden foto u otro producto distinto al del anuncio → pasar al representante.
No se envían dos tallas para medirse. Se explica con amabilidad y se ofrece ayuda para elegir la talla correcta.`;

export const GUIA_RD_DEFECTO = `Etapas de cierre:
1. Saludar rápido y con amabilidad.
2. Dar precio + beneficio por cantidad.
3. Detectar necesidad (talla, color).
4. Confirmar el pedido antes de pedir dirección.
5. Decir el total claramente.
6. Pedir datos: nombre, teléfono y dirección.
7. Si el cliente deja de responder, retomar con una pregunta concreta.

Reglas para clientes que solo preguntan:
- Responder primero lo que preguntó.
- No terminar la conversación: siempre cerrar con una pregunta de compra.
- Una pregunta a la vez.
- Llevar al cliente al producto (talla, color, uso).
- Si pregunta por mayor, detectar si es para negocio.
- Confirmar antes de pedir datos.
- Cerrar con datos cuando el cliente esté decidido.

Ejemplos (cliente → respuesta correcta):
"¿Cuánto cuesta?" → "¡Hola! 👋 La unidad tiene un precio de RD$1,400 y desde 3 unidades RD$1,190 c/u. ¿Qué talla utiliza?"
"Está caro." → "Entiendo. 👍 La unidad está en RD$1,400, pero llevando 3 o más le queda en RD$1,190 c/u. ¿Qué talla utiliza?"
"¿Hacen envíos?" → "Sí. 🚚 Realizamos envíos a todo el país y puede pagar al momento de recibir. ¿En qué provincia desea recibirlo?"
"¿Dónde están ubicados?" → "Realizamos envíos a todo el país, por lo que puede recibir su pedido en la dirección que nos indique. ¿En qué localidad desea recibirlo?"
"¿Es original?" → "Sí, es un producto BROX Original. 🔥 ¿Qué talla y color le interesa?"
"Lo voy a pensar." → "Claro, no hay problema. 👍 Si gusta, le ayudo a elegir la opción que más le convenga. ¿Qué color le interesa?"
"Ok." / "Gracias." / 👍 → "¡A usted! 😊 Si gusta, le dejo el pedido listo. ¿Qué talla utiliza?"
"¿Y si no me queda?" → "No se preocupe. 😊 Lo importante es confirmar la talla correcta antes de procesar el pedido. ¿Qué talla utiliza normalmente?"
"¿Me envía dos tallas para medírmelas?" → "Entendemos que quiera comparar. Por política no podemos enviar dos tallas para elegir una, pero le ayudamos a seleccionar la correcta según sus medidas. ¿Qué talla utiliza normalmente?"
Sin respuesta (seguimiento) → "¡Hola! 👋 Damos seguimiento a su consulta. ¿Desea que le ayudemos a elegir la talla o el color?"`;

/** La guía de fábrica de un país: solo República Dominicana trae la suya. */
export function guiaDeFabrica(pais: string): string {
  return pais === "do" ? GUIA_RD_DEFECTO : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración efectiva
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigVigilante {
  /** Interruptor general de la cuenta. */
  generalActiva: boolean;
  /** Interruptor de este canal. */
  canalActiva: boolean;
  modo: ModoVigilante;
  guia: string;
  reglas: string;
  prompt: string;
}

/** La configuración de un canal con los textos de fábrica donde no se ha escrito nada. */
export function configDelCanal(orgId: number, canalId: number, pais: string): ConfigVigilante {
  const general = obtenerVigilanteConfig(orgId, 0);
  const canal = obtenerVigilanteConfig(orgId, canalId);

  return {
    generalActiva: general?.activa === 1,
    canalActiva: canal?.activa === 1,
    modo: canal?.modo ?? "corregir",
    guia: canal?.guia ?? guiaDeFabrica(pais),
    reglas: canal?.reglas ?? REGLAS_FIJAS_DEFECTO,
    prompt: general?.prompt ?? PROMPT_DEFECTO,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// La revisión
// ─────────────────────────────────────────────────────────────────────────────

export interface LineaDeConversacion {
  quien: "CLIENTE" | "AGENTE" | "EQUIPO";
  texto: string;
}

/** Los últimos 15 mensajes, con quién dijo qué. */
export function conversacionReciente(historial: Mensaje[]): LineaDeConversacion[] {
  return historial.slice(-MENSAJES_DE_CONTEXTO).map((m) => ({
    quien: m.emisor === "cliente" ? "CLIENTE" : m.emisor === "humano" ? "EQUIPO" : "AGENTE",
    texto: m.emisor === "cliente" ? conLoVistoYOido(m) : m.content,
  }));
}

export interface ContextoVigilante {
  conversacion: LineaDeConversacion[];
  /** Descripción y precio del producto del anuncio, tal como los ve el agente. */
  producto: string | null;
  /** Envíos, costos y formas de pago del país. */
  pais: string;
  guia: string;
  reglas: string;
  prompt: string;
}

/**
 * El formato de salida NO es editable: va fijo detrás del prompt de la dueña,
 * para que cambiar el prompt desde el panel no pueda romper la lectura del JSON.
 */
const FORMATO_DE_SALIDA = `FORMATO DE SALIDA — responde SOLO con este JSON, sin texto antes ni después ni vallas de código:
{"veredicto": "APROBADA" | "CORREGIDA", "motivos": ["texto corto de cada error encontrado"], "respuesta_final": "el mensaje que se enviará al cliente"}
Con APROBADA, "motivos" va vacío y "respuesta_final" es la respuesta original, idéntica.`;

export function mensajesParaLaVigilante(ctx: ContextoVigilante, respuestaAgente: string): MensajeFreeLLM[] {
  const secciones = [
    ctx.prompt.trim(),
    `REGLAS FIJAS (prioridad máxima, mandan por encima de la guía):\n${ctx.reglas.trim() || "(ninguna)"}`,
    `GUÍA DE VENTA:\n${ctx.guia.trim() || "(sin guía escrita)"}`,
    `INFORMACIÓN DEL PAÍS (envíos, costos, formas de pago):\n${ctx.pais.trim() || "(sin datos)"}`,
    `PRODUCTO DEL ANUNCIO (descripción y precio):\n${ctx.producto?.trim() || "(no hay anuncio en esta conversación)"}`,
    FORMATO_DE_SALIDA,
  ];

  const hilo = ctx.conversacion.map((l) => `${l.quien}: ${l.texto}`).join("\n") || "(sin mensajes)";

  return [
    { role: "system", content: secciones.join("\n\n") },
    {
      role: "user",
      content: `CONVERSACIÓN RECIENTE:\n${hilo}\n\nRESPUESTA QUE EL AGENTE QUIERE ENVIAR:\n«${respuestaAgente}»`,
    },
  ];
}

interface SalidaCruda {
  veredicto?: unknown;
  motivos?: unknown;
  respuesta_final?: unknown;
}

export interface SalidaValida {
  veredicto: "APROBADA" | "CORREGIDA";
  motivos: string[];
  respuestaFinal: string;
}

/** Valida el JSON de la vigilante. Devuelve null si no se puede fiar de él. */
export function leerVeredicto(texto: string, respuestaAgente: string): SalidaValida | null {
  const j = extraerJson<SalidaCruda>(texto);
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;

  const veredicto = typeof j.veredicto === "string" ? j.veredicto.trim().toUpperCase() : "";
  if (veredicto !== "APROBADA" && veredicto !== "CORREGIDA") return null;

  const motivos = Array.isArray(j.motivos)
    ? j.motivos.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim())
    : [];

  if (veredicto === "APROBADA") {
    // Aprobada es la original, sin tocar ni una coma: lo que diga el modelo ahí no cuenta.
    return { veredicto, motivos: [], respuestaFinal: respuestaAgente };
  }

  if (typeof j.respuesta_final !== "string" || !j.respuesta_final.trim()) return null;
  const final = j.respuesta_final.trim();

  // «Corregida» con el mismo texto no corrige nada: es una aprobación.
  if (final === respuestaAgente.trim()) return { veredicto: "APROBADA", motivos: [], respuestaFinal: respuestaAgente };

  return { veredicto, motivos: motivos.length ? motivos : ["sin motivo indicado"], respuestaFinal: final };
}

/**
 * Lo que una corrección NO puede traer, pase lo que pase en el JSON: la propia
 * prompt se lo prohíbe al modelo, pero lo que no puede pasar se impide.
 */
function problemaDeLaCorreccion(corregida: string, original: string): string | null {
  if (/\banuncio\b/i.test(corregida) && !/\banuncio\b/i.test(original)) return "la corrección dice «anuncio»";
  if (/\b(revisor[a]?|supervisor[a]?|vigilante)\b/i.test(corregida) && !/\b(revisor[a]?|supervisor[a]?|vigilante)\b/i.test(original)) {
    return "la corrección habla de una revisión";
  }
  if (corregida.length > Math.max(1200, original.length * 3)) return "la corrección es desproporcionada";
  return null;
}

export interface ResultadoVigilante {
  veredicto: VeredictoVigilante;
  motivos: string[];
  /** Lo que se enviaría: la corregida solo si la corrección es válida; si no, la original. */
  respuestaFinal: string;
  error?: string;
}

export interface OpcionesRevision {
  /** Para las pruebas: sustituye la llamada al modelo. */
  llamar?: (mensajes: MensajeFreeLLM[], timeoutMs: number) => Promise<string>;
  timeoutMs?: number;
  /**
   * Comprobación extra de la respuesta corregida (las reglas mecánicas del
   * revisor). Devuelve las fallas; con alguna, la corrección se descarta y sale
   * la original: la vigilante no puede colar un precio, una moneda o un resumen
   * que el revisor habría parado.
   */
  validarCorregida?: (texto: string) => string[];
}

/** La función central. Nunca lanza: el peor caso es FALLO con la original. */
export async function revisarRespuesta(
  ctx: ContextoVigilante,
  respuestaAgente: string,
  opciones: OpcionesRevision = {},
): Promise<ResultadoVigilante> {
  const timeoutMs = opciones.timeoutMs ?? TIEMPO_MAXIMO_MS;
  const fallo = (error: string): ResultadoVigilante => ({
    veredicto: "FALLO",
    motivos: [],
    respuestaFinal: respuestaAgente,
    error,
  });

  const llamar =
    opciones.llamar ??
    (async (mensajes: MensajeFreeLLM[], t: number) => {
      if (!freeLlmConfigurado()) throw new Error("FreeLLMAPI no está configurado (FREELLMAPI_BASE_URL / FREELLMAPI_API_KEY)");
      return completarFreeLLM({ mensajes, temperatura: 0.2, timeoutMs: t });
    });

  let cruda: string;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    // Tope duro además del de la llamada: pase lo que pase, a los 20 s se sigue.
    cruda = await Promise.race([
      llamar(mensajesParaLaVigilante(ctx, respuestaAgente), timeoutMs),
      new Promise<never>((_, rechazar) => {
        reloj = setTimeout(() => rechazar(new Error(`la vigilante tardó más de ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      }),
    ]);
  } catch (e) {
    return fallo((e as Error).message || "error de la vigilante");
  } finally {
    clearTimeout(reloj);
  }

  const salida = leerVeredicto(cruda, respuestaAgente);
  if (!salida) return fallo("la vigilante devolvió algo que no es el JSON pedido");

  if (salida.veredicto === "APROBADA") return { veredicto: "APROBADA", motivos: [], respuestaFinal: respuestaAgente };

  const problema = problemaDeLaCorreccion(salida.respuestaFinal, respuestaAgente);
  if (problema) return fallo(`corrección descartada: ${problema}`);

  const fallas = opciones.validarCorregida?.(salida.respuestaFinal) ?? [];
  if (fallas.length) return fallo(`corrección descartada por las reglas: ${fallas.join("; ")}`);

  return { veredicto: "CORREGIDA", motivos: salida.motivos, respuestaFinal: salida.respuestaFinal };
}

// ─────────────────────────────────────────────────────────────────────────────
// En el punto de envío
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaDeEnvio {
  orgId: number;
  canalId: number;
  conversationId: number;
  /** Código ISO del país del agente de este canal. */
  pais: string;
  historial: Mensaje[];
  /** Lo último que dijo el cliente, para el registro. */
  ultimoDelCliente: string;
  respuesta: string;
  bloqueDelPais: string;
  producto: string | null;
  validarCorregida?: (texto: string) => string[];
}

export interface SalidaDeEnvio {
  /** El texto que sale al cliente. */
  texto: string;
  /** true si salió la versión corregida (solo en modo Corregir). */
  corregida: boolean;
}

/**
 * Lo que llama el agente justo antes de enviar. Devuelve `null` si la vigilante
 * está apagada para este canal: no se registra nada y no se toca la respuesta.
 * Nunca lanza.
 */
export async function vigilarEnvio(e: EntradaDeEnvio, opciones: OpcionesRevision = {}): Promise<SalidaDeEnvio | null> {
  let cfg: ConfigVigilante;
  try {
    cfg = configDelCanal(e.orgId, e.canalId, e.pais);
  } catch (err) {
    console.error("[vigilante] no se pudo leer la configuración:", err);
    return null;
  }
  if (!cfg.generalActiva || !cfg.canalActiva) return null;

  const r = await revisarRespuesta(
    {
      conversacion: conversacionReciente(e.historial),
      producto: e.producto,
      pais: e.bloqueDelPais,
      guia: cfg.guia,
      reglas: cfg.reglas,
      prompt: cfg.prompt,
    },
    e.respuesta,
    { validarCorregida: e.validarCorregida, ...opciones },
  );

  // En «Solo vigilar» se revisa y se anota, pero sale la original.
  const sale = r.veredicto === "CORREGIDA" && cfg.modo === "corregir";

  try {
    registrarVigilancia(e.orgId, {
      canalId: e.canalId,
      conversationId: e.conversationId,
      veredicto: r.veredicto,
      modo: cfg.modo,
      mensajeCliente: e.ultimoDelCliente,
      respuestaOriginal: e.respuesta,
      respuestaFinal: r.respuestaFinal,
      motivos: r.motivos,
      enviada: sale ? "corregida" : "original",
      error: r.error ?? null,
    });
  } catch (err) {
    console.error("[vigilante] no se pudo guardar el registro:", err);
  }

  if (r.error) console.warn(`[vigilante] conversación ${e.conversationId}: ${r.error}. Salió la respuesta original.`);

  return sale ? { texto: r.respuestaFinal, corregida: true } : { texto: e.respuesta, corregida: false };
}
