/**
 * Del anuncio al producto, y del producto al precio.
 *
 * LA REGLA: el precio sale del catálogo, NUNCA del modelo. El anuncio dice qué
 * se prometió; el catálogo dice qué hay y a cuánto. Cuando los dos no coinciden
 * manda el catálogo, y cuando el anuncio no está vinculado a ningún producto el
 * agente no cotiza: pasa el hilo a una persona.
 *
 * Esa última parte es la que importa. Un agente que se inventa un precio hace
 * una venta a un precio que el negocio no puede sostener, y el cliente ya lo
 * leyó: no hay forma de desdecirlo sin quedar mal. Callar y pasar el hilo es
 * peor experiencia y mejor negocio.
 */
import { anuncioMetaPorAdId, registrarAnuncioVisto } from "@/lib/db";

export interface ContextoAnuncio {
  adId: string;
  /** Qué hacer con este hilo. */
  puedeCotizar: boolean;
  producto: { nombre: string; precio: number | null; variantes: string | null } | null;
  /** Por qué no se puede cotizar, para la anomalía y para el panel. */
  motivo: "vinculado" | "sin_vincular" | "producto_borrado" | "producto_inactivo" | "sin_precio";
}

/**
 * Resuelve el anuncio que trajo al cliente.
 *
 * Deja constancia del anuncio ANTES de resolverlo, siempre. El `ad_id` llega en
 * el referral del primer mensaje del hilo y en ningún otro sitio: si no se
 * guarda en ese instante, el dueño no tiene forma de vincularlo después —
 * tendría que adivinar el identificador de un anuncio que ya pasó—. Guardarlo
 * sin producto es exactamente lo que llena la lista de «anuncios por vincular».
 */
export function resolverAnuncio(
  orgId: number,
  adId: string,
  titulo: string | null = null,
): ContextoAnuncio {
  registrarAnuncioVisto(orgId, adId, titulo);

  const fila = anuncioMetaPorAdId(orgId, adId);

  if (!fila || fila.producto_id === null) {
    return { adId, puedeCotizar: false, producto: null, motivo: "sin_vincular" };
  }

  // El producto se borró del catálogo pero el anuncio sigue apuntándolo.
  if (fila.producto_nombre === null) {
    return { adId, puedeCotizar: false, producto: null, motivo: "producto_borrado" };
  }

  const producto = {
    nombre: fila.producto_nombre,
    precio: fila.producto_precio,
    variantes: fila.producto_variantes,
  };

  // Apagado en el catálogo: el dueño dijo que ahora mismo no se vende.
  if (fila.producto_activo === 0) {
    return { adId, puedeCotizar: false, producto, motivo: "producto_inactivo" };
  }

  /*
   * Vinculado pero sin precio. `precio` es opcional en el catálogo, así que
   * este caso existe de verdad, y es el más traicionero: el producto está bien
   * y el agente creería que puede hablar de dinero. No puede — no hay dinero
   * que decir.
   */
  if (producto.precio === null) {
    return { adId, puedeCotizar: false, producto, motivo: "sin_precio" };
  }

  return { adId, puedeCotizar: true, producto, motivo: "vinculado" };
}

/** En castellano, para la anomalía que ve el dueño. */
export function explicarMotivo(c: ContextoAnuncio): string {
  switch (c.motivo) {
    case "sin_vincular":
      return `El anuncio ${c.adId} no está vinculado a ningún producto. El agente no cotiza y el hilo pasa a una persona.`;
    case "producto_borrado":
      return `El anuncio ${c.adId} apunta a un producto que ya no está en el catálogo.`;
    case "producto_inactivo":
      return `El producto «${c.producto?.nombre}» del anuncio ${c.adId} está apagado en el catálogo.`;
    case "sin_precio":
      return `El producto «${c.producto?.nombre}» del anuncio ${c.adId} no tiene precio en el catálogo.`;
    default:
      return "";
  }
}

/**
 * El bloque que se le añade al prompt.
 *
 * NO sustituye a `anuncioParaModelo`: aquel cuenta qué se le prometió al
 * cliente y este dice qué se puede prometer. Los dos van juntos, y este manda.
 */
export function anuncioParaPrompt(c: ContextoAnuncio): string {
  if (!c.puedeCotizar) {
    return [
      "IMPORTANTE — este cliente llegó por un anuncio que NO está vinculado a un producto del catálogo.",
      "No des precios, ni plazos, ni condiciones, ni confirmes los del anuncio.",
      "Dile que enseguida le atiende alguien del equipo con los detalles, y no sigas vendiendo.",
    ].join("\n");
  }

  const p = c.producto!;
  const partes = [`- ${p.nombre}`];
  if (p.variantes) partes.push(`(${p.variantes})`);
  partes.push(`— ${p.precio}`);

  return [
    "El anuncio que trajo a este cliente corresponde a este producto del catálogo:",
    partes.join(" "),
    "Ese precio es el bueno. Si el anuncio prometía otro, no lo confirmes ni lo niegues: dile que lo revisas con el equipo.",
  ].join("\n");
}
