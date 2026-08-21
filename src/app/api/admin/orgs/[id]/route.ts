import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fichaOrg, suspenderOrg } from "@/lib/admin-db";
import { superadminApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const ficha = fichaOrg(s.ctx, Number(id));
  if (!ficha) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  return NextResponse.json(ficha);
}

const Accion = z.object({
  accion: z.enum(["suspender", "reactivar"]),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const orgId = Number(id);
  if (!Number.isInteger(orgId)) return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });

  const datos = Accion.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });

  switch (datos.data.accion) {
    case "suspender":
      suspenderOrg(s.ctx, orgId, true);
      return NextResponse.json({ ok: true, suspendida: true });

    case "reactivar":
      suspenderOrg(s.ctx, orgId, false);
      return NextResponse.json({ ok: true, suspendida: false });
  }
}
