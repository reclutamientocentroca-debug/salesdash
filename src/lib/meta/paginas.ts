/**
 * Alta y comprobación de una página de Meta.
 *
 * Nada de aquí le escribe a un cliente: lee el nombre de la página y la
 * suscribe a los eventos. Por eso vive fuera de `send.ts`, que está reservado a
 * lo que sí habla con clientes y que solo `agent.ts` puede importar.
 */
import { descifrar } from "@/lib/auth";
import type { Canal } from "@/lib/db";
import { getGraph, postGraph } from "./graph";

/**
 * Los eventos a los que se suscribe la página. Son los cuatro que usa el canal
 * más el del muro:
 *   messages / message_echoes — los directos, y el eco de lo que mandamos
 *   messaging_postbacks       — botones del anuncio
 *   messaging_referrals       — el anuncio que trajo al cliente
 *   feed                      — los comentarios
 *
 * De estos, `messages` es el único sin el que no llega NADA. Los demás quitan
 * información —el anuncio, el eco, los comentarios—, pero el canal respira.
 */
export const CAMPOS_SUSCRIPCION = [
  "messages",
  "messaging_postbacks",
  "message_echoes",
  "messaging_referrals",
  "feed",
] as const;

/**
 * SUSCRIBIR LA PÁGINA NO ES OPCIONAL.
 *
 * Dar de alta el webhook en la app de Meta no basta: cada página tiene que
 * suscribirse aparte, y sin eso la página queda conectada y NO llega ni un
 * mensaje. Es la causa número uno de «lo configuré todo y no pasa nada», así
 * que se hace al conectar en vez de dejarlo como un paso manual que se olvida.
 */
export async function suscribirPagina(canal: Canal): Promise<void> {
  await postGraph(canal, `${canal.phone}/subscribed_apps`, {
    subscribed_fields: CAMPOS_SUSCRIPCION.join(","),
  });
}

/** Lo que Meta contesta cuando se le pregunta por una página conectada. */
export interface RevisionPagina {
  /**
   * El acceso guardado se pudo descifrar. Falso es un caso aparte de «Meta lo
   * rechazó»: ni se llegó a preguntar, y el arreglo es el mismo pero el motivo
   * no —pasa cuando cambió la clave del servidor, no cuando caducó el token—.
   */
  tokenLegible: boolean;
  /** El token sigue sirviendo: Meta contestó al nombre de la página. */
  tokenVale: boolean;
  /** Nuestra app está en la lista de suscritas a esta página. */
  suscrita: boolean;
  /** Los campos que Meta dice tener suscritos ahora mismo. */
  campos: string[];
  /** De los nuestros, los que faltan. Con `messages` dentro, no llega nada. */
  faltan: string[];
  /** Se intentó suscribir durante esta revisión y Meta aceptó. */
  reparada: boolean;
  /** Lo que dijo Meta cuando algo falló, con SU texto. */
  error: string | null;
}

/**
 * ¿ESTA PÁGINA RECIBE DE VERDAD?
 *
 * Existe por el peor estado posible de la integración, que el resto del módulo
 * se pasa el día evitando y que aun así ocurre: una página que en el panel se ve
 * «conectada» y no recibe ni un mensaje. Pasa cuando la suscripción falló al
 * conectar —faltaba `pages_manage_metadata`, por ejemplo—, y entonces el aviso
 * se enseñó UNA vez, se cerró, y la página quedó idéntica a las que funcionan.
 *
 * Se le pregunta a Meta, que es quien lo sabe, en vez de deducirlo de lo que
 * tenemos guardado. Y si contesta que no está suscrita, se suscribe aquí mismo:
 * el dueño no puede arreglarlo desde el panel de Meta —no es su app— y decirle
 * «tu página no está suscrita» sin repararlo es dejarlo igual de parado.
 *
 * No le escribe a ningún cliente, así que vive aquí y no en `send.ts`.
 */
export async function revisarPagina(canal: Canal): Promise<RevisionPagina> {
  const vacio: RevisionPagina = {
    tokenLegible: true, tokenVale: false, suscrita: false, campos: [],
    faltan: [...CAMPOS_SUSCRIPCION], reparada: false, error: null,
  };

  let token: string;
  try {
    token = descifrar(canal.token_cifrado);
  } catch {
    return { ...vacio, tokenLegible: false, error: "El acceso guardado no se puede descifrar." };
  }

  // 1. ¿El token sigue vivo? Es lo primero porque, si caducó, todo lo demás
  //    fallaría con un error que apunta al sitio equivocado.
  try {
    await getGraph(canal.phone, "name", token);
  } catch (e) {
    return { ...vacio, error: e instanceof Error ? e.message : "Meta no aceptó el acceso guardado." };
  }

  // 2. ¿Estamos suscritos, y a qué? `subscribed_apps` devuelve las apps
  //    suscritas a ESTA página. Con el token de la página, la única que puede
  //    salir es la nuestra.
  const leerSuscripcion = async (): Promise<string[]> => {
    const datos = await getGraph(`${canal.phone}/subscribed_apps`, "subscribed_fields", token);
    const lista = Array.isArray(datos.data) ? datos.data : [];

    const campos = new Set<string>();
    for (const bruto of lista) {
      const app = (bruto ?? {}) as { subscribed_fields?: unknown };
      for (const c of Array.isArray(app.subscribed_fields) ? app.subscribed_fields : []) {
        if (typeof c === "string") campos.add(c);
      }
    }
    return [...campos];
  };

  let campos: string[];
  try {
    campos = await leerSuscripcion();
  } catch (e) {
    return {
      ...vacio,
      tokenLegible: true,
      tokenVale: true,
      error: e instanceof Error ? e.message : "Meta no dijo si la página está suscrita.",
    };
  }

  const faltan = CAMPOS_SUSCRIPCION.filter((c) => !campos.includes(c));
  if (faltan.length === 0) {
    return {
      tokenLegible: true, tokenVale: true, suscrita: true,
      campos, faltan: [], reparada: false, error: null,
    };
  }

  // 3. Falta algo: se suscribe y se vuelve a preguntar. Lo que se devuelve es lo
  //    que Meta dice DESPUÉS de reparar, no lo que se intentó.
  try {
    await suscribirPagina(canal);
  } catch (e) {
    return {
      tokenLegible: true,
      tokenVale: true,
      suscrita: campos.length > 0,
      campos,
      faltan,
      reparada: false,
      error: e instanceof Error ? e.message : "Meta no aceptó suscribir la página.",
    };
  }

  let despues: string[];
  try {
    despues = await leerSuscripcion();
  } catch {
    // La suscripción se aceptó; que no se pueda releer no la deshace.
    despues = [...CAMPOS_SUSCRIPCION];
  }

  return {
    tokenLegible: true,
    tokenVale: true,
    suscrita: despues.length > 0,
    campos: despues,
    faltan: CAMPOS_SUSCRIPCION.filter((c) => !despues.includes(c)),
    reparada: true,
    error: null,
  };
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
