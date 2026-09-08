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
 *
 * ═══ COSTA RICA VA SOLA ═══
 *
 * Lo que hay aquí lo comparten los tres países, así que un arreglo escrito para
 * República Dominicana o Panamá le llega a Costa Rica sin que nadie lo pida. La
 * dueña quiere que Costa Rica se quede como está (2026-09-08), y por eso está
 * FIJADA palabra por palabra en `tests/costa-rica.test.ts`: si tocas este
 * archivo y ella se mueve, esa prueba falla y te lo dice. Si el cambio es para
 * Costa Rica, se vuelve a grabar con `FIJAR_CR=1 npm test`; si no lo es, acota
 * el arreglo al país que lo pidió.
 */
import type { DatosPais } from "@/agents";
import { importe, zonaDelCliente } from "@/agents/armar";
import { reColores, TALLAS_BASE } from "@/agents/base-comportamiento";
import { FRASE_DE_TRANSFERENCIA } from "@/agents/paises/rd-guion";
import { FRASE_DE_CIERRE_CR } from "@/agents/paises/cr-guion";
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

/**
 * CÓMO NOMBRA UN ANUNCIO LO QUE VENDE. Las palabras con las que la tienda
 * llama a sus artículos, para no venderle al cliente el reclamo en lugar del
 * producto. El caso real: «🖤 ORDENA, RECIBE Y LUEGO PAGA!! Luce un estilo
 * exclusivo con zapatos de… 🖤» como nombre del artículo, porque delante del
 * producto el anuncio traía dos frases de eslogan.
 */
const FAMILIAS: { familia: string; palabras: string }[] = [
  { familia: "calzado", palabras: "zapatos?|zapatillas?|tenis|botas?|mocas[ií]n|mocasines|sandalias?|chancletas?|calzado" },
  { familia: "camisas y polos", palabras: "camisas?|polos?|t-?shirts?|franelas?|blusas?|chacabanas?" },
  { familia: "pantalones", palabras: "pantal[oó]n|pantalones|jeans?|shorts?|bermudas?" },
  { familia: "ropa de vestir", palabras: "vestidos?|faldas?|conjuntos?|chaquetas?|abrigos?|su[eé]teres?|sudaderas?" },
  { familia: "ropa interior", palabras: "b[oó]xers?|underwear" },
  { familia: "correas y fajas", palabras: "correas?|cintur[oó]n|cinturones|fajas?" },
  { familia: "bolsos y carteras", palabras: "carteras?|bolsos?|mochilas?|morrales?|bultos?|billeteras?|maletas?|loncheras?" },
  { familia: "gorras y lentes", palabras: "gorras?|lentes|gafas" },
  { familia: "relojes y joyería", palabras: "reloj|relojes|collares?|pulseras?|aretes|anillos?" },
  { familia: "perfumes y cremas", palabras: "perfumes?|colonias?|cremas?|serum|maquillaje" },
  { familia: "aparatos del pelo", palabras: "cepillos?|secadoras?|secadores?|blowers?|planchas?|planchitas?|alisadoras?|rizadoras?|tenazas?|abej[oó]n|abejones" },
  { familia: "cosas de la casa", palabras: "licuadoras?|freidoras?|audifonos?|bocinas?|cargadores?|l[aá]mparas?|termos?|botellas?|ollas?|sartenes?|ventiladores?|masajeadores?|rasuradoras?|afeitadoras?" },
  { familia: "combos y sets", palabras: "combos?|sets?|kits?" },
];

const NOMBRA_EL_ARTICULO = new RegExp(`\\b(${FAMILIAS.map((f) => f.palabras).join("|")})\\b`, "i");

/**
 * QUÉ ARTÍCULOS NOMBRA UN TEXTO, por familias. Sirve para comparar lo que el
 * agente escribe con lo que la tienda vende en ESTE chat: el caso real fue
 * «Perfecto, le añado un pantalón polo color negro talla 32» en un hilo abierto
 * por un anuncio de zapatos, y ese pantalón no existía en ninguna parte.
 */
