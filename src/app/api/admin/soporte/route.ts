import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { correoDelDueno, listarSoporte, solicitarSoporte } from "@/lib/admin-db";
import { enviarSolicitudSoporte } from "@/lib/mail";
import { obtenerOrg } from "@/lib/db";
import { superadminApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;
  return NextResponse.json({ accesos: listarSoporte(s.ctx) });
}

const Solicitud = z.object({
  orgId: z.number().int().positive(),
  motivo: z.string().trim().min(10, "Explica para qué necesitas entrar").max(500),
});

/**
 * POST /api/admin/soporte — pide acceso a una cuenta.
 *
 * No concede nada. Crea la solicitud en estado `solicitado` y avisa al dueño
 * por correo. Solo él puede aprobarla, desde su propio panel, y el acceso
 * expira solo a los 60 minutos.
 *
 * Nunca hay un acceso silencioso: el cliente siempre sabe quién entró y por qué.
 */
export async function POST(req: NextRequest) {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;

  const datos = Solicitud.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json(
      { error: datos.error.issues[0]?.message ?? "Revisa los datos" },
      { status: 400 },
    );
  }

  const org = obtenerOrg(datos.data.orgId);
  if (!org) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const id = solicitarSoporte(s.ctx, datos.data.orgId, datos.data.motivo);
  const dueno = correoDelDueno(s.ctx, datos.data.orgId);

  if (dueno) {
    try {
      await enviarSolicitudSoporte(dueno.email, {
        nombreNegocio: org.nombre,
        motivo: datos.data.motivo,
      });
    } catch (e) {
      console.error("No se pudo avisar al dueño de la solicitud de soporte:", e);
      return NextResponse.json(
        { id, aviso: "La solicitud quedó registrada, pero el correo al dueño no salió." },
        { status: 202 },
      );
    }
  }

  return NextResponse.json({ id, ok: true });
}
