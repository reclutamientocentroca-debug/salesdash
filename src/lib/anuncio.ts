/**
 * SalesDash — el anuncio que trajo al cliente.
 *
 * Dos cosas viven aquí y las dos son la MISMA idea vista de dos formas:
 *
 *   1. QUÉ CUENTA COMO LEAD DE ANUNCIO. Un lead es quien llega por un anuncio,
 *      no todo el que escribe: es la cifra por la que se paga publicidad. La
 *      condición en SQL es `deAnuncio()` en `db.ts` y esta es la misma en
 *      JavaScript. Si una cambia, la otra tiene que cambiar con ella o el panel
 *      enseñaría una pastilla que el conteo no ve.
 *
 *   2. CÓMO SE LE CUENTA A LA IA. El anuncio no es un adorno del panel: es lo
 *      que el cliente vino buscando. Sin él, el agente le pregunta «¿de qué
 *      producto hablas?» a alguien que acaba de pinchar una foto de ese
 *      producto, y el analista no sabe atribuirle la venta a nada.
 */

import { articuloDeLaDescripcion } from "./apertura";

/**
 * Lo que queda escrito cuando la imagen de un anuncio no se pudo mirar.
 *
 * Es una marca, no una descripción: existe para que el intento no se repita en
 * cada mensaje que entra —ver `describirAnunciosPendientes`— y por eso nadie
 * puede confundirla con algo que contarle al modelo. Quien la lea, la descarta.
 */
export const ANUNCIO_SIN_DESCRIBIR = "[anuncio sin describir]";

/** Una descripción de anuncio que de verdad dice algo, o null. */
export function descripcionUtil(texto: string | null | undefined): string | null {
  const limpio = texto?.trim();
  return limpio && limpio !== ANUNCIO_SIN_DESCRIBIR ? limpio : null;
}

/** Lo mínimo para saber si un hilo lo trajo un anuncio. */
export interface DatosAnuncio {
  origen: string | null;
  producto_anuncio: string | null;
  descripcion_anuncio?: string | null;
}

/**
 * EL ANUNCIO VIGENTE: el último por el que escribió el cliente.
 *
 * La conversación guarda el PRIMER anuncio para siempre —es el lead que la
 * publicidad pagó— y aparte el más reciente. Al agente le importa el de ahora:
 * un cliente que vuelve por otro anuncio pregunta por otro artículo y otro
 * precio, y venderle el de la primera vez es venderle otra cosa.
 */
export function anuncioVigente(
  c: DatosAnuncio & { anuncio_actual_producto?: string | null; anuncio_actual_descripcion?: string | null },
): DatosAnuncio {
  const producto = c.anuncio_actual_producto?.trim() || c.producto_anuncio;
  const descripcion = c.anuncio_actual_descripcion?.trim() || c.descripcion_anuncio;
  return {
    origen: c.origen ?? (producto || descripcion ? "anuncio" : null),
    producto_anuncio: producto ?? null,
    descripcion_anuncio: descripcion ?? null,
  };
}

/**
 * Llegó por un anuncio.
 *
 * Se pregunta por el origen Y por el título porque Meta no siempre manda
 * `title` —hay creatividades sin titular— y porque las conversaciones guardadas
 * antes de que existiera la columna `origen` solo tienen el producto. Gemela de
 * `deAnuncio()` en `db.ts`.
 */
export function llegoPorAnuncio(c: DatosAnuncio): boolean {
  return c.origen === "anuncio" || !!c.producto_anuncio?.trim();
}

/**
 * El anuncio, escrito para que lo lea un modelo.
 *
 * Devuelve null cuando el cliente escribió por su cuenta: entonces no hay nada
 * que contar y meter un bloque vacío en el prompt solo gasta tokens y confunde.
 *
 * El título dice QUÉ producto lo trajo y el texto QUÉ se le prometió. Los dos
 * hacen falta: «Nevera 12 pies» no explica por qué el cliente escribe
 * preguntando por cuotas, y «0 % de interés a 6 meses» sí.
 */
