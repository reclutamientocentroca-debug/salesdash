/**
 * El transporte contra la Graph API de Meta.
 *
 * Aquí no hay nada de negocio: firma la petición con el token de la página,
 * la manda y traduce el error. Está separado de `send.ts` a propósito, y la
 * razón es la regla de envío.
 *
 * `send.ts` contiene SOLO lo que le escribe a un cliente, y ningún archivo
 * salvo `agent.ts` puede importarlo —hay una prueba que barre `src/` y falla si
 * alguien lo hace—. Las llamadas que NO le escriben a nadie (leer el nombre de
 * una página, suscribirla a los eventos) tienen que poder usarse desde el panel,
 * así que viven fuera de ese módulo. Si estuvieran dentro, o se rompía la regla
 * o el panel no podía conectar una página.
 */
import { descifrar } from "@/lib/auth";
import type { Canal } from "@/lib/db";

export const versionGraph = () => process.env.META_GRAPH_VERSION || "v23.0";

export class ErrorMeta extends Error {
  constructor(mensaje: string, readonly codigo?: number) {
    super(mensaje);
    this.name = "ErrorMeta";
  }
}

/**
 * EL ERROR DE META PUEDE TRAER EL TOKEN DENTRO.
 *
 * «Malformed access token EAAG…» — Meta te devuelve la credencial escrita en
 * el texto del error. Ese texto se propaga a propósito hasta el panel, porque
 * es lo que distingue un token caducado de un permiso que falta, y ahí acaba
 * pintado en pantalla, en un registro del servidor y en la captura que el dueño
 * manda por WhatsApp para pedir ayuda.
 *
 * Se tapa aquí, en el único sitio por el que pasan todas las llamadas, y no en
 * cada pantalla: una pantalla que se olvide de hacerlo publica la credencial.
 */
function sinToken(mensaje: string, token: string): string {
  const limpio = token.trim();
  if (limpio.length < 8) return mensaje;

  // También los fragmentos: Meta a veces recorta el token en el mensaje.
  return mensaje.split(limpio).join("(el acceso guardado)").replace(
    new RegExp(`\\b${limpio.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\S*`, "g"),
    "(el acceso guardado)",
  );
}

/** POST a la Graph API con el token de la página, ya descifrado. */
export async function postGraph(
  canal: Canal,
  ruta: string,
  cuerpo: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return postConToken(descifrar(canal.token_cifrado), ruta, cuerpo);
}

export async function postConToken(
  token: string,
  ruta: string,
  cuerpo: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const r = await fetch(`https://graph.facebook.com/${versionGraph()}/${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...cuerpo, access_token: token }),
  });

  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;

  if (!r.ok) {
    /*
     * El error de Meta se propaga con su texto, no con un «falló el envío».
     * Los tres que se ven de verdad —token caducado, fuera de la ventana de 24
     * horas, permiso que falta— se arreglan de tres formas distintas, y sin el
     * mensaje original quien lo lea no sabe cuál le tocó.
     */
    const e = (datos.error ?? {}) as { message?: string; code?: number };
    throw new ErrorMeta(sinToken(e.message ?? `Meta respondió ${r.status}`, token), e.code);
  }

  return datos;
}

export async function getGraph(
  ruta: string,
  campos: string,
  token: string,
): Promise<Record<string, unknown>> {
  const url =
    `https://graph.facebook.com/${versionGraph()}/${ruta}` +
    `?fields=${encodeURIComponent(campos)}&access_token=${encodeURIComponent(token)}`;

  const r = await fetch(url);
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;

  if (!r.ok) {
    const e = (datos.error ?? {}) as { message?: string; code?: number };
    throw new ErrorMeta(sinToken(e.message ?? `Meta respondió ${r.status}`, token), e.code);
  }

  return datos;
}
