import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actualizarAgente, listarCanales, obtenerAgente, usoDelDia } from "@/lib/db";
import { hoyISO } from "@/lib/ia";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estimación del cupo diario típico de un modelo gratuito en OpenRouter. */
const CUPO_GRATUITO_ESTIMADO = 50;

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const agente = obtenerAgente(orgId);
  const uso = usoDelDia(orgId, hoyISO()).filter((u) => u.proposito === "agente");

  const respuestasHoy = uso.reduce((n, u) => n + u.exitos, 0);
  const fallosHoy = uso.reduce((n, u) => n + u.fallos, 0);
  const esGratuito = agente.modelo.endsWith(":free");

  return NextResponse.json({
    agente: {
      nombre: agente.nombre,
      tono: agente.tono,
      instrucciones: agente.instrucciones,
      modelo: agente.modelo,
      modelo_respaldo: agente.modelo_respaldo,
      pasar_a_humano: agente.pasar_a_humano === 1,
      silenciar_si_humano: agente.silenciar_si_humano === 1,
      horario_activo: agente.horario_activo === 1,
      horario_desde: agente.horario_desde,
      horario_hasta: agente.horario_hasta,
    },
    // El agente se enciende por número, no para toda la cuenta.
    canales: listarCanales(orgId).map((c) => ({
      id: c.id,
      nombre: c.nombre,
      phone: c.phone.startsWith("pendiente:") ? null : c.phone,
      agente_activo: c.agente_activo === 1,
      contesta_ia: c.contesta_ia === 1,
      conectado: c.estado === "conectado",
    })),
    consumo: {
      respuestas_hoy: respuestasHoy,
      fallos_hoy: fallosHoy,
      modelo_gratuito: esGratuito,
      // Estimado, no exacto: OpenRouter no publica el cupo restante por clave.
      cupo_estimado: esGratuito ? CUPO_GRATUITO_ESTIMADO : null,
    },
  });
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const Cambio = z.object({
  nombre: z.string().trim().min(1).max(40).optional(),
  tono: z.enum(["cercano", "formal", "directo", "alegre"]).optional(),
  instrucciones: z.string().max(4000).optional(),
  modelo: z.string().trim().min(3).max(120).optional(),
  modelo_respaldo: z.string().trim().max(120).nullable().optional(),
  pasar_a_humano: z.boolean().optional(),
  silenciar_si_humano: z.boolean().optional(),
  horario_activo: z.boolean().optional(),
  horario_desde: z.string().regex(HORA, "La hora va como 09:00").nullable().optional(),
  horario_hasta: z.string().regex(HORA, "La hora va como 18:00").nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const datos = Cambio.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json(
      { error: datos.error.issues[0]?.message ?? "Revisa los datos" },
      { status: 400 },
    );
  }

  const d = datos.data;
  actualizarAgente(s.ctx.orgId, {
    nombre: d.nombre,
    tono: d.tono,
    instrucciones: d.instrucciones,
    modelo: d.modelo,
    // Un respaldo igual al principal no sirve de respaldo.
    modelo_respaldo: d.modelo_respaldo === "" ? null : d.modelo_respaldo,
    pasar_a_humano: d.pasar_a_humano === undefined ? undefined : d.pasar_a_humano ? 1 : 0,
    silenciar_si_humano:
      d.silenciar_si_humano === undefined ? undefined : d.silenciar_si_humano ? 1 : 0,
    horario_activo: d.horario_activo === undefined ? undefined : d.horario_activo ? 1 : 0,
    horario_desde: d.horario_desde,
    horario_hasta: d.horario_hasta,
  });

  return NextResponse.json({ ok: true });
}
