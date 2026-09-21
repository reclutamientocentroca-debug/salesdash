/**
 * El reparto de números y páginas por miembro del equipo.
 *
 * Solo lo toca el dueño: es él quien decide quién ve qué, y un miembro no
 * puede ampliarse su propio acceso pidiéndoselo directamente a esta ruta.
 * Ver la nota de `equipo_canales` en el esquema de `db.ts` y `puedeAtenderCanal`
 * en `tenant.ts`, que es donde el reparto se hace cumplir de verdad.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asignarCanalesAMiembro, canalesDeMiembro, listarCanales, obtenerUsuario } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const Cuerpo = z.object({ canalIds: z.array(z.number().int().positive()) });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json(
      { error: "Solo el dueño de la cuenta puede repartir números." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const miembro = obtenerUsuario(Number(id));
  if (!miembro || miembro.org_id !== orgId) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  // El dueño nunca se restringe a sí mismo: ver la nota en `getSession`.
  if (miembro.rol === "dueno") {
    return NextResponse.json(
      { error: "El dueño de la cuenta siempre ve todos los números." },
      { status: 400 },
    );
  }

  const datos = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: "Revisa los datos" }, { status: 400 });
  }

  // Solo canales de esta cuenta: nadie asigna un id ajeno adivinándolo.
  const validos = new Set(listarCanales(orgId).map((c) => c.id));
  const canalIds = datos.data.canalIds.filter((canalId) => validos.has(canalId));

  asignarCanalesAMiembro(orgId, miembro.id, canalIds);

  return NextResponse.json({ ok: true, canalIds: canalesDeMiembro(orgId, miembro.id) });
}
