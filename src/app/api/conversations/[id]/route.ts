import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  devolverALaIa,
  eliminarConversacion,
  fijarProductoDeLaFoto,
  getConversation,
  listarCanales,
  listarMensajes,
  ponerAtiende,
  resolverRevision,
} from "@/lib/db";
import { fichaDeLaFoto } from "@/lib/meta/contexto-anuncio";
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
  const mensajes = listarMensajes(orgId, conv.id);

  return NextResponse.json({
    conversacion: {
      ...conv,
      canal: canal?.nombre ?? "—",
      datos_faltantes: leerLista(conv.datos_faltantes),
    },
    foto: fichaDeLaFoto(orgId, conv, mensajes),
    mensajes: mensajes.map((m) => ({
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

const ProductoDeLaFoto = z.object({
  nombre: z.string().trim().min(2, "Escribe cómo se llama lo que sale en la foto").max(120),
  monto: z.number().positive("El monto tiene que ser mayor que cero"),
});

/**
 * PUT — la casilla del hilo: qué es y cuánto vale lo que sale en la foto.
 *
 * La dueña (2026-09-08): cuando el agente transfiere porque no sabe qué le
 * están enseñando, la persona que entra escribe el nombre y el monto AHÍ, sin
 * salir del chat. Va al catálogo y se pega al anuncio, así que sirve para este
 * cliente y para todos los que lleguen después por el mismo anuncio.
 *
 * Quién sigue contestando NO se decide aquí: guardar el dato y devolverle el
 * hilo a la IA son dos cosas distintas, y la segunda tiene su propio botón.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const conv = getConversation(orgId, Number(id));
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const datos = ProductoDeLaFoto.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  /*
   * DÓNDE QUEDA PEGADO LO QUE ACABAN DE ESCRIBIR: lo decide la MISMA ficha que
   * la pantalla usó para enseñar la casilla, no lo que mande el navegador. Si
   * el cliente enseñó otra cosa a mitad del chat, eso es suyo y no del
   * anuncio, que lo comparten cientos de clientes.
   */
  const ficha = fichaDeLaFoto(orgId, conv, listarMensajes(orgId, conv.id));

  const productoId = fijarProductoDeLaFoto(orgId, {
    adId: conv.meta_ad_id ?? null,
    conversationId: conv.id,
    destino: ficha?.destino ?? "chat",
    nombre: datos.data.nombre,
    precio: datos.data.monto,
  });

  return NextResponse.json({
    ok: true,
    productoId,
    nombre: datos.data.nombre.trim(),
    precio: datos.data.monto,
    /* Para que la pantalla lo diga con las palabras justas: pegado al anuncio
       vale para todos los que lleguen por él; en el chat, solo para este. */
    destino: ficha?.destino ?? "chat",
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

/**
 * DELETE — el botón «Borrar conversación» del hilo.
 *
 * Se borra el hilo entero con lo que cuelga de él, y solo si es de esta
 * cuenta: `eliminarConversacion` comprueba el `org_id` dentro de la misma
 * transacción, así que un identificador ajeno devuelve 404 y no toca nada.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const numero = Number(id);
  if (!Number.isInteger(numero)) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  if (!eliminarConversacion(orgId, numero)) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
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
  const { porQueCalla, atenderConversacion, porQueNoContesto } = await import("@/lib/agent");
  const estado = porQueCalla(orgId, conv.canal_id, conv.id);
  let noContesto: string | null = null;

  /*
   * Y AL DEVOLVERLE EL HILO, CONTESTA YA. La dueña (2026-09-05): «si le
   * devuelvo la atención debe de responder». Si lo último que hay en el hilo
   * es del cliente y nadie se lo contestó, el agente lo atiende ahora mismo,
   * sin esperar a que el cliente vuelva a escribir. Si lo último es del
   * equipo, no hay nada pendiente y `atenderConversacion` no hace nada.
   */
  if (datos.data.accion === "devolver_a_la_ia" && !estado.callado) {
    /*
     * Y SE ESPERA UN POCO A VER QUÉ PASA, para poder contarlo.
     *
     * La dueña (2026-09-10): «al devolverle la atención a la IA no está
     * respondiendo». El intento puede acabar sin escribir nada —no había nada
     * pendiente, el modelo no contestó— y esto se disparaba de espaldas: el
     * panel decía «listo» y en el chat no pasaba nada.
     *
     * Con tope: si tarda más que la espera, se contesta igual y el intento
     * sigue su camino. Un botón que se queda pensando medio minuto es un botón
     * que nadie vuelve a pulsar, y lo que de verdad no puede pasar es que el
     * cliente se quede sin respuesta por esperar a la pantalla.
     */
    const intento = atenderConversacion(orgId, conv.canal_id, conv.id).catch((e) => {
      console.error(`El agente falló al retomar la conversación ${conv.id}:`, e);
      return null;
    });
    const aTiempo = await Promise.race([
      intento,
      new Promise<undefined>((listo) => setTimeout(listo, 9_000)),
    ]);
    if (aTiempo) noContesto = porQueNoContesto(aTiempo);
  }

  return NextResponse.json({ ok: true, cerradas, agente: estado, noContesto });
}
