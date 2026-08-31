/**
 * SalesDash — IA vendedora.
 *
 * ═══ EL ÚNICO MÓDULO QUE ENVÍA ═══
 * Este es el único archivo del sistema que puede mandar un mensaje a un
 * cliente. El transporte vive en `wa.ts`, pero ESTE es el único módulo que
 * importa su función de envío, y una prueba barre el código para comprobarlo.
 * El analista no la tiene ni la puede alcanzar.
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
  usoDelDia,
  type Agente,
  type Mensaje,
  type Producto,
  type Conversacion,
} from "./db";
import { descifrar } from "./auth";
import { anuncioParaModelo, type DatosAnuncio } from "./anuncio";
import { MARCADOR_POR_DEFECTO, registrarCierre } from "./cierre";
import { completar, ErrorIA, hoyISO } from "./ia";

/** Ventana en la que un mensaje de vendedor silencia al agente. */
const SILENCIO_TRAS_HUMANO = 2 * 60 * 60;
/** Tope de respuestas por conversación y hora, contra bucles. */
const MAX_RESPUESTAS_HORA = 8;
const MAX_MENSAJES_CONTEXTO = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Envío — privado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El envío por el socket de WhatsApp vive en `wa.ts`, que es el transporte.
 *
 * Esta función existe igualmente, y sigue sin exportarse, porque la garantía
 * del producto no es «el código de enviar está en este archivo» sino «nadie
 * salvo el agente puede enviar». `wa.enviarTexto` tiene que ser público para
 * que este módulo lo use; lo que lo mantiene a raya es que ESTE es el único
 * archivo que lo importa, y hay una prueba que lo comprueba barriendo el
 * código. Si mañana otro módulo lo importa, esa prueba falla.
 */
