import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { crearAnuncioManual, eliminarAnuncioManual, listarAnunciosManuales, obtenerCanal } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  return NextResponse.json({ anuncios: listarAnunciosManuales(s.ctx.orgId) });
}

const Nuevo = z.object({
  nombre: z.string().trim().min(1, "Ponle un nombre al anuncio").max(120),
  descripcion: z.string().trim().min(8, "Pega la descripción del anuncio, tal como le llega al cliente").max(2000),
  canalId: z.number().int().nonnegative().optional(),
  imagenClave: z.string().trim().max(300).nullable().optional(),
  sinEnvio: z.boolean(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Nuevo.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  // Un número que no es de esta cuenta se queda en «todos los números».
  const canalId = datos.data.canalId && obtenerCanal(s.ctx.orgId, datos.data.canalId) ? datos.data.canalId : 0;
  // La imagen tiene que haberse subido a esta misma cuenta (clave «local:<org>/archivo»).
  const clave = datos.data.imagenClave?.startsWith(`local:${s.ctx.orgId}/`) ? datos.data.imagenClave : null;

  const id = crearAnuncioManual(s.ctx.orgId, {
    canalId, nombre: datos.data.nombre, descripcion: datos.data.descripcion,
    imagenClave: clave, sinEnvio: datos.data.sinEnvio,
  });
  return NextResponse.json({ id });
}

export async function DELETE(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Falta el anuncio" }, { status: 400 });
  eliminarAnuncioManual(s.ctx.orgId, id);
  return NextResponse.json({ ok: true });
}
