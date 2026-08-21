import { NextResponse } from "next/server";
import { sesionApi } from "@/lib/tenant";
import { leer } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ clave: string[] }>;
}

/**
 * GET /api/media/<orgId>/<archivo> — una foto o una nota de voz.
 *
 * Los archivos NO son públicos y esta es la única puerta. La organización sale
 * de la sesión, no de la URL: aunque alguien ponga el identificador de otra
 * cuenta en la ruta, `leer` compara contra el de su sesión y devuelve nada.
 *
 * Responde 404 y no 403 cuando el archivo no es suyo. Un 403 confirmaría que
 * ese archivo existe, que es justo lo que no hay que confirmarle a quien está
 * probando rutas ajenas.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { clave } = await params;
  const archivo = leer(s.ctx.orgId, clave.join("/"));

  if (!archivo) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  return new NextResponse(new Uint8Array(archivo.datos), {
    headers: {
      "content-type": archivo.mime,
      "content-length": String(archivo.datos.length),
      // Privado: es contenido de un cliente. Que lo guarde el navegador de
      // quien lo pidió, nunca un intermediario.
      "cache-control": "private, max-age=86400",
      "content-disposition": "inline",
    },
  });
}
