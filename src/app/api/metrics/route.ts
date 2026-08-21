import { NextResponse, type NextRequest } from "next/server";
import { contarRevisiones, listarAnomalias } from "@/lib/db";
import { calcularMetricas } from "@/lib/metrics";
import { rangoDesdeQuery, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/metrics?rango=7d&canalId= — el orgId sale de la sesión, nunca de la query. */
export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const params = req.nextUrl.searchParams;
  const canalCrudo = params.get("canalId");
  const canalId = canalCrudo && Number.isInteger(Number(canalCrudo)) ? Number(canalCrudo) : undefined;

  const rango = { ...rangoDesdeQuery(params), canalId };
  const metricas = calcularMetricas(orgId, rango);
  const anomalias = listarAnomalias(orgId);

  return NextResponse.json({
    rango: { desde: rango.desde, hasta: rango.hasta, canalId: canalId ?? null },
    ...metricas,
    // Se muestra siempre: si crece, algo falla en la detección de cierres.
    pendientes_de_revision: contarRevisiones(orgId),
    anomalias: {
      altas: anomalias.filter((a) => a.severidad === "alta").length,
      medias: anomalias.filter((a) => a.severidad === "media").length,
    },
  });
}
