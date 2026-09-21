import { NextResponse, type NextRequest } from "next/server";
import { llegoPorAnuncio } from "@/lib/anuncio";
import { listarCanales, listarConversaciones, type EstadoCierre } from "@/lib/db";
import { puedeAtenderCanal, rangoDesdeQuery, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ESTADOS: EstadoCierre[] = ["ia", "humano", "abierta", "revision"];

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const ctx = s.ctx;
  const { orgId } = ctx;

  const params = req.nextUrl.searchParams;
  const rango = rangoDesdeQuery(params);

  const estadoCrudo = params.get("estado");
  const estado = ESTADOS.includes(estadoCrudo as EstadoCierre) ? (estadoCrudo as EstadoCierre) : undefined;

  const canalCrudo = Number(params.get("canalId"));
  const canalId = Number.isInteger(canalCrudo) && canalCrudo > 0 ? canalCrudo : undefined;

  /*
   * EL REPARTO POR MIEMBRO, ANTES QUE NADA.
   *
   * Con un `canalId` puesto a mano en la URL, no basta con dejarlo pasar tal
   * cual: alguien restringido a un número podría escribir el id de otro en la
   * barra de direcciones. Fuera de eso, sin `canalId`, se filtra por TODOS los
   * que tiene permitidos. Las dos ramas usan la misma pregunta —`puedeAtenderCanal`—
   * para que no se puedan desincronizar.
   */
  if (canalId !== undefined && !puedeAtenderCanal(ctx, canalId)) {
    return NextResponse.json({ conversaciones: [], limite: 0, offset: 0 });
  }

  const limite = Math.min(Number(params.get("limite")) || 100, 200);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  const nombres = new Map(listarCanales(orgId, ctx.canalesPermitidos).map((c) => [c.id, c.nombre]));

  const conversaciones = listarConversaciones(orgId, {
    desde: rango.desde,
    hasta: rango.hasta,
    canalId,
    canalIds: canalId === undefined && ctx.canalesPermitidos ? ctx.canalesPermitidos : undefined,
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
    // Qué prometía el anuncio. Sin esto, quien exporta las conversaciones se
    // lleva el título del producto pero no lo que se le dijo al cliente.
    descripcion_anuncio: c.descripcion_anuncio,
    llego_por_anuncio: llegoPorAnuncio(c),
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
