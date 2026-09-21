/**
 * Descargar el resumen de la cuenta para un periodo.
 *
 * Es el dashboard en un archivo. Acepta el mismo rango que la pantalla —por
 * clave (`?rango=7d`) o por fechas exactas (`?desde=…&hasta=…`, en segundos)—
 * y el mismo filtro de anuncio, para que lo que se baja sea exactamente lo que
 * se está mirando y no otra cosa parecida.
 *
 * Es una navegación normal del navegador, así que la sesión viaja en la cookie
 * como en cualquier página. El `Content-Disposition` es lo que convierte la
 * respuesta en un archivo guardado en vez de una pestaña más.
 */
import { NextResponse, type NextRequest } from "next/server";
import { informeDeCuenta } from "@/lib/informe";
import { rangoDeLaCuenta, sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const rango = rangoDeLaCuenta(s.ctx.orgId, req.nextUrl.searchParams);
  const soloAnuncio = req.nextUrl.searchParams.get("solo") === "anuncio";

  const { nombre, html } = informeDeCuenta(s.ctx.orgId, {
    rango,
    soloAnuncio,
    canalIds: s.ctx.canalesPermitidos,
  });

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
      // Un resumen es una foto de un instante: que no se sirva el de ayer.
      "cache-control": "no-store",
    },
  });
}
