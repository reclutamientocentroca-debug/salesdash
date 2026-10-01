/**
 * Descargar el cierre de mes: el informe corporativo del dashboard.
 *
 * Acepta un mes entero (`?mes=2026-09`), unas fechas exactas del calendario
 * (`?fd=2026-09-01&fh=2026-09-15`) o, como el resto del panel, `rango`/`desde`/
 * `hasta`. Antes de calcular nada depura la cuenta (automatizada frente a
 * asistida): ver `depurar` en `cierre-mes.ts`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { informeDeCierre } from "@/lib/cierre-mes";
import { finDelDiaEn, inicioDelDiaEn } from "@/lib/rango";
import { rangoDeLaCuenta, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const q = req.nextUrl.searchParams;
  const base = rangoDeLaCuenta(s.ctx.orgId, q);
  let rango: { desde: number; hasta: number; huso: string } = { desde: base.desde, hasta: base.hasta, huso: base.huso };
  let etiqueta: string | undefined;

  const seg = (ms: number) => Math.floor(ms / 1000);
  const mes = /^(\d{4})-(\d{2})$/.exec(q.get("mes") ?? "");
  const fd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.get("fd") ?? "");
  const fh = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.get("fh") ?? "");

  if (mes && Number(mes[2]) >= 1 && Number(mes[2]) <= 12) {
    const y = Number(mes[1]), m = Number(mes[2]);
    rango = {
      desde: seg(inicioDelDiaEn(base.huso, y, m, 1)),
      hasta: seg(finDelDiaEn(base.huso, y, m + 1, 0)),
      huso: base.huso,
    };
    etiqueta = `${MESES[m - 1]!.charAt(0).toUpperCase()}${MESES[m - 1]!.slice(1)} ${y}`;
  } else if (fd && fh) {
    const d = seg(inicioDelDiaEn(base.huso, Number(fd[1]), Number(fd[2]), Number(fd[3])));
    const h = seg(finDelDiaEn(base.huso, Number(fh[1]), Number(fh[2]), Number(fh[3])));
    if (d <= h) rango = { desde: d, hasta: h, huso: base.huso };
  }

  const { nombre, html } = informeDeCierre(s.ctx.orgId, {
    rango,
    etiqueta,
    soloAnuncio: q.get("solo") === "anuncio",
    canalIds: s.ctx.canalesPermitidos,
  });

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
      "cache-control": "no-store",
    },
  });
}