export function familiasNombradas(texto: string): { familia: string; palabra: string }[] {
  const salida: { familia: string; palabra: string }[] = [];
  for (const f of FAMILIAS) {
    const m = texto.match(new RegExp(`\\b(${f.palabras})\\b`, "i"));
    if (m) salida.push({ familia: f.familia, palabra: m[0] });
  }
  return salida;
}

/**
 * Familias que llevan talla: las MISMAS que enseña la tabla de tallas de la
 * tienda (`TALLAS_BASE`), en singular y en plural. El caso real: un anuncio de
 * «POLOS BRONX» al que no se le preguntaba la talla —y un «XXL» del cliente
 * que se tiraba a la basura— porque «polo» no estaba aquí, aunque la tabla de
 * la tienda diga «Camisas, t-shirts, polos y boxers: de la S a la XXL».
 */
const ROPA = /\b(camisas?|pantal[oó]n|pantalones|t-?shirts?|polos?|b[oó]xers?|correas?|cintur[oó]n|cinturones)\b/i;
const CALZADO = /\b(zapato|zapatos|calzado|tenis|bota|botas|mocas[ií]n|mocasines|sandalia|sandalias|zapatilla|zapatillas|chancleta|chancletas)\b/i;
const COLORES = reColores("gi");

/**
 * El artículo lleva talla solo si es ropa o calzado. Todo lo demás —el cepillo
 * secador, la plancha, el combo, el abejón— se vende fijo, en una sola medida.
 */
export function llevaTalla(descripcion: string): boolean {
  return ROPA.test(descripcion) || CALZADO.test(descripcion);
}

/**
 * ¿SE LE PREGUNTA EL COLOR?
 *
 * La regla de la dueña, dicha en una línea (2026-09-08): «las ropas llevan
 * talla y color, los artículos no llevan talla ni color». Es la MISMA frontera
 * que decide la talla, y a propósito: lo que se viste se elige —qué medida y de
 * qué color—, y lo que se vende fijo —el combo, el abejón, el cepillo, la
 * plancha— no se elige, se despacha.
 *
 * Antes esto miraba si la descripción nombraba dos colores o si había foto que
 * mandar. Las dos cosas sobraban y las dos dejaban fuera media tienda: la
 * publicidad de Facebook casi nunca escribe los colores en el texto, así que a
 * una camisa anunciada sin colores no se le preguntaba ninguno y el cliente
 * pasaba de su talla a su dirección sin elegir nada.
 *
 * Lo que NO se hace es ofrecerle colores inventados: si la descripción los
 * nombra, se los dices; si no, le preguntas cuál quiere a secas y con la foto
 * delante. Eso está escrito en el paso del color de los guiones.
 */
export function llevaColor(descripcion: string): boolean {
  return ROPA.test(descripcion) || CALZADO.test(descripcion);
}

/** Primer mensaje cuando todavía no existe un producto identificado. */
export function mensajeSinProducto(d: DatosPais): string {
  if (d.codigo === "do") return "Hola, le asiste Orlanda de RINCON DCM. ¿Cuál es el artículo de su interés?";
  if (d.codigo === "cr") return "Hola, le asiste Mildred, un gusto. ¿Cuál es el artículo de su interés?";
  const agente = d.nombreAgente ?? "un asesor de ventas";
  const negocio = d.tienda || "la tienda";
  return `Hola, le asiste ${agente} de ${negocio}. ¿Cuál es el artículo de su interés?`;
}

