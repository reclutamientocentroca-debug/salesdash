/**
 * SalesDash — de los datos de un país al texto que lee el modelo.
 *
 * Esto es lo que junta las dos mitades: el comportamiento (uno, en
 * `base-comportamiento.ts`) y los datos del país (uno por archivo en
 * `paises/`). Recibe UN solo país y nunca busca otro: es lo que garantiza que
 * en un chat dominicano no aparezca ni una cifra de Costa Rica.
 *
 * Aquí no hay reglas de venta. Si un día hace falta escribir «pregunta una
 * cosa a la vez» en este archivo, es que se está escribiendo en el sitio
 * equivocado.
 */
import type { EscalaDePrecio, DatosPais, ZonaDeEnvio } from "./tipos";
import { tablaDeTallas } from "./base-comportamiento";
import { contieneLugar } from "@/lib/envio";
import { obtenerPais } from "@/lib/paises";

/**
 * «RD$250», «₡3.500», «US$5.00»: como lo escribe la gente del país.
 *
 * No se usa `toLocaleString` porque el separador de miles que devuelve
 * depende de la versión de ICU con la que se compiló Node, y un importe
 * escrito «al revés» es lo primero que delata a una tienda de fuera.
 */
export function importe(d: DatosPais, monto: number): string {
  const fijo = monto.toFixed(d.moneda.decimales);
  const [entero, decimales] = fijo.split(".");
  const conMiles = (entero ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, d.moneda.miles);
  const separadorDecimal = d.moneda.miles === "," ? "." : ",";
  return `${d.moneda.simbolo}${conMiles}${decimales ? `${separadorDecimal}${decimales}` : ""}`;
}

/** El saludo con los nombres puestos. Ver `DatosPais.saludo`. */
export function saludoDe(d: DatosPais, nombreDelPanel: string, negocioDelPanel: string): string {
  return d.saludo
    .replace("<agente>", d.nombreAgente ?? nombreDelPanel)
    .replace("<negocio>", d.tienda || negocioDelPanel);
}

/**
 * En qué zona cae este cliente, o «resto» si se reconoce el sitio y no es
 * ninguna zona especial, o null si no se reconoce nada —y ahí se pregunta—.
 *
 * `donde` es lo que se sepa: la provincia que devolvió el mapa, o lo que el
 * cliente escribió.
 */
export function zonaDelCliente(
  d: DatosPais,
  donde: string | null | undefined,
): ZonaDeEnvio | "resto" | null {
  if (!donde?.trim()) return null;

  // Un lugar de la lista de excepciones manda sobre el nombre de la zona:
  // «Boca Chica, Santo Domingo» no cobra como Santo Domingo. Ver `excepciones`.
  const zona = d.envio.zonas.find(
    (z) => contieneLugar(donde, z.lugares) && !contieneLugar(donde, z.excepciones ?? []),
  );
  if (zona) return zona;

  // Un sitio conocido del país que no es zona especial: va como el resto.
  if (contieneLugar(donde, d.envio.restoDelPais.lugares ?? [])) return "resto";
  const pais = obtenerPais(d.codigo);
  if (pais && contieneLugar(donde, pais.zonas)) return "resto";

  /*
   * EL MAPA DEL PAÍS TAMBIÉN SITÚA. El caso real: el cliente escribió
   * «Independencia» —una provincia del sur— y las listas de tarifa no la
   * tenían con ese nombre solo; el agente se quedó sin saber el envío en el
   * paso en que se cierra la venta. El mapa sí la tiene, dentro de su región:
   * se busca el lugar ahí y la región dice la zona. Si el nombre de la región
   * es de una zona especial («Santo Domingo Este» está en el Gran Santo
   * Domingo), esa; si no, es interior y va como el resto.
   */
  for (const region of d.mapa.regiones) {
    // Solo los lugares de la región, nunca su nombre: «Este (interior)» casaría con «sí, a este».
    if (!contieneLugar(donde, region.lugares)) continue;
    const zona = d.envio.zonas.find((z) => contieneLugar(region.nombre, z.lugares));
    return zona ?? "resto";
  }

  return null;
}

/**
 * DÓNDE VIVE EL CLIENTE, SEGÚN LO QUE ESCRIBIÓ.
 *
 * El pin del mapa no es la única forma de dar una dirección: la mayoría la
 * escribe —«Los Alcarrizos», «soy de Santiago»— y hasta ahora el costo exacto
 * solo se le calculaba al agente con el pin. Aquí se mira lo último que
 * escribió el cliente y se devuelve el mensaje en el que nombró un sitio que
 * el país reconoce, del más reciente al más viejo. Con eso el bloque de envío
 * le dice al agente «a este cliente le toca X» y el cliente oye su tarifa en
 * cuanto escribe su zona.
 *
 * Devuelve el texto del mensaje, no la zona: quien lo recibe vuelve a pasar
 * por `zonaDelCliente`, que es la única función que decide zonas.
 */
