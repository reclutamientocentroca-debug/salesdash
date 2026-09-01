/**
 * Conectar y desconectar páginas de Meta, a mano.
 *
 * El camino normal es el botón de «Entrar con Facebook» —`/api/meta/oauth`—.
 * Esto es el de repuesto: pegar el ID y el token de página. Sigue existiendo
 * porque la ventana de Meta necesita que la app tenga su configuración de
 * Business Login puesta, y pegar un token se puede hacer siempre.
 *
 * Los dos terminan en `conectarPagina`, que es donde se valida y se guarda.
 *
 * Una página conectada ES un canal (`canales.tipo = 'meta'`). Por eso aquí no
 * hay tabla propia ni lógica de métricas: en cuanto la fila existe, el panel
 * entero —dashboard, ventas, bandeja, informe— la cuenta como cuenta un número
 * de WhatsApp.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eliminarCanal, listarPaginasMeta, obtenerCanal, vincularAnuncioAProducto } from "@/lib/db";
import { conectarPagina } from "@/lib/meta/conectar";
import { sesionApi } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Conectar = z.object({
  pageId: z.string().trim().regex(/^\d{5,}$/, "El ID de la página son solo dígitos"),
  token: z.string().trim().min(20, "El token de página parece incompleto"),
});

const Vincular = z.object({
  adId: z.string().trim().min(1),
  productoId: z.number().int().positive().nullable(),
});

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  // El token cifrado NO sale de aquí. La pantalla solo necesita saber que hay
  // una página conectada, no con qué credencial.
  const paginas = listarPaginasMeta(s.ctx.orgId).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    pageId: c.phone,
    igUserId: c.meta_ig_id,
    estado: c.estado,
    agenteActivo: c.agente_activo === 1,
    ultimoEventoAt: c.ultimo_evento_at,
  }));

  return NextResponse.json({ paginas });
}

export async function POST(req: Request) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const cuerpo = Conectar.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json(
      { error: cuerpo.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const r = await conectarPagina(s.ctx.orgId, cuerpo.data.pageId, cuerpo.data.token);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado });

  return NextResponse.json(r);
}

export async function PATCH(req: Request) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const cuerpo = Vincular.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  vincularAnuncioAProducto(s.ctx.orgId, cuerpo.data.adId, cuerpo.data.productoId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Falta la página" }, { status: 400 });
  }

  // `obtenerCanal` ya filtra por orgId: una cuenta no puede borrar la página de
  // otra ni sabiendo su identificador.
  const canal = obtenerCanal(s.ctx.orgId, id);
  if (!canal || canal.tipo !== "meta") {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  eliminarCanal(s.ctx.orgId, id);
  return NextResponse.json({ ok: true });
}
