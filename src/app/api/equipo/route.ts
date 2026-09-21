/**
 * Meter a alguien del equipo DENTRO de esta cuenta.
 *
 * Es la puerta que le faltaba al reparto por canal: sin esto, «miembro» era
 * un rol que la tabla admitía y que nadie podía crear —todo el que se
 * registraba abría su PROPIA cuenta, nunca se unía a otra—. Aquí no hay
 * correo de por medio, a propósito: el dueño escribe la contraseña él mismo y
 * se la pasa por fuera del panel, el mismo espíritu que ya tiene
 * `/api/auth/registro`. Solo el dueño puede hacerlo.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buscarUsuarioPorEmail, crearMiembro } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Entrada = z.object({
  nombre: z.string().trim().min(2, "Escribe su nombre").max(80),
  email: z.email("Revisa el correo, no parece válido").max(160),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres").max(200),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json(
      { error: "Solo el dueño de la cuenta puede meter gente al equipo." },
      { status: 403 },
    );
  }

  const datos = Entrada.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json(
      { error: datos.error.issues[0]?.message ?? "Revisa los datos" },
      { status: 400 },
    );
  }

  const correo = datos.data.email.toLowerCase();

  // Único en TODA la plataforma, no solo en esta cuenta: es como ya se
  // comprueba en el registro, y aquí hace falta la misma pregunta.
  if (buscarUsuarioPorEmail(correo)) {
    return NextResponse.json(
      { error: "Ese correo ya tiene una cuenta en la plataforma." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(datos.data.password);
  const userId = crearMiembro(s.ctx.orgId, {
    nombre: datos.data.nombre,
    email: correo,
    passwordHash,
  });

  return NextResponse.json({ ok: true, userId });
}