/** ¿Este texto dice QUÉ se vende, con el nombre de un artículo? */
export function nombraUnArticulo(texto: string): boolean {
  return NOMBRA_EL_ARTICULO.test(texto);
}

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
  // Y sin el separador con el que el anuncio pega el precio detrás: «3 PACK
  // BOXER CR7 PARA CABALLERO | ₡18.800» dejaba el artículo con la barra suelta.
  articulo = articulo.replace(/[\s!¡.:,;—–|·•/\\-]+$/, "").trim();

  /*
   * Y SI DELANTE DEL PRODUCTO SOLO HAY ESLOGAN, el artículo empieza donde el
   * anuncio lo nombra. Lo que el cliente tiene que leer es QUÉ se vende, no el
   * reclamo con el que se lo vendieron. Solo cuando el reclamo es largo: un
   * «Elegantes zapatos de cuero» se queda entero, que ahí «Elegantes» es parte
   * del nombre.
   */
  const nombra = articulo.match(NOMBRA_EL_ARTICULO);
  if (nombra?.index !== undefined && nombra.index > 20) {
    // Del nombre en adelante, y hasta la coma: lo de detrás es la explicación.
    const desde = articulo.slice(nombra.index).split(",")[0]!.trim();
    if (desde.length >= 3) articulo = desde.charAt(0).toUpperCase() + desde.slice(1);
  }

  if (articulo.length < 3) return null;
  if (articulo.length > 70) articulo = `${articulo.slice(0, 69).trimEnd()}…`;
  // «ZAPATOS DCM ESTILO» se lee mejor como «Zapatos DCM Estilo» que a gritos.
  if (articulo === articulo.toUpperCase()) {
    articulo = articulo.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase());
  }
  return articulo;
}

/**
 * ¿LA FOTO LE AYUDA A ELEGIR?
 *
 * Lo pidió la dueña (2026-09-08): en un pantalón, una camisa o un zapato el
 * cliente no elige solo una medida —elige el modelo y el color que ve—, y
 * pedirle la talla de algo que no ha visto es pedirle que compre a ciegas. Con
 * un cepillo o una plancha no hace falta: no hay nada que escoger.
 *
 * Es la misma frontera que decide si se pregunta la talla, y a propósito: lo
 * que se elige, se enseña.
 */
export function laFotoAyudaAElegir(descripcion: string | null | undefined): boolean {
  const t = descripcion ?? "";
  return ROPA.test(t) || CALZADO.test(t);
}

/** Cualquier forma de preguntar el color. La leen el revisor y el agente. */
export const PREGUNTA_COLOR = /[¿?][^?¿]*\bcolor(es)?\b[^?¿]*\?/i;

/**
 * ¿ESTA RESPUESTA LLEVA LA FOTO DEL ANUNCIO, aunque el modelo no la pidiera?
 *
 * En República Dominicana sí, cuando lo que pregunta es el COLOR: lo pidió la
 * dueña (2026-09-08) —la foto no al principio, sino cuando el cliente ya dio su
 * talla y toca elegir color, porque el color se elige viendo—. Al guion se le
 * pide y casi siempre lo hace; esto lo asegura.
 *
 * Los otros dos países la mandan con la primera respuesta, que es su regla: ver
 * `laFotoAyudaAElegir`.
 */
export function laFotoVaConEstaRespuesta(codigoPais: string | null | undefined, texto: string): boolean {
  return codigoPais === "do" && PREGUNTA_COLOR.test(texto);
}

/** La primera pregunta del orden de venta, según lo que sea el artículo. */
export function primeraPregunta(descripcion: string, d: DatosPais): string {
  const texto = descripcion;
  const tu = d.trato === "tu";
  if (CALZADO.test(texto)) return d.codigo === "do" ? "¿Qué talla le interesa?" : tu ? "¿Qué número calzas?" : "¿Qué número calza?";
  if (ROPA.test(texto)) return tu ? "¿Qué talla te interesa?" : "¿Qué talla le interesa?";
  // Sin talla, a dónde se lo enviamos: la cantidad NO se pregunta nunca, se
  // asume una unidad salvo que el cliente diga otra (la dueña, 2026-09-05).
  return preguntaDelPaso(d, "direccion", descripcion);
}

/**
 * LA APERTURA, entera: saludo, artículo con su precio, y la primera pregunta.
 * Null si la descripción no trae precio: entonces no hay nada seguro que decir.
 */
