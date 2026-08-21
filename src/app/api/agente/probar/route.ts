import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { probarAgente } from "@/lib/agent";
import { ErrorIA } from "@/lib/ia";
import { limitar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entrada = z.object({
  conversacion: z
    .array(
      z.object({
        rol: z.enum(["cliente", "agente"]),
        texto: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * POST /api/agente/probar — genera una respuesta con la configuración real
 * y LA DEVUELVE. No la envía a nadie: no hay ningún teléfono involucrado.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cupo = limitar(`probar:${orgId}`, 40, 3600);
  if (!cupo.ok) {
    return NextResponse.json({ error: "Muchas pruebas seguidas. Espera unos minutos." }, { status: 429 });
  }

  const datos = Entrada.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Escribe un mensaje" }, { status: 400 });

  try {
    const r = await probarAgente(orgId, datos.data.conversacion);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ErrorIA) {
      return NextResponse.json(
        {
          error: e.esLimite
            ? "El modelo agotó su límite. Prueba con otro o configura uno de respaldo."
            : e.message,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: "No pudimos generar la respuesta." }, { status: 500 });
  }
}
