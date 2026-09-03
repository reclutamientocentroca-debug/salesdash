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
import { CAMPOS_SUSCRIPCION } from "./paginas";

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

// ─────────────────────────────────────────────────────────────────────────────
// El webhook de la app: la otra mitad de la suscripción
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «LA PÁGINA ESTÁ SUSCRITA A `feed` Y LOS COMENTARIOS NO LLEGAN.»
 *
 * Porque suscribir son DOS cosas, no una, y `paginas.ts` solo hace la segunda:
 *
 *   1. LA APP declara a qué campos del objeto `page` quiere que Meta la avise,
 *      y a qué dirección. Es una sola declaración para toda la plataforma.
 *   2. CADA PÁGINA se suscribe a la app (`/subscribed_apps`), con su propia
 *      lista de campos.
 *
 * Meta entrega un evento SOLO si el campo está en las dos listas. Y ahí está la
 * avería silenciosa: al dar de alta el webhook en el panel de Meta se marca
 * `messages` —sin eso no llega nada y se nota en el acto— y `feed` se queda sin
 * marcar, porque en ese momento no hay ningún comentario que echar de menos.
 * A partir de entonces los mensajes directos entran perfectos y los comentarios
 * no existen: no hay error, no hay evento descartado, no hay nada que mirar.
 * `revisarPagina` dice «todo correcto», y tiene razón — mira la lista 2.
 *
 * Esto mira la lista 1, que es la que no se veía desde ninguna pantalla.
 */
export interface SuscripcionApp {
  /** Meta contestó a qué tiene suscrito la app. Falso es «no se pudo leer». */
  leida: boolean;
  /** La dirección a la que Meta dice que manda los eventos, tal cual. */
  callbackUrl: string | null;
  /** La nuestra, para poder compararlas a ojo cuando no coincidan. */
  callbackEsperada: string;
  /**
   * La declarada apunta a este servidor. Cuando no, no llega NADA: ni mensajes
   * ni comentarios, y el arreglo no es marcar campos sino cambiar la dirección.
   */
  callbackNuestra: boolean;
  /** Meta tiene la suscripción encendida. Una apagada no entrega nada. */
  activa: boolean;
  /** Los campos del objeto `page` que la app tiene declarados hoy. */
  campos: string[];
  /** De los que usa el canal, los que faltan. Con `feed` dentro, no hay comentarios. */
  faltan: string[];
  /** Se declararon los que faltaban durante esta revisión y Meta aceptó. */
  reparada: boolean;
  /** Lo que dijo Meta cuando algo falló, con SU texto. */
  error: string | null;
}

/** A dónde manda Meta los eventos. Sale de `APP_URL`, no hay variable propia. */
export function urlDelWebhook(): string {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/api/meta/webhook` : "";
}

/** POST a la Graph API con el token de aplicación. Ver la cabecera del módulo. */
async function mandar(ruta: string, cuerpo: Record<string, unknown>, token: string) {
  const r = await fetch(`https://graph.facebook.com/${versionGraph()}/${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...cuerpo, access_token: token }),
  });

  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;

  if (!r.ok) {
    const e = (datos.error ?? {}) as { message?: string; code?: number };
    // El token de app lleva el secreto dentro; jamás puede acabar en el texto.
    const limpio = (e.message ?? `Meta respondió ${r.status}`).split(token).join("(la app)");
    throw new ErrorMeta(limpio, e.code);
  }

  return datos;
}

/** Lo que la app tiene declarado para el objeto `page`, tal cual lo cuenta Meta. */
function leerPage(datos: Record<string, unknown>) {
  const lista = Array.isArray(datos.data) ? datos.data : [];

  for (const bruto of lista) {
    const s = (bruto ?? {}) as {
      object?: unknown;
      callback_url?: unknown;
      active?: unknown;
      fields?: unknown;
    };
    if (s.object !== "page") continue;

    const campos = (Array.isArray(s.fields) ? s.fields : [])
      .map((f) => {
        /*
         * Meta manda `[{name, version}]`, y en algunas versiones la lista
         * pelada de nombres. Se aceptan las dos: leerlo mal aquí sería decir
         * que faltan todos los campos cuando no falta ninguno, y mandar a
         * arreglar una suscripción que está perfecta.
         */
        if (typeof f === "string") return f;
        const o = (f ?? {}) as { name?: unknown };
        return typeof o.name === "string" ? o.name : "";
      })
      .filter(Boolean);

    return { callbackUrl: texto(s.callback_url), activa: s.active !== false, campos };
  }

  return null;
}

