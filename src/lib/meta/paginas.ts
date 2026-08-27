/**
 * Alta y comprobación de una página de Meta.
 *
 * Nada de aquí le escribe a un cliente: lee el nombre de la página y la
 * suscribe a los eventos. Por eso vive fuera de `send.ts`, que está reservado a
 * lo que sí habla con clientes y que solo `agent.ts` puede importar.
 */
import type { Canal } from "@/lib/db";
import { getGraph, postGraph } from "./graph";

/**
 * SUSCRIBIR LA PÁGINA NO ES OPCIONAL.
 *
 * Dar de alta el webhook en la app de Meta no basta: cada página tiene que
 * suscribirse aparte, y sin eso la página queda conectada y NO llega ni un
 * mensaje. Es la causa número uno de «lo configuré todo y no pasa nada», así
 * que se hace al conectar en vez de dejarlo como un paso manual que se olvida.
 *
 * Los campos son los cuatro que usa el canal más el del muro:
 *   messages / message_echoes — los directos, y el eco de lo que mandamos
 *   messaging_postbacks       — botones del anuncio
 *   messaging_referrals       — el anuncio que trajo al cliente
 *   feed                      — los comentarios
 */
export async function suscribirPagina(canal: Canal): Promise<void> {
  await postGraph(canal, `${canal.phone}/subscribed_apps`, {
    subscribed_fields: [
      "messages",
      "messaging_postbacks",
      "message_echoes",
      "messaging_referrals",
      "feed",
    ].join(","),
  });
}

/**
 * El nombre de la página y su Instagram, si lo tiene.
 *
 * Sirve de comprobación del token: si Meta no contesta a esto, el token no vale
 * y la página no se guarda. Validar antes de guardar evita el peor estado
 * posible —una página que en el panel se ve conectada y no recibe nada—.
 */
export async function datosDePagina(
  pageId: string,
  token: string,
): Promise<{ nombre: string; igUserId: string | null }> {
  const datos = await getGraph(pageId, "name,instagram_business_account", token);

  const ig = (datos.instagram_business_account ?? {}) as { id?: string };
  return {
    nombre: typeof datos.name === "string" ? datos.name : pageId,
    igUserId: typeof ig.id === "string" ? ig.id : null,
  };
}
