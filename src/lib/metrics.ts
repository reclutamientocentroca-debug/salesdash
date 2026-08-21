/**
 * SalesDash — métricas.
 *
 * Aquí no hay SQL: las consultas viven en `db.ts`. Este módulo solo deriva
 * porcentajes, normaliza nombres de producto y decide el color del semáforo.
 */
import {
  conteoConIntervencionHumana,
  conteoPorEstado,
  leadsPorSuCuenta,
  metricasPorCanal,
  obtenerOrg,
  resumenVentas,
  serieDiaria,
  tiemposDeCierre,
  totalLeads,
  ventasParaRanking,
  type Rango,
} from "./db";

export type Semaforo = "verde" | "ambar" | "rojo";

/** Verde cumple la meta, ámbar hasta 5 puntos por debajo, rojo más abajo. */
export function semaforo(valor: number, meta: number): Semaforo {
  if (valor >= meta) return "verde";
  if (valor >= meta - 5) return "ambar";
  return "rojo";
}

/**
 * Minúsculas, sin tildes y sin espacios dobles.
 * Sin esto, "Camisa Manga Larga", "camisa manga  larga" y "Camisa manga
 * larga " son tres productos distintos y el ranking se parte en pedazos.
 */
export function normalizarProducto(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas de acento que deja NFD
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Se agrupa por la clave normalizada, pero se MUESTRA el nombre original.
 * Normalizar es para juntar "Camisa" con "camisa "; enseñar la clave sería
 * escribir "Pantalon" sin tilde en el panel de un cliente hispanohablante.
 */
function presentar(original: string): string {
  const limpio = original.replace(/\s+/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

const porcentaje = (parte: number, total: number) =>
  total === 0 ? 0 : Math.round((parte / total) * 1000) / 10;

export interface Metricas {
  leads: number;
  cierres_ia: number;
  cierres_humano: number;
  sin_cerrar: number;
  revision: number;
  /** leads === cierres_ia + cierres_humano + sin_cerrar + revision */
  cuadra: boolean;

  ventas_generadas: number;
  valor_promedio_venta: number;
  tasa_cierre_ia: number;
  tasa_cierre_total: number;

  /** Segundos. Excluye las conversaciones abiertas, o unas pocas viejas lo distorsionan todo. */
  tiempo_promedio_ia: number | null;
  tiempo_promedio_humano: number | null;

  escribieron_por_su_cuenta: number;

  cobertura_ia: { valor: number; meta: number; estado: Semaforo };
  efectividad_humana: { valor: number; meta: number; estado: Semaforo };

  top_productos: { producto: string; unidades: number; monto: number }[];
  por_canal: {
    canal_id: number; nombre: string; phone: string | null;
    leads: number; cierres_ia: number; cierres_humano: number;
    revision: number; ventas: number; tasa: number;
  }[];
  serie_diaria: { dia: string; leads: number; cierres_ia: number; cierres_humano: number }[];
}

export function calcularMetricas(orgId: number, rango: Rango): Metricas {
  const org = obtenerOrg(orgId);
  const metaCobertura = org?.meta_cobertura ?? 90;
  const metaEfectividad = org?.meta_efectividad ?? 80;

  const leads = totalLeads(orgId, rango);
  const estados = conteoPorEstado(orgId, rango);
  const ventas = resumenVentas(orgId, rango);
  const tiempos = tiemposDeCierre(orgId, rango);

  const cierresTotales = estados.ia + estados.humano;

  // ── Top de productos ──────────────────────────────────────────────────────
  // Se agrupa por el nombre normalizado, no por el que devolvió el modelo.
  const acumulado = new Map<string, { unidades: number; monto: number; original: string }>();
  for (const v of ventasParaRanking(orgId, rango)) {
    const clave = normalizarProducto(v.producto_vendido);
    if (!clave) continue;
    const actual = acumulado.get(clave) ?? { unidades: 0, monto: 0, original: v.producto_vendido };
    actual.unidades += 1;
    actual.monto += v.total ?? 0;
    acumulado.set(clave, actual);
  }

  const top_productos = [...acumulado.values()]
    .map((d) => ({ producto: presentar(d.original), unidades: d.unidades, monto: d.monto }))
    .sort((a, b) => b.unidades - a.unidades || b.monto - a.monto)
    .slice(0, 3);

  // ── Cobertura y efectividad ───────────────────────────────────────────────
  // Cobertura: de todo lo que se cerró, cuánto cerró la IA sola.
  const cobertura = porcentaje(estados.ia, cierresTotales);
  // Efectividad: de los hilos donde un vendedor llegó a escribir, cuántos
  // terminaron en venta. Mide al equipo, no a la IA.
  const conHumano = conteoConIntervencionHumana(orgId, rango);
  const efectividad = porcentaje(estados.humano, conHumano);

  return {
    leads,
    cierres_ia: estados.ia,
    cierres_humano: estados.humano,
    sin_cerrar: estados.abierta,
    revision: estados.revision,
    cuadra: leads === estados.ia + estados.humano + estados.abierta + estados.revision,

    ventas_generadas: Math.round(ventas.suma * 100) / 100,
    valor_promedio_venta:
      ventas.con_monto === 0 ? 0 : Math.round((ventas.suma / ventas.con_monto) * 100) / 100,
    tasa_cierre_ia: porcentaje(estados.ia, leads),
    tasa_cierre_total: porcentaje(cierresTotales, leads),

    tiempo_promedio_ia: tiempos.ia === null ? null : Math.round(tiempos.ia),
    tiempo_promedio_humano: tiempos.humano === null ? null : Math.round(tiempos.humano),

    escribieron_por_su_cuenta: leadsPorSuCuenta(orgId, rango),

    cobertura_ia: {
      valor: cobertura,
      meta: metaCobertura,
      estado: semaforo(cobertura, metaCobertura),
    },
    efectividad_humana: {
      valor: efectividad,
      meta: metaEfectividad,
      estado: semaforo(efectividad, metaEfectividad),
    },

    top_productos,
    por_canal: metricasPorCanal(orgId, rango).map((c) => ({
      canal_id: c.canal_id,
      nombre: c.nombre,
      phone: c.phone.startsWith("pendiente:") ? null : c.phone,
      leads: c.leads,
      cierres_ia: c.cierres_ia,
      cierres_humano: c.cierres_humano,
      revision: c.revision,
      ventas: Math.round(c.ventas * 100) / 100,
      tasa: porcentaje(c.cierres_ia + c.cierres_humano, c.leads),
    })),
    serie_diaria: serieDiaria(orgId, rango),
  };
}

/** "1 h 12 min", "45 min", "38 s". Para mostrar los tiempos de cierre. */
export function formatearDuracion(segundos: number | null): string {
  if (segundos === null) return "—";
  if (segundos < 60) return `${Math.round(segundos)} s`;

  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;

  const horas = Math.floor(min / 60);
  const resto = min % 60;
  if (horas < 24) return resto ? `${horas} h ${resto} min` : `${horas} h`;

  const dias = Math.floor(horas / 24);
  return `${dias} d ${horas % 24} h`;
}
