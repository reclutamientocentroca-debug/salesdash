/**
 * SalesDash — el revisor: la IA que mira cada respuesta ANTES de que salga.
 *
 * ═══ DOS IA POR PAÍS: UNA QUE RESPONDE Y UNA QUE REVISA ═══
 *
 * El agente escribe la respuesta; el revisor la lee con los datos del país
 * delante y decide si puede salir. Es la última puerta antes del cliente, y
 * existe porque un error de venta se paga: un envío cotizado de menos se paga
 * en cada pedido de esa zona, un descuento inventado se paga en esa venta, y
 * un resumen con el nombre de otra persona se paga con un paquete que vuelve.
 *
 * Tiene dos capas, y las dos son del mismo país que el agente:
 *
 *   1. REGLAS MECÁNICAS, sin modelo. Moneda de otro país, un costo de envío
 *      que no es ninguno de los del archivo, una forma de pago que no está
 *      configurada, un descuento o envío gratis, un día de entrega prometido,
 *      un resumen con un dato en blanco o a nombre de la vendedora. No fallan
 *      y no cuestan.
 *   2. EL MODELO REVISOR, con la conversación y el borrador delante: lo que
 *      una regla no puede ver —un precio distinto al del anuncio, una talla
 *      que ese artículo no lleva, una pregunta que ya se hizo, un resumen
 *      mandado sin que el cliente confirmara—.
 *
 * Cuando algo no pasa, el agente vuelve a escribir UNA vez con la corrección
 * delante. Si tampoco pasa, no se manda nada: el hilo pasa a una persona con
 * una anomalía que dice qué se paró y por qué. Callarse cuesta una respuesta;
 * mandarla mal cuesta la venta.
 *
 * ═══ SOLO LECTURA ═══
 * Esto no envía. No importa la función de envío y la prueba que barre `src/`
 * lo garantiza.
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
import { reColores } from "@/agents/base-comportamiento";
import { fallasDelResumen, leerResumen } from "./supervisor";
import { contieneMarcador, MARCADOR_POR_DEFECTO } from "./cierre";
import { completarJson, ErrorIA } from "./ia";
import { MODELO_ANALISIS, type Mensaje } from "./db";
import { conLoVistoYOido } from "./percepcion";
import { expresionesDelPais, pareceColor, pareceTalla, preguntasRepetidas, unidadesPorColores, type FichaDelPedido } from "./memoria";
import { clienteAplazaCompra, familiasNombradas, nombraUnArticulo, preguntaDelCliente, PREGUNTA_COLOR } from "./apertura";
import { zonaDelCliente } from "@/agents";
import { contieneLugar } from "./envio";
import { obtenerPais } from "./paises";

export interface Veredicto {
  aprobado: boolean;
  /** Por qué no, en palabras que el agente pueda corregir. Vacío si aprobado. */
  fallas: string[];
  /** Quién lo paró: las reglas o el modelo. */
  por: "reglas" | "modelo" | null;
}

export interface ContextoRevision {
  /** El país del canal: sus datos son el criterio. */
  datos: DatosPais;
  marcador?: string;
  /** Los nombres que nunca son de un cliente: vendedora y tienda. */
  nombresDeLaCasa: string[];
  /** Lo que el agente tenía delante para cotizar. */
  catalogo: string;
  anuncio: string | null;
  /** El bloque del país tal cual lo leyó el agente, para que el revisor use el mismo. */
  bloqueDelPais: string;
  /** Lo que el cliente ya dijo del pedido. Ver `memoria.ts`. */
  ficha?: FichaDelPedido;
  /** El nombre de la cuenta de WhatsApp, que no se usa. */
  nombreDeCuenta?: string | null;
  /** Si ese nombre el cliente lo escribió él mismo en el chat: entonces sí vale. */
  clienteEscribioSuNombre?: boolean;
  /** Si el cliente compartió su ubicación por el mapa en esta sesión. */
  clienteCompartioUbicacion?: boolean;
  /** Lo que el cliente escribió en esta sesión: el resumen tiene que salir de ahí. */
  textosDelCliente?: string[];
  /** Lo que la casa ya escribió en esta sesión: un paso dicho no se vuelve a abrir. */
  textosDelAgente?: string[];
  /** Hay foto del anuncio guardada: entonces pedir una foto NO es motivo de transferencia. */
  conFoto?: boolean;
  /** El número del chat, que vale como celular si el cliente dijo «a este mismo». */
  telefonoDelChat?: string | null;
  /** Dónde está el cliente según lo que escribió o su pin: decide la tarifa. */
  lugarDelCliente?: string | null;
  /** Lo último que escribió el cliente: decide si una transferencia tiene motivo. */
  ultimoDelCliente?: string | null;
  /** Lo último que mandó el agente: el mismo mensaje no sale dos veces seguidas. */
  ultimoDelAgente?: string | null;
  /** Si esta respuesta abre la conversación (o el cliente vuelve tras días). Solo ahí se saluda. */
  esApertura?: boolean;
}

/** Sin tildes ni mayúsculas. */
function llano(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Los importes escritos con símbolo de moneda, en dígitos. */
function importes(texto: string, simbolo: string): number[] {
  const s = simbolo.replace(/[$.]/g, (c) => `\\${c}`);
  const re = new RegExp(`${s}\\s?(\\d[\\d.,]*)`, "g");
  const salida: number[] = [];
  for (const m of texto.matchAll(re)) {
    // El punto o la coma que cierran la frase no son parte de la cifra:
    // «US$5.00.» es cinco, no quinientos.
    const crudo = m[1]!.replace(/[.,]+$/, "");
    if (!crudo) continue;
    // «2,500» y «2.500» son dos mil quinientos; «5.00» y «5,00» son cinco.
    const limpio = /[.,]\d{2}$/.test(crudo) && !/[.,]\d{3}$/.test(crudo)
      ? crudo.replace(/[.,](\d{2})$/, ".$1").replace(/[.,](?=\d{3})/g, "")
      : crudo.replace(/[.,]/g, "");
    const n = Number(limpio);
    if (Number.isFinite(n)) salida.push(n);
  }
  return salida;
}

const MONEDAS_AJENAS: { simbolo: RegExp; nombre: string; codigo: string }[] = [
  { codigo: "DOP", nombre: "pesos dominicanos", simbolo: /RD\$|\bDOP\b|pesos? dominicanos?/i },
  // «Colón» a secas es una provincia de Panamá: un cliente panameño que da su
  // dirección no está hablando en colones.
  { codigo: "CRC", nombre: "colones", simbolo: /₡|\bCRC\b|\bcolones\b|\d\s*col[oó]n\b/i },
  { codigo: "USD", nombre: "dólares", simbolo: /US\$|\bUSD\b|\bd[oó]lar(es)?\b/i },
  { codigo: "PAB", nombre: "balboas", simbolo: /B\/\.|\bPAB\b|\bbalboas?\b/i },
];

const PROMESAS_PROHIBIDAS: { re: RegExp; falla: string }[] = [
  { re: /env[ií]o gratis|gratis el env[ií]o|sin costo de env[ií]o/i, falla: "ofrece envío gratis" },
  { re: /\bdescuento|\brebaja|\bpromoci[oó]n\b|precio especial|te lo dejo en|se lo dejo en/i, falla: "ofrece un descuento o precio especial" },
  { re: /(le|te) llega (hoy|mañana|pasado mañana|el (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))|\bel (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo) (le|te) (llega|lo recibe|lo tiene)|(le|te) (llega|lo entregamos|lo recibe|lo tiene) (el )?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i, falla: "promete un día de entrega" },
  { re: /se lo aparto|se lo guardo|te lo aparto|te lo guardo|lo reservo|se lo reservo/i, falla: "reserva mercancía" },
  { re: /mand(ar|o)(le|te)? (dos|2) (tallas|modelos|unidades) para (probar|medir)/i, falla: "ofrece mandar dos para probar" },
];

const FORMAS_DE_PAGO = /contra entrega|contraentrega|transferencia|\bsinpe\b|\byappy\b|tarjeta|efectivo|\bach\b|dep[oó]sito|pago m[oó]vil|nequi|zelle|paypal/i;

/**
 * TODAS LAS CIFRAS QUE APARECEN EN LO QUE EL AGENTE TENÍA DELANTE.
 *
 * Catálogo, lo que escribió el negocio y el anuncio: de ahí salen los precios
 * válidos. Se toman TODOS los números —tallas incluidas— a propósito: el
 * revisor prefiere dejar pasar un precio raro que parar uno bueno, y una
 * talla que coincida con un importe es un caso que no se paga.
 *
 * Se leen con y sin símbolo de moneda porque la descripción del anuncio la
 * escribe el dueño como le sale: «RD$1,500», «1500 pesos», «Precio: 1.500».
 */
function cifrasConocidas(ctx: ContextoRevision): number[] {
  const fuentes = [ctx.catalogo, ctx.anuncio ?? ""].join("\n");
  const salida = new Set<number>();
  for (const m of fuentes.matchAll(/\d[\d.,]*/g)) {
    const crudo = m[0].replace(/[.,]+$/, "");
    if (!crudo) continue;
    // Las dos lecturas: «2,500» como dos mil quinientos y «5.00» como cinco.
    const candidatos = new Set<string>([crudo.replace(/[.,]/g, "")]);
    if (/[.,]\d{2}$/.test(crudo) && !/[.,]\d{3}$/.test(crudo)) {
      candidatos.add(crudo.replace(/[.,](\d{2})$/, ".$1").replace(/[.,](?=\d{3})/g, ""));
    }
    for (const c of candidatos) {
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) salida.add(n);
    }
  }
  return [...salida];
}

const igual = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * ¿ESTE IMPORTE SE PUEDE EXPLICAR CON LO QUE HAY DELANTE?
 *
 * Vale si es una cifra conocida, un envío del país, un precio conocido por una
 * cantidad razonable, la suma de dos precios conocidos, o cualquiera de esas
 * cosas más un envío. Lo que no cabe ahí es un precio inventado.
 */
function importeExplicable(n: number, conocidas: number[], envios: number[]): boolean {
  if (envios.some((c) => igual(c, n))) return true;
  return esSumaDePrecios(n, conocidas, [0, ...envios]);
}

