/**
 * SalesDash — entrada de mensajes.
 *
 * Este módulo era el cuerpo del webhook de Whapi. Al conectar por QR ya no hay
 * webhook: los mensajes llegan por el socket que `wa.ts` mantiene abierto. La
 * lógica es la misma y por eso vive aquí, en un solo sitio, hablando un formato
 * propio en vez del de un proveedor.
 *
 * Las cuatro invariantes de este archivo sostienen todo el producto y ninguna
 * es decorativa:
 *
 *   1. UN LEAD ES UN CLIENTE QUE LLEGA. La conversación nace del primer mensaje
 *      ENTRANTE. Un saliente hacia un número desconocido no abre conversación:
 *      si lo hiciera, cada mensaje en frío de un vendedor inflaría los leads
 *      con gente que nunca escribió.
 *
 *   2. LA ATRIBUCIÓN SE RESUELVE POR message_id, no por `from_me`. Los mensajes
 *      de la IA y los del vendedor salen del mismo número.
 *
 *   3. INSERTAR ES IDEMPOTENTE. `whapi_message_id` es UNIQUE: el mismo mensaje
 *      puede llegar dos veces —reconexión, resincronización— y no puede
 *      duplicar mensajes, leads ni ventas.
 *
 *   4. UNA VENTA SE REGISTRA CUANDO SE CIERRA. El mensaje con el marcador sella
 *      el cierre aquí mismo, al entrar. Antes esto solo pasaba dentro del
 *      analista, y el analista solo corre cuando alguien pulsa un botón: una
 *      venta cerrada por la mañana no existía para el dashboard hasta que a
 *      alguien se le ocurría pedir el barrido.
 */
import { after } from "next/server";
import {
  adelantarInicio,
  ahora,
  esDeIa,
  existeConversacion,
  getConversation,
  getOrCreateConversation,
  insertMessage,
  marcarActividadCanal,
  anuncioMetaPorAdId,
  guardarImagenGrandeAnuncio,
  guardarProductoAnunciado,
  guardarProductoLead,
  obtenerAgente,
  registrarAnuncioVisto,
  type Canal,
  type Emisor,
  type TipoMensaje,
} from "@/lib/db";
import { registrarCierre } from "@/lib/cierre";
import { descargarImagen, guardar as guardarArchivo } from "@/lib/media";
import { esChatDePersona, esGrupo, normalizarTelefono } from "@/lib/telefono";

/**
 * Un mensaje ya traducido desde el formato de quien sea que lo trajo. Quien
 * llame a `ingerir` se encarga de la traducción; aquí dentro no hay ni una
 * palabra de Baileys.
 */
