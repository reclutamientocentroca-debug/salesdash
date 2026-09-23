/**
 * SalesDash — importar un producto desde el link de la propia tienda.
 *
 * La dueña pega el link de la página de un producto (de su propia tienda,
 * p.ej. Roplis) y esto trae los colores disponibles y, de CADA color, sus
 * tallas —justo lo que esa página ofrece, sin inventar nada—. Se guarda como
 * texto libre en `variantes`, que es lo mismo que lee el agente vendedor: ver
 * `textoDeLoQueVende` en `agent.ts`. No hizo falta tocar el prompt del agente:
 * si el texto es exacto, el agente ya sabe contestar «¿qué colores hay en
 * talla M?» leyéndolo.
 *
 * ABRE UN NAVEGADOR DE VERDAD (Playwright), no solo pide el HTML.
 *
 * La primera versión de este archivo solo hacía `fetch(url)`, y contra Roplis
 * (y cualquier tienda armada como aplicación de una sola página) eso traía una
 * PLANTILLA VACÍA: «Nombre del producto», «Cód. ABC1234XYZ». El nombre real,
 * el precio y las variantes los arma React DESPUÉS de cargar, con JavaScript
 * que un `fetch` no ejecuta. Comprobado a mano contra un producto real de
 * Roplis (2026-09-23): sin navegador, texto de plantilla; con navegador, el
 * producto de verdad.
 *
 * Y ADEMÁS, el color y la talla en Roplis no son texto: son botones —
 * `<fieldset><legend>Color</legend><div>{botones}</div></fieldset>`, y lo
 * mismo para «Talla»—, y las tallas disponibles CAMBIAN según qué color esté
 * pinchado (un polo real: azul y gris traían S/M/L/XL, negro solo S/M/L, y una
 * cuarta variante de negro solo traía XL). Por eso se pincha cada color, como
 * lo haría un cliente, y se lee qué tallas quedan para ese color exacto — cero
 * riesgo de inventar una combinación que la tienda no vende.
 *
 * Si la página NO tiene ese patrón de botones (una tienda que sí escribe
 * «disponible en azul y negro, tallas S a XL» en la descripción), se cae al
 * modo de antes: leer el texto ya renderizado y pedirle al modelo que saque
 * las variantes de ahí, con la misma regla de no inventar.
 *
 * Es DISTINTO del enlace que manda un CLIENTE en un chat (`enlace.ts`), y a
 * propósito: ahí la URL la elige un desconocido en medio de una venta y por
 * eso no se sale a buscarla —abriría la puerta a que el texto de un tercero
 * le hable al modelo—. Aquí la URL la pone la propia dueña, para SU catálogo,
 * y lo que salga pasa por su revisión antes de guardarse.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import {
  actualizarProducto,
  listarLinksProducto,
  marcarLinkImportado,
  MODELO_ANALISIS,
  MODELO_RESPALDO,
  obtenerOrg,
  type ProductoLink,
} from "./db";
import { completarJson } from "./ia";
import { leerImporte } from "./moneda";

export class ErrorImportacion extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// El link tiene que ser uno de verdad, no un desvío hacia la propia red.
// ─────────────────────────────────────────────────────────────────────────────

const IPV4_PRIVADAS = [/^0\./, /^127\./, /^10\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

function ipPrivada(ip: string): boolean {
  if (isIP(ip) === 4) return IPV4_PRIVADAS.some((r) => r.test(ip));
  const bajo = ip.toLowerCase();
  return bajo === "::1" || bajo.startsWith("fe80:") || bajo.startsWith("fc") || bajo.startsWith("fd");
}

/**
 * ¿Este link se puede abrir? Solo http/https, sin credenciales metidas en la
 * URL, y que no resuelva a la propia red del servidor —nada de `localhost`,
 * `192.168.x.x` ni el resto de rangos privados—.
 */
