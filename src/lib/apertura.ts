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
import { TALLAS_BASE } from "@/agents/base-comportamiento";
import { FRASE_DE_TRANSFERENCIA } from "@/agents/paises/rd-guion";
import { MARCADOR_POR_DEFECTO } from "./cierre";
import type { FichaDelPedido } from "./memoria";
import { leerImporte } from "./moneda";
import { contieneLugar, nombresDeLugar } from "./envio";

/** Sin tildes ni mayúsculas, para comparar. */
function llano(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const EMOJIS = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/** Palabras de relleno con las que abren los anuncios y que no nombran nada. */
const RELLENO = /^(¡?compra seguro!?|solo|oferta|promoci[oó]n|nuevo|nueva|disponible|¡?atenci[oó]n!?|hoy)\s*[:!.-]*\s*/i;

/** Ropa y calzado: la primera pregunta es la talla o el número. */
const ROPA = /\b(camisa|camisas|pantal[oó]n|pantalones|jean|jeans|short|shorts|vestido|blusa|polo|t-?shirt|franela|chacabana|chaqueta|abrigo|su[eé]ter|sudadera|conjunto|falda|bermuda|correa|correas|cintur[oó]n|cinturones|faja|fajas)\b/i;
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
      return "¿A dónde se lo enviamos?";
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
    /** El teléfono del chat: va en el resumen como celular cuando el cliente no dio otro. */
    telefonoDelChat?: string | null;
    /** El marcador de cierre de la cuenta («Resumen:»). */
    marcador?: string;
    /** Cómo se presenta el artículo, si el anuncio lo trae con título. */
    productoAnuncio?: string | null;
  } = {},
): string {
  const descripcion = anuncio?.descripcion_anuncio ?? "";
  const llevaTalla = ROPA.test(descripcion) || CALZADO.test(descripcion);

  // El orden de la dueña: talla, a dónde, nombre, teléfono (en RD) y el cierre.
  const paso: PasoDelPedido =
    llevaTalla && !ficha.talla ? "talla"
      : !ficha.direccion ? "direccion"
        : !ficha.nombre ? "nombre"
          : d.codigo === "do" && !ficha.celular ? "celular"
            : "resumen";

  /*
   * EL CIERRE. Con todos los datos, primero se pregunta si se le factura; y
   * cuando el cliente ya dijo que sí, el resumen sale AQUÍ MISMO, armado con
   * lo que él escribió y con el precio de la descripción. El caso real: el
   * agente decía «ya le preparo el resumen» y el resumen nunca llegaba.
   */
  if (paso === "resumen") {
    const yaPregunto = !!opciones.ultimoDelAgente && PIDE_CONFIRMACION.test(opciones.ultimoDelAgente);
    if (yaPregunto && CONFIRMA.test(opciones.ultimoDelCliente ?? "")) {
      const resumen = resumenMecanico(d, ficha, anuncio, opciones);
      if (resumen) return resumen;
      // Sin zona conocida no hay envío ni total: se pide la provincia.
      return otraFormaDePreguntar(d, "direccion", descripcion);
    }
  }

  // En el paso final, la confirmación va con el pedido escrito: «Le confirmo: …».
  let pregunta =
    (paso === "resumen" ? confirmacionMecanica(d, ficha, anuncio, opciones) : null) ??
    preguntaDelPaso(d, paso, descripcion);

  /*
   * LA MISMA PREGUNTA NO SALE DOS VECES SEGUIDAS. El caso real: «¿Qué número
   * calza?» tres veces, una detrás de otra. Si lo último que mandó el agente
   * es exactamente esto, se pregunta de otra forma.
   */
  const anterior = opciones.ultimoDelAgente ? llano(opciones.ultimoDelAgente).replace(/\s+/g, " ").trim() : "";
  if (anterior && anterior === llano(pregunta).replace(/\s+/g, " ").trim()) {
    pregunta = otraFormaDePreguntar(d, paso, descripcion);
  }

  /*
   * «EXCELENTE…»: en cuanto el cliente dice a dónde, se le confirma el envío
   * a domicilio, el pago al recibir y su costo, y se sigue con el nombre. Es
   * el paso que pidió la dueña para República Dominicana.
   */
  if (paso === "nombre" && d.codigo === "do") {
    const zona = zonaDelCliente(d, opciones.ultimoDelCliente);
    if (zona !== null) {
      const costo = zona === "resto" ? d.envio.restoDelPais.costo : zona.costo;
      const donde = nombreDeLaZona(d, opciones.ultimoDelCliente ?? "", opciones.lugar);
      return `Excelente. Le hacemos el envío a domicilio y paga al recibir. El costo de envío a ${donde} es ${importe(d, costo)}.\n\n${pregunta}`;
    }
  }

  // Y si el cliente preguntó algo, se le contesta antes de seguir.
  const directa = respuestaDirecta(d, opciones.ultimoDelCliente, anuncio, opciones.lugar);
  return directa ? `${directa}\n\n${pregunta}` : pregunta;
}

