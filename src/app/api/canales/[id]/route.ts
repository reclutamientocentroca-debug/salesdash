import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actualizarCanal, eliminarCanal, obtenerCanal } from "@/lib/db";
import { descifrar, enmascarar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";
import {
  apuntarWebhook,
  armarUrlWebhook,
  eliminarCanalWhapi,
  ErrorWhapi,
  mensajeDeError,
} from "@/lib/whapi";

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

  return NextResponse.json({
    id: canal.id,
    nombre: canal.nombre,
    phone: canal.phone.startsWith("pendiente:") ? null : canal.phone,
    estado: canal.estado,
    agente_activo: canal.agente_activo === 1,
    activo: canal.activo === 1,
    ultimo_evento_at: canal.ultimo_evento_at,
    created_at: canal.created_at,
    // El token va enmascarado también aquí. Revelarlo es una acción aparte.
    token_enmascarado: enmascarar(leerToken(canal.token_cifrado)),
    url_webhook: armarUrlWebhook(canal.id, canal.webhook_secret),
  });
}

function leerToken(blob: string): string {
  try {
    return descifrar(blob);
  } catch {
    return "";
  }
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

  return NextResponse.json({ ok: true });
}

/**
 * Acciones puntuales sobre el canal. Van por POST y no por GET para que el
 * token revelado no acabe en la barra del navegador ni en los registros del
 * servidor, donde las URL sí se guardan.
 */
const Accion = z.object({ accion: z.enum(["revelar", "reintentar_webhook"]) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const datos = Accion.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });

  if (datos.data.accion === "revelar") {
    const token = leerToken(canal.token_cifrado);
    if (!token) {
      return NextResponse.json(
        { error: "El token guardado no se puede leer. Conecta el número de nuevo." },
        { status: 409 },
      );
    }
    return NextResponse.json({ token });
  }

  // reintentar_webhook
  try {
    await apuntarWebhook(leerToken(canal.token_cifrado), armarUrlWebhook(canal.id, canal.webhook_secret));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const detalle = e instanceof ErrorWhapi ? mensajeDeError(e) : "No pudimos configurar la recepción.";
    return NextResponse.json({ error: detalle }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Primero en Whapi: si el canal se borra aquí y allá sigue vivo, se sigue
  // cobrando por un número que el usuario cree haber quitado.
  if (canal.whapi_channel_id) {
    try {
      await eliminarCanalWhapi(canal.whapi_channel_id);
    } catch (e) {
      // Si allá ya no existe (404), se sigue adelante y se limpia aquí.
      if (!(e instanceof ErrorWhapi && e.status === 404)) {
        const detalle = e instanceof ErrorWhapi ? mensajeDeError(e) : "No pudimos desconectar el número.";
        return NextResponse.json({ error: detalle }, { status: 502 });
      }
    }
  }

  eliminarCanal(s.ctx.orgId, canal.id);
  return NextResponse.json({ ok: true });
}