export function lugarEscritoPorElCliente(
  d: DatosPais | null,
  mensajes: { emisor: string; content: string }[],
  ultimos = 12,
): string | null {
  if (!d) return null;
  const delCliente = mensajes.filter((m) => m.emisor === "cliente").slice(-ultimos).reverse();
  for (const m of delCliente) {
    if (zonaDelCliente(d, m.content) !== null) return m.content;
  }
  return null;
}

/**
 * LAS LÍNEAS DEL RESUMEN, en orden. Salen del país porque la forma de pago
 * solo va cuando existe: una línea en blanco es justo lo que el resumen no
 * puede llevar.
 */
export function lineasDelResumen(d: DatosPais): string[] {
  const lineas = [
    "Nombre: el nombre con el que recibe, tal cual lo escribió el cliente",
    "Cel: el número al que llama el mensajero, entero",
    "Producto: lo que lleva",
    "Cantidad: cuántos",
    "Talla y color: solo si el artículo los lleva; si no, esta línea no va",
    "Dirección: la dirección completa, como se da en este país",
    `Costo de envío: ${d.moneda.simbolo} y el importe de su zona`,
  ];
  if (d.pago) lineas.push("Forma de pago: la de este país, en pocas palabras");
  lineas.push(`Total a pagar: ${d.moneda.simbolo} y la suma del producto por la cantidad más el envío`);
  return lineas;
}

/** El bloque de envío: tarifas, modalidad y pago por zona, y lo de este cliente. */
function bloqueDeEnvio(d: DatosPais, donde: string | null): string {
  const lineas = [`ENVÍO — ${d.envio.cobertura}`, "Estas son las tarifas de este negocio y no hay otras:"];

  for (const z of d.envio.zonas) {
    lineas.push(
      `- ${z.nombre} (${z.lugares.join(", ")}): ${importe(d, z.costo)} — ${z.modalidad}` +
        `${z.pago ? `; ${z.pago}` : ""}.`,
    );
  }

  const resto = d.envio.restoDelPais;
  lineas.push(
    `- ${d.envio.zonas.length ? "Resto del país" : "Todo el país"}: ${importe(d, resto.costo)} — ` +
      `${resto.modalidad}${resto.pago ? `; ${resto.pago}` : ""}.`,
  );

  lineas.push(
    "Esas cifras mandan sobre cualquier otro monto de envío que aparezca escrito en otro sitio " +
      `—y con más razón sobre uno en otra moneda: aquí se cobra en ${d.moneda.nombre} ` +
      `(${d.moneda.simbolo})—, y no se redondean ni se negocian. El envío va en su propia línea ` +
      "del resumen y sumado en el total.",
  );

  /*
   * Y NO SON EL PRECIO DE NADA. El caso de la dueña (2026-09-08): un anuncio
   * sin precio y la IA contestando «El precio es RD$250 cada una», que es la
   * tarifa de la capital. Las únicas cifras que el agente tiene delante son
   * estas, y si le falta el precio del artículo acaba usando la que tenga a
   * mano.
   */
  lineas.push(
    "ESTAS CIFRAS SON EL COSTO DE LLEVARLO, NUNCA EL PRECIO DE LO QUE SE VENDE. No las uses para " +
      "contestar «¿cuánto cuesta?»: el precio del artículo sale de la descripción del anuncio o del " +
      "catálogo, y si ahí no está, no hay precio que dar —se lo pasa un representante—.",
  );

  /*
   * Y LO QUE LE TOCA A ESTE CLIENTE. Cuando ya se sabe de dónde es, decirle
   * las tarifas es dejarle elegir; decirle la suya es cerrar.
   */
  const zona = zonaDelCliente(d, donde);
  if (zona === "resto") {
    lineas.push(
      `A ESTE CLIENTE le corresponde ${importe(d, resto.costo)}: su dirección no cae en ninguna ` +
        `zona especial (${resto.modalidad}${resto.pago ? `; ${resto.pago}` : ""}). Usa ese importe.`,
    );
  } else if (zona) {
    lineas.push(
      `A ESTE CLIENTE le corresponde ${importe(d, zona.costo)}: su dirección cae en ${zona.nombre} ` +
        `(${zona.modalidad}${zona.pago ? `; ${zona.pago}` : ""}). Usa ese importe.`,
    );
  } else if (donde?.trim()) {
    lineas.push(
      "De la dirección de este cliente no se puede deducir la zona. Pregúntale UNA SOLA VEZ en qué " +
        "provincia está, y lo que conteste vale. Si ya te lo dijo con otras palabras, dalo por bueno: " +
        "no insistas ni le pidas que comparta su ubicación por el mapa.",
    );
  }

  /*
   * Y CON DOS TARIFAS, EL ENVÍO NO SE GENERALIZA (la dueña, RD, 2026-09-08).
   *
   * «¿Cuánto cuesta el envío?» → «El envío a todo el país es de RD$290.», y en
   * este país hay dos: le cobra de más a media clientela y da por buena una
   * zona que nadie ha dicho. Donde la tarifa es una sola para todos —Costa Rica
   * y Panamá— decirlo así es lo correcto, y por eso esto solo entra cuando hay
   * más de una.
   */
  const tarifas = new Set([resto.costo, ...d.envio.zonas.map((z) => z.costo)]);
  if (tarifas.size > 1 && !zona) {
    lineas.push(
      "AQUÍ NO HAY UNA TARIFA PARA TODO EL PAÍS, HAY " + tarifas.size + ", y todavía no sabes a dónde va " +
        "este pedido: si te pregunta cuánto es el envío, NO le des una sola cifra ni digas «el envío a " +
        "todo el país es " + importe(d, resto.costo) + "» —a la mitad de los clientes le estarías " +
        "cobrando de más o de menos—. Dile que depende de la zona, pregúntale la provincia o el sector " +
        "en esa misma línea, y en cuanto te conteste le dices la suya. Si prefieres, puedes decirle las " +
        `${tarifas.size} tarifas con su zona al lado; lo que no vale es una sola para todos.`,
    );
  }

  return lineas.join("\n");
}

