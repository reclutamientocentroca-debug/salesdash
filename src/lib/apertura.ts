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
import { importe, zonaDelCliente } from "@/agents/armar";
import type { FichaDelPedido } from "./memoria";

/** Sin tildes ni mayúsculas, para comparar. */
function llano(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

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
  if (ROPA.test(texto)) return tu ? "¿Qué talla te interesa?" : "¿Qué talla le interesa?";
  switch (d.codigo) {
    case "do":
      return "Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?";
    case "cr":
      return tu ? "Te lo enviamos a todo el país. ¿En qué cantón estás?" : "Le enviamos a todo el país. ¿En qué cantón se encuentra?";
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

/**
 * LA RESPUESTA MÍNIMA, a mitad de venta, cuando el revisor paró dos veces lo
 * que escribió el agente. Nunca es «un momento, un representante»: es la
 * siguiente pregunta del orden de venta según lo que ya se sabe del pedido,
 * y nada más. Corta, correcta y sin transferir. En el siguiente turno el
 * agente vuelve a intentarlo con más contexto.
 */
export function respuestaMinima(
  d: DatosPais,
  ficha: FichaDelPedido,
  anuncio: { descripcion_anuncio?: string | null } | null,
  opciones: {
    /** Lo último que escribió el cliente: si es una pregunta, se le contesta antes. */
    ultimoDelCliente?: string | null;
    /** Lo último que mandó el agente: la misma pregunta no sale dos veces seguidas. */
    ultimoDelAgente?: string | null;
    /** Dónde está el cliente, si se sabe: decide qué envío se le dice. */
    lugar?: string | null;
  } = {},
): string {
  const descripcion = anuncio?.descripcion_anuncio ?? "";
  const llevaTalla = ROPA.test(descripcion) || CALZADO.test(descripcion);

  const paso: PasoDelPedido =
    llevaTalla && !ficha.talla ? "talla" : !ficha.direccion ? "direccion" : !ficha.nombre ? "nombre" : "resumen";

  let pregunta = preguntaDelPaso(d, paso, descripcion);

  /*
   * LA MISMA PREGUNTA NO SALE DOS VECES SEGUIDAS. El caso real: «¿Qué número
   * calza?» tres veces, una detrás de otra. Si lo último que mandó el agente
   * es exactamente esto, se pregunta de otra forma.
   */
  const anterior = opciones.ultimoDelAgente ? llano(opciones.ultimoDelAgente).replace(/\s+/g, " ").trim() : "";
  if (anterior && anterior === llano(pregunta).replace(/\s+/g, " ").trim()) {
    pregunta = otraFormaDePreguntar(d, paso, descripcion);
  }

  // Y si el cliente preguntó algo, se le contesta antes de seguir.
  const directa = respuestaDirecta(d, opciones.ultimoDelCliente, anuncio, opciones.lugar);
  return directa ? `${directa}\n\n${pregunta}` : pregunta;
}

type PasoDelPedido = "talla" | "direccion" | "nombre" | "resumen";

/** La pregunta de cada paso del pedido, en el orden de venta. */
function preguntaDelPaso(d: DatosPais, paso: PasoDelPedido, descripcion: string): string {
  const tu = d.trato === "tu";
  switch (paso) {
    case "talla":
      return primeraPregunta(descripcion, d);
    case "direccion":
      switch (d.codigo) {
        case "do":
          return "Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?";
        case "cr":
          return tu ? "Te lo enviamos a todo el país. ¿En qué cantón estás?" : "Le enviamos a todo el país. ¿En qué cantón se encuentra?";
        default:
          return tu ? "¿A qué corregimiento te lo enviamos?" : "¿A qué corregimiento se lo enviamos?";
      }
    case "nombre":
      return "¿A nombre de quién sale el pedido?";
    case "resumen":
      return tu
        ? "Perfecto, ya tengo tus datos. Ahora mismo te preparo el resumen del pedido."
        : "Perfecto, ya tengo sus datos. Ahora mismo le preparo el resumen de su pedido.";
  }
}

/** La misma pregunta con otras palabras, para cuando la anterior quedó sin contestar. */
function otraFormaDePreguntar(d: DatosPais, paso: PasoDelPedido, descripcion: string): string {
  const tu = d.trato === "tu";
  switch (paso) {
    case "talla":
      if (CALZADO.test(descripcion)) {
        return tu ? "Para apartarlo necesito tu número de calzado. ¿Cuál es?" : "Para apartárselo necesito el número que calza. ¿Cuál es?";
      }
      return tu ? "Para apartarlo necesito tu talla. ¿Cuál te interesa?" : "Para apartárselo necesito su talla. ¿Cuál le interesa?";
    case "direccion":
      switch (d.codigo) {
        case "do":
          return "¿A qué provincia se lo enviamos?";
        case "cr":
          return tu ? "¿A qué cantón te lo enviamos?" : "¿A qué cantón se lo enviamos?";
        default:
          return tu ? "¿En qué corregimiento estás?" : "¿En qué corregimiento se encuentra?";
      }
    case "nombre":
      return tu ? "¿Con qué nombre lo dejamos?" : "¿Con qué nombre lo dejamos?";
    case "resumen":
      return preguntaDelPaso(d, paso, descripcion);
  }
}

/** De qué va la pregunta del cliente, si es una de las que se contestan solas. */
export type PreguntaDelCliente = "ubicacion" | "envio" | "pago" | "precio";

/**
 * QUÉ PREGUNTÓ EL CLIENTE. Solo lo que tiene una respuesta fija en los datos
 * del país o en la descripción del anuncio: dónde están, el envío, cómo se
 * paga y el precio. Lo demás lo contesta el agente con su criterio.
 */
export function preguntaDelCliente(texto: string | null | undefined): PreguntaDelCliente | null {
  const t = llano(texto ?? "").trim();
  if (!t) return null;
  if (/\b(donde (estan|esta|queda|quedan|tuta|ta|se ubican|se encuentran|es la tienda|estan ubicados|los encuentro|puedo ir)|ubicad[oa]s?|tienda fisica|local fisico|direccion de la tienda)\b/.test(t)) return "ubicacion";
  if (/\b(envio|envios|envian|delivery|entregan|mandan)\b/.test(t) && /\?|cuanto|como|hacen|tienen|hay/.test(t)) return "envio";
  if (/\b(pago|pagar|pagos|se paga|forma de pago|contra entrega|transferencia|tarjeta|es seguro|es confiable|confiable)\b/.test(t)) return "pago";
  if (/\b(precio|cuanto (cuesta|vale|es|sale)|valor)\b/.test(t) && !/envio|delivery/.test(t)) return "precio";
  return null;
}

/**
 * LA CONTESTACIÓN FIJA a esa pregunta, sin modelo: sale de los datos del país
 * y de la descripción del anuncio. Null si no hay nada seguro que decir.
 */
export function respuestaDirecta(
  d: DatosPais,
  ultimoDelCliente: string | null | undefined,
  anuncio: { descripcion_anuncio?: string | null } | null,
  lugar?: string | null,
): string | null {
  const tipo = preguntaDelCliente(ultimoDelCliente);
  if (!tipo) return null;

  switch (tipo) {
    case "ubicacion":
      return d.ubicacion.tiendaFisica;
    case "pago":
      return d.pagoAlCliente;
    case "precio": {
      const descripcion = anuncio?.descripcion_anuncio ?? "";
      const precio = precioDeLaDescripcion(descripcion, d.moneda.simbolo);
      if (!precio) return null;
      const articulo = articuloDeLaDescripcion(descripcion, d.moneda.simbolo);
      return articulo ? `${articulo} está en ${precio}.` : `Está en ${precio}.`;
    }
    case "envio": {
      const zona = zonaDelCliente(d, lugar);
      if (zona === "resto") return `El envío a su zona le sale en ${importe(d, d.envio.restoDelPais.costo)}.`;
      if (zona) return `El envío a ${zona.nombre} le sale en ${importe(d, zona.costo)}.`;
      const partes = d.envio.zonas.map((z) => `${importe(d, z.costo)} en ${z.nombre}`);
      partes.push(`${importe(d, d.envio.restoDelPais.costo)} al resto del país`);
      return `El envío es ${partes.join(" y ")}.`;
    }
  }
}
