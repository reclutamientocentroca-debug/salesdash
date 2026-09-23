import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ErrorImportacion, importarProductoDeLink } from "@/lib/importar-producto";
import { ErrorIA } from "@/lib/ia";
import { limitar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Cuerpo = z.object({ url: z.string().trim().url().max(2000) });

/**
 * POST /api/catalogo/importar — lee el link de un producto de la propia
 * tienda y devuelve nombre, precio, variantes (colores y sus tallas) y la
 * foto, listos para el formulario de «Agregar producto». No guarda nada.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const cupo = limitar(`importar-producto:${s.ctx.orgId}`, 20, 3600);
  if (!cupo.ok) {
    return NextResponse.json({ error: "Ya probaste varios links esta hora. Espera un poco." }, { status: 429 });
  }

  const datos = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Pon un link válido." }, { status: 400 });

  try {
    const resultado = await importarProductoDeLink(s.ctx.orgId, datos.data.url);
    return NextResponse.json(resultado);
  } catch (e) {
    if (e instanceof ErrorImportacion) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof ErrorIA) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error("importar-producto:", e);
    return NextResponse.json({ error: "No se pudo leer ese link." }, { status: 500 });
  }
}
