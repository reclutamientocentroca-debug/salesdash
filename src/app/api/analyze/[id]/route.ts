import { NextResponse, type NextRequest } from "next/server";
import { analizarConversacion } from "@/lib/analyzer";
import { ErrorIA } from "@/lib/ia";
import { limitar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/analyze/[id] — analiza una conversación.
 *
 * Solo corre cuando alguien lo pide; nunca en automático sobre todo el
 * histórico. Si la conversación ya está sellada, responde sin gastar nada.
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cupo = limitar(`analisis:${orgId}`, 120, 3600);
  if (!cupo.ok) {
    return NextResponse.json(
      { error: "Muchos análisis seguidos. Espera unos minutos." },
      { status: 429 },
    );
  }

  const { id } = await params;
  const conversationId = Number(id);
  if (!Number.isInteger(conversationId)) {
    return NextResponse.json({ error: "Conversación inválida" }, { status: 400 });
  }

  try {
    return NextResponse.json(await analizarConversacion(orgId, conversationId));
  } catch (e) {
    if (e instanceof ErrorIA) {
      return NextResponse.json(
        {
          error: e.esLimite
            ? "El modelo agotó su límite. Cambia de modelo o configura uno de respaldo."
            : e.message,
        },
        { status: 502 },
      );
    }
    const mensaje = e instanceof Error ? e.message : "No pudimos analizar la conversación.";
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
