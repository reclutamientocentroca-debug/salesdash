import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { obtenerCampana } from "@/lib/db";
import { ErrorDifusion, cambiarCantidadDiaria } from "@/lib/difusion";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entrada = z.object({ cantidad: z.number().int().min(1).max(1000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede cambiar la cantidad diaria." }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!obtenerCampana(s.ctx.orgId, id)) return NextResponse.json({ error: "Esa campaña no existe." }, { status: 404 });

  const datos = Entrada.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Revisa la cantidad." }, { status: 400 });

  try {
    cambiarCantidadDiaria(s.ctx.orgId, id, datos.data.cantidad);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ErrorDifusion ? e.message : "No se pudo cambiar." }, { status: 400 });
  }
}
