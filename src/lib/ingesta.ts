/**
 * SalesDash — entrada de mensajes.
 *
 * Este módulo era el cuerpo del webhook de Whapi. Al conectar por QR ya no hay
 * webhook: los mensajes llegan por el socket que `wa.ts` mantiene abierto. La
 * lógica es la misma y por eso vive aquí, en un solo sitio, hablando un formato
 * propio en vez del de un proveedor.
 *
 * Las tres invariantes de este archivo sostienen todo el producto y ninguna es
 * decorativa:
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
 */
import { after } from "next/server";
import {
  ahora,
  esDeIa,
  existeConversacion,
  getOrCreateConversation,
  insertMessage,
  marcarActividadCanal,
  type Canal,
  type Emisor,
  type TipoMensaje,
} from "@/lib/db";
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
  /** Identificador del chat, tal cual: sirve para descartar grupos. */
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

  for (const m of mensajes) {
    if (!m.id || !m.chatId) continue;

    // Los grupos no son conversaciones de venta uno a uno.
    if (esGrupo(m.chatId)) continue;

    const telefono = normalizarTelefono(m.chatId);
    if (!telefono) continue;

    // Invariante 2.
    const emisor: Emisor = !m.deMi ? "cliente" : esDeIa(orgId, m.id) ? "ia" : "humano";

    try {
      // Invariante 1.
      if (m.deMi && !existeConversacion(orgId, canal.id, telefono)) {
        console.warn(`Entrada: saliente a ${telefono} sin conversación previa; no crea lead.`);
        continue;
      }

      const { conversacion } = getOrCreateConversation(orgId, canal.id, telefono, {
        // El nombre solo viene en los entrantes; en los salientes es el nuestro.
        nombre: m.deMi ? null : m.nombre,
        cuando: m.cuando,
        origen: m.deAnuncio ? "anuncio" : null,
        productoAnuncio: m.productoAnuncio,
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
        if (emisor === "cliente") conversacionesDelCliente.add(conversacion.id);
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
  if (canal.agente_activo === 1 && conversacionesDelCliente.size > 0) {
    const trabajo = async () => {
      const { atenderConversacion } = await import("@/lib/agent");

      for (const conversationId of conversacionesDelCliente) {
        try {
          await atenderConversacion(orgId, canal.id, conversationId);
        } catch (e) {
          // Nunca se reintenta en bucle: se registra y el hilo queda para un
          // humano. Un agente insistiendo es peor que un agente callado.
          console.error(`El agente falló en la conversación ${conversationId}:`, e);
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
