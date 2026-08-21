import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actualizarCanal, eliminarCanal, obtenerCanal } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";
import { conectar, desconectar, instantanea } from "@/lib/wa";

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

  actualizarCanal(s.ctx.orgId, canal.id, {
    nombre: datos.data.nombre,
    agente_activo: datos.data.agente_activo === undefined ? undefined : datos.data.agente_activo ? 1 : 0,
    activo: datos.data.activo === undefined ? undefined : datos.data.activo ? 1 : 0,
  });

  // Apagar un número cierra su sesión; volver a encenderlo la reabre.
  if (datos.data.activo === false) void desconectar(canal.id, false);
  if (datos.data.activo === true) void conectar(canal.id);

  return NextResponse.json({ ok: true });
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
 */
const Accion = z.object({ accion: z.enum(["reconectar"]) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const datos = Accion.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });

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

  eliminarCanal(s.ctx.orgId, canal.id);
  return NextResponse.json({ ok: true });
}
