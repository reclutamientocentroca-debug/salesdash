import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  AGENTE_DE_LA_CUENTA,
  actualizarAgente,
  listarCanales,
  obtenerAgente,
  obtenerCanal,
  usoDelDia,
  type Agente,
} from "@/lib/db";
import { hoyISO } from "@/lib/ia";
import { PAISES } from "@/lib/paises";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estimación del cupo diario típico de un modelo gratuito en OpenRouter. */
const CUPO_GRATUITO_ESTIMADO = 50;

/**
 * De qué canal se habla.
 *
 * `0` es la plantilla de la cuenta: la que se copia al conectar un número nuevo
 * y la única que existe cuando todavía no hay ninguno. Un identificador de un
 * canal que no es de esta organización cae aquí y se convierte en la plantilla,
 * no en el agente de otra cuenta.
 */
function canalPedido(orgId: number, valor: string | null): number {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) return AGENTE_DE_LA_CUENTA;
  return obtenerCanal(orgId, id) ? id : AGENTE_DE_LA_CUENTA;
}

/** El agente, escrito como lo lee el panel. */
function paraElPanel(a: Agente) {
  return {
    canal_id: a.canal_id,
    nombre: a.nombre,
    tono: a.tono,
    instrucciones: a.instrucciones,
    pais: a.pais,
    conocimiento: a.conocimiento,
    usar_catalogo: a.usar_catalogo === 1,
    ver_imagenes: a.ver_imagenes === 1,
    oir_audios: a.oir_audios === 1,
    validar_mapa: a.validar_mapa === 1,
    modelo: a.modelo,
    modelo_respaldo: a.modelo_respaldo,
    modelo_vision: a.modelo_vision,
    modelo_audio: a.modelo_audio,
    negocio: a.negocio,
    envio_cerca: a.envio_cerca,
    envio_lejos: a.envio_lejos,
    pasar_a_humano: a.pasar_a_humano === 1,
    silenciar_si_humano: a.silenciar_si_humano === 1,
    retardo_seg: a.retardo_seg,
    horario_activo: a.horario_activo === 1,
    horario_desde: a.horario_desde,
    horario_hasta: a.horario_hasta,
    recordatorio_visto: a.recordatorio_visto === 1,
    recordatorio_visto_horas: a.recordatorio_visto_horas,
    recordatorio_entrega: a.recordatorio_entrega === 1,
    recordatorio_entrega_horas: a.recordatorio_entrega_horas,
  };
}

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const canalId = canalPedido(orgId, req.nextUrl.searchParams.get("canal"));
  const agente = obtenerAgente(orgId, canalId);

  const uso = usoDelDia(orgId, hoyISO()).filter((u) => u.proposito === "agente");
  const respuestasHoy = uso.reduce((n, u) => n + u.exitos, 0);
  const fallosHoy = uso.reduce((n, u) => n + u.fallos, 0);
  const esGratuito = agente.modelo.endsWith(":free");

  return NextResponse.json({
    agente: paraElPanel(agente),
    // Los países que el panel sabe atender, para el selector del canal.
    paises: PAISES.map((p) => ({
      codigo: p.codigo,
      nombre: p.nombre,
      bandera: p.bandera,
      moneda: `${p.moneda.simbolo} ${p.moneda.codigo}`,
    })),
    // El agente se enciende por número, no para toda la cuenta.
    canales: listarCanales(orgId).map((c) => ({
      id: c.id,
      nombre: c.nombre,
      phone: c.phone.startsWith("pendiente:") ? null : c.phone,
      agente_activo: c.agente_activo === 1,
      contesta_ia: c.contesta_ia === 1,
      conectado: c.estado === "conectado",
      pais: obtenerAgente(orgId, c.id).pais,
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
const CODIGOS_PAIS = PAISES.map((p) => p.codigo);

const Cambio = z.object({
  /** El canal cuyo agente se cambia. Ausente o 0 = la plantilla de la cuenta. */
  canal: z.number().int().min(0).optional(),
  nombre: z.string().trim().min(1).max(40).optional(),
  tono: z.enum(["cercano", "formal", "directo", "alegre"]).optional(),
  instrucciones: z.string().max(20_000).optional(),
  /*
   * El país sale de una lista cerrada: es la clave con la que se busca el
   * paquete de `paises.ts`, y un código inventado dejaría al canal sin moneda,
   * sin forma de dar direcciones y sin caja con la que validar un mapa. Cadena
   * vacía es «ninguno», que es un estado válido.
   */
  pais: z.enum(["", ...CODIGOS_PAIS] as [string, ...string[]]).optional(),
  conocimiento: z.string().max(20_000).optional(),
  usar_catalogo: z.boolean().optional(),
  ver_imagenes: z.boolean().optional(),
  oir_audios: z.boolean().optional(),
  validar_mapa: z.boolean().optional(),
  modelo: z.string().trim().min(3).max(120).optional(),
  modelo_respaldo: z.string().trim().max(120).nullable().optional(),
  modelo_vision: z.string().trim().max(120).nullable().optional(),
  modelo_audio: z.string().trim().max(120).nullable().optional(),
  /* Con qué nombre saluda. Vacío = el del perfil de WhatsApp de ese número. */
  negocio: z.string().trim().max(80).optional(),
  /*
   * Las tarifas de envío. Nulo es un valor con significado —«no lo he
   * cargado»— y es lo que hace que el agente tenga prohibido decir un costo,
   * así que se acepta explícitamente en vez de tratarlo como «sin cambio».
   */
  envio_cerca: z.number().min(0).max(1_000_000).nullable().optional(),
  envio_lejos: z.number().min(0).max(1_000_000).nullable().optional(),
  pasar_a_humano: z.boolean().optional(),
  silenciar_si_humano: z.boolean().optional(),
  /*
   * El retardo con el que contesta. Hasta un minuto: más que eso ya no es
   * naturalidad, es un cliente esperando. Y el 0 tiene que seguir siendo
   * posible —hay negocios que quieren la respuesta al instante—.
   */
  retardo_seg: z.number().int().min(0).max(60).optional(),
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

/** Un booleano del panel a la columna INTEGER, dejando pasar el «sin cambio». */
const bit = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);

export async function PATCH(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const datos = Cambio.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json(
      { error: datos.error.issues[0]?.message ?? "Revisa los datos" },
      { status: 400 },
    );
  }

  const d = datos.data;
  const canalId = canalPedido(orgId, d.canal === undefined ? null : String(d.canal));

  actualizarAgente(
    orgId,
    {
      nombre: d.nombre,
      tono: d.tono,
      instrucciones: d.instrucciones,
      pais: d.pais,
      conocimiento: d.conocimiento,
      usar_catalogo: bit(d.usar_catalogo),
      ver_imagenes: bit(d.ver_imagenes),
      oir_audios: bit(d.oir_audios),
      validar_mapa: bit(d.validar_mapa),
      modelo: d.modelo,
      // Un respaldo igual al principal no sirve de respaldo.
      modelo_respaldo: d.modelo_respaldo === "" ? null : d.modelo_respaldo,
      // Vacío = el modelo de la cuenta, que es lo que dice el panel.
      modelo_vision: d.modelo_vision === "" ? null : d.modelo_vision,
      modelo_audio: d.modelo_audio === "" ? null : d.modelo_audio,
      negocio: d.negocio,
      envio_cerca: d.envio_cerca,
      envio_lejos: d.envio_lejos,
      pasar_a_humano: bit(d.pasar_a_humano),
      silenciar_si_humano: bit(d.silenciar_si_humano),
      retardo_seg: d.retardo_seg,
      horario_activo: bit(d.horario_activo),
      horario_desde: d.horario_desde,
      horario_hasta: d.horario_hasta,
      recordatorio_visto: bit(d.recordatorio_visto),
      recordatorio_visto_horas: d.recordatorio_visto_horas,
      recordatorio_entrega: bit(d.recordatorio_entrega),
      recordatorio_entrega_horas: d.recordatorio_entrega_horas,
    },
    canalId,
  );

  // Se devuelve lo guardado y no un `ok` a secas: el panel pinta el agente del
  // canal que acaba de tocar, y así no tiene que volver a pedirlo.
  return NextResponse.json({ ok: true, agente: paraElPanel(obtenerAgente(orgId, canalId)) });
}
