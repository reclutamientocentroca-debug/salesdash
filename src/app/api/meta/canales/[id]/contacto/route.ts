/**
 * El número de contacto de una página de Meta: el que se le da al cliente que
 * lo pide por Messenger, Instagram o en un comentario. Vacío lo borra.
 */
import { NextResponse, type NextRequest } from "next/server";
import { guardarNumeroContacto, obtenerCanal } from "@/lib/db";
import { normalizarNumeroContacto } from "@/lib/numero-contacto";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const { id } = await params;
  const canal = obtenerCanal(s.ctx.orgId, Number(id));
  if (!canal || canal.tipo !== "meta" || !puedeAtenderCanal(s.ctx, canal.id)) {
    return NextResponse.json({ error: "Esa página no está conectada aquí." }, { status: 404 });
  }

  const cuerpo = (await req.json().catch(() => ({}))) as { numero?: unknown };
  const crudo = typeof cuerpo.numero === "string" ? cuerpo.numero : "";

  if (!crudo.trim()) {
    guardarNumeroContacto(s.ctx.orgId, canal.id, null);
    return NextResponse.json({ numero: null });
  }

  const numero = normalizarNumeroContacto(crudo);
  if (!numero) {
    return NextResponse.json(
      { error: "Escribe el número completo con el código del país, por ejemplo +506 8888 8888." },
      { status: 400 },
    );
  }

  guardarNumeroContacto(s.ctx.orgId, canal.id, numero);
  return NextResponse.json({ numero });
}
