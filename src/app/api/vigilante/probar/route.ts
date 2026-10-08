import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agenteDePais, bloqueDelPais } from "@/agents";
import { limitar } from "@/lib/auth";
import { obtenerAgente, obtenerCanal } from "@/lib/db";
import { configDelCanal, revisarRespuesta } from "@/lib/vigilante";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entrada = z.object({
  canal: z.number().int().min(1),
  mensajeCliente: z.string().trim().min(1).max(2000),
  respuestaAgente: z.string().trim().min(1).max(4000),
  /** Descripción y precio del producto, si se quiere probar con uno. */
  producto: z.string().trim().max(4000).optional(),
  /** Lo que hay ahora en la pantalla, aunque no se haya guardado todavía. */
  guia: z.string().max(40_000).optional(),
  reglas: z.string().max(20_000).optional(),
  prompt: z.string().max(20_000).optional(),
});

/**
 * POST /api/vigilante/probar — enseña qué diría la vigilante.
 *
 * NO envía nada a ningún cliente y NO deja registro: es una prueba. Usa la
 * configuración de ese canal, o lo que haya escrito ahora mismo en los campos.
 */
export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cupo = limitar(`vigilante-probar:${orgId}`, 40, 3600);
  if (!cupo.ok) return NextResponse.json({ error: "Muchas pruebas seguidas. Espera unos minutos." }, { status: 429 });

  const datos = Entrada.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Escribe el mensaje del cliente y la respuesta del agente" }, { status: 400 });
  const d = datos.data;

  const canal = obtenerCanal(orgId, d.canal);
  if (!canal || !puedeAtenderCanal(s.ctx, d.canal)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const agente = obtenerAgente(orgId, canal.id);
  const pais = agenteDePais(agente.pais);
  const cfg = configDelCanal(orgId, canal.id, agente.pais);

  const r = await revisarRespuesta(
    {
      conversacion: [{ quien: "CLIENTE", texto: d.mensajeCliente }],
      producto: d.producto || null,
      pais: pais ? bloqueDelPais(pais, null, canal.negocio ?? canal.nombre) : "",
      guia: d.guia ?? cfg.guia,
      reglas: d.reglas ?? cfg.reglas,
      prompt: d.prompt ?? cfg.prompt,
    },
    d.respuestaAgente,
  );

  return NextResponse.json({
    veredicto: r.veredicto,
    motivos: r.motivos,
    respuestaFinal: r.respuestaFinal,
    error: r.error ?? null,
  });
}
