import { NextResponse } from "next/server";
import { listarExcluidos } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quién dijo «SALIR»: cualquiera del equipo lo puede ver, es solo lectura. */
export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  return NextResponse.json({ excluidos: listarExcluidos(s.ctx.orgId) });
}
