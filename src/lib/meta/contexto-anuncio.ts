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
import { descripcionUtil } from "@/lib/anuncio";

export interface ContextoAnuncio {
  adId: string;
  /** Qué hacer con este hilo. */
  puedeCotizar: boolean;
  producto: { nombre: string; precio: number | null; variantes: string | null } | null;
  /** Por qué no se puede cotizar, para la anomalía y para el panel. */
  motivo: "vinculado" | "sin_vincular" | "producto_borrado" | "producto_inactivo" | "sin_precio";
  /**
   * QUÉ DECÍA EL ANUNCIO. Su texto, y lo que se lee en su imagen.
   *
   * Se guardaban las dos cosas y no las leía nadie: el agente sabía el TÍTULO
   * del anuncio y nada más. En la publicidad de Facebook el precio, los colores
   * y las tallas van escritos ENCIMA de la foto la mitad de las veces, así que
   * el cliente escribía «quiero la del anuncio, la azul» y el agente no tenía
   * ni idea de qué azul le hablaban.
   */
  texto: string | null;
  descripcionImagen: string | null;
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

  // Lo que decía el anuncio vale igual esté o no vinculado a un producto: es
  // lo que el cliente vio antes de escribir.
  const dicho = {
    texto: fila?.texto?.trim() || null,
    descripcionImagen: descripcionUtil(fila?.descripcion_imagen),
  };

  if (!fila || fila.producto_id === null) {
    return { adId, puedeCotizar: false, producto: null, motivo: "sin_vincular", ...dicho };
  }

  // El producto se borró del catálogo pero el anuncio sigue apuntándolo.
  if (fila.producto_nombre === null) {
    return { adId, puedeCotizar: false, producto: null, motivo: "producto_borrado", ...dicho };
  }

  const producto = {
    nombre: fila.producto_nombre,
    precio: fila.producto_precio,
    variantes: fila.producto_variantes,
  };

  // Apagado en el catálogo: el dueño dijo que ahora mismo no se vende.
  if (fila.producto_activo === 0) {
    return { adId, puedeCotizar: false, producto, motivo: "producto_inactivo", ...dicho };
  }

  /*
   * Vinculado pero sin precio. `precio` es opcional en el catálogo, así que
   * este caso existe de verdad, y es el más traicionero: el producto está bien
   * y el agente creería que puede hablar de dinero. No puede — no hay dinero
   * que decir.
   */
  if (producto.precio === null) {
    return { adId, puedeCotizar: false, producto, motivo: "sin_precio", ...dicho };
  }

  return { adId, puedeCotizar: true, producto, motivo: "vinculado", ...dicho };
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
  /*
   * LO QUE EL CLIENTE VIO ANTES DE ESCRIBIR.
   *
   * Va delante de todo lo demás, y se pone esté el anuncio vinculado o no,
   * porque no es permiso para cotizar: es de qué se está hablando. Sin esto el
   * agente sabe el TÍTULO del anuncio y nada más, y a un «quiero la del anuncio,
   * la azul» contesta preguntando de qué producto se trata. En la publicidad de
   * Facebook el precio y los colores van escritos ENCIMA de la foto la mitad de
   * las veces, y ahí no los veía nadie.
   */
  const vio: string[] = [];
  if (c.texto) vio.push(`Lo que dice el anuncio: ${c.texto}`);
  if (c.descripcionImagen) vio.push(`Lo que se ve en su imagen: ${c.descripcionImagen}`);

  const contexto = vio.length
    ? ["ESTO ES LO QUE VIO EL CLIENTE EN EL ANUNCIO ANTES DE ESCRIBIRTE:", ...vio, ""].join("\n")
    : "";

  if (!c.puedeCotizar) {
    /*
     * SIN PRODUCTO DEL CATÁLOGO, PERO CON EL ANUNCIO DELANTE, SE VENDE IGUAL.
     *
     * Antes aquí se soltaba el lead: «que le atienda alguien del equipo». La
     * intención era buena —que el agente no se inventara un precio— pero el
     * efecto era el contrario del que se buscaba: en un negocio que vive de
     * anuncios y no mantiene el catálogo vinculado, ESO ERA TODOS LOS LEADS. El
     * agente contestaba a cada cliente que ya le atendería una persona, y la
     * persona llegaba tarde o no llegaba.
     *
     * El anuncio lo escribió y lo pagó este negocio. Un precio anunciado por el
     * propio dueño no es una invención del modelo: es su precio, y es el que
     * vio el cliente antes de escribir. Vender con eso no rompe la regla de «no
     * inventes precios» — la respeta, porque el precio no sale del modelo.
     *
     * Lo que se pierde es el aviso al dueño de que ese anuncio no está
     * vinculado. No se pierde: sigue creando su anomalía, y el panel se la
     * enseña. Vincularlo sigue siendo mejor —el catálogo se actualiza y un
     * anuncio viejo no— pero ya no es la diferencia entre vender y no vender.
     */
    if (!vio.length) {
      return [
        "IMPORTANTE — este cliente llegó por un anuncio del que no se guardó nada: ni su texto ni lo que se veía en él.",
        "No sabes qué le prometieron, así que no des precios ni condiciones que no estén en tu catálogo o en tus instrucciones.",
        "Pregúntale con naturalidad qué artículo vio, en una sola línea, y sigue desde ahí.",
      ].join("\n");
    }

    return (
      contexto +
      [
        "Este anuncio no está vinculado a ningún producto del catálogo, así que lo que dice ARRIBA es tu fuente: el artículo que sale ahí y el precio que anuncia son los buenos, y con eso vendes.",
        "Si el catálogo o tus instrucciones tienen ese mismo artículo a otro precio, manda el catálogo: es lo que está vigente hoy.",
        "Lo que no esté ni en el anuncio ni en el catálogo no te lo inventes: ahí sí, dile que lo confirmas con el equipo.",
      ].join("\n")
    );
  }

  const p = c.producto!;
  const partes = [`- ${p.nombre}`];
  if (p.variantes) partes.push(`(${p.variantes})`);
  partes.push(`— ${p.precio}`);

  return (
    contexto +
    [
      "El anuncio que trajo a este cliente corresponde a este producto del catálogo:",
      partes.join(" "),
      "Ese precio es el bueno. Si el anuncio prometía otro —en su texto o escrito sobre su imagen—, no lo confirmes ni lo niegues: dile que lo revisas con el equipo.",
    ].join("\n")
  );
}
