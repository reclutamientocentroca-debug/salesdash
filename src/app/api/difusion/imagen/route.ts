import { NextResponse, type NextRequest } from "next/server";
import { guardar } from "@/lib/media";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sube la imagen de una campaña ANTES de crearla —mismo espíritu que
 * `/api/difusion/variaciones`—: devuelve la clave para guardarla junto con
 * el resto de la campaña.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const forma = await req.formData().catch(() => null);
  const archivo = forma?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Adjunta una imagen." }, { status: 400 });
  }
  if (!archivo.type.startsWith("image/")) {
    return NextResponse.json({ error: "Eso no es una imagen." }, { status: 400 });
  }

  const bytes = Buffer.from(await archivo.arrayBuffer());
  const idImagen = `difusion:${s.ctx.orgId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const ext = archivo.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const clave = guardar(s.ctx.orgId, idImagen, "imagen", bytes, ext);

  if (!clave) return NextResponse.json({ error: "No se pudo guardar la imagen." }, { status: 400 });
  return NextResponse.json({ clave });
}
