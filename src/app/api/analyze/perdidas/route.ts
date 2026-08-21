import { NextResponse, type NextRequest } from "next/server";
import { analizarPerdidas } from "@/lib/analyzer";
import { ErrorIA } from "@/lib/ia";
import { limitar } from "@/lib/auth";
import { rangoDesdeQuery, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/analyze/perdidas — por qué se caen las que no cerraron.
 *
 * El segmento sin cerrar suele ser el más grande del panel y el que nadie
 * sabe explicar. Se analiza una muestra: interesa la proporción, no el censo.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cupo = limitar(`perdidas:${orgId}`, 6, 3600);
  if (!cupo.ok) {
    return NextResponse.json(
      { error: "Este análisis ya se corrió varias veces esta hora. Espera un poco." },
      { status: 429 },
    );
  }

  try {
    const rango = rangoDesdeQuery(req.nextUrl.searchParams);
    return NextResponse.json(await analizarPerdidas(orgId, rango));
  } catch (e) {
    if (e instanceof ErrorIA) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: "No pudimos analizar las pérdidas." }, { status: 500 });
  }
}
