import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buscarUsuarioPorEmail, crearOrgConDueno } from "@/lib/db";
import { hashPassword, ipDe, limitar, problemaDelSecreto } from "@/lib/auth";
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

  /*
   * ── ¿SE PUEDE ABRIR SESIÓN? SE PREGUNTA ANTES DE CREAR NADA ─────────────
   *
   * La sesión se firma con SESSION_SECRET. Si falta, la firma revienta — y
   * reventaba DESPUÉS de haber creado la organización y el usuario. El
   * resultado era el peor de los posibles: la cuenta quedaba hecha, sin
   * sesión, y el navegador recibía un 500 sin cuerpo que la pantalla traducía
   * a «no hay conexión con el servidor, revisa tu internet». Al reintentar
   * salía «ese correo ya tiene una cuenta», y entrar tampoco funcionaba,
   * porque el login necesita ese mismo secreto. Cuenta creada, dueña fuera, y
   * los tres mensajes apuntando al sitio equivocado.
   *
   * Preguntarlo primero no arregla el despliegue, pero dice qué arreglar y no
   * deja nada a medias.
   */
  const secretoRoto = problemaDelSecreto();
  if (secretoRoto) {
    console.error(`[registro] no se puede firmar la sesión: ${secretoRoto}`);
    return NextResponse.json(
      {
        error:
          `El servidor no está bien configurado y no puede abrir sesiones (${secretoRoto}). ` +
          "No es tu conexión ni tus datos, y no se ha creado ninguna cuenta. Quien administre " +
          "el panel tiene que poner esa variable y volver a desplegar; en /api/salud sale el mismo aviso.",
      },
      { status: 503 },
    );
  }

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

  const color = PALETA[Math.floor(Math.random() * PALETA.length)]!;

  /*
   * Cifrar la contraseña y guardar la cuenta. Lo que falla aquí es del
   * servidor —argon2 sin compilar, el disco lleno, el volumen de solo
   * lectura—, y hasta ahora salía como un 500 sin cuerpo. Un JSON con la
   * explicación es lo que separa «el panel está roto» de «revisa tu internet».
   */
  let cuenta: { orgId: number; userId: number };
  try {
    const passwordHash = await hashPassword(password);
    cuenta = crearOrgConDueno({ negocio, color, nombre, email: correo, passwordHash });
  } catch (e) {
    console.error("[registro] no se pudo crear la cuenta", e);
    return NextResponse.json(
      {
        error:
          "No pudimos crear la cuenta: el servidor no consiguió guardarla. No es tu conexión. " +
          "Vuelve a intentarlo en un minuto y, si sigue igual, hay que mirar el servidor.",
      },
      { status: 500 },
    );
  }

  /*
   * Sin código y sin correo de por medio: se entra en el acto.
   *
   * Si aun así la cookie no se puede poner, la cuenta YA EXISTE. Decirlo es lo
   * único que evita el callejón sin salida de volver al formulario y toparse
   * con «ese correo ya tiene una cuenta» sin entender por qué.
   */
  try {
    await abrirSesion({ userId: cuenta.userId, orgId: cuenta.orgId, superadmin: false });
  } catch (e) {
    console.error("[registro] la cuenta quedó creada pero no se pudo abrir la sesión", e);
    return NextResponse.json(
      {
        creada: true,
        error:
          "Tu cuenta quedó creada, pero el servidor no pudo abrirte la sesión. Entra desde la " +
          "pantalla de acceso con ese mismo correo y contraseña.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
