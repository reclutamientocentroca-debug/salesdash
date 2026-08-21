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

/** Lo mínimo para saber si un hilo lo trajo un anuncio. */
export interface DatosAnuncio {
  origen: string | null;
  producto_anuncio: string | null;
  descripcion_anuncio?: string | null;
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
export function anuncioParaModelo(c: DatosAnuncio): string | null {
  if (!llegoPorAnuncio(c)) return null;

  const producto = c.producto_anuncio?.trim();
  const descripcion = c.descripcion_anuncio?.trim();

  const lineas = ["Este cliente llegó por un anuncio:"];
  lineas.push(`- Producto anunciado: ${producto || "(el anuncio no traía título)"}`);
  if (descripcion) lineas.push(`- Lo que promete el anuncio: ${descripcion}`);

  return lineas.join("\n");
}
