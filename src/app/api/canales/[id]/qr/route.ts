import { NextResponse } from "next/server";
import { obtenerCanal } from "@/lib/db";
import { descifrar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";
import { ErrorWhapi, mensajeDeError, obtenerQr } from "@/lib/whapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/canales/[id]/qr — el código para vincular el número.
 *
 * Whapi avisa que inicializar un canal recién creado puede tardar hasta
 * minuto y medio: mientras tanto responde `iniciando` y la pantalla mantiene
 * el mensaje de espera en vez de mostrar un error.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  try {
    const qr = await obtenerQr(descifrar(canal.token_cifrado));
    return NextResponse.json(qr);
  } catch (e) {
    if (e instanceof ErrorWhapi) {
      return NextResponse.json({ estado: "error", detalle: mensajeDeError(e) }, { status: 200 });
    }
    console.error("QR del canal:", e);
    return NextResponse.json({ estado: "error", detalle: "No pudimos generar el código." }, { status: 200 });
  }
}