/**
 * EL MAPA DEL PAÍS, escrito para el modelo.
 *
 * Un nombre de lugar que el modelo no reconoce se convierte en cualquier
 * cosa: un producto, una marca, una pregunta. Con la lista delante, «Sabana
 * Perdida» es Santo Domingo Norte y «Sabanilla» es Montes de Oca, y el
 * agente sigue la venta con el envío de esa zona en vez de descarrilar.
 */
function bloqueDelMapa(d: DatosPais): string {
  const m = d.mapa;
  if (!m.regiones.length) return "";

  const lineas = [`EL MAPA DE ${d.nombre.toUpperCase()} — LOS LUGARES QUE VAS A OÍR NOMBRAR, por región:`];
  for (const r of m.regiones) lineas.push(`- ${r.nombre}: ${r.lugares.join(", ")}.`);
  lineas.push(
    "CUALQUIERA DE ESTOS NOMBRES, escrito por el cliente, ES SU UBICACIÓN: te está diciendo dónde " +
      "vive, no un producto, ni una marca, ni otra cosa. Lo lees como su sector o su provincia, lo " +
      "sitúas con esta lista, le dices de una vez el envío que le toca y lo escribes en su dirección. " +
      "Nunca lo confundas con un artículo, nunca le preguntes qué es, y nunca digas que vendes algo " +
      "que se llame así. Si escribe un lugar que no está en la lista, también es un lugar: pregúntale " +
      "en qué provincia queda y sigue.",
  );
  if (m.aviso) lineas.push(m.aviso);
  return lineas.join("\n");
}

/** Las tallas de esta tienda, con la tabla de la casa si la usa. */
function bloqueDeTallas(d: DatosPais): string {
  const t = d.tallas;
  const lineas = ["TALLAS DE ESTA TIENDA:"];

  if (t.usaTablaBase) lineas.push(tablaDeTallas());
  if (t.zapatoEn) lineas.push(`- El calzado se da en ${t.zapatoEn}.`);
  if (t.conTallaYColor.length) {
    lineas.push(`- SÍ llevan talla y color, y se preguntan: ${t.conTallaYColor.join(", ")}.`);
  }
  if (t.sinTallaNiColor.length) {
    lineas.push(`- NO llevan talla ni color, y no se preguntan: ${t.sinTallaNiColor.join(", ")}.`);
  }
  if (t.soloRopaYCalzado) {
    lineas.push(
      "- Solo la ropa y el calzado llevan talla. Cualquier otro artículo —una mochila, un bolso, una " +
        "cartera, una gorra, un reloj, un electrodoméstico, una herramienta, lo que sea— no lleva talla, " +
        "y solo lleva color si el anuncio dice sus colores: si no, se ofrece y se vende sin preguntar nada.",
    );
  }
  for (const n of t.notas) lineas.push(`- ${n}`);

  return lineas.join("\n");
}

