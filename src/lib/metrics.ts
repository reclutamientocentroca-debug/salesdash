/**
 * SalesDash — métricas.
 *
 * Aquí no hay SQL: las consultas viven en `db.ts`. Este módulo solo deriva
 * porcentajes, normaliza nombres de producto y decide el color del semáforo.
 */
import {
  conteoConIntervencionHumana,
  conteoPorEstado,
  resumenDeAnuncio,
  leadsPorSuCuenta,
  productosDeAnuncio,
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

/** Dos decimales. El dinero no se enseña con la coma corrida de un float. */
const redondear = (n: number) => Math.round(n * 100) / 100;

const porcentaje = (parte: number, total: number) =>
  total === 0 ? 0 : Math.round((parte / total) * 1000) / 10;

export interface Metricas {
  /** Toda conversación abierta en el rango. Es la base de la invariante. */
  leads: number;
  /** Los que llegaron por un anuncio: los que miden si la publicidad funciona. */
  leads_anuncio: number;
  /** De esos, cuántos acabaron cerrados. Numerador y denominador del MISMO grupo. */
  cierres_anuncio: number;
  /** Porcentaje de los leads de anuncio que se cerró. Nunca pasa de 100. */
  tasa_cierre_anuncio: number;
  /** Qué producto anunciado los trajo, y qué prometía ese anuncio. */
  productos_anuncio: { producto: string; descripcion: string | null; leads: number; cerrados: number }[];
  cierres_ia: number;
  cierres_humano: number;
  sin_cerrar: number;
  revision: number;
  /** leads === cierres_ia + cierres_humano + sin_cerrar + revision */
  cuadra: boolean;

  /**
   * Lo facturado: el dinero de los pedidos cerrados, SIN el envío. El envío se
   * le cobra al cliente y se le paga al mensajero; no es facturación.
   */
  facturado: number;
  /** De eso, lo que cerró la IA sola. Es lo que la IA le hizo ganar al negocio. */
  facturado_ia: number;
  facturado_humano: number;
  /** Lo cobrado por envíos, aparte. Se enseña para que el total siga cuadrando. */
  envios_cobrados: number;
  /** Facturación media por venta con monto. También sin envío. */
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
    leads: number; leads_anuncio: number; cierres_ia: number; cierres_humano: number;
    sin_cerrar: number; revision: number; ventas: number; tasa: number;
  }[];
  serie_diaria: {
    dia: string; leads: number; leads_anuncio: number;
    cierres_ia: number; cierres_humano: number;
  }[];
}

