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
      recordatorio_visto: agente.recordatorio_visto === 1,
      recordatorio_visto_horas: agente.recordatorio_visto_horas,
      recordatorio_entrega: agente.recordatorio_entrega === 1,
      recordatorio_entrega_horas: agente.recordatorio_entrega_horas,
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
  instrucciones: z.string().max(20_000).optional(),
  modelo: z.string().trim().min(3).max(120).optional(),
  modelo_respaldo: z.string().trim().max(120).nullable().optional(),
  pasar_a_humano: z.boolean().optional(),
  silenciar_si_humano: z.boolean().optional(),
  horario_activo: z.boolean().optional(),
  horario_desde: z.string().regex(HORA, "La hora va como 09:00").nullable().optional(),
  horario_hasta: z.string().regex(HORA, "La hora va como 18:00").nullable().optional(),
  /*
   * Los seguimientos. Las horas van acotadas por los dos lados: menos de una
   * hora convierte el recordatorio en una insistencia encima del cliente, y
   * mas de una semana en un mensaje que ya no viene a cuento.
   */
  recordatorio_visto: z.boolean().optional(),
  recordatorio_visto_horas: z.number().int().min(1).max(168).optional(),
  recordatorio_entrega: z.boolean().optional(),
  recordatorio_entrega_horas: z.number().int().min(1).max(168).optional(),
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
    recordatorio_visto:
      d.recordatorio_visto === undefined ? undefined : d.recordatorio_visto ? 1 : 0,
    recordatorio_visto_horas: d.recordatorio_visto_horas,
    recordatorio_entrega:
      d.recordatorio_entrega === undefined ? undefined : d.recordatorio_entrega ? 1 : 0,
    recordatorio_entrega_horas: d.recordatorio_entrega_horas,
  });

  return NextResponse.json({ ok: true });
}
