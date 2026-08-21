/**
 * SalesDash — IA vendedora.
 *
 * ═══ EL ÚNICO MÓDULO QUE ENVÍA ═══
 * `enviarTexto` es la única función del sistema que habla con la API de
 * mensajes de WhatsApp. No se exporta: nadie fuera de este archivo puede
 * llamarla. El analista no la tiene ni la puede alcanzar.
 *
 * El agente es opcional y va apagado por defecto. Se dispara solo si el canal
 * tiene `agente_activo = 1`, el mensaje es del cliente, y no aplica ninguna
 * condición de silencio.
 *
 * Regla que no se rompe nunca: si algo falla, el agente SE CALLA. Jamás le
 * escribe "hubo un error" a un cliente. Es preferible el silencio y que un
 * vendedor lo tome.
 */
import {
  ahora,
  contarRespuestasIa,
  crearAnomalia,
  getConversation,
  hayAnomaliaAbierta,
  huboHumanoReciente,
  insertMessage,
  listarCatalogo,
  listarMensajes,
  obtenerAgente,
  obtenerCanal,
  obtenerOrg,
  registrarAiSent,
  ultimosMensajes,
  type Agente,
  type Mensaje,
  type Producto,
} from "./db";
import { descifrar } from "./auth";
import { completar, ErrorIA } from "./ia";

const GATE = "https://gate.whapi.cloud";

/** Ventana en la que un mensaje de vendedor silencia al agente. */
const SILENCIO_TRAS_HUMANO = 2 * 60 * 60;
/** Tope de respuestas por conversación y hora, contra bucles. */
const MAX_RESPUESTAS_HORA = 8;
const MAX_MENSAJES_CONTEXTO = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Envío — privado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST https://gate.whapi.cloud/messages/text → { sent, message: { id } }
 * Verificado contra la documentación de Whapi.
 */
async function enviarTexto(token: string, para: string, texto: string): Promise<string> {
  const r = await fetch(`${GATE}/messages/text`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: para, body: texto, typing_time: 2 }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!r.ok) throw new Error(`Whapi respondió ${r.status} al enviar`);

  const datos = (await r.json()) as { sent?: boolean; message?: { id?: string } };
  const id = datos.message?.id;
  if (!id) throw new Error("Whapi no devolvió el id del mensaje enviado");

  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Condiciones de silencio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Frases con las que un cliente pide una persona. Se detectan de forma
 * mecánica y no con el modelo: es la condición más importante de acertar y no
 * puede depender de que el modelo esté disponible.
 */
const PIDE_HUMANO = [
  "hablar con una persona",
  "hablar con alguien",
  "con un humano",
  "una persona real",
  "atencion humana",
  "atención humana",
  "un asesor",
  "un vendedor",
  "un agente humano",
  "no quiero un bot",
  "eres un bot",
  "es un robot",
];

export function pideHumano(texto: string): boolean {
  const limpio = texto.toLowerCase();
  return PIDE_HUMANO.some((f) => limpio.includes(f));
}

/** "20:00"–"02:00" también es un horario válido: cruza la medianoche. */
export function dentroDeHorario(desde: string | null, hasta: string | null, fecha = new Date()): boolean {
  if (!desde || !hasta) return true;

  const aMinutos = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  const ahoraMin = fecha.getHours() * 60 + fecha.getMinutes();
  const d = aMinutos(desde);
  const h = aMinutos(hasta);

  return d <= h ? ahoraMin >= d && ahoraMin <= h : ahoraMin >= d || ahoraMin <= h;
}

export type MotivoSilencio =
  | "agente_apagado"
  | "canal_apagado"
  | "ultimo_no_es_cliente"
  | "vendedor_reciente"
  | "pidio_humano"
  | "fuera_de_horario"
  | "limite_por_hora";

// ─────────────────────────────────────────────────────────────────────────────
// Generación
// ─────────────────────────────────────────────────────────────────────────────

const TONOS: Record<string, string> = {
  cercano: "Habla cercano y natural, de tú, como un vendedor amable de barrio.",
  formal: "Habla con cortesía y de usted, con frases completas.",
  directo: "Ve al grano. Frases cortas, sin rodeos ni relleno.",
  alegre: "Habla con energía y entusiasmo, sin exagerar.",
};

