import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ahora,
  buscarUsuarioPorEmail,
  contarVerificacionesDesde,
  crearVerificacion,
} from "@/lib/db";
import {
  generarCodigo,
  hashCodigo,
  ipDe,
  limitar,
  MAX_REENVIOS_HORA,
  VIGENCIA_CODIGO,
} from "@/lib/auth";
import { enviarCodigoVerificacion } from "@/lib/mail";

export const runtime = "nodejs";

const Entrada = z.object({ email: z.email().max(160) });

export async function POST(req: NextRequest) {
  const limite = limitar(`reenviar-ip:${ipDe(req)}`, 10, 3600);
  if (!limite.ok) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Espera un rato." }, { status: 429 });
  }

  const cuerpo = await req.json().catch(() => null);
  const datos = Entrada.safeParse(cuerpo);
  if (!datos.success) return NextResponse.json({ error: "Revisa el correo" }, { status: 400 });

  const usuario = buscarUsuarioPorEmail(datos.data.email);

  // Sin usuario o ya verificado se responde ok igual: este endpoint tampoco
  // puede servir para averiguar qué correos existen.
  if (usuario && !usuario.verificado) {
    // El código del registro también cuenta, así que el tope es 1 + 3.
    const emitidos = contarVerificacionesDesde(usuario.id, ahora() - 3600);
    if (emitidos > MAX_REENVIOS_HORA) {
      return NextResponse.json(
        { error: "Ya pediste varios códigos. Espera una hora antes de pedir otro." },
        { status: 429 },
      );
    }

    const codigo = generarCodigo();
    // crearVerificacion invalida los códigos anteriores del usuario.
    crearVerificacion(usuario.id, hashCodigo(codigo), ahora() + VIGENCIA_CODIGO);

    try {
      await enviarCodigoVerificacion(usuario.email, usuario.nombre, codigo);
    } catch (e) {
      console.error("No se pudo reenviar el código:", e);
      return NextResponse.json(
        { error: "No pudimos enviar el correo. Intenta de nuevo en un momento." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
