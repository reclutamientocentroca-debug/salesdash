/**
 * Descargar los leads de un país: de una franja horaria, o todos juntos.
 *
 * El mismo rango que el dashboard —por clave (`?rango=7d`) o por fechas
 * exactas— más `pais` (el código del país, «cr», «pa»…) y, si se quiere solo
 * una franja, `franja` (la clave de `FRANJAS_HORARIAS`). Sin `franja` salen
 * TODOS los leads del periodo, con una columna de más que dice en cuál cayó
 * cada uno. Las filas son exactamente las que cuenta el panel: las dos salen
 * de `leadsPorPaisConFranja`, así que el número de la pantalla y las del
 * archivo siempre cuadran.
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
  if (!pais) {
    return NextResponse.json({ error: "Falta el país." }, { status: 400 });
  }
  const claveFranja = params.get("franja");
  const franja = claveFranja ? FRANJAS_HORARIAS.find((f) => f.clave === claveFranja) : null;
  if (claveFranja && !franja) {
    return NextResponse.json({ error: "Esa franja no existe." }, { status: 400 });
  }

  const rango = {
    ...rangoDeLaCuenta(s.ctx.orgId, params),
    canalIds: s.ctx.canalesPermitidos ?? undefined,
  };
  const huso = obtenerPais(pais)?.husoHorario;
  const etiquetaDe = new Map(FRANJAS_HORARIAS.map((f) => [f.clave, f.etiqueta]));
  const todos = leadsPorPaisConFranja(s.ctx.orgId, rango, pais);
  const leads = franja ? todos.filter((l) => l.franja === franja.clave) : todos;

  const llego = (epoch: number) =>
    new Date(epoch * 1000).toLocaleString("es", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      ...(huso ? { timeZone: huso } : {}),
    });

  const filas = franja
    ? [
        ["Número", "Nombre", "Teléfono", "Llegó"],
        ...leads.map((l) => [l.canal_nombre, l.nombre ?? "", l.telefono, llego(l.fecha_inicio)]),
      ]
    : [
        ["Número", "Nombre", "Teléfono", "Llegó", "Franja"],
        ...leads.map((l) => [l.canal_nombre, l.nombre ?? "", l.telefono, llego(l.fecha_inicio), etiquetaDe.get(l.franja) ?? ""]),
      ];
  // El BOM es para Excel en Windows: sin él, los acentos del nombre llegan rotos.
  const csv = "﻿" + filas.map((fila) => fila.map(celda).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads_${pais}${franja ? `_${franja.clave}` : ""}.csv"`,
      "cache-control": "no-store",
    },
  });
}