async function enviarTexto(canalId: number, para: string, texto: string): Promise<string> {
  const { enviarTexto: enviar } = await import("./wa");
  return enviar(canalId, para, texto);
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

/**
 * ¿VA A CONTESTAR ESTE NÚMERO? Dicho antes de que escriba un cliente.
 *
 * Encender el agente y descubrir tres días después —por un cliente que se fue
 * sin respuesta— que faltaba la clave del modelo, o que el número estaba en
 * modo vigilar, no es aceptable. Esta función mira exactamente las mismas
 * condiciones que `atenderConversacion` y las dice en voz alta, para que la
 * pantalla que enciende el interruptor pueda contestar «listo» o «esto falta».
 *
 * Vive AQUÍ, pegada a las guardas que copia, porque si alguien añade una
 * condición de silencio allí y no aquí, el panel diría que todo está bien
 * mientras el agente calla. No llama a ningún modelo: son lecturas de la base.
 *
 * `listo` es lo que impide hablar. Los avisos de horario y de conexión no lo
 * apagan: uno es temporal por definición y el otro se arregla solo al
 * reconectar el socket.
 */
export interface RevisionAgente {
  /** Nada impide que conteste al próximo cliente. */
  listo: boolean;
  /** Lo que hay que arreglar, en el orden en que lo frena. */
  impedimentos: string[];
  /** Cierto ahora mismo, pero no es una avería. */
  avisos: string[];
}

export function revisarAgente(orgId: number, canalId: number): RevisionAgente {
  const impedimentos: string[] = [];
  const avisos: string[] = [];

  const canal = obtenerCanal(orgId, canalId);
  if (!canal) return { listo: false, impedimentos: ["El número no existe."], avisos };

  if (canal.activo !== 1) {
    impedimentos.push("El número está apagado: enciéndelo en Números.");
  }

  if (canal.contesta_ia === 1) {
    impedimentos.push(
      "Este número está en modo vigilar —aquí contesta tu propia IA y el panel solo mira—, " +
        "así que el agente no escribe. Enciende el interruptor de este número aquí abajo.",
    );
  }

  if (canal.agente_activo !== 1) {
    impedimentos.push("El agente está apagado en este número.");
  }

  if (!process.env.OPENROUTER_API_KEY) {
    impedimentos.push(
      "Falta la clave del modelo (OPENROUTER_API_KEY) en el servidor: sin ella no se puede generar ni una respuesta.",
    );
  }

  const agente = obtenerAgente(orgId);

  if (agente.horario_activo === 1 && !dentroDeHorario(agente.horario_desde, agente.horario_hasta)) {
    avisos.push(
      `Ahora mismo está fuera del horario (${agente.horario_desde ?? "?"}–${agente.horario_hasta ?? "?"}): ` +
        "volverá a contestar dentro de la franja.",
    );
  }

  if (canal.estado !== "conectado") {
    avisos.push(
      `El número aparece «${canal.estado}» en WhatsApp: los mensajes no entran hasta que reconecte. ` +
        "El agente ya queda encendido y contestará en cuanto vuelva.",
    );
  }

  /*
   * El cupo del modelo gratuito se agota a media tarde y el agente enmudece sin
   * que nada cambie en la pantalla. Si hoy TODAS las llamadas fallaron, eso es
   * lo que está pasando.
   */
  const uso = usoDelDia(orgId, hoyISO()).filter((u) => u.proposito === "agente");
  const exitos = uso.reduce((n, u) => n + u.exitos, 0);
  const fallos = uso.reduce((n, u) => n + u.fallos, 0);

  if (fallos > 0 && exitos === 0) {
    impedimentos.push(
      `Hoy fallaron las ${fallos} llamadas al modelo y no salió ninguna respuesta. ` +
        (agente.modelo.endsWith(":free")
          ? "El modelo gratuito agota su cupo diario: elige uno de pago o configura un respaldo."
          : "Revisa el modelo y la clave."),
    );
  }

  return { listo: impedimentos.length === 0, impedimentos, avisos };
}

export type MotivoSilencio =
  | "agente_apagado"
  /** En este número ya contesta otra IA. Ver la guarda en `atenderConversacion`. */
  | "contesta_otra_ia"
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

/**
 * El prompt del sistema. Se exporta para que una prueba pueda leerlo: que el
 * anuncio llegue al modelo no hay forma de comprobarlo sin llamar a la red, y
 * es justo lo que no puede volver a perderse.
 */
export function armarSistema(
  negocio: string,
  agente: Agente,
  catalogo: Producto[],
  anuncio: DatosAnuncio | null,
  /** El marcador con el que se declara cerrada una venta. */
  marcador: string = MARCADOR_POR_DEFECTO,
): string {
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

  /*
   * El anuncio que trajo al cliente entra en el prompt, y esto no es un lujo.
   *
   * Es lo que el cliente vino buscando: sin ello el agente abre preguntando
   * «¿qué producto te interesa?» a alguien que acaba de pinchar la foto de ese
   * producto, y esa primera pregunta boba es la que hace que no conteste. El
   * anuncio lo publicó el propio negocio, así que se puede dar por bueno para
   * SABER de qué se habla; el catálogo sigue mandando en precios y condiciones,
   * y eso lo dicen las reglas de abajo.
   */
  const deAnuncio = anuncio ? anuncioParaModelo(anuncio) : null;

  return `Eres ${agente.nombre}, quien atiende el WhatsApp de ${negocio}.

${TONOS[agente.tono] ?? TONOS.cercano}

Catálogo:
${productos}

${deAnuncio ? `${deAnuncio}\n` : ""}
${agente.instrucciones ? `Instrucciones del negocio:\n${agente.instrucciones}\n` : ""}
Reglas que no puedes romper:
- No inventes precios, productos, plazos ni promociones. Si algo no está arriba, di que lo confirmas y no lo prometas.${
  deAnuncio
    ? `
- Da por hecho que el cliente escribe por el producto del anuncio: no le preguntes de qué producto habla ni le pidas que lo repita. Si él nombra otro, manda lo que él diga.
- El anuncio dice lo que se le prometió, no lo que hay. Si promete un precio o una condición que no está en el catálogo, ni la niegues ni la confirmes por tu cuenta: dile que lo confirmas con el equipo.`
    : ""
}
- Responde corto, como se escribe por WhatsApp: una o dos frases. Nada de listas largas ni de textos de catálogo.
- No pidas datos que ya te dieron en la conversación.
- Si el cliente pide hablar con una persona, dile que ya avisas a alguien del equipo y no sigas vendiendo.
- Escribe solo el mensaje que va a leer el cliente. Sin comillas, sin explicaciones, sin firmar.

CÓMO SE CIERRA UNA VENTA:
Cuando el cliente ya confirmó qué lleva y cómo lo paga, y no falta ningún dato del pedido, manda un último mensaje que EMPIECE con "${marcador}" y siga con el pedido en una línea: producto, cantidad, total y envío.
Ejemplo: ${marcador} 2 camisas talla M — 2500 en total, 300 de envío incluido.
Ese mensaje es lo que registra la venta en el sistema. Si no lo mandas, para el negocio la venta no existe.
No escribas "${marcador}" en ningún otro momento: ni para resumir lo que llevan hablado, ni para repetir una lista de precios. Solo cierra pedidos confirmados.`;
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
  /** El anuncio del hilo, si lo trajo uno. El chat de prueba no tiene. */
  anuncio: DatosAnuncio | null = null,
  /**
   * Qué se puede cotizar en este hilo, según el catálogo. Va DESPUÉS del prompt
   * normal a propósito: lo último que lee el modelo es lo que más pesa, y esta
   * es la regla que no puede saltarse.
   */
  reglaPrecio: string | null = null,
): Promise<RespuestaGenerada> {
  const org = obtenerOrg(orgId);
  const agente = obtenerAgente(orgId);
  const catalogo = listarCatalogo(orgId, true);

  /*
   * LA CONVERSACIÓN TIENE QUE ACABAR EN EL CLIENTE.
   *
   * No es un capricho nuestro: los modelos actuales rechazan con un 400 una
   * conversación que termina en el turno del asistente —«assistant message
   * prefill»—. `atenderConversacion` ya lo garantiza con su guarda de
   * `ultimo_no_es_cliente`, pero esta función también la llaman el chat de
   * prueba y las verificaciones, y ahí el error llegaba como un «400 Provider
   * returned error» que no explicaba nada.
   *
   * Se corta aquí, con el motivo escrito, en vez de gastar la llamada.
   */
  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo || ultimo.emisor !== "cliente") {
    throw new ErrorIA(
      "No hay nada que contestar: la conversación no termina en un mensaje del cliente",
      400,
      false,
    );
  }

  const r = await completar({
    orgId,
    proposito: "agente",
    modelo: agente.modelo,
    respaldo: agente.modelo_respaldo,
    mensajes: [
      {
        role: "system",
        content:
          armarSistema(
            org?.nombre ?? "el negocio",
            agente,
            catalogo,
            anuncio,
            org?.marcador_cierre ?? MARCADOR_POR_DEFECTO,
          ) + (reglaPrecio ? `\n\n${reglaPrecio}` : ""),
      },
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

/**
 * QUÉ PUEDE COTIZAR EL AGENTE EN ESTE HILO.
 *
 * El precio sale del catálogo, NUNCA del modelo. Cuando el cliente llegó por un
 * anuncio de Meta, ese anuncio tiene que estar vinculado a un producto: de ahí
 * sale el precio bueno. Si no lo está, el agente no cotiza — dice que le
 * atiende alguien del equipo y se calla.
 *
 * El `meta_ad_id` se guardó en el PRIMER mensaje del hilo, que es el único que
 * lo trae. Leerlo aquí en cada respuesta es la «reinyección»: el anuncio sigue
 * pesando en la conversación número veinte igual que en la primera.
 *
 * Devuelve null cuando no hay nada que añadir —WhatsApp, o Meta sin anuncio—.
 * Ahí manda el prompt de siempre, que ya prohíbe inventar precios.
 *
 * La anomalía se crea una sola vez por hilo: sin la guarda, cada mensaje del
 * cliente generaría otra y la bandeja de revisión quedaría inservible.
 */
async function reglaDePrecio(orgId: number, conv: Conversacion): Promise<string | null> {
  if (!conv.meta_ad_id) return null;

  const { resolverAnuncio, anuncioParaPrompt, explicarMotivo } = await import(
    "@/lib/meta/contexto-anuncio"
  );

  const contexto = resolverAnuncio(orgId, conv.meta_ad_id, conv.producto_anuncio);

  if (!contexto.puedeCotizar && !hayAnomaliaAbierta(orgId, conv.id, "anuncio_sin_producto")) {
    crearAnomalia(orgId, {
      conversationId: conv.id,
      tipo: "anuncio_sin_producto",
      severidad: "alta",
      detalle: explicarMotivo(contexto),
    });
  }

  return anuncioParaPrompt(contexto);
}

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

  /*
   * EN UN NÚMERO DONDE YA CONTESTA OTRA IA, ESTE AGENTE NO ABRE LA BOCA.
   *
   * `contesta_ia` lo enciende el dueño para decir que las respuestas de ese
   * WhatsApp las escribe un bot suyo y que el panel solo mira. Si además
   * alguien dejara encendido nuestro agente —por descuido, o porque lo probó
   * hace un mes—, el cliente recibiría dos respuestas distintas al mismo
   * mensaje, de dos vendedores que no se conocen entre sí. Eso no se arregla
   * después: ya lo leyó.
   *
   * Por eso la guarda está AQUÍ, en el único camino por el que sale un mensaje,
   * y no en la pantalla que enciende el interruptor: lo que no puede pasar es
   * que hable, no que quede mal configurado.
   */
  if (canal.contesta_ia === 1) return { atendida: false, motivo: "contesta_otra_ia" };

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
    // `conv` lleva el anuncio que abrió el hilo: producto y promesa. Es lo que
    // el agente necesita para no preguntar lo que el cliente ya vino a pedir.
    respuesta = await generarRespuesta(orgId, historial, conv, await reglaDePrecio(orgId, conv));
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
  /*
   * Cada canal por su transporte. Es el ÚNICO sitio del código donde se elige,
   * y sigue siendo el único camino por el que sale un mensaje: la regla no era
   * «solo existe wa.ts», era «solo agent.ts envía».
   *
   * Un comentario se responde colgado del comentario, en público, porque es
   * donde preguntó el cliente. Contestar solo por privado deja la pregunta a la
   * vista y sin respuesta, y el siguiente que la lea se va.
   */
  let messageId: string;
  try {
    if (canal.tipo === "meta") {
      const { enviarMensajeMeta, responderComentarioMeta } = await import("@/lib/meta/send");
      messageId =
        conv.superficie === "comentario"
          ? await responderComentarioMeta(canal, ultimo.whapi_message_id ?? "", respuesta.texto)
          : await enviarMensajeMeta(canal, conv.cliente_phone, respuesta.texto);
    } else {
      /*
       * A la dirección guardada del cliente, no a su número reconstruido.
       *
       * `cliente_jid` es la dirección tal cual la mandó WhatsApp. Solo cae al
       * teléfono en los hilos viejos, de antes de que se guardara: ahí sigue
       * siendo lo único que hay, y para un cliente identificado por su número
       * es exactamente lo mismo.
       */
      messageId = await enviarTexto(canal.id, conv.cliente_jid ?? conv.cliente_phone, respuesta.texto);
    }
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
    const cuando = ahora();
    insertMessage(orgId, {
      conversationId,
      whapiMessageId: messageId,
      emisor: "ia",
      tipo: "texto",
      content: respuesta.texto,
      createdAt: cuando,
    });

    /*
     * Si este mensaje era el resumen del pedido, la venta queda cerrada AQUÍ.
     *
     * Tiene que ser en este punto y no en la ingesta: el mensaje que el agente
     * acaba de mandar ya está guardado, así que cuando WhatsApp lo devuelva por
     * el socket la inserción no hará nada —es idempotente— y nadie más volvería
     * a mirarlo. Sin esto, la IA cierra la venta y el dashboard no se entera.
     */
    if (registrarCierre(orgId, conversationId, { emisor: "ia", content: respuesta.texto, cuando })) {
      console.log(`[agente] venta cerrada por la IA en la conversación ${conversationId}`);
    }
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
    transcripcion: null,
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