export async function urlSegura(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.hostname.toLowerCase() === "localhost") return false;

  try {
    const direcciones = await lookup(u.hostname, { all: true });
    return direcciones.length > 0 && direcciones.every((d) => !ipPrivada(d.address));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se saca del HTML ya renderizado, sin ningún parser externo.
// ─────────────────────────────────────────────────────────────────────────────

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&Ntilde;/g, "Ñ");
}

function metaTag(html: string, propiedad: string): string | null {
  const escapado = propiedad.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
  const patrones = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escapado}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapado}["']`, "i"),
  ];
  for (const re of patrones) {
    const m = html.match(re);
    if (m) return decodificarEntidades(m[1].trim());
  }
  return null;
}

/** Cuánto texto de la página se le manda al modelo. De sobra para una ficha de producto. */
const MAX_TEXTO = 6000;

export interface PaginaLeida {
  titulo: string | null;
  imagenUrl: string | null;
  /** La descripción de la página (su `og:description`), para enseñarla en el panel. */
  descripcion: string | null;
  texto: string;
}

/** Cuánto de la descripción se guarda para el panel. De sobra para un párrafo de producto. */
const MAX_DESCRIPCION = 600;

/** Lo que se puede sacar de un HTML ya renderizado, sin volver a tocar el navegador. */
export function extraerDeHtml(html: string): PaginaLeida {
  const tituloEtiqueta = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null;
  const titulo = metaTag(html, "og:title") ?? (tituloEtiqueta ? decodificarEntidades(tituloEtiqueta.trim()) : null);
  const descripcionMeta = metaTag(html, "og:description") ?? metaTag(html, "description");
  const imagenUrl = metaTag(html, "og:image");

  const sinRuido = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const soloTexto = decodificarEntidades(sinRuido.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

  const texto = [descripcionMeta, soloTexto].filter(Boolean).join("\n").slice(0, MAX_TEXTO);
  const descripcion = descripcionMeta ? descripcionMeta.slice(0, MAX_DESCRIPCION) : null;

  return { titulo, imagenUrl, descripcion, texto };
}

function urlAbsoluta(src: string | null, base: string): string | null {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

/** El primer precio escrito en la página, tal cual lo lee un cliente: «RD$2,490.00», «USD 35.00». */
const PRECIO_ESCRITO = /(?:RD\$|US\$|B\/\.|₡|\$|USD)\s?[\d][\d.,]*/;
function precioDeTexto(texto: string): number | null {
  const m = texto.match(PRECIO_ESCRITO);
  return m ? leerImporte(m[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// De la descripción a «Variantes», el mismo texto libre que ya usa el catálogo.
// ─────────────────────────────────────────────────────────────────────────────

export interface DatosVariantes {
  /** Tallas que no van atadas a un color —o el producto no distingue por color—. */
  tallas: string[];
  /** Un color, con SUS tallas disponibles. */
  colores: { color: string; tallas: string[] }[];
}

function capitalizar(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * El texto que va al campo Variantes. Con colores, uno por línea de la forma
 * «Negro: S, M, L»; sin colores, solo las tallas. `null` si no hay nada que
 * poner —una página sin variantes no debe borrar lo que ya hubiera escrito.
 */
export function formatearVariantes(d: DatosVariantes): string | null {
  const colores = (d.colores ?? [])
    .map((c) => ({ color: c.color?.trim() ?? "", tallas: (c.tallas ?? []).map((t) => t.trim()).filter(Boolean) }))
    .filter((c) => c.color.length > 0);

  if (colores.length) {
    return colores
      .map((c) => (c.tallas.length ? `${capitalizar(c.color)}: ${c.tallas.join(", ")}` : capitalizar(c.color)))
      .join(" · ");
  }

  const tallas = (d.tallas ?? []).map((t) => t.trim()).filter(Boolean);
  return tallas.length ? `Tallas: ${tallas.join(", ")}` : null;
}

/**
 * COMBINA lo leído de VARIOS links del mismo producto en una sola lista de
 * colores. Hace falta porque en Roplis un mismo artículo de la dueña a veces
 * son varias fichas separadas —un link por color, no botones dentro de una
 * sola página— y el catálogo necesita verlos como UN producto con todos sus
 * colores. Un color que aparece en más de un link junta sus tallas sin
 * repetirlas.
 */
export function combinarVariantes(partes: DatosVariantes[]): DatosVariantes {
  const colores = new Map<string, Set<string>>();
  const tallasSueltas = new Set<string>();

  for (const parte of partes) {
    for (const c of parte.colores ?? []) {
      const nombre = c.color?.trim();
      if (!nombre) continue;
      const tallas = colores.get(nombre) ?? new Set<string>();
      for (const t of c.tallas ?? []) if (t.trim()) tallas.add(t.trim());
      colores.set(nombre, tallas);
    }
    for (const t of parte.tallas ?? []) if (t.trim()) tallasSueltas.add(t.trim());
  }

  return {
    colores: [...colores.entries()].map(([color, tallas]) => ({ color, tallas: [...tallas] })),
    tallas: [...tallasSueltas],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// El navegador. Un Chromium real, lanzado dentro del propio servidor.
// ─────────────────────────────────────────────────────────────────────────────

const TIEMPO_NAVEGACION_MS = 20_000;
const ESPERA_HIDRATACION_MS = 1_500;
const ESPERA_TRAS_CLICK_MS = 500;

/**
 * `--no-sandbox`: dentro de un contenedor Docker, sin esto Chromium no
 * arranca —el sandbox de Linux necesita privilegios que el contenedor no da—.
 * Es el mismo trato que le da cualquier CI que corre Chromium en Docker.
 */
async function abrirNavegador(): Promise<Browser> {
  return chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
}

interface ColorLeido {
  color: string;
  tallas: string[];
  imagenUrl: string | null;
}

/**
 * Busca dentro de la página el `<fieldset>` cuyo `<legend>` empieza con el
 * prefijo dado («color», «talla», «size»…) y devuelve los botones de su
 * primer `<div>` hijo. Es el patrón exacto que usa Roplis para sus
 * selectores de variante — comprobado a mano contra un producto real.
 */
async function botonesDelFieldset(page: Page, prefijo: string): Promise<string[]> {
  return page.evaluate((prefijo) => {
    const legend = [...document.querySelectorAll("legend")].find((l) =>
      l.textContent?.trim().toLowerCase().startsWith(prefijo),
    );
    const contenedor = legend?.parentElement?.querySelector(":scope > div");
    const botones = contenedor ? [...contenedor.querySelectorAll("button")] : [];
    return botones.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()).filter(Boolean);
  }, prefijo);
}

/** Pincha el botón de color en esa POSICIÓN —nunca por su nombre, para no depender de cómo esté escapado—. */
async function clickColorEnIndice(page: Page, indice: number): Promise<void> {
  await page.evaluate((indice) => {
    const legend = [...document.querySelectorAll("legend")].find((l) =>
      l.textContent?.trim().toLowerCase().startsWith("color"),
    );
    const contenedor = legend?.parentElement?.querySelector(":scope > div");
    const botones = contenedor ? [...contenedor.querySelectorAll("button")] : [];
    (botones[indice] as HTMLButtonElement | undefined)?.click();
  }, indice);
}

async function imagenPrincipal(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const img =
      document.querySelector('button[aria-label*="mpliar" i] img') ??
      document.querySelector('img[alt*="producto" i], img[alt*="product" i]');
    return img?.getAttribute("src") ?? null;
  });
}

export interface PaginaRenderizada {
  nombre: string | null;
  /** Con colores propios, uno por cada botón de color pinchado. Vacío si la página no distingue color. */
  colores: ColorLeido[];
  /** Tallas sueltas, cuando la página tiene botones de talla pero ninguno de color. */
  tallas: string[];
  imagenUrl: string | null;
  precio: number | null;
  /** La descripción de la página, para enseñarla en el panel junto a la foto. */
  descripcion: string | null;
  /** El texto visible, para el respaldo por IA cuando no hay botones que leer. */
  texto: string;
}

/**
 * Abre `url` con un navegador de verdad y lee lo que haya. Si encuentra el
 * patrón de botones de color, pincha CADA UNO y anota sus tallas y su foto —
 * ninguna combinación que la página no ofrezca de verdad—.
 */
async function leerConNavegador(page: Page, url: string): Promise<PaginaRenderizada> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIEMPO_NAVEGACION_MS });
  await page.waitForTimeout(ESPERA_HIDRATACION_MS);

  const nombre = (await page.locator("h1").first().innerText().catch(() => null))?.trim() || null;
  const textoVisible = await page.evaluate(() => document.body.innerText).catch(() => "");
  const precio = precioDeTexto(textoVisible);

  const nombresColores = await botonesDelFieldset(page, "color");

  const colores: ColorLeido[] = [];
  let fotoAnterior = await imagenPrincipal(page);
  for (let i = 0; i < nombresColores.length; i++) {
    /*
     * SIEMPRE se pincha, incluido el primero: el color con el que abrió la
     * página (el de la URL) no tiene por qué ser el primer botón de la lista,
     * y leer sin pinchar arriesgaría a colgarle las tallas de OTRO color al
     * nombre equivocado.
     */
    await clickColorEnIndice(page, i);
    await page.waitForTimeout(ESPERA_TRAS_CLICK_MS);

    /*
     * LA FOTO CAMBIA MÁS DESPACIO QUE LAS TALLAS. Un click cambiaba la lista
     * de tallas al instante pero la imagen tardaba un poco más en actualizar
     * su `src`, y leerla justo después de los 500ms de siempre se quedaba con
     * la foto del color ANTERIOR —Gris y Negro salían con la foto de Azul—.
     * Se espera de verdad a que el `src` cambie, con un tope para cuando de
     * verdad no cambia (un solo color, o la página no tiene foto por color).
     */
    await page
      .waitForFunction(
        (anterior) => {
          const img =
            document.querySelector('button[aria-label*="mpliar" i] img') ??
            document.querySelector('img[alt*="producto" i], img[alt*="product" i]');
          const actual = img?.getAttribute("src") ?? null;
          return actual && actual !== anterior;
        },
        fotoAnterior,
        { timeout: 3_000 },
      )
      .catch(() => {});

    const tallas = (await botonesDelFieldset(page, "talla")).length
      ? await botonesDelFieldset(page, "talla")
      : await botonesDelFieldset(page, "size");
    const fotoActual = await imagenPrincipal(page);
    colores.push({ color: nombresColores[i]!, tallas, imagenUrl: urlAbsoluta(fotoActual, url) });
    fotoAnterior = fotoActual;
  }

  const tallasSueltas = colores.length
    ? []
    : (await botonesDelFieldset(page, "talla")).length
      ? await botonesDelFieldset(page, "talla")
      : await botonesDelFieldset(page, "size");

  const html = await page.content();
  const pagina = extraerDeHtml(html);
  const imagenUrl =
    colores[0]?.imagenUrl ?? urlAbsoluta(pagina.imagenUrl, url) ?? urlAbsoluta(await imagenPrincipal(page), url);

  return { nombre, colores, tallas: tallasSueltas, imagenUrl, precio, descripcion: pagina.descripcion, texto: pagina.texto };
}

// ─────────────────────────────────────────────────────────────────────────────
// El respaldo por IA, para páginas que solo escriben las variantes en texto.
// ─────────────────────────────────────────────────────────────────────────────

const PROMPT_EXTRACCION = `Eres un asistente que lee la página de un producto de una tienda online y saca sus variantes para un catálogo.

Responde SOLO con este JSON, sin texto adicional y sin backticks ni comentarios:
{"nombre": string|null, "precio": number|null, "tallas": string[], "colores": [{"color": string, "tallas": string[]}]}

- "colores": un elemento por cada color que la página diga que está disponible, con SOLO las tallas que la página ofrece para ESE color.
- "tallas": las tallas generales, solo cuando la página NO distingue tallas por color. Vacío si ya las diste dentro de "colores".
- "nombre": el nombre corto del producto, tal como lo llama la página. null si no es claro.
- "precio": el precio de una unidad, en número, sin símbolo de moneda ni separadores de miles. null si no aparece.
- NUNCA inventes un color o una talla que la página no mencione. Si la página no distingue variantes, deja "tallas" y "colores" en listas vacías.`;

interface SalidaIA {
  nombre?: string | null;
  precio?: number | null;
  tallas?: string[];
  colores?: { color: string; tallas: string[] }[];
}

async function extraerConIA(orgId: number, titulo: string | null, texto: string): Promise<SalidaIA | null> {
  if (!texto.trim()) return null;

  const org = obtenerOrg(orgId);
  const modelo = org?.modelo_analisis ?? MODELO_ANALISIS;

  const { datos } = await completarJson<SalidaIA>({
    orgId,
    proposito: "analisis",
    modelo,
    respaldo: MODELO_RESPALDO,
    mensajes: [
      { role: "system", content: PROMPT_EXTRACCION },
      { role: "user", content: `Título de la página: ${titulo ?? "(sin título)"}\n\nTexto de la página:\n${texto}` },
    ],
    maxTokens: 500,
    temperatura: 0,
  });

  return datos;
}

// ─────────────────────────────────────────────────────────────────────────────
// El LISTADO de una categoría (o el catálogo entero): varios productos de un
// solo link, sin entrar a la página de cada uno.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductoDeCategoria {
  nombre: string | null;
  precio: number | null;
  fotoUrl: string | null;
  /** El link a la página de ESE producto, para poder pedirle luego sus colores y tallas. */
  url: string;
}

/**
 * Lee una página de LISTADO —una categoría, o el catálogo completo de la
 * tienda— y saca cada producto que enseña: su nombre, precio, foto y el link
 * a su propia página.
 *
 * A propósito NO abre cada producto —eso es lo que hace `importarProductoDeLink`,
 * y pedírselo a un listado de veinte productos tardaría minutos—. Es solo lo
 * que ya se ve en la cuadrícula, tal como lo vería un cliente entrando a esa
 * categoría. Buscarle colores y tallas a cada uno queda para después, un
 * producto a la vez, con el link que aquí se guarda.
 *
 * Es el patrón exacto de tarjeta que usa Roplis (comprobado a mano,
 * 2026-09-24): cada producto es un `<article>` dentro de `#products`, con su
 * nombre en un `<h3>`, el precio escrito como texto y un `<a href>` a su
 * propia página.
 */
export async function listarProductosDeCategoria(url: string): Promise<ProductoDeCategoria[]> {
  if (!(await urlSegura(url))) {
    throw new ErrorImportacion("Ese link no se puede abrir. Revisa que sea una dirección http o https pública.");
  }

  const browser = await abrirNavegador();
  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (compatible; SalesDashBot/1.0; +panel de productos)" });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIEMPO_NAVEGACION_MS });
    } catch (e) {
      throw new ErrorImportacion(`No se pudo abrir esa página: ${(e as Error).message.slice(0, 200)}`);
    }
    await page.waitForSelector("#products article", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);

    const crudos = await page.evaluate(() => {
      const arts = [...document.querySelectorAll("#products article")];
      return arts.map((art) => {
        const h3 = art.querySelector("h3");
        const nombre = h3?.textContent?.trim() || null;
        const href =
          [...art.querySelectorAll("a[href]")]
            .map((a) => a.getAttribute("href"))
            .find((h): h is string => !!h && h.startsWith("/") && !h.startsWith("/store")) ?? null;
        const imagenUrl = art.querySelector("img")?.getAttribute("src") ?? null;
        const hoja = [...art.querySelectorAll("*")].find(
          (e) => e.children.length === 0 && /(RD\$|US\$|B\/\.|₡|\$|USD)/.test(e.textContent ?? ""),
        );
        return { nombre, href, imagenUrl, precioTexto: hoja?.textContent?.trim() ?? null };
      });
    });
    await page.close().catch(() => {});

    const vistos = new Set<string>();
    const productos: ProductoDeCategoria[] = [];
    for (const c of crudos) {
      const href = urlAbsoluta(c.href, url);
      if (!href || vistos.has(href)) continue;
      vistos.add(href);
      productos.push({
        nombre: c.nombre,
        precio: c.precioTexto ? precioDeTexto(c.precioTexto) : null,
        fotoUrl: urlAbsoluta(c.imagenUrl, url),
        url: href,
      });
    }
    return productos;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Todo junto: del link al formulario (o al link guardado de un producto).
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportadoDeLink {
  nombre: string | null;
  precio: number | null;
  /** Formateado, listo para el campo Variantes. */
  variantes: string | null;
  fotoUrl: string | null;
  /** La descripción de la página, para enseñarla en el panel junto a la foto. */
  descripcion: string | null;
  /** Crudo, para poder combinarlo con lo leído de otros links del mismo producto. Ver `combinarVariantes`. */
  datos: DatosVariantes;
}

/**
 * Abre `url`, lee su producto y saca lo que hay. No guarda nada: quien llama
 * decide qué hacer con el resultado.
 *
 * `navegador`: para importar varios links seguidos (de un mismo producto, o
 * de un lote) sin pagar el arranque de Chromium en cada uno. Sin él, abre y
 * cierra su propio navegador.
 */
export async function importarProductoDeLink(
  orgId: number,
  url: string,
  navegador?: Browser,
): Promise<ImportadoDeLink> {
  if (!(await urlSegura(url))) {
    throw new ErrorImportacion("Ese link no se puede abrir. Revisa que sea una dirección http o https pública.");
  }

  const propio = !navegador;
  const browser = navegador ?? (await abrirNavegador());

  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (compatible; SalesDashBot/1.0; +panel de productos)" });
    let leido: PaginaRenderizada;
    try {
      leido = await leerConNavegador(page, url);
    } catch (e) {
      throw new ErrorImportacion(`No se pudo abrir esa página: ${(e as Error).message.slice(0, 200)}`);
    } finally {
      await page.close().catch(() => {});
    }

    // Con botones de color o de talla ya no hace falta preguntarle a la IA:
    // lo que se pinchó es exactamente lo que la tienda ofrece.
    if (leido.colores.length || leido.tallas.length) {
      const datos: DatosVariantes = { colores: leido.colores, tallas: leido.tallas };
      return {
        nombre: leido.nombre,
        precio: leido.precio,
        variantes: formatearVariantes(datos),
        fotoUrl: leido.imagenUrl,
        descripcion: leido.descripcion,
        datos,
      };
    }

    // Sin botones que leer: la página solo escribe las variantes en prosa.
    if (!leido.texto.trim()) throw new ErrorImportacion("Esa página no trae texto que leer.");

    const salida = await extraerConIA(orgId, leido.nombre, leido.texto);
    if (!salida) throw new ErrorImportacion("No se pudieron leer los colores y tallas de esa página.");

    const datos: DatosVariantes = { tallas: salida.tallas ?? [], colores: salida.colores ?? [] };
    return {
      nombre: leido.nombre ?? salida.nombre?.trim() ?? null,
      precio: leido.precio ?? (typeof salida.precio === "number" && Number.isFinite(salida.precio) ? salida.precio : null),
      variantes: formatearVariantes(datos),
      fotoUrl: leido.imagenUrl,
      descripcion: leido.descripcion,
      datos,
    };
  } finally {
    if (propio) await browser.close().catch(() => {});
  }
}

