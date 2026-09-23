import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { EXT_POR_MIME, MAX_BYTES, guardar, urlServida } from "@/lib/media";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIMES_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * POST /api/catalogo/foto — la foto que la dueña arrastra a mano, cuando el
 * producto no tiene link de tienda o la foto importada no es la que quiere.
 *
 * Se guarda igual que la foto de un mensaje (ver `media.ts`): en el volumen,
 * detrás de `/api/media/`, nunca por una URL pública. `fotoUrl` en el
 * catálogo puede entonces ser una URL externa (la del link) o esta ruta local
 * — el panel las pinta igual, con un <img>.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }

  if (!MIMES_PERMITIDOS.has(archivo.type)) {
    return NextResponse.json({ error: "Solo se aceptan imágenes (JPG, PNG, WEBP o GIF)" }, { status: 400 });
  }
  if (archivo.size === 0 || archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "La imagen pesa demasiado (máximo 4 MB)" }, { status: 400 });
  }

  const datos = Buffer.from(await archivo.arrayBuffer());
  const clave = guardar(s.ctx.orgId, `producto-${randomUUID()}`, "imagen", datos, EXT_POR_MIME[archivo.type]);
  if (!clave) return NextResponse.json({ error: "No se pudo guardar la imagen" }, { status: 400 });

  return NextResponse.json({ fotoUrl: urlServida(clave) });
}
