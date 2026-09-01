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
 * ─── DOS FORMAS DE VOLVER ───
 *
 * En VENTANA FLOTANTE —lo normal— esto no redirige a ninguna parte: devuelve
 * una página mínima que le avisa al panel que la tiene detrás y se cierra sola.
 * El dueño no pierde de vista dónde estaba, que es la mitad de la gracia de
 * abrir una ventana en vez de irse de la página.
 *
 * En la PESTAÑA DE SIEMPRE —cuando el navegador bloqueó la ventana flotante y
 * el panel navegó en su lugar— vuelve con una redirección normal al panel.
 *
 * ─── LO QUE SE COMPRUEBA ANTES DE TOCAR NADA ───
 *
 *  - Que hay sesión. Sin ella no se sabe de qué cuenta es esta conexión.
 *  - Que el `state` que vuelve es el mismo que se guardó en la cookie. Sin esa
 *    comparación, un enlace de vuelta preparado por otro conectaría SU página
 *    en la cuenta de quien lo abriera.
 *  - Que Facebook no viene con un `error`: el dueño puede haber cancelado, y
 *    cancelar no es una avería.
 */
import { NextResponse, type NextRequest } from "next/server";
import { listarPaginasMeta } from "@/lib/db";
import { intercambiarCodigo, paginasDelUsuario, recordarPaginas } from "@/lib/meta/login";
import { sesionApi } from "@/lib/tenant";
import { COOKIE_ESTADO, COOKIE_FLOTANTE, urlDeVuelta } from "../entrar/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** El origen del panel, que es al único al que se le habla desde la ventana. */
function origenDelPanel(req: NextRequest): string {
  try {
    return new URL(process.env.APP_URL || req.url).origin;
  } catch {
    return new URL(req.url).origin;
  }
}

/**
 * La página que se cierra sola.
 *
 * Le avisa a la ventana que la abrió y se va. `postMessage` lleva el origen
 * exacto del panel y no un `*`: con un asterisco, cualquier página que hubiera
 * abierto esta ventana recibiría el aviso, y aunque aquí no viaje ningún dato
 * sensible, decirle a un tercero que la conexión salió bien es contarle algo
 * que no es suyo.
 *
 * Si por lo que sea no hay ventana detrás —alguien pegó esta dirección a
 * mano—, no se queda en blanco: se va al panel como si fuera el otro camino.
 */
function cerrarse(req: NextRequest, datos: Record<string, string>): NextResponse {
  const origen = origenDelPanel(req);
  const carga = JSON.stringify({ fuente: "salesdash-meta", ...datos });
  const alPanel = `${origen}/canales/meta?${new URLSearchParams(datos)}`;

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Volviendo al panel…</title></head>
<body style="font:14px system-ui;padding:24px;color:#334">
  Listo. Puedes cerrar esta ventana.
  <script>
    (function () {
      var datos = ${carga};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(datos, ${JSON.stringify(origen)});
        window.close();
      } else {
        window.location.replace(${JSON.stringify(alPanel)});
      }
    })();
  </script>
</body>
</html>`;

  const r = new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
  r.cookies.delete(COOKIE_ESTADO);
  r.cookies.delete(COOKIE_FLOTANTE);
  return r;
}

/** Al panel, con lo que haya pasado escrito para que se pueda leer. */
function alPanel(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/canales/meta", process.env.APP_URL || req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const r = NextResponse.redirect(url);
  // El estado ya cumplió: se borra en cuanto se usa, salga bien o mal.
  r.cookies.delete(COOKIE_ESTADO);
  r.cookies.delete(COOKIE_FLOTANTE);
  return r;
}

export async function GET(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const q = req.nextUrl.searchParams;
  const flotante = req.cookies.get(COOKIE_FLOTANTE)?.value === "1";
  const volver = (datos: Record<string, string>) =>
    flotante ? cerrarse(req, datos) : alPanel(req, datos);

  // Cancelar no es un fallo: es una decisión, y se cuenta como tal.
  if (q.get("error")) {
    const motivo = q.get("error_description") ?? "Se cerró la ventana de Facebook sin dar acceso.";
    return volver({ error: motivo });
  }

  const codigo = q.get("code") ?? "";
  const estado = q.get("state") ?? "";
  const guardado = req.cookies.get(COOKIE_ESTADO)?.value ?? "";

  if (!codigo || !estado || estado !== guardado) {
    return volver({
      error:
        "La vuelta de Facebook no cuadra con la que se pidió desde aquí. Vuelve a pulsar el botón.",
    });
  }

  try {
    const token = await intercambiarCodigo(codigo, urlDeVuelta());
    const paginas = await paginasDelUsuario(token);

    if (paginas.length === 0) {
      return volver({
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

    return volver({ elegir: "1", ...(yaEstan ? { ya: String(yaEstan) } : {}) });
  } catch (e) {
    return volver({ error: e instanceof Error ? e.message : "Meta no respondió" });
  }
}
