import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  getConversation,
  listarCanales,
  listarMensajes,
  resolverRevision,
} from "@/lib/db";
import { anomaliaDeCorreccion } from "@/lib/analyzer";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const conv = getConversation(orgId, Number(id));
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const canal = listarCanales(orgId).find((c) => c.id === conv.canal_id);

  return NextResponse.json({
    conversacion: {
      ...conv,
      canal: canal?.nombre ?? "—",
      datos_faltantes: leerLista(conv.datos_faltantes),
    },
    mensajes: listarMensajes(orgId, conv.id).map((m) => ({
      id: m.id,
      emisor: m.emisor,
      tipo: m.tipo,
      content: m.content,
      // De las imágenes se muestra la descripción, nunca la foto: el archivo
      // no se almacena en ningún momento.
      descripcion_imagen: m.descripcion_imagen,
      categoria_imagen: m.categoria_imagen,
      created_at: m.created_at,
    })),
  });
}

function leerLista(bruto: string | null): string[] {
  if (!bruto) return [];
  try {
    const v = JSON.parse(bruto);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [bruto];
  }
}

const Correccion = z.object({ resolver: z.enum(["ia", "humano"]) });

/**
 * PATCH — los dos botones de la bandeja de revisión: "Fue de la IA" y "Fue del
 * vendedor". Es la única corrección que rompe el sellado de la regla maestra,
 * y por eso queda registrada como anomalía para poder auditarla.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;
  const conv = getConversation(orgId, Number(id));
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const datos = Correccion.safeParse(await req.json().catch(() => null));
  if (!datos.success) return NextResponse.json({ error: "Indica quién cerró" }, { status: 400 });

  resolverRevision(orgId, conv.id, datos.data.resolver);
  anomaliaDeCorreccion(orgId, conv.id, datos.data.resolver);

  return NextResponse.json({ ok: true, estado: datos.data.resolver });
}