type PasoDelPedido = "talla" | "direccion" | "nombre" | "celular" | "resumen";

/** La pregunta de cada paso del pedido, en el orden de venta. */
function preguntaDelPaso(d: DatosPais, paso: PasoDelPedido, descripcion: string): string {
  const tu = d.trato === "tu";
  switch (paso) {
    case "talla":
      return primeraPregunta(descripcion, d);
    case "direccion":
      switch (d.codigo) {
        case "do":
          return "¿A dónde se lo enviamos?";
        case "cr":
          return tu ? "Te lo enviamos a todo el país. ¿En qué cantón estás?" : "Le enviamos a todo el país. ¿En qué cantón se encuentra?";
        default:
          return tu ? "¿A qué corregimiento te lo enviamos?" : "¿A qué corregimiento se lo enviamos?";
      }
    case "nombre":
      return "¿A nombre de quién sale el pedido?";
    case "celular":
      return "¿Me facilita su número de teléfono para el pedido?";
    case "resumen":
      return tu
        ? "Ya tengo tus datos. ¿Te lo facturamos y te lo enviamos?"
        : "Ya tengo sus datos. ¿Se lo facturamos y se lo enviamos?";
  }
}

/** Cómo suena la pregunta de confirmación, para saber que ya se hizo. */
const PIDE_CONFIRMACION = /factur|le confirmo|confirma (su|tu|el) pedido|se lo enviamos|te lo enviamos|enviamos hoy mismo/i;

/** Un «sí» del cliente, en cualquiera de sus formas. */
const CONFIRMA = /^[^\p{L}\p{N}]*(s[ií]|dale|claro|confirmo|confirmado|confirmar|ok|okey|okay|listo|perfecto|de acuerdo|correcto|adelante|vale|va|hagale|h[aá]gale|por supuesto|as[ií] es|exacto|me lo llevo|lo quiero|f[aá]ctureme|fact[uú]relo|env[ií]emelo|lo espero|est[aá] bien|de una|m[aá]ndelo|as[ií] mismo|env[ií]elo)(?![\p{L}])/iu;

/** «1», «2 pares», «dos» → cuántos lleva. Sin nada, uno. */
function cantidadDe(texto: string | null): number {
  if (!texto) return 1;
  const n = texto.match(/\d+/);
  if (n) return Math.max(1, Math.min(99, Number(n[0])));
  const palabras: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  for (const [p, v] of Object.entries(palabras)) if (new RegExp(`\\b${p}\\b`, "i").test(texto)) return v;
  return 1;
}

/**
 * EL RESUMEN DEL PEDIDO, ARMADO SIN MODELO con lo que el cliente escribió:
 * su nombre, su dirección, su talla o color, el precio de la descripción del
 * anuncio y el envío de su zona. Con la cabecera que registra la venta, el
 * pie del país y la transferencia pegada, igual que lo escribiría el agente.
 * Null si falta algo que no se puede inventar: el precio o la zona.
 */
