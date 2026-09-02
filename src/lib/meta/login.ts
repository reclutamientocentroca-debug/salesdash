/**
 * ENTRAR CON FACEBOOK.
 *
 * El otro camino para conectar una página: el dueño pulsa un botón, Meta abre
 * su ventana, elige la página y ya está. Sustituye a copiar un ID y un token
 * de `developers.facebook.com`, que es el paso donde se cae casi todo el mundo
 * —y donde un token pegado mal deja una página que parece conectada y no
 * recibe nada—.
 *
 * Aquí no se escribe en la base ni se le habla a ningún cliente: se cambia el
 * código que devuelve la ventana por un token, se pregunta qué páginas
 * administra esa persona y se guardan un rato en memoria. Conectar es cosa de
 * `conectar.ts`.
 *
 * ─── POR QUÉ EL TOKEN NO PASA POR EL NAVEGADOR ───
 *
 * La ventana de Meta devuelve un `code`, no un token. El cambio de código por
 * token necesita `META_APP_SECRET`, que solo existe en el servidor, así que el
 * token de página no llega a viajar al navegador ni una vez. Si viajara, viviría
 * en el historial de red del que lo mire, y con él se puede escribir en nombre
 * de la página desde cualquier sitio.
 */
import { ErrorMeta, getGraph, versionGraph } from "./graph";

export interface PaginaDisponible {
  pageId: string;
  nombre: string;
  igUserId: string | null;
  /**
   * La foto de la página. Es lo único de aquí que se ve, y no es adorno: quien
   * administra ocho páginas las reconoce por la foto mucho antes que por un
   * nombre que a veces solo se diferencia en una palabra. Elegir la equivocada
   * significa conectar el Facebook de otro negocio.
   */
  foto: string | null;
  /** El token de página. NO sale de este servidor. */
  token: string;
}

/**
 * El código que devuelve Facebook → un token con el que preguntar las páginas.
 *
 * Los dos caminos entran por aquí y no piden lo mismo:
 *
 *  - Volviendo de una REDIRECCIÓN —el botón que lleva a facebook.com— Meta
 *    exige el mismo `redirect_uri` con el que se fue, letra por letra. Sin él
 *    responde que el código no vale, sin decir por qué.
 *  - Con el SDK de JavaScript no hubo redirección, hubo una ventana, y ahí el
 *    cambio va SIN `redirect_uri`.
 *
 * Por eso `vuelta` es opcional: quien la tenga la pasa. Y si el primer intento
 * falla se prueba la otra forma antes de dar el error por bueno, que es lo que
 * evita una pantalla de «Meta no aceptó el código» por una diferencia de
 * configuración. Es un reintento, no una adivinanza: el mensaje que se propaga
 * sigue siendo el de Meta.
 */
export async function intercambiarCodigo(
  codigo: string,
  vuelta: string | null = null,
): Promise<string> {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const secreto = (process.env.META_APP_SECRET ?? "").trim();

  if (!appId || !secreto) {
    throw new ErrorMeta("Faltan META_APP_ID o META_APP_SECRET en el servidor");
  }

  const pedir = async (redirect: string | null) => {
    const p = new URLSearchParams({ client_id: appId, client_secret: secreto, code: codigo });
    if (redirect) p.set("redirect_uri", redirect);

    const r = await fetch(`https://graph.facebook.com/${versionGraph()}/oauth/access_token?${p}`);
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, d };
  };

  let { ok, d } = await pedir(vuelta);

  if (!ok) {
    // La otra forma: sin dirección de vuelta si veníamos con ella, y con la del
    // panel si no.
    const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
    const segundo = vuelta ? null : base ? `${base}/canales/meta` : null;
    if (vuelta || segundo) ({ ok, d } = await pedir(segundo));
  }

  if (!ok) {
    const e = (d.error ?? {}) as { message?: string; code?: number };
    throw new ErrorMeta(e.message ?? "Meta no aceptó el código de la ventana", e.code);
  }

  const token = typeof d.access_token === "string" ? d.access_token : "";
  if (!token) throw new ErrorMeta("Meta aceptó el código pero no devolvió ningún token");
  return token;
}

/**
 * Las páginas que administra quien acaba de entrar, con su token cada una.
 *
 * `/me/accounts` devuelve un token POR PÁGINA, que es exactamente el que hace
 * falta: el de usuario no sirve para escribir por Messenger.
 */
export async function paginasDelUsuario(token: string): Promise<PaginaDisponible[]> {
  const datos = await getGraph(
    "me/accounts",
    "id,name,access_token,instagram_business_account,picture",
    token,
  );
  const lista = Array.isArray(datos.data) ? datos.data : [];

  const paginas: PaginaDisponible[] = [];

  for (const bruto of lista) {
    const p = (bruto ?? {}) as Record<string, unknown>;
    const pageId = typeof p.id === "string" ? p.id : "";
    const tokenPagina = typeof p.access_token === "string" ? p.access_token : "";

    // Una página sin token no se puede conectar: se omite en vez de ofrecerla
    // y fallar al pulsarla.
    if (!pageId || !tokenPagina) continue;

    const ig = (p.instagram_business_account ?? {}) as { id?: string };

    /*
     * La foto viene envuelta —`picture.data.url`— y puede ser la silueta gris
     * de Facebook, que no distingue nada. Cuando lo es se descarta: mejor la
     * inicial de la página, que al menos cambia de una a otra.
     */
    const foto = (p.picture ?? {}) as { data?: { url?: string; is_silhouette?: boolean } };
    const urlFoto =
      typeof foto.data?.url === "string" && foto.data.is_silhouette !== true ? foto.data.url : null;

    paginas.push({
      pageId,
      nombre: typeof p.name === "string" ? p.name : pageId,
      igUserId: typeof ig.id === "string" ? ig.id : null,
      foto: urlFoto,
      token: tokenPagina,
    });
  }

  return paginas;
}

/*
 * ─── LA MEMORIA CORTA ENTRE ELEGIR Y CONECTAR ───
 *
 * Entre «entré con Facebook» y «conecto esta página» hay dos peticiones, y el
 * token de página tiene que sobrevivir a la primera sin bajar al navegador.
 * Vive aquí diez minutos y se olvida: ni se guarda en disco, ni se guarda
 * cifrado en la base «por si acaso», porque un token que no hace falta guardar
 * es un token que no se puede filtrar.
 *
 * Al reiniciar el servicio se pierde, y eso está bien: el dueño vuelve a pulsar
 * el botón. Es un paso de segundos, no un dato que haya que conservar.
 */
const CADUCA_MS = 10 * 60 * 1000;

const memoria = new Map<number, { paginas: PaginaDisponible[]; expira: number }>();

export function recordarPaginas(orgId: number, paginas: PaginaDisponible[]): void {
  memoria.set(orgId, { paginas, expira: Date.now() + CADUCA_MS });
}

/** Todo lo que se recuerda de esta cuenta, o vacío si caducó. */
export function paginasRecordadas(orgId: number): PaginaDisponible[] {
  const guardado = memoria.get(orgId);
  if (!guardado) return [];

  if (guardado.expira < Date.now()) {
    memoria.delete(orgId);
    return [];
  }

  return guardado.paginas;
}

export function paginaRecordada(orgId: number, pageId: string): PaginaDisponible | null {
  const guardado = memoria.get(orgId);
  if (!guardado) return null;

  if (guardado.expira < Date.now()) {
    memoria.delete(orgId);
    return null;
  }

  return guardado.paginas.find((p) => p.pageId === pageId) ?? null;
}

export function olvidarPaginas(orgId: number): void {
  memoria.delete(orgId);
}
