import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actualizarOrg, listarMiembros, obtenerOrg } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const org = obtenerOrg(s.ctx.orgId)!;
  return NextResponse.json({
    org: {
      nombre: org.nombre,
      color: org.color,
      meta_cobertura: org.meta_cobertura,
      meta_efectividad: org.meta_efectividad,
      marcador_cierre: org.marcador_cierre,
      modelo_analisis: org.modelo_analisis,
      modelo_vision: org.modelo_vision,
      modelo_audio: org.modelo_audio,
    },
    miembros: listarMiembros(s.ctx.orgId).map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
    })),
    yo: { id: s.ctx.userId, rol: s.ctx.usuario.rol, superadmin: s.ctx.superadmin },
  });
}

const Cambio = z.object({
  nombre: z.string().trim().min(2).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "El color va en formato #rrggbb").optional(),
  meta_cobertura: z.number().int().min(0).max(100).optional(),
  meta_efectividad: z.number().int().min(0).max(100).optional(),
  marcador_cierre: z.string().trim().min(1, "El marcador no puede estar vacío").max(60).optional(),
  modelo_analisis: z.string().trim().min(3).max(120).optional(),
  modelo_vision: z.string().trim().min(3).max(120).optional(),
  modelo_audio: z.string().trim().min(3).max(120).optional(),
});

export async function PATCH(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Cambio.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  actualizarOrg(s.ctx.orgId, datos.data);
  return NextResponse.json({ ok: true });
}
