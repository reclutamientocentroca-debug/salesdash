/**
 * SalesDash — el recálculo del histórico de ventas.
 *
 * LA REGLA CAMBIÓ Y EL HISTÓRICO TIENE QUE CUMPLIRLA (la dueña, 2026-09-11):
 * «una venta que se cerró ayer y se facturó hoy aparece en el resumen de hoy.
 * Debe aparecer en el de ayer». La venta cuenta el día en que se CERRÓ:
 *
 *   - AUTOMATIZADA: el día del resumen de la IA.
 *   - ASISTIDA: sin resumen, el día de la primera foto de la factura.
 *
 * Arreglar el código solo arregla lo que se cierre a partir de ahora. Las
 * ventas ya guardadas seguían en el día de su factura, o partidas en dos: la
 * de la IA el día del resumen y una asistida, la misma, el día de la factura.
 * Esto las pone donde dice la regla, una vez, al arrancar:
 *
 *   1. Sella las ventas con resumen que estaban sin contar —el resumen escrito
 *      solo con «✅ PEDIDO REGISTRADO» no se reconocía—.
 *   2. A cada venta sellada le vuelve a calcular quién la cerró y cuándo, con
 *      lo que ya está en la base: el primer resumen, o la primera factura.
 *   3. Quita los DUPLICADOS: la factura que cayó en otro hilo del mismo cliente
 *      no es otra venta. La venta de la IA queda facturada, y ese hilo deja de
 *      contar. Ver `ventaQueConfirmaLaFactura`.
 *   4. Guarda las ventas por día ANTES y DESPUÉS, para que se vea qué movió.
 *
 * No llama a ningún modelo: todo sale de lo que ya está en la base. Una foto
 * que nunca se miró no se mira aquí —el histórico entero en visión sería una
 * factura—, así que la factura de una venta de la IA que nadie miró no se
 * apunta; las nuevas sí, al llegar (ver `apuntarFactura`).
 *
 * Una sola vez por cuenta: la fila de `recalculos` es la marca, y se escribe
 * en la misma transacción que los cambios. Dos procesos arrancando a la vez no
 * lo hacen dos veces, y un recálculo que falla a medias no deja nada a medias.
 */
import {
  conversacionesSelladas,
  db,
  deshacerVentaDuplicada,
  guardarRecalculo,
  husoDeLaCuenta,
  husosDeLosCanales,
  listarMensajes,
  marcarFacturada,
  obtenerOrg,
  obtenerRecalculo,
  orgsConVentas,
  reescribirCierre,
  type Conversacion,
  type EstadoCierre,
} from "./db";
import {
  MARCADOR_POR_DEFECTO,
  senalesDelHilo,
  sellarCierresPendientes,
  ventaQueConfirmaLaFactura,
} from "./cierre";
import { fechaISOEn } from "./rango";

/** La regla que aplica este recálculo. Otra regla, otra clave. */
export const CLAVE_RECALCULO = "fecha-de-cierre-2026-09-11";

export interface VentasDelDia {
  ia: number;
  humano: number;
}

export interface CambioDeVenta {
  id: number;
  cliente: string | null;
  /** Null si antes no contaba como venta. */
  antes: { quien: EstadoCierre; dia: string } | null;
  /** Null si deja de contar: era un duplicado. */
  despues: { quien: EstadoCierre; dia: string } | null;
  motivo: string;
}

export interface InformeRecalculo {
  clave: string;
  /** Ventas por día, «2026-09-10», en la hora del país de cada número. */
  antes: Record<string, VentasDelDia>;
  despues: Record<string, VentasDelDia>;
  resumen: {
    selladas_nuevas: number;
    movidas_de_dia: number;
    a_automatizada: number;
    a_asistida: number;
    duplicados: number;
    facturadas: number;
  };
  /** Cada venta que cambió. Con tope, para que el informe no pese megas. */
  cambios: CambioDeVenta[];
  cambios_sin_listar: number;
}

const TOPE_CAMBIOS = 300;

/** Las ventas de la cuenta por día, como las cuenta el panel. */
function ventasPorDia(orgId: number): Record<string, VentasDelDia> {
  const husos = husosDeLosCanales(orgId);
  const deLaCuenta = husoDeLaCuenta(orgId);
  const dias: Record<string, VentasDelDia> = {};
  for (const c of conversacionesSelladas(orgId)) {
    if (c.cerrado_por !== "ia" && c.cerrado_por !== "humano") continue;
    const dia = fechaISOEn(husos.get(c.canal_id) ?? deLaCuenta, c.fecha_cierre!);
    const d = (dias[dia] ??= { ia: 0, humano: 0 });
    d[c.cerrado_por]++;
  }
  return dias;
}

