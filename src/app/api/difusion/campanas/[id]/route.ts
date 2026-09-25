import { NextResponse } from "next/server";
import { estadoDeCampana } from "@/lib/difusion";
import { resumenDeCampana } from "@/lib/db";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Campaña inválida" }, { status: 400 });

  const estado = estadoDeCampana(s.ctx.orgId, id);
  if (!estado || !puedeAtenderCanal(s.ctx, estado.campana.canal_id)) {
    return NextResponse.json({ error: "Esa campaña no existe." }, { status: 404 });
  }

  return NextResponse.json({ ...estado, resultados: resumenDeCampana(s.ctx.orgId, id) });
}
