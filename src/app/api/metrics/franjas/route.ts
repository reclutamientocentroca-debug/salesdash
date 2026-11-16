/**
 * Descargar los leads de una franja horaria, para un país.
 *
 * El mismo rango que el dashboard —por clave (`?rango=7d`) o por fechas
 * exactas— más `pais` (el código del país, «cr», «pa»…) y `franja` (la clave
 * de `FRANJAS_HORARIAS`). Las filas son exactamente las que cuenta el panel:
 * las dos salen de `leadsPorPaisConFranja`, así que el número de la pantalla
 * y las filas del archivo siempre cuadran.
 */
import { NextResponse, type NextRequest } from "next/server";
import { leadsPorPaisConFranja } from "@/lib/db";
import { FRANJAS_HORARIAS } from "@/lib/rango";
import { obtenerPais } from "@/lib/paises";
import { rangoDeLaCuenta, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Una celda de CSV, entrecomillada solo si hace falta. */
function celda(v: string | number | null): string {
  const t = v === null ? "" : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const params = req.nextUrl.searchParams;
  const pais = params.get("pais")?.trim().toLowerCase();
  const franja = FRANJAS_HORARIAS.find((f) => f.clave === params.get("franja"));
  if (!pais || !franja) {
    return NextResponse.json({ error: "Falta el país o la franja." }, { status: 400 });
  }

  const rango = {
    ...rangoDeLaCuenta(s.ctx.orgId, params),
    canalIds: s.ctx.canalesPermitidos ?? undefined,
  };
  const huso = obtenerPais(pais)?.husoHorario;
  const leads = leadsPorPaisConFranja(s.ctx.orgId, rango, pais).filter((l) => l.franja === franja.clave);

  const filas = [
    ["Número", "Nombre", "Teléfono", "Llegó"],
    ...leads.map((l) => [
      l.canal_nombre,
      l.nombre ?? "",
      l.telefono,
      new Date(l.fecha_inicio * 1000).toLocaleString("es", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        ...(huso ? { timeZone: huso } : {}),
      }),
    ]),
  ];
  // El BOM es para Excel en Windows: sin él, los acentos del nombre llegan rotos.
  const csv = "﻿" + filas.map((fila) => fila.map(celda).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads_${pais}_${franja.clave}.csv"`,
      "cache-control": "no-store",
    },
  });
}