/** Un precio conocido por una cantidad, o dos precios, más una de las sumas. */
function esSumaDePrecios(n: number, conocidas: number[], sumas: number[]): boolean {
  for (const p of conocidas) {
    for (let k = 1; k <= 12; k++) {
      for (const e of sumas) if (igual(p * k + e, n)) return true;
    }
    for (const q of conocidas) {
      for (const e of sumas) if (igual(p + q + e, n)) return true;
    }
  }
  return false;
}

/**
 * LAS REGLAS. No cuestan y no fallan: si una salta, la respuesta no sale.
 */
export function revisarConReglas(borrador: string, ctx: ContextoRevision): string[] {
  const d = ctx.datos;
  const fallas: string[] = [];
  const texto = borrador;

  // 1. Moneda de otro país.
  const propias = d.moneda.codigo === "PAB" || d.moneda.codigo === "USD" ? ["PAB", "USD"] : [d.moneda.codigo];
  for (const m of MONEDAS_AJENAS) {
    if (propias.includes(m.codigo)) continue;
    if (m.simbolo.test(texto)) fallas.push(`habla en ${m.nombre}, y aquí se cobra en ${d.moneda.nombre} (${d.moneda.simbolo})`);
  }

  // 2. Un costo de envío que no es ninguno de los del país.
  //
  // «Con el envío queda en RD$2,140» no cotiza el envío: es un total, precio
  // más tarifa, y se reconoce como tal para no pararlo.
  const costos = new Set([d.envio.restoDelPais.costo, ...d.envio.zonas.map((z) => z.costo)]);
  const conocidas = cifrasConocidas(ctx);
  const envios = [...costos];
  for (const frase of texto.split(/(?<=[.!?\n])\s+/)) {
    if (!/env[ií]o/i.test(frase) || /total/i.test(frase)) continue;
    for (const n of importes(frase, d.moneda.simbolo)) {
      if (!costos.has(n) && !esSumaDePrecios(n, conocidas, envios)) {
        fallas.push(
          `cotiza el envío en ${d.moneda.simbolo}${n}, y las únicas tarifas son ` +
            [...costos].map((c) => `${d.moneda.simbolo}${c}`).join(" y "),
        );
        break;
      }
    }
  }

  // 3. Forma de pago sin configurar: no se promete ninguna.
  if (!d.pago && FORMAS_DE_PAGO.test(texto)) {
    fallas.push("promete una forma de pago y en este país no hay ninguna configurada: eso lo confirma un representante");
  }

  // 4. Descuentos, envío gratis, días de entrega, reservas, muestrarios.
  for (const p of PROMESAS_PROHIBIDAS) if (p.re.test(texto)) fallas.push(p.falla);

  // 5. Un resumen tiene que ser un pedido: sin huecos y a nombre de un cliente.
  const marcador = ctx.marcador ?? MARCADOR_POR_DEFECTO;
  if (contieneMarcador(texto, marcador)) {
    const leido = leerResumen(texto, marcador);
    for (const f of fallasDelResumen(leido, ctx.nombresDeLaCasa, d)) {
      fallas.push(`manda el resumen y ${f}: no se manda hasta tener ese dato`);
    }
    // El envío del resumen tiene que ser uno de los del país.
    const lineaEnvio = texto.split(/\r?\n/).find((l) => /^\W*(costo de )?env[ií]o\b/i.test(llano(l)));
    if (lineaEnvio) {
      const n = importes(lineaEnvio, d.moneda.simbolo)[0];
      if (n !== undefined && !costos.has(n)) {
        fallas.push(`el envío del resumen dice ${d.moneda.simbolo}${n} y no es una tarifa de este país`);
      }
    }
  }

  // 6. UN PRECIO QUE NO ESTÁ EN LA DESCRIPCIÓN DEL ANUNCIO NI EN EL CATÁLOGO.
  //
  // Es la regla más cara de saltarse: un precio inventado es una venta que el
  // negocio no puede sostener y que el cliente ya leyó. Cada importe con
  // símbolo de moneda que escriba el agente tiene que explicarse con lo que
  // tenía delante; si no hay ningún precio escrito en ningún sitio, no puede
  // cotizar ninguno.
  {
    for (const n of importes(texto, d.moneda.simbolo)) {
      if (importeExplicable(n, conocidas, envios)) continue;
      fallas.push(
        conocidas.length
          ? `dice ${d.moneda.simbolo}${n} y ese precio no está escrito en la descripción del anuncio ni en el catálogo: el precio es el que está escrito ahí, con la misma cifra, y no se inventa ni se redondea`
          : `cotiza ${d.moneda.simbolo}${n} y no hay ningún precio escrito en la descripción del anuncio ni en el catálogo: no se inventa; se le dice al cliente que un representante le pasa el precio y se escribe "[HANDOFF]"`,
      );
      break;
    }
  }

  // 7. Una pregunta que el cliente ya contestó. La memoria es una puerta.
  if (ctx.ficha) fallas.push(...preguntasRepetidas(texto, ctx.ficha));

  // 8. El nombre de la cuenta de WhatsApp, si el cliente no lo escribió él.
  const cuenta = ctx.nombreDeCuenta?.trim();
  if (cuenta && cuenta.length >= 3 && !ctx.clienteEscribioSuNombre) {
    const primero = cuenta.split(/\s+/)[0]!;
    const re = new RegExp(`(^|[^\\p{L}])${primero.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)}([^\\p{L}]|$)`, "iu");
    if (re.test(texto)) {
      fallas.push(`llama al cliente «${primero}», que es el nombre de su cuenta de WhatsApp y él no lo ha escrito en el chat`);
    }
  }

  // 8b. Un artículo que no está ni en el anuncio ni en el catálogo no se ofrece.
  //
  // El caso real: «sábanas». Un modelo copia el producto de un ejemplo, o
  // convierte «La Sabana» —un barrio— en un artículo. Se paran por nombre
  // los que ya han salido; lo demás lo juzga el modelo revisor.
  //
  // Sin tildes, «La Sabana» (barrio de San José) y «sábana» (el producto)
  // son la misma palabra. Los nombres del mapa del país que llevan «sabana»
  // dentro se apartan: nombrar el barrio no es ofrecer un producto.
  {
    const fuentes = llano(`${ctx.catalogo}\n${ctx.anuncio ?? ""}`);
    const lugaresConSabana = [
      ...d.envio.zonas.flatMap((z) => z.lugares),
      ...(d.envio.restoDelPais.lugares ?? []),
      ...(obtenerPais(d.codigo)?.zonas ?? []),
      ...d.mapa.regiones.flatMap((r) => r.lugares),
    ].filter((l) => llano(l).includes("sabana"));
    const nombraUnLugar = contieneLugar(texto, lugaresConSabana);

    for (const articulo of ARTICULOS_FANTASMA) {
      if (nombraUnLugar && articulo.includes("sabana")) continue;
      const re = new RegExp(`(^|[^\\p{L}])${articulo}([^\\p{L}]|$)`, "iu");
      if (re.test(llano(texto)) && !fuentes.includes(articulo)) {
        fallas.push(`ofrece «${articulo}» y eso no está en la descripción del anuncio ni en el catálogo: esta tienda no lo vende`);
        break;
      }
    }
  }

  /*
   * 8b-bis. Y TAMPOCO UN ARTÍCULO DE OTRA FAMILIA. El caso real: «Perfecto, le
   * añado un pantalón polo color negro talla 32. ¿Desea algo más?» en un hilo
   * abierto por un anuncio de zapatos. El pedido no cambia de artículo a mitad:
   * se vende lo que está escrito arriba, y lo demás se transfiere.
   */
  if (AÑADE_AL_PEDIDO.test(texto)) {
    const fuentes = ctx.anuncio ? ctx.anuncio : ctx.catalogo;
    const enEsteChat = new Set(familiasNombradas(fuentes ?? "").map((f) => f.familia));
    if (enEsteChat.size) {
      const ajena = familiasNombradas(texto).find((f) => !enEsteChat.has(f.familia));
      if (ajena) {
        fallas.push(
          `añade «${ajena.palabra}» al pedido y en este chat se vende lo del anuncio, que es otra cosa: el pedido no cambia de artículo a mitad; si el cliente quiere otro artículo, se transfiere`,
        );
      }
    }
  }

  /*
   * 6b. EL COSTO DEL ENVÍO NO ES EL PRECIO DEL ARTÍCULO.
   *
   * El caso de la dueña (2026-09-08): un anuncio de polos que era solo una foto
   * —sin precio ni en la imagen ni en el texto— y la IA contestando «El precio
   * es RD$250 cada una», que es la tarifa de envío de la capital. Cuando al
   * agente le falta el precio, la cifra que tiene a mano es la del envío, y esa
   * regla de arriba no lo para: un importe que ES una tarifa del país se
   * explica solo.
   *
   * Solo salta si esa cifra no es además un precio de verdad: si el catálogo
   * vende algo a 250, decir 250 está bien.
   */
  for (const frase of texto.split(/(?<=[.!?\n])\s+/)) {
    if (/env[ií]o|domicilio|mensajer|total/i.test(frase)) continue;
    if (!DICE_LO_QUE_VALE.test(frase)) continue;
    const cobrado = importes(frase, d.moneda.simbolo).find(
      (n) => costos.has(n) && !conocidas.some((c) => igual(c, n)),
    );
    if (cobrado !== undefined) {
      fallas.push(
        `dice que el artículo vale ${d.moneda.simbolo}${cobrado} y esa es la tarifa del ENVÍO, no su precio: ` +
          "el precio sale de la descripción del anuncio o del catálogo, y si ahí no está, no lo das — " +
          'se lo pasa un representante y escribes "[HANDOFF]"',
      );
      break;
    }
  }

  /*
   * 8b-ter. Y NO SE LE CAMBIA EL ARTÍCULO AL CLIENTE DEL ANUNCIO.
   *
   * El caso de la dueña (2026-09-08): el anuncio era una foto de unos jeans, el
   * agente no tenía el precio de esa foto, y en vez de transferir le contestó
   * «Actualmente estamos ofreciendo los Polos Bronx Originales». El cliente
   * pidió tres pantalones dos veces y se fue con un «yo le aviso».
   *
   * Quien llega por un anuncio viene por LO QUE VIO. Si de eso no se sabe el
   * nombre o el precio, se transfiere —y quien atiende los escribe en la
   * casilla del hilo—; lo que no se hace nunca es ofrecerle otra cosa.
   *
   * Un borrador que YA transfiere queda fuera: ahí nombrar el otro artículo es
   * explicar por qué se pasa a una persona, que es justo lo que se pide.
   */
  if (ctx.anuncio && !HABLA_DE_TRANSFERIR.test(texto)) {
    const delAnuncio = new Set(familiasNombradas(ctx.anuncio).map((f) => f.familia));
    if (delAnuncio.size) {
      const otra = familiasNombradas(texto).find((f) => !delAnuncio.has(f.familia));
      if (otra) {
        fallas.push(
          `le ofrece «${otra.palabra}» y este cliente llegó por un anuncio de otra cosa: no se le cambia el artículo. ` +
            "Véndele el del anuncio; si de ese no sabes el nombre o el precio, dile que un representante le pasa la información y transfiere",
        );
      }
    }
  }

  /*
   * 8m. «¿DESEA ALGO MÁS?» NO SE PREGUNTA. Vuelve a abrir la venta que se
   * acababa de cerrar y de paso invita a añadir cosas que no se vendieron: el
   * caso real acabó con un artículo añadido que no estaba ni en el resumen.
   */
  if (/[¿?][^?¿]*\b(algo m[aá]s|alguna otra cosa|algo adicional)\b[^?¿]*\?/i.test(texto)) {
    fallas.push("pregunta si desea algo más: eso vuelve a abrir la venta que acabas de cerrar; sigue con el paso que toca o cierra");
  }

  // 8c. UNA TALLA, UN NÚMERO O UN COLOR A UN ARTÍCULO QUE NO LOS LLEVA.
  //
  // El caso real: «¿Qué talla necesita?» a un combo de cepillo secador y
  // plancha. Un modelo copia la pregunta del ejemplo o de la costumbre. Si
  // ni la descripción del anuncio ni el catálogo dicen que el artículo tenga
  // tallas o colores, y encima el artículo es de los que no los llevan, la
  // pregunta no sale.
  fallas.push(...preguntaDeVarianteSinVariante(texto, ctx));

  // 8g. COLORES INVENTADOS. El caso real: «en negro y rosa» para un combo cuya
  // descripción no dice ningún color. Un color que no está escrito no existe.
  {
    const fuentes = llano(ctx.anuncio ? ctx.anuncio : ctx.catalogo);
    if (fuentes.trim()) {
      const dichos = [...new Set(llano(texto).match(COLORES_NOMBRADOS) ?? [])];
      const inventados = dichos.filter((c) => !fuentes.includes(c));
      if (inventados.length) {
        fallas.push(
          `dice que viene en «${inventados.join("», «")}» y ni la descripción del anuncio ni el catálogo lo dicen: no inventes colores; si no hay colores escritos, no se nombran ni se preguntan`,
        );
      }
    }
  }

  // 8h. EL PRIMER MENSAJE DOMINICANO, CON EL FORMATO DEL DOCUMENTO: el saludo
  // tal cual, y debajo el producto, el precio y la pregunta. Sin párrafos.
  if (ctx.esApertura && d.codigo === "do") {
    const saludo = llano(d.saludo).trim();
    if (saludo && !llano(texto).trim().startsWith(saludo)) {
      fallas.push(`el primer mensaje empieza con «${d.saludo}» tal cual, y debajo el producto, el precio y la pregunta`);
    }
    const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lineas.length > 6 || texto.length > 420) {
      fallas.push("el primer mensaje va en cuatro líneas cortas —saludo, producto, precio y pregunta—, sin párrafos ni ficha técnica");
    }
  }

  // 8i. LA TALLA VA ANTES QUE LA DIRECCIÓN. El caso real: «¿A qué provincia se
  // lo enviamos?» a unos polos, sin haber preguntado la talla.
  {
    const fuentes = llano(ctx.anuncio ? ctx.anuncio : ctx.catalogo);
    const llevaTalla = CON_TALLA_SIEMPRE.test(fuentes) && !SIN_VARIANTES.test(fuentes);
    const pideDireccion =
      /[¿?][^?¿]*(direcci[oó]n|provincia|a d[oó]nde se lo|d[oó]nde se lo enviamos|sector|cant[oó]n|corregimiento)[^?¿]*\?|indique su direcci[oó]n/i.test(texto);
    if (llevaTalla && ctx.ficha && !ctx.ficha.talla && pideDireccion && !PREGUNTA_TALLA.test(llano(texto))) {
      fallas.push("pide la dirección o la provincia antes de la talla, y este artículo lleva talla: primero «¿Qué talla le interesa?»");
    }
  }

  // 8j. «LE CONFIRMO» SOLO CON TODOS LOS DATOS. El caso real: «Le confirmo:
  // Polo Bronx, RD$1,400 cada uno. ¿A qué provincia…?» como primer mensaje.
  if (/^\W*le confirmo\b/i.test(texto.trim()) && ctx.ficha && (!ctx.ficha.nombre || !ctx.ficha.direccion)) {
    fallas.push("dice «Le confirmo» sin tener el nombre y la dirección del cliente: la confirmación va cuando ya tienes todos los datos; ahora sigue con el dato que falta");
  }

  // 8l. LA CANTIDAD NO SE PREGUNTA NUNCA (los tres países). Se asume una unidad
  // salvo que el cliente diga otra. El caso real: «¿Cuántas unidades desea?» de
  // primer mensaje a un combo. La única excepción: el cliente habló de mayoreo
  // sin decir un número, y ahí sí hay que saber cuántas para cotizar.
  {
    const pideCantidad =
      /[¿?][^?¿]*(cu[aá]nt[oa]s (unidades|pares|piezas|art[ií]culos|va a llevar|vas a llevar|desea|deseas|quiere|quieres|lleva|llevas|necesita|necesitas|le env[ií]o|te env[ií]o)|qu[eé] cantidad|cantidad (desea|quiere|necesita|va a llevar))[^?¿]*\?/i.test(texto);
    const mayoreoSinNumero = CLIENTE_PIDE_MAYOREO.test(ctx.ultimoDelCliente ?? "") && !/\d/.test(ctx.ultimoDelCliente ?? "");
    if (pideCantidad && !mayoreoSinNumero) {
      fallas.push("pregunta la cantidad: nunca se pregunta, se asume una unidad salvo que el cliente diga otra; sigue con el paso que toca (talla si la lleva, si no la dirección)");
    }
  }

  /*
   * 8n. CON TODOS LOS DATOS, LO QUE SALE ES EL RESUMEN, NO OTRA PREGUNTA.
   *
   * La dueña, 2026-09-08: «que no pregunte si se lo despachamos, que envíe su
   * resumen, transfiera a un representante y deje de responder». El pedido no
   * se confirma dos veces: quien ya dio su dirección, su teléfono y su nombre
   * ya dijo que sí, y cada «¿se lo despacho hoy mismo?» era una venta parada
   * esperando un mensaje más que muchas veces no llegaba.
   */
  {
    const f = ctx.ficha;
    const fuentes = llano(ctx.anuncio ? ctx.anuncio : ctx.catalogo);
    const faltaTalla = CON_TALLA_SIEMPRE.test(fuentes) && !SIN_VARIANTES.test(fuentes) && !f?.talla;
    // El celular es dato de cierre en los guiones de la dueña; en Panamá no.
    const faltaCelular = (d.codigo === "do" || d.codigo === "cr") && !f?.celular;
    const completa = !!f?.nombre && !!f?.direccion && !faltaTalla && !faltaCelular;
    if (
      completa &&
      !contieneMarcador(texto, ctx.marcador ?? MARCADOR_POR_DEFECTO) &&
      PIDE_CONFIRMAR_EL_PEDIDO.test(texto)
    ) {
      fallas.push(
        "ya tiene todos los datos del pedido y en vez del resumen pide una confirmación de más: el pedido no se confirma dos veces — manda directamente el resumen, con la línea de la transferencia pegada, y no vuelvas a escribir",
      );
    }
  }

  // 8k. EL TELÉFONO VA CON EL COSTO DE ENVÍO, DESPUÉS DE LA DIRECCIÓN. El caso
  // real: «¿Me facilita su número de teléfono?» sin tener la dirección. Es
  // regla fija de los dos guiones de la dueña, el dominicano y el tico: «Nunca
  // pides el teléfono sin haber dicho antes el costo de envío», y el costo no
  // se sabe hasta tener la dirección.
  if (
    (d.codigo === "do" || d.codigo === "cr") &&
    ctx.ficha &&
    !ctx.ficha.direccion &&
    /[¿?][^?¿]*(tel[eé]fono|celular|n[uú]mero de contacto|n[uú]mero le llama)[^?¿]*\?/i.test(texto)
  ) {
    fallas.push("pide el teléfono antes de la dirección: primero «Indique su dirección exacta de entrega.», y el teléfono va en el mismo mensaje que el costo de envío");
  }

  /*
   * 8l. EL QUE DIJO CUÁNDO VUELVE NO SE VA CON UN FORMULARIO DETRÁS.
   *
   * El caso real de República Dominicana: se le pidió la dirección, contestó
   * «El lunes le llamo» —que aquí es el «ahora no» de todo el mundo— y el
   * agente siguió como si nada: «Perfecto, hasta esa fecha. ¿Me facilita su
   * número de teléfono para el pedido?». Insistirle a alguien que ya se
   * despidió es lo que hace que el lunes no escriba.
   */
  if (clienteAplazaCompra(ctx.ultimoDelCliente)) {
    if (PIDE_UN_DATO_DEL_PEDIDO.test(texto)) {
      fallas.push(
        "el cliente dijo que vuelve más adelante y la respuesta le sigue pidiendo datos del pedido: se le contesta «Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.» y nada más",
      );
    }
    if (contieneMarcador(texto, ctx.marcador ?? MARCADOR_POR_DEFECTO)) {
      fallas.push("el cliente dijo que vuelve más adelante y esto le manda el resumen: un pedido que él no ha aceptado no se levanta");
    }
  }

  // 8d. LA UBICACIÓN NO SE PIDE POR EL MAPA, Y NO SE INSISTE.
  //
  // El cliente puede decir dónde está y con eso basta. Pedirle que comparta
  // su ubicación, que la confirme o que la repita —cuando ya dijo dónde está
  // o ya la mandó— es lo que hace que se canse y se vaya.
  if (PIDE_UBICACION.test(llano(texto))) {
    if (ctx.ficha?.direccion || ctx.clienteCompartioUbicacion) {
      fallas.push("le pide la ubicación y el cliente ya dijo dónde está: no se insiste, se sigue con lo que dio");
    } else {
      fallas.push("le pide que comparta su ubicación por el mapa: no se pide; se le pregunta en qué provincia o sector está");
    }
  }

  /*
   * 8m. LA DIRECCIÓN QUE YA DIO NO SE COMPLETA A PREGUNTAS.
   *
   * El caso que paró la dueña de República Dominicana: el cliente mandó su
   * dirección y el agente contestó «Perfecto, Los Coquitos. ¿Me puede decir el
   * número de casa o apartamento y alguna seña para reconocer la puerta?».
   * Con lo que el cliente escribió ya se despacha, y para lo demás el mensajero
   * llama al teléfono —que sí se pide—. Cada repregunta por la puerta es una
   * conversación más larga y una venta menos.
   */
  if (
    (ctx.ficha?.direccion || ctx.clienteCompartioUbicacion) &&
    PIDE_MAS_DETALLE_DE_LA_DIRECCION.test(llano(texto))
  ) {
    fallas.push(
      "le pide un dato más de la dirección —el número de casa, el apartamento, una seña, un punto de referencia— y el cliente ya se la dio: se da por buena, se le dice el costo del envío y se sigue con lo que falte",
    );
  }

  /*
   * 8n. UN DATO QUE EL CLIENTE NO DIO NO SE DA POR RECIBIDO.
   *
   * El caso que paró la dueña (RD, 2026-09-08): «¿Qué talla le interesa?» →
   * «Poloche que quiero» —que es el artículo, no una medida— y el agente
   * contestó «Perfecto, ya tenemos su talla. ¿En qué color le interesa?». La
   * talla no llegó nunca: el pedido siguió por el color, por el mayoreo y
   * habría acabado en un resumen sin talla, o con la frase del cliente dentro.
   *
   * Es el mismo agujero que la ubicación de la regla 10, y aquí se cierra para
   * los cuatro datos del pedido: si la ficha no lo tiene y el cliente no lo ha
   * escrito en toda la sesión, decir que ya se tiene es inventarlo.
   */
  const afirmaciones = afirmacionesDe(texto);
  if (ctx.ficha) {
    const loEscribio = (parece: (t: string) => boolean) =>
      [...(ctx.textosDelCliente ?? []), ctx.ultimoDelCliente ?? ""].some((t) => !!t && parece(t));

    const datos: Array<[string, string, boolean]> = [
      ["talla", "la talla", !ctx.ficha.talla && !loEscribio(pareceTalla)],
      ["color", "el color", !ctx.ficha.color && !loEscribio(pareceColor)],
      ["direccion", "la dirección", !ctx.ficha.direccion && !ctx.clienteCompartioUbicacion],
      ["nombre", "el nombre", !ctx.ficha.nombre && !ctx.clienteEscribioSuNombre],
    ];

    for (const [campo, comoSeLlama, falta] of datos) {
      if (!falta || !afirmaciones.some((f) => DA_POR_RECIBIDO[campo]!.test(f))) continue;
      fallas.push(
        `da por recibid${campo === "color" || campo === "nombre" ? "o" : "a"} ${comoSeLlama} y el cliente no la ha dicho en esta conversación: lo que contestó no es ${comoSeLlama}. Contéstale en una línea lo que dijo y vuelve a pedirle ${comoSeLlama}`,
      );
    }
  }

  /*
   * 8o. EL COSTO DEL ENVÍO SE DICE UNA VEZ, NO CADA VEZ.
   *
   * El caso que paró la dueña (RD, 2026-09-08): el cliente mandó su dirección
   * en una nota de voz, el agente se la confirmó con el envío y el total, y
   * cuatro mensajes más tarde volvió a abrir el mismo paso —«Perfecto, hasta
   * Guayacánal el envío le sale en RD$290. ¿Me facilita su número de
   * teléfono?»—. Quien ya dio su dirección ve una conversación que no avanza.
   *
   * Lo provoca el propio guion: «nunca pides el teléfono sin haber dicho antes
   * el costo de envío». El modelo, al que le falta el teléfono, vuelve a
   * cotizar para poder pedirlo. Aquí se para lo que el guion ya dice arriba:
   * esa frase va UNA vez, en el mensaje en que llega la dirección.
   *
   * Solo cuando repite la MISMA tarifa: si el cliente cambia de zona, el envío
   * nuevo hay que decírselo.
   */
  {
    const tarifaDicha = (t: string) =>
      /env[ií]o/i.test(t) && !contieneMarcador(t, ctx.marcador ?? MARCADOR_POR_DEFECTO)
        ? importes(t, d.moneda.simbolo).filter((n) => costos.has(n))
        : [];
    const yaDichas = new Set((ctx.textosDelAgente ?? []).flatMap(tarifaDicha));
    if (
      (ctx.ficha?.direccion || ctx.clienteCompartioUbicacion) &&
      tarifaDicha(texto).some((n) => yaDichas.has(n))
    ) {
      fallas.push(
        "vuelve a cotizarle el envío y ya se lo dijo en esta conversación: el costo va una sola vez, cuando llega la dirección. Pídele solo el dato que falta, sin repetir el paso",
      );
    }
  }

  /*
   * 8p. SIN SABER QUÉ QUIERE, NO SE VENDE NADA.
   *
   * El caso que paró la dueña (Costa Rica, 2026-09-08): el cliente escribió
   * «Hlola» y «Hola», nada más, y el agente contestó «¿Me confirma qué talla le
   * interesa del Polo Brox?». El polo lo eligió él, del catálogo: el cliente no
   * lo había nombrado nunca. Antes de eso ya le había pedido la dirección.
   *
   * Mientras no haya anuncio y el cliente no diga QUÉ quiere, lo único que va
   * es el saludo y «¿Cuál es el artículo de su interés?». Los datos del pedido
   * —talla, color, dirección, teléfono, nombre— son de un artículo, y todavía
   * no hay artículo.
   *
   * No se aplica con la venta ya en marcha —si en la ficha hay talla, color o
   * dirección, el artículo se acordó de alguna forma— para no cortar un hilo
   * por una palabra que esta casa no sepa reconocer.
   */
  {
    const dichoPorElCliente = [...(ctx.textosDelCliente ?? []), ctx.ultimoDelCliente ?? ""].filter(Boolean);
    const enMarcha = !!(ctx.ficha?.talla || ctx.ficha?.color || ctx.ficha?.direccion);

    /*
     * LA SEÑAL ES QUE EL CLIENTE SOLO HA SALUDADO, no que la casa no reconozca
     * lo que escribió. Con «Poloche que quiero» —el polo, como se dice allá—
     * el cliente SÍ dijo qué quiere aunque esa palabra no esté en ninguna lista
     * nuestra, y pararle la respuesta al agente por no saber leerla es perder
     * la venta por no conocer un idioma. «Hola» no admite esa duda.
     *
     * Se para cualquier dato del pedido, se nombre o no el artículo: a un «hola»
     * le contestó «Indique su dirección exacta de entrega.» antes de inventarse
     * el polo. Enseñarle las opciones del catálogo sin pedirle nada sigue
     * valiendo, que es justo cómo se le pregunta cuál quiere.
     */
    /*
     * Y PREGUNTAR POR EL CONJUNTO TAMPOCO ES ELEGIR (la dueña, Costa Rica,
     * 2026-09-08): «¿Cuál es el precio de la ropa?» y la respuesta fue «Indique
     * su dirección exacta de entrega.». «La ropa» no es un artículo —esta
     * tienda vende veinte— y sin artículo no hay dirección que pedir.
     *
     * Se mira que la pregunta sea POR EL CONJUNTO y que no nombre nada: con
     * «¿cuánto cuesta el poloche?» el cliente sí eligió, aunque esa palabra no
     * esté en ninguna lista nuestra, y ahí no se le para nada.
     */
    if (
      dichoPorElCliente.length > 0 &&
      dichoPorElCliente.every((t) => SOLO_SALUDA.test(t) || preguntaPorElConjunto(t)) &&
      !ctx.anuncio &&
      !enMarcha &&
      PIDE_UN_DATO_DEL_PEDIDO.test(texto)
    ) {
      fallas.push(
        "el cliente solo ha saludado o ha preguntado por lo que vendes en general, no hay anuncio y todavía no sabes qué artículo quiere: la respuesta ya le pide un dato del pedido. El artículo lo elige él, no lo saques del catálogo. Salúdalo si toca y pregúntale «¿Cuál es el artículo de su interés?», y espera a que conteste",
      );
    }
  }

  // 7b. EL MISMO MENSAJE DOS VECES SEGUIDAS NO SALE.
  //
  // El caso real: «¿Qué número calza?» tres veces, una detrás de otra, con un
  // «39» del cliente en medio. Repetir lo que el cliente ya leyó le dice que
  // no le están escuchando.
  const anterior = ctx.ultimoDelAgente ? llano(ctx.ultimoDelAgente).replace(/\s+/g, " ").trim() : "";
  if (anterior && anterior === llano(texto).replace(/\s+/g, " ").trim()) {
    fallas.push(
      "manda exactamente lo mismo que ya mandó en el mensaje anterior: contesta lo que el cliente acaba de decir y sigue con el siguiente dato, con otras palabras",
    );
  }

  // 7c. UNA PREGUNTA DEL CLIENTE SE CONTESTA ANTES DE SEGUIR.
  //
  // «¿Dónde están?» seguido de «¿Qué número calza?» es un robot. Si el cliente
  // preguntó dónde están, por el envío o por el pago, la respuesta tiene que
  // hablar de eso.
  const pregunta = preguntaDelCliente(ctx.ultimoDelCliente);
  if (pregunta === "ubicacion" && !/tienda|virtual|local|estamos|enviamos|ubicad|direcci[oó]n/i.test(texto)) {
    fallas.push("el cliente preguntó dónde están y no se lo contesta: dile primero dónde están (tienda virtual, envíos a todo el país) y después sigue con el dato que falta");
  }
  if (pregunta === "envio" && !/env[ií]o|entrega|delivery|\d/i.test(texto)) {
    fallas.push("el cliente preguntó por el envío y no se lo contesta: dile primero cuánto le sale y cómo le llega, y después sigue");
  }
  if (pregunta === "pago" && !/pag|contra entrega|sinpe|transferencia|efectivo|recibir/i.test(texto)) {
    fallas.push("el cliente preguntó cómo se paga y no se lo contesta: dile primero cómo se paga y después sigue");
  }
  /*
   * EL PRECIO ES LA PREGUNTA QUE MÁS SE HACE Y LA ÚNICA QUE NO SE COMPROBABA.
   *
   * El caso de la dueña (República Dominicana, 2026-09-08): el cliente abrió
   * con «Buenas.k precio», el agente le contestó con el artículo pero sin
   * cifra, le sacó la talla, y cuando el cliente insistió —«Primero deme
   * precio»— le respondió «Indique su dirección exacta de entrega.». Dos veces
   * preguntó lo mismo y las dos se quedó sin respuesta. Nadie da su dirección
   * antes de saber cuánto cuesta.
   *
   * Se le dice el precio y DESPUÉS se sigue con el paso que tocaba: primero lo
   * suyo y después lo tuyo, que es lo que ya manda el guion. Si no hay ningún
   * precio escrito —ni en el anuncio, ni en el catálogo—, no se inventa: eso sí
   * es motivo de transferencia, y por eso la frase de transferir vale.
   */
  /*
   * SALVO CUANDO NO SE SABE DE QUÉ ARTÍCULO PREGUNTA (la dueña, Costa Rica,
   * 2026-09-08). «¿Cuál es el precio de la ropa?» sin anuncio delante no tiene
   * una cifra que contestar: la tienda vende veinte cosas a veinte precios. Lo
   * que toca es saludar y preguntarle cuál le interesa, y esa respuesta —la
   * correcta— la paraba esta misma regla por no llevar número.
   */
  const preguntaQueArticulo = !ctx.anuncio && PREGUNTA_QUE_ARTICULO.test(texto);

  if (
    pregunta === "precio" &&
    !preguntaQueArticulo &&
    importes(texto, d.moneda.simbolo).length === 0 &&
    !HABLA_DE_TRANSFERIR.test(texto) &&
    !contieneMarcador(texto, ctx.marcador ?? MARCADOR_POR_DEFECTO)
  ) {
    fallas.push(
      cifrasConocidas(ctx).length > 0
        ? `el cliente preguntó el precio y la respuesta no lo dice: dáselo primero, con la cifra tal cual está escrita y en ${d.moneda.simbolo}, y después sigue con el dato que falta`
        : "el cliente preguntó el precio y no hay ninguno escrito en el anuncio ni en el catálogo: no te lo inventes, dile que le atiende un representante y transfiere",
    );
  }

  // El caso real: «¿Cuáles son los tamaños disponibles?» → «¿Qué talla necesita?».
  if (pregunta === "tallas" && !TIENE_TALLAS.test(texto)) {
    fallas.push("el cliente preguntó qué tallas hay y no se las dice: dile primero las tallas disponibles (de la descripción o de la tabla de tallas) y después pregúntale cuál quiere");
  }

  // 9b. SIN APODOS NI CONFIANZAS. El trato es formal y de empresa.
  //
  // El caso real: «¿Maestro, me regala su talla…?» en Costa Rica. Al cliente
  // no se le llama maestro, jefe, amigo ni nada parecido, en ningún país.
  const apodo = texto.match(APODOS);
  if (apodo) {
    fallas.push(
      `llama al cliente «${apodo[2]}» y eso no es aceptable: el trato es formal y educado, de empresa, sin apodos ni confianzas. Si hace falta dirigirse a él, por su nombre o sin nada`,
    );
  }

  /*
   * 9b bis. LO QUE ESTE PAÍS TIENE PROHIBIDO DECIR NO SALE.
   *
   * La dueña (2026-09-08): en Costa Rica, «pura vida» fuera de todos los
   * mensajes. Quitarla de la lista de expresiones del prompt no basta —un
   * modelo la sabe sin que nadie se la enseñe y la suelta al saludar y al
   * despedirse—, así que se comprueba aquí, que es lo único que de verdad
   * decide si un mensaje sale.
   */
  for (const frase of d.habla.prohibidas ?? []) {
    const suelta = new RegExp(`(^|[^\\p{L}])${llano(frase).replace(/\s+/g, "\\s+")}([^\\p{L}]|$)`, "iu");
    if (suelta.test(llano(texto))) {
      fallas.push(
        `dice «${frase}» y en ${d.nombre} eso no se dice nunca, ni aunque el cliente lo haya escrito: quítalo y contesta con la cortesía de siempre`,
      );
    }
  }

  /*
   * 9c. DONDE VA UN NOMBRE NO VA UN SALUDO DE AQUÍ.
   *
   * EL CASO REAL DE COSTA RICA: pedidos «a nombre de Pura vida». Aquí «pura
   * vida» es hola, gracias y adiós, así que el cliente la escribe en cualquier
   * turno —también cuando le preguntan cómo se llama— y el agente la tomaba
   * por su nombre. Ponerle a alguien un nombre que no es suyo no es cercano:
   * el paquete sale a nombre de nadie y el mensajero pregunta por un saludo.
   *
   * Esta regla es la del NOMBRE y vale para cualquier expresión del país,
   * incluidas las que el agente sí puede decir: «don Diay», «a nombre de A la
   * orden». Que en Costa Rica «pura vida» esté además prohibida entera la
   * para antes la regla de arriba; esta sigue haciendo falta para el resto y
   * para los países donde no hay nada prohibido.
   */
  {
    const expresiones = expresionesDelPais(d).filter((e) => e.length >= 3 && !/[?¿]/.test(e));
    if (expresiones.length > 0) {
      const lista = expresiones.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)).join("|");
      const dondeVaUnNombre = new RegExp(
        `\\b(a nombre de|nombre:|se[nñ]or|se[nñ]ora|sr\\.?|sra\\.?|don|dona|el pedido de|la orden de|el paquete de|se lo dejamos a)\\s+(${lista})\\b`,
        "i",
      );
      const puesto = llano(texto).match(dondeVaUnNombre);
      if (puesto) {
        fallas.push(
          `pone «${puesto[2]}» donde va el nombre del cliente, y eso es un saludo de aquí, no una persona: el nombre se pregunta y se escribe el que él conteste`,
        );
      }
    }
  }

  // 8e. UNA TRANSFERENCIA SIN MOTIVO NO SALE.
  //
  // El caso real: el agente le decía «en un momento será transferido a un
  // representante» a todo el mundo, y no vendía. Solo se transfiere con el
  // resumen, cuando el cliente pide una foto, cuando pide precio al por mayor,
  // cuando pide hablar con una persona, o cuando no hay precio en ningún
  // sitio. Por nada más: lo demás se contesta y se sigue vendiendo.
  if (HABLA_DE_TRANSFERIR.test(texto) && !transferenciaPermitida(texto, ctx)) {
    fallas.push(
      "transfiere al representante sin motivo: solo se transfiere con el resumen, por una foto, por precio al por mayor o si el cliente pide hablar con una persona. Contesta lo que preguntó y sigue vendiendo el artículo",
    );
  }

  // 8f. EL SALUDO VA UNA SOLA VEZ, AL PRINCIPIO.
  //
  // El caso real: «Hola, le asiste TELLERIA» en el primer mensaje, en el
  // tercero y «Gracias, le asiste TELLERIA» en el quinto. Fuera de la
  // apertura, presentarse otra vez no sale.
  if (ctx.esApertura === false && SE_PRESENTA.test(texto)) {
    fallas.push("vuelve a saludar y a presentarse, y eso va solo en el primer mensaje: contesta directo y sigue");
  }

  // 9. Tutear donde se vende de usted.
  if (d.trato === "usted" && TUTEO.test(texto)) {
    fallas.push("tutea al cliente («quieres», «te lo», «tu pedido»), y aquí se vende de usted");
  }

  // 10. Una ubicación que el cliente no ha compartido en esta conversación.
  if (!ctx.clienteCompartioUbicacion && /me lleg[oó] (su|tu) ubicaci[oó]n|recib[ií] (su|tu) ubicaci[oó]n|ubicaci[oó]n (compartida|que (me )?(envi[oó]|mand[oó]))/i.test(texto)) {
    fallas.push("dice que le llegó una ubicación y el cliente no ha compartido ninguna en esta conversación");
  }

  // 11. El envío tiene que ser el de la zona del cliente, no el otro.
  const zonaDe = (donde: string | null | undefined) => {
    const z = donde ? zonaDelCliente(d, donde) : null;
    if (z === null) return null;
    return z === "resto" ? d.envio.restoDelPais.costo : z.costo;
  };
  {
    const tarifaSuya = zonaDe(ctx.lugarDelCliente);
    for (const frase of texto.split(/(?<=[.!?\n])\s+/)) {
      if (!/env[ií]o/i.test(frase) || /total/i.test(frase)) continue;
      /*
       * La zona que manda es la que nombra la propia frase, si nombra alguna
       * —«el envío a Santo Domingo Este es RD$290» se corrige solo, diga lo
       * que diga el resto del hilo—, y si no, la del cliente.
       */
      const tarifa = zonaDe(frase) ?? tarifaSuya;
      if (tarifa === null) continue;
      // Una frase que lista las dos tarifas informa, no cotiza mal: solo se para la que da UNA y no es la de esa zona.
      const enLaFrase = [...new Set(importes(frase, d.moneda.simbolo).filter((n) => costos.has(n)))];
      const otra = enLaFrase.length === 1 && enLaFrase[0] !== tarifa ? enLaFrase[0] : undefined;
      if (otra !== undefined) {
        fallas.push(`cotiza el envío en ${d.moneda.simbolo}${otra} y a esa zona le toca ${d.moneda.simbolo}${tarifa}`);
        break;
      }
    }
  }

  // («Despachar» dejó de pararse el 2026-09-05: los guiones de la dueña cierran
  // con «¿Se lo despacho hoy mismo?».)

  // 12. Lo que va en el resumen lo tiene que haber escrito el cliente.
  if (contieneMarcador(texto, marcador) && ctx.textosDelCliente) {
    const leido = leerResumen(texto, marcador);
    const escrito = ctx.textosDelCliente.map(llano).join("\n");

    if (leido.nombre && !escrito.includes(llano(leido.nombre.trim()))) {
      fallas.push(`el resumen va a nombre de «${leido.nombre}» y el cliente no escribió ese nombre en esta conversación: pregúntaselo`);
    }

    const cel = leido.cel?.replace(/\D/g, "") ?? "";
    if (cel.length >= 7) {
      const delChat = (ctx.telefonoDelChat ?? "").replace(/\D/g, "");
      const loDijo = ctx.textosDelCliente.some((m) => m.replace(/\D/g, "").includes(cel));
      const esElDelChat = delChat.length >= 7 && (delChat.endsWith(cel) || cel.endsWith(delChat));
      if (!loDijo && !esElDelChat) {
        fallas.push(`el celular del resumen (${leido.cel}) no lo dio el cliente en esta conversación ni es el de este chat`);
      }
    }

    /*
     * 12b. LA TALLA Y EL COLOR DEL RESUMEN SON LOS QUE DIO EL CLIENTE.
     *
     * El caso real: «Talla: 39 / Color: Para cuando», y el color era un trozo
     * de una frase suya que se coló en la ficha. Un dato del pedido tiene que
     * ser dos cosas a la vez: dicho por el cliente Y parecerse a ese dato.
     */
    if (leido.talla) {
      if (!escrito.includes(llano(leido.talla.trim()))) {
        fallas.push(`el resumen dice talla «${leido.talla}» y el cliente no la escribió en esta conversación: pregúntasela`);
      } else if (!pareceTalla(leido.talla)) {
        fallas.push(`el resumen pone «${leido.talla}» como talla y eso no es una talla: pregúntasela otra vez`);
      }
    }
    if (leido.color) {
      if (!escrito.includes(llano(leido.color.trim()))) {
        fallas.push(`el resumen dice color «${leido.color}» y el cliente no lo escribió en esta conversación: pregúntaselo`);
      } else if (!pareceColor(leido.color)) {
        fallas.push(`el resumen pone «${leido.color}» como color y eso no es un color: pregúntaselo otra vez`);
      }
    }

    /*
     * 12c. Y EL PRODUCTO DICE QUÉ SE VENDE. El caso real: «Producto: ORDENA,
     * RECIBE Y LUEGO PAGA!!», que es el reclamo del anuncio. En el papel del
     * pedido tiene que ir el artículo, con su nombre.
     */
    {
      const fuentes = ctx.anuncio ? ctx.anuncio : ctx.catalogo;
      if (leido.producto && fuentes && nombraUnArticulo(fuentes) && !nombraUnArticulo(leido.producto)) {
        fallas.push(
          `el producto del resumen es «${leido.producto}» y eso no dice qué se vende: escribe el artículo del anuncio, con su nombre`,
        );
      }
    }

    /*
     * 12d. DOS COLORES SON DOS UNIDADES (la dueña, RD, 2026-09-07).
     *
     * La captura: «Talla: Rojo y azul XL», «Cantidad: 1» y el total con el
     * precio de un solo polo. Quien nombra dos colores está pidiendo dos
     * artículos: la cantidad es dos y el precio se suma dos veces. El envío
     * no: ese va una sola vez.
     */
    if (d.codigo === "do") {
      const colores = unidadesPorColores({
        talla: leido.talla, color: leido.color, direccion: null, nombre: null, celular: null, cantidad: null,
      });
      const dice = leido.cantidad && /\d/.test(leido.cantidad) ? Number(leido.cantidad.replace(/\D/g, "")) : 1;
      if (colores >= 2 && dice < colores) {
        fallas.push(
          `el cliente pidió ${colores} colores y el resumen dice «Cantidad: ${dice}»: son ${colores} unidades — ` +
            `escribe «Cantidad: ${colores}» y multiplica el precio por ${colores} antes de sumarle el envío, que va una sola vez`,
        );
      }
    }

    if (leido.direccion) {
      const palabras = llano(leido.direccion).split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 4);
      const coinciden = palabras.filter((p) => escrito.includes(p)).length;
      if (palabras.length >= 2 && coinciden < 2 && !ctx.clienteCompartioUbicacion) {
        fallas.push("la dirección del resumen no la escribió el cliente en esta conversación: pregúntasela");
      }
      const tarifaDeLaDireccion = zonaDe(leido.direccion);
      const lineaEnvio = texto.split(/\r?\n/).find((l) => /^\W*(costo de )?env[ií]o\b/i.test(llano(l)));
      const n = lineaEnvio ? importes(lineaEnvio, d.moneda.simbolo)[0] : undefined;
      if (tarifaDeLaDireccion !== null && n !== undefined && n !== tarifaDeLaDireccion) {
        fallas.push(`el envío del resumen dice ${d.moneda.simbolo}${n} y a esa dirección le toca ${d.moneda.simbolo}${tarifaDeLaDireccion}`);
      }
    }
  }

  return [...new Set(fallas)];
}

