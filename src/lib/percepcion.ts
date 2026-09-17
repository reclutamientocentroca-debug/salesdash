/**
 * SalesDash — lo que el agente ve y oye.
 *
 * POR QUÉ ESTO SALIÓ DEL ANALISTA
 *
 * Describir imágenes y transcribir notas de voz vivía dentro de `analyzer.ts`,
 * y el analista corre DESPUÉS: cuando la venta ya está cerrada o cuando alguien
 * pulsa «Analizar». Servía para leer el hilo más tarde, pero el agente, que es
 * quien tiene al cliente esperando, no veía nada: una foto le llegaba como
 * «[imagen]» y una nota de voz como «[nota de voz]».
 *
 * Y por ahí se pierde media venta. El cliente manda la foto del artículo que
 * quiere en vez de escribir su nombre; manda la captura del comprobante de la
 * transferencia; dice en veinte segundos de audio la talla, el color y la
 * dirección. El agente contestaba «¿me dices qué artículo te interesa?» a
 * alguien que acababa de mandarle la foto.
 *
 * Así que vive aquí, en su propio módulo, y lo usan los dos: el analista al
 * cerrar y el agente antes de contestar. Se guarda en el mensaje, así que el
 * trabajo se hace UNA vez —el que llegue segundo se lo encuentra hecho— y el
 * dinero del modelo no se gasta dos veces.
 *
 * ESTE MÓDULO NO ENVÍA NADA. Mira archivos y escribe en la base; el único que
 * puede escribirle a un cliente sigue siendo `agent.ts`.
 */
import {
  MODELO_AUDIO,
  MODELO_VISION,
  guardarDescripcionImagen,
  guardarTranscripcion,
  type CategoriaImagen,
  type Mensaje,
} from "./db";
import { completar, completarJson, ErrorIA, type Mensaje as MensajeIA } from "./ia";
import { comoDataUrl } from "./media";
import { mensajesDeLaSesion } from "./memoria";

export const CATEGORIAS: CategoriaImagen[] = [
  "factura",
  "comprobante_pago",
  "foto_producto",
  "otro",
];

interface DescripcionImagen {
  categoria?: string;
  descripcion?: string;
  monto_detectado?: number | null;
  productos_detectados?: string[];
}

/*
 * LA DUEÑA (2026-09-17): un cliente mandó la foto de un anuncio propio —«Zapatos
 * De Caballero, DCM Estilo», RD$2,500 escrito encima de la foto— y el agente
 * contestó con otro precio, RD$1,990, sacado de quién sabe dónde. La foto SÍ
 * traía el precio: lo que faltó fue leerlo. «una línea de qué se ve» describía
 * el artículo y los colores, nunca el precio ni las tallas escritas encima —eso
 * es justo lo que trae media publicidad de esta tienda, y es la misma cifra que
 * el cliente ya vio antes de mandar la foto. Ver `promptAnuncio`, hermano de
 * este prompt para la creatividad del propio anuncio.
 */
const PROMPT_VISION = `Eres un analista de ventas. Mira la imagen y clasifícala.

Responde SOLO con este JSON, sin texto adicional y sin backticks:
{"categoria":"factura|comprobante_pago|foto_producto|otro","descripcion":"dos o tres frases de qué se ve","monto_detectado":null,"productos_detectados":[]}

Criterios:
- factura: una factura, recibo o nota de pedido emitida por el negocio
- comprobante_pago: captura de una transferencia, depósito o pago del cliente
- foto_producto: una foto del artículo, para que el cliente lo vea
- otro: cualquier otra cosa

Si es "foto_producto", en la descripción incluye SIEMPRE, cuando se vea:
- CUALQUIER precio, cifra u oferta escrita en la imagen, copiada tal cual (muchas veces va encima de la foto, no solo en el pie).
- Los colores que aparecen.
- Las tallas o medidas que se lean, copiadas tal cual.
No inventes ningún dato que no esté escrito o visible en la imagen.`;

