import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guardarVigilanteConfig, obtenerCanal } from "@/lib/db";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Cambio = z.object({
  /** 0 = los ajustes generales de la cuenta; otro número = un canal. */
  canal: z.number().int().min(0),
  activa: z.boolean().optional(),
  modo: z.enum(["corregir", "vigilar"]).optional(),
  /** null = volver al texto de fábrica. */
  guia: z.string().max(40_000).nullable().optional(),
  reglas: z.string().max(20_000).nullable().optional(),
  prompt: z.string().max(20_000).nullable().optional(),
});

/**
 * PUT /api/vigilante/config — guarda la configuración de la vigilante.
 *
 * El `orgId` sale de la sesión. Un canal que no es de esta cuenta, o que este
 * miembro del equipo no tiene asignado, no existe: 404, igual que cualquier
 * otra ruta de canales. Los ajustes generales (canal 0: interruptor general y
 * prompt) valen para toda la cuenta y solo los toca quien no tiene el reparto
 * de canales restringido.
 */
export async function PUT(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const datos = Cambio.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const { canal, ...cambio } = datos.data;

  if (canal === 0) {
    if (s.ctx.canalesPermitidos !== null) {
      return NextResponse.json({ error: "Solo el dueño cambia los ajustes generales." }, { status: 403 });
    }
    // En lo general solo hay interruptor y prompt: lo de cada país va por canal.
    guardarVigilanteConfig(orgId, 0, { activa: cambio.activa, prompt: cambio.prompt });
    return NextResponse.json({ ok: true });
  }

  if (!obtenerCanal(orgId, canal) || !puedeAtenderCanal(s.ctx, canal)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  guardarVigilanteConfig(orgId, canal, {
    activa: cambio.activa,
    modo: cambio.modo,
    guia: cambio.guia,
    reglas: cambio.reglas,
  });
  return NextResponse.json({ ok: true });
}
