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
import { actualizarCanal, ahora, anclasDeHistorial, canalesParaReconectar, marcarEntregado, obtenerCanalSinOrg, ponerPaisPorTelefono, rutaDatos, unificarConversacion, type Canal, type TipoMensaje } from "@/lib/db";
import { ingerir, type MensajeEntrante } from "@/lib/ingesta";
import { esDescargable, guardar } from "@/lib/media";
import { esAnuncioDeMeta } from "./anuncio";
import { direccionDelChat, esLid, jidDeDestino, normalizarTelefono } from "@/lib/telefono";
import { textoConEnlace } from "@/lib/enlace";
import { esClaveDeSistema } from "@/lib/sistema";
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
  /**
   * `<lid>@lid` → `<teléfono>@s.whatsapp.net`, según lo que vaya diciendo
   * WhatsApp. Ver `recordarTelefonos`: es lo que impide que el mismo cliente
   * acabe con dos hilos, uno por cada forma de nombrarlo.
   */
  telefonos: Map<string, string>;
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
      telefonos: new Map(),
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
    /*
     * Un mensaje con enlace llega por aquí, y trae la ficha de la página
     * pegada: título, descripción y la dirección real. El cliente comparte el
     * artículo del catálogo o de Instagram en vez de escribir su nombre —es la
     * forma más común de decir «quiero este»— y sin la ficha el agente recibía
     * una URL pelada y contestaba «¿de qué producto me hablas?».
     */
    const e = real.extendedTextMessage;
    tipo = "texto";
    /*
     * UN CLIC EN UN ANUNCIO NO ES UN ENLACE COMPARTIDO. El mensaje que abre
     * un chat desde un anuncio trae `externalAdReply` y, pegada, la ficha del
     * anuncio como si fuera la de una página. Esa ficha ya se guarda en la
     * conversación —es lo que el panel enseña arriba, en «Llegó por un
     * anuncio»— y el agente la recibe por ahí. Pegarla también dentro del
     * mensaje la enseñaba dos veces y hacía que un «Hola» pareciera un
     * párrafo. Aquí el mensaje se queda con lo que el cliente escribió.
     */
    const esClicEnAnuncio = esAnuncioDeMeta(e.contextInfo, m.key?.fromMe === true);
    // `matchedText` es la dirección de verdad; `text` es lo que escribió el
    // cliente, que puede llevar el enlace en medio de una frase.
    texto = esClicEnAnuncio
      ? (e.text ?? "")
      : textoConEnlace(e.text ?? "", {
          titulo: e.title,
          descripcion: e.description,
          url: e.matchedText,
        });
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
    // Un aviso interno de WhatsApp no es un mensaje del cliente: no entra.
    if (esClaveDeSistema(clave)) return null;
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
  const contexto = (
    real.extendedTextMessage ??
    real.imageMessage ??
    real.videoMessage ??
    real.audioMessage ??
    real.documentMessage
  )?.contextInfo;
  const anuncio = esAnuncioDeMeta(contexto, m.key?.fromMe === true)
    ? contexto?.externalAdReply
    : null;

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
    /*
     * Y EL ENLACE A ESA MISMA CREATIVIDAD, ENTERA.
     *
     * La miniatura de arriba viaja DENTRO del mensaje, y por eso pesa lo que
     * pesa: unos kilobytes, un par de cientos de píxeles de ancho. Para leerle
     * el precio escrito encima sobra. Pero es TAMBIÉN la que se le reenviaba al
     * cliente que pregunta «¿me manda la foto?», y esa llegaba pixelada en
     * cuanto la abría: la foto del producto que quiere comprar, borrosa.
     *
     * WhatsApp manda además la dirección de la creatividad en el CDN de Meta.
     * Se descarga en `ingesta.ts` —el traductor no llama a nadie— y sustituye a
     * la miniatura. Es el mismo arreglo que ya se hizo del lado de Messenger
     * con la foto de la publicación, que allí llegaba con el mismo problema.
     *
     * Los tres campos por orden de calidad, y el primero que venga: no todos
     * los formatos de anuncio mandan los tres.
     */
    imagenAnuncioUrlGrande:
      anuncio?.originalImageUrl || anuncio?.thumbnailUrl || anuncio?.mediaUrl || null,
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
/**
 * EL MISMO CLIENTE NO PUEDE TENER DOS HILOS.
 *
 * WhatsApp nombra a una persona de dos formas —su teléfono y un `@lid` interno—
 * y no siempre manda las dos en el mismo mensaje. En el historial casi nunca
 * viene el teléfono: el chat llega identificado por el `@lid` a secas. Guardar
 * eso tal cual abre un hilo bajo unos dígitos que no son de nadie, y cuando el
 * mismo cliente escribe en vivo —esta vez con su número— aparece un SEGUNDO
 * hilo con la otra mitad de la conversación.
 *
 * WhatsApp manda la correspondencia aparte, en `lidPnMappings`. Aquí se guarda
 * para traducir lo que venga después, y se junta de una vez lo que ya estuviera
 * partido en dos. Ver `unificarConversacion`.
 */