function armarSistema(negocio: string, agente: Agente, catalogo: Producto[]): string {
  const productos = catalogo.length
    ? catalogo
        .map((p) => {
          const partes = [p.nombre];
          if (p.variantes) partes.push(`(${p.variantes})`);
          if (p.precio !== null) partes.push(`— ${p.precio}`);
          return `- ${partes.join(" ")}`;
        })
        .join("\n")
    : "(sin catálogo cargado)";

  return `Eres ${agente.nombre}, quien atiende el WhatsApp de ${negocio}.

${TONOS[agente.tono] ?? TONOS.cercano}

Catálogo:
${productos}

${agente.instrucciones ? `Instrucciones del negocio:\n${agente.instrucciones}\n` : ""}
Reglas que no puedes romper:
- No inventes precios, productos, plazos ni promociones. Si algo no está arriba, di que lo confirmas y no lo prometas.
- Responde corto, como se escribe por WhatsApp: una o dos frases. Nada de listas largas ni de textos de catálogo.
- No pidas datos que ya te dieron en la conversación.
- Si el cliente pide hablar con una persona, dile que ya avisas a alguien del equipo y no sigas vendiendo.
- Escribe solo el mensaje que va a leer el cliente. Sin comillas, sin explicaciones, sin firmar.`;
}

function aHistorial(mensajes: Mensaje[]) {
  return mensajes.map((m) => ({
    role: m.emisor === "cliente" ? ("user" as const) : ("assistant" as const),
    content:
      m.emisor === "humano"
        ? `(mensaje de un compañero del equipo) ${m.content}`
        : m.content,
  }));
}

export interface RespuestaGenerada {
  texto: string;
  modelo: string;
  fueRespaldo: boolean;
}

/**
 * Genera una respuesta SIN enviarla. La usan el chat de prueba del panel y
 * `atenderConversacion`.
 */
