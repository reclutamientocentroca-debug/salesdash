import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ahora,
  buscarUsuarioPorEmail,
  invalidarVerificacion,
  marcarVerificado,
  sumarIntento,
  verificacionVigente,
} from "@/lib/db";
import { comparar, hashCodigo, ipDe, limitar, MAX_INTENTOS } from "@/lib/auth";
import { abrirSesion } from "@/lib/tenant";

export const runtime = "nodejs";

const Entrada = z.object({
  email: z.email().max(160),
  codigo: z.string().trim().regex(/^\d{6}$/, "El código son 6 dígitos"),
});

/** Mismo texto para todos los fallos: no se filtra en qué punto falló. */
const INCORRECTO = "El código no es correcto o ya venció. Pide uno nuevo si hace falta.";

export async function POST(req: NextRequest) {
  const limite = limitar(`verificar:${ipDe(req)}`, 20, 900);
  if (!limite.ok) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera unos minutos." },
      { status: 429 },
    );
  }

  const cuerpo = await req.json().catch(() => null);
  const datos = Entrada.safeParse(cuerpo);
  if (!datos.success) {
    return NextResponse.json(
      { error: datos.error.issues[0]?.message ?? "Revisa el código" },
      { status: 400 },
    );
  }

  const usuario = buscarUsuarioPorEmail(datos.data.email);
  if (!usuario) return NextResponse.json({ error: INCORRECTO }, { status: 400 });

  if (usuario.verificado) {
    // Ya estaba verificado: no hay nada que hacer, pero tampoco tiene sentido
    // dejarlo fuera. Se le abre sesión.
    await abrirSesion({ userId: usuario.id, orgId: usuario.org_id, superadmin: usuario.superadmin === 1 });
    return NextResponse.json({ ok: true });
  }

  const verificacion = verificacionVigente(usuario.id);
  if (!verificacion) return NextResponse.json({ error: INCORRECTO }, { status: 400 });

  if (verificacion.expira_at <= ahora()) {
    invalidarVerificacion(verificacion.id);
    return NextResponse.json({ error: INCORRECTO, expirado: true }, { status: 400 });
  }

  if (verificacion.intentos >= MAX_INTENTOS) {
    invalidarVerificacion(verificacion.id);
    return NextResponse.json(
      { error: "Agotaste los intentos de este código. Pide uno nuevo.", expirado: true },
      { status: 400 },
    );
  }

  if (!comparar(verificacion.codigo_hash, hashCodigo(datos.data.codigo))) {
    sumarIntento(verificacion.id);
    const restantes = MAX_INTENTOS - (verificacion.intentos + 1);
    return NextResponse.json(
      {
        error: INCORRECTO,
        // Al sexto intento el código muere; conviene que el usuario lo sepa.
        restantes: restantes > 0 ? restantes : 0,
        expirado: restantes <= 0,
      },
      { status: 400 },
    );
  }

  invalidarVerificacion(verificacion.id);
  marcarVerificado(usuario.id);
  await abrirSesion({ userId: usuario.id, orgId: usuario.org_id, superadmin: usuario.superadmin === 1 });

  return NextResponse.json({ ok: true });
}
