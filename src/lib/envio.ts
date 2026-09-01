/**
 * SalesDash — cuánto cuesta el envío, y de dónde sale ese número.
 *
 * ═══ EL AGENTE NO INVENTA UN COSTO DE ENVÍO ═══
 *
 * Es el error más caro que puede cometer, y el más fácil: el cliente da su
 * dirección, el agente ya tiene todo lo demás y le falta una línea para cerrar,
 * así que escribe una cifra. Si se pasa, pierde la venta; si se queda corto, el
 * negocio paga la diferencia en cada pedido de esa zona. Y el cliente ya lo
 * leyó: desdecirse cuesta el pedido igual.
 *
 * Aquí el costo no se adivina, se BUSCA: la provincia sale del pin del mapa que
 * mandó el cliente —o de lo que escribió— y de la provincia sale la tarifa que
 * el dueño cargó. En República Dominicana eso son dos precios muy distintos: en
 * el Gran Santo Domingo y Santiago entrega un mensajero propio en el día; al
 * interior sale por Caribe Express o Vimenca y el cliente retira en la sucursal
 * de su pueblo. Cobrar el primero por un pedido del segundo es perder dinero en
 * cada venta del interior.
 *
 * Y si no hay tarifas cargadas, esto NO calla: dice en voz alta que no las hay
 * y prohíbe inventarlas. Un agente que no sabe el envío y lo dice es un agente
 * que cierra la venta igual; uno que se lo inventa es una devolución.
 */
import type { Pais } from "./paises";

/** Las dos zonas de tarifa. Es lo que separa un mensajero de una encomienda. */
export type ZonaEnvio = "cerca" | "lejos";

/** Lo que el dueño cargó, en la moneda del país. Nulo = no lo ha cargado. */
export interface Tarifas {
  envio_cerca: number | null;
  envio_lejos: number | null;
}

/**
 * Sin tildes, en minúsculas y sin lo que va entre paréntesis.
 *
 * Las zonas del país se escriben con ejemplos dentro —«Chiriquí (David,
 * Boquete)»— y una provincia que llega del mapa nunca los trae. Comparar los
 * textos crudos no acertaría ni una.
 */
function llano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Esta dirección cae en la zona del mensajero o en la del interior?
 *
 * `donde` es lo que se sepa del cliente: la provincia que devolvió el mapa, o
 * la dirección que escribió. Se busca el nombre de una zona cercana dentro de
 * ese texto y no al revés, porque lo que llega del mapa es «Santo Domingo Este»
 * y lo que hay cargado puede ser «Santo Domingo».
 *
 * Devuelve null cuando no se reconoce nada. Ahí no se adivina: el agente
 * pregunta la provincia, que es más barato que equivocarse de tarifa.
 */
export function zonaDeEnvio(pais: Pais, donde: string | null | undefined): ZonaEnvio | null {
  const texto = llano(donde ?? "");
  if (!texto) return null;

  const cerca = pais.zonasCercanas.some((z) => {
    const nombre = llano(z);
    return nombre.length > 2 && texto.includes(nombre);
  });
  if (cerca) return "cerca";

  const conocida = pais.zonas.some((z) => {
    const nombre = llano(z);
    return nombre.length > 2 && texto.includes(nombre);
  });

  return conocida ? "lejos" : null;
}

/** El importe de una zona, o null si el dueño no lo cargó. */
export function montoDeEnvio(tarifas: Tarifas, zona: ZonaEnvio | null): number | null {
  if (zona === "cerca") return tarifas.envio_cerca;
  if (zona === "lejos") return tarifas.envio_lejos;
  return null;
}

/** «RD$200». Como lo escribe la gente del país, no como lo escribe un banco. */
function importe(pais: Pais, monto: number): string {
  return `${pais.moneda.simbolo}${monto.toLocaleString("es-DO")}`;
}

/**
 * El bloque de envío que lee el modelo.
 *
 * Va SIEMPRE, con o sin pin: el agente tiene que saber las dos tarifas desde el
 * primer mensaje, porque el cliente pregunta «¿cuánto es el envío?» antes de
 * dar ninguna dirección. Y cuando ya se sabe la provincia —porque mandó su
 * ubicación— se le dice el importe exacto de ESE cliente, para que no tenga que
 * elegir entre dos.
 *
 * `donde` es lo que se sepa de dónde vive: la provincia del pin, o nada.
 */
export function bloqueDeEnvio(
  pais: Pais,
  tarifas: Tarifas,
  donde: string | null = null,
): string {
  const cerca = tarifas.envio_cerca;
  const lejos = tarifas.envio_lejos;

  /*
   * Sin tarifas cargadas no se calla: se dice. Un agente que no sabe el envío y
   * lo dice cierra la venta igual; uno que se lo inventa deja al negocio
   * pagando la diferencia en cada pedido de esa zona.
   */
  if (cerca === null && lejos === null) {
    return [
      "COSTO DE ENVÍO — no tienes tarifas cargadas en el sistema.",
      "El costo de envío es el que esté escrito en tus instrucciones o en el catálogo. Si no está " +
        "escrito en ninguno de los dos, NO TE LO INVENTES ni lo estimes: dile al cliente que le " +
        "confirmas el costo del envío en un momento y sigue con el resto del pedido.",
    ].join("\n");
  }

  const lineas = ["COSTO DE ENVÍO — estas son las tarifas de este negocio y no hay otras:"];

  if (cerca !== null) {
    lineas.push(`- ${pais.zonasCercanas.join(", ")}: ${importe(pais, cerca)}.`);
  }
  if (lejos !== null) {
    lineas.push(`- Resto del país: ${importe(pais, lejos)}.`);
  }
  if (cerca === null || lejos === null) {
    lineas.push(
      "- La zona que no aparece arriba no tiene tarifa cargada: si el cliente es de ahí, dile que " +
        "le confirmas el costo del envío y NO te lo inventes.",
    );
  }

  lineas.push(
    "Esas cifras mandan sobre cualquier otro monto de envío que aparezca escrito en otro sitio, y " +
      "no se redondean ni se negocian. El envío va en su propia línea del resumen y sumado en el " +
      "total.",
  );

  /*
   * Y LO QUE LE TOCA A ESTE CLIENTE. Cuando ya se sabe de dónde es, decirle las
   * dos tarifas es dejarle elegir; decirle la suya es cerrar.
   */
  const zona = zonaDeEnvio(pais, donde);
  const suyo = montoDeEnvio(tarifas, zona);

  if (zona && suyo !== null) {
    lineas.push(
      `A ESTE CLIENTE le corresponde ${importe(pais, suyo)}: su dirección cae en ` +
        `${zona === "cerca" ? "la zona de entrega con mensajero" : "el interior"}. Usa ese importe.`,
    );
  } else if (donde?.trim()) {
    lineas.push(
      "De la dirección de este cliente no se puede deducir la zona. Pregúntale en qué provincia " +
        "está antes de decirle un costo de envío.",
    );
  }

  return lineas.join("\n");
}
