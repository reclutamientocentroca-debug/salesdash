import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { partirEnMensajes, probarAgente } from "@/lib/agent";
import { ErrorIA } from "@/lib/ia";
import { limitar } from "@/lib/auth";
import { AGENTE_DE_LA_CUENTA, obtenerCanal, obtenerOrg } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entrada = z.object({
  /* Qué agente se prueba. Cada canal tiene el suyo —su país, su guion, su
     modelo— y probar «el agente» a secas no diría nada de ninguno. Ausente o 0
     es la plantilla de la cuenta. */
  canal: z.number().int().min(0).optional(),
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
 *
 * Devuelve además `mensajes`: la respuesta ya partida como le va a llegar al
 * cliente. En la apertura de un hilo el saludo sale en su propio mensaje y la
 * respuesta detrás, y una prueba que lo enseñara todo en un globo estaría
 * enseñando algo que no pasa. Ver `partirEnMensajes`.
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
    const canalId = datos.data.canal ?? AGENTE_DE_LA_CUENTA;
    // Un canal de otra cuenta no existe para esta: cae en la plantilla.
    const suyo = canalId > 0 && obtenerCanal(orgId, canalId) ? canalId : AGENTE_DE_LA_CUENTA;

    const r = await probarAgente(orgId, suyo, datos.data.conversacion);
    const mensajes = partirEnMensajes(r.texto, {
      saludoAparte: datos.data.conversacion.every((m) => m.rol === "cliente"),
      marcador: obtenerOrg(orgId)?.marcador_cierre ?? undefined,
    });

    return NextResponse.json({ ...r, mensajes });
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
