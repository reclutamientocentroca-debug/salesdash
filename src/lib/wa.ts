/**
 * SalesDash — conexión a WhatsApp por QR.
 *
 * Sustituye a `whapi.ts`. Ya no hay intermediario ni webhook: el servidor
 * mantiene un socket abierto por cada número conectado, y los mensajes entran
 * por ahí directamente.
 *
 * QUÉ CAMBIA RESPECTO A UN PROVEEDOR
 *
 *   - La sesión vive en DISCO, en `<datos>/sesiones/<canalId>`. Si esa carpeta
 *     no sobrevive al redespliegue, hay que reescanear el QR de todos los
 *     números. Con un proveedor la sesión vivía en su servidor y esto daba
 *     igual; ahora el volumen es obligatorio, no recomendable.
 *
 *   - El contenedor tiene que estar SIEMPRE encendido. No hay nadie guardando
 *     los mensajes mientras esté apagado: lo que llegue con el socket caído se
 *     recupera cuando WhatsApp resincroniza, pero no está garantizado.
 *
 *   - Los sockets viven en la memoria del proceso. Si algún día esto corre en
 *     varias réplicas, dos procesos abrirían la misma sesión y WhatsApp cerrará
 *     una de las dos. Una réplica, o repartir canales por proceso.
 *
 * El registro va en `globalThis` por el mismo motivo que la conexión de la base
 * de datos: en desarrollo Next recarga los módulos en caliente, y sin esto cada
 * cambio de código abriría una sesión nueva encima de la anterior.
 */
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "baileys";
import { Boom } from "@hapi/boom";
import { toDataURL } from "qrcode";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { actualizarCanal, ahora, canalesParaReconectar, obtenerCanalSinOrg, rutaDatos, type Canal, type TipoMensaje } from "@/lib/db";
import { ingerir, type MensajeEntrante } from "@/lib/ingesta";
import { esDescargable, guardar } from "@/lib/media";
import { direccionDelChat, jidDeDestino } from "@/lib/telefono";
import { enlaceDeMapa, textoDeUbicacion } from "@/lib/ubicacion";

// ─────────────────────────────────────────────────────────────────────────────
// Estado
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoCanal =
  | "iniciando"
  | "esperando"
  | "conectado"
  | "desconectado"
  | "error";

export interface Instantanea {
  estado: EstadoCanal;
  phone: string | null;
  detalle: string | null;
  /** Imagen del QR como data URL. Solo cuando el estado es `esperando`. */
  qr: string | null;
}

interface Sesion {
  canalId: number;
  sock: WASocket | null;
  estado: EstadoCanal;
  qr: string | null;
  phone: string | null;
  detalle: string | null;
  /** Reintentos seguidos de reconexión. Se usa para espaciarlos. */
  intentos: number;
  /** Cierre pedido por nosotros: no hay que reconectar. */
  cerrandoAdrede: boolean;
}

const global_ = globalThis as unknown as {
  __salesdash_wa?: Map<number, Sesion>;
  __salesdash_wa_rehidratado?: boolean;
};

const sesiones: Map<number, Sesion> = (global_.__salesdash_wa ??= new Map());

/**
 * Baileys es hablador y su registro no ayuda a nadie en producción. Se le pasa
 * uno mudo salvo los errores, que sí interesan.
 *
 * El tipo se declara aquí en vez de importarlo: `ILogger` no sale por el índice
 * del paquete, y con la forma basta — TypeScript comprueba la estructura, no el
 * nombre. Así tampoco hay que arrastrar pino como dependencia directa.
 */
