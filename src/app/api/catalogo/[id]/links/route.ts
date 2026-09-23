import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agregarLinkProducto, eliminarLinkProducto, listarLinksProducto, productoPorId } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Los links de la tienda de un producto (puede haber varios: en Roplis, a
 * veces cada color de un mismo artículo es una ficha separada). Ver
 * `importar-producto.ts`.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const productoId = Number((await params).id);
  const producto = productoPorId(s.ctx.orgId, productoId);
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  return NextResponse.json({ links: listarLinksProducto(s.ctx.orgId, productoId) });
}

const Nuevo = z.object({ url: z.string().trim().url().max(2000) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const productoId = Number((await params).id);
  const producto = productoPorId(s.ctx.orgId, productoId);
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const datos = Nuevo.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Pon un link válido." }, { status: 400 });

  const id = agregarLinkProducto(s.ctx.orgId, productoId, datos.data.url);
  return NextResponse.json({ id });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const productoId = Number((await params).id);
  const producto = productoPorId(s.ctx.orgId, productoId);
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Link inválido" }, { status: 400 });

  // De ESTE producto: sin esto, un id de otro producto de la misma cuenta también se borraría.
  const esSuyo = listarLinksProducto(s.ctx.orgId, productoId).some((l) => l.id === id);
  if (!esSuyo) return NextResponse.json({ error: "Link no encontrado" }, { status: 404 });

  eliminarLinkProducto(s.ctx.orgId, id);
  return NextResponse.json({ ok: true });
}
