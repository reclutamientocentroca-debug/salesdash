import { after, NextResponse, type NextRequest } from "next/server";
import {
  ahora,
  canalPorWebhook,
  esDeIa,
  existeConversacion,
  getOrCreateConversation,
  insertMessage,
  marcarActividadCanal,
  type Emisor,
  type TipoMensaje,
} from "@/lib/db";
import { esGrupo, normalizarTelefono } from "@/lib/whapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook de Whapi — POST /api/webhook/[canalId]?s=<webhook_secret>
 *
 * Todo lo que el panel sabe entra por aquí. El único sondeo del sistema es el
 * del estado del QR, y solo mientras esa pantalla está abierta.
 *
 * El `org_id` NUNCA llega por parámetro: se deduce del canal, y solo si el
 * secreto coincide. Quien adivine un canalId no puede inyectar nada.
 */

/** Formato verificado en la documentación de Whapi (evento `messages`). */
interface MensajeWhapi {
  id?: string;
  from_me?: boolean;
  chat_id?: string;
  type?: string;
  timestamp?: number;
  from?: string;
  from_name?: string;
  text?: { body?: string };
  image?: { link?: string; caption?: string };
  video?: { link?: string; caption?: string };
  document?: { link?: string; caption?: string; file_name?: string };
  voice?: { link?: string };
  audio?: { link?: string };
  /**
   * Presente solo cuando el chat nace de un anuncio de Meta. Se lee de forma
   * defensiva: si Whapi no lo reenvía, `producto_anuncio` queda vacío y el
   * analista lo deduce del texto del primer mensaje.
   */
  referral?: { headline?: string; body?: string; source_url?: string };
}

interface CargaWhapi {
  messages?: MensajeWhapi[];
  channel_id?: string;
}

/**
 * Traduce el tipo de Whapi al nuestro y arma un `content` legible.
 *
 * El archivo NO se descarga ni se almacena: solo se guarda la marca, el
 * caption y la URL temporal, que el modelo con visión lee más tarde si hace
 * falta. Guardar las facturas de los clientes de tus clientes es un problema
 * de privacidad que no queremos.
 */
function interpretar(m: MensajeWhapi): { tipo: TipoMensaje; content: string; mediaUrl: string | null } {
  const conCaption = (marca: string, caption?: string) =>
    caption?.trim() ? `${marca} ${caption.trim()}` : marca;

  switch (m.type) {
    case "text":
      return { tipo: "texto", content: m.text?.body ?? "", mediaUrl: null };

    case "image":
      return {
        tipo: "imagen",
        content: conCaption("[imagen]", m.image?.caption),
        mediaUrl: m.image?.link ?? null,
      };

    case "document":
      return {
        tipo: "documento",
        content: conCaption(
          `[documento${m.document?.file_name ? `: ${m.document.file_name}` : ""}]`,
          m.document?.caption,
        ),
        mediaUrl: m.document?.link ?? null,
      };

    // El audio no se analiza, pero se registra: sin él, el conteo de mensajes
    // y la detección de intervención humana quedan mal.
    case "voice":
      return { tipo: "audio", content: "[nota de voz]", mediaUrl: m.voice?.link ?? null };
    case "audio":
      return { tipo: "audio", content: "[audio]", mediaUrl: m.audio?.link ?? null };

    case "video":
      return {
        tipo: "otro",
        content: conCaption("[video]", m.video?.caption),
        mediaUrl: m.video?.link ?? null,
      };

    default:
      return { tipo: "otro", content: `[${m.type ?? "mensaje"}]`, mediaUrl: null };
  }
}

interface Ctx {
  params: Promise<{ canalId: string }>;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { canalId } = await params;
  const secreto = req.nextUrl.searchParams.get("s") ?? "";

