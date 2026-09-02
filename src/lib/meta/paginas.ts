/**
 * Alta y comprobación de una página de Meta.
 *
 * Nada de aquí le escribe a un cliente: lee el nombre de la página y la
 * suscribe a los eventos. Por eso vive fuera de `send.ts`, que está reservado a
 * lo que sí habla con clientes y que solo `agent.ts` puede importar.
 */
import { descifrar } from "@/lib/auth";
import {
  anunciosPorCompletar,
  guardarPublicacionAnuncio,
  type Canal,
} from "@/lib/db";
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

// ─────────────────────────────────────────────────────────────────────────────
// La publicación que hay detrás del anuncio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DE QUÉ VIENE EL CLIENTE, en las palabras que escribió el propio negocio.
 *
 * El referral de un anuncio trae el título y la creatividad, pero NO el texto:
 * ese vive en la publicación de Facebook, y del referral solo llega su
 * `post_id`. Con el título a secas —«Set de sábanas»— el agente no sabe si se
 * prometían dos fundas, envío gratis o un 2x1, que es justo por lo que el
 * cliente escribe.
 *
 * Se le pide a la Graph API con el token de la propia página y `message` es lo
 * que el negocio publicó, así que vale como fuente: no es el modelo
 * inventándose una promesa, es leer lo que ya estaba escrito. El `permalink_url`
 * se guarda para el panel, para que el dueño abra el anuncio y vea de qué le
 * hablan sus clientes.
 *
 * NO le escribe a nadie: por eso vive aquí y no en `send.ts`.
 */
export async function publicacionDelAnuncio(
  canal: Canal,
  postId: string,
): Promise<{ texto: string | null; enlace: string | null }> {
  const datos = await getGraph(postId, "message,permalink_url", descifrar(canal.token_cifrado));

  const texto = typeof datos.message === "string" ? datos.message.trim() : "";
  const enlace = typeof datos.permalink_url === "string" ? datos.permalink_url : "";

  return { texto: texto || null, enlace: enlace || null };
}

/**
 * Trae el texto de los anuncios que todavía no lo tienen.
 *
 * Una llamada por ANUNCIO, no por cliente: el texto se guarda en el anuncio y
 * sirve para los cientos de leads que traiga. Los fallos no se propagan —un
 * anuncio sin texto deja al agente con el título, que es peor pero no roto— y
 * el enlace se marca igualmente para que un post que no se puede leer no se
 * vuelva a pedir con cada cliente.
 */
export async function completarAnunciosPendientes(canal: Canal, limite = 2): Promise<number> {
  const pendientes = anunciosPorCompletar(canal.org_id, limite);
  let hechos = 0;

  for (const a of pendientes) {
    try {
      const p = await publicacionDelAnuncio(canal, a.post_id);
      guardarPublicacionAnuncio(canal.org_id, a.ad_id, p);
      if (p.texto) hechos++;
    } catch (e) {
      /*
       * SE MARCA COMO INTENTADO, y esto no es opcional.
       *
       * Sin marcarlo, `anunciosPorCompletar` devuelve el MISMO anuncio fallido
       * con cada mensaje que entra, y esta llamada corre antes de que el agente
       * conteste: con el permiso revocado, cada cliente de la cuenta esperaría
       * una llamada a Meta condenada a fallar. Es el mismo escarmiento que ya
       * está escrito en `describirAnunciosPendientes`.
       */
      console.error(`[anuncio] no se pudo leer la publicación ${a.post_id}`, e);
      guardarPublicacionAnuncio(canal.org_id, a.ad_id, { texto: null, enlace: "(no se pudo leer)" });
    }
  }

  return hechos;
}
