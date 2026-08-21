/**
 * SalesDash — anomalías.
 *
 * Reglas mecánicas, sin modelos de lenguaje: son deterministas, baratas y
 * explicables. Si una alerta salta, se puede señalar exactamente por qué.
 *
 * Dos alcances:
 *   - de conversación: se revisan al analizar un hilo
 *   - de canal: barrido periódico, sin conversación asociada
 */
import {
  ahora,
  crearAnomalia,
  esperandoRespuesta,
  leadsPorCanalEnVentana,
  listarCanales,
  listarMensajes,
  type Conversacion,
  type Mensaje,
} from "./db";
import { normalizarProducto } from "./metrics";

const MEDIA_HORA = 30 * 60;
const UN_DIA = 24 * 60 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// De conversación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Se llama justo después de analizar un hilo, con los mensajes ya ordenados.
 * No decide clasificaciones: solo señala lo que no cuadra.
 */
export function revisarConversacion(
  orgId: number,
  conv: Conversacion,
  mensajes: Mensaje[],
): void {
  const cerrada = conv.cerrado_por === "ia" || conv.cerrado_por === "humano";

  // 1. Una venta cerrada sin monto o sin envío no se puede cobrar ni cuadrar.
  if (cerrada && (conv.total === null || conv.envio === null)) {
    const faltan = [
      conv.total === null ? "el total" : null,
      conv.envio === null ? "el costo de envío" : null,
    ].filter(Boolean);

    crearAnomalia(orgId, {
      conversationId: conv.id,
      tipo: "cierre_incompleto",
      severidad: "alta",
      detalle: `Se cerró la venta pero falta ${faltan.join(" y ")}.`,
    });
  }

  // 2. La IA repitiéndose: casi siempre es un bucle o un prompt atascado.
  let repetido = 0;
  let anterior = "";
  for (const m of mensajes) {
    if (m.emisor !== "ia" || m.tipo !== "texto") {
      anterior = "";
      repetido = 0;
      continue;
    }
    const texto = m.content.trim().toLowerCase();
    repetido = texto && texto === anterior ? repetido + 1 : 0;
    anterior = texto;

    if (repetido >= 1) {
      crearAnomalia(orgId, {
        conversationId: conv.id,
        tipo: "ia_repetitiva",
        severidad: "media",
        detalle: "La IA mandó el mismo mensaje dos veces seguidas.",
      });
      break;
    }
  }

  // 4. Se anunció una cosa y se vendió otra: puede ser un error de captura o
  //    un anuncio que atrae al cliente equivocado. Vale la pena mirarlo.
  if (cerrada && conv.producto_vendido && conv.producto_anuncio) {
    const vendido = normalizarProducto(conv.producto_vendido);
    const anunciado = normalizarProducto(conv.producto_anuncio);

    // Se comparan por contención: "camisa manga larga" contra "camisa" no es
    // una discrepancia, es el mismo producto dicho con más o menos detalle.
    const parecidos = vendido.includes(anunciado) || anunciado.includes(vendido);

    if (!parecidos) {
      crearAnomalia(orgId, {
        conversationId: conv.id,
        tipo: "producto_distinto",
        severidad: "media",
        detalle: `El anuncio era "${conv.producto_anuncio}" y se vendió "${conv.producto_vendido}".`,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// De canal y de barrido
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumenBarrido {
  sin_responder: number;
  canales_mudos: number;
  canales_bajos: number;
}

/**
 * Barrido periódico. Lo dispara el panel al abrir el dashboard y el análisis
 * diario; no hay tareas programadas en el stack.
 */
export function barrerAnomalias(orgId: number): ResumenBarrido {
  const t = ahora();
  const resumen: ResumenBarrido = { sin_responder: 0, canales_mudos: 0, canales_bajos: 0 };

  // 3. El cliente escribió último y nadie contestó en media hora. Es la más
  //    accionable de todas: hay una venta enfriándose ahora mismo.
  for (const conv of esperandoRespuesta(orgId, t - MEDIA_HORA)) {
    const espera = Math.round((t - (conv.last_message_at ?? t)) / 60);
    crearAnomalia(orgId, {
      conversationId: conv.id,
      tipo: "sin_responder",
      severidad: "alta",
      detalle: `${conv.cliente_nombre ?? conv.cliente_phone} escribió hace ${espera} minutos y nadie ha respondido.`,
    });
    resumen.sin_responder++;
  }

  // Leads por canal: hoy contra el promedio diario de los 7 días previos.
  const deHoy = new Map(leadsPorCanalEnVentana(orgId, t - UN_DIA, t).map((f) => [f.canal_id, f.n]));
  const deLaSemana = new Map(
    leadsPorCanalEnVentana(orgId, t - 8 * UN_DIA, t - UN_DIA).map((f) => [f.canal_id, f.n]),
  );

  for (const canal of listarCanales(orgId)) {
    if (canal.activo !== 1 || canal.estado !== "conectado") continue;

    // Un canal recién conectado no tiene historia con la que compararse.
    if (t - canal.created_at < UN_DIA) continue;

    const hoy = deHoy.get(canal.id) ?? 0;
    const promedio = (deLaSemana.get(canal.id) ?? 0) / 7;

    // 6. Canal conectado y cero leads en 24 h. Casi siempre es el webhook.
    if (hoy === 0) {
      crearAnomalia(orgId, {
        canalId: canal.id,
        tipo: "canal_mudo",
        severidad: "alta",
        detalle:
          `${canal.nombre} no ha recibido ningún mensaje en 24 horas. ` +
          "Revisa que la recepción siga configurada.",
      });
      resumen.canales_mudos++;
      continue;
    }

    // 5. Muy por debajo de lo suyo. Solo si el promedio da para comparar:
    //    con dos leads al día, una caída a uno no significa nada.
    if (promedio >= 3 && hoy < promedio * 0.5) {
      crearAnomalia(orgId, {
        canalId: canal.id,
        tipo: "canal_bajo",
        severidad: "alta",
        detalle:
          `${canal.nombre} lleva ${hoy} leads hoy, contra ${promedio.toFixed(1)} de promedio diario ` +
          "en la semana.",
      });
      resumen.canales_bajos++;
    }
  }

  return resumen;
}

/** Atajo para revisar un hilo sin tener los mensajes ya cargados. */
export function revisarConversacionPorId(orgId: number, conv: Conversacion): void {
  revisarConversacion(orgId, conv, listarMensajes(orgId, conv.id));
}