export interface MensajeEntrante {
  /** Identificador del proveedor. Es la clave de la idempotencia. */
  id: string;
  /** Lo mandamos nosotros (agente o vendedor), no el cliente. */
  deMi: boolean;
  /**
   * Identificador del chat, tal cual: sirve para descartar grupos y, cuando es
   * el del teléfono, para sacar el número del cliente.
   *
   * Quien traduce ya eligió: si el mensaje traía las dos direcciones —la del
   * teléfono y el `@lid`—, aquí llega la del teléfono. Ver `direccionDelChat`.
   */
  chatId: string;
  tipo: TipoMensaje;
  content: string;
  mediaUrl: string | null;
  /** Epoch en segundos. */
  cuando: number;
  /** Nombre que muestra el cliente. Solo en los entrantes. */
  nombre: string | null;
  /** El chat nace de un anuncio de Meta. */
  deAnuncio: boolean;
  productoAnuncio: string | null;
  /** Lo que prometía el anuncio. Explica la conversación que viene detrás. */
  descripcionAnuncio: string | null;
  /**
   * Por dónde entró: 'messenger', 'instagram', 'comentario'. Nulo en WhatsApp,
   * que es de donde viene todo lo que no lo dice.
   *
   * Va en el mensaje y no en el canal porque UNA página de Meta produce las
   * tres cosas, y son el mismo canal con tres conversaciones distintas.
   */
  superficie?: string | null;
  /**
   * De qué app de Meta vino: 'facebook' o 'instagram'. Nulo en WhatsApp.
   * No es lo mismo que `superficie`: un comentario puede ser de cualquiera
   * de las dos apps, y `superficie` para un comentario vale igual en ambas.
   */
  red?: string | null;
  /**
   * El anuncio de Meta que trajo al cliente.
   *
   * Llega SOLO en el primer evento del hilo. Se guarda en la conversación en
   * cuanto se ve, porque a partir del segundo mensaje ya no viene y no hay
   * forma de recuperarlo.
   */
  metaAdId?: string | null;
  /**
   * La imagen del anuncio, en bytes.
   *
   * Llega como miniatura dentro del propio mensaje y es donde está el precio en
   * media publicidad de Facebook: escrito ENCIMA de la foto, no en el texto. Se
   * guarda una vez por anuncio y se describe una vez, no una por cliente.
   */
  imagenAnuncio?: Buffer | null;
  /**
   * La imagen del anuncio, como enlace, para lo que no viaja en bytes.
   *
   * WhatsApp manda la miniatura dentro del mensaje; Messenger manda un enlace
   * al CDN de Facebook. Se descarga aquí y NO en el traductor, que no llama a
   * nadie, y una sola vez por anuncio: un anuncio trae decenas de clientes y
   * la creatividad es la misma para todos.
   */
  imagenAnuncioUrl?: string | null;
  /**
   * La creatividad ENTERA, como enlace, cuando quien la trae sabe dónde está.
   *
   * Distinto de `imagenAnuncioUrl`, que es la vista previa: esta es la foto en
   * su tamaño real y es la que se le reenvía al cliente que la pide. WhatsApp
   * la manda en el mismo `externalAdReply` que la miniatura; Messenger no la
   * sabe todavía en este punto y la busca después, en la publicación.
   */
  imagenAnuncioUrlGrande?: string | null;
  /**
   * La publicación de Facebook que hay detrás del anuncio.
   *
   * Es lo único con lo que se puede recuperar el TEXTO del anuncio, que el
   * referral no manda: con el título a secas —«Set de sábanas»— el agente no
   * sabe si se prometían dos fundas o un 2x1, que es por lo que el cliente
   * escribe. Ver `completarAnunciosPendientes`.
   */
  postAnuncioId?: string | null;
}

export interface Resultado {
  procesados: number;
}

/**
 * Guarda un lote de mensajes y, si procede, despierta al agente vendedor.
 *
 * `dispararAgente` existe porque `after()` solo es válido dentro del ciclo de
 * una petición. Los mensajes que llegan por el socket no están en ninguna
 * petición, así que ahí el agente se llama directamente.
 *
 * `historico` marca lo que llega del teléfono al vincular un número: es lo que
 * ya pasó. Se guarda igual —y las ventas que traiga se sellan igual— pero el
 * agente no contesta a un mensaje de hace tres semanas, y no se gasta una
 * llamada al modelo por cada venta vieja importada.
 */