  const id = Number(canalId);
  if (!Number.isInteger(id) || !secreto) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Aquí se resuelve la organización. Sin secreto correcto, 404 sin detalles:
  // no se confirma siquiera que el canal exista.
  const canal = canalPorWebhook(id, secreto);
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const carga = (await req.json().catch(() => null)) as CargaWhapi | null;
  if (!carga?.messages?.length) {
    // Un evento sin mensajes (o un cuerpo ilegible) no se puede reprocesar:
    // se responde 200 para que el proveedor no lo reintente eternamente.
    return NextResponse.json({ ok: true, procesados: 0 });
  }

  const orgId = canal.org_id;
  let procesados = 0;
  // Conversaciones donde el cliente acaba de escribir: las únicas que el
  // agente vendedor puede atender.
  const conversacionesDelCliente = new Set<number>();

  for (const m of carga.messages) {
    if (!m.id || !m.chat_id) continue;

    // Los grupos no son conversaciones de venta uno a uno.
    if (esGrupo(m.chat_id)) continue;

    const telefono = normalizarTelefono(m.chat_id);
    if (!telefono) continue;

    /**
     * ATRIBUCIÓN. Los mensajes de la IA y los del vendedor salen del mismo
     * número, así que `from_me` no los distingue: se resuelve por message_id.
     *
     * Si el aviso de /api/ai-sent todavía no llegó, el mensaje queda como
     * `humano` de forma provisional. Ese mismo endpoint lo corrige después.
     */
    const emisor: Emisor = !m.from_me ? "cliente" : esDeIa(orgId, m.id) ? "ia" : "humano";

    const { tipo, content, mediaUrl } = interpretar(m);
    const cuando = m.timestamp ?? ahora();

    try {
      /*
       * UN LEAD ES UN CLIENTE QUE LLEGA.
       *
       * La conversación se crea con el primer mensaje ENTRANTE, y eso es lo
       * que cuenta como lead: no importa si después nadie contesta, ya llegó.
       *
       * Un saliente hacia un número con el que nunca hubo conversación no
       * abre una: si lo hiciera, cada mensaje que un vendedor mande en frío
       * inflaría el conteo de leads con gente que nunca escribió.
       */
      if (m.from_me && !existeConversacion(orgId, canal.id, telefono)) {
        console.warn(`Webhook: saliente a ${telefono} sin conversación previa; no crea lead.`);
        continue;
      }

      const { conversacion } = getOrCreateConversation(orgId, canal.id, telefono, {
        // El nombre solo viene en los entrantes; en los salientes es el nuestro.
        nombre: m.from_me ? null : (m.from_name ?? null),
        cuando,
        origen: m.referral ? "anuncio" : null,
        productoAnuncio: m.referral?.headline ?? m.referral?.body ?? null,
      });

      // Idempotente: whapi_message_id es UNIQUE. El proveedor reintenta y sin
      // esto se duplicarían mensajes, leads y ventas.
      const insertado = insertMessage(orgId, {
        conversationId: conversacion.id,
        whapiMessageId: m.id,
        emisor,
        tipo,
        content,
        createdAt: cuando,
        mediaUrl,
      });

      if (insertado !== null) {
        procesados++;
        if (emisor === "cliente") conversacionesDelCliente.add(conversacion.id);
      }
    } catch (e) {
      // Un mensaje malo no puede tumbar el lote entero.
      console.error(`Webhook: no se pudo guardar el mensaje ${m.id}`, e);
    }
  }

  // Marca de vida del canal: alimenta la anomalía "canal activo sin leads",
  // que casi siempre significa que el webhook se cayó.
  marcarActividadCanal(orgId, canal.id, ahora());

  /*
   * Punto ÚNICO de disparo del agente vendedor.
   *
   * Va dentro de `after()` para que el 200 salga primero: la llamada al
   * modelo tarda segundos y nunca debe retrasar el acuse al proveedor, que si
   * no reintentaría el mismo lote.
   *
   * El import es dinámico a propósito: el módulo que envía no entra en el
   * grafo del webhook hasta que hay un cliente esperando respuesta y el
   * agente está encendido.
   */
  if (canal.agente_activo === 1 && conversacionesDelCliente.size > 0) {
    after(async () => {
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
    });
  }

  return NextResponse.json({ ok: true, procesados });
}
