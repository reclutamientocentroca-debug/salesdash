import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ahora,
  buscarUsuarioPorEmail,
  contarVerificacionesDesde,
  crearVerificacion,
  obtenerOrg,
} from "@/lib/db";
import {
  generarCodigo,
  hashCodigo,
  ipDe,
  limitar,
  MAX_REENVIOS_HORA,
  verificarPassword,
  VIGENCIA_CODIGO,
} from "@/lib/auth";
import { enviarCodigoVerificacion } from "@/lib/mail";
import { abrirSesion } from "@/lib/tenant";

export const runtime = "nodejs";

const Entrada = z.object({
  email: z.email().max(160),
  password: z.string().min(1).max(200),
});

/** Un solo texto para correo inexistente y contraseña equivocada. */
const CREDENCIALES = "Correo o contraseña incorrectos.";

export async function POST(req: NextRequest) {
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

  // Sin verificar no se entra: se manda un código nuevo y a la pantalla de
  // verificación, que es donde el usuario puede resolverlo.
  if (!usuario.verificado) {
    if (contarVerificacionesDesde(usuario.id, ahora() - 3600) <= MAX_REENVIOS_HORA) {
      const codigo = generarCodigo();
      crearVerificacion(usuario.id, hashCodigo(codigo), ahora() + VIGENCIA_CODIGO);
      try {
        await enviarCodigoVerificacion(usuario.email, usuario.nombre, codigo);
      } catch (e) {
        console.error("No se pudo enviar el código al entrar:", e);
      }
    }
    return NextResponse.json({ verificar: true, email: usuario.email });
  }

  const org = obtenerOrg(usuario.org_id);
  if (!org || org.suspendida) {
    return NextResponse.json(
      { error: "Esta cuenta está suspendida. Escríbenos para reactivarla." },
      { status: 403 },
    );
  }

  await abrirSesion({
    userId: usuario.id,
    orgId: usuario.org_id,
    superadmin: usuario.superadmin === 1,
  });

  return NextResponse.json({ ok: true, superadmin: usuario.superadmin === 1 });
}
