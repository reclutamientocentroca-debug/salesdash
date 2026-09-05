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
 */
import type { DatosPais } from "@/agents";
import { fallasDelResumen, leerResumen } from "./supervisor";
import { contieneMarcador, MARCADOR_POR_DEFECTO } from "./cierre";
import { completarJson, ErrorIA } from "./ia";
import { MODELO_ANALISIS, type Mensaje } from "./db";
import { conLoVistoYOido } from "./percepcion";
import { preguntasRepetidas, type FichaDelPedido } from "./memoria";
import { preguntaDelCliente } from "./apertura";
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
  { re: /le llega (hoy|mañana|pasado mañana|el (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))|te llega (hoy|mañana|pasado mañana)/i, falla: "promete un día de entrega" },
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
    for (const f of fallasDelResumen(leido, ctx.nombresDeLaCasa)) {
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

  // 8c. UNA TALLA, UN NÚMERO O UN COLOR A UN ARTÍCULO QUE NO LOS LLEVA.
  //
  // El caso real: «¿Qué talla necesita?» a un combo de cepillo secador y
  // plancha. Un modelo copia la pregunta del ejemplo o de la costumbre. Si
  // ni la descripción del anuncio ni el catálogo dicen que el artículo tenga
  // tallas o colores, y encima el artículo es de los que no los llevan, la
  // pregunta no sale.
  fallas.push(...preguntaDeVarianteSinVariante(texto, ctx));

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

  // 11b. Se dice «enviar», no «despachar». Lo pidió la dueña con esas palabras.
  // Menos en Costa Rica: su guion (2026-09-05) cierra con «¿Se lo despacho hoy mismo?».
  if (d.codigo !== "cr" && /\bdespach/i.test(texto)) {
    fallas.push("dice «despachar» o «despachamos», y aquí se dice «se lo enviamos»: cámbialo por enviar");
  }

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

/** Artículos que se venden sin talla, número ni color, salvo que el anuncio diga lo contrario. */
const SIN_VARIANTES =
  /\b(cepillo|cepillos|secador|secadora|secadores|blower|blowers|plancha|planchas|planchita|alisadora|alisador|rizador|rizadora|tenaza|tenazas|difusor|onduladora|abejon|abejones|perfume|colonia|reloj|relojes|cartera|carteras|bolso|bolsos|mochila|mochilas|morral|bulto|bultos|riñonera|rinonera|billetera|maleta|maletas|lonchera|estuche|bolsa|gorra|gorras|lentes|gafas|collar|pulsera|aretes|anillo|paraguas|sombrilla|toalla|kit|combo|set|crema|serum|maquillaje|licuadora|freidora|audifono|audifonos|bocina|cargador|lampara|termo|botella|juguete|sartén|sarten|olla|ventilador|extension|masajeador|rasuradora|afeitadora|barbera|maquina|máquina)\b/i;

/** Ropa y calzado llevan talla aunque el anuncio no la escriba. */
const CON_TALLA_SIEMPRE =
  /\b(camisa|camisas|pantalon|pantalones|jean|jeans|short|shorts|vestido|blusa|polo|t-?shirt|franela|chacabana|chaqueta|abrigo|sueter|sudadera|conjunto|falda|zapato|zapatos|tenis|bota|botas|mocasin|mocasines|sandalia|sandalias|calzado|correa|correas|cinturon|cinturones|bermuda|ropa)\b/i;

/** Lo que en un anuncio o catálogo dice CON PALABRAS que hay tallas o números. */
const HAY_TALLAS_EXPLICITAS = /\btallas?\b|\bsize\b|numeraci[oó]n|\bx?xl\b|\bs\s*[,\/-]\s*m\b|\bde la s a la\b/i;

/**
 * Números que parecen tallas de calzado. Un «45 litros» o un «40 cm» de una
 * mochila NO lo son: los números seguidos de una unidad no cuentan.
 */
const NUMEROS_DE_TALLA = /\b(3[4-9]|4[0-6])\b(?!\s*(?:l\b|lt|litros?|cm|mm|kg|g\b|gr|pulg|"|x\s*\d|%))/i;

/** Lo que en un anuncio o catálogo dice que hay colores. */
const HAY_COLORES = /\bcolor(es)?\b|\b(negro|negra|blanco|blanca|azul|rojo|roja|marr[oó]n|beige|gris|verde|rosado|rosa|dorado|plateado|caf[eé]|vino|crema|amarillo|naranja|morado|celeste|turquesa|chocolate|camel|nude|fucsia)\b/i;

// Cualquier forma de preguntar la talla: «¿qué talla?», «¿me indica su talla?», «¿qué número calza?».
const PREGUNTA_TALLA = /[¿?][^?¿]*\b(talla|tallas|numeracion|size)\b[^?¿]*\?|[¿?][^?¿]*\b(que|cual|de que)\b[^?¿]*\b(numero|medida)\b[^?¿]*\?/i;
const PREGUNTA_COLOR = /[¿?][^?¿]*\bcolor(es)?\b[^?¿]*\?/i;

/**
 * Pregunta talla, número o color y las fuentes no dicen que el artículo los
 * tenga. Una pregunta de más es una oportunidad de que el cliente se canse, y
 * preguntar una variante que el producto no tiene delata que no se sabe qué se
 * está vendiendo.
 */
export function preguntaDeVarianteSinVariante(borrador: string, ctx: ContextoRevision): string[] {
  const b = llano(borrador);
  const fuentes = llano(`${ctx.catalogo}\n${ctx.anuncio ?? ""}`);
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

  if (PREGUNTA_COLOR.test(b) && !HAY_COLORES.test(fuentes)) {
    fallas.push(
      "pregunta el color, y ni la descripción del anuncio ni el catálogo dicen que este artículo venga en varios colores: no se pregunta",
    );
  }

  return fallas;
}

/** Algo que suene a una talla: una letra, un número de talla o un rango. */
const TIENE_TALLAS = /\b(xs|s|m|l|xl|xxl|xxxl)\b|\b(2[6-9]|3\d|4[0-8])\b|talla [uú]nica|de la \w+ a la \w+/i;

/** Los apodos con los que NO se llama a un cliente, como vocativo: «¿Maestro, …», «Hola, amigo.» */
const APODOS = new RegExp(
  "(^|[\\s¡¿,;:(])(maestro|maestra|jefe|jefa|jefecito|jefecita|amigo|amiga|amig[ao]s|mi amor|amorcito|coraz[oó]n|cari[ñn]o|mi vida|mi reina|mi rey|reina|campe[oó]n|campeona|patr[oó]n|patrona|hermano|hermana|manito|manita|bro|compa|compadre|comadre|pana|socio|socia|mami|papi|mamita|papito|linda|lindo|guapa|guapo|mae|tigre|beb[eé]|nena|nene|mijo|mija|mi ni[ñn]a|mi ni[ñn]o|querido|querida|primo|prima|vecino|vecina|loco|loca|parcero|parcera|jefaza|jefazo)([,.?!;:)]|$)",
  "im",
);

/** Cómo suena presentarse: el saludo de apertura, con o sin el «hola». */
const SE_PRESENTA = /\b(le|te) asiste\b|\bbienvenid[oa]s?\b|\bsoy (su|tu) (asesor|asesora|vendedor|vendedora)\b|\bmi nombre es\b/i;

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
  if (CLIENTE_PIDE_FOTO.test(pide) || CLIENTE_PIDE_MAYOREO.test(pide) || CLIENTE_PIDE_PERSONA.test(pide)) return true;
  // Sin ningún precio escrito en ningún sitio, no se puede vender: ahí sí.
  return cifrasConocidas(ctx).length === 0;
}

/** Cómo suena pedirle al cliente la ubicación por el mapa, o que la repita. */
const PIDE_UBICACION =
  /(compart(a|e|ir|irme|anos|ame)|env[ií](e|eme|ame|ar)|mand(e|eme|ame|ar)|pas(e|eme|ame|ar))[^.?!\n]{0,25}\b(su|tu|la) ubicaci[oó]n|ubicaci[oó]n (por el mapa|en tiempo real|actual)|confirm(a|e|ar)[^.?!\n]{0,15}\b(su|tu|la) (ubicaci[oó]n|direcci[oó]n)|repit(a|e|ir)[^.?!\n]{0,15}\b(su|tu|la) (ubicaci[oó]n|direcci[oó]n)/i;

/** Cómo suena tutear a un cliente. «Dime» y «mándame» no van: son expresiones del país. */
const TUTEO = /\b(quieres|tienes|puedes|necesitas|prefieres|deseas|sabes|vives|est[aá]s|te preparo|te env[ií]o|te llega|te lo|te la|te mando|te dejo|tu pedido|tu direcci[oó]n|tu nombre|tu n[uú]mero|tu talla|tu celular)\b/i;

/** Artículos que han salido de un ejemplo o de un nombre del mapa, nunca de un anuncio. */
const ARTICULOS_FANTASMA = ["sabanas", "sabana", "set de sabanas", "juego de sabanas", "edredon", "colcha"];

interface SalidaRevisor {
  aprobado?: boolean;
  fallas?: string[];
}

function promptRevisor(ctx: ContextoRevision): string {
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
