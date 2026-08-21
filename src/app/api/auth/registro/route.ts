import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buscarUsuarioPorEmail, crearOrgConDueno } from "@/lib/db";
import { hashPassword, ipDe, limitar } from "@/lib/auth";
import { abrirSesion } from "@/lib/tenant";

export const runtime = "nodejs";

/** Paleta de acentos. Se asigna una al registrarse; se cambia en Configuración. */
const PALETA = ["#12876a", "#0e7490", "#4f46e5", "#7c3aed", "#b45309", "#9f1239"];

const Entrada = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre").max(80),
  negocio: z.string().trim().min(2, "Escribe el nombre de tu negocio").max(80),
  email: z.email("Revisa el correo, no parece válido").max(160),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres").max(200),
});

export async function POST(req: NextRequest) {
  const limite = limitar(`registro:${ipDe(req)}`, 5, 3600);
  if (!limite.ok) {
    return NextResponse.json(
      { error: "Demasiados registros desde esta conexión. Intenta de nuevo en una hora." },
      { status: 429 },
    );
  }

  const cuerpo = await req.json().catch(() => null);
  const datos = Entrada.safeParse(cuerpo);
  if (!datos.success) {
    return NextResponse.json(
      { error: datos.error.issues[0]?.message ?? "Revisa los datos" },
      { status: 400 },
    );
  }

  const { nombre, negocio, email, password } = datos.data;
  const correo = email.toLowerCase();

  // Antes esto callaba cuando el correo ya existía, para no convertir el
  // endpoint en un detector de cuentas. Con el registro directo eso deja de ser
  // posible: la respuesta o abre sesión o no, y eso ya distingue los dos casos.
  // Puestos a filtrar, mejor decirlo claro y que la persona sepa que su sitio
  // es el login.
  if (buscarUsuarioPorEmail(correo)) {
    return NextResponse.json(
      { error: "Ese correo ya tiene una cuenta. Entra con tu contraseña." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const color = PALETA[Math.floor(Math.random() * PALETA.length)]!;

  const { orgId, userId } = crearOrgConDueno({
    negocio,
    color,
    nombre,
    email: correo,
    passwordHash,
  });

  // Sin código y sin correo de por medio: se entra en el acto.
  await abrirSesion({ userId, orgId, superadmin: false });

  return NextResponse.json({ ok: true });
}
