import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { crearListaDifusion, listarListasDifusion, resolverListaAutomatica } from "@/lib/db";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const listas = listarListasDifusion(s.ctx.orgId).map((l) => {
    const filtros = l.filtros ? (JSON.parse(l.filtros) as Record<string, unknown>) : null;
    // Cuántos contactos resolvería una automática AHORA MISMO: solo un conteo, no la lista entera.
    const contactos = l.tipo === "automatica" ? resolverListaAutomatica(s.ctx.orgId, filtros ?? {}).length : null;
    return { id: l.id, nombre: l.nombre, tipo: l.tipo, created_at: l.created_at, contactos };
  });

  return NextResponse.json({ listas });
}

const Filtros = z.object({
  canalId: z.number().int().positive().nullable().optional(),
  desde: z.number().int().nonnegative().nullable().optional(),
  hasta: z.number().int().nonnegative().nullable().optional(),
  producto: z.string().trim().max(120).nullable().optional(),
  soloConCompra: z.boolean().optional(),
});

const Nueva = z.object({
  nombre: z.string().trim().min(1, "Ponle nombre a la lista").max(120),
  tipo: z.enum(["automatica", "csv"]),
  filtros: Filtros.nullable().optional(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede crear listas de difusión." }, { status: 403 });
  }

  const datos = Nueva.safeParse(await req.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: datos.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  }

  const id = crearListaDifusion(s.ctx.orgId, {
    nombre: datos.data.nombre, tipo: datos.data.tipo,
    filtros: datos.data.filtros ?? null, creadoPor: s.ctx.userId,
  });

  return NextResponse.json({ id });
}