function recordarTelefonos(
  s: Sesion,
  canal: Canal,
  pares: { lid?: string | null; pn?: string | null }[],
): void {
  for (const par of pares) {
    if (!par?.lid || !par?.pn || !esLid(par.lid) || esLid(par.pn)) continue;
    if (s.telefonos.get(par.lid) === par.pn) continue;

    s.telefonos.set(par.lid, par.pn);

    try {
      const unido = unificarConversacion(
        canal.org_id,
        canal.id,
        normalizarTelefono(par.lid),
        normalizarTelefono(par.pn),
      );
      if (unido !== null) {
        console.log(`[wa] el hilo ${unido} del canal ${canal.id} recupera su número de teléfono`);
      }
    } catch (e) {
      // Juntar dos hilos es una mejora, no un requisito: si falla, cada uno
      // sigue por su lado y no se pierde ni un mensaje.
      console.error("[wa] no se pudieron juntar dos hilos del mismo cliente", e);
    }
  }
}

/** El mensaje, con el teléfono del cliente en vez de su identificador interno. */
function conTelefonoConocido(m: MensajeEntrante, mapa: Map<string, string>): MensajeEntrante {
  if (!esLid(m.chatId)) return m;
  const pn = mapa.get(m.chatId);
  return pn ? { ...m, chatId: pn } : m;
}

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
    /*
     * EL HISTORIAL, ENTERO.
     *
     * Sin esto el panel empieza a existir en el instante en que alguien escanea
     * el QR: las conversaciones que ya estaban en el teléfono —con sus ventas
     * cerradas dentro— no entran nunca, y el dueño ve hilos que empiezan a
     * media frase y ventas hechas que el dashboard no cuenta.
     *
     * WhatsApp lo manda por `messaging-history.set`, en trozos y de forma
     * asíncrona. Por defecto Baileys descarta el trozo grande —el `FULL`— y se
     * queda con lo reciente; aquí se acepta todo, que es lo que el negocio pide
     * cuando conecta su número: sus conversaciones completas.
     */
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
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

        /*
         * EL NOMBRE CON EL QUE SE PRESENTA ESTE NÚMERO.
         *
         * Es el del perfil de WhatsApp: lo que el cliente ve arriba del chat
         * antes de escribir. El agente saludaba con el nombre de la CUENTA del
         * panel —un dato interno, escrito por quien abrió la cuenta— y el
         * cliente recibía «bienvenido a» un nombre que no era el de la tienda.
         * El bueno es este, y no hay que teclearlo: WhatsApp lo manda al
         * conectar. `verifiedName` es el de las cuentas de empresa verificadas.
         */
        const usuario = sock.user as { name?: string; verifiedName?: string; notify?: string } | undefined;
        const negocio = (usuario?.verifiedName ?? usuario?.name ?? usuario?.notify ?? "").trim();

        try {
          actualizarCanal(canal.org_id, canalId, {
            estado: "conectado",
            ...(s.phone ? { phone: s.phone } : {}),
            ...(negocio ? { negocio } : {}),
          });

          if (negocio) console.log(`[wa] el canal ${canalId} se presenta como «${negocio}»`);

          /*
           * ESTE es el instante en que se sabe de qué país es el número.
           *
           * Un canal nace como «pendiente:…» y no tiene teléfono hasta que
           * alguien escanea el QR; hasta aquí no había prefijo del que deducir
           * nada. Ponerlo ahora es lo que hace que un número recién vinculado
           * ya hable en su moneda sin que nadie toque un ajuste.
           *
           * No pisa un país elegido a mano: eso lo garantiza la propia función.
           */
          if (s.phone) {
            const puesto = ponerPaisPorTelefono(canal.org_id, canalId);
            if (puesto) {
              console.log(`[wa] el canal ${canalId} (+${s.phone}) vende en «${puesto}», por su prefijo`);
            }
          }
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

  /*
   * ── EL HISTORIAL DEL TELÉFONO ───────────────────────────────────────────
   *
   * Al vincular un número, WhatsApp manda lo que ya había en el móvil: los
   * chats y sus mensajes, en trozos y de más nuevo a más viejo. Este evento no
   * se escuchaba, así que todo eso se tiraba: el panel nacía vacío, las
   * conversaciones empezaban por la mitad —solo lo que llegó desde que se
   * escaneó el QR— y las ventas que ya estaban cerradas en esos hilos no las
   * contaba nadie, porque su resumen nunca entró en la base.
   *
   * Se ingiere como `historico`, que es lo que garantiza lo único que no puede
   * pasar: que el agente se ponga a contestar mensajes de hace tres semanas.
   * Ver `ingerir`.
   *
   * De estos mensajes NO se descargan los archivos. Son cientos, WhatsApp los
   * sirve cifrados y por tiempo limitado —los viejos ya no están— y bajarlos
   * dejaría el número medio ocupado durante la sincronización. El texto, que es
   * de lo que se sacan las ventas, entra completo.
   */
  sock.ev.on("messaging-history.set", ({ messages, contacts, lidPnMappings }) => {
    void (async () => {
      const actual = obtenerCanalSinOrg(canalId);
      if (!actual || actual.activo !== 1) return;

      // Primero la correspondencia entre identificadores y teléfonos: lo que
      // venga detrás ya se guarda con el número bueno.
      recordarTelefonos(s, actual, lidPnMappings ?? []);
      recordarTelefonos(
        s,
        actual,
        (contacts ?? []).map((c) => ({ lid: c.lid, pn: c.phoneNumber })),
      );

      /*
       * El nombre del cliente tampoco viaja en estos mensajes —`pushName` es de
       * los que llegan en vivo— pero sí en la lista de contactos del mismo
       * lote. Sin esto la bandeja se llenaría de hilos «Sin nombre».
       */
      const nombres = new Map<string, string>();
      for (const c of contacts ?? []) {
        const nombre = c.name ?? c.notify ?? null;
        if (!nombre) continue;
        for (const id of [c.id, c.lid, c.phoneNumber]) {
          const clave = id ? normalizarTelefono(id) : "";
          if (clave) nombres.set(clave, nombre);
        }
      }

      const traducidos = (messages ?? [])
        .map(traducir)
        .filter((m): m is MensajeEntrante => m !== null)
        .map((m) => conTelefonoConocido(m, s.telefonos))
        .map((m) =>
          m.deMi || m.nombre ? m : { ...m, nombre: nombres.get(normalizarTelefono(m.chatId)) ?? null },
        );

      if (traducidos.length === 0) return;

      try {
        await ingerir(actual, traducidos, { dentroDePeticion: false, historico: true });
      } catch (e) {
        console.error("[wa] fallo al ingerir el historial", e);
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
       * Un mensaje en vivo suele traer las dos direcciones del cliente. Es la
       * ocasión de aprender la correspondencia —y de juntar el hilo que el
       * historial hubiera abierto bajo el `@lid`— antes de guardar nada.
       */
      recordarTelefonos(
        s,
        actual,
        messages.map((x) => ({ lid: x.key?.remoteJid, pn: x.key?.remoteJidAlt })),
      );

      for (const [i, m] of traducidos.entries()) traducidos[i] = conTelefonoConocido(m, s.telefonos);

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

  /*
   * EL ACK DE ENTREGA, PARA LAS DIFUSIONES. Es lo único que permite contar
   * «entregados» en modo QR: sin esto solo se sabe que salió, no que llegó.
   * `status >= 3` es DELIVERY_ACK o más (leído incluido) en Baileys. No toca
   * nada de la venta normal: `marcarEntregado` solo encuentra fila cuando el
   * id es el de un envío de difusión, y no hace nada en cualquier otro caso.
   */
  sock.ev.on("messages.update", (actualizaciones) => {
    const actual = obtenerCanalSinOrg(canalId);
    if (!actual) return;

    for (const u of actualizaciones) {
      const id = u.key?.id;
      const status = u.update?.status as number | undefined;
      if (!id || status === undefined || status < 3) continue;
      try {
        marcarEntregado(actual.org_id, id);
      } catch (e) {
        console.error(`[wa] no se pudo marcar la entrega de ${id}`, e);
      }
    }
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
 * PEDIRLE AL TELÉFONO LO QUE PASÓ ANTES.
 *
 * El historial completo solo llega una vez, al vincular el número. Un número
 * que ya estaba conectado cuando esto se arregló tiene sus conversaciones
 * empezadas por la mitad —y, dentro de esa mitad que falta, ventas cerradas que
 * el dashboard nunca contó—, y volver a escanear el QR para recuperarlas
 * significaría desvincular el WhatsApp del negocio.
 *
 * Esto lo evita: por cada hilo se le pide al teléfono lo que había ANTES del
 * mensaje más viejo que tenemos. La respuesta no llega aquí, sino por
 * `messaging-history.set`, como el resto del historial, y entra por el mismo
 * camino ya probado.
 *
 * Se piden de uno en uno y con una pausa corta. Es el teléfono del dueño quien
 * contesta —no un servidor de WhatsApp— y trescientas peticiones de golpe es
 * exactamente la forma de que deje de contestarlas todas.
 *
 * Devuelve cuántos hilos se pidieron. Que un hilo falle no detiene a los demás:
 * lo que llegue, entra.
 */
export async function pedirHistorial(
  orgId: number,
  canalId: number,
  porHilo = 50,
): Promise<{ pedidos: number; hilos: number }> {
  const s = sesiones.get(canalId);
  if (!s?.sock || s.estado !== "conectado") {
    throw new Error("El número no está conectado a WhatsApp");
  }

  const anclas = anclasDeHistorial(orgId, canalId);
  let pedidos = 0;

  for (const a of anclas) {
    try {
      await s.sock.fetchMessageHistory(
        porHilo,
        { id: a.mensaje, remoteJid: jidDeDestino(a.jid), fromMe: a.deMi },
        a.cuando,
      );
      pedidos++;
    } catch (e) {
      console.error(`[wa] el teléfono no dio el historial de ${a.jid}`, e);
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`[wa] historial pedido para ${pedidos} de ${anclas.length} hilo(s) del canal ${canalId}`);
  return { pedidos, hilos: anclas.length };
}

/**
 * «Escribiendo…» en el chat del cliente.
 *
 * Acompaña al retardo con el que contesta el agente: sin esto, esperar cuatro
 * segundos es indistinguible de no contestar, y con esto es exactamente lo que
 * el cliente ve cuando le escribe una persona. No es un mensaje —no crea nada
 * en el hilo, no se guarda, no se cuenta— así que la regla de «solo el agente
 * envía» sigue intacta.
 *
 * Es un adorno y se comporta como tal: si el socket no está o WhatsApp lo
 * rechaza, se traga el fallo. Que no salga el aviso no puede impedir que salga
 * la respuesta.
 */
export async function marcarEscribiendo(
  canalId: number,
  destino: string,
  escribiendo: boolean,
): Promise<void> {
  const s = sesiones.get(canalId);
  if (!s?.sock || s.estado !== "conectado") return;

  try {
    await s.sock.sendPresenceUpdate(escribiendo ? "composing" : "paused", jidDeDestino(destino));
  } catch {
    // Un adorno no rompe una venta.
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
 * Una imagen, para cuando el cliente pide ver el producto.
 *
 * Gemela de `enviarTexto` y con la misma regla: solo `agent.ts` la importa, y
 * hay una prueba que barre `src/` y falla si otro archivo la nombra.
 *
 * Aquí van BYTES y no un enlace, al revés que en Meta. Por el socket de
 * WhatsApp no viajan URLs: el archivo se sube cifrado en el momento, así que
 * quien llama tiene que traer la imagen leída. Es la misma que se le guardó al
 * anuncio cuando entró el lead.
 */
export async function enviarImagen(
  canalId: number,
  destino: string,
  datos: Buffer,
  pie?: string,
): Promise<string> {
  const s = sesiones.get(canalId);
  if (!s?.sock || s.estado !== "conectado") {
    throw new Error("El número no está conectado a WhatsApp");
  }

  const enviado = await s.sock.sendMessage(jidDeDestino(destino), {
    image: datos,
    ...(pie ? { caption: pie } : {}),
  });

  const id = enviado?.key?.id;
  if (!id) throw new Error("WhatsApp no devolvió el identificador de la imagen enviada");
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
