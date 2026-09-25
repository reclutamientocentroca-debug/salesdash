import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listarCampanas, obtenerCanal } from "@/lib/db";
import { ErrorDifusion, crearCampana } from "@/lib/difusion";
import { puedeAtenderCanal, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const campanas = listarCampanas(s.ctx.orgId).filter((c) => puedeAtenderCanal(s.ctx, c.canal_id));
  return NextResponse.json({ campanas });
}

const Nueva = z.object({
  canalId: z.number().int().positive(),
  listaId: z.number().int().positive(),
  nombre: z.string().trim().min(1, "Ponle nombre a la campaña").max(120),
  modo: z.enum(["qr", "oficial"]),
  mensajeBase: z.string().trim().min(1, "Escribe el mensaje").max(1000),
  variaciones: z.array(z.string().trim().min(1)).max(8).nullable().optional(),
  imagenClave: z.string().trim().max(300).nullable().optional(),
  productoCatalogoId: z.number().int().positive().nullable().optional(),
  productoNombre: z.string().trim().max(160).nullable().optional(),
  productoPrecio: z.number().nonnegative().nullable().optional(),
  mensajesPorDia: z.number().int().min(1).max(1000),
  diasSemana: z.array(z.number().int().min(1).max(7)).min(1, "Elige al menos un día"),
  horaDesde: z.string().regex(/^\d{2}:\d{2}$/),
  horaHasta: z.string().regex(/^\d{2}:\d{2}$/),
  pausaMinSeg: z.number().int().min(1).max(600).optional(),
  pausaMaxSeg: z.number().int().min(1).max(600).optional(),
  costoEstimadoPorMensaje: z.number().nonnegative().optional(),
  costoMoneda: z.string().trim().max(6).optional(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede crear campañas de difusión." }, { status: 403 });
  }

  const datos = Nueva.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  if (!obtenerCanal(s.ctx.orgId, datos.data.canalId)) {
    return NextResponse.json({ error: "Ese canal no existe." }, { status: 400 });
  }

  try {
    const r = crearCampana(s.ctx.orgId, { ...datos.data, creadoPor: s.ctx.userId });
    return NextResponse.json(r);
  } catch (e) {
    const mensaje = e instanceof ErrorDifusion ? e.message : "No se pudo crear la campaña.";
    if (!(e instanceof ErrorDifusion)) console.error("[difusion] crearCampana:", e);
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
}