export function resumenMecanico(
  d: DatosPais,
  ficha: FichaDelPedido,
  anuncio: { descripcion_anuncio?: string | null; producto_anuncio?: string | null } | null,
  opciones: { lugar?: string | null; telefonoDelChat?: string | null; marcador?: string; productoAnuncio?: string | null } = {},
): string | null {
  if (!ficha.nombre || !ficha.direccion) return null;
  const descripcion = anuncio?.descripcion_anuncio ?? "";
  const precioTexto = precioDeLaDescripcion(descripcion, d.moneda.simbolo);
  const precio = leerImporte(precioTexto);
  if (precio === null) return null;

  const zona = zonaDelCliente(d, ficha.direccion) ?? zonaDelCliente(d, opciones.lugar);
  if (zona === null) return null;
  const envio = zona === "resto" ? d.envio.restoDelPais.costo : zona.costo;

  const articulo =
    articuloDeLaDescripcion(descripcion, d.moneda.simbolo) ??
    opciones.productoAnuncio?.trim() ??
    anuncio?.producto_anuncio?.trim() ??
    null;
  if (!articulo) return null;

  const cantidad = cantidadDe(ficha.cantidad);
  const total = precio * cantidad + envio;
  const variante = [ficha.talla, ficha.color].filter(Boolean).join(", ");
  const marcador = opciones.marcador ?? MARCADOR_POR_DEFECTO;
  const cabecera = /^resumen:?$/i.test(marcador.trim()) ? "Resumen de su pedido:" : marcador;
  const celular = ficha.celular && ficha.celular !== "este mismo número" ? ficha.celular : (opciones.telefonoDelChat ?? "");

  if (d.codigo === "do") {
    // El formato que pidió la dueña, línea por línea.
    const titulo = /^resumen:?$/i.test(marcador.trim()) ? "📋 RESUMEN DEL PEDIDO" : marcador;
    const lineas: string[] = [titulo, `Producto: ${articulo}`];
    if (ficha.talla) lineas.push(`Talla: ${ficha.talla}`);
    if (ficha.color) lineas.push(`Color: ${ficha.color}`);
    lineas.push(`Cantidad: ${cantidad}`);
    lineas.push(`Precio: ${importe(d, precio * cantidad)}`);
    lineas.push(`Envio: ${importe(d, envio)}`);
    lineas.push(`TOTAL A PAGAR: ${importe(d, total)}`);
    lineas.push("Forma de pago: contra entrega");
    lineas.push(`Nombre: ${ficha.nombre}`);
    if (celular) lineas.push(`Telefono: ${celular}`);
    lineas.push(`Direccion: ${ficha.direccion}`);
    lineas.push(`Zona: ${nombreDeLaZona(d, ficha.direccion, opciones.lugar)}`);
    lineas.push("✅ PEDIDO REGISTRADO", FRASE_DE_TRANSFERENCIA);
    return lineas.join("\n");
  }

  const lineas: string[] = [cabecera, ""];
  {
    lineas.push(`Nombre: ${ficha.nombre}`);
    if (celular) lineas.push(`Cel: ${celular}`);
    lineas.push(`Producto: ${articulo}`);
    lineas.push(`Cantidad: ${cantidad}`);
    if (variante) lineas.push(`Talla y color: ${variante}`);
    lineas.push(`Dirección: ${ficha.direccion}`);
    lineas.push(`Costo de envío: ${importe(d, envio)}`);
    const pago = zona === "resto" ? d.envio.restoDelPais.pago : zona.pago;
    if (d.pago && pago) lineas.push(`Forma de pago: ${pago}`);
    lineas.push(`Total a pagar: ${importe(d, total)}`);
    lineas.push("", ...d.pieDelResumen, "", "Conectando con representante...");
  }
  return lineas.join("\n");
}

/**
 * «Gran Santo Domingo» o la provincia del interior que nombró el cliente:
 * la línea «Zona» del resumen dominicano.
 */
function nombreDeLaZona(d: DatosPais, direccion: string, lugar?: string | null): string {
  const textos = [direccion, lugar ?? ""];
  for (const texto of textos) {
    for (const z of d.envio.zonas) if (contieneLugar(texto, z.lugares)) return z.nombre;
  }
  for (const texto of textos) {
    for (const entrada of d.envio.restoDelPais.lugares ?? []) {
      if (contieneLugar(texto, [entrada])) return nombresDeLugar(entrada)[0]!;
    }
    for (const region of d.mapa.regiones) {
      for (const entrada of region.lugares) {
        if (contieneLugar(texto, [entrada])) return nombresDeLugar(entrada)[0]!;
      }
    }
  }
  return "Interior";
}

/**
 * «Le confirmo: …» — el pedido leído en una línea antes de cerrarlo, con el
 * total y la pregunta de si se lo enviamos hoy mismo. Es la confirmación que
 * pidió la dueña para República Dominicana; en los demás países, la pregunta
 * corta de siempre. Null si falta el precio o la zona.
 */
