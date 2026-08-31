/**
 * SalesDash — el enlace que manda el cliente, con lo que hay detrás.
 *
 * UN ENLACE PELADO NO LE DICE NADA A NADIE
 *
 * El cliente manda `https://tienda.com/p/8834` y ya está: ni escribe qué es ni
 * lo describe, porque en su pantalla WhatsApp le está enseñando la foto, el
 * título y el precio. Al agente le llegaba la URL sola. Y contestaba lo único
 * que se puede contestar sin saber nada: «¿de qué producto me hablas?» —a
 * alguien que acaba de mandarle exactamente eso—.
 *
 * Pasa constantemente: el cliente ve el artículo en el catálogo de la tienda,
 * en Instagram o en el marketplace, y lo comparte por WhatsApp en vez de
 * escribir su nombre. Es la forma más común de decir «quiero este».
 *
 * WhatsApp manda esa ficha en el mismo mensaje: título, descripción y la
 * dirección real. No hay que salir a buscar nada a internet —cosa que además no
 * haríamos: traer una página que eligió un tercero es abrirle la puerta a que
 * el texto de esa página le hable al modelo—. Lo que se aprovecha es lo que ya
 * venía dentro del mensaje.
 *
 * Vive en su propio módulo, sin Baileys dentro, por lo mismo que `ubicacion.ts`:
 * lo usan el traductor del socket y las pruebas, y así se comprueba sin
 * levantar medio WhatsApp.
 */

/**
 * Con qué se marca la ficha del enlace dentro del texto del mensaje.
 *
 * Igual que `[imagen]` o `[ubicación]`: viaja dentro del contenido, así que
 * aparece sin tocar la tabla en el hilo, en el analista y en el informe. Y va
 * marcada para que el modelo sepa que ESO no lo escribió el cliente: lo escribió
 * la web que hay al otro lado del enlace, y no es lo mismo.
 */
export const MARCA_ENLACE = "[enlace]";

export interface FichaEnlace {
  /** El título de la página, que suele ser el nombre del producto. */
  titulo?: string | null;
  /** El resumen. Aquí es donde suele estar el precio y de qué es. */
  descripcion?: string | null;
  /** La dirección de verdad, que no siempre es la que se ve en el texto. */
  url?: string | null;
}

/** Cuánto de la descripción se guarda. Lo suficiente para saber qué es. */
const MAX_DESCRIPCION = 300;
const MAX_TITULO = 140;

function recortar(texto: string | null | undefined, tope: number): string | null {
  const limpio = texto?.trim().replace(/\s+/g, " ");
  if (!limpio) return null;
  return limpio.length > tope ? `${limpio.slice(0, tope - 1).trimEnd()}…` : limpio;
}

/**
 * ¿Trae este mensaje una ficha de enlace que valga la pena?
 *
 * Un enlace sin título ni descripción no aporta: la URL ya está en el texto del
 * mensaje y repetirla solo gasta sitio en el prompt.
 */
export function tieneFicha(f: FichaEnlace | null | undefined): boolean {
  return !!(f && (recortar(f.titulo, MAX_TITULO) || recortar(f.descripcion, MAX_DESCRIPCION)));
}

/**
 * El texto del mensaje con la ficha del enlace pegada detrás.
 *
 * El mensaje del cliente NO se toca: se le añade una línea. Lo que él escribió
 * sigue siendo suyo y va primero, que es como hay que leerlo.
 */
export function textoConEnlace(texto: string, f: FichaEnlace | null | undefined): string {
  if (!tieneFicha(f)) return texto;

  const titulo = recortar(f!.titulo, MAX_TITULO);
  const descripcion = recortar(f!.descripcion, MAX_DESCRIPCION);

  /*
   * La descripción a veces repite el título entero. Enseñar «Camisa de lino ·
   * Camisa de lino, 100% lino» no informa de nada y gasta el doble.
   */
  const partes = [titulo, descripcion && descripcion !== titulo ? descripcion : null].filter(
    (p): p is string => !!p,
  );

  const ficha = `${MARCA_ENLACE} ${partes.join(" · ")}`;

  // Si el cliente solo mandó la URL, la ficha ES el mensaje y no hace falta
  // repetir el enlace pelado encima.
  return texto.trim() ? `${texto.trim()}\n${ficha}` : ficha;
}

/** ¿Este contenido lleva la ficha de un enlace? */
export function llevaEnlace(contenido: string | null | undefined): boolean {
  return !!contenido?.includes(MARCA_ENLACE);
}
