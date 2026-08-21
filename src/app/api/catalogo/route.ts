import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actualizarProducto, crearProducto, eliminarProducto, listarCatalogo } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  return NextResponse.json({ productos: listarCatalogo(s.ctx.orgId) });
}

const Nuevo = z.object({
  nombre: z.string().trim().min(1, "Ponle nombre al producto").max(120),
  variantes: z.string().trim().max(300).nullable().optional(),
  precio: z.number().nonnegative().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Nuevo.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  const id = crearProducto(s.ctx.orgId, {
    nombre: datos.data.nombre,
    variantes: datos.data.variantes ?? null,
    precio: datos.data.precio ?? null,
  });

  return NextResponse.json({ id });
}

const Cambio = z.object({
  id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(120).optional(),
  variantes: z.string().trim().max(300).nullable().optional(),
  precio: z.number().nonnegative().nullable().optional(),
  activo: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Cambio.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Revisa los datos" }, { status: 400 });

  const { id, activo, ...resto } = datos.data;
  actualizarProducto(s.ctx.orgId, id, {
    ...resto,
    activo: activo === undefined ? undefined : activo ? 1 : 0,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });

  eliminarProducto(s.ctx.orgId, id);
  return NextResponse.json({ ok: true });
}