export function calcularMetricas(orgId: number, rango: Rango): Metricas {
  const org = obtenerOrg(orgId);
  // 90 y 85 son las metas del negocio: la IA cierra 9 de cada 10, y de los
  // hilos que toca un vendedor tienen que acabar en venta 85 de cada 100. El
  // `??` solo actúa si la organización no existe; cada una guarda las suyas y
  // puede cambiarlas desde Configuración.
  const metaCobertura = org?.meta_cobertura ?? 90;
  const metaEfectividad = org?.meta_efectividad ?? 85;

  const leads = totalLeads(orgId, rango);
  const estados = conteoPorEstado(orgId, rango);
  const ventas = resumenVentas(orgId, rango);
  const tiempos = tiemposDeCierre(orgId, rango);
  const anuncio = resumenDeAnuncio(orgId, rango);

  const cierresTotales = estados.ia + estados.humano;

  // ── Top de productos ──────────────────────────────────────────────────────
  // Se agrupa por el nombre normalizado, no por el que devolvió el modelo.
  const acumulado = new Map<string, { unidades: number; monto: number; original: string }>();
  for (const v of ventasParaRanking(orgId, rango)) {
    const clave = normalizarProducto(v.producto_vendido);
    if (!clave) continue;
    const actual = acumulado.get(clave) ?? { unidades: 0, monto: 0, original: v.producto_vendido };
    actual.unidades += 1;
    actual.monto += v.facturado;
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
    leads_anuncio: anuncio.leads,
    cierres_anuncio: anuncio.cerrados,
    tasa_cierre_anuncio: porcentaje(anuncio.cerrados, anuncio.leads),
    /*
     * Un anuncio sin título tiene que llamarse de alguna forma en la tabla: la
     * fila existe igual, con sus leads y su tasa, y dejarla en blanco parecería
     * un fallo del panel. El texto del anuncio, que es lo que de verdad dice
     * qué se prometió, sigue en su columna.
     */
    productos_anuncio: productosDeAnuncio(orgId, rango).map((p) => ({
      ...p,
      producto: p.producto ?? "Anuncio sin título",
    })),
    cierres_ia: estados.ia,
    cierres_humano: estados.humano,
    sin_cerrar: estados.abierta,
    revision: estados.revision,
    cuadra: leads === estados.ia + estados.humano + estados.abierta + estados.revision,

    facturado: redondear(ventas.facturado),
    facturado_ia: redondear(ventas.facturado_ia),
    facturado_humano: redondear(ventas.facturado_humano),
    envios_cobrados: redondear(ventas.envios),
    valor_promedio_venta:
      ventas.con_monto === 0 ? 0 : redondear(ventas.facturado / ventas.con_monto),
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
      leads_anuncio: c.leads_anuncio,
      cierres_ia: c.cierres_ia,
      cierres_humano: c.cierres_humano,
      sin_cerrar: c.sin_cerrar,
      revision: c.revision,
      ventas: Math.round(c.ventas * 100) / 100,
      tasa: porcentaje(c.cierres_ia + c.cierres_humano, c.leads),
    })),
    serie_diaria: rellenarDias(serieDiaria(orgId, rango), rango),
  };
}

/**
 * Rellena con ceros los días sin actividad.
 *
 * `serieDiaria` solo devuelve los días que tuvieron conversaciones, así que un
 * martes en cero simplemente no existe y el gráfico une el lunes con el
 * miércoles: la caída desaparece justo cuando es lo más importante que ver.
 *
 * Además, un panel recién estrenado pasa de no tener gráfico a tener uno
 * plano en cero, que enseña la forma de lo que vendrá.
 */
export function rellenarDias(
  serie: {
    dia: string; leads: number; leads_anuncio: number;
    cierres_ia: number; cierres_humano: number;
  }[],
  rango: { desde: number; hasta: number },
  maxDias = 92,
): typeof serie {
  const aISO = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10);

  // Con "Todo" el rango empieza en 1970: se ancla al primer día con datos para
  // no generar veinte mil columnas vacías.
  const primero = serie[0]?.dia;
  let desdeISO = aISO(rango.desde);
  if (rango.desde === 0) desdeISO = primero ?? aISO(rango.hasta);

  /*
   * El rango se calcula en hora local y termina a las 23:59 del día de hoy;
   * los días de la serie los agrupa SQLite en UTC. Al oeste de Greenwich esas
   * 23:59 locales ya son el día siguiente en UTC, así que sin recortar el
   * gráfico dibuja un día de más — mañana, siempre en cero.
   */
  const hoyISO = aISO(Math.floor(Date.now() / 1000));
  const finISO = aISO(rango.hasta);
  const hastaISO = finISO > hoyISO ? hoyISO : finISO;
  const dias = Math.round(
    (Date.parse(`${hastaISO}T00:00:00Z`) - Date.parse(`${desdeISO}T00:00:00Z`)) / 86_400_000,
  );

  // Rangos muy largos se dejan como están: rellenarlos no aporta y sí satura.
  if (!Number.isFinite(dias) || dias < 0 || dias > maxDias) return serie;

  const porDia = new Map(serie.map((p) => [p.dia, p]));
  const completa: typeof serie = [];

  for (let i = 0; i <= dias; i++) {
    const dia = new Date(Date.parse(`${desdeISO}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    completa.push(
      porDia.get(dia) ?? { dia, leads: 0, leads_anuncio: 0, cierres_ia: 0, cierres_humano: 0 },
    );
  }

  return completa;
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
