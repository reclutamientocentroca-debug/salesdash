import { NextResponse } from "next/server";
import { obtenerCampana } from "@/lib/db";
import { ErrorDifusion, pausarCampana } from "@/lib/difusion";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede pausar una campaña." }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!obtenerCampana(s.ctx.orgId, id)) return NextResponse.json({ error: "Esa campaña no existe." }, { status: 404 });

  try {
    pausarCampana(s.ctx.orgId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ErrorDifusion ? e.message : "No se pudo pausar." }, { status: 400 });
  }
}
