import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AGENTE_DE_LA_CUENTA, copiarGuionATodos, obtenerCanal } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entrada = z.object({
  /** De qué número se copia. 0 es la plantilla de la cuenta. */
  desde: z.number().int().min(0),
});

/**
 * POST /api/agente/copiar — lleva el guion de un número a todos los demás.
 *
 * Cada canal tiene su agente porque cada país vende distinto, pero las reglas
 * del NEGOCIO son las mismas en los tres: la política de cambios, cómo se
 * cierra un pedido, qué no se promete. Sin esto había que pegarlas a mano en
 * cada número, y a la tercera vez alguien se olvida y un país empieza a
 * contestar distinto que los otros dos.
 *
 * Solo viajan las instrucciones. El país, los precios y el modelo se quedan
 * donde están: son justo lo que hace distinto a cada canal.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const datos = Entrada.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: "Falta el número de origen." }, { status: 400 });
  }

  const { desde } = datos.data;

  // Un canal de otra cuenta no existe para esta.
  if (desde !== AGENTE_DE_LA_CUENTA && !obtenerCanal(orgId, desde)) {
    return NextResponse.json({ error: "Ese número no es tuyo." }, { status: 404 });
  }

  const alcanzados = copiarGuionATodos(orgId, desde);

  return NextResponse.json({ ok: true, alcanzados });
}