export async function generarRespuesta(
  orgId: number,
  mensajes: Mensaje[],
): Promise<RespuestaGenerada> {
  const org = obtenerOrg(orgId);
  const agente = obtenerAgente(orgId);
  const catalogo = listarCatalogo(orgId, true);

  const r = await completar({
    orgId,
    proposito: "agente",
    modelo: agente.modelo,
    respaldo: agente.modelo_respaldo,
    mensajes: [
      { role: "system", content: armarSistema(org?.nombre ?? "el negocio", agente, catalogo) },
      ...aHistorial(mensajes),
    ],
    maxTokens: 400,
    temperatura: 0.6,
  });

  return {
    // Los modelos a veces envuelven la respuesta en comillas pese a pedirlo.
    texto: r.texto.trim().replace(/^["“](.*)["”]$/s, "$1").trim(),
    modelo: r.modelo,
    fueRespaldo: r.fueRespaldo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Atender una conversación
// ─────────────────────────────────────────────────────────────────────────────

export type Resultado =
  | { atendida: false; motivo: MotivoSilencio }
  | { atendida: false; motivo: "fallo_modelo"; detalle: string }
  | { atendida: true; messageId: string; modelo: string };

/**
 * Punto de entrada desde el webhook. Es la ÚNICA ruta por la que sale un
 * mensaje de SalesDash.
 */
export async function atenderConversacion(
  orgId: number,
  canalId: number,
  conversationId: number,
): Promise<Resultado> {
  const canal = obtenerCanal(orgId, canalId);
  if (!canal || canal.activo !== 1) return { atendida: false, motivo: "canal_apagado" };
  if (canal.agente_activo !== 1) return { atendida: false, motivo: "agente_apagado" };

  const conv = getConversation(orgId, conversationId);
  if (!conv) return { atendida: false, motivo: "canal_apagado" };

  const agente = obtenerAgente(orgId);
  const t = ahora();

  // ── Nunca responder a algo que no escribió el cliente ───────────────────
  const historial = ultimosMensajes(orgId, conversationId, MAX_MENSAJES_CONTEXTO);
  const ultimo = historial[historial.length - 1];
  if (!ultimo || ultimo.emisor !== "cliente") {
    return { atendida: false, motivo: "ultimo_no_es_cliente" };
  }

  // ── El cliente pidió una persona ────────────────────────────────────────
  if (agente.pasar_a_humano === 1) {
    const yaPidio = hayAnomaliaAbierta(orgId, conversationId, "pidio_humano");
    if (yaPidio || pideHumano(ultimo.content)) {
      if (!yaPidio) {
        crearAnomalia(orgId, {
          conversationId,
          tipo: "pidio_humano",
          severidad: "alta",
          detalle: `${conv.cliente_nombre ?? conv.cliente_phone} pidió hablar con una persona. El agente dejó de responder.`,
        });
      }
      return { atendida: false, motivo: "pidio_humano" };
    }
  }

  // ── Un vendedor está en la conversación ─────────────────────────────────
  // Esta es la que evita que el agente y el vendedor le escriban encima al
  // cliente a la vez.
  if (agente.silenciar_si_humano === 1 && huboHumanoReciente(orgId, conversationId, t - SILENCIO_TRAS_HUMANO)) {
    return { atendida: false, motivo: "vendedor_reciente" };
  }

  // ── Horario ─────────────────────────────────────────────────────────────
  if (agente.horario_activo === 1 && !dentroDeHorario(agente.horario_desde, agente.horario_hasta)) {
    return { atendida: false, motivo: "fuera_de_horario" };
  }

  // ── Tope por hora, contra bucles ────────────────────────────────────────
  if (contarRespuestasIa(orgId, conversationId, t - 3600) >= MAX_RESPUESTAS_HORA) {
    crearAnomalia(orgId, {
      conversationId,
      tipo: "agente_en_bucle",
      severidad: "alta",
      detalle: `El agente ya mandó ${MAX_RESPUESTAS_HORA} respuestas en una hora. Se detuvo para no inundar al cliente.`,
    });
    return { atendida: false, motivo: "limite_por_hora" };
  }

  // ── Generar ─────────────────────────────────────────────────────────────
  let respuesta: RespuestaGenerada;
  try {
    respuesta = await generarRespuesta(orgId, historial);
  } catch (e) {
    /*
     * El modelo falló y su respaldo también, o no había respaldo.
     * NO se le escribe nada al cliente. Se calla, se marca la conversación
     * para atención humana y se genera una anomalía de severidad alta.
     */
    const detalle = e instanceof ErrorIA ? e.message : "El modelo no respondió";
    crearAnomalia(orgId, {
      conversationId,
      tipo: "agente_sin_modelo",
      severidad: "alta",
      detalle:
        `El agente no pudo responder (${detalle}). ` +
        (e instanceof ErrorIA && e.esLimite
          ? "El modelo agotó su límite diario. Cambia de modelo o configura uno de respaldo."
          : "Atiende esta conversación a mano."),
    });
    return { atendida: false, motivo: "fallo_modelo", detalle };
  }

  if (!respuesta.texto) return { atendida: false, motivo: "fallo_modelo", detalle: "respuesta vacía" };

  // ── Enviar ──────────────────────────────────────────────────────────────
  let messageId: string;
  try {
    messageId = await enviarTexto(descifrar(canal.token_cifrado), conv.cliente_phone, respuesta.texto);
  } catch (e) {
    crearAnomalia(orgId, {
      conversationId,
      tipo: "envio_fallido",
      severidad: "alta",
      detalle: `No se pudo enviar la respuesta: ${e instanceof Error ? e.message : "error desconocido"}`,
    });
    return { atendida: false, motivo: "fallo_modelo", detalle: "no se pudo enviar" };
  }

  /*
   * ATRIBUCIÓN — esto NO puede fallar en silencio.
   *
   * Si el id no se registra, el webhook del saliente lo contará como humano y
   * la métrica central del producto queda al revés. Va inmediatamente después
   * del envío, y si algo saliera mal se grita en el registro.
   */
  try {
    registrarAiSent(orgId, messageId);
    insertMessage(orgId, {
      conversationId,
      whapiMessageId: messageId,
      emisor: "ia",
      tipo: "texto",
      content: respuesta.texto,
      createdAt: ahora(),
    });
  } catch (e) {
    console.error(
      `CRÍTICO: se envió el mensaje ${messageId} pero no se pudo registrar como de la IA. ` +
        "Se contará como humano y las métricas quedarán mal.",
      e,
    );
    crearAnomalia(orgId, {
      conversationId,
      tipo: "atribucion_perdida",
      severidad: "alta",
      detalle: "Se envió una respuesta de la IA que no se pudo registrar. Revisa a quién se atribuye.",
    });
  }

  return { atendida: true, messageId, modelo: respuesta.modelo };
}

/** Chat de prueba del panel: genera con la configuración real y NO envía. */
export async function probarAgente(orgId: number, conversacion: { rol: "cliente" | "agente"; texto: string }[]) {
  const falsos: Mensaje[] = conversacion.map((m, i) => ({
    id: i + 1,
    org_id: orgId,
    conversation_id: 0,
    whapi_message_id: null,
    emisor: m.rol === "cliente" ? "cliente" : "ia",
    tipo: "texto",
    descripcion_imagen: null,
    categoria_imagen: null,
    media_url: null,
    content: m.texto,
    created_at: ahora() + i,
  }));

  return generarRespuesta(orgId, falsos);
}

/** Para el analista y el panel: el hilo completo, por si hace falta. */
export function historialCompleto(orgId: number, conversationId: number): Mensaje[] {
  return listarMensajes(orgId, conversationId);
}