/** Cómo suena meter algo más en el pedido: «Perfecto, le añado un pantalón…». */
const AÑADE_AL_PEDIDO = /\b(le |se lo |te |se te )?(a[ñn]ado|agrego|incluyo|sumo|pongo|añadimos|agregamos|incluimos)\b/i;

/** Artículos que se venden sin talla, número ni color, salvo que el anuncio diga lo contrario. */
const SIN_VARIANTES =
  /\b(cepillo|cepillos|secador|secadora|secadores|blower|blowers|plancha|planchas|planchita|alisadora|alisador|rizador|rizadora|tenaza|tenazas|difusor|onduladora|abejon|abejones|faja|fajas|perfume|colonia|reloj|relojes|cartera|carteras|bolso|bolsos|mochila|mochilas|morral|bulto|bultos|riñonera|rinonera|billetera|maleta|maletas|lonchera|estuche|bolsa|gorra|gorras|lentes|gafas|collar|pulsera|aretes|anillo|paraguas|sombrilla|toalla|kit|combo|set|crema|serum|maquillaje|licuadora|freidora|audifono|audifonos|bocina|cargador|lampara|termo|botella|juguete|sartén|sarten|olla|ventilador|extension|masajeador|rasuradora|afeitadora|barbera|maquina|máquina)\b/i;

