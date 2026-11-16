/**
 * Descargar el registro de clientes por franja horaria, en Excel.
 *
 * El mismo rango que el dashboard —por clave (`?rango=7d`) o por fechas
 * exactas— más `pais` (el código del país, «cr», «pa»…) y, si se quiere solo
 * una franja, `franja` (la clave de `FRANJAS_HORARIAS`).
 *
 * SIN `franja`: el registro día por día que pidió la dueña (2026-11-16) —uno
 * igual al que ella lleva a mano—, con una franja por columna y el total del
 * día. CON `franja`: la lista de los clientes de esa franja, con su nombre y
 * su teléfono, para poder escribirles. Las dos salen de `leadsPorPaisConFranja`
 * /`franjasPorDia`, así que lo que se descarga siempre cuadra con el panel.
 */
import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { leadsPorPaisConFranja } from "@/lib/db";
import { franjasPorDia } from "@/lib/metrics";
import { FRANJAS_HORARIAS } from "@/lib/rango";
import { obtenerPais } from "@/lib/paises";
import { rangoDeLaCuenta, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AZUL_CABECERA = "FF1F3864";
const AZUL_TOTAL = "FFDCE6F1";
const BLANCO = "FFFFFFFF";

/** El azul oscuro con letra blanca que pidió la dueña para la cabecera. */
function vestirCabecera(fila: ExcelJS.Row) {
  fila.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: BLANCO } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_CABECERA } };
    celda.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  fila.height = 30;
}

function titulo(hoja: ExcelJS.Worksheet, columnas: number, texto: string, subtitulo: string) {
  hoja.mergeCells(1, 1, 1, columnas);
  const t = hoja.getCell(1, 1);
  t.value = texto;
  t.font = { bold: true, size: 14, color: { argb: AZUL_CABECERA } };

  hoja.mergeCells(2, 1, 2, columnas);
  const s = hoja.getCell(2, 1);
  s.value = subtitulo;
  s.font = { italic: true, size: 10, color: { argb: "FF666666" } };

  hoja.addRow([]);
}

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const params = req.nextUrl.searchParams;
  const pais = params.get("pais")?.trim().toLowerCase();
  if (!pais) return NextResponse.json({ error: "Falta el país." }, { status: 400 });
  const claveFranja = params.get("franja");
  const franja = claveFranja ? FRANJAS_HORARIAS.find((f) => f.clave === claveFranja) : null;
  if (claveFranja && !franja) return NextResponse.json({ error: "Esa franja no existe." }, { status: 400 });

  const rango = {
    ...rangoDeLaCuenta(s.ctx.orgId, params),
    canalIds: s.ctx.canalesPermitidos ?? undefined,
  };
  const nombrePais = obtenerPais(pais)?.nombre ?? pais.toUpperCase();
  const huso = obtenerPais(pais)?.husoHorario;
  const periodo = new Intl.DateTimeFormat("es", {
    day: "2-digit", month: "2-digit", year: "numeric", ...(huso ? { timeZone: huso } : {}),
  });
  const subtitulo = `${nombrePais} · del ${periodo.format(new Date(rango.desde * 1000))} al ${periodo.format(new Date(rango.hasta * 1000))}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "SalesDash";

  if (!franja) {
    // ── El registro día por día, una franja por columna ───────────────────
    const dias = franjasPorDia(s.ctx.orgId, rango, pais);
    const hoja = wb.addWorksheet("Por franja horaria");
    const columnas = [
      { ancho: 13 }, { ancho: 16 },
      ...FRANJAS_HORARIAS.map(() => ({ ancho: 17 })),
      { ancho: 14 },
    ];
    columnas.forEach((c, i) => { hoja.getColumn(i + 1).width = c.ancho; });

    titulo(hoja, columnas.length, "Registro de clientes que escriben por franja horaria", subtitulo);

    vestirCabecera(
      hoja.addRow(["Fecha", "País", ...FRANJAS_HORARIAS.map((f) => f.etiqueta), "Total del día"]),
    );

    for (const d of dias) {
      hoja.addRow([
        d.fecha, nombrePais,
        ...FRANJAS_HORARIAS.map((f) => d.porFranja[f.clave] ?? 0),
        d.total,
      ]);
    }

    const totalPorFranja = FRANJAS_HORARIAS.map((f) => dias.reduce((a, d) => a + (d.porFranja[f.clave] ?? 0), 0));
    const filaTotal = hoja.addRow(["Total", "", ...totalPorFranja, totalPorFranja.reduce((a, n) => a + n, 0)]);
    filaTotal.eachCell((celda) => {
      celda.font = { bold: true };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_TOTAL } };
    });

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="clientes_por_horario_${pais}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }

  // ── Los clientes de UNA franja, con nombre y teléfono para escribirles ───
  const leads = leadsPorPaisConFranja(s.ctx.orgId, rango, pais).filter((l) => l.franja === franja.clave);
  const hoja = wb.addWorksheet("Leads de la franja");
  [{ ancho: 22 }, { ancho: 26 }, { ancho: 16 }, { ancho: 20 }].forEach((c, i) => {
    hoja.getColumn(i + 1).width = c.ancho;
  });

  titulo(hoja, 4, "Clientes que escribieron en esta franja", `${nombrePais} · ${franja.etiqueta}`);
  vestirCabecera(hoja.addRow(["Número", "Nombre", "Teléfono", "Llegó"]));

  for (const l of leads) {
    hoja.addRow([
      l.canal_nombre,
      l.nombre ?? "",
      l.telefono,
      new Date(l.fecha_inicio * 1000).toLocaleString("es", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        ...(huso ? { timeZone: huso } : {}),
      }),
    ]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="leads_${pais}_${franja.clave}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