/** Mayoreo: qué hay y qué hace el agente con ello. */
/**
 * LA LISTA DE PRECIOS DE ESTE ARTÍCULO, si la hay.
 *
 * Se reconoce por las palabras del anuncio o del catálogo —«polos»—, y se
 * comprueba contra el precio escrito: el primer tramo ES el precio de siempre,
 * así que si el anuncio dice otra cifra, ese artículo no es de esta escala y no
 * se le aplica. Sin `precioEscrito` se reconoce solo por el nombre, que es lo
 * que hace falta para contarle al modelo qué escalas existen.
 */
export function escalaDelArticulo(
  d: DatosPais,
  texto: string | null | undefined,
  precioEscrito?: number | null,
): EscalaDePrecio | null {
  if (!texto?.trim()) return null;
  for (const e of d.mayoreo.escalas ?? []) {
    if (!new RegExp(`\\b(${e.palabras})\\b`, "i").test(texto)) continue;
    const base = e.tramos[0]?.precio;
    if (precioEscrito != null && base != null && Math.abs(precioEscrito - base) >= 0.005) continue;
    return e;
  }
  return null;
}

/**
 * LO QUE CUESTA CADA UNIDAD cuando el cliente lleva `cantidad`.
 *
 * Devuelve el precio escrito tal cual cuando no hay escala para este artículo:
 * el precio del anuncio manda siempre, y una lista de precios que no es de él
 * no le cambia nada.
 */
export function precioPorCantidad(
  d: DatosPais,
  texto: string | null | undefined,
  cantidad: number,
  precioEscrito: number,
): number {
  const escala = escalaDelArticulo(d, texto, precioEscrito);
  if (!escala) return precioEscrito;
  const n = Math.max(1, Math.floor(cantidad));
  const tramo = escala.tramos.find((t) => n >= t.desde && (t.hasta === null || n <= t.hasta));
  return tramo?.precio ?? precioEscrito;
}

/** Los tramos de una escala, escritos como se le dicen al cliente. */
function tramosEnPalabras(d: DatosPais, e: EscalaDePrecio): string {
  return e.tramos
    .map((t) => {
      const cuantas =
        t.hasta === null
          ? `de ${t.desde} en adelante`
          : t.desde === t.hasta
            ? `${t.desde} unidad`
            : `de ${t.desde} a ${t.hasta} unidades`;
      return `${cuantas}: ${importe(d, t.precio)} cada una`;
    })
    .join(" · ");
}

function bloqueDeMayoreo(d: DatosPais): string {
  const m = d.mayoreo;
  if (m.vende === null) {
    return "MAYOREO: NO CONFIGURADO. Si el cliente pide precio al por mayor, para revender o por " +
      "varias unidades para vender, transfieres con \"[HANDOFF]\" sin dar ningún precio.";
  }
  if (!m.vende) {
    return "MAYOREO: esta tienda NO vende al por mayor. Si lo piden, se dice con amabilidad y se " +
      "sigue con la venta normal, al precio de siempre.";
  }
  const desde = m.desde ? ` a partir de ${m.desde} unidades` : "";
  if (!m.agenteCotiza) {
    return `MAYOREO: esta tienda vende al por mayor${desde}, pero TÚ NO COTIZAS MAYOREO: si el cliente ` +
      "lo pide, un representante le pasa los precios. Escribe \"[HANDOFF]\" y no des ninguna cifra.";
  }

  /*
   * LA LISTA DE PRECIOS, cuando la hay, ANTES de la regla de transferir: con
   * ella el agente cotiza él mismo y no pasa a nadie. Sin ella se queda la
   * regla de siempre, que es la que evita un precio inventado.
   */
  const listas = (m.escalas ?? []).map(
    (e) => `- ${e.articulo}: ${tramosEnPalabras(d, e)}.`,
  );

  /*
   * Sin lista, la frase de siempre PALABRA POR PALABRA: Costa Rica no tiene
   * escalas y este archivo lo comparten los tres países. Ver la nota de
   * `apertura.ts`: un arreglo escrito para República Dominicana no puede
   * moverle el prompt a Costa Rica.
   */
  const donde = listas.length ? "en la lista de aquí abajo, en el catálogo" : "en el catálogo";

  return [
    `MAYOREO: esta tienda vende al por mayor${desde}. Los precios de mayoreo son solo los que ` +
      `estén escritos ${donde} o en las instrucciones; si no están, transfieres.`,
    ...(listas.length
      ? [
          "PRECIOS POR CANTIDAD (cada tramo dice lo que cuesta CADA unidad, y el precio del tramo se " +
            "multiplica por las unidades que lleve; el envío se suma una sola vez). Si el cliente pregunta " +
            "por varias unidades o por la docena, le dices el precio de aquí y sigues la venta: esto NO se transfiere.",
          ...listas,
        ]
      : []),
  ].join("\n");
}