interface Registro {
  level: string;
  child(obj: Record<string, unknown>): Registro;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const registro: Registro = {
  level: "silent",
  child: () => registro,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (obj: unknown, msg?: string) => console.error("[wa]", msg ?? "", obj),
};

function carpetaSesion(canalId: number): string {
  return join(rutaDatos(), "sesiones", String(canalId));
}

function sesionDe(canalId: number): Sesion {
  let s = sesiones.get(canalId);
  if (!s) {
    s = {
      canalId,
      sock: null,
      estado: "iniciando",
      qr: null,
      phone: null,
      detalle: null,
      intentos: 0,
      cerrandoAdrede: false,
    };
    sesiones.set(canalId, s);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Traducción de mensajes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De un mensaje de Baileys al formato propio de `ingesta.ts`.
 *
 * `mediaUrl` sale null para los archivos y lo rellena quien llama, después de
 * descargarlos: la descarga es asíncrona y esta traducción no lo es. Solo se
 * bajan imágenes y audio; ver `media.ts` para por qué no los documentos.
 *
 * La excepción es la ubicación: ahí no hay archivo que bajar y `mediaUrl` sale
 * de aquí con el enlace al mapa ya hecho.
 */
function traducir(m: WAMessage): MensajeEntrante | null {
  const id = m.key?.id;
  /*
   * De las dos direcciones que puede traer WhatsApp, la del teléfono.
   *
   * Desde el cambio a LID, `remoteJid` de un chat uno a uno llega muchas veces
   * como `…@lid` —un identificador interno que no es un número— y el teléfono
   * viaja aparte, en `remoteJidAlt`. Quedarse con el LID sin mirar el otro es
   * lo que dejaba al panel contestando a una dirección que no existe.
   */
  const chatId = direccionDelChat(m.key?.remoteJid ?? "", m.key?.remoteJidAlt);
  if (!id || !chatId) return null;

  const contenido = m.message;
  if (!contenido) return null;

  // Los mensajes efímeros y los de "ver una vez" traen el real anidado.
  const real =
    contenido.ephemeralMessage?.message ??
    contenido.viewOnceMessage?.message ??
    contenido.viewOnceMessageV2?.message ??
    contenido;

  let tipo: TipoMensaje = "otro";
  /** El enlace al mapa cuando el mensaje es una ubicación. */
  let mapa: string | null = null;
  let texto = "";

  const conCaption = (marca: string, caption?: string | null) =>
    caption?.trim() ? `${marca} ${caption.trim()}` : marca;

  if (real.conversation) {
    tipo = "texto";
    texto = real.conversation;
  } else if (real.extendedTextMessage?.text) {
    tipo = "texto";
    texto = real.extendedTextMessage.text;
  } else if (real.imageMessage) {
    tipo = "imagen";
    texto = conCaption("[imagen]", real.imageMessage.caption);
  } else if (real.documentMessage) {
    const nombre = real.documentMessage.fileName;
    tipo = "documento";
    texto = conCaption(`[documento${nombre ? `: ${nombre}` : ""}]`, real.documentMessage.caption);
  } else if (real.audioMessage) {
    tipo = "audio";
    texto = real.audioMessage.ptt ? "[nota de voz]" : "[audio]";
  } else if (real.videoMessage) {
    tipo = "otro";
    texto = conCaption("[video]", real.videoMessage.caption);
  } else if (real.locationMessage || real.liveLocationMessage) {
    /*
     * La ubicación que manda el cliente ES la dirección de entrega. Antes caía
     * en el cajón de «otro» y se guardaba como «[locationMessage]»: quien
     * despacha el pedido se quedaba sin el dato, y el analista sin la
     * dirección que tenía delante.
     *
     * El enlace al mapa va en `mediaUrl`. No hay nada que descargar —una
     * ubicación no es un archivo— y esa columna la sirve tal cual quien no
     * empieza por «local:», así que el hilo puede pintar un enlace sin una
     * columna nueva.
     */
    // Las dos formas no traen lo mismo: la fija lleva nombre del sitio y
    // dirección; la de en vivo, solo un pie de texto opcional.
    const fija = real.locationMessage;
    const viva = real.liveLocationMessage;

    tipo = "otro";
    texto = textoDeUbicacion({
      nombre: fija?.name,
      direccion: fija?.address ?? viva?.caption,
      enVivo: !!viva,
    });
    mapa = enlaceDeMapa(
      fija?.degreesLatitude ?? viva?.degreesLatitude,
      fija?.degreesLongitude ?? viva?.degreesLongitude,
    );
  } else {
    const clave = Object.keys(real)[0];
    tipo = "otro";
    texto = `[${clave ?? "mensaje"}]`;
  }

  // `messageTimestamp` puede venir como número o como Long de protobuf.
  const marca = m.messageTimestamp;
  const cuando =
    typeof marca === "number"
      ? marca
      : typeof marca === "object" && marca !== null && "toNumber" in marca
        ? (marca as { toNumber(): number }).toNumber()
        : ahora();

  /*
   * El anuncio no viaja solo en los mensajes de texto. Un click-to-WhatsApp
   * abre el chat con un `extendedTextMessage`, sí, pero el cliente puede llegar
   * mandando la foto del anuncio o una nota de voz, y entonces el
   * `externalAdReply` viene colgado del `contextInfo` de ESE mensaje. Mirando
   * solo el de texto, ese cliente entraba como si hubiera escrito por su cuenta.
   */
  const anuncio = (
    real.extendedTextMessage ??
    real.imageMessage ??
    real.videoMessage ??
    real.audioMessage ??
    real.documentMessage
  )?.contextInfo?.externalAdReply;

  return {
    id,
    deMi: m.key?.fromMe === true,
    chatId,
    tipo,
    content: texto,
    mediaUrl: mapa,
    cuando,
    nombre: m.pushName ?? null,
    // El anuncio de Meta llega en `contextInfo.externalAdReply`: `title` es el
    // producto anunciado y `body` lo que se le prometió al cliente.
    deAnuncio: !!anuncio,
    productoAnuncio: anuncio?.title ?? null,
    descripcionAnuncio: anuncio?.body ?? null,
    /*
     * EL IDENTIFICADOR DEL ANUNCIO, que hasta ahora se tiraba.
     *
     * `sourceId` es el anuncio de Facebook o Instagram que trajo al cliente.
     * Sin él, un lead de WhatsApp llegaba sabiendo el título del anuncio pero
     * no CUÁL era, así que no se podía vincular a un producto del catálogo ni
     * sacar de ahí el precio bueno: toda esa maquinaria solo funcionaba para
     * los canales de Meta. Es el mismo dato y llega en el mismo sitio.
     */
    metaAdId: anuncio?.sourceId ?? null,
    /*
     * Y la creatividad. En estos anuncios el precio y los colores van ESCRITOS
     * ENCIMA de la imagen muchísimas veces —no en el texto—, y ahí no los ve
     * nadie: el cliente escribe «quiero la del anuncio» y el agente no sabe de
     * qué habla. WhatsApp manda esa miniatura en el mismo mensaje.
     */
    imagenAnuncio: anuncio?.thumbnail ? Buffer.from(anuncio.thumbnail) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ciclo de vida del socket
// ─────────────────────────────────────────────────────────────────────────────

function anotarEstado(s: Sesion, canal: Canal | undefined, estado: string): void {
  if (!canal) return;
  if (canal.estado === estado) return;
  try {
    actualizarCanal(canal.org_id, s.canalId, { estado });
  } catch (e) {
    console.error("[wa] no se pudo anotar el estado del canal", e);
  }
}

/**
 * Abre el socket de un canal. Si ya hay creds guardadas reconecta sin QR; si no,
 * WhatsApp emite uno y queda en `esperando`.
 */
async function abrir(canalId: number): Promise<void> {
  const s = sesionDe(canalId);
  if (s.sock) return;

  const canal = obtenerCanalSinOrg(canalId);
  if (!canal) throw new Error(`El canal ${canalId} no existe`);

  const carpeta = carpetaSesion(canalId);
  mkdirSync(carpeta, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(carpeta);

  s.cerrandoAdrede = false;
  s.estado = state.creds.registered ? "iniciando" : "esperando";
  s.detalle = null;

  const sock = makeWASocket({
    auth: state,
    logger: registro,
    // El nombre que verá el usuario en «Dispositivos vinculados» de su móvil.
    browser: Browsers.ubuntu("SalesDash"),
    // No marca los mensajes como leídos: el vendedor tiene que poder ver en su
    // móvil lo que todavía no ha atendido.
    markOnlineOnConnect: false,
  });

  s.sock = sock;

  sock.ev.on("creds.update", () => {
    void saveCreds();
  });

  sock.ev.on("connection.update", (u) => {
    void (async () => {
      if (u.qr) {
        s.estado = "esperando";
        s.detalle = null;
        try {
          s.qr = await toDataURL(u.qr, { margin: 1, width: 320 });
        } catch (e) {
          console.error("[wa] no se pudo dibujar el QR", e);
        }
        anotarEstado(s, canal, "esperando");
      }

      if (u.connection === "open") {
        s.estado = "conectado";
        s.qr = null;
        s.intentos = 0;
        s.detalle = null;
        // `id` llega como `<número>:<dispositivo>@s.whatsapp.net`.
        s.phone = (sock.user?.id ?? "").split(":")[0]?.replace(/\D/g, "") || null;

        try {
          actualizarCanal(canal.org_id, canalId, {
            estado: "conectado",
            ...(s.phone ? { phone: s.phone } : {}),
          });
        } catch (e) {
          console.error("[wa] no se pudo guardar el número conectado", e);
        }
      }

      if (u.connection === "close") {
        s.sock = null;
        const causa = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const cerroSesion = causa === DisconnectReason.loggedOut;

        if (s.cerrandoAdrede) return;

        if (cerroSesion) {
          // El usuario desvinculó el dispositivo desde su móvil. Las creds ya no
          // valen: hay que borrarlas o el QR nuevo nunca aparecería.
          s.estado = "desconectado";
          s.detalle = "La sesión se cerró desde el teléfono. Vuelve a escanear el código.";
          s.qr = null;
          olvidarCredenciales(canalId);
          anotarEstado(s, canal, "desconectado");
          return;
        }

        // Cualquier otro cierre es transitorio: se reintenta separando cada vez
        // más, hasta un minuto, para no castigar a WhatsApp ni al servidor.
        s.intentos = Math.min(s.intentos + 1, 6);
        const espera = Math.min(1000 * 2 ** s.intentos, 60_000);
        s.estado = "iniciando";
        s.detalle = `Reconectando (intento ${s.intentos})…`;
        setTimeout(() => {
          abrir(canalId).catch((e) => {
            s.estado = "error";
            s.detalle = e instanceof Error ? e.message : "No se pudo reconectar";
          });
        }, espera);
      }
    })();
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // `append` son mensajes viejos que WhatsApp reenvía al sincronizar. Se
    // ingieren igual: insertar es idempotente y así no se pierde historial.
    if (type !== "notify" && type !== "append") return;

    void (async () => {
      const traducidos = messages.map(traducir).filter((m): m is MensajeEntrante => m !== null);
      if (traducidos.length === 0) return;

      // Se relee el canal: `agente_activo` pudo cambiar desde que se abrió.
      const actual = obtenerCanalSinOrg(canalId);
      if (!actual || actual.activo !== 1) return;

      /*
       * Los archivos se bajan ANTES de guardar el mensaje. WhatsApp los sirve
       * cifrados y por tiempo limitado: si se dejara para después, la nota de
       * voz que el cliente mandó anoche ya no se podría descargar por la
       * mañana. Un fallo aquí no cancela nada — el mensaje entra igual, solo
       * que sin archivo.
       */
      await Promise.all(
        traducidos.map(async (m, i) => {
          const original = messages[i];
          if (!original || !esDescargable(m.tipo)) return;

          try {
            const datos = await downloadMediaMessage(original, "buffer", {});
            m.mediaUrl = guardar(actual.org_id, m.id, m.tipo, datos as Buffer);
          } catch (e) {
            console.error(`[wa] no se pudo descargar el archivo de ${m.id}`, e);
          }
        }),
      );

      try {
        await ingerir(actual, traducidos, { dentroDePeticion: false });
      } catch (e) {
        console.error("[wa] fallo al ingerir un lote de mensajes", e);
      }
    })();
  });
}

function olvidarCredenciales(canalId: number): void {
  try {
    rmSync(carpetaSesion(canalId), { recursive: true, force: true });
  } catch (e) {
    console.error("[wa] no se pudo borrar la sesión del disco", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/** Pone en marcha la conexión de un canal. Si ya está en marcha, no hace nada. */
export async function conectar(canalId: number): Promise<Instantanea> {
  const s = sesionDe(canalId);
  if (!s.sock) {
    try {
      await abrir(canalId);
    } catch (e) {
      s.estado = "error";
      s.detalle = e instanceof Error ? e.message : "No se pudo iniciar la conexión";
    }
  }
  return instantanea(canalId);
}

export function instantanea(canalId: number): Instantanea {
  const s = sesiones.get(canalId);
  if (!s) return { estado: "desconectado", phone: null, detalle: null, qr: null };
  return { estado: s.estado, phone: s.phone, detalle: s.detalle, qr: s.qr };
}

/**
 * Cierra la conexión. Con `olvidar` borra también las credenciales del disco,
 * que es lo que hay que hacer al eliminar un número: si no, la carpeta queda
 * huérfana y el número seguiría apareciendo vinculado en el teléfono.
 */
export async function desconectar(canalId: number, olvidar: boolean): Promise<void> {
  const s = sesiones.get(canalId);

  if (s) {
    s.cerrandoAdrede = true;
    s.qr = null;
    s.estado = "desconectado";
    try {
      if (olvidar && s.sock) await s.sock.logout();
      else s.sock?.end(undefined);
    } catch {
      // Cerrar una sesión ya rota no es un error que deba propagarse.
    }
    s.sock = null;
  }

  if (olvidar) {
    olvidarCredenciales(canalId);
    sesiones.delete(canalId);
  }
}

/**
 * Envía un texto y devuelve el id del mensaje.
 *
 * Ese id es la pieza sobre la que se sostiene la atribución: se registra en
 * `ai_sent_ids` y, cuando el mismo mensaje vuelve como saliente, se reconoce
 * como enviado por la IA en vez de por un vendedor.
 *
 * `destino` es la dirección guardada del cliente —`…@s.whatsapp.net` o `…@lid`—
 * y se usa TAL CUAL. Antes se recibían dígitos y se les pegaba
 * `@s.whatsapp.net`: con un cliente identificado por LID eso construía una
 * dirección de nadie, WhatsApp devolvía su identificador igual, el panel
 * guardaba la respuesta y el cliente no recibía nada.
 */
export async function enviarTexto(canalId: number, destino: string, texto: string): Promise<string> {
  const s = sesiones.get(canalId);
  if (!s?.sock || s.estado !== "conectado") {
    throw new Error("El número no está conectado a WhatsApp");
  }

  const enviado = await s.sock.sendMessage(jidDeDestino(destino), { text: texto });
  const id = enviado?.key?.id;
  if (!id) throw new Error("WhatsApp no devolvió el identificador del mensaje enviado");
  return id;
}

/**
 * Reabre las sesiones de todos los canales activos. Se llama una vez al
 * arrancar el servidor: sin esto, tras cada despliegue nadie recibiría mensajes
 * hasta que alguien abriera la pantalla del número.
 */
export async function rehidratar(): Promise<void> {
  if (global_.__salesdash_wa_rehidratado) return;
  global_.__salesdash_wa_rehidratado = true;

  let canales: { id: number }[] = [];
  try {
    canales = canalesParaReconectar();
  } catch (e) {
    console.error("[wa] no se pudieron listar los canales a reconectar", e);
    return;
  }

  /*
   * Solo los que ya tienen credenciales en el disco.
   *
   * Un canal creado y nunca escaneado no tiene nada que reabrir: abrirle un
   * socket generaría un QR que nadie va a mirar, y cuando venciera WhatsApp
   * cerraría la conexión y el reintento la abriría otra vez, en bucle y para
   * siempre. Ese canal recibe su socket cuando alguien abra su pantalla.
   */
  const vinculados = canales.filter((c) => existsSync(join(carpetaSesion(c.id), "creds.json")));

  if (vinculados.length === 0) return;
  console.log(`[wa] reabriendo ${vinculados.length} sesión(es) de WhatsApp`);

  for (const c of vinculados) {
    try {
      await abrir(c.id);
    } catch (e) {
      console.error(`[wa] no se pudo reabrir el canal ${c.id}`, e);
    }
  }
}