/**
 * Importa varios links SEGUIDOS con un solo navegador —los de un mismo
 * producto, uno por color cuando Roplis los separa en fichas distintas en
 * vez de botones dentro de una sola página—. Un link que falla no tumba a
 * los demás: se guarda su error y se sigue con el resto.
 */
export async function importarVariosLinks(
  orgId: number,
  urls: string[],
): Promise<{ url: string; resultado: ImportadoDeLink | null; error: string | null }[]> {
  if (!urls.length) return [];

  const browser = await abrirNavegador();
  const resultados: { url: string; resultado: ImportadoDeLink | null; error: string | null }[] = [];
  try {
    for (const url of urls) {
      try {
        const resultado = await importarProductoDeLink(orgId, url, browser);
        resultados.push({ url, resultado, error: null });
      } catch (e) {
        resultados.push({ url, resultado: null, error: e instanceof Error ? e.message : "No se pudo importar." });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return resultados;
}

// ─────────────────────────────────────────────────────────────────────────────
// De los links guardados de un producto al catálogo. Aquí vive la memoria: un
// link que ya se importó no se vuelve a tocar salvo que se pida a propósito.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoImportacionProducto {
  /** Cuántos links de este producto se abrieron en esta pasada. */
  intentados: number;
  /** Los que no se pudieron leer, con su motivo. */
  fallidos: { url: string; error: string }[];
  variantes: string | null;
  fotoUrl: string | null;
  descripcion: string | null;
}

/**
 * Importa los links de UN producto y actualiza tanto cada link (su caché,
 * `producto_links`) como el producto (`variantes` y `foto_url`, combinando lo
 * que traiga CADA link con `combinarVariantes`).
 *
 * `soloPendientes` (por defecto) es la memoria que pidió la dueña: un link
 * que ya se importó una vez no se vuelve a abrir. `false` fuerza a repetirlos
 * todos —el botón «Actualizar» del panel, para cuando cambia el stock—.
 */
export async function importarLinksDeProducto(
  orgId: number,
  productoId: number,
  soloPendientes = true,
): Promise<ResultadoImportacionProducto> {
  const links = listarLinksProducto(orgId, productoId);
  const porImportar = soloPendientes ? links.filter((l) => l.importado_at === null) : links;

  const fallidos: { url: string; error: string }[] = [];

  if (porImportar.length) {
    const resultados = await importarVariosLinks(orgId, porImportar.map((l) => l.url));
    for (let i = 0; i < porImportar.length; i++) {
      const link = porImportar[i]!;
      const { resultado, error } = resultados[i]!;
      marcarLinkImportado(orgId, link.id, {
        datos: resultado ? JSON.stringify(resultado.datos) : null,
        fotoUrl: resultado?.fotoUrl ?? null,
        descripcion: resultado?.descripcion ?? null,
        error,
      });
      if (error) fallidos.push({ url: link.url, error });
    }
  }

  // Se relee de la base: los que se acaban de importar más los que ya
  // estaban en caché de una pasada anterior, todos aportan al combinado.
  const todos = listarLinksProducto(orgId, productoId);
  const combinado = combinarVariantes(todos.map(datosDeLink).filter((d): d is DatosVariantes => d !== null));
  const variantes = formatearVariantes(combinado);
  const fotoUrl = todos.find((l) => l.foto_url)?.foto_url ?? null;
  const descripcion = todos.find((l) => l.descripcion)?.descripcion ?? null;

  /*
   * Sin nada nuevo que decir, no se pisa lo que ya hubiera. Un lote donde
   * TODOS los links fallan no debe borrar unas variantes, una foto o una
   * descripción que la dueña ya tenía escritas a mano o de una importación
   * anterior.
   */
  actualizarProducto(orgId, productoId, {
    ...(variantes !== null ? { variantes } : {}),
    ...(fotoUrl !== null ? { foto_url: fotoUrl } : {}),
    ...(descripcion !== null ? { descripcion } : {}),
  });

  return { intentados: porImportar.length, fallidos, variantes, fotoUrl, descripcion };
}

function datosDeLink(link: ProductoLink): DatosVariantes | null {
  if (!link.datos) return null;
  try {
    return JSON.parse(link.datos) as DatosVariantes;
  } catch {
    return null;
  }
}
