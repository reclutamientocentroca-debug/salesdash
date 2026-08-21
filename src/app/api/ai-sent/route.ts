import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  canalPorWebhook,
  corregirEmisorAIa,
  crearAnomalia,
  getConversation,
  recalcularIntervencionHumana,
  registrarAiSent,
} from "@/lib/db";
import { getSession } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai-sent — registra que un mensaje saliente lo mandó la IA.
 *
 * Sin esto, todo lo que sale del número se cuenta como humano y la métrica
 * central del producto queda al revés.
 *
 * Dos formas de identificarse, ninguna nueva:
 *   1. Sesión del panel (lo llama el agente interno).
 *   2. `?canal=<id>&s=<webhook_secret>` — la misma credencial del webhook,
 *      que quien configuró Make ya tiene a mano.
 */

const Entrada = z.object({
  message_id: z.string().trim().min(1).max(200).optional(),
  message_ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});

async function resolverOrg(req: NextRequest): Promise<number | null> {
  const canalId = Number(req.nextUrl.searchParams.get("canal"));
  const secreto = req.nextUrl.searchParams.get("s");

  if (Number.isInteger(canalId) && secreto) {
    return canalPorWebhook(canalId, secreto)?.org_id ?? null;
  }

  return (await getSession())?.orgId ?? null;
}

export async function POST(req: NextRequest) {
  const orgId = await resolverOrg(req);
  if (!orgId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const cuerpo = await req.json().catch(() => null);
  const datos = Entrada.safeParse(cuerpo);
  if (!datos.success) {
    return NextResponse.json({ error: "Falta message_id" }, { status: 400 });
  }

  const ids = [...(datos.data.message_ids ?? []), ...(datos.data.message_id ? [datos.data.message_id] : [])];
  if (!ids.length) return NextResponse.json({ error: "Falta message_id" }, { status: 400 });

  let corregidos = 0;

  for (const id of ids) {
    registrarAiSent(orgId, id);

    /*
     * LA CARRERA. El webhook del saliente pudo llegar antes que este aviso,
     * en cuyo caso el mensaje quedó marcado como `humano`. Se corrige y se
     * recalcula la intervención humana de toda la conversación.
     */
    const conversationId = corregirEmisorAIa(orgId, id);
    if (conversationId === null) continue;

    corregidos++;
    recalcularIntervencionHumana(orgId, conversationId);

    /*
     * Caso de borde: si el analista ya había sellado esta conversación como
     * cierre humano apoyándose en ese mensaje, la regla maestra impide
     * reclasificarla sola. Se avisa para que una persona lo resuelva desde la
     * bandeja de revisión, en vez de dejar una venta contada al revés.
     */
    const conv = getConversation(orgId, conversationId);
    if (conv?.cerrado_por === "humano" && conv.intervencion_humana === 0) {
      crearAnomalia(orgId, {
        conversationId,
        tipo: "atribucion_tardia",
        severidad: "alta",
        detalle:
          "El aviso de la IA llegó después de clasificar el cierre como humano. " +
          "Revisa a quién pertenece esta venta.",
      });
    }
  }

  return NextResponse.json({ ok: true, registrados: ids.length, corregidos });
}
