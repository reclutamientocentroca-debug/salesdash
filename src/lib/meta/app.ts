/**
 * EN QUÉ ESTADO ESTÁ LA APP DE FACEBOOK.
 *
 * Una página de un cliente se conecta con «Continuar con Facebook», y ese botón
 * depende de algo que NO está en este servidor: la app de Meta. Mientras esa app
 * siga en Desarrollo, el botón funciona para el que la creó y para nadie más —el
 * cliente pulsa, aterriza en una pantalla de error de Facebook y no vuelve—.
 *
 * Eso no se ve desde aquí de ninguna forma. No hay error en el registro, no hay
 * evento, no hay página a medio conectar: simplemente ningún cliente consigue
 * conectar nunca, y desde dentro se ve igual que si nadie lo hubiera intentado.
 *
 * Este módulo le pregunta a Meta lo que Meta sabe y lo deja por escrito. NO
 * inventa nada: lo que no se puede leer se dice que no se pudo leer, porque un
 * diagnóstico que adivina es peor que no tenerlo —manda a arreglar lo que no
 * está roto—.
 *
 * ─── EL TOKEN DE APLICACIÓN ───
 *
 * `{app_id}|{app_secret}`. No es el token de nadie: es la app hablando de sí
 * misma, así que sirve para esto y para nada que toque a un cliente. No sale de
 * este archivo ni se guarda.
 */
import { ErrorMeta, versionGraph } from "./graph";

/** Quién puede conectar mientras la app siga en Desarrollo. */
export interface RolApp {
  nombre: string | null;
  rol: string;
}

export interface RevisionApp {
  /** Las credenciales del servidor valen: Meta contestó preguntándole por la app. */
  credenciales: boolean;
  /**
   * Están escritas en el servidor, aunque Meta las rechace.
   *
   * «No las has puesto» y «las has puesto y Meta dice que no» son dos averías
   * distintas con dos arreglos distintos, y decir la primera cuando pasa la
   * segunda manda a rellenar una variable que ya está rellena.
   */
  configuradas: boolean;
  nombre: string | null;
  /** La ficha pública de la app, para poder abrirla sin buscarla. */
  enlace: string | null;
  /**
   * Las dos direcciones que Meta EXIGE para dejar pedir la revisión. Sin ellas
   * el botón de «Enviar a revisión» ni siquiera se puede pulsar, y es el sitio
   * donde más gente se queda parada sin saber por qué.
   */
  politicaUrl: string | null;
  terminosUrl: string | null;
  /**
   * Quién tiene rol en la app. Mientras esté en Desarrollo, esta lista ES la
   * lista completa de quienes pueden conectar una página. Nula si Meta no dejó
   * leerla —hace falta un permiso que no siempre está—.
   */
  roles: RolApp[] | null;
  /** Lo que dijo Meta cuando algo no se pudo leer, con SU texto. */
  error: string | null;
}

/** La app hablando de sí misma. Ver la cabecera. */
function tokenDeApp(appId: string, secreto: string): string {
  return `${appId}|${secreto}`;
}

async function pedir(ruta: string, campos: string, token: string) {
  const url =
    `https://graph.facebook.com/${versionGraph()}/${ruta}` +
    (campos ? `?fields=${encodeURIComponent(campos)}&` : "?") +
    `access_token=${encodeURIComponent(token)}`;

  const r = await fetch(url);
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;

  if (!r.ok) {
    const e = (datos.error ?? {}) as { message?: string; code?: number };
    // El token de app lleva el secreto dentro; jamás puede acabar en el texto.
    const limpio = (e.message ?? `Meta respondió ${r.status}`).split(token).join("(la app)");
    throw new ErrorMeta(limpio, e.code);
  }

  return datos;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export async function revisarApp(): Promise<RevisionApp> {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const secreto = (process.env.META_APP_SECRET ?? "").trim();

  const vacio: RevisionApp = {
    credenciales: false, configuradas: !!appId && !!secreto, nombre: null, enlace: null,
    politicaUrl: null, terminosUrl: null, roles: null, error: null,
  };

  if (!appId || !secreto) {
    return {
      ...vacio,
      error: `Falta ${!appId ? "META_APP_ID" : "META_APP_SECRET"} en el servidor.`,
    };
  }

  const token = tokenDeApp(appId, secreto);

  /*
   * LA FICHA DE LA APP.
   *
   * Se piden todos los campos de una vez y, si Meta rechaza alguno, se vuelve a
   * pedir solo el nombre. Graph tumba la petición ENTERA por un campo que no
   * reconoce, así que sin este repliegue una versión de la API que renombre algo
   * dejaría el diagnóstico en «no se pudo leer» cuando lo único que pasa es que
   * sobraba una palabra.
   */
  let ficha: Record<string, unknown>;
  let aviso: string | null = null;

  try {
    ficha = await pedir(appId, "name,link,privacy_policy_url,terms_of_service_url", token);
  } catch (e) {
    try {
      ficha = await pedir(appId, "name", token);
      aviso = "Meta no dejó leer la política de privacidad ni los términos de esta app.";
    } catch (e2) {
      return {
        ...vacio,
        error:
          e2 instanceof Error
            ? e2.message
            : e instanceof Error
              ? e.message
              : "Meta no contestó al preguntarle por la app.",
      };
    }
  }

  /*
   * QUIÉN PUEDE CONECTAR HOY.
   *
   * Es opcional a propósito: `/roles` pide un permiso que no toda app tiene, y
   * que falle no invalida nada de lo de arriba. Se devuelve `null`, que quiere
   * decir «no se pudo leer», y no una lista vacía, que querría decir «no hay
   * nadie» —dos cosas muy distintas para quien lo lea—.
   */
  let roles: RolApp[] | null = null;

  try {
    const datos = await pedir(`${appId}/roles`, "", token);
    const lista = Array.isArray(datos.data) ? datos.data : [];

    roles = lista.map((bruto) => {
      const r = (bruto ?? {}) as Record<string, unknown>;
      return { nombre: texto(r.user) ?? texto(r.name), rol: texto(r.role) ?? "sin rol" };
    });
  } catch {
    roles = null;
  }

  return {
    credenciales: true,
    configuradas: true,
    nombre: texto(ficha.name),
    enlace: texto(ficha.link),
    politicaUrl: texto(ficha.privacy_policy_url),
    terminosUrl: texto(ficha.terms_of_service_url),
    roles,
    error: aviso,
  };
}
