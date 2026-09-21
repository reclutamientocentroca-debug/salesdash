import { NextResponse } from "next/server";
import { obtenerCanal } from "@/lib/db";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";
import { conectar, instantanea } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/canales/[id]/qr — el código para vincular el número.
 *
 * El QR no se pide: lo emite WhatsApp por el socket cuando le parece, y esta
 * ruta solo devuelve el último que llegó. Por eso `conectar` es lo primero —
 * si el proceso se reinició y la sesión no está abierta, abrirla aquí es lo que
 * hace que el código aparezca unos segundos después.
 *
 * Mientras no haya código todavía se responde `iniciando`, y la pantalla
 * mantiene el mensaje de espera en vez de enseñar un error.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canalId = Number(id);
  const canal = obtenerCanal(s.ctx.orgId, canalId);
  if (!canal || !puedeAtenderCanal(s.ctx, canal.id)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  let vista = instantanea(canalId);
  if (vista.estado === "desconectado" || (vista.estado === "esperando" && !vista.qr)) {
    vista = await conectar(canalId);
  }

  // La pantalla espera `imagen` como data URL. Si aún no hay código, el estado
  // se degrada a `iniciando`: hay sesión en marcha, pero nada que enseñar.
  return NextResponse.json({
    estado: vista.estado === "esperando" && !vista.qr ? "iniciando" : vista.estado,
    imagen: vista.qr,
    detalle: vista.detalle,
  });
}
