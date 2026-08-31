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
  ahora,
  esDeIa,
  existeConversacion,
  getConversation,
  getOrCreateConversation,
  insertMessage,
  marcarActividadCanal,
  type Canal,
  type Emisor,
  type TipoMensaje,
} from "@/lib/db";
import { registrarCierre } from "@/lib/cierre";
import { esGrupo, normalizarTelefono } from "@/lib/telefono";

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
   * El anuncio de Meta que trajo al cliente.
   *
   * Llega SOLO en el primer evento del hilo. Se guarda en la conversación en
   * cuanto se ve, porque a partir del segundo mensaje ya no viene y no hay
   * forma de recuperarlo.
   */
  metaAdId?: string | null;
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
 */
export async function ingerir(
  canal: Canal,
  mensajes: MensajeEntrante[],
  opciones: { dentroDePeticion: boolean },
): Promise<Resultado> {
  const orgId = canal.org_id;
  let procesados = 0;

  // Conversaciones donde el cliente acaba de escribir: las únicas que el
  // agente vendedor puede atender.
  const conversacionesDelCliente = new Set<number>();

  // Toda conversación con algún mensaje nuevo. De estas salen las que hay que
  // analizar: las que este lote acaba de cerrar.
  const tocadas = new Set<number>();

  for (const m of mensajes) {
    if (!m.id || !m.chatId) continue;

    // Los grupos no son conversaciones de venta uno a uno.
    if (esGrupo(m.chatId)) continue;

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
        console.warn(`Entrada: saliente a ${telefono} sin conversación previa; no crea lead.`);
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
        metaAdId: m.metaAdId ?? null,
        productoAnuncio: m.productoAnuncio,
        descripcionAnuncio: m.descripcionAnuncio,
      });

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
  const atiendeElAgente = canal.agente_activo === 1 && conversacionesDelCliente.size > 0;

  // Escribió un cliente y el agente ni se llama: se dice, o el silencio no
  // tiene ni una línea que lo explique en el registro del servidor.
  if (!atiendeElAgente && conversacionesDelCliente.size > 0) {
    console.log(
      `[agente] callado en el canal ${canal.id}: agente apagado en este número ` +
        `(${conversacionesDelCliente.size} conversación(es) esperando)`,
    );
  }

  if (atiendeElAgente || tocadas.size > 0) {
    const trabajo = async () => {
      if (atiendeElAgente) {
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
      const cerradas = [...tocadas].filter((id) => {
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

  return { procesados };
}
