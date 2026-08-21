import { NextResponse } from "next/server";
import { ErrorIA, listarModelos } from "@/lib/ia";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/modelos — la lista sale de OpenRouter, no de una constante.
 * Los modelos cambian cada pocas semanas; una lista escrita a mano envejece
 * mal. La respuesta se cachea 24 horas en memoria.
 */
export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  try {
    const modelos = await listarModelos();
    return NextResponse.json({
      gratuitos: modelos.filter((m) => m.gratis),
      de_pago: modelos.filter((m) => !m.gratis),
    });
  } catch (e) {
    const detalle = e instanceof ErrorIA ? e.message : "No pudimos cargar la lista de modelos.";
    return NextResponse.json({ error: detalle }, { status: 502 });
  }
}
