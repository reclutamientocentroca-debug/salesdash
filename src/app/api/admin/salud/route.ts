import { NextResponse } from "next/server";
import { expirarSoportes, saludTecnica } from "@/lib/admin-db";
import { superadminApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;

  // Buen momento para cerrar las sesiones de soporte vencidas: expiran solas.
  expirarSoportes(s.ctx);

  return NextResponse.json(saludTecnica(s.ctx));
}