/**
 * Solo estas familias llevan talla aunque el anuncio no la escriba: las de la
 * tabla de tallas de la tienda (`TALLAS_BASE`), en singular y en plural. Ver
 * el mismo `ROPA` de `apertura.ts`: las dos listas dicen lo mismo a propósito.
 */
const CON_TALLA_SIEMPRE =
  /\b(camisas?|pantalon|pantalones|t-?shirts?|polos?|boxers?|zapatos?|tenis|botas?|mocasin|mocasines|sandalias?|calzado|correas?|cinturon|cinturones)\b/i;

/** Lo que en un anuncio o catálogo dice CON PALABRAS que hay tallas o números. */
const HAY_TALLAS_EXPLICITAS = /\btallas?\b|\bsize\b|numeraci[oó]n|\bx?xl\b|\bs\s*[,\/-]\s*m\b|\bde la s a la\b/i;

/**
 * Números que parecen tallas de calzado. Un «45 litros» o un «40 cm» de una
 * mochila NO lo son: los números seguidos de una unidad no cuentan.
 */
const NUMEROS_DE_TALLA = /\b(3[4-9]|4[0-6])\b(?!\s*(?:l\b|lt|litros?|cm|mm|kg|g\b|gr|pulg|"|x\s*\d|%))/i;

/** Lo que en un anuncio o catálogo dice que hay colores. */
const HAY_COLORES = new RegExp(`\\bcolor(es)?\\b|${reColores().source}`, "i");

// Cualquier forma de preguntar la talla: «¿qué talla?», «¿me indica su talla?», «¿qué número calza?».
const PREGUNTA_TALLA = /[¿?][^?¿]*\b(talla|tallas|numeracion|size)\b[^?¿]*\?|[¿?][^?¿]*\b(que|cual|de que)\b[^?¿]*\b(numero|medida)\b[^?¿]*\?/i;

/**
 * CÓMO SUENA PEDIR UNA CONFIRMACIÓN DEL PEDIDO ENTERO: «¿se lo despacho hoy
 * mismo?», «¿procedo con la orden?», «¿le confirmo el pedido?». No es la
 * cortesía tica de cerrar un dato —«¿me confirma su talla?»—: es el paso de
 * más que la dueña quitó de los dos guiones.
 */
const PIDE_CONFIRMAR_EL_PEDIDO =
  /[¿?][^?¿]*\b(se lo despacho|lo despacho|se lo despachamos|se lo env[ií]o (ya|hoy)|procedo|proceso (el|su) pedido|registro (el|su) pedido|realizo (el|su) pedido|cierro (el|su) pedido|levanto (el|su) pedido|(le )?confirmo (el|su) pedido|me confirma (el|su) (pedido|orden)|confirma (el|su) pedido|lo dejamos as[ií]|est[aá] (todo )?correcto|est[aá] de acuerdo|le parece bien|desea que (lo|le|se lo) (registre|procese|env[ií]e|despache))\b[^?¿]*\?/i;

/** Cualquier pregunta por un dato del pedido: talla, color, dirección, teléfono, nombre. */
/**
 * EL CLIENTE QUE TODAVÍA NO HA DICHO NADA: un saludo, un «info», un «precio».
 * Con eso no se sabe qué quiere, y lo único que va es preguntárselo. Se
 * escriben estiradas —«hooola», «hlola»— porque así llegan.
 */
const SOLO_SALUDA =
  /^[\s¡!¿?.,·-]*(h+o+l+a+|h+l+o+l+a+|ho+la+s|buen[oa]s?|buenos d[ií]as|buenas (tardes|noches)|saludos|hey|ep[ae]|qu[eé] tal|info|informaci[oó]n|m[aá]s informaci[oó]n|quiero (m[aá]s )?(info|informaci[oó]n)|me interesa|precio|precios|cu[aá]nto (cuesta|vale)|disponible|disponibilidad|buenas)[\s¡!¿?.,·-]*$/i;

/**
 * PREGUNTAR POR EL CONJUNTO: «¿cuál es el precio de la ropa?», «¿qué precios
 * tienen?», «¿qué productos venden?». Nombra la tienda entera, no un artículo,
 * y por eso no cuenta como haber elegido. Si de paso nombra algo concreto —«¿el
 * precio de la camisa?»— ya no es por el conjunto: ahí sí eligió.
 */
function preguntaPorElConjunto(texto: string): boolean {
  return (
    /[¿?]|precio|cuanto|cuánto/i.test(texto) &&
    /\b(ropa|prendas?|art[ií]culos?|productos?|mercanc[ií]a|cat[aá]logo|precios|ofertas?|promociones?)\b/i.test(texto) &&
    !nombraUnArticulo(texto)
  );
}

/** Cómo suena preguntarle al cliente QUÉ quiere. Sin artículo no hay precio que dar. */
const PREGUNTA_QUE_ARTICULO =
  /[¿?][^?¿]*\b(qu[eé]|cu[aá]l|cu[aá]les)\b[^?¿]*\b(art[ií]culo|art[ií]culos|producto|productos|modelo|le interesa|te interesa|busca|buscas|desea|deseas)\b[^?¿]*\?/i;

const PIDE_UN_DATO_DEL_PEDIDO =
  /[¿?][^?¿]*\b(talla|tallas|n[uú]mero|numeraci[oó]n|size|color|colores|direcci[oó]n|sector|provincia|cant[oó]n|corregimiento|tel[eé]fono|celular|whatsapp|nombre|a nombre de|d[oó]nde (se lo|lo|le))\b[^?¿]*\?|\bindique su direcci[oó]n\b|\bme (facilita|regala|confirma) su\b/i;

/**
 * Pregunta talla, número o color y las fuentes no dicen que el artículo los
 * tenga. Una pregunta de más es una oportunidad de que el cliente se canse, y
 * preguntar una variante que el producto no tiene delata que no se sabe qué se
 * está vendiendo.
 */
export function preguntaDeVarianteSinVariante(borrador: string, ctx: ContextoRevision): string[] {
  const b = llano(borrador);
  /*
   * Con anuncio, SOLO el anuncio dice si este artículo lleva talla o color.
   * El caso real: un combo de cepillo y plancha, y un catálogo con camisas
   * «talla S a XL»: la palabra «talla» del catálogo dejaba pasar «¿qué talla
   * le interesa?» para el combo.
   */
  const fuentes = llano(ctx.anuncio ? ctx.anuncio : ctx.catalogo);
  const fallas: string[] = [];

  const sinVariantesDelPais = ctx.datos.tallas.sinTallaNiColor.map((s) => llano(s));
  const esDeLosQueNoLlevan =
    SIN_VARIANTES.test(fuentes) || sinVariantesDelPais.some((s) => s && fuentes.includes(s.replace(/s$/, "")));
  const esRopaOCalzado = CON_TALLA_SIEMPRE.test(fuentes);

  /*
   * ¿Las fuentes dicen que hay tallas? Con la palabra, siempre. Con solo
   * números, únicamente si el artículo no es de los que no llevan: una
   * mochila de «45 litros» no tiene talla 45.
   */
  const hayTallas = HAY_TALLAS_EXPLICITAS.test(fuentes) || (!esDeLosQueNoLlevan && NUMEROS_DE_TALLA.test(fuentes));

  // Una pregunta de talla que no sea la del teléfono («¿a qué número le llama…?»).
  const preguntaTalla = PREGUNTA_TALLA.test(b) && !/(llama|contact|mensajero|telefono|celular)/.test(b.match(PREGUNTA_TALLA)?.[0] ?? "");
  if (preguntaTalla && !hayTallas && (esDeLosQueNoLlevan || !esRopaOCalzado)) {
    fallas.push(
      "pregunta talla o número, y ni la descripción del anuncio ni el catálogo dicen que este artículo lleve tallas: no se pregunta, se pasa a la provincia",
    );
  }

  /*
   * EL COLOR ES DE LA ROPA Y DEL CALZADO, Y DE NADA MÁS.
   *
   * La regla de la dueña, en una línea (2026-09-08): «las ropas llevan talla y
   * color, los artículos no llevan talla ni color». La misma frontera que la
   * talla. Un combo de cepillo y plancha, un abejón o una alisadora no llevan
   * color aunque salgan preciosos en la foto; una camisa lo lleva aunque el
   * anuncio no escriba ninguno, porque los colores están en la imagen.
   *
   * Lo que sigue prohibido es ofrecerle colores que nadie ha escrito: eso lo
   * para la regla 8g, y el paso del color de los guiones dice cómo preguntarlo
   * sin nombrar ninguno.
   */
  if (PREGUNTA_COLOR.test(b) && !esRopaOCalzado) {
    fallas.push(
      "pregunta el color a un artículo que se vende fijo: el color es de la ropa y el calzado, y esto no lo es. Sigue con el paso que toca",
    );
  }

  return fallas;
}

/** Los colores que se pueden nombrar, ya sin tildes: para pillar uno que no está escrito en ningún sitio. */
const COLORES_NOMBRADOS = reColores("g");

/** Algo que suene a una talla: una letra, un número de talla o un rango. */
const TIENE_TALLAS = /\b(xs|s|m|l|xl|xxl|xxxl)\b|\b(2[6-9]|3\d|4[0-8])\b|talla [uú]nica|de la \w+ a la \w+/i;

/** Los apodos con los que NO se llama a un cliente, como vocativo: «¿Maestro, …», «Hola, amigo.» */
const APODOS = new RegExp(
  "(^|[\\s¡¿,;:(])(maestro|maestra|jefe|jefa|jefecito|jefecita|amigo|amiga|amig[ao]s|mi amor|amorcito|coraz[oó]n|cari[ñn]o|mi vida|mi reina|mi rey|reina|campe[oó]n|campeona|patr[oó]n|patrona|hermano|hermana|manito|manita|bro|compa|compadre|comadre|pana|socio|socia|mami|papi|mamita|papito|linda|lindo|guapa|guapo|mae|tigre|beb[eé]|nena|nene|mijo|mija|mi ni[ñn]a|mi ni[ñn]o|querido|querida|primo|prima|vecino|vecina|loco|loca|parcero|parcera|jefaza|jefazo)([,.?!;:)]|$)",
  "im",
);

/** Cómo suena presentarse: el saludo de apertura, con o sin el «hola». */
const SE_PRESENTA = /\b(le|te) asiste\b|\bbienvenid[oa]s?\b|\bsoy (su|tu) (asesor|asesora|vendedor|vendedora)\b|\bmi nombre es\b/i;

/**
 * CÓMO SUENA DECIR LO QUE VALE EL ARTÍCULO: «el precio es…», «cuesta…», «está
 * en…», «le sale en…», «…cada una». No el envío, que tiene su propia frase.
 */
const DICE_LO_QUE_VALE =
  /\bel precio\b|\bprecio (es|de)\b|\bcuestan?\b|\bvalen?\b|\best[aá]n? en\b|\bsale[n]? en\b|\bcada un[ao]\b|\bpor unidad\b|\bla unidad\b/i;

/** Cómo suena una transferencia en el texto del agente. */
const HABLA_DE_TRANSFERIR =
  /\[?HANDOFF\]?|ser[aá] transferid|(le|te) (paso|transfiero|conecto|comunico|derivo) (con|a) (un|el|una|la) (representante|asesor|asesora|agente|compañer)|(un|el|una) (representante|asesor|asesora|agente) (le|te) (atiende|atender[aá]|continuar[aá]|contin[uú]a|confirma|confirmar[aá]|pasa|pasar[aá]|escribe|escribir[aá]|contacta|contactar[aá])|conectando con (un )?representante/i;

/** Lo que pide el cliente cuando sí toca transferir. */
const CLIENTE_PIDE_FOTO = /\b(foto|fotos|imagen|im[aá]genes|video|videos)\b|ver(lo|la|los|las)? (el|la|los|las) (producto|art[ií]culo|modelo|zapato|camisa)|mu[eé]str[ae]me|ens[eé][ñn][ae]me/i;
const CLIENTE_PIDE_MAYOREO = /\bmayor(eo|ista)?\b|al por mayor|por mayor|revender|reventa|\bdocena|precio (por|de) cantidad|varias unidades para vender/i;
const CLIENTE_PIDE_PERSONA = /hablar con (una persona|alguien|un asesor|una asesora|un representante|un humano|un agente|el due[ñn]o|la due[ñn]a)|persona real|\bhumano\b|\bhumana\b|no quiero (un )?(bot|robot)/i;

/**
 * ¿ESTA TRANSFERENCIA TIENE MOTIVO? Con el resumen, siempre. Sin resumen, solo
 * si el cliente acaba de pedir una foto, precio al por mayor o una persona, o
 * si no hay ningún precio con el que vender.
 */
export function transferenciaPermitida(borrador: string, ctx: ContextoRevision): boolean {
  if (contieneMarcador(borrador, ctx.marcador ?? MARCADOR_POR_DEFECTO)) return true;
  const pide = ctx.ultimoDelCliente ?? "";
  /*
   * Pedir una foto solo justifica transferir cuando NO hay foto que mandar.
   * Con la del anuncio guardada, la respuesta es enseñarla —ver «[ENVIAR_FOTO]»
   * en el guion—, no pasarle el cliente a una persona.
   */
  if (CLIENTE_PIDE_FOTO.test(pide) && !ctx.conFoto) return true;
  if (CLIENTE_PIDE_MAYOREO.test(pide) || CLIENTE_PIDE_PERSONA.test(pide)) return true;
  // «¿Tiene otro combo de más calidad?»: los demás artículos los cotiza un
  // representante, y eso también lo manda el guion.
  if (preguntaDelCliente(pide) === "otro_articulo") return true;
  if (
    ctx.datos.codigo === "cr" &&
    !ctx.anuncio &&
    /(?:transfier|representante|asesor|confirmo con el equipo|no (?:lo|la) (?:vendemos|manejamos)|no aparece en (?:el )?cat[aá]logo)/i.test(borrador)
  ) return true;
  /*
   * EL ARTÍCULO DEL ANUNCIO NO TIENE PRECIO EN NINGÚN SITIO.
   *
   * El anuncio que es SOLO una foto (la dueña, 2026-09-08): se sabe qué se ve
   * —unos jeans— y no cuánto vale, y el catálogo no tiene nada de esa familia.
   * Inventarse el precio no se puede y cambiarle el artículo al cliente es
   * perderlo: lo que queda es transferir, y quien atiende escribe ahí mismo el
   * nombre y el monto de esa foto. Ver `fijarProductoDeLaFoto`.
   *
   * Sin esto, la regla de la transferencia sin motivo frenaba justo la
   * respuesta correcta: el catálogo tenía precios —de OTROS artículos— y eso
   * contaba como que había precio.
   */
  if (ctx.anuncio) {
    const sinPrecio =
      importes(ctx.anuncio, ctx.datos.moneda.simbolo).length === 0 && !/\b\d{3,}\b/.test(ctx.anuncio);
    const delAnuncio = familiasNombradas(ctx.anuncio).map((f) => f.familia);
    const enElCatalogo = new Set(familiasNombradas(ctx.catalogo ?? "").map((f) => f.familia));
    if (sinPrecio && delAnuncio.length && !delAnuncio.some((f) => enElCatalogo.has(f))) return true;
  }
  // Sin ningún precio escrito en ningún sitio, no se puede vender: ahí sí.
  return cifrasConocidas(ctx).length === 0;
}

/** Cómo suena pedirle al cliente la ubicación por el mapa, o que la repita. */
const PIDE_UBICACION =
  /(compart(a|e|ir|irme|anos|ame)|env[ií](e|eme|ame|ar)|mand(e|eme|ame|ar)|pas(e|eme|ame|ar))[^.?!\n]{0,25}\b(su|tu|la) ubicaci[oó]n|ubicaci[oó]n (por el mapa|en tiempo real|actual)|confirm(a|e|ar)[^.?!\n]{0,15}\b(su|tu|la) (ubicaci[oó]n|direcci[oó]n)|repit(a|e|ir)[^.?!\n]{0,15}\b(su|tu|la) (ubicaci[oó]n|direcci[oó]n)/i;

/**
 * CÓMO SUENA DAR UN DATO POR RECIBIDO: «ya tenemos su talla», «su dirección
 * queda anotada», «anotado su nombre». Solo se mira en las AFIRMACIONES —ver
 * `afirmacionesDe`—, porque «¿Ya tiene decidida su talla?» la pregunta, no la
 * da por dada, y «Perfecto, ¿en qué color le interesa?» no afirma nada.
 */
const daPorRecibido = (dato: string) =>
  new RegExp(
    `\\bya\\b.{0,25}\\b(?:su|la|el) ${dato}\\b` +
      `|\\b(?:tengo|tenemos|anote|anoto|anotamos|registre|registro|registramos|guarde|tome)\\b.{0,20}\\b(?:su|la|el) ${dato}\\b` +
      `|\\b(?:su|la|el) ${dato}\\b.{0,25}\\b(?:anotad|registrad|guardad|confirmad|recibid)` +
      `|\\b(?:anotad|registrad|guardad|recibid)[ao]s?\\b.{0,10}\\b(?:su|la|el) ${dato}\\b`,
    "i",
  );

const DA_POR_RECIBIDO: Record<string, RegExp> = {
  talla: daPorRecibido("talla"),
  color: daPorRecibido("color"),
  direccion: daPorRecibido("direccion"),
  nombre: daPorRecibido("nombre"),
};

/** Los trozos del borrador que AFIRMAN algo: sin preguntas y sin tildes. */
function afirmacionesDe(texto: string): string[] {
  return llano(texto)
    .split(/[.!\n]+/)
    .map((f) => f.trim())
    .filter((f) => f && !f.includes("?") && !f.includes("¿"));
}

/**
 * Cómo suena pedir UN DATO MÁS de una dirección que el cliente ya dio: el
 * número de casa, el apartamento, la seña de la puerta, el punto de referencia.
 * Solo cuenta dentro de una pregunta: «Direccion: calle X, apto 3» en el
 * resumen es el dato del cliente, no una repregunta.
 */
const PIDE_MAS_DETALLE_DE_LA_DIRECCION =
  /[¿?][^?¿]*(numero de (?:la |su )?(?:casa|vivienda|puerta|apartamento|apto)|apartamento|apto\b|se[nñ]a|punto de referencia|alguna referencia|referencia para|color de (?:la|su) casa|en que piso|nombre del edificio)[^?¿]*\?/i;

/** Cómo suena tutear a un cliente. «Dime» y «mándame» no van: son expresiones del país. */
const TUTEO = /\b(quieres|tienes|puedes|necesitas|prefieres|deseas|sabes|vives|est[aá]s|te preparo|te env[ií]o|te llega|te lo|te la|te mando|te dejo|tu pedido|tu direcci[oó]n|tu nombre|tu n[uú]mero|tu talla|tu celular)\b/i;

/** Artículos que han salido de un ejemplo o de un nombre del mapa, nunca de un anuncio. */
const ARTICULOS_FANTASMA = ["sabanas", "sabana", "set de sabanas", "juego de sabanas", "edredon", "colcha"];

interface SalidaRevisor {
  aprobado?: boolean;
  fallas?: string[];
}

export function promptRevisor(ctx: ContextoRevision): string {
  return `Eres el REVISOR de una vendedora por WhatsApp. No hablas con el cliente: lees el borrador de la respuesta que ella va a mandar y decides si puede salir. Tu criterio son los datos de abajo y nada más. Eres estricto con el dinero y con los datos del pedido, y permisivo con el estilo.

${ctx.bloqueDelPais}

LO QUE VENDE (precios y condiciones válidos):
${ctx.catalogo}
${ctx.anuncio ? `\n${ctx.anuncio}\n` : ""}
RECHAZA el borrador si ocurre CUALQUIERA de estas cosas:
- Vende, cotiza o dice tener un artículo que no aparece en el catálogo, en el anuncio ni en las instrucciones, o llama al artículo del anuncio con OTRO artículo distinto del que nombra su descripción (lo que una máquina leyó en la imagen del anuncio NO cambia qué artículo es). Decir el mismo artículo con otras mayúsculas, sin los adjetivos del anuncio o en singular NO es cambiarlo.
- Dice un precio que no está en el catálogo, en el anuncio ni en el bloque del país, o cambia uno que sí está. Para el artículo del anuncio, el precio válido es el de la descripción del anuncio.
- Cotiza un costo de envío que no es el de la zona del cliente según el bloque del país, o dice que «el representante confirma el envío» teniendo la tarifa delante.
- Promete una forma de pago, un plazo de entrega, un descuento, envío gratis, apartar mercancía o mandar dos para probar.
- Pregunta una talla o un color a un artículo que no los lleva, o vuelve a preguntar algo que el cliente ya contestó en la conversación.
- Vuelve a decirle el costo del envío que ya le dijo antes en esta conversación, en vez de pedir solo el dato que falta.
- Da por recibido un dato que el cliente no escribió en la conversación: dice «ya tenemos su talla», «ya me llegó su dirección» o «ya tengo su nombre» cuando lo que el cliente contestó no es una talla, ni una dirección, ni un nombre. Ese dato hay que volver a pedirlo.
- Con la dirección del cliente ya escrita en la conversación, le pide un dato más de ella —el número de casa, el apartamento, el piso, una seña para reconocer la puerta, el color de la casa, un punto de referencia— o le pide que la confirme o la repita. Esa dirección se da por buena.
- Manda el resumen del pedido sin que el cliente haya dado nombre y dirección completa (y la variante, si el artículo la lleva), o con algún dato inventado que no aparece en la conversación. El teléfono puede ser el del chat.
- Llama al cliente por un nombre que él no escribió en la conversación.
- Manda un segundo resumen cuando ya había uno.
- Habla de sí misma como bot, asistente o sistema.

NO rechaces por estilo, por longitud, por un emoji, ni porque a ti se te ocurra una respuesta mejor. Si el borrador cumple todo, apruébalo. ANTE LA DUDA, APRUÉBALO: parar una respuesta correcta le cuesta la venta al negocio, y solo debes parar lo que estés seguro de que está mal con los datos de arriba delante.

Responde SOLO con JSON: {"aprobado": true} o {"aprobado": false, "fallas": ["qué está mal, en una frase que la vendedora pueda corregir", "..."]}. Máximo tres fallas, las más caras primero.`;
}

/**
 * EL MODELO REVISOR. Con la conversación y el borrador delante.
 *
 * Si el modelo no contesta, el veredicto es «aprobado por las reglas»: un
 * revisor caído no puede dejar mudo al negocio. Las reglas mecánicas ya
 * corrieron antes y son las que paran lo más caro.
 */
export async function revisarConModelo(
  orgId: number,
  modelo: string | null | undefined,
  historial: Mensaje[],
  borrador: string,
  ctx: ContextoRevision,
): Promise<string[] | null> {
  const ultimos = historial.slice(-16).map((m) => {
    const quien = m.emisor === "cliente" ? "CLIENTE" : m.emisor === "humano" ? "EQUIPO" : "VENDEDORA";
    return `${quien}: ${m.emisor === "cliente" ? conLoVistoYOido(m) : m.content}`;
  });

  try {
    const r = await completarJson<SalidaRevisor>({
      orgId,
      proposito: "analisis",
      modelo: modelo || MODELO_ANALISIS,
      mensajes: [
        { role: "system", content: promptRevisor(ctx) },
        {
          role: "user",
          content: `CONVERSACIÓN HASTA AHORA:\n${ultimos.join("\n")}\n\nBORRADOR QUE LA VENDEDORA QUIERE MANDAR:\n«${borrador}»`,
        },
      ],
      maxTokens: 300,
      temperatura: 0,
      timeoutMs: 20_000,
    });

    if (!r.datos || typeof r.datos.aprobado !== "boolean") return null;
    if (r.datos.aprobado) return [];
    const fallas = (r.datos.fallas ?? []).filter((f) => typeof f === "string" && f.trim()).slice(0, 3);
    return fallas.length ? fallas : ["el revisor la rechazó sin decir por qué"];
  } catch (e) {
    console.error("[revisor] el modelo revisor no contestó:", e instanceof ErrorIA ? e.message : e);
    return null;
  }
}

/**
 * Las dos capas, en orden. Las reglas primero porque no cuestan; el modelo
 * solo si las reglas no encontraron nada.
 */
export async function revisarBorrador(
  orgId: number,
  modelo: string | null | undefined,
  historial: Mensaje[],
  borrador: string,
  ctx: ContextoRevision,
  { conModelo = true }: { conModelo?: boolean } = {},
): Promise<Veredicto> {
  const reglas = revisarConReglas(borrador, ctx);
  if (reglas.length) return { aprobado: false, fallas: reglas, por: "reglas" };

  if (!conModelo || !process.env.OPENROUTER_API_KEY) return { aprobado: true, fallas: [], por: null };

  const delModelo = await revisarConModelo(orgId, modelo, historial, borrador, ctx);
  if (delModelo === null || delModelo.length === 0) return { aprobado: true, fallas: [], por: null };
  return { aprobado: false, fallas: delModelo, por: "modelo" };
}

/** La corrección que se le pega al agente para que vuelva a escribir. */
export function correccionParaElAgente(v: Veredicto): string {
  return (
    "CORRECCIÓN DEL REVISOR — tu respuesta anterior NO salió porque:\n" +
    v.fallas.map((f) => `- ${f}`).join("\n") +
    "\nEscríbela de nuevo corrigiendo exactamente eso, con los datos del país y del catálogo de arriba. " +
    "Si el problema es un dato que no tienes, no lo inventes: pregúntalo o di que lo confirma un representante."
  );
}
