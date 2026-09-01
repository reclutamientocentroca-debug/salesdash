/**
 * LA VUELTA DE FACEBOOK.
 *
 * Facebook manda aquí al dueño con un `code` en la dirección. Este archivo lo
 * cambia por un token —en el servidor, con el secreto de la app— pregunta qué
 * páginas administra y las deja en la memoria corta. Después le devuelve al
 * panel, donde elige una.
 *
 * Nada de esto vuelve por la dirección del navegador: ni el token, ni la lista.
 * Lo único que viaja de vuelta es «ya puedes elegir», y las páginas se piden
 * desde el panel con la sesión del dueño.
 *
 * ─── LO QUE SE COMPRUEBA ANTES DE TOCAR NADA ───
 *
 *  - Que hay sesión. Sin ella no se sabe de qué cuenta es esta conexión.
 *  - Que el `state` que vuelve es el mismo que se guardó en la cookie. Sin esa
 *    comparación, un enlace de vuelta preparado por otro conectaría SU página
 *    en la cuenta de quien lo abriera.
 *  - Que Facebook no viene con un `error`: el dueño puede haber cancelado, y
 *    cancelar no es una avería —se le devuelve al panel sin drama—.
 */
import { NextResponse, type NextRequest } from "next/server";
import { listarPaginasMeta } from "@/lib/db";
import { intercambiarCodigo, paginasDelUsuario, recordarPaginas } from "@/lib/meta/login";
import { sesionApi } from "@/lib/tenant";
import { COOKIE_ESTADO, urlDeVuelta } from "../entrar/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Al panel, con lo que haya pasado escrito para que se pueda leer. */
function alPanel(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/canales/meta", process.env.APP_URL || req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const r = NextResponse.redirect(url);
  // El estado ya cumplió: se borra en cuanto se usa, salga bien o mal.
  r.cookies.delete(COOKIE_ESTADO);
  return r;
}

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const q = req.nextUrl.searchParams;

  // Cancelar no es un fallo: es una decisión, y se cuenta como tal.
  if (q.get("error")) {
    const motivo = q.get("error_description") ?? "Se cerró la ventana de Facebook sin dar acceso.";
    return alPanel(req, { error: motivo });
  }

  const codigo = q.get("code") ?? "";
  const estado = q.get("state") ?? "";
  const guardado = req.cookies.get(COOKIE_ESTADO)?.value ?? "";

  if (!codigo || !estado || estado !== guardado) {
    return alPanel(req, {
      error:
        "La vuelta de Facebook no cuadra con la que se pidió desde aquí. Vuelve a pulsar el botón.",
    });
  }

  try {
    const token = await intercambiarCodigo(codigo, urlDeVuelta());
    const paginas = await paginasDelUsuario(token);

    if (paginas.length === 0) {
      return alPanel(req, {
        error:
          "Esa cuenta de Facebook no administra ninguna página, o no le diste acceso a ninguna. " +
          "Vuelve a pulsar el botón y marca la página.",
      });
    }

    recordarPaginas(orgId, paginas);

    /*
     * Ya conectadas: no se filtran, se enseñan apagadas. Que una página falte
     * de la lista sin explicación es lo que hace pensar que la ventana se dejó
     * algo.
     */
    const yaEstan = listarPaginasMeta(orgId).length;

    return alPanel(req, { elegir: "1", ...(yaEstan ? { ya: String(yaEstan) } : {}) });
  } catch (e) {
    return alPanel(req, { error: e instanceof Error ? e.message : "Meta no respondió" });
  }
}