export function aperturaSegura(
  d: DatosPais,
  anuncio: { producto_anuncio?: string | null; descripcion_anuncio?: string | null } | null,
  saludo: string,
  /** Lo que escribió el cliente al llegar: si preguntó algo, se le contesta después del saludo. */
  ultimoDelCliente?: string | null,
): string | null {
  const descripcion = anuncio?.descripcion_anuncio?.trim() ?? "";
  if (!descripcion) return null;

  const precio = precioDeLaDescripcion(descripcion, d.moneda.simbolo);
  if (!precio) return null;

  const articulo = articuloDeLaDescripcion(descripcion, d.moneda.simbolo) ?? anuncio?.producto_anuncio?.trim();
  if (!articulo) return null;

  /*
   * Si llegó preguntando algo —«¿dónde están ubicados?»—, se le contesta en
   * una línea justo después del saludo, y se sigue con el producto y la
   * pregunta que toca. El precio no se contesta aparte: ya va en el mensaje.
   */
  // El precio ya va en el mensaje; y pedir otro artículo, en el primer mensaje,
  // es pedir el de este anuncio: todavía no se le ha enseñado ninguno.
  const tipo = preguntaDelCliente(ultimoDelCliente);
  const directa =
    tipo && tipo !== "precio" && tipo !== "otro_articulo" ? respuestaDirecta(d, ultimoDelCliente, anuncio, null) : null;
  const contestacion = directa ? `${directa}\n` : "";

  // Costa Rica y República Dominicana: el primer mensaje de los guiones de la dueña, en un solo globo.
  if (d.codigo === "cr" || d.codigo === "do") {
    return `${saludo}\n${contestacion}${articulo}\n${precio}\n${primeraPregunta(descripcion, d)}`;
  }

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
  if (!descripcion.trim() && !opciones.productoAnuncio?.trim()) {
    return mensajeSinProducto(d);
  }

  /*
   * SI PIDE OTRO ARTÍCULO, EL CHAT PASA A UNA PERSONA, y no se sigue con el
   * pedido detrás. El caso real: «Tiene otro combo de más alto precio que sea
   * de más calidad» → «Combo 2 En 1 está en RD$1,690. Indique su dirección
   * exacta de entrega.». Eso no contesta lo que preguntó y encima le pide la
   * dirección de un pedido que él no ha aceptado.
   */
  if (preguntaDelCliente(opciones.ultimoDelCliente) === "otro_articulo") {
    return fraseDeTransferencia(d);
  }
  if (clienteAplazaCompra(opciones.ultimoDelCliente)) {
    return "Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.";
  }
  const pideTalla = llevaTalla(descripcion);
  const llevaColorEnDescripcion = llevaColor(descripcion);

  // El orden de los guiones de la dueña (2026-09-05): talla si la lleva,
  // dirección, teléfono con el costo de envío, nombre y el cierre. La cantidad
  // no es un paso: se asume una unidad salvo que el cliente diga otra.
  const paso: PasoDelPedido =
    pideTalla && !ficha.talla ? "talla"
      : llevaColorEnDescripcion && !ficha.color ? "color"
      : !ficha.direccion ? "direccion"
        : (d.codigo === "cr" || d.codigo === "do") && !ficha.celular ? "celular"
          : !ficha.nombre ? "nombre"
            : "resumen";

  /* Con todos los datos, el cierre es directamente el resumen del pedido. */
  if (paso === "resumen") {
    const resumen = resumenMecanico(d, ficha, anuncio, opciones);
    if (resumen) return resumen;
    // Sin zona conocida no hay envío ni total: se pide la provincia.
    return otraFormaDePreguntar(d, "direccion", descripcion);
  }

  let pregunta =
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
   * REGLA FIJA DE LA DUEÑA (RD, 2026-09-05): el teléfono se pide en el mismo
   * mensaje en que se dice el costo de envío, y nunca antes de decirlo. Si
   * todavía no se sabe la zona, se pide la provincia o el sector primero.
   */
  if (paso === "celular" && d.codigo === "do") {
    const zona = zonaDelCliente(d, ficha.direccion) ?? zonaDelCliente(d, opciones.lugar);
    if (zona === null) return otraFormaDePreguntar(d, "direccion", descripcion);
    const costo = zona === "resto" ? d.envio.restoDelPais.costo : zona.costo;
    const donde = nombreDeLaZona(d, ficha.direccion ?? "", opciones.lugar);
    const yaLoPidio = !!opciones.ultimoDelAgente && /tel[eé]fono/i.test(opciones.ultimoDelAgente);
    return `Perfecto, hasta ${donde} el envío le sale en ${importe(d, costo)}.\n${yaLoPidio ? otraFormaDePreguntar(d, "celular", descripcion) : pregunta}`;
  }

  /*
   * «PERFECTO, HASTA <ZONA>…»: en Costa Rica, en cuanto el cliente da la
   * dirección se le dice cómo le llega, el envío y cuándo se paga, y en el
   * mismo mensaje se le pide el teléfono. Es la regla fija del guion de la
   * dueña (2026-09-05).
   */
  if (paso === "celular" && d.codigo === "cr") {
    const zona = zonaDelCliente(d, ficha.direccion) ?? zonaDelCliente(d, opciones.lugar);
    if (zona !== null) {
      const donde = nombreDeLaZona(d, ficha.direccion ?? "", opciones.lugar);
      const costo = importe(d, zona === "resto" ? d.envio.restoDelPais.costo : zona.costo);
      const logistica =
        zona === "resto"
          ? `Perfecto, hasta ${donde} va por correo y lo retira en la sucursal más cercana. El envío es ${costo} y el pago va por adelantado, por SINPE o transferencia.`
          : `Perfecto, hasta ${donde} se lo llevamos a domicilio. El envío es ${costo} y paga al recibir.`;
      return `${logistica}\n${pregunta}`;
    }
  }

  // Y si el cliente preguntó algo, se le contesta antes de seguir.
  const directa = respuestaDirecta(d, opciones.ultimoDelCliente, anuncio, opciones.lugar);
  return directa ? `${directa}\n\n${pregunta}` : pregunta;
}

