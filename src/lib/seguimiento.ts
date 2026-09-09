/**
 * SalesDash — seguimientos.
 *
 * EL ÚNICO mensaje que sale sin que el cliente haya escrito nada:
 *
 *   EN VISTO. Habló el agente, el cliente no volvió y la conversación se quedó
 *   a medias. Pasadas unas horas se le escribe una vez para retomar: el
 *   artículo del que hablaban, que queda poco, y la pregunta que faltaba para
 *   cerrar. Una venta que se enfría no se recupera sola.
 *
 * Eran dos. El otro avisaba de que el pedido ya iba en camino con el mensajero,
 * horas después de que la conversación quedara marcada como cerrada, y se
 * quitó: esa marca no es un mensajero en la calle. En el caso dominicano el
 * cliente había dicho «cuando tenga el dinero completo yo le aviso», nunca
 * hubo resumen, y le llegó igual que su pedido iba en camino. Avisar de una
 * entrega que nadie despachó es peor que no avisar de nada.
 *
 * REGLAS QUE NO SE ROMPEN
 *
 *   - UNO POR CONVERSACIÓN Y TIPO. Lo garantiza el UNIQUE de `seguimientos`,
 *     no la memoria de este barrido: un reinicio no puede volver a escribirle
 *     a nadie.
 *   - SOLO DONDE EL AGENTE YA CONTESTA. En un número que solo se vigila, o con
 *     el agente apagado, no sale ni un mensaje.
 *   - VENTANA CON TOPE POR ARRIBA. Al encender esto no se le escribe a todo el
 *     que quedó a medias en los últimos seis meses.
 *   - EL QUE PIDIÓ UN ASESOR NO RECIBE INSISTENCIA.
 *
 * Quien envía sigue siendo `agent.ts`, el único módulo que puede escribirle a
 * un cliente. Aquí solo se decide a quién le toca.
 */
import {
  conversacionesEnVisto,
  listarCanales,
  obtenerAgente,
  orgsConAgente,
  ahora,
} from "./db";
import { enviarSeguimiento } from "./agent";

/**
 * Cuánto hacia atrás se mira, contando desde que toca el recordatorio.
 *
 * Es lo que convierte «a las 3 horas» en «entre las 3 y las 27»: sin este tope
 * el primer barrido después de encender la función —o después de un fin de
 * semana con el servidor caído— saldría a escribirle a cada conversación
 * abandonada que haya en la base. Con él, lo viejo se queda como está.
 */
const VENTANA = 24 * 60 * 60;

/** Tope por barrido y por cuenta. Un pico de mensajes no puede ser silencioso. */
const MAX_POR_VUELTA = 20;

export interface ResumenBarrido {
  visto: number;
}

/**
 * Un barrido de una cuenta, CANAL POR CANAL.
 *
 * Los interruptores y las horas son de cada canal, no de la cuenta: el número
 * de Panamá puede recordar a las 3 horas y el de Costa Rica a las 12, o no
 * recordar en absoluto. Cuando esto leía un solo agente por cuenta, encender el
 * recordatorio en un número lo encendía en los tres —y a horas que no eran las
 * suyas, en husos que tampoco.
 *
 * Un canal que falle no puede llevarse a los demás: cada uno va en su try.
 */
export async function seguimientosDeCuenta(orgId: number): Promise<ResumenBarrido> {
  const t = ahora();
  const salida: ResumenBarrido = { visto: 0 };

  for (const canal of listarCanales(orgId)) {
    // Donde el agente no contesta tampoco insiste. La consulta lo vuelve a
    // exigir en SQL; esto solo evita pasearse por canales que no pueden dar
    // nada.
    if (canal.activo !== 1 || canal.agente_activo !== 1 || canal.contesta_ia === 1) continue;

    const agente = obtenerAgente(orgId, canal.id);

    try {
      if (agente.recordatorio_visto === 1) {
        const corte = t - Math.max(agente.recordatorio_visto_horas, 1) * 3600;
        const pendientes = conversacionesEnVisto(
          orgId,
          { desde: corte - VENTANA, hasta: corte },
          MAX_POR_VUELTA,
          canal.id,
        );

        for (const c of pendientes) {
          if (await enviarSeguimiento(orgId, c.id, "visto")) salida.visto++;
        }
      }
    } catch (e) {
      console.error(`[seguimiento] falló el barrido del canal ${canal.id}`, e);
    }
  }

  return salida;
}

/**
 * El barrido de todas las cuentas con agente encendido. Lo llama el reloj del
 * arranque cada pocos minutos.
 *
 * Una cuenta que falle no puede llevarse a las demás por delante: cada una va
 * en su propio try.
 */
export async function barrerSeguimientos(): Promise<ResumenBarrido> {
  const total: ResumenBarrido = { visto: 0 };

  for (const orgId of orgsConAgente()) {
    try {
      const r = await seguimientosDeCuenta(orgId);
      total.visto += r.visto;
    } catch (e) {
      console.error(`[seguimiento] falló el barrido de la cuenta ${orgId}`, e);
    }
  }

  if (total.visto > 0) {
    console.log(`[seguimiento] ${total.visto} recordatorio(s) a conversaciones en visto`);
  }

  return total;
}