/**
 * Lee la declaración de la app y, si le faltan campos, la completa.
 *
 * Repara por lo mismo que repara `revisarPagina`: el dueño de la tienda no
 * puede tocar esto —la app de Facebook es de la plataforma, no suya—, así que
 * un diagnóstico que solo informa lo deja igual de parado. Con `reparar` en
 * falso solo mira, que es lo que hace falta en una pantalla de estado.
 */
export async function revisarSuscripcionApp(reparar = true): Promise<SuscripcionApp> {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const secreto = (process.env.META_APP_SECRET ?? "").trim();
  const esperada = urlDelWebhook();

  const vacio: SuscripcionApp = {
    leida: false, callbackUrl: null, callbackEsperada: esperada, callbackNuestra: false,
    activa: false, campos: [], faltan: [...CAMPOS_SUSCRIPCION], reparada: false, error: null,
  };

  if (!appId || !secreto) {
    return {
      ...vacio,
      error: `Falta ${!appId ? "META_APP_ID" : "META_APP_SECRET"} en el servidor.`,
    };
  }

  const token = tokenDeApp(appId, secreto);
  const leer = async () => leerPage(await pedir(`${appId}/subscriptions`, "", token));

  let page: ReturnType<typeof leerPage>;
  try {
    page = await leer();
  } catch (e) {
    return {
      ...vacio,
      error: e instanceof Error ? e.message : "Meta no dijo qué tiene suscrito la app.",
    };
  }

  const estado = (
    p: NonNullable<ReturnType<typeof leerPage>>,
    reparada: boolean,
  ): SuscripcionApp => ({
    leida: true,
    callbackUrl: p.callbackUrl,
    callbackEsperada: esperada,
    callbackNuestra: !!esperada && p.callbackUrl === esperada,
    activa: p.activa,
    campos: p.campos,
    faltan: CAMPOS_SUSCRIPCION.filter((c) => !p.campos.includes(c)),
    reparada,
    error: null,
  });

  if (page && CAMPOS_SUSCRIPCION.every((c) => page!.campos.includes(c))) {
    return estado(page, false);
  }

  const actual: SuscripcionApp = page
    ? estado(page, false)
    : {
        ...vacio,
        leida: true,
        error: "La app no tiene suscrito el objeto «page»: no le llega ningún evento.",
      };

  if (!reparar) return actual;

  /*
   * REPARAR SÍ, PERO NUNCA APUNTANDO A OTRO SITIO.
   *
   * Declarar la suscripción reescribe la dirección de entrega ENTERA. Si la que
   * hay no es la de este servidor, la app la comparte con otro despliegue —una
   * copia de pruebas, o producción mirada desde local— y repararla desde aquí
   * le corta los eventos a ese: se queda sin recibir nada y sin saber por qué.
   * Es peor que lo que se venía a arreglar, así que se dice y no se toca.
   */
  if (page && page.callbackUrl && page.callbackUrl !== esperada) {
    return {
      ...actual,
      error:
        `La app entrega los eventos en ${page.callbackUrl}, que no es este servidor. ` +
        `No se cambia desde aquí: dejaría sin recibir a lo que haya en esa dirección.`,
    };
  }

  if (!esperada) {
    return { ...actual, error: "Falta APP_URL en el servidor: no se sabe qué dirección declarar." };
  }

  const verify = (process.env.META_VERIFY_TOKEN ?? "").trim();
  if (!verify) {
    return { ...actual, error: "Falta META_VERIFY_TOKEN: Meta no puede comprobar la dirección." };
  }

  /*
   * Se declara la UNIÓN, no solo lo nuestro. Esta llamada reemplaza la lista
   * entera, así que un campo que hubiera de antes y no esté en
   * `CAMPOS_SUSCRIPCION` se perdería: arreglar los comentarios no puede apagar
   * nada que ya estuviera funcionando.
   */
  const union = [...new Set([...(page?.campos ?? []), ...CAMPOS_SUSCRIPCION])];

  try {
    await mandar(
      `${appId}/subscriptions`,
      {
        object: "page",
        callback_url: esperada,
        verify_token: verify,
        fields: union.join(","),
        include_values: true,
      },
      token,
    );
  } catch (e) {
    return {
      ...actual,
      error: e instanceof Error ? e.message : "Meta no aceptó declarar la suscripción.",
    };
  }

  // Lo que se devuelve es lo que Meta dice DESPUÉS de reparar, no lo que se
  // intentó. Misma regla que en `revisarPagina`.
  try {
    const despues = await leer();
    if (despues) return estado(despues, true);
  } catch {
    /* La declaración se aceptó; que no se pueda releer no la deshace. */
  }

  return {
    leida: true, callbackUrl: esperada, callbackEsperada: esperada, callbackNuestra: true,
    activa: true, campos: union, faltan: [], reparada: true, error: null,
  };
}
