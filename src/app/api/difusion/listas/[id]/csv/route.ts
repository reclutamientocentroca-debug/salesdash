import { NextResponse, type NextRequest } from "next/server";
import { guardarClientesCsv, obtenerListaDifusion } from "@/lib/db";
import { parsearCsv } from "@/lib/difusion-csv";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sube un CSV de nombre y teléfono para una lista tipo `csv`. Reemplaza lo que ya tuviera. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  if (s.ctx.usuario.rol !== "dueno") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede subir una lista." }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Lista inválida" }, { status: 400 });

  const lista = obtenerListaDifusion(s.ctx.orgId, id);
  if (!lista) return NextResponse.json({ error: "Esa lista no existe." }, { status: 404 });
  if (lista.tipo !== "csv") {
    return NextResponse.json({ error: "Esta lista es automática: no se le sube un archivo." }, { status: 400 });
  }

  const forma = await req.formData().catch(() => null);
  const archivo = forma?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Adjunta el archivo CSV." }, { status: 400 });
  }
  if (archivo.size > 2_000_000) {
    return NextResponse.json({ error: "El archivo es demasiado grande (máximo 2 MB)." }, { status: 400 });
  }

  const texto = await archivo.text();
  const clientes = parsearCsv(texto);
  if (clientes.length === 0) {
    return NextResponse.json({ error: "No se reconoció ningún teléfono en el archivo." }, { status: 400 });
  }

  const n = guardarClientesCsv(s.ctx.orgId, id, clientes);
  return NextResponse.json({ contactos: n });
}
