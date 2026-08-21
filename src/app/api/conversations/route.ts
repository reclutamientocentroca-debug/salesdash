import { NextResponse, type NextRequest } from "next/server";
import { listarCanales, listarConversaciones, type EstadoCierre } from "@/lib/db";
import { rangoDesdeQuery, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ESTADOS: EstadoCierre[] = ["ia", "humano", "abierta", "revision"];

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const params = req.nextUrl.searchParams;
  const rango = rangoDesdeQuery(params);

  const estadoCrudo = params.get("estado");
  const estado = ESTADOS.includes(estadoCrudo as EstadoCierre) ? (estadoCrudo as EstadoCierre) : undefined;

  const canalCrudo = Number(params.get("canalId"));
  const canalId = Number.isInteger(canalCrudo) && canalCrudo > 0 ? canalCrudo : undefined;

  const limite = Math.min(Number(params.get("limite")) || 100, 200);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  const nombres = new Map(listarCanales(orgId).map((c) => [c.id, c.nombre]));

  const conversaciones = listarConversaciones(orgId, {
    desde: rango.desde,
    hasta: rango.hasta,
    canalId,
    estado,
    limite,
    offset,
  }).map((c) => ({
    id: c.id,
    canal: nombres.get(c.canal_id) ?? "—",
    cliente_nombre: c.cliente_nombre,
    cliente_phone: c.cliente_phone,
    estado: c.cerrado_por,
    senal_de_cierre: c.senal_de_cierre,
    producto_vendido: c.producto_vendido,
    producto_anuncio: c.producto_anuncio,
    total: c.total,
    envio: c.envio,
    motivo_perdida: c.motivo_perdida,
    intervencion_humana: c.intervencion_humana === 1,
    analizada: c.analizada_at !== null,
    fecha_inicio: c.fecha_inicio,
    fecha_cierre: c.fecha_cierre,
    last_message_at: c.last_message_at,
  }));

  return NextResponse.json({ conversaciones, limite, offset });
}