export async function ingerir(
  canal: Canal,
  mensajes: MensajeEntrante[],
  opciones: { dentroDePeticion: boolean; historico?: boolean },
): Promise<Resultado> {
  const orgId = canal.org_id;
  let procesados = 0;

  // Conversaciones donde el cliente acaba de escribir: las únicas que el
  // agente vendedor puede atender.
  const conversacionesDelCliente = new Set<number>();

  // Toda conversación con algún mensaje nuevo. De estas salen las que hay que
  // analizar: las que este lote acaba de cerrar.
  const tocadas = new Set<number>();

  /*
   * ── EN QUÉ ORDEN SE PROCESA UN LOTE ─────────────────────────────────────
   *
   * Aquí se perdía la mitad de las conversaciones, y no era un fallo de
   * guardado: era el orden.
   *
   * La invariante 1 dice que un saliente hacia un número sin conversación no
   * abre lead. Correcto contra los mensajes en frío, y demoledor cuando el lote
   * llega al revés: el historial de WhatsApp viene del más nuevo al más viejo,
   * así que de un hilo entraban PRIMERO nuestras respuestas —descartadas, una
   * por una, porque el hilo todavía no existía— y solo después el mensaje del
   * cliente que lo abría. El panel enseñaba la conversación con lo que dijo el
   * cliente y sin nada de lo que contestamos. Y si el resumen del pedido iba en
   * una de esas respuestas descartadas, la venta no se sellaba: cerrada en
   * WhatsApp e invisible en el dashboard.
   *
   * Se procesa en dos pasadas y en orden cronológico:
   *
   *   1. Los ENTRANTES, del más viejo al más nuevo. Son los que abren el hilo,
   *      y al ir en orden el lead queda fechado en el primer mensaje de verdad.
   *   2. Los SALIENTES, también en orden. Para entonces el hilo del cliente ya
   *      existe, así que se guardan en vez de tirarse.
   *
   * La invariante 1 sigue en pie: un saliente a alguien que no ha escrito nunca
   * —ni en la base, ni en este lote— se sigue descartando.
   */
  const cronologico = [...mensajes].sort((a, b) => a.cuando - b.cuando);
  const enOrden = [
    ...cronologico.filter((m) => !m.deMi),
    ...cronologico.filter((m) => m.deMi),
  ];

  /** Salientes descartados por no tener hilo. Se cuentan y se dicen una vez. */
  let sinHilo = 0;

  for (const m of enOrden) {
    if (!m.id || !m.chatId) continue;

    // Los grupos no son conversaciones de venta uno a uno. Ni los estados, ni
    // las listas de difusión, ni los canales: ver `esChatDePersona`.
    if (esGrupo(m.chatId) || !esChatDePersona(m.chatId)) continue;

    const telefono = normalizarTelefono(m.chatId);
    if (!telefono) continue;

    /*
     * Invariante 2 — de quién es este mensaje.
     *
     * Entrante: del cliente. Saliente con su id registrado: nuestro, de la IA.
     * ¿Y el resto de salientes? Hasta ahora, de un humano, y esa suposición es
     * falsa en los números que atiende un bot propio del dueño: el panel les
     * ponía «intervino un humano» a conversaciones donde no habló ninguno, y le
     * acreditaba al equipo las ventas que cerró esa IA.
     *
     * `contesta_ia` es el dueño diciendo quién contesta en su número. Es un
     * ajuste y no una adivinanza a propósito: desde fuera, un mensaje escrito a
     * mano y uno de un bot ajeno son idénticos, y en un número donde contestan
     * personas seguir suponiendo «humano» es lo correcto.
     */
    const emisor: Emisor = !m.deMi
      ? "cliente"
      : esDeIa(orgId, m.id) || canal.contesta_ia === 1
        ? "ia"
        : "humano";

    try {
      // Invariante 1.
      if (m.deMi && !existeConversacion(orgId, canal.id, telefono)) {
        sinHilo++;
        continue;
      }

      const { conversacion } = getOrCreateConversation(orgId, canal.id, telefono, {
        /*
         * La dirección tal cual llegó, para poder contestarle.
         *
         * Solo de los mensajes del cliente: en un saliente el `chatId` sigue
         * siendo el del chat, pero es nuestro propio mensaje y no aporta nada
         * que no traiga ya el entrante.
         */
        jid: m.deMi ? null : m.chatId,
        // El nombre solo viene en los entrantes; en los salientes es el nuestro.
        nombre: m.deMi ? null : m.nombre,
        cuando: m.cuando,
        origen: m.deAnuncio ? "anuncio" : null,
        superficie: m.superficie ?? null,
        red: m.red ?? null,
        metaAdId: m.metaAdId ?? null,
        productoAnuncio: m.productoAnuncio,
        descripcionAnuncio: m.descripcionAnuncio,
      });

      /*
       * El lead empieza cuando escribió el cliente. Ver `adelantarInicio`: al
       * importar el historial entran mensajes más viejos que el hilo que ya
       * existía, y sin esto todos esos leads quedarían fechados el día en que
       * se vinculó el número.
       */
      if (!m.deMi && m.cuando < conversacion.fecha_inicio) {
        adelantarInicio(orgId, conversacion.id, m.cuando);
      }

      /*
       * LO QUE VENDE EL ANUNCIO, LEÍDO AQUÍ Y GUARDADO.
       *
       * El caso de la dueña (2026-09-11): el cliente llega por un anuncio de
       * poloches, el agente reconoce el artículo y no tiene el precio, así que
       * le dice que un representante se lo confirma. El anuncio traía el
       * precio escrito —lo escribió el negocio— pero solo llega en ESTE
       * mensaje: si no se lee ahora, a la tercera respuesta ya no existe.
       *
       * Se guarda en dos sitios y por dos razones: en la conversación, para
       * este cliente y todo lo que venga detrás; y en el catálogo de lo
       * anunciado, para el que escriba dentro de tres días sin pinchar nada.
       */
      if (!m.deMi && (m.productoAnuncio || m.descripcionAnuncio)) {
        try {
          const { agenteDePais } = await import("@/agents");
          const { leerProductoDelAnuncio } = await import("@/lib/anuncio");
          const simbolo = agenteDePais(obtenerAgente(orgId, canal.id).pais)?.moneda.simbolo;

          const producto = simbolo
            ? leerProductoDelAnuncio(m.productoAnuncio, m.descripcionAnuncio, simbolo)
            : null;

          if (producto) {
            guardarProductoLead(orgId, conversacion.id, producto);
            // Al catálogo solo lo que trae precio: una fila sin cifra no sirve
            // para cotizar y sí ensucia la búsqueda. Ver `guardarProductoAnunciado`.
            guardarProductoAnunciado(orgId, { ...producto, adId: m.metaAdId ?? null });
          }
        } catch (e) {
          // Que no se pueda leer el anuncio no puede tirar la ingesta: el
          // mensaje entra igual y el agente sigue con lo que ya sabía.
          console.error(`[ingesta] no se pudo leer el producto del anuncio en ${conversacion.id}`, e);
        }
      }

      /*
       * EL ANUNCIO, GUARDADO EN CUANTO SE VE.
       *
       * El `ad_id`, el texto y la miniatura llegan SOLO en el primer mensaje del
       * hilo. Si no se guardan en este instante, se pierden: a partir del
       * segundo mensaje ya no vienen y no hay forma de recuperarlos. Con ellos
       * se puede vincular el anuncio a un producto —de ahí sale el precio bueno—
       * y leer lo que dice su imagen.
       */
      if (m.metaAdId) {
        try {
          /*
           * LA CREATIVIDAD SE TRAE UNA VEZ, no una por cliente.
           *
           * Un anuncio que funciona trae decenas de leads, y todos llegan con
           * el mismo `photo_url`. Preguntar primero si ya la tenemos convierte
           * decenas de descargas dentro del webhook —donde tardar cuesta que
           * Meta lo desactive— en una sola.
           */
          const guardado = anuncioMetaPorAdId(orgId, m.metaAdId);
          let imagen = guardado?.imagen ?? null;

          if (!imagen) {
            const bytes =
              m.imagenAnuncio ??
              (m.imagenAnuncioUrl ? await descargarImagen(m.imagenAnuncioUrl) : null);

            if (bytes) imagen = guardarArchivo(orgId, `anuncio:${m.metaAdId}`, "imagen", bytes);
          }

          registrarAnuncioVisto(orgId, m.metaAdId, m.productoAnuncio ?? null, {
            texto: m.descripcionAnuncio ?? null,
            imagen,
            postId: m.postAnuncioId ?? null,
          });

          /*
           * LA FOTO EN GRANDE, QUE ES LA QUE SE LE MANDA AL CLIENTE.
           *
           * Lo que se guardó arriba es la miniatura que viaja dentro del
           * mensaje: unos kilobytes. Vale para que el modelo lea lo que hay
           * escrito encima, y NO vale para reenviársela a quien pide ver el
           * producto —le llega pixelada—. Aquí se baja la de verdad y pisa a la
           * miniatura, igual que hace `completarAnunciosPendientes` en Meta.
           *
           * UNA VEZ POR ANUNCIO, marcada con `imagen_hd`. Sin esa marca, cada
           * lead del mismo anuncio repetiría la descarga con el cliente
           * esperando; y se marca también cuando no se consigue, que es la
           * diferencia entre «no la hay» y «no lo hemos intentado».
           *
           * Solo si de verdad es más grande que la miniatura. Hay formatos que
           * devuelven en ese enlace la misma vista previa, y cambiar una foto
           * por otra igual para borrar de paso el `attachment_id` de Meta sería
           * pagar una subida entera para dejar al cliente como estaba.
           */
          if (m.imagenAnuncioUrlGrande && !guardado?.imagen_hd) {
            const grande = await descargarImagen(m.imagenAnuncioUrlGrande, 8_000);
            const mejor = grande && grande.length > (m.imagenAnuncio?.length ?? 0) ? grande : null;

            guardarImagenGrandeAnuncio(
              orgId,
              m.metaAdId,
              mejor ? guardarArchivo(orgId, `anuncio-hd:${m.metaAdId}`, "imagen", mejor) : null,
            );
          }
        } catch (e) {
          // El anuncio es contexto, no la conversación: que falle no puede
          // impedir que el mensaje del cliente entre.
          console.error(`Entrada: no se pudo guardar el anuncio ${m.metaAdId}`, e);
        }
      }

      // Invariante 3.
      const insertado = insertMessage(orgId, {
        conversationId: conversacion.id,
        whapiMessageId: m.id,
        emisor,
        tipo: m.tipo,
        content: m.content,
        createdAt: m.cuando,
        mediaUrl: m.mediaUrl,
      });

      if (insertado !== null) {
        procesados++;
        tocadas.add(conversacion.id);

        if (emisor === "cliente") {
          conversacionesDelCliente.add(conversacion.id);
        } else {
          /*
           * INVARIANTE 4 — una venta se registra cuando se cierra.
           *
           * El vendedor manda el resumen desde su móvil y la venta queda
           * contada en ese instante, sin esperar a que nadie pulse «Analizar».
           * Reconocer el marcador es mecánico: no cuesta ni una llamada al
           * modelo. (Los resúmenes que manda la IA los sella `agent.ts`: su
           * mensaje ya está guardado cuando WhatsApp lo devuelve por aquí.)
           */
          registrarCierre(orgId, conversacion.id, {
            emisor,
            content: m.content,
            cuando: m.cuando,
          });
        }
      }
    } catch (e) {
      // Un mensaje malo no puede tumbar el lote entero.
      console.error(`Entrada: no se pudo guardar el mensaje ${m.id}`, e);
    }
  }

  // Marca de vida del canal: alimenta la anomalía "canal activo sin leads",
  // que casi siempre significa que la conexión se cayó.
  marcarActividadCanal(orgId, canal.id, ahora());

  /*
   * Punto ÚNICO de disparo del agente vendedor. Que solo haya uno es lo que
   * garantiza que nunca conteste dos veces al mismo mensaje.
   *
   * El import es dinámico a propósito: el módulo que envía no entra en el grafo
   * hasta que hay un cliente esperando y el agente está encendido.
   */
  /*
   * EL AGENTE NO CONTESTA AL PASADO.
   *
   * Un lote histórico son conversaciones de días o semanas atrás, muchas ya
   * atendidas y muchas ya cerradas. Sin esta condición, vincular un número por
   * QR haría que el agente escribiera a doscientos clientes de golpe
   * contestando mensajes viejos. Es el peor daño que este archivo podría hacer.
   */
  const atiendeElAgente =
    !opciones.historico && canal.agente_activo === 1 && conversacionesDelCliente.size > 0;

  // Escribió un cliente y el agente ni se llama: se dice, o el silencio no
  // tiene ni una línea que lo explique en el registro del servidor.
  if (!opciones.historico && !atiendeElAgente && conversacionesDelCliente.size > 0) {
    console.log(
      `[agente] callado en el canal ${canal.id}: agente apagado en este número ` +
        `(${conversacionesDelCliente.size} conversación(es) esperando)`,
    );
  }

  if (atiendeElAgente || tocadas.size > 0) {
    const trabajo = async () => {
      if (atiendeElAgente) {
        /*
         * Lo que dice la imagen del anuncio, ANTES de contestar.
         *
         * Es una llamada por creatividad publicada, no por cliente: la
         * descripción se guarda en el anuncio y sirve para los cientos de leads
         * que traiga. Va aquí delante porque el primer mensaje del hilo es
         * justo el que llega con el anuncio, y es en esa primera respuesta
         * donde el agente tiene que saber de qué foto le hablan.
         */
        /*
         * DE QUÉ VIENE EL CLIENTE, en las palabras del propio negocio.
         *
         * Va DELANTE de mirar la imagen y no detrás: leerle a Meta un post
         * tarda un pestañeo y describir una creatividad tarda segundos. Si el
         * modelo de visión está lento o caído, el agente se queda al menos con
         * el texto del anuncio, que es donde está la promesa por la que el
         * cliente escribió.
         *
         * Solo en Meta: en WhatsApp el anuncio llega entero dentro del mensaje
         * y no hay nada que ir a buscar.
         */
        if (canal.tipo === "meta") {
          try {
            const { completarAnunciosPendientes } = await import("@/lib/meta/paginas");
            await completarAnunciosPendientes(canal, 1);
          } catch (e) {
            // Sin el texto, el agente sigue con el título y la imagen.
            console.error("No se pudo leer la publicación de un anuncio:", e);
          }
        }

        try {
          const { describirAnunciosPendientes } = await import("@/lib/analyzer");
          /*
           * UNO SOLO, Y CON RELOJ. Las dos cosas se pagaron caras.
           *
           * Esto corre ANTES de contestar, con el cliente esperando. Cuando
           * miraba tres anuncios seguidos, cada uno con el minuto entero de
           * espera de una llamada al modelo, un cliente podía quedarse tres
           * minutos sin respuesta —y con la visión caída, TODOS—. El agente
           * parecía muerto cuando lo que estaba era haciendo cola.
           *
           * El anuncio que importa es el del hilo que acaba de abrirse, y es el
           * más reciente, que es justo el que devuelve la consulta.
           */
          await describirAnunciosPendientes(orgId, 1, 10_000);
        } catch (e) {
          // Sin descripción, el agente sigue con el título y el texto del
          // anuncio: peor, pero no roto.
          console.error("No se pudo describir la imagen de un anuncio:", e);
        }

        const { atenderConversacion } = await import("@/lib/agent");

        for (const conversationId of conversacionesDelCliente) {
          try {
            /*
             * Cuando el agente NO contesta, se dice por qué.
             *
             * El motivo lo decide `atenderConversacion` y hasta ahora se tiraba
             * aquí mismo: un cliente escribía, el agente se callaba por una
             * razón perfectamente buena —el número está en modo vigilar, un
             * vendedor acaba de escribir, es de madrugada— y desde fuera se veía
             * igual que una avería. Una línea en el registro es la diferencia
             * entre «no responde» y «no responde porque…».
             */
            const r = await atenderConversacion(orgId, canal.id, conversationId);
            if (!r.atendida) {
              const detalle = "detalle" in r ? `: ${r.detalle}` : "";
              console.log(`[agente] callado en la conversación ${conversationId} (${r.motivo}${detalle})`);
            }
          } catch (e) {
            // Nunca se reintenta en bucle: se registra y el hilo queda para un
            // humano. Un agente insistiendo es peor que un agente callado.
            console.error(`El agente falló en la conversación ${conversationId}:`, e);
          }
        }
      }

      /*
       * Las ventas que este lote acabó de cerrar se analizan solas.
       *
       * El cierre ya está atribuido y contado —el marcador no cuesta nada—,
       * pero el pedido de dentro (producto, total, envío) hay que sacarlo del
       * hilo, y eso sí pide el modelo. Es UNA llamada por venta cerrada, en el
       * momento en que se cierra: nada que ver con barrer el histórico entero,
       * que es lo que el barrido manual evita. Sin esto, la venta se contaba
       * como cierre pero facturaba cero hasta que alguien pulsara el botón.
       *
       * Se mira DESPUÉS del agente, a propósito: el resumen que acaba de
       * escribir la IA cierra su conversación en esa misma vuelta.
       */
      const cerradas = opciones.historico
        ? []
        : [...tocadas].filter((id) => {
            const c = getConversation(orgId, id);
            return c && c.fecha_cierre !== null && c.analizada_at === null;
          });

      if (cerradas.length > 0) {
        const { analizarConversacion } = await import("@/lib/analyzer");

        for (const conversationId of cerradas) {
          try {
            await analizarConversacion(orgId, conversationId);
          } catch (e) {
            // El pedido se queda sin extraer, pero la venta ya está contada.
            // El barrido manual volverá a intentarlo.
            console.error(`No se pudo analizar la venta cerrada ${conversationId}:`, e);
          }
        }
      }
    };

    if (opciones.dentroDePeticion) {
      // Que el acuse salga primero: la llamada al modelo tarda segundos.
      after(trabajo);
    } else {
      // Fuera de petición no hay a quién responder, pero tampoco se espera:
      // el socket tiene que seguir leyendo mensajes mientras el agente piensa.
      void trabajo();
    }
  }

  /*
   * ── LAS VENTAS QUE VENÍAN CERRADAS EN EL HISTORIAL ──────────────────────
   *
   * Cada mensaje que entra arriba sella su propio cierre, pero eso solo alcanza
   * a los que se insertan AHORA. En un lote histórico hay hilos donde el
   * resumen del pedido ya estaba guardado desde antes y el cierre nunca se
   * selló —porque en su día el mensaje entró por un camino que no sellaba, o
   * porque su hilo se acaba de completar con lo que faltaba—. Este barrido los
   * recoge: es mecánico, no llama a ningún modelo y es idempotente.
   *
   * Se hace en la importación y no solo al arrancar el servidor porque es
   * exactamente aquí donde aparecen las ventas viejas.
   */
  if (opciones.historico) {
    let selladas = 0;
    try {
      const { sellarCierresPendientes } = await import("@/lib/cierre");
      selladas = sellarCierresPendientes(orgId);
    } catch (e) {
      console.error("[historial] no se pudieron sellar las ventas del lote", e);
    }

    console.log(
      `[historial] canal ${canal.id}: ${procesados} mensaje(s) guardado(s)` +
        (selladas > 0 ? `, ${selladas} venta(s) cerrada(s) que no estaban contadas` : "") +
        (sinHilo > 0 ? `, ${sinHilo} saliente(s) a números que nunca escribieron` : ""),
    );
  } else if (sinHilo > 0) {
    console.warn(`Entrada: ${sinHilo} saliente(s) sin conversación previa; no crean lead.`);
  }

  return { procesados };
}