/** Lo que dice la regla de una venta sellada, con lo que hay en la base. */
function segunLaRegla(
  conv: Conversacion,
  marcador: string,
  orgId: number,
): { quien: EstadoCierre; senal: string | null; fecha: number; facturadaAt: number | null } {
  const mensajes = listarMensajes(orgId, conv.id);
  const { resumen, factura } = senalesDelHilo(mensajes, marcador);

  let quien = conv.cerrado_por;
  let senal = conv.senal_de_cierre;
  let fecha = conv.fecha_cierre!;

  if (senal === "correccion_manual" || quien === "revision") {
    // Quién la cerró lo firmó una persona, o está en duda: eso no se toca.
    // Solo la fecha, si el hilo tiene la señal de ese lado.
    if (quien === "ia" && resumen) fecha = resumen.created_at;
    else if (quien === "humano" && factura) fecha = factura.created_at;
    else if (quien === "revision") fecha = resumen?.created_at ?? factura?.created_at ?? fecha;
  } else if (resumen) {
    quien = "ia";
    senal = "resumen_ia";
    fecha = resumen.created_at;
  } else if (factura) {
    quien = "humano";
    senal = factura.categoria_imagen === "comprobante_pago" ? "imagen_comprobante" : "imagen_factura";
    fecha = factura.created_at;
  } else if (fecha === conv.last_message_at) {
    /*
     * Un cierre que decidió el modelo, sin resumen ni factura en el hilo. Se
     * sellaba con la hora del ÚLTIMO mensaje, que en una venta de ayer suele
     * ser una foto de hoy: se toma el último texto nuestro hasta ese momento.
     */
    const texto = mensajes.filter((m) => m.emisor !== "cliente" && m.tipo === "texto" && m.created_at <= fecha).pop();
    if (texto) fecha = texto.created_at;
  }

  const facturas = [conv.facturada_at, factura?.created_at ?? null].filter((f): f is number => f !== null);
  return { quien, senal, fecha, facturadaAt: facturas.length ? Math.min(...facturas) : null };
}

/**
 * Recalcula las ventas de una cuenta con la regla de la fecha de cierre.
 * Devuelve el informe, o null si ya se había hecho.
 */
