/**
 * Sacar a alguien del equipo. Solo el dueño, y nunca al dueño mismo —
 * `eliminarMiembro` ya lo impide por `rol = 'miembro'` en el propio `WHERE`—.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eliminarMiembro } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json(
      { error: "Solo el dueño de la cuenta puede sacar gente del equipo." },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!eliminarMiembro(s.ctx.orgId, Number(id))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
