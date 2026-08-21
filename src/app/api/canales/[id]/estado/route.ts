import { NextResponse } from "next/server";
import { actualizarCanal, obtenerCanal } from "@/lib/db";
import { descifrar } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";
import { apuntarWebhook, armarUrlWebhook, ErrorWhapi, estadoCanal, mensajeDeError } from "@/lib/whapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/canales/[id]/estado — lo que sondea la pantalla del QR cada 2 s.
 *
 * Es el único sondeo del sistema, y solo mientras esa pantalla está abierta.
 * Al detectar la conexión hace, en el mismo paso, las dos cosas que faltaban:
 * guardar el número vinculado y apuntar el webhook al panel.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  let token: string;
  try {
    token = descifrar(canal.token_cifrado);
  } catch {
    return NextResponse.json(
      { estado: "error", detalle: "El token guardado no se puede leer. Conecta el número de nuevo." },
      { status: 200 },
    );
  }

  try {
    const salud = await estadoCanal(token);

    // Nada cambió: se responde y ya.
    if (salud.estado !== "conectado") {
      if (canal.estado !== salud.estado) actualizarCanal(s.ctx.orgId, canal.id, { estado: salud.estado });
      return NextResponse.json({ estado: salud.estado, detalle: salud.crudo });
    }

    // ── Se acaba de conectar ────────────────────────────────────────────────
    const yaEstaba = canal.estado === "conectado" && !canal.phone.startsWith("pendiente:");

    if (!yaEstaba) {
      try {
        actualizarCanal(s.ctx.orgId, canal.id, {
          estado: "conectado",
          phone: salud.phone ?? canal.phone,
          nombre: canal.nombre,
        });
      } catch (e) {
        // UNIQUE(org_id, phone): ese número ya está en otro canal de la cuenta.
        if (e instanceof Error && e.message.includes("UNIQUE")) {
          return NextResponse.json({
            estado: "error",
            detalle: "Ese número ya está conectado en otro de tus canales.",
          });
        }
        throw e;
      }

      // El webhook se apunta solo. Si esto falla, el canal queda conectado
      // pero mudo, así que el fallo se dice, no se traga.
      try {
        await apuntarWebhook(token, armarUrlWebhook(canal.id, canal.webhook_secret));
      } catch (e) {
        console.error("No se pudo apuntar el webhook:", e);
        return NextResponse.json({
          estado: "conectado",
          phone: salud.phone,
          nombre: salud.nombre,
          aviso:
            "El número quedó vinculado, pero no pudimos configurar la recepción de mensajes. " +
            "Entra al número y pulsa «Reintentar configuración».",
        });
      }
    }

    return NextResponse.json({ estado: "conectado", phone: salud.phone, nombre: salud.nombre });
  } catch (e) {
    if (e instanceof ErrorWhapi) {
      return NextResponse.json({ estado: "error", detalle: mensajeDeError(e) });
    }
    console.error("Estado del canal:", e);
    return NextResponse.json({ estado: "error", detalle: "No pudimos consultar el estado." });
  }
}