const PROMPT_AUDIO = `Transcribe literalmente este audio de una conversación de venta por WhatsApp.

Reglas:
- Devuelve SOLO lo que se dice, sin comentarlo ni resumirlo.
- Respeta el idioma original. No traduzcas.
- Si no se entiende nada o está en silencio, devuelve exactamente: [audio ininteligible]
- No añadas comillas ni marcas de tiempo.`;

/** Lo que se guarda cuando no se pudo mirar la imagen. */
export const SIN_DESCRIBIR = "[imagen sin describir]";

/**
 * Describe una imagen y guarda el resultado. Se genera UNA vez y se guarda: no
 * se vuelve a pedir nunca.
 *
 * El archivo está en el volumen y NO es alcanzable desde internet, así que al
 * modelo se le manda incrustado en la propia petición como data URL. Pasarle
 * una URL de este servidor no serviría: tendría que atravesar la sesión.
 */
export async function describirImagen(
  orgId: number,
  modeloVision: string,
  m: Mensaje,
): Promise<CategoriaImagen | null> {
  const imagen = m.media_url ? comoDataUrl(orgId, m.media_url) : null;

  if (!imagen) {
    guardarDescripcionImagen(orgId, m.id, { descripcion: SIN_DESCRIBIR, categoria: null });
    return null;
  }

  try {
    const { datos } = await completarJson<DescripcionImagen>({
      orgId,
      proposito: "vision",
      modelo: modeloVision,
      mensajes: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT_VISION },
            { type: "image_url", image_url: { url: imagen } },
          ],
        },
      ] as MensajeIA[],
      maxTokens: 300,
      temperatura: 0,
    });

    const categoria = CATEGORIAS.includes(datos?.categoria as CategoriaImagen)
      ? (datos!.categoria as CategoriaImagen)
      : null;

    guardarDescripcionImagen(orgId, m.id, {
      descripcion: datos?.descripcion?.trim() || SIN_DESCRIBIR,
      categoria,
    });

    return categoria;
  } catch (e) {
    // Modelo caído o sin cuota: la imagen queda sin describir y el hilo va a
    // revisión. Nunca se asume que era una factura.
    console.error("Visión no disponible:", e instanceof ErrorIA ? e.message : e);
    guardarDescripcionImagen(orgId, m.id, { descripcion: SIN_DESCRIBIR, categoria: null });
    return null;
  }
}

/**
 * Pasa una nota de voz a texto y la guarda. Se hace UNA vez por mensaje.
 *
 * Sin esto un audio es un agujero en la conversación: se ve `[nota de voz]` y
 * no se puede decidir nada, y media venta puede cerrarse hablando.
 *
 * Un fallo no rompe nada: el mensaje se queda sin transcribir, que es
 * exactamente como estaba antes.
 */
