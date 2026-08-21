import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ahora,
  buscarUsuarioPorEmail,
  crearOrgConDueno,
  crearVerificacion,
} from "@/lib/db";
import {
  generarCodigo,
  hashCodigo,
  hashPassword,
  ipDe,
  limitar,
  VIGENCIA_CODIGO,
} from "@/lib/auth";
import { enviarCodigoVerificacion } from "@/lib/mail";

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

  // Si el correo ya está registrado no se crea nada y no se avisa: responder
  // distinto convertiría este endpoint en un detector de qué correos existen.
  if (!buscarUsuarioPorEmail(correo)) {
    const passwordHash = await hashPassword(password);
    const color = PALETA[Math.floor(Math.random() * PALETA.length)]!;

    const { userId } = crearOrgConDueno({ negocio, color, nombre, email: correo, passwordHash });

    const codigo = generarCodigo();
    crearVerificacion(userId, hashCodigo(codigo), ahora() + VIGENCIA_CODIGO);

    try {
      await enviarCodigoVerificacion(correo, nombre, codigo);
    } catch (e) {
      // La cuenta ya existe; el usuario puede pedir el reenvío desde la
      // pantalla siguiente. Se registra el fallo sin el código.
      console.error("No se pudo enviar el código de verificación:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
