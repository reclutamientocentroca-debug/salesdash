/**
 * SalesDash — la apertura segura: vender de la descripción, sin modelo.
 *
 * ═══ EL PRIMER MENSAJE NUNCA ES «UN MOMENTO, POR FAVOR» ═══
 *
 * El revisor puede parar dos veces seguidas lo que el agente escribió, y
 * hasta ahora entonces salía una línea de espera y el hilo pasaba a una
 * persona. En medio de una venta es lo prudente; en el PRIMER mensaje es
 * perder al cliente: escribió por un anuncio, con el producto y el precio
 * delante, y lo que recibe es «un representante le confirma ese dato».
 *
 * Aquí se arma la apertura sin llamar a ningún modelo, copiando de la
 * descripción del anuncio lo único que hace falta: el artículo, tal cual lo
 * nombra la descripción, y su precio, tal cual está escrito. Y debajo la
 * primera pregunta del orden de venta según lo que sea el artículo. No puede
 * inventar nada porque no escribe nada que no esté en la descripción.
 *
 * Si la descripción no trae precio, no hay apertura segura: ahí sí toca la
 * frase de transferencia, que es lo que el guion manda cuando no hay precio.
 */
import type { DatosPais } from "@/agents";

const EMOJIS = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/** Palabras de relleno con las que abren los anuncios y que no nombran nada. */
const RELLENO = /^(¡?compra seguro!?|solo|oferta|promoci[oó]n|nuevo|nueva|disponible|¡?atenci[oó]n!?|hoy)\s*[:!.-]*\s*/i;

/** Ropa y calzado: la primera pregunta es la talla o el número. */
const ROPA = /\b(camisa|camisas|pantal[oó]n|pantalones|jean|jeans|short|shorts|vestido|blusa|polo|t-?shirt|franela|chacabana|chaqueta|abrigo|su[eé]ter|sudadera|conjunto|falda|bermuda|correa|correas|cintur[oó]n|cinturones)\b/i;
const CALZADO = /\b(zapato|zapatos|tenis|bota|botas|mocas[ií]n|mocasines|sandalia|sandalias|calzado|zapatilla|zapatillas|chancleta|chancletas)\b/i;

/** El primer importe con el símbolo del país, tal cual está escrito. */
export function precioDeLaDescripcion(descripcion: string, simbolo: string): string | null {
  const s = simbolo.replace(/[$.]/g, (c) => `\\${c}`);
  const m = descripcion.match(new RegExp(`${s}\\s?\\d[\\d.,]*\\d|${s}\\s?\\d`));
  if (!m) return null;
  return m[0].replace(/\s+/g, "").replace(/[.,]$/, "");
}

/**
 * EL ARTÍCULO, con las palabras de la propia descripción: lo que hay antes del
 * primer precio, sin emojis ni relleno, recortado a una frase.
 */
export function articuloDeLaDescripcion(descripcion: string, simbolo: string): string | null {
  const sinEmojis = descripcion.replace(EMOJIS, " ").replace(/\s+/g, " ").trim();
  const s = simbolo.replace(/[$.]/g, (c) => `\\${c}`);
  const antesDelPrecio = sinEmojis.split(new RegExp(`\\s*(?:—|-|–|:)?\\s*(?:solo|a|por|en)?\\s*${s}`, "i"))[0] ?? "";

  // Fuera el relleno con el que abren los anuncios —«¡COMPRA SEGURO!»,
  // «OFERTA»—, las veces que haga falta, antes de quedarse con la primera frase.
  let articulo = antesDelPrecio.trim();
  for (let previo = ""; previo !== articulo; ) {
    previo = articulo;
    articulo = articulo.replace(RELLENO, "").replace(/^[\s!¡.:,;—–-]+/, "");
  }
  articulo = articulo.split(/[.?\n]/)[0] ?? "";
  articulo = articulo.replace(/[\s!¡.:,;—–-]+$/, "").trim();
  if (articulo.length < 3) return null;
  if (articulo.length > 70) articulo = `${articulo.slice(0, 69).trimEnd()}…`;
  // «ZAPATOS DCM ESTILO» se lee mejor como «Zapatos DCM Estilo» que a gritos.
  if (articulo === articulo.toUpperCase()) {
    articulo = articulo.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase());
  }
  return articulo;
}

/** La primera pregunta del orden de venta, según lo que sea el artículo. */
export function primeraPregunta(descripcion: string, d: DatosPais): string {
  const texto = descripcion;
  const tu = d.trato === "tu";
  if (CALZADO.test(texto)) return tu ? "¿Qué número calzas?" : "¿Qué número calza?";
  if (ROPA.test(texto)) return tu ? "¿Qué talla necesitas?" : "¿Qué talla necesita?";
  switch (d.codigo) {
    case "do":
      return "Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?";
    case "cr":
      return "Te lo enviamos a todo el país. ¿En qué cantón estás?";
    default:
      return tu ? "¿A qué corregimiento te lo enviamos?" : "¿A qué corregimiento se lo enviamos?";
  }
}

/**
 * LA APERTURA, entera: saludo, artículo con su precio, y la primera pregunta.
 * Null si la descripción no trae precio: entonces no hay nada seguro que decir.
 */
export function aperturaSegura(
  d: DatosPais,
  anuncio: { producto_anuncio?: string | null; descripcion_anuncio?: string | null } | null,
  saludo: string,
): string | null {
  const descripcion = anuncio?.descripcion_anuncio?.trim() ?? "";
  if (!descripcion) return null;

  const precio = precioDeLaDescripcion(descripcion, d.moneda.simbolo);
  if (!precio) return null;

  const articulo = articuloDeLaDescripcion(descripcion, d.moneda.simbolo) ?? anuncio?.producto_anuncio?.trim();
  if (!articulo) return null;

  const cuerpo = d.trato === "tu"
    ? `${articulo} está disponible, en ${precio}.`
    : `${articulo} está disponible, en ${precio}.`;

  return `${saludo}\n\n${cuerpo}\n\n${primeraPregunta(descripcion, d)}`;
}
