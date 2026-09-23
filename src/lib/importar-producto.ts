/**
 * SalesDash — importar un producto desde el link de la propia tienda.
 *
 * La dueña pega el link de la página de un producto (de su propia web) en
 * Productos y esto trae los colores disponibles y, de cada color, sus tallas
 * —justo lo que la descripción de esa página ya dice, sin inventar nada—.
 * Se guarda como texto libre en `variantes`, que es lo mismo que lee el
 * agente vendedor: ver `textoDeLoQueVende` en `agent.ts`.
 *
 * Es DISTINTO del enlace que manda un CLIENTE en un chat (`enlace.ts`), y a
 * propósito: ahí la URL la elige un desconocido en medio de una venta y por
 * eso no se sale a buscarla —abriría la puerta a que el texto de un tercero
 * le hable al modelo—. Aquí la URL la pone la propia dueña, a mano, desde el
 * panel, para llenar SU catálogo, y lo que salga se enseña en el formulario
 * antes de guardarse: ella lo revisa igual que si lo hubiera escrito ella
 * misma.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MODELO_ANALISIS, MODELO_RESPALDO, obtenerOrg } from "./db";
import { completarJson } from "./ia";

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
// Lo que se saca de la página, sin ningún parser externo: solo lo justo.
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
  texto: string;
}

/** Lo que se puede sacar de un HTML sin salir a ejecutar su JavaScript. */
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

  return { titulo, imagenUrl, texto };
}

function urlAbsoluta(src: string | null, base: string): string | null {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Todo junto: del link al formulario.
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

export interface ImportadoDeLink {
  nombre: string | null;
  precio: number | null;
  variantes: string | null;
  fotoUrl: string | null;
}

/**
 * Abre el link, lee su descripción y saca lo que hay para llenar el
 * formulario de «Agregar producto». No guarda nada: quien llama decide si lo
 * usa, y la dueña sigue teniendo que darle a «Agregar».
 */
export async function importarProductoDeLink(orgId: number, url: string): Promise<ImportadoDeLink> {
  if (!(await urlSegura(url))) {
    throw new ErrorImportacion("Ese link no se puede abrir. Revisa que sea una dirección http o https pública.");
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; SalesDashBot/1.0; +panel de productos)" },
    });
  } catch {
    throw new ErrorImportacion("No se pudo abrir ese link.");
  }
  if (!respuesta.ok) throw new ErrorImportacion(`Esa página respondió con un error (${respuesta.status}).`);

  const tipo = respuesta.headers.get("content-type") ?? "";
  if (!tipo.includes("text/html")) {
    throw new ErrorImportacion("Ese link no es una página con una descripción que leer.");
  }

  const html = await respuesta.text();
  const { titulo, imagenUrl, texto } = extraerDeHtml(html.slice(0, 2_000_000));
  if (!texto.trim()) throw new ErrorImportacion("Esa página no trae texto que leer.");

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

  if (!datos) throw new ErrorImportacion("No se pudieron leer los colores y tallas de esa página.");

  return {
    nombre: datos.nombre?.trim() || null,
    precio: typeof datos.precio === "number" && Number.isFinite(datos.precio) ? datos.precio : null,
    variantes: formatearVariantes({ tallas: datos.tallas ?? [], colores: datos.colores ?? [] }),
    fotoUrl: urlAbsoluta(imagenUrl, url),
  };
}
