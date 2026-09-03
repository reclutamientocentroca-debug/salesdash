import { NextResponse } from "next/server";
import { limitar } from "@/lib/auth";
import { supervisarCuenta, ultimaPasada } from "@/lib/supervisor";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/supervisor — la última vuelta del supervisor, tal cual la contó.
 *
 * Es de todas las cuentas a la vez —el supervisor corre para todas— y solo
 * trae conteos: ni una conversación, ni un nombre, ni un importe.
 */
export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  return NextResponse.json({ ultima: ultimaPasada() });
}

/**
 * POST /api/supervisor — una vuelta ahora, solo para esta cuenta.
 *
 * Para no esperar a la siguiente marca del reloj después de un cambio. Va con
 * cupo porque analiza con modelo.
 */
export async function POST() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cupo = limitar(`supervisor:${orgId}`, 6, 3600);
  if (!cupo.ok) {
    return NextResponse.json({ error: "El supervisor ya corrió varias veces esta hora." }, { status: 429 });
  }

  try {
    return NextResponse.json(await supervisarCuenta(orgId));
  } catch {
    return NextResponse.json({ error: "La vuelta del supervisor falló." }, { status: 500 });
  }
}
