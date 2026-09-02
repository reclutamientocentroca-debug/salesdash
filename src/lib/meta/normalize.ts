/**
 * El evento de Meta, traducido a lo que habla SalesDash.
 *
 * Este módulo es la frontera: a la izquierda el formato de Meta, a la derecha
 * `MensajeEntrante`, que es el que entiende `ingesta.ts`. Igual que `wa.ts`
 * traduce lo de Baileys, esto traduce lo de Meta, y por eso `ingerir` no tiene
 * que enterarse de que existe un canal nuevo.
 *
 * Aquí NO se escribe en la base y NO se llama a nadie. Entra un objeto, sale
 * una lista.
 */
import type { MensajeEntrante } from "@/lib/ingesta";

/** Por dónde entró el hilo. Se guarda en la conversación, no en el canal. */
export type Superficie = "messenger" | "instagram" | "comentario";

export interface MensajeMeta extends MensajeEntrante {
  superficie: Superficie;
  /** El anuncio que trajo al cliente, si el referral venía en este evento. */
  metaAdId: string | null;
  /** Solo en los comentarios: a qué comentario hay que contestar. */
  comentarioId: string | null;
}

/** Lo que Meta manda en el sobre. Solo se declara lo que se usa. */
interface EventoMeta {
  object?: string;
  entry?: {
    id?: string;
    time?: number;
    messaging?: unknown[];
    changes?: { field?: string; value?: unknown }[];
  }[];
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/**
 * Epoch en milisegundos → segundos.
 *
 * Meta manda milisegundos y toda la base guarda segundos. Sin dividir, una
 * conversación de hoy se archiva con fecha del año 57000 y no aparece en ningún
 * rango del panel: el mensaje entra y el hilo se vuelve invisible.
 */
function aSegundos(ms: unknown): number {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * Traduce un sobre entero.
 *
 * `destinoId` es la página o la cuenta de Instagram con la que se resolvió el
 * canal: hace falta para saber, en cada mensaje, quién es el cliente y quién
 * somos nosotros. En Meta los dos lados vienen como `sender`/`recipient` y el
 * único modo de distinguirlos es comparar con el nuestro.
 */
export function normalizarEvento(cuerpo: unknown, destinoId: string): MensajeMeta[] {
  const evento = objeto(cuerpo) as EventoMeta;
  const salida: MensajeMeta[] = [];
  const esInstagram = evento.object === "instagram";

  for (const entrada of evento.entry ?? []) {
    // ── Mensajes directos: Messenger y DM de Instagram ────────────────────
    for (const bruto of entrada.messaging ?? []) {
      const m = normalizarMensaje(bruto, destinoId, esInstagram);
      if (m) salida.push(m);
    }

    // ── Comentarios en publicaciones y anuncios ───────────────────────────
    for (const cambio of entrada.changes ?? []) {
      if (cambio.field !== "feed" && cambio.field !== "comments") continue;
      const c = normalizarComentario(cambio.value, destinoId, esInstagram);
      if (c) salida.push(c);
    }
  }

  return salida;
}

function normalizarMensaje(
  bruto: unknown,
  destinoId: string,
  esInstagram: boolean,
): MensajeMeta | null {
  const e = objeto(bruto);
  const mensaje = objeto(e.message);
  const emisorId = texto(objeto(e.sender).id);
  const receptorId = texto(objeto(e.recipient).id);

  // Sin identificadores no hay conversación posible.
  if (!emisorId || !receptorId) return null;

  /*
   * DE QUIÉN ES ESTE MENSAJE.
   *
   * `is_echo` es la marca de Meta para «esto lo mandaste tú»: llega cuando
   * responde el agente Y cuando responde un vendedor desde la bandeja. Si el
   * emisor es nuestra propia página, también es nuestro.
   *
   * Que un eco entre NO es un problema, es lo correcto: así el hilo guarda lo
   * que escribió el vendedor desde Meta. Lo que no puede pasar es que se
   * duplique, y de eso se encarga el `id` de abajo.
   */
  const esEco = mensaje.is_echo === true || emisorId === destinoId;
  const clienteId = esEco ? receptorId : emisorId;

  // Nunca somos nuestro propio cliente. Pasa en algunos ecos mal formados.
  if (!clienteId || clienteId === destinoId) return null;

  /*
   * EL ID QUE HACE IDEMPOTENTE TODO ESTO.
   *
   * Es el `mid` de Meta, y va tal cual al campo UNIQUE de `messages`. Cuando el
   * vendedor responde desde la bandeja, Meta devuelve el eco de ESE MISMO
   * mensaje con el MISMO `mid`: la segunda inserción no hace nada y el hilo no
   * sale duplicado. Sin `mid` no se guarda el mensaje —prefiero perder uno que
   * duplicar el hilo entero—.
   */
  const id = texto(mensaje.mid);
  if (!id) return null;

  /*
   * EL REFERRAL DEL ANUNCIO: llega en el primer evento del hilo y solo ahí.
   *
   * `referral` cuelga del evento —hermano de `message`, no dentro de él—, y en
   * un botón del anuncio viene colgado del `postback`. Los tres sitios se
   * miran porque los tres ocurren.
   */
  const referral = objeto(e.referral ?? objeto(e.postback).referral ?? mensaje.referral);
  const adId = texto(referral.ad_id) || null;
  const deAnuncio = !!adId || texto(referral.source).toLowerCase() === "ads";

  /*
   * LO QUE EL CLIENTE VIO VIVE UN NIVEL MÁS ABAJO, en `ads_context_data`.
   *
   * Esto estaba mal y se notaba donde más caro sale. El título se leía de
   * `referral.ad_title`, que Meta no manda nunca —lo manda en
   * `ads_context_data.ad_title`—, así que el producto anunciado llegaba SIEMPRE
   * vacío. Y en el hueco de la descripción se metía `ads_context_data.post_id`,
   * que es un identificador: el prompt acababa diciéndole al modelo «Lo que
   * promete el anuncio: 120214…».
   *
   * Con las dos cosas rotas, el agente sabía que el cliente venía de un anuncio
   * y no sabía de cuál, así que abría preguntando qué artículo había visto a
   * alguien que acababa de pinchar la foto de ese artículo. Es exactamente la
   * pregunta que hace que no conteste.
   *
   * Meta NO manda el cuerpo del anuncio por aquí: manda el título y la
   * creatividad. Por eso `descripcionAnuncio` se queda en null y no se rellena
   * con lo primero que haya a mano — lo que dice el anuncio se saca de su
   * imagen, que es donde de verdad está escrito el precio. Ver `photo_url`.
   */
  const contextoAnuncio = objeto(referral.ads_context_data);

  const adjuntos = Array.isArray(mensaje.attachments) ? mensaje.attachments : [];
  const primero = objeto(adjuntos[0]);
  const tipoAdjunto = texto(primero.type);
  const url = texto(objeto(primero.payload).url) || null;

  const contenido = texto(mensaje.text);

  // Un mensaje sin texto ni adjunto no aporta nada al hilo ni al modelo.
  if (!contenido && !url) return null;

  return {
    id,
    deMi: esEco,
    // `ingesta` normaliza esto como si fuera un teléfono. Un PSID es numérico,
    // así que sale intacto y sirve igual de identificador dentro del canal.
    chatId: clienteId,
    tipo:
      tipoAdjunto === "image"
        ? "imagen"
        : tipoAdjunto === "audio"
          ? "audio"
          : tipoAdjunto === "file"
            ? "documento"
            : contenido
              ? "texto"
              : "otro",
    content: contenido || `(${tipoAdjunto || "adjunto"})`,
    mediaUrl: url,
    cuando: aSegundos(e.timestamp),
    // Meta no manda el nombre en el webhook: hay que pedirlo al perfil aparte.
    // Se deja nulo y `getOrCreateConversation` lo rellenará cuando llegue.
    nombre: null,
    deAnuncio,
    productoAnuncio: texto(contextoAnuncio.ad_title) || null,
    // Meta no manda el cuerpo del anuncio en el referral. Antes aquí iba su
    // `post_id`, que no es una descripción sino un número.
    descripcionAnuncio: null,
    /*
     * LA CREATIVIDAD, que es donde está el precio en media publicidad de
     * Facebook: escrito ENCIMA de la foto y no en el texto. Va como enlace y no
     * como bytes —este archivo no llama a nadie—; lo descarga `ingesta.ts` una
     * sola vez por anuncio y lo describe el modelo de visión, igual que ya se
     * hacía con la miniatura que manda WhatsApp.
     *
     * En un anuncio de vídeo, `video_url` trae la miniatura. Va de segundo por
     * si algún día trajera el vídeo entero: `descargarImagen` solo acepta
     * imágenes y ahí se pararía.
     */
    imagenAnuncioUrl: texto(contextoAnuncio.photo_url) || texto(contextoAnuncio.video_url) || null,
    superficie: esInstagram ? "instagram" : "messenger",
    metaAdId: adId,
    comentarioId: null,
  };
}

/**
 * Un comentario en una publicación o en un anuncio.
 *
 * Se trata como una conversación más, no como algo aparte: quien comenta
 * «¿cuánto cuesta?» debajo de un anuncio es exactamente el mismo lead que
 * escribe por Messenger, y separarlo en otra pantalla es perderlo.
 */
function normalizarComentario(
  valor: unknown,
  destinoId: string,
  esInstagram: boolean,
): MensajeMeta | null {
  const v = objeto(valor);
  if (texto(v.item) !== "comment") return null;

  // `add` es un comentario nuevo. Editados y borrados no abren conversación.
  if (texto(v.verb) && texto(v.verb) !== "add") return null;

  const de = objeto(v.from);
  const autorId = texto(de.id);
  const comentarioId = texto(v.comment_id);
  const contenido = texto(v.message);

  if (!autorId || !comentarioId || !contenido) return null;

  // Nuestras propias respuestas a un comentario vuelven por el webhook.
  const esNuestro = autorId === destinoId;

  return {
    id: comentarioId,
    deMi: esNuestro,
    chatId: autorId,
    tipo: "texto",
    content: contenido,
    mediaUrl: null,
    cuando: aSegundos(v.created_time ? Number(v.created_time) * 1000 : Date.now()),
    nombre: texto(de.name) || null,
    // Un comentario bajo un anuncio ES un lead de anuncio: el `post_id` lo
    // ata a la publicación, y de ahí sale el anuncio si está vinculado.
    deAnuncio: !!texto(v.post_id),
    productoAnuncio: null,
    descripcionAnuncio: null,
    // Un comentario no trae creatividad: solo el post bajo el que se escribió.
    imagenAnuncioUrl: null,
    superficie: "comentario",
    metaAdId: texto(v.ad_id) || null,
    comentarioId,
  };
}

/** Un evento de Meta puede traer varias páginas. Saca a cuál va dirigido. */
export function destinosDelEvento(cuerpo: unknown): string[] {
  const evento = objeto(cuerpo) as EventoMeta;
  const ids = new Set<string>();

  for (const entrada of evento.entry ?? []) {
    if (entrada.id) ids.add(String(entrada.id));

    // En los DM, el destinatario es la página; en los ecos, el emisor.
    for (const bruto of entrada.messaging ?? []) {
      const e = objeto(bruto);
      const eco = objeto(e.message).is_echo === true;
      const propio = texto(objeto(eco ? e.sender : e.recipient).id);
      if (propio) ids.add(propio);
    }
  }

  return [...ids];
}