export function anuncioParaModelo(
  c: DatosAnuncio,
  /** El símbolo de la moneda del país: sin él no se puede recortar el nombre del artículo. */
  simbolo: string | null = null,
): string | null {
  if (!llegoPorAnuncio(c)) return null;

  const producto = c.producto_anuncio?.trim();
  const descripcion = c.descripcion_anuncio?.trim();

  const lineas = ["Este cliente llegó por un anuncio:"];
  lineas.push(`- Producto anunciado: ${producto || "(el anuncio no traía título)"}`);
  if (descripcion) lineas.push(`- Lo que promete el anuncio: ${descripcion}`);

  /*
   * CÓMO SE LLAMA, EN CORTO. Un anuncio abre con su reclamo —«¡COMPRA SEGURO!
   * ORDENA, RECIBE Y LUEGO PAGA!!»— y el modelo copiaba eso como el nombre del
   * artículo: al cliente le llegó un resumen con «Producto: ORDENA, RECIBE Y
   * LUEGO PAGA!!». Aquí se le da el nombre ya limpio, sacado de esa misma
   * descripción, para que sea el que escriba en el pedido.
   */
  const nombre = descripcion && simbolo ? articuloDeLaDescripcion(descripcion, simbolo) : null;
  if (nombre) {
    lineas.push(
      `- Se llama, en corto: ${nombre}. Ese es el nombre que usas al hablarle y el que va en la línea «Producto:» del resumen. ` +
        "Nunca pongas ahí el reclamo del anuncio («ORDENA», «COMPRA SEGURO», «PAGA AL RECIBIR»): eso no dice qué se vende.",
    );
  }

  /*
   * EL ARTÍCULO ES EL DE LA DESCRIPCIÓN, Y NO HAY OTRO.
   *
   * Se ha visto al agente decirle a un cliente que vendía un artículo que la
   * tienda no vende: lo sacó de una imagen mal leída, de un parecido o de lo
   * que suelen vender otras tiendas. La descripción la escribió el negocio y
   * es la única fuente de QUÉ se vende en este chat; lo demás solo añade
   * precio, colores o tallas. Se le dice aquí, pegado a la descripción, para
   * que el modelo lo lea junto al dato y no cinco pantallas más abajo.
   */
  lineas.push(
    descripcion
      ? "EL ARTÍCULO DE ESTE CHAT ES EL QUE NOMBRA ESA DESCRIPCIÓN, y se le llama exactamente como ahí se llama. " +
          "Está PROHIBIDO cambiarlo por otro artículo o ponerle otro nombre: ni por lo que una máquina haya leído en una imagen, " +
          "ni por lo que suene parecido, ni por lo que vendan otras tiendas. Si la descripción no nombra ningún artículo, vale el título; " +
          "y si ninguno de los dos lo nombra, pregúntale al cliente qué artículo vio, sin proponerle tú ninguno."
      : "EL ARTÍCULO DE ESTE CHAT ES EL DEL TÍTULO, con ese mismo nombre. Está PROHIBIDO cambiarlo por otro o ponerle otro nombre. " +
          "Si el título tampoco nombra ningún artículo, pregúntale al cliente qué artículo vio, sin proponerle tú ninguno.",
  );

  /*
   * Y EL PRECIO, IGUAL: el que está escrito en la descripción, tal cual, o
   * ninguno. Un precio inventado es una venta que el negocio no puede
   * sostener y que el cliente ya leyó. El revisor lo para de forma mecánica
   * —ver `revisor.ts`—, pero mejor que el agente ni lo escriba.
   */
  lineas.push(
    "Y EL PRECIO ES EL QUE ESTÁ ESCRITO EN ESA DESCRIPCIÓN, con la misma cifra: no lo redondees, no lo cambies, no le sumes ni le quites nada. " +
      "Si la descripción no trae ningún precio, mira si el catálogo o lo que escribió el negocio tienen ESE MISMO artículo con precio, y ese es el que vale. " +
      "Si no hay precio en ningún sitio, NO LO INVENTES ni lo deduzcas de otro artículo parecido: dile al cliente que un representante le pasa el precio y escribe \"[HANDOFF]\". " +
      "Una cifra que no está escrita arriba no existe.",
  );

  return lineas.join("\n");
}
