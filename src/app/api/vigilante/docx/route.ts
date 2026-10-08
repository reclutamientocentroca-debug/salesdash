import { NextResponse, type NextRequest } from "next/server";
import { limitar } from "@/lib/auth";
import { textoDeDocx } from "@/lib/docx";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/vigilante/docx — saca el texto de un .docx para pegarlo en la guía.
 *
 * NO guarda nada: devuelve el texto y la pantalla lo pone en el campo, donde la
 * dueña lo revisa antes de guardar. El archivo no se escribe en disco.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const cupo = limitar(`vigilante-docx:${s.ctx.orgId}`, 30, 3600);
  if (!cupo.ok) return NextResponse.json({ error: "Demasiadas subidas seguidas. Espera unos minutos." }, { status: 429 });

  const forma = await req.formData().catch(() => null);
  const archivo = forma?.get("archivo");
  if (!(archivo instanceof File)) return NextResponse.json({ error: "Elige un archivo .docx" }, { status: 400 });
  if (!/\.docx$/i.test(archivo.name)) {
    return NextResponse.json({ error: "Solo se admiten archivos .docx de Word" }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) return NextResponse.json({ error: "El archivo pesa más de 5 MB" }, { status: 413 });

  try {
    const texto = textoDeDocx(Buffer.from(await archivo.arrayBuffer()));
    if (!texto) return NextResponse.json({ error: "El documento no tiene texto" }, { status: 422 });
    return NextResponse.json({ texto });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "No se pudo leer el archivo" }, { status: 422 });
  }
}
