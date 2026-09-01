/**
 * EL BOTÓN DE FACEBOOK, POR EL CAMINO DE VERDAD.
 *
 * Aquí no hay ventana emergente ni SDK de Facebook cargado en la página: esto
 * es un enlace que LLEVA al dueño a facebook.com, en su propia pestaña, con la
 * sesión que ya tiene abierta. Elige ahí la página, Facebook le devuelve al
 * panel, y el token se cambia en el servidor.
 *
 * Por qué así y no con el popup, que es lo que había:
 *
 *  - El popup lo bloquea medio navegador de móvil, y cuando lo bloquea no pasa
 *    NADA: el dueño pulsa el botón azul y se queda mirando una pantalla que no
 *    se mueve. No hay error que enseñar porque no hubo error.
 *  - El SDK son 200 KB de JavaScript de un tercero en una página del panel, y
 *    con ellos las cookies de Facebook en el dominio de la aplicación.
 *  - Y la pantalla que se ve es la de Meta, la que el dueño ya conoce de
 *    conectar cualquier otra herramienta, con su selector de páginas.
 *
 * ─── EL ESTADO, QUE NO ES UN ADORNO ───
 *
 * `state` viaja a Facebook y vuelve. Se guarda a la vez en una cookie httpOnly
 * y se comparan al volver: sin eso, cualquiera podría mandarle a un dueño con
 * sesión abierta un enlace de vuelta con SU código de Facebook y conectarle su
 * propia página a la cuenta del otro. Es el CSRF de toda la vida, y aquí acaba
 * en una página conectada que no es la que se pidió.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { opcionesCookie, secretoAleatorio } from "@/lib/auth";
import { versionGraph } from "@/lib/meta/graph";
import { sesionApi } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** La cookie que guarda el `state` entre la ida y la vuelta. Dura diez minutos. */
export const COOKIE_ESTADO = "sd_meta_oauth";

/**
 * La marca de que esto se abrió en una ventana flotante.
 *
 * La vuelta tiene que saberlo para hacer lo correcto: en una ventana flotante
 * se le avisa al panel y se cierra sola; en la pestaña de siempre, se redirige.
 * Va en una cookie y no en el `state` porque el `state` se compara letra por
 * letra con lo que devuelve Facebook, y meterle información dentro es pedirle
 * problemas a lo único que aquí protege de un CSRF.
 */
export const COOKIE_FLOTANTE = "sd_meta_popup";

/**
 * Los permisos, cuando no hay una configuración de Business Login.
 *
 * Con `META_LOGIN_CONFIG_ID` no se piden así: los lleva dentro la configuración
 * y Meta enseña el selector de páginas. Sin ella, la ventana pide los permisos
 * uno a uno, que es más feo pero funciona igual.
 */
const PERMISOS = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_messages",
].join(",");

/** A dónde vuelve Facebook. Tiene que estar dada de alta en la app de Meta. */
export function urlDeVuelta(): string {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return `${base}/api/meta/oauth/volver`;
}

export async function GET(req: Request) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  const flotante = new URL(req.url).searchParams.get("flotante") === "1";

  const appId = (process.env.META_APP_ID ?? "").trim();
  const base = (process.env.APP_URL ?? "").trim();

  /*
   * Sin estas dos no se manda a nadie a Facebook: volvería a una dirección que
   * no existe y el dueño vería una pantalla de error de Meta sin saber por qué.
   * Se le devuelve al panel con el motivo escrito.
   */
  if (!appId || !base) {
    const falta = !appId ? "META_APP_ID" : "APP_URL";
    return NextResponse.redirect(
      new URL(`/canales/meta?error=${encodeURIComponent(`Falta ${falta} en el servidor.`)}`,
        base || "http://localhost:3000"),
    );
  }

  const estado = secretoAleatorio(16);
  const configId = (process.env.META_LOGIN_CONFIG_ID ?? "").trim();

  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: urlDeVuelta(),
    state: estado,
    response_type: "code",
  });

  // Con configuración de Business Login manda ella; sin ella, los permisos.
  if (configId) p.set("config_id", configId);
  else p.set("scope", PERMISOS);

  const respuesta = NextResponse.redirect(
    `https://www.facebook.com/${versionGraph()}/dialog/oauth?${p}`,
  );

  respuesta.cookies.set(COOKIE_ESTADO, estado, { ...opcionesCookie(), maxAge: 600 });

  if (flotante) respuesta.cookies.set(COOKIE_FLOTANTE, "1", { ...opcionesCookie(), maxAge: 600 });
  else respuesta.cookies.delete(COOKIE_FLOTANTE);

  return respuesta;
}

/** Para la vuelta: la cookie se lee y se borra en el mismo gesto. */
export async function estadoGuardado(): Promise<string | null> {
  return (await cookies()).get(COOKIE_ESTADO)?.value ?? null;
}
