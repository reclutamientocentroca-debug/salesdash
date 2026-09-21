/**
 * Descargar el informe de un número.
 *
 * Es una navegación normal del navegador —un enlace, no un `fetch`—, así que la
 * sesión viaja en la cookie como en cualquier otra página. El `Content-Disposition`
 * es lo que convierte la respuesta en un archivo guardado en vez de una pestaña
 * más: quien lo pide está a punto de desconectar el número y lo que quiere es
 * quedarse con el archivo, no mirarlo.
 */
import { NextResponse, type NextRequest } from "next/server";
import { obtenerCanal } from "@/lib/db";
import { informeDeCanal } from "@/lib/informe";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal || !puedeAtenderCanal(s.ctx, canal.id)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const { nombre, html } = informeDeCanal(s.ctx.orgId, canal);

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
      // Un informe es una foto de un instante: que no se sirva el de ayer.
      "cache-control": "no-store",
    },
  });
}
