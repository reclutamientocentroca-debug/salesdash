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
import type { DatosPais, ZonaDeEnvio } from "./tipos";
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

  const zona = d.envio.zonas.find((z) => contieneLugar(donde, z.lugares));
  if (zona) return zona;

  // Un sitio conocido del país que no es zona especial: va como el resto.
  const pais = obtenerPais(d.codigo);
  if (pais && contieneLugar(donde, pais.zonas)) return "resto";

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
      "De la dirección de este cliente no se puede deducir la zona. Pregúntale en qué provincia " +
        "o zona está antes de decirle cómo le llega.",
    );
  }

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
      "- Solo la ropa y el calzado llevan talla. Cualquier otro artículo —un electrodoméstico, " +
        "una herramienta, lo que sea— no lleva talla ni color: solo se ofrece y se vende.",
    );
  }
  for (const n of t.notas) lineas.push(`- ${n}`);

  return lineas.join("\n");
}

/** Mayoreo: qué hay y qué hace el agente con ello. */
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
  return m.agenteCotiza
    ? `MAYOREO: esta tienda vende al por mayor${desde}. Los precios de mayoreo son solo los que ` +
        "estén escritos en el catálogo o en las instrucciones; si no están, transfieres."
    : `MAYOREO: esta tienda vende al por mayor${desde}, pero TÚ NO COTIZAS MAYOREO: si el cliente ` +
        "lo pide, un representante le pasa los precios. Escribe \"[HANDOFF]\" y no des ninguna cifra.";
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
      : "FORMA DE PAGO: NO CONFIGURADA. No la inventes ni prometas ninguna —ni contra entrega, ni transferencia, ni nada—. Si el cliente pregunta cómo se paga, dile en corto que un representante le confirma la forma de pago y escribe \"[HANDOFF]\" en ese mismo mensaje. La línea «Forma de pago» NO va en el resumen.",
    "",
    `CÓMO SE DAN LAS DIRECCIONES AQUÍ: ${d.envio.direccion}`,
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
      : "CAMBIOS Y DEVOLUCIONES: NO CONFIGURADO. Si el cliente pregunta, no prometas ni niegues nada: un representante le atiende eso. Escribe \"[HANDOFF]\".",
    "",
    `ASÍ HABLA LA GENTE AQUÍ — ${d.habla.descripcion}`,
    d.habla.expresiones.map((e) => `- ${e}`).join("\n"),
  ].join("\n");
}
