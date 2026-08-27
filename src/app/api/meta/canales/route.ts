/**
 * Conectar y desconectar páginas de Meta.
 *
 * Una página conectada ES un canal (`canales.tipo = 'meta'`). Por eso aquí no
 * hay tabla propia ni lógica de métricas: en cuanto la fila existe, el panel
 * entero —dashboard, ventas, bandeja, informe— la cuenta como cuenta un número
 * de WhatsApp.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { cifrar, secretoAleatorio } from "@/lib/auth";
import {
  contarPaginasMeta,
  crearPaginaMeta,
  eliminarCanal,
  listarPaginasMeta,
  obtenerCanal,
  vincularAnuncioAProducto,
} from "@/lib/db";
import { datosDePagina, suscribirPagina } from "@/lib/meta/paginas";
import { sesionApi } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Mismo tope que los números: el panel se diseñó para veinte canales. */
const MAX_PAGINAS = 20;

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
  const { orgId } = s.ctx;

  const cuerpo = Conectar.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json(
      { error: cuerpo.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  if (contarPaginasMeta(orgId) >= MAX_PAGINAS) {
    return NextResponse.json(
      { error: `El panel admite hasta ${MAX_PAGINAS} páginas conectadas.` },
      { status: 400 },
    );
  }

  const { pageId, token } = cuerpo.data;

  /*
   * Se comprueba el token contra Meta ANTES de guardar nada.
   *
   * Guardar primero y validar después deja páginas «conectadas» que no reciben
   * ni un mensaje, y el dueño no tiene forma de saber por qué: en el panel se
   * ven igual que las que funcionan. Si Meta no lo acepta, aquí no se guarda.
   */
  let nombre: string;
  let igUserId: string | null;
  try {
    const datos = await datosDePagina(pageId, token);
    nombre = datos.nombre;
    igUserId = datos.igUserId;
  } catch (e) {
    return NextResponse.json(
      { error: `Meta rechazó el token: ${e instanceof Error ? e.message : "error desconocido"}` },
      { status: 400 },
    );
  }

  let canalId: number;
  try {
    canalId = crearPaginaMeta(orgId, {
      pageId,
      nombre,
      tokenCifrado: cifrar(token),
      // Meta firma con el secreto de la app, no con uno por canal. La columna
      // es NOT NULL y se rellena para no dejarla vacía, pero no se usa.
      webhookSecret: secretoAleatorio(),
      igUserId,
    });
  } catch {
    return NextResponse.json(
      { error: "Esa página ya está conectada en esta cuenta." },
      { status: 409 },
    );
  }

  /*
   * SUSCRIBIR LA PÁGINA NO ES OPCIONAL.
   *
   * Dar de alta el webhook en la app de Meta no basta: cada página tiene que
   * suscribirse aparte, y sin eso la página queda conectada y NO llega ni un
   * mensaje. Es la causa número uno de «lo configuré todo y no pasa nada», así
   * que se hace aquí en vez de dejarlo como un paso manual que se olvida.
   *
   * Si falla, la página se queda guardada pero marcada: es un problema de
   * permisos que se arregla en Meta, y borrar la fila obligaría a repetir todo.
   */
  const canal = obtenerCanal(orgId, canalId);
  try {
    if (canal) await suscribirPagina(canal);
  } catch (e) {
    return NextResponse.json({
      ok: true,
      aviso:
        `La página se guardó, pero Meta no aceptó suscribirla a los eventos: ` +
        `${e instanceof Error ? e.message : "error desconocido"}. ` +
        `Revisa que el token tenga los permisos pages_messaging y pages_manage_metadata.`,
      id: canalId,
      nombre,
    });
  }

  return NextResponse.json({ ok: true, id: canalId, nombre, igUserId });
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
