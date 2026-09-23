import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  actualizarProducto, agregarLinkProducto, canalPorPaisDeLink, crearProducto, eliminarProducto, listarCatalogo, obtenerCanal,
} from "@/lib/db";
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
  /** De qué número es. 0 —o nada— es de toda la cuenta. Ver `listarCatalogo`. */
  canalId: z.number().int().nonnegative().optional(),
  /** La foto de referencia, siempre traída del link de la tienda. Ver `importar-producto.ts`. */
  fotoUrl: z.string().trim().url().max(2000).nullable().optional(),
  /** La descripción de la página del link, para enseñarla junto a la foto en el catálogo. */
  descripcion: z.string().trim().max(600).nullable().optional(),
  /**
   * El link a la página de este producto, cuando viene del listado de una
   * categoría (ver `/api/catalogo/categoria`). Se guarda de una vez como link
   * del producto —igual que si se hubiera puesto a mano en «Links»— para que
   * después baste un clic en «Buscar pendientes» para traerle sus colores y
   * tallas, sin tener que volver a pegar la URL.
   */
  linkUrl: z.string().trim().url().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Nuevo.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  /*
   * DE QUÉ NÚMERO ES, sin preguntar, cuando se puede saber solo: si no se
   * eligió uno a mano y el producto trae el link de una tienda por país
   * (do./cr./pa.roplis.com), y hay UN único número de ese país, es ese. Ver
   * `canalPorPaisDeLink`. Sin eso —o con más de un número por país—, se
   * queda en «toda la cuenta», como siempre.
   */
  const canalId =
    datos.data.canalId || (datos.data.linkUrl ? canalPorPaisDeLink(s.ctx.orgId, datos.data.linkUrl) ?? 0 : 0);

  const id = crearProducto(s.ctx.orgId, {
    nombre: datos.data.nombre,
    variantes: datos.data.variantes ?? null,
    precio: datos.data.precio ?? null,
    canalId: deLaCuenta(s.ctx.orgId, canalId),
    fotoUrl: datos.data.fotoUrl ?? null,
    descripcion: datos.data.descripcion ?? null,
  });

  if (datos.data.linkUrl) agregarLinkProducto(s.ctx.orgId, id, datos.data.linkUrl);

  return NextResponse.json({ id });
}

const Cambio = z.object({
  id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(120).optional(),
  variantes: z.string().trim().max(300).nullable().optional(),
  precio: z.number().nonnegative().nullable().optional(),
  activo: z.boolean().optional(),
  canalId: z.number().int().nonnegative().optional(),
  fotoUrl: z.string().trim().url().max(2000).nullable().optional(),
  descripcion: z.string().trim().max(600).nullable().optional(),
});

/**
 * El número tiene que ser de ESTA cuenta.
 *
 * Sin comprobarlo, un `canalId` escrito a mano en la petición colgaría un
 * producto del número de otra organización. Lo que no sea suyo —o el 0— se
 * queda en «de toda la cuenta», que es lo de siempre.
 */
function deLaCuenta(orgId: number, canalId: number | undefined): number {
  if (!canalId) return 0;
  return obtenerCanal(orgId, canalId) ? canalId : 0;
}

export async function PATCH(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Cambio.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Revisa los datos" }, { status: 400 });

  const { id, activo, canalId, fotoUrl, ...resto } = datos.data;
  actualizarProducto(s.ctx.orgId, id, {
    ...resto,
    activo: activo === undefined ? undefined : activo ? 1 : 0,
    canal_id: canalId === undefined ? undefined : deLaCuenta(s.ctx.orgId, canalId),
    foto_url: fotoUrl,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });

  try {
    eliminarProducto(s.ctx.orgId, id);
  } catch (e) {
    console.error("eliminarProducto:", e);
    return NextResponse.json({ error: "No se pudo quitar el producto. Vuelve a intentarlo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