export async function transcribirAudio(
  orgId: number,
  modeloAudio: string,
  m: Mensaje,
): Promise<void> {
  if (m.transcripcion) return;

  const audio = m.media_url ? comoDataUrl(orgId, m.media_url) : null;
  if (!audio) return;

  // La data URL trae delante `data:audio/ogg;base64,` y el modelo espera solo
  // el contenido y el formato por separado.
  const base64 = audio.slice(audio.indexOf(",") + 1);
  const formato = (m.media_url ?? "").split(".").pop()?.toLowerCase() || "ogg";

  try {
    const { texto } = await completar({
      orgId,
      proposito: "audio",
      modelo: modeloAudio,
      mensajes: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT_AUDIO },
            { type: "input_audio", input_audio: { data: base64, format: formato } },
          ],
        },
      ] as MensajeIA[],
      maxTokens: 700,
      temperatura: 0,
    });

    const limpio = texto.trim();
    if (limpio) guardarTranscripcion(orgId, m.id, limpio);
  } catch (e) {
    // Modelo sin soporte de audio, sin cuota o caído. Se registra y se sigue.
    console.error("Transcripción no disponible:", e instanceof ErrorIA ? e.message : e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Percibir antes de contestar
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántos mensajes recientes se miran. Ver la nota de `percibir`. */
const VENTANA = 4;

export interface Percepcion {
  /** Solo se mira lo que llegó sin describir; ver el interruptor del canal. */
  ver: boolean;
  oir: boolean;
  modeloVision: string;
  modeloAudio: string;
  /**
   * Cuánto se espera como MUCHO por mirar y escuchar, en total.
   *
   * Hay un cliente delante mirando la pantalla. Es mejor contestarle sin haber
   * visto la foto que hacerle esperar un minuto a que un modelo de visión caído
   * agote su tiempo: lo primero es una respuesta peor, lo segundo es un cliente
   * que se fue.
   */
  timeoutMs?: number;
}

/** Cuánto se espera por defecto. Ver `timeoutMs`. */
const PRESUPUESTO_MS = 15_000;

/** Tope de archivos por respuesta, aunque quepan más en la ventana. */
const MAX_ARCHIVOS = 2;

/**
 * MIRA Y ESCUCHA LO ÚLTIMO QUE MANDÓ EL CLIENTE, ANTES DE CONTESTARLE.
 *
 * Devuelve el historial con las descripciones y las transcripciones ya puestas,
 * listo para armar el prompt.
 *
 * Solo los ÚLTIMOS mensajes, y solo los del cliente, y solo los que no estén ya
 * descritos. Las tres condiciones son de coste, y ninguna sobra: sin la primera,
 * cada respuesta de una conversación larga volvería a mirar veinte fotos; sin la
 * segunda, se describirían las fotos que mandamos nosotros; sin la tercera, se
 * pagaría dos veces por lo mismo. El cliente está esperando, además, y cada
 * llamada de más es un segundo más de silencio en su pantalla.
 *
 * Que un archivo no se pueda mirar NO detiene la respuesta: el agente contesta
 * con lo que tenga. Callarse porque el modelo de visión está caído sería peor
 * que contestar sin haber visto la foto.
 */
export async function percibir(
  orgId: number,
  mensajes: Mensaje[],
  p: Percepcion,
): Promise<Mensaje[]> {
  const recientes = mensajes.slice(-VENTANA).filter((m) => m.emisor === "cliente" && m.media_url);

  const imagenes = p.ver
    ? recientes.filter((m) => m.tipo === "imagen" && !m.descripcion_imagen)
    : [];
  const audios = p.oir ? recientes.filter((m) => m.tipo === "audio" && !m.transcripcion) : [];

  if (imagenes.length === 0 && audios.length === 0) return mensajes;

  /*
   * En paralelo: son llamadas a modelos distintos y el cliente está mirando la
   * pantalla. Una foto y un audio seguidos costarían el doble de espera.
   */
  /*
   * CON RELOJ. El trabajo sigue en segundo plano si se pasa del presupuesto
   * —lo que describa quedará guardado para la próxima respuesta— pero la
   * respuesta de AHORA no lo espera. Un cliente delante de la pantalla no
   * aguanta el minuto que tarda en rendirse un modelo caído, y contestar sin
   * haber visto la foto es infinitamente mejor que no contestar.
   */
  const trabajo = Promise.all([
    ...imagenes.slice(0, MAX_ARCHIVOS).map((m) => describirImagen(orgId, p.modeloVision, m)),
    ...audios.slice(0, MAX_ARCHIVOS).map((m) => transcribirAudio(orgId, p.modeloAudio, m)),
  ]);

  let reloj: NodeJS.Timeout | undefined;
  const presupuesto = new Promise<"tarde">((resolve) => {
    reloj = setTimeout(() => resolve("tarde"), p.timeoutMs ?? PRESUPUESTO_MS);
  });

  try {
    if ((await Promise.race([trabajo.then(() => "hecho" as const), presupuesto])) === "tarde") {
      console.warn(
        `[percepcion] se acabó el tiempo mirando lo que mandó el cliente; se contesta sin ello`,
      );
    }
  } finally {
    clearTimeout(reloj);
    // Que nadie se caiga por una promesa rechazada a la que ya nadie mira.
    void trabajo.catch(() => {});
  }

  /*
   * Lo que acaba de escribirse se relee de la base y no se reconstruye aquí:
   * `describirImagen` y `transcribirAudio` son las que saben qué guardaron —y
   * lo que guardan cuando fallan—, y duplicar esa decisión en este archivo es
   * la clase de copia que se queda vieja sin que nadie se entere.
   */
  const { listarMensajes } = await import("./db");
  const frescos = new Map(listarMensajes(orgId, mensajes[0]!.conversation_id).map((m) => [m.id, m]));

  return mensajes.map((m) => frescos.get(m.id) ?? m);
}

/**
 * El mensaje del cliente tal y como tiene que leerlo el modelo.
 *
 * Una imagen y un audio son texto, o no son nada: en el historial que se le
 * manda al modelo solo caben palabras. Lo que se vio y lo que se oyó se pegan
 * al contenido del mensaje, marcados, para que el agente sepa que eso no lo
 * escribió el cliente pero sí lo mandó.
 */
export function conLoVistoYOido(m: Mensaje): string {
  if (m.transcripcion) {
    // Lo que dijo hablando ES su mensaje: va primero y en su sitio.
    return `(nota de voz) ${m.transcripcion}`;
  }

  if (m.descripcion_imagen && m.descripcion_imagen !== SIN_DESCRIBIR) {
    const que =
      m.categoria_imagen === "comprobante_pago"
        ? "comprobante de pago"
        : m.categoria_imagen === "factura"
          ? "factura"
          : "imagen";

    // El pie de foto del cliente, si lo escribió, sigue estando en `content`.
    const pie = m.content.replace(/^\[imagen\]\s*/, "").trim();
    return `(${que} que manda el cliente: ${m.descripcion_imagen})${pie ? ` ${pie}` : ""}`;
  }

  return m.content;
}

/**
 * LA ÚLTIMA FOTO DE PRODUCTO QUE MANDÓ EL CLIENTE EN ESTA SESIÓN, tal como la
 * describió la visión —con su precio, si se leía uno—.
 *
 * La dueña (2026-09-17): un cliente mandó la foto de un anuncio propio —«Zapatos
 * De Caballero, DCM Estilo», con el precio escrito encima— y el agente cotizó
 * otra cifra. La foto de un producto que manda el cliente es publicidad de esta
 * misma tienda tantas veces como la creatividad del propio anuncio, así que lo
 * que trae escrito encima vale igual: ver `promptAnuncio`, en `analyzer.ts`, que
 * es la misma regla para la foto del anuncio.
 *
 * Solo la de ESTA sesión: una foto de hace tres días no es la de este pedido, y
 * pegarla dejaría vivo un precio que ya no viene al caso.
 */
export function fotoDeProductoDelClienteEnSesion(historial: Mensaje[]): string | null {
  const ultima = mensajesDeLaSesion(historial)
    .filter((m) => m.emisor === "cliente" && m.categoria_imagen === "foto_producto")
    .at(-1);
  const descripcion = ultima?.descripcion_imagen?.trim();
  return descripcion && descripcion !== SIN_DESCRIBIR ? descripcion : null;
}

/** Los modelos por defecto, para quien no tenga elegido uno propio. */
export function modelosDePercepcion(
  agente: { modelo_vision: string | null; modelo_audio: string | null },
  org: { modelo_vision?: string; modelo_audio?: string } | null,
): { modeloVision: string; modeloAudio: string } {
  return {
    modeloVision: agente.modelo_vision || org?.modelo_vision || MODELO_VISION,
    modeloAudio: agente.modelo_audio || org?.modelo_audio || MODELO_AUDIO,
  };
}
