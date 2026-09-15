import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buscarUsuarioPorEmail, obtenerOrg } from "@/lib/db";
import { ipDe, limitar, olvidarLimite, problemaDelSecreto, verificarPassword } from "@/lib/auth";
import { abrirSesion } from "@/lib/tenant";

export const runtime = "nodejs";

const Entrada = z.object({
  email: z.email().max(160),
  password: z.string().min(1).max(200),
});

/** Un solo texto para correo inexistente y contraseña equivocada. */
const CREDENCIALES = "Correo o contraseña incorrectos.";

export async function POST(req: NextRequest) {
  /*
   * Sin SESSION_SECRET no hay cookie que firmar, así que NADIE puede entrar.
   * Se comprueba lo primero: así el fallo se cuenta en vez de salir como un
   * 500 sin cuerpo, que es lo que la pantalla acababa llamando «revisa tu
   * internet». La contraseña ni se mira — no hace falta para saber esto, y así
   * tampoco se gasta cupo del limitador.
   */
  const secretoRoto = problemaDelSecreto();
  if (secretoRoto) {
    console.error(`[login] no se puede firmar la sesión: ${secretoRoto}`);
    return NextResponse.json(
      {
        error:
          `El servidor no está bien configurado y no puede abrir sesiones (${secretoRoto}). ` +
          "No es tu contraseña ni tu conexión: quien administre el panel tiene que poner esa " +
          "variable y volver a desplegar. En /api/salud sale el mismo aviso.",
      },
      { status: 503 },
    );
  }

  const cuerpo = await req.json().catch(() => null);
  const datos = Entrada.safeParse(cuerpo);
  if (!datos.success) return NextResponse.json({ error: CREDENCIALES }, { status: 400 });

  const correo = datos.data.email.toLowerCase();

  // Dos límites: por IP, contra el que prueba muchas cuentas; y por correo,
  // contra el que prueba muchas contraseñas de una sola cuenta.
  const porIp = limitar(`login-ip:${ipDe(req)}`, 20, 900);
  const porCorreo = limitar(`login-mail:${correo}`, 6, 900);
  if (!porIp.ok || !porCorreo.ok) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera unos minutos antes de volver a probar." },
      { status: 429 },
    );
  }

  const usuario = buscarUsuarioPorEmail(correo);
  if (!usuario) return NextResponse.json({ error: CREDENCIALES }, { status: 401 });

  if (!(await verificarPassword(usuario.password_hash, datos.data.password))) {
    return NextResponse.json({ error: CREDENCIALES }, { status: 401 });
  }

  /*
   * La contraseña era correcta: se le devuelve el cupo a este correo.
   *
   * Sin esto, el límite cuenta también los aciertos y basta con entrar seis
   * veces en quince minutos —probando algo, desde el móvil y el ordenador, tras
   * cerrar sesión— para quedarse fuera con un «demasiados intentos» que además
   * no es cierto. El límite por IP no se toca: ese sí protege de quien barre
   * muchas cuentas distintas.
   */
  olvidarLimite(`login-mail:${correo}`);

  const org = obtenerOrg(usuario.org_id);
  if (!org || org.suspendida) {
    return NextResponse.json(
      { error: "Esta cuenta está suspendida. Escríbenos para reactivarla." },
      { status: 403 },
    );
  }

  // La contraseña era buena: lo que falle de aquí en adelante es del servidor,
  // y se dice como tal en vez de salir como un 500 sin cuerpo.
  try {
    await abrirSesion({
      userId: usuario.id,
      orgId: usuario.org_id,
      superadmin: usuario.superadmin === 1,
    });
  } catch (e) {
    console.error("[login] contraseña correcta pero no se pudo abrir la sesión", e);
    return NextResponse.json(
      {
        error:
          "Tu contraseña es correcta, pero el servidor no pudo abrirte la sesión. No es tu " +
          "conexión: hay que mirar el panel.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, superadmin: usuario.superadmin === 1 });
}