type PasoDelPedido = "talla" | "color" | "direccion" | "nombre" | "celular" | "resumen";

/** La pregunta de cada paso del pedido, en el orden de venta. */
function preguntaDelPaso(d: DatosPais, paso: PasoDelPedido, descripcion: string): string {
  const tu = d.trato === "tu";
  switch (paso) {
    case "talla":
      return primeraPregunta(descripcion, d);
    case "color":
      return tu ? "¿Qué color te interesa?" : "¿Qué color le interesa?";
    case "direccion":
      switch (d.codigo) {
        case "do":
          return "Indique su dirección exacta de entrega.";
        case "cr":
          return "Indique su dirección exacta de entrega.";
        default:
          return tu ? "¿A qué corregimiento te lo enviamos?" : "¿A qué corregimiento se lo enviamos?";
      }
    case "nombre":
      return "¿A nombre de quién sale el pedido?";
    case "celular":
      return "¿Me facilita su número de teléfono para el pedido?";
    case "resumen":
      return "";
  }
}

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
  const tallaValida = llevaTalla(descripcion) ? ficha.talla : null;
  const colorValido = llevaColor(descripcion) ? ficha.color : null;
  const variante = [tallaValida, colorValido].filter(Boolean).join(", ");
  const marcador = opciones.marcador ?? MARCADOR_POR_DEFECTO;
  const cabecera = /^resumen:?$/i.test(marcador.trim()) ? "Resumen de su pedido:" : marcador;
  const celular = ficha.celular && ficha.celular !== "este mismo número" ? ficha.celular : (opciones.telefonoDelChat ?? "");

  if (d.codigo === "do") {
    // El formato que pidió la dueña, línea por línea.
    const titulo = /^resumen:?$/i.test(marcador.trim()) ? "📋 RESUMEN DEL PEDIDO" : marcador;
    const lineas: string[] = [titulo, `Nombre: ${ficha.nombre}`];
    if (celular) lineas.push(`Telefono: ${celular}`);
    lineas.push(`Direccion: ${ficha.direccion}`);
    lineas.push(`Producto: ${articulo}`);
    if (tallaValida) lineas.push(`Talla: ${tallaValida}`);
    if (colorValido) lineas.push(`Color: ${colorValido}`);
    lineas.push(`Cantidad: ${cantidad}`);
    lineas.push(`Envio: ${importe(d, envio)}`);
    lineas.push(`TOTAL A PAGAR: ${importe(d, total)}`);
    lineas.push("Forma de pago: contra entrega");
    lineas.push("✅ PEDIDO REGISTRADO", FRASE_DE_TRANSFERENCIA);
    return lineas.join("\n");
  }

  if (d.codigo === "cr") {
    // El formato del guion de la dueña (2026-09-05), línea por línea. La forma
    // de pago se deduce de la zona: a domicilio, contra entrega; por correo,
    // por adelantado.
    const titulo = /^resumen:?$/i.test(marcador.trim()) ? "📋 RESUMEN DEL PEDIDO" : marcador;
    const lineas: string[] = [titulo, `Nombre: ${ficha.nombre}`];
    if (celular) lineas.push(`Telefono: ${celular}`);
    lineas.push(`Direccion: ${ficha.direccion}`);
    lineas.push(`Producto: ${articulo}`);
    if (tallaValida) lineas.push(`Talla: ${tallaValida}`);
    if (colorValido) lineas.push(`Color: ${colorValido}`);
    lineas.push(`Cantidad: ${cantidad}`);
    lineas.push(`Envio: ${importe(d, envio)}`);
    lineas.push(`TOTAL A PAGAR: ${importe(d, total)}`);
    lineas.push(`Forma de pago: ${zona === "resto" ? "SINPE o transferencia por adelantado" : "contra entrega"}`);
    lineas.push("✅ PEDIDO REGISTRADO", FRASE_DE_CIERRE_CR);
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

/** Cómo avisa cada país de que el chat pasa a una persona. */
export function fraseDeTransferencia(d: DatosPais): string {
  if (d.codigo === "do") return FRASE_DE_TRANSFERENCIA;
  if (d.codigo === "cr") return FRASE_DE_CIERRE_CR;
  return "Permítame un momento, le paso con un representante.";
}

/** La misma pregunta con otras palabras, para cuando la anterior quedó sin contestar. */
function otraFormaDePreguntar(d: DatosPais, paso: PasoDelPedido, descripcion: string): string {
  const tu = d.trato === "tu";
  switch (paso) {
    case "talla":
      if (CALZADO.test(descripcion)) {
        return d.codigo === "do" ? "¿Cuál talla le interesa? Van de la 39 a la 45." : tu ? "Para enviártelo necesito tu número de calzado. ¿Cuál es?" : "Para enviárselo necesito el número que calza. ¿Cuál es?";
      }
      return tu ? "Para enviártelo necesito tu talla. ¿Cuál te interesa?" : "Para enviárselo necesito su talla. ¿Cuál le interesa?";
    case "color":
      return tu ? "¿Qué color te interesa?" : "¿Qué color le interesa?";
    case "direccion":
      switch (d.codigo) {
        case "do":
          return "¿Cuál es su dirección exacta de entrega, con el sector y la provincia?";
        case "cr":
          return "¿Cuál es su dirección exacta de entrega, con el cantón?";
        default:
          return tu ? "¿En qué corregimiento estás?" : "¿En qué corregimiento se encuentra?";
      }
    case "nombre":
      return tu ? "¿Con qué nombre lo dejamos?" : "¿Con qué nombre lo dejamos?";
    case "celular":
      /*
       * SE PIDE EL NÚMERO, NO SE PIDE QUE CONFIRME EL QUE YA SE TIENE.
       *
       * La dueña (2026-09-08). «¿A qué número le llama el mensajero, a este
       * mismo?» no pregunta: propone. El cliente contesta «sí» y el pedido se
       * queda con un número que él nunca escribió. Aquí toca decirlo con otras
       * palabras que en el paso normal —esta función existe para eso—, pero
       * pidiéndolo igual. Lo que NO cambia es cómo se acepta la respuesta: si
       * él dice por su cuenta que es este mismo, vale el de este WhatsApp.
       */
      return tu ? "¿A qué número te llama el mensajero?" : "¿A qué número le llama el mensajero?";
    case "resumen":
      return preguntaDelPaso(d, paso, descripcion);
  }
}

/** De qué va la pregunta del cliente, si es una de las que se contestan solas. */
export type PreguntaDelCliente = "ubicacion" | "envio" | "pago" | "precio" | "tallas" | "tiempo" | "otro_articulo";

/**
 * EL CLIENTE PIDE OTRA COSA, NO ESTA. El caso real: «Tiene otro combo de más
 * alto precio que sea de más calidad» —y le contestamos «Combo 2 En 1 está en
 * RD$1,690», que es el precio de lo que ya tenía delante y no lo que preguntó.
 * Pedir otro artículo no es preguntar el precio de este: es de los pocos casos
 * en los que el guion manda pasar el chat a un representante.
 */
/**
 * Otra TALLA, otro COLOR o el precio de una docena no son otro artículo: son
 * este mismo. Se contestan aquí y la venta sigue, sin pasar a nadie.
 */
const OTRA_COSA_DEL_MISMO = /\b(color|colores|talla|tallas|n[uú]mero|numeros|n[uú]meros|tama[ñn]o|medida|mayor|mayoreo|docena|docenas|unidades|llevo|llevando|llevar)\b/i;

const PIDE_OTRO_ARTICULO =
  /\b(tiene|tienen|hay|manejan|venden|tendr[aá]n?|queda|quedan)\b[^.?!\n]{0,30}\b(otro|otra|otros|otras)\b|\b(otro|otra|otros|otras)\b[^.?!\n]{0,30}\b(modelo|marca|combo|producto|art[ií]culo|opci[oó]n|calidad|version|versi[oó]n)\b|\bde (mejor|m[aá]s) calidad\b|\bm[aá]s (caro|cara|barato|barata|econ[oó]mico|econ[oó]mica)\b|\bcat[aá]logo completo\b|\bqu[eé] m[aá]s (tienen|venden|manejan)\b/i;

/**
 * CUÁNDO DICE QUE VUELVE: un día de la semana, un rato, la quincena. No basta
 * por sí solo —«¿me llega mañana?» habla del envío, no de aplazar—: acompaña a
 * una de las dos formas de abajo.
 */
const CUANDO_VUELVE =
  /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|pasado manana|luego|despues|mas tarde|mas adelante|otro dia|la semana que viene|la otra semana|la proxima|proxima semana|el fin de semana|la quincena|quincena|fin de mes|dia de pago|cuando (cobre|me paguen|pueda|tenga|reciba))\b/;

