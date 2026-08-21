import { NextResponse } from "next/server";
import { obtenerCanal } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";
import { conectar, instantanea } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/canales/[id]/estado — lo que sondea la pantalla del QR cada 2 s.
 *
 * Sigue siendo el único sondeo del sistema, y solo mientras esa pantalla está
 * abierta. Pero ahora es mucho más barato: no llama a nadie por red, solo lee el
 * estado del socket que este mismo proceso mantiene abierto.
 *
 * Tampoco queda nada que configurar al conectar. Antes había que guardar el
 * número y apuntar el webhook, y ese segundo paso podía fallar y dejar el canal
 * conectado pero mudo. Con el socket no hay webhook: si está conectado, recibe.
 * El número lo guarda `wa.ts` en cuanto WhatsApp lo confirma.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canalId = Number(id);
  const canal = obtenerCanal(s.ctx.orgId, canalId);
  if (!canal) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Si el proceso se reinició, la sesión no existe en memoria aunque el canal
  // siga conectado en disco: abrirla aquí la recupera sin pedir QR.
  let vista = instantanea(canalId);
  if (vista.estado === "desconectado" && canal.activo === 1) {
    vista = await conectar(canalId);
  }

  return NextResponse.json({
    estado: vista.estado,
    phone: vista.phone ?? (canal.phone.startsWith("pendiente:") ? null : canal.phone),
    nombre: canal.nombre,
    detalle: vista.detalle,
  });
}
