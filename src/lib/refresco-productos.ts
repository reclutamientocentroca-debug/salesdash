/**
 * Refresco automático de colores y tallas.
 *
 * Cada tres horas se vuelven a abrir los links guardados de los productos (los
 * mismos de `producto_links`) y se relee qué colores y qué tallas por color
 * quedan, para que el catálogo siga al stock real de la tienda sin que nadie
 * pulse «Actualizar todo». Solo se abren links que la dueña guardó ella misma.
 */
import { productosConLinksViejos } from "@/lib/db";
import { importarLinksDeProducto } from "@/lib/importar-producto";

export const CADA_SEGUNDOS = 3 * 60 * 60;

let enCurso = false;

/** Una vuelta: refresca los productos cuyo último dato tiene 3 horas o más. */
export async function refrescarProductos(): Promise<number> {
  if (enCurso) return 0; // una vuelta lenta no apila otra encima
  enCurso = true;
  let hechos = 0;
  try {
    // Un margen de 5 min para que el reloj no se salte un ciclo por segundos.
    for (const { org_id, producto_id } of productosConLinksViejos(CADA_SEGUNDOS - 300)) {
      try {
        const r = await importarLinksDeProducto(org_id, producto_id, false);
        hechos++;
        if (r.fallidos.length) {
          console.warn(`[refresco] producto ${producto_id}: ${r.fallidos.length} link(s) fallaron, se conserva lo anterior`);
        }
      } catch (e) {
        console.error(`[refresco] producto ${producto_id} no se pudo actualizar`, e);
      }
    }
  } finally {
    enCurso = false;
  }
  return hechos;
}
