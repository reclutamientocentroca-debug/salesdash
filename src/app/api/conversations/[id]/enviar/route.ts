/**
 * Enviar un mensaje a mano desde la bandeja.
 *
 * La ruta no envía nada por su cuenta: se lo pide a `agent.ts`, que es el único
 * módulo del proyecto autorizado a escribirle a un cliente. Hay una prueba que
 * barre `src/` y falla si cualquier otro archivo importa el envío, y esta ruta
 * no es una excepción a esa regla: es la razón por la que la regla se sostiene
 * aunque ahora también escriban personas.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getConversation } from "@/lib/db";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/*
 * El tope no es capricho: Messenger corta por encima de 2000 caracteres y
 * WhatsApp bastante más arriba. Cortarlo aquí da un error que se entiende, en
 * vez de un mensaje que sale mutilado sin que nadie se entere.
 */
const Mensaje = z.object({
  texto: z.string().trim().min(1, "Escribe algo antes de enviar").max(1800, "El mensaje es demasiado largo"),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const conv = getConversation(orgId, Number(id));
  if (!conv || !puedeAtenderCanal(s.ctx, conv.canal_id)) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  const cuerpo = Mensaje.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json(
      { error: cuerpo.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const { enviarAMano } = await import("@/lib/agent");
  const r = await enviarAMano(orgId, conv.id, cuerpo.data.texto);

  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}