/**
 * EL BLOQUE DEL PAÍS, entero. Es CONTEXTO Y DATOS: el comportamiento —qué
 * hacer con cada cosa de aquí— viene después, en la base.
 *
 * `donde` es lo que se sepa de dónde escribe el cliente (la provincia del pin
 * del mapa), para decirle el envío que le toca a él y no las tarifas todas.
 */
export function bloqueDelPais(
  d: DatosPais,
  donde: string | null = null,
  negocioDelPanel: string = "",
): string {
  const tienda = d.tienda || negocioDelPanel;

  return [
    `DÓNDE VENDES — ${d.nombre}. Este WhatsApp es de ${tienda} y atiende a clientes de ${d.nombre}: tienes que sonar de ahí.`,
    "",
    `MONEDA: ${d.moneda.nombre} (${d.moneda.codigo}). Se escribe «${d.moneda.simbolo}» y un importe se ve así: ${d.moneda.ejemplo}. Todo precio que digas va en esta moneda y escrito de esta forma.`,
    "",
    bloqueDeEnvio(d, donde),
    "",
    d.pago
      ? `FORMA DE PAGO: ${d.pago}`
      : "FORMA DE PAGO: NO CONFIGURADA. No la inventes ni prometas ninguna —ni contra entrega, ni transferencia, ni nada—. Si el cliente pregunta cómo se paga, dile en corto que la forma de pago se la confirma el equipo al despachar, y sigue la venta sin transferir. La línea «Forma de pago» NO va en el resumen.",
    "",
    `CÓMO SE DAN LAS DIRECCIONES AQUÍ: ${d.envio.direccion}`,
    "",
    bloqueDelMapa(d),
    "",
    `SI PREGUNTAN DÓNDE ESTÁN O SI HAY TIENDA FÍSICA, la respuesta es esta y no otra: «${d.ubicacion.tiendaFisica}»`,
    `SI COMPARTE SU UBICACIÓN POR EL MAPA: ${d.ubicacion.alRecibirMapa}`,
    "",
    bloqueDeTallas(d),
    "",
    bloqueDeMayoreo(d),
    "",
    d.politicaDeCambios
      ? `CAMBIOS Y DEVOLUCIONES (solo si el cliente pregunta): ${d.politicaDeCambios}`
      : "CAMBIOS Y DEVOLUCIONES: NO CONFIGURADO. Si el cliente pregunta, no prometas ni niegues nada: dile que eso se lo confirma el equipo y sigue la venta, sin transferir.",
    "",
    `ASÍ HABLA LA GENTE AQUÍ — ${d.habla.descripcion}`,
    d.habla.expresiones.map((e) => `- ${e}`).join("\n"),
    /*
     * CÓMO LLAMA LA GENTE DE AQUÍ A LO QUE VENDES. Va pegado a cómo habla,
     * porque es lo mismo: el nombre que el cliente usa. Sin esto, el agente
     * tico transfería en cuanto alguien escribía «faja».
     */
    ...(d.habla.sinonimos?.length
      ? [
          "",
          `CÓMO LLAMAN AQUÍ A LO QUE VENDES. Es el MISMO artículo con otro nombre, no uno que no tengas: véndelo con normalidad y no transfieras por esto.`,
          d.habla.sinonimos.map((e) => `- ${e}`).join("\n"),
        ]
      : []),
    /*
     * LO QUE NO SE DICE, aparte y con todas las letras. Dejarlo fuera de la
     * lista de arriba no basta: el modelo sabe decir «pura vida» sin que nadie
     * se lo enseñe, y en Costa Rica la soltaba al saludar, al agradecer y al
     * despedirse. Aquí se le prohíbe, y el revisor lo comprueba después.
     */
    ...(d.habla.prohibidas?.length
      ? [
          "",
          `LO QUE NO DICES NUNCA EN ${d.nombre.toUpperCase()}, aunque el cliente lo escriba primero: ${d.habla.prohibidas
            .map((f) => `«${f}»`)
            .join(", ")}. Ni al saludar, ni al agradecer, ni al despedirse, ni dentro de otra frase, ni para seguirle la corriente. Se agradece y se despide con la cortesía de arriba.`,
        ]
      : []),
    // Las líneas en blanco de esta lista separan los bloques del prompt: no se
    // filtran los vacíos, que aquí un "" es un renglón a propósito.
  ].join("\n");
}