export function confirmacionMecanica(
  d: DatosPais,
  ficha: FichaDelPedido,
  anuncio: { descripcion_anuncio?: string | null; producto_anuncio?: string | null } | null,
  opciones: { lugar?: string | null; productoAnuncio?: string | null } = {},
): string | null {
  if (d.codigo !== "do" || !ficha.nombre || !ficha.direccion) return null;
  const descripcion = anuncio?.descripcion_anuncio ?? "";
  const precio = leerImporte(precioDeLaDescripcion(descripcion, d.moneda.simbolo));
  if (precio === null) return null;
  const zona = zonaDelCliente(d, ficha.direccion) ?? zonaDelCliente(d, opciones.lugar);
  if (zona === null) return null;
  const envio = zona === "resto" ? d.envio.restoDelPais.costo : zona.costo;
  const articulo =
    articuloDeLaDescripcion(descripcion, d.moneda.simbolo) ??
    opciones.productoAnuncio?.trim() ??
    anuncio?.producto_anuncio?.trim() ??
    null;
  if (!articulo) return null;
  const cantidad = cantidadDe(ficha.cantidad);
  const total = precio * cantidad + envio;

  const partes = [articulo];
  if (cantidad > 1) partes.push(`${cantidad} unidades`);
  if (ficha.talla) partes.push(`talla ${ficha.talla}`);
  if (ficha.color) partes.push(`color ${ficha.color}`);
  partes.push(`a nombre de ${ficha.nombre}`, `entrega en ${ficha.direccion}`);

  return (
    `Le confirmo: ${partes.join(", ")}.\n` +
    `Son ${importe(d, precio * cantidad)} más ${importe(d, envio)} de envío, total ${importe(d, total)}, y se paga al recibir.\n` +
    "¿Se lo enviamos hoy mismo?"
  );
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
          return "¿A qué provincia o sector se lo enviamos?";
        case "cr":
          return tu ? "¿A qué cantón te lo enviamos?" : "¿A qué cantón se lo enviamos?";
        default:
          return tu ? "¿En qué corregimiento estás?" : "¿En qué corregimiento se encuentra?";
      }
    case "nombre":
      return tu ? "¿Con qué nombre lo dejamos?" : "¿Con qué nombre lo dejamos?";
    case "celular":
      return "¿A qué número le llama el mensajero, a este mismo?";
    case "resumen":
      return preguntaDelPaso(d, paso, descripcion);
  }
}

/** De qué va la pregunta del cliente, si es una de las que se contestan solas. */
export type PreguntaDelCliente = "ubicacion" | "envio" | "pago" | "precio" | "tallas";

/**
 * LAS TALLAS QUE HAY para el artículo del anuncio, según la tabla base:
 * «de la 30 a la 42» para una correa o una faja, «de la 39 a la 45» para un
 * zapato. Null si el artículo no está en la tabla o no lleva talla.
 */
export function tallasDisponibles(descripcion: string, d: DatosPais): string | null {
  if (!d.tallas.usaTablaBase) return null;
  const fila = (articulo: string) => TALLAS_BASE.find((f) => f.articulo === articulo)?.tallas ?? null;
  if (CALZADO.test(descripcion)) return d.tallas.zapatoEn || fila("Zapatos");
  if (/\b(correa|correas|cintur[oó]n|cinturones|faja|fajas)\b/i.test(descripcion)) return fila("Correas y cinturones");
  if (/\b(pantal[oó]n|pantalones|jean|jeans|short|shorts|bermuda)\b/i.test(descripcion)) return fila("Pantalones");
  if (/\b(camisa|camisas|polo|t-?shirt|franela|blusa|chacabana|su[eé]ter|sudadera|chaqueta|abrigo)\b/i.test(descripcion)) return fila("Camisas y t-shirts");
  return null;
}

/**
 * QUÉ PREGUNTÓ EL CLIENTE. Solo lo que tiene una respuesta fija en los datos
 * del país o en la descripción del anuncio: dónde están, el envío, cómo se
 * paga y el precio. Lo demás lo contesta el agente con su criterio.
 */
export function preguntaDelCliente(texto: string | null | undefined): PreguntaDelCliente | null {
  const t = llano(texto ?? "").trim();
  if (!t) return null;
  // «¿Cuáles son los tamaños disponibles?», «¿qué tallas hay?»: se contestan con las tallas, no con otra pregunta.
  if (/\b(tallas?|tamanos?|medidas?|numeros?)\b/.test(t) && /\b(disponible|disponibles|hay|tienen|tiene|cuales|cual|que|manejan|maneja|vienen|viene)\b/.test(t) && /\?|cuales|que|hay|tienen/.test(t)) return "tallas";
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
    case "tallas": {
      const tallas = tallasDisponibles(anuncio?.descripcion_anuncio ?? "", d);
      return tallas ? `Las tallas disponibles son ${tallas}.` : null;
    }
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
