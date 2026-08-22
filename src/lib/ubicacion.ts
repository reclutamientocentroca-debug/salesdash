/**
 * SalesDash — la ubicación que manda el cliente.
 *
 * En una venta con entrega a domicilio, el pin del mapa ES la dirección. El
 * cliente escribe media conversación y al final manda su ubicación en vez de
 * teclear la calle, y hasta ahora eso entraba en el hilo como
 * «[locationMessage]»: un agujero justo donde está el dato que necesita quien
 * despacha el pedido, y una dirección que el analista no podía leer.
 *
 * Vive en su propio módulo, sin Baileys dentro, por dos razones: lo usan tres
 * sitios que no se conocen entre sí —el traductor del socket, la burbuja del
 * hilo y el informe— y así se puede probar sin levantar medio WhatsApp.
 */

/**
 * Con qué empieza el texto de una ubicación en el hilo.
 *
 * Es una marca y no una columna nueva a propósito: el tipo de mensaje se
 * guarda con un CHECK en la tabla y añadirle un valor obliga a reescribirla
 * entera. La marca viaja dentro del texto, que es lo que ya leen el analista,
 * la vista previa de la bandeja y el informe, así que la ubicación aparece en
 * los tres sin tocar ninguno.
 */
export const MARCA_UBICACION = "[ubicación]";

export interface Ubicacion {
  latitud?: number | null;
  longitud?: number | null;
  nombre?: string | null;
  direccion?: string | null;
  /** WhatsApp también manda ubicación en vivo, que se va actualizando. */
  enVivo?: boolean;
}

/** Coordenadas de verdad: dentro del planeta y distintas del cero. */
function validas(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  /*
   * (0, 0) está en el Atlántico, frente a Ghana. Nadie pide un domicilio ahí:
   * cuando aparece es que el mensaje venía sin coordenadas y alguien las
   * rellenó con ceros. Un enlace a mitad del océano es peor que ninguno,
   * porque el que despacha se fía de él.
   */
  return !(lat === 0 && lng === 0);
}

/** El enlace al mapa, o null si las coordenadas no sirven. */
export function enlaceDeMapa(lat: unknown, lng: unknown): string | null {
  if (!validas(lat, lng)) return null;
  return `https://www.google.com/maps?q=${lat},${lng as number}`;
}

/**
 * El texto que se guarda en el hilo.
 *
 * Lleva el nombre del sitio y la dirección cuando WhatsApp los manda, porque
 * eso es lo que el analista necesita leer para saber si el pedido ya tiene
 * dirección o le falta. Las coordenadas NO van en el texto: no le dicen nada a
 * nadie y ensucian la vista previa de la bandeja; su sitio es el enlace.
 */
export function textoDeUbicacion(u: Ubicacion): string {
  const partes = [u.nombre?.trim(), u.direccion?.trim()].filter(
    (p): p is string => !!p && p.length > 0,
  );

  // El nombre a veces ES la dirección: repetirla dos veces no aporta.
  const unicas = partes.filter((p, i) => partes.indexOf(p) === i);

  const marca = u.enVivo ? `${MARCA_UBICACION} en vivo` : MARCA_UBICACION;
  return unicas.length ? `${marca} ${unicas.join(" · ")}` : marca;
}

/** ¿Este mensaje es una ubicación? */
export function esUbicacion(contenido: string | null | undefined): boolean {
  return !!contenido?.startsWith(MARCA_UBICACION);
}

/** Lo que se enseña de una ubicación, sin la marca. */
export function textoSinMarca(contenido: string): string {
  const sinMarca = contenido.slice(MARCA_UBICACION.length).replace(/^\s*en vivo/, "").trim();
  return sinMarca || "Ubicación enviada por el cliente";
}