/** Que él vuelve a escribir, y ahí sobra el cuándo: «ya le aviso», «me comunico». */
const VUELVE_SIN_FECHA =
  /\b(ya le (digo|aviso|escribo|llamo|confirmo)|me comunico|nos hablamos|cualquier cosa le (aviso|escribo|llamo))\b/;

/** Que el que vuelve es ÉL, y dice qué día: «el lunes le llamo». */
const VUELVE_EL_CLIENTE =
  /\b(le|les|te|lo)\s+(llamo|llamare|escribo|escribire|aviso|avisare|confirmo|confirmare|hablo|busco|contacto|mando)\b/;

/** Y que lo que hará ese día es comprar: «el viernes lo ordeno». */
const COMPRA_ESE_DIA =
  /\b(ordeno|ordenare|compro|comprare|lo (compro|pido|ordeno|llevo|tomo)|la (compro|pido|ordeno|llevo)|hago el pedido|hago la orden|le hago el pedido)\b/;

/**
 * EL CLIENTE NO ESTÁ LISTO PARA COMPRAR: no se le insiste con el pedido.
 *
 * EL CASO REAL DE REPÚBLICA DOMINICANA: se le pidió la dirección, contestó «El
 * lunes le llamo» —que es un «ahora no» con fecha— y el agente siguió como si
 * nada: «Perfecto, hasta esa fecha. ¿Me facilita su número de teléfono para el
 * pedido?». Aquí casi nadie dice «no puedo ahora»: dice cuándo vuelve.
 */
