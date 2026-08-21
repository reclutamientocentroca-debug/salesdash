import { NextResponse, type NextRequest } from "next/server";
import { analizarLote } from "@/lib/analyzer";
import { barrerAnomalias } from "@/lib/anomalies";
import { ErrorIA } from "@/lib/ia";
import { limitar } from "@/lib/auth";
import { rangoDesdeQuery, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/analyze — el barrido diario.
 *
 * Recorre los hilos con actividad del rango más los que sigan abiertos de
 * días anteriores, y termina verificando la invariante de conteo. Los hilos
 * ya sellados no se reevalúan.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cupo = limitar(`lote:${orgId}`, 12, 3600);
  if (!cupo.ok) {
    return NextResponse.json({ error: "El barrido ya corrió varias veces esta hora." }, { status: 429 });
  }

  try {
    const { desde } = rangoDesdeQuery(req.nextUrl.searchParams);
    const resumen = await analizarLote(orgId, desde);
    const anomalias = barrerAnomalias(orgId);

    return NextResponse.json({ ...resumen, anomalias });
  } catch (e) {
    if (e instanceof ErrorIA) return NextResponse.json({ error: e.message }, { status: 502 });
    return NextResponse.json({ error: "El barrido falló." }, { status: 500 });
  }
}
