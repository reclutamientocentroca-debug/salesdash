/**
 * El segundo tiempo de «Continuar con Facebook»: elegir la página.
 *
 * El primero es una navegación de verdad y vive en `entrar/` y `volver/`: el
 * dueño va a facebook.com, elige ahí a qué páginas nos da acceso y vuelve. Para
 * cuando llega aquí, el servidor ya tiene sus páginas en la memoria corta.
 *
 *   GET — la lista para pintar el selector. Sin tokens.
 *   PUT — la página elegida. El token se saca de esa memoria, buscándolo por el
 *         `orgId` de la sesión, NUNCA del cuerpo de la petición.
 *
 * Ese PUT es la decisión de seguridad de todo el módulo: si aceptara un token,
 * cualquiera podría conectar la página de otro mandando un token suyo, y el
 * `orgId` de la sesión no serviría de nada.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { asignarCanalesAMiembro, listarPaginasMeta } from "@/lib/db";
import { conectarPagina } from "@/lib/meta/conectar";
import { olvidarPaginas, paginaRecordada, paginasRecordadas } from "@/lib/meta/login";
import { sesionApi } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Elegida = z.object({
  pageId: z.string().trim().regex(/^\d{5,}$/, "El identificador de la página son solo dígitos"),
});

/**
 * GET — las páginas que quedaron recordadas al volver de Facebook.
 *
 * El camino de la redirección no puede devolver la lista por la dirección del
 * navegador —sería enseñar en la barra de direcciones qué páginas administra
 * alguien— así que la deja en la memoria del servidor y el panel la pide aquí,
 * con la sesión del dueño. Sin tokens, como el POST.
 */
export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const guardadas = paginasRecordadas(orgId);
  const yaEstan = new Set(listarPaginasMeta(orgId).map((c) => c.phone));

  return NextResponse.json({
    paginas: guardadas.map((p) => ({
      pageId: p.pageId,
      nombre: p.nombre,
      // La foto es pública —es la de la página, la que ve cualquiera— así que
      // baja al navegador sin problema. El token sigue sin salir de aquí.
      foto: p.foto,
      tieneInstagram: p.igUserId !== null,
      conectada: yaEstan.has(p.pageId),
    })),
  });
}

export async function PUT(req: Request) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cuerpo = Elegida.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json(
      { error: cuerpo.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const pagina = paginaRecordada(orgId, cuerpo.data.pageId);
  if (!pagina) {
    return NextResponse.json(
      { error: "La sesión con Facebook caducó. Vuelve a pulsar «Entrar con Facebook»." },
      { status: 410 },
    );
  }

  const r = await conectarPagina(orgId, pagina.pageId, pagina.token);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado });

  // El token ya está guardado y cifrado en su canal: en memoria no pinta nada.
  olvidarPaginas(orgId);

  // Quien la conecta se queda con ella. Ver la misma nota en /api/canales.
  if (s.ctx.canalesPermitidos !== null) {
    asignarCanalesAMiembro(orgId, s.ctx.userId, [...s.ctx.canalesPermitidos, r.id]);
  }

  return NextResponse.json(r);
}