export function clienteAplazaCompra(texto: string | null | undefined): boolean {
  const t = llano(texto ?? "").trim();
  if (!t) return false;
  // Una pregunta no aplaza nada: «¿me llega mañana?» pregunta por el envío.
  if (t.includes("?")) return false;
  if (
    /\b(ahora no|por ahora no|no puedo ahora|no tengo (dinero|recursos)|sin recursos|mas adelante|mas tarde|despues compro|cuando tenga|cuando cobre|cuando me paguen|lo voy a pensar|dejeme pensarlo|lo pienso|todavia no|no estoy listo|no estoy lista)\b/.test(t)
  ) {
    return true;
  }
  // «Ya le aviso», «me comunico»: dice que vuelve él, y no hace falta el día.
  if (VUELVE_SIN_FECHA.test(t)) return true;
  // «El lunes le llamo», «mañana le aviso», «le escribo luego».
  if (VUELVE_EL_CLIENTE.test(t) && CUANDO_VUELVE.test(t)) return true;
  // «El viernes lo ordeno», «en la quincena hago el pedido».
  return CUANDO_VUELVE.test(t) && COMPRA_ESE_DIA.test(t);
}

/**
 * LAS TALLAS QUE HAY para el artículo del anuncio, según la tabla base:
 * «de la 30 a la 42» para una correa o una faja, «de la 39 a la 45» para un
 * zapato. Null si el artículo no está en la tabla o no lleva talla.
 */
