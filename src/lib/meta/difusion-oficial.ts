/**
 * SalesDash — el modo oficial de una difusión (WhatsApp Cloud API), TODAVÍA
 * SIN ENVÍO REAL.
 *
 * La dueña pidió dejar la ESTRUCTURA lista para conectarlo después —números
 * verificados por Meta, plantillas aprobadas, costo por mensaje— sin
 * implementar el envío en esta versión. `tickDifusiones()` (`difusion.ts`)
 * ya sabe no tocar ninguna campaña con `modo: "oficial"`: esta pieza es solo
 * el costo estimado para que la dueña lo vea en pantalla antes de decidir.
 *
 * Cuando se conecte de verdad, esto se vuelve la contraparte de
 * `enviarMensajeMeta`/`enviarImagenMeta` (el transporte de Meta, en el
 * módulo vecino de envío), con una plantilla aprobada en vez de texto libre
 * —la Cloud API no deja mandar texto suelto a quien no te escribió primero,
 * por eso hacen falta plantillas—.
 */

/** Una plantilla de WhatsApp aprobada por Meta. Todavía no se usa para enviar. */
export interface PlantillaCloudApi {
  nombre: string;
  idioma: string;
}

/** El costo estimado de una tanda de mensajes, para enseñarlo en el formulario ANTES de mandar nada. */
export function estimarCosto(cantidadMensajes: number, costoPorMensaje: number): number {
  return Math.max(0, cantidadMensajes) * Math.max(0, costoPorMensaje);
}

/**
 * NO ENVÍA NADA TODAVÍA. Existe para que `difusion.ts` tenga un único punto
 * al que apuntar el día que esto se active, en vez de que el motor entero
 * tenga que cambiar.
 */
export async function enviarPorCloudApi(): Promise<never> {
  throw new Error("El envío por WhatsApp Cloud API (modo oficial) todavía no está activado.");
}