export function recalcularVentas(orgId: number): InformeRecalculo | null {
  const tx = db.transaction((): InformeRecalculo | null => {
    if (obtenerRecalculo(orgId, CLAVE_RECALCULO)) return null;

    const husos = husosDeLosCanales(orgId);
    const deLaCuenta = husoDeLaCuenta(orgId);
    const dia = (c: { canal_id: number }, t: number) => fechaISOEn(husos.get(c.canal_id) ?? deLaCuenta, t);
    const marcador = obtenerOrg(orgId)?.marcador_cierre ?? MARCADOR_POR_DEFECTO;

    const antes = ventasPorDia(orgId);
    const resumen: InformeRecalculo["resumen"] = {
      selladas_nuevas: 0, movidas_de_dia: 0, a_automatizada: 0, a_asistida: 0, duplicados: 0, facturadas: 0,
    };
    const cambios: CambioDeVenta[] = [];
    let sinListar = 0;
    const apuntar = (c: CambioDeVenta) => {
      if (cambios.length < TOPE_CAMBIOS) cambios.push(c);
      else sinListar++;
    };

    // Cómo estaba cada venta ANTES de tocar nada: el paso 1 ya puede moverlas.
    const previas = new Map(conversacionesSelladas(orgId).map((c) => [c.id, c]));

    // 1. Las que tenían resumen y nadie había contado.
    sellarCierresPendientes(orgId);
    resumen.selladas_nuevas = conversacionesSelladas(orgId).filter((c) => !previas.has(c.id)).length;

    // 2. Cada venta, donde dice la regla.
    for (const conv of conversacionesSelladas(orgId)) {
      const nueva = segunLaRegla(conv, marcador, orgId);
      const cambiaAlgo =
        nueva.quien !== conv.cerrado_por || nueva.senal !== conv.senal_de_cierre ||
        nueva.fecha !== conv.fecha_cierre || nueva.facturadaAt !== conv.facturada_at;
      if (cambiaAlgo) {
        reescribirCierre(orgId, conv.id, {
          cerradoPor: nueva.quien, senal: nueva.senal, fechaCierre: nueva.fecha, facturadaAt: nueva.facturadaAt,
        });
      }

      // Lo que se cuenta es contra cómo estaba al empezar, no contra el paso 1.
      const previa = previas.get(conv.id);
      const eraVenta = previa && (previa.cerrado_por === "ia" || previa.cerrado_por === "humano");
      if (nueva.facturadaAt !== null && (previa?.facturada_at ?? null) === null) resumen.facturadas++;

      const antesQuien = previa?.cerrado_por ?? "abierta";
      const antesDia = previa ? dia(previa, previa.fecha_cierre!) : null;
      const cambiaQuien = nueva.quien !== antesQuien;
      const cambiaDia = antesDia !== null && antesDia !== dia(conv, nueva.fecha);
      if (!cambiaQuien && !cambiaDia) continue;

      if (cambiaDia) resumen.movidas_de_dia++;
      if (cambiaQuien && nueva.quien === "ia") resumen.a_automatizada++;
      if (cambiaQuien && nueva.quien === "humano") resumen.a_asistida++;
      apuntar({
        id: conv.id,
        cliente: conv.cliente_nombre,
        antes: previa && antesDia !== null ? { quien: antesQuien, dia: antesDia } : null,
        despues: { quien: nueva.quien, dia: dia(conv, nueva.fecha) },
        motivo: !previa
          ? "tenía resumen de la IA y no se había contado"
          : nueva.quien === "ia" && eraVenta
            ? "cuenta el día del resumen de la IA, no el de la factura"
            : nueva.quien === "ia"
              ? "tenía resumen de la IA"
              : nueva.quien === "humano" && cambiaQuien
                ? "no hubo resumen de la IA: cuenta el día de la primera factura"
                : "cuenta el día en que se cerró",
      });
    }

    // 3. La factura que cayó en otro hilo del mismo cliente no es otra venta.
    for (const conv of conversacionesSelladas(orgId)) {
      if (conv.cerrado_por !== "humano") continue;
      if (conv.senal_de_cierre !== "imagen_factura" && conv.senal_de_cierre !== "imagen_comprobante") continue;

      const venta = ventaQueConfirmaLaFactura(orgId, conv, conv.fecha_cierre!, marcador);
      if (!venta) continue;

      if (marcarFacturada(orgId, venta.id, conv.fecha_cierre!)) resumen.facturadas++;
      if (
        deshacerVentaDuplicada(
          orgId,
          conv.id,
          `Era la factura de la venta que la IA cerró en el chat #${venta.id}: esa venta queda facturada y no se cuenta dos veces.`,
        )
      ) {
        resumen.duplicados++;
        apuntar({
          id: conv.id,
          cliente: conv.cliente_nombre,
          antes: { quien: "humano", dia: dia(conv, conv.fecha_cierre!) },
          despues: null,
          motivo: `duplicada: era la factura de la venta #${venta.id}, que la IA cerró el ${dia(venta, venta.fecha_cierre!)}`,
        });
      }
    }

    const informe: InformeRecalculo = {
      clave: CLAVE_RECALCULO,
      antes,
      despues: ventasPorDia(orgId),
      resumen,
      cambios,
      cambios_sin_listar: sinListar,
    };
    guardarRecalculo(orgId, CLAVE_RECALCULO, JSON.stringify(informe));
    return informe;
  });

  return tx.immediate();
}

/** El informe guardado de una cuenta, si ya se hizo. */
export function informeDeRecalculo(orgId: number): (InformeRecalculo & { creado_at: number }) | null {
  const fila = obtenerRecalculo(orgId, CLAVE_RECALCULO);
  if (!fila) return null;
  try {
    return { ...(JSON.parse(fila.informe) as InformeRecalculo), creado_at: fila.creado_at };
  } catch {
    return null;
  }
}

/** Los días que cambiaron, del más reciente al más viejo. */
export function diasQueCambiaron(i: InformeRecalculo): { dia: string; antes: VentasDelDia; despues: VentasDelDia }[] {
  const cero = { ia: 0, humano: 0 };
  return [...new Set([...Object.keys(i.antes), ...Object.keys(i.despues)])]
    .map((dia) => ({ dia, antes: i.antes[dia] ?? cero, despues: i.despues[dia] ?? cero }))
    .filter((d) => d.antes.ia !== d.despues.ia || d.antes.humano !== d.despues.humano)
    .sort((a, b) => b.dia.localeCompare(a.dia));
}

/**
 * El arranque: cada cuenta que no tenga el recálculo, lo hace. Cuando ya está
 * hecho no cuesta más que una consulta por cuenta. Devuelve los informes
 * nuevos para dejarlos en el registro.
 */
export function recalcularVentasPendientes(): { orgId: number; informe: InformeRecalculo }[] {
  const hechos: { orgId: number; informe: InformeRecalculo }[] = [];
  for (const orgId of orgsConVentas()) {
    try {
      const informe = recalcularVentas(orgId);
      if (informe) hechos.push({ orgId, informe });
    } catch (e) {
      // Una cuenta que falla no se lleva a las demás; lo intenta el siguiente arranque.
      console.error(`[recalculo] no se pudo recalcular la cuenta ${orgId}`, e);
    }
  }
  return hechos;
}
