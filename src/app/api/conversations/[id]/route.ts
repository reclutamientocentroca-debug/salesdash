import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  devolverALaIa,
  getConversation,
  listarCanales,
  listarMensajes,
  ponerAtiende,
  resolverRevision,
} from "@/lib/db";
import { anomaliaDeCorreccion } from "@/lib/analyzer";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const conv = getConversation(orgId, Number(id));
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const canal = listarCanales(orgId).find((c) => c.id === conv.canal_id);

  return NextResponse.json({
    conversacion: {
      ...conv,
      canal: canal?.nombre ?? "—",
      datos_faltantes: leerLista(conv.datos_faltantes),
    },
    mensajes: listarMensajes(orgId, conv.id).map((m) => ({
      id: m.id,
      emisor: m.emisor,
      tipo: m.tipo,
      content: m.content,
      // De las imágenes se muestra la descripción, nunca la foto: el archivo
      // no se almacena en ningún momento.
      descripcion_imagen: m.descripcion_imagen,
      categoria_imagen: m.categoria_imagen,
      created_at: m.created_at,
    })),
  });
}

function leerLista(bruto: string | null): string[] {
  if (!bruto) return [];
  try {
    const v = JSON.parse(bruto);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [bruto];
  }
}

const Correccion = z.object({ resolver: z.enum(["ia", "humano"]) });

/**
 * PATCH — los dos botones de la bandeja de revisión: "Fue de la IA" y "Fue del
 * vendedor". Es la única corrección que rompe el sellado de la regla maestra,
 * y por eso queda registrada como anomalía para poder auditarla.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const conv = getConversation(orgId, Number(id));
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const datos = Correccion.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Indica quién cerró" }, { status: 400 });

  resolverRevision(orgId, conv.id, datos.data.resolver);
  anomaliaDeCorreccion(orgId, conv.id, datos.data.resolver);

  return NextResponse.json({ ok: true, estado: datos.data.resolver });
}

const Accion = z.object({ accion: z.enum(["devolver_a_la_ia", "atiende_humano"]) });

/**
 * POST — quién atiende esta conversación: la IA o una persona.
 *
 * Cuando un cliente pide una persona, o el propio agente pasa el caso a un
 * asesor, el agente se calla EN ESA CONVERSACIÓN y no vuelve solo: lo que lo
 * silencia es una anomalía abierta, y hasta ahora ninguna pantalla podía
 * cerrarla. El hilo se quedaba sin agente para siempre, también cuando el
 * cliente volvía días después a comprar. Esto es la vuelta atrás.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const conv = getConversation(orgId, Number(id));
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const datos = Accion.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });

  /*
   * Los dos sentidos del mismo interruptor.
   *
   * «atiende_humano» calla al agente EN ESTE HILO y solo en este: el número
   * sigue contestando a los demás clientes. «devolver_a_la_ia» lo deshace y, de
   * paso, cierra lo que lo tuviera callado —la petición de una persona, el
   * handoff del propio agente—, que es lo que no se podía deshacer desde
   * ninguna pantalla.
   */
  let cerradas = 0;

  if (datos.data.accion === "atiende_humano") {
    ponerAtiende(orgId, conv.id, "humano");
  } else {
    cerradas = devolverALaIa(orgId, conv.id);
  }

  /*
   * Se contesta con el estado REAL, no con un «ok»: puede seguir callado por
   * otra razón —el número apagado, un vendedor que acaba de escribir— y quien
   * pulsa el botón tiene que enterarse ahora, no cuando el cliente no reciba
   * respuesta.
   */
  const { porQueCalla } = await import("@/lib/agent");
  return NextResponse.json({ ok: true, cerradas, agente: porQueCalla(orgId, conv.canal_id, conv.id) });
}
