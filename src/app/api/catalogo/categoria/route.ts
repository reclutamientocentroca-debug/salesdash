import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ErrorImportacion, listarProductosDeCategoria } from "@/lib/importar-producto";
import { limitar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Cuerpo = z.object({ url: z.string().trim().url().max(2000) });

/**
 * POST /api/catalogo/categoria — lee el link de un LISTADO de la tienda
 * (una categoría, o el catálogo completo) y devuelve cada producto que
 * enseña: nombre, precio, foto y su propio link. No guarda nada: el panel
 * decide cuáles mandar al catálogo.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const cupo = limitar(`importar-categoria:${s.ctx.orgId}`, 20, 3600);
  if (!cupo.ok) {
    return NextResponse.json({ error: "Ya probaste varios links esta hora. Espera un poco." }, { status: 429 });
  }

  const datos = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Pon un link válido." }, { status: 400 });

  try {
    const productos = await listarProductosDeCategoria(datos.data.url);
    if (!productos.length) {
      return NextResponse.json({ error: "No se encontraron productos en esa página." }, { status: 422 });
    }
    return NextResponse.json({ productos });
  } catch (e) {
    if (e instanceof ErrorImportacion) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("importar-categoria:", e);
    return NextResponse.json({ error: "No se pudo leer esa página." }, { status: 500 });
  }
}
