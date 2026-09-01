import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actualizarCanal, eliminarCanal, obtenerCanal, reatribuirCanalAIa } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";
import { conectar, desconectar, instantanea, pedirHistorial } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const vista = instantanea(canal.id);

  return NextResponse.json({
    id: canal.id,
    nombre: canal.nombre,
    phone: canal.phone.startsWith("pendiente:") ? null : canal.phone,
    // El estado vivo del socket manda sobre el último guardado en la base.
    estado: vista.estado === "desconectado" ? canal.estado : vista.estado,
    agente_activo: canal.agente_activo === 1,
    contesta_ia: canal.contesta_ia === 1,
    activo: canal.activo === 1,
    ultimo_evento_at: canal.ultimo_evento_at,
    created_at: canal.created_at,
    /**
     * La credencial con la que una automatización externa avisa de que un
     * mensaje lo mandó la IA. Ya no hay webhook entrante —los mensajes llegan
     * por el socket—, pero quien envíe desde fuera sigue necesitando esto o sus
     * envíos se contarán como humanos.
     */
    url_ai_sent: `/api/ai-sent?canal=${canal.id}&s=${encodeURIComponent(canal.webhook_secret)}`,
  });
}

const Cambio = z.object({
  nombre: z.string().trim().min(2).max(60).optional(),
  agente_activo: z.boolean().optional(),
  contesta_ia: z.boolean().optional(),
  activo: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const datos = Cambio.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Revisa los datos" }, { status: 400 });

  /*
   * POR NÚMERO CONTESTA UNO SOLO. Nunca los dos.
   *
   * Un número está en uno de dos modos, y encender cualquiera de ellos apaga el
   * otro en el mismo `UPDATE`, no en dos pasos que puedan quedarse a medias:
   *
   *   - Vigilar (`contesta_ia`): contesta la IA del dueño y el panel mira.
   *   - Contestar (`agente_activo`): contesta nuestro agente.
   *
   * Que se excluyan no es lo que impide hablar a la vez —de eso se encarga la
   * guarda de `atenderConversacion`, y esa es la garantía de verdad—, es para
   * que la pantalla no mienta: dos interruptores encendidos a la vez le dejan
   * al dueño la duda de si su cliente va a recibir dos respuestas.
   */
  const vigilar = datos.data.contesta_ia === true;
  const contestarNosotros = datos.data.agente_activo === true;

  const nuestroAgente = vigilar
    ? 0
    : datos.data.agente_activo === undefined
      ? undefined
      : datos.data.agente_activo
        ? 1
        : 0;

  const suIa = contestarNosotros
    ? 0
    : datos.data.contesta_ia === undefined
      ? undefined
      : datos.data.contesta_ia
        ? 1
        : 0;

  actualizarCanal(s.ctx.orgId, canal.id, {
    nombre: datos.data.nombre,
    agente_activo: nuestroAgente,
    contesta_ia: suIa,
    activo: datos.data.activo === undefined ? undefined : datos.data.activo ? 1 : 0,
  });

  /*
   * Encender «aquí contesta una IA» no vale solo para lo que venga: lo que hace
   * falta arreglar es lo que YA está en el panel con la pastilla de «intervino»
   * y la venta acreditada al equipo. Se reatribuye el número entero y se barren
   * los resúmenes de pedido que se habían quedado sin sellar, que ahora ya
   * tienen dueño: la IA.
   *
   * Solo al encenderlo, y solo si estaba apagado. Apagarlo no deshace nada.
   */
  if (datos.data.contesta_ia === true && canal.contesta_ia !== 1) {
    const { mensajes, cierres } = reatribuirCanalAIa(s.ctx.orgId, canal.id);
    const { sellarCierresPendientes } = await import("@/lib/cierre");
    const selladas = sellarCierresPendientes(s.ctx.orgId);
    console.log(
      `[canal ${canal.id}] atendido por IA: ${mensajes} mensaje(s) reatribuidos, ` +
        `${cierres} cierre(s) pasados al lado de la IA, ${selladas} venta(s) selladas`,
    );
  }

  // Apagar un número cierra su sesión; volver a encenderlo la reabre.
  if (datos.data.activo === false) void desconectar(canal.id, false);
  if (datos.data.activo === true) void conectar(canal.id);

  /*
   * Se contesta con el estado REAL del agente en este número, no con un «ok».
   *
   * Encender el interruptor y leer «guardado» no significa que un cliente vaya
   * a recibir respuesta: puede faltar la clave del modelo, el número puede
   * estar caído, el cupo del modelo gratuito puede estar agotado. Quien acaba
   * de encenderlo tiene que enterarse EN ESE MOMENTO, y no tres días después
   * por un cliente que se fue sin que nadie le contestara.
   */
  const { revisarAgente } = await import("@/lib/agent");

  return NextResponse.json({ ok: true, agente: revisarAgente(s.ctx.orgId, canal.id) });
}

/**
 * Acciones puntuales sobre el canal.
 *
 * `revelar` y `reintentar_webhook` desaparecieron con el proveedor: ya no hay
 * token que revelar —la credencial es la vinculación del teléfono, y no es un
 * texto que se pueda copiar— ni webhook que reapuntar.
 *
 * `reconectar` es lo que las sustituye: fuerza a reabrir el socket cuando un
 * número aparece caído.
 *
 * `historial` le pide al teléfono las conversaciones anteriores a lo que ya
 * tenemos. Es para los números que llevaban tiempo conectados: los que se
 * vinculan desde ahora reciben su historial solos al escanear el QR.
 */
const Accion = z.object({ accion: z.enum(["reconectar", "historial"]) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const datos = Accion.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });

  if (datos.data.accion === "historial") {
    /*
     * La petición se contesta en cuanto está PEDIDA, no cuando llega todo: el
     * teléfono manda el historial por su cuenta, en trozos, y puede tardar
     * minutos. Dejar la pantalla esperando a eso sería colgarla.
     */
    try {
      const { pedidos, hilos } = await pedirHistorial(s.ctx.orgId, canal.id);
      return NextResponse.json({ ok: true, pedidos, hilos });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "No se pudo pedir el historial" },
        { status: 409 },
      );
    }
  }

  const vista = await conectar(canal.id);
  return NextResponse.json({ ok: true, estado: vista.estado });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  /*
   * Primero se cierra la sesión con `logout`, que desvincula el dispositivo en
   * el teléfono del usuario y borra las credenciales del disco. Si se borrara
   * solo la fila, el número seguiría apareciendo en «Dispositivos vinculados»
   * de su WhatsApp para siempre, y la carpeta de sesión quedaría huérfana.
   */
  try {
    await desconectar(canal.id, true);
  } catch (e) {
    console.error("No se pudo cerrar la sesión al eliminar el canal:", e);
  }

  /*
   * Si el borrado falla, la pantalla tiene que decirlo. Sin esto salía un 500
   * pelado: el teléfono ya se había desvinculado —eso pasa arriba y no se
   * deshace— y el número seguía en la lista sin una sola pista de por qué. Es
   * el «lo desconecté y no se quita» que llegó como avería.
   */
  try {
    eliminarCanal(s.ctx.orgId, canal.id);
  } catch (e) {
    console.error(`No se pudo eliminar el canal ${canal.id}`, e);
    return NextResponse.json(
      {
        error:
          "El número se desvinculó de WhatsApp, pero no se pudo borrar del panel. " +
          "Vuelve a intentarlo; si sigue igual, quedan datos suyos sin limpiar.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
