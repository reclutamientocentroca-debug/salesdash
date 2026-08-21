import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ahora, listarSoporteAccesos, responderSoporte } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Una sesión de soporte dura una hora y se cierra sola. */
const DURACION = 60 * 60;

/**
 * El lado del DUEÑO de la cuenta. Aquí ve quién pidió entrar, por qué, y
 * decide. El historial completo es visible para él, no solo para la
 * plataforma: nunca hay un acceso silencioso.
 */
export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  return NextResponse.json({ accesos: listarSoporteAccesos(s.ctx.orgId) });
}

const Respuesta = z.object({
  id: z.number().int().positive(),
  aprobar: z.boolean(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  // Solo el dueño decide sobre los accesos a su cuenta.
  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede responder esto." }, { status: 403 });
  }

  const datos = Respuesta.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Revisa los datos" }, { status: 400 });

  responderSoporte(s.ctx.orgId, datos.data.id, datos.data.aprobar, ahora() + DURACION);
  return NextResponse.json({ ok: true });
}
