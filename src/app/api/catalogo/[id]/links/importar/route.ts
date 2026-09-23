import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { productoPorId } from "@/lib/db";
import { importarLinksDeProducto } from "@/lib/importar-producto";
import { limitar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Ctx {
  params: Promise<{ id: string }>;
}

const Cuerpo = z.object({ forzar: z.boolean().optional() });

/**
 * POST /api/catalogo/[id]/links/importar — abre los links de este producto
 * con un navegador de verdad, actualiza Variantes y la foto, y guarda el
 * resultado en cada link para no repetirlo la próxima vez.
 *
 * `forzar: true` (el botón «Actualizar» del panel) repite TODOS los links,
 * aunque ya se hubieran importado antes —para cuando cambia el stock—. Sin
 * eso, solo abre los que todavía están pendientes: es la misma memoria que
 * usa el aviso automático cuando llega un lead por un anuncio.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const productoId = Number((await params).id);
  const producto = productoPorId(s.ctx.orgId, productoId);
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const cupo = limitar(`importar-links:${s.ctx.orgId}`, 20, 3600);
  if (!cupo.ok) {
    return NextResponse.json({ error: "Ya se importó varias veces esta hora. Espera un poco." }, { status: 429 });
  }

  const datos = Cuerpo.safeParse(await req.json().catch(() => ({}))).data ?? {};

  try {
    const resultado = await importarLinksDeProducto(s.ctx.orgId, productoId, !datos.forzar);
    return NextResponse.json(resultado);
  } catch (e) {
    console.error("importar-links:", e);
    return NextResponse.json({ error: "No se pudieron importar los links de este producto." }, { status: 500 });
  }
}