export function tallasDisponibles(descripcion: string, d: DatosPais): string | null {
  if (!d.tallas.usaTablaBase) return null;
  const fila = (articulo: string) => TALLAS_BASE.find((f) => f.articulo === articulo)?.tallas ?? null;
  if (CALZADO.test(descripcion)) return d.tallas.zapatoEn || fila("Zapatos");
  if (/\b(correa|correas|cintur[oó]n|cinturones)\b/i.test(descripcion)) return fila("Correas y cinturones");
  if (/\b(pantal[oó]n|pantalones|jean|jeans|short|shorts|bermuda)\b/i.test(descripcion)) return fila("Pantalones");
  if (/\b(camisas?|polos?|t-?shirts?|franelas?|blusas?|chacabanas?|su[eé]ter|sudadera|chaqueta|abrigo|b[oó]xers?|underwear)\b/i.test(descripcion)) return fila("Camisas, t-shirts, polos y boxers");
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
  // Lo primero: si pide OTRO artículo, ninguna de las respuestas de abajo
  // contesta lo que preguntó, por más que nombre el precio o el envío.
  if (PIDE_OTRO_ARTICULO.test(texto ?? "") && !OTRA_COSA_DEL_MISMO.test(texto ?? "")) return "otro_articulo";
  // «¿Cuáles son los tamaños disponibles?», «¿qué tallas hay?»: se contestan con las tallas, no con otra pregunta.
  if (/\b(tallas?|tamanos?|medidas?|numeros?)\b/.test(t) && /\b(disponible|disponibles|hay|tienen|tiene|cuales|cual|que|manejan|maneja|vienen|viene)\b/.test(t) && /\?|cuales|que|hay|tienen/.test(t)) return "tallas";
  // «Para cuando» a secas, sin signos, también pregunta cuándo llega: fue lo
  // que el cliente contestó cuando se le pidió el color, y se guardó de color.
  if (/\b(cuanto (tarda|demora|se demora|dura)|cuando (llega|me llega|lo recibo)|en cuanto tiempo|cuantos dias|p[ae]ra? cuando|cuando lo (tengo|recibo|mandan|env[ií]an)|cuando me lo (mandan|env[ií]an|entregan))\b/.test(t)) return "tiempo";
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
    case "otro_articulo":
      // Lo que se vende en este chat es lo del anuncio. Los demás artículos los
      // cotiza un representante: es lo que manda el guion de la dueña.
      return fraseDeTransferencia(d);
    case "ubicacion":
      return d.ubicacion.tiendaFisica;
    case "pago":
      return d.pagoAlCliente;
    case "tiempo":
      return "Entre 24 y 48 horas.";
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
