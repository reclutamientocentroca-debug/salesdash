import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generarVariaciones } from "@/lib/difusion";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Las variaciones se generan ANTES de crear la campaña, contra el texto
 * suelto que está escribiendo la dueña: así las aprueba (o las edita) en el
 * formulario, y solo entonces se guardan, junto con todo lo demás, al crear
 * la campaña. No hace falta que la campaña exista todavía.
 */
const Entrada = z.object({
  mensajeBase: z.string().trim().min(1, "Escribe el mensaje primero").max(1000),
  cantidad: z.number().int().min(1).max(8).optional(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Entrada.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  const variaciones = await generarVariaciones(s.ctx.orgId, datos.data.mensajeBase, datos.data.cantidad ?? 5);
  return NextResponse.json({ variaciones });
}
