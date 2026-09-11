/**
 * SalesDash — métricas.
 *
 * Aquí no hay SQL: las consultas viven en `db.ts`. Este módulo solo deriva
 * porcentajes, normaliza nombres de producto y decide el color del semáforo.
 */
import {
  cierresConIntervencionHumana,
  conteoConIntervencionHumana,
  conteoPorEstado,
  resumenDeAnuncio,
  leadsPorSuCuenta,
  productosDeAnuncio,
  metricasPorCanal,
  obtenerOrg,
  serieDiaria,
  tiemposDeCierre,
  totalLeads,
  ventasParaRanking,
  type Rango,
} from "./db";
import { mismaMoneda, monedaDelPais, SIN_MONEDA, type Moneda } from "./moneda";
import { fechaISOEn, husoDelServidor } from "./rango";
import { obtenerPais } from "./paises";

/**
 * Quién contesta en un número, en dos palabras: lo que se lee debajo del
 * nombre en «Rendimiento por número».
 */
export function modoDelCanal(c: { tipo: string; agente_activo: number; contesta_ia: number }): string {
  if (c.tipo === "meta") return c.agente_activo ? "Messenger · IA" : "Messenger";
  if (c.contesta_ia) return "solo vigila";
  return c.agente_activo ? "IA" : "IA apagada";
}

/**
 * Lo facturado en UNA moneda. Con números en tres países hay tres de estas, y
 * no se suman entre sí: RD$2,750 más ₡23.500 más US$45 no son nada.
 */
export interface FacturadoPorMoneda {
  moneda: Moneda;
  /** El país que factura en esta moneda, con su nombre, o null si no tiene. */
  pais_nombre: string | null;
  /** Cuántos números venden en esta moneda. */
  canales: number;
  /** Ventas cerradas sin monto: cuentan como pedido y facturan cero. */
  sin_monto: number;
  /** Ventas cerradas en el periodo en esta moneda. */
  cierres: number;
  facturado: number;
  facturado_ia: number;
  facturado_humano: number;
  envios: number;
  con_monto: number;
  /** Facturación media por venta con monto, sin el envío. */
  promedio: number;
}

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
  /** De los cerrados por anuncio, los que cerró un resumen y los que cerró una factura. */
  cierres_anuncio_ia: number;
  cierres_anuncio_humano: number;
  /** Porcentaje de los leads de anuncio que se cerró. Nunca pasa de 100. */
  tasa_cierre_anuncio: number;
  /** Qué producto anunciado los trajo, y qué prometía ese anuncio. */
  productos_anuncio: { producto: string; descripcion: string | null; leads: number; cerrados: number }[];
  /** Cerradas por un RESUMEN de pedido. Automatizadas, salga de donde salga. */
  cierres_ia: number;
  /** Cerradas por una FOTO de factura sin resumen en el hilo. Asistidas. */
  cierres_humano: number;
  /**
   * LAS FACTURAS ENVIADAS EN EL PERIODO, que no son las ventas del periodo: la
   * venta cuenta el día en que se cerró y la factura puede llegar después. De
   * ellas, `facturas_de_antes` son de ventas cerradas antes del periodo, y así
   * se dice en pantalla.
   */
  facturas_enviadas: number;
  facturas_de_antes: number;
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
  /**
   * La moneda de la cuenta cuando todos sus números venden en la misma, o
   * null cuando hay varias: ahí `facturado` y compañía son una suma sin
   * moneda y el panel enseña `facturado_por_moneda` en su lugar.
   */
  una_moneda: Moneda | null;
  /** Lo facturado del periodo, una fila por moneda y de mayor a menor. */
  facturado_por_moneda: FacturadoPorMoneda[];
  /**
   * Lo facturado en el periodo, canal por canal y de mayor a menor.
   *
   * Salen TODOS los canales conectados de la cuenta, también los que no
   * facturaron nada: un canal en cero es información —está conectado y no está
   * vendiendo—, y esconderlo hace que la tarjeta parezca decir que no existe.
   *
   * La suma de esta lista es exactamente `facturado`: las dos cifras salen del
   * mismo filtro de periodo y de la misma resta del envío.
   */
  facturado_por_canal: { canal_id: number; nombre: string; facturado: number; moneda: Moneda }[];
  /**
   * El panel de cada número. Los leads son los que le escribieron en el
   * periodo; los cierres y las ventas, lo que cerró en el periodo, contado en
   * la hora de su país y en su moneda.
   */
  por_canal: {
    canal_id: number; nombre: string; phone: string | null;
    /** Código ISO del país en el que vende, o vacío. */
    pais: string;
    /** El país con su nombre, o null si el número no tiene uno. */
    pais_nombre: string | null;
    /** «IA», «solo vigila», «Messenger · IA»… Ver `modoDelCanal`. */
    modo: string;
    /** 'whatsapp' o 'meta'. */
    tipo: string;
    /** El estado de la conexión: «conectado», «desconectado», «iniciando». */
    estado: string;
    /** Si el número llegó a escanearse (o la página a conectarse). */
    vinculado: boolean;
    /** Ventas cerradas sin monto: cuentan y facturan cero. */
    sin_monto: number;
    moneda: Moneda;
    leads: number; leads_anuncio: number; cierres_ia: number; cierres_humano: number;
    facturas: number; facturas_de_antes: number;
    sin_cerrar: number; revision: number;
    ventas: number; ventas_ia: number; ventas_humano: number; envios: number;
    tasa: number;
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
  const tiempos = tiemposDeCierre(orgId, rango);
  const anuncio = resumenDeAnuncio(orgId, rango);

  /*
   * LAS VENTAS SE CUENTAN NÚMERO POR NÚMERO, y la cuenta entera es la suma.
   *
   * Cada número cuenta sus cierres el día que se cerraron y en la hora de su
   * país, y factura en su moneda. Las cifras de la cuenta —cierres, dinero—
   * salen de sumar esas filas, y no de otra consulta con otro reloj: así la
   * tarjeta de arriba y el pie de la tabla dicen lo mismo, siempre.
   *
   * `estados` sigue siendo la cuenta por llegada: de ahí salen los abiertos,
   * la revisión y la invariante de que ninguna conversación se pierde.
   */
  const canales = metricasPorCanal(orgId, rango).map((c) => ({ ...c, moneda: monedaDelPais(c.pais) }));
  const sumar = (campo: "cierres_ia" | "cierres_humano" | "ventas" | "ventas_ia" | "ventas_humano" | "envios" | "con_monto") =>
    canales.reduce((a, c) => a + c[campo], 0);
  const cierres = { ia: sumar("cierres_ia"), humano: sumar("cierres_humano") };
  const ventas = {
    facturado: sumar("ventas"),
    facturado_ia: sumar("ventas_ia"),
    facturado_humano: sumar("ventas_humano"),
    envios: sumar("envios"),
    con_monto: sumar("con_monto"),
  };
  const cierresTotales = cierres.ia + cierres.humano;

  // ── Lo facturado, moneda por moneda ───────────────────────────────────────
  const porMoneda = new Map<string, FacturadoPorMoneda>();
  for (const c of canales) {
    const f = porMoneda.get(c.moneda.codigo) ?? {
      moneda: c.moneda, pais_nombre: obtenerPais(c.pais)?.nombre ?? null, canales: 0, cierres: 0,
      sin_monto: 0, facturado: 0, facturado_ia: 0, facturado_humano: 0, envios: 0, con_monto: 0, promedio: 0,
    };
    f.canales += 1;
    f.cierres += c.cierres_ia + c.cierres_humano;
    f.sin_monto += Math.max(c.cierres_ia + c.cierres_humano - c.con_monto, 0);
    f.facturado += c.ventas;
    f.facturado_ia += c.ventas_ia;
    f.facturado_humano += c.ventas_humano;
    f.envios += c.envios;
    f.con_monto += c.con_monto;
    porMoneda.set(c.moneda.codigo, f);
  }
  const facturado_por_moneda = [...porMoneda.values()]
    .map((f) => ({
      ...f,
      facturado: redondear(f.facturado),
      facturado_ia: redondear(f.facturado_ia),
      facturado_humano: redondear(f.facturado_humano),
      envios: redondear(f.envios),
      promedio: f.con_monto === 0 ? 0 : redondear(f.facturado / f.con_monto),
    }))
    .sort((a, b) => b.cierres - a.cierres || b.facturado - a.facturado || a.moneda.codigo.localeCompare(b.moneda.codigo));
  const una_moneda =
    canales.length === 0
      ? SIN_MONEDA
      : canales.every((c) => mismaMoneda(c.moneda, canales[0].moneda))
        ? canales[0].moneda
        : null;

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
  /*
   * Cobertura: de todo lo que se cerró, cuánto lo cerró un resumen de pedido.
   * `estados.ia` es exactamente eso —el resumen es automatizado siempre, sin
   * mirar por qué teclado salió—, y lo asistido es lo que cerró una foto de
   * factura sin resumen en el hilo.
   */
  const cobertura = porcentaje(cierres.ia, cierresTotales);

  /*
   * Efectividad: de los hilos donde un vendedor llegó a escribir, cuántos
   * terminaron en VENTA. Mide al equipo, no a la IA, y por eso el numerador son
   * los cierres de esos mismos hilos —los cerrara quien los cerrara—, no los
   * `cerrado_por = 'humano'`.
   *
   * Con el numerador puesto en los cierres asistidos, el vendedor que desatasca
   * la venta y deja que el resumen la cierre no contaba: su hilo sumaba al
   * denominador y no al numerador. Cada vez que el equipo hacía bien su trabajo,
   * su propia métrica bajaba.
   */
  const conHumano = conteoConIntervencionHumana(orgId, rango);
  const efectividad = porcentaje(cierresConIntervencionHumana(orgId, rango), conHumano);

  return {
    leads,
    // Sin ningún lead de anuncio, SQLite suma NULL y no cero: se coalesce aquí.
    leads_anuncio: anuncio.leads ?? 0,
    cierres_anuncio: anuncio.cerrados ?? 0,
    cierres_anuncio_ia: anuncio.cierres_ia ?? 0,
    cierres_anuncio_humano: anuncio.cierres_humano ?? 0,
    tasa_cierre_anuncio: porcentaje(anuncio.cerrados ?? 0, anuncio.leads ?? 0),
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
    cierres_ia: cierres.ia,
    cierres_humano: cierres.humano,
    facturas_enviadas: canales.reduce((a, c) => a + c.facturas, 0),
    facturas_de_antes: canales.reduce((a, c) => a + c.facturas_de_antes, 0),
    sin_cerrar: estados.abierta,
    revision: estados.revision,
    // La invariante es por llegada: cada conversación del periodo está en uno
    // y solo uno de los cuatro estados. Los cierres de arriba van por fecha de
    // cierre y no entran aquí: pueden ser de gente que llegó antes del periodo.
    cuadra: leads === estados.ia + estados.humano + estados.abierta + estados.revision,

    facturado: redondear(ventas.facturado),
    facturado_ia: redondear(ventas.facturado_ia),
    facturado_humano: redondear(ventas.facturado_humano),
    envios_cobrados: redondear(ventas.envios),
    valor_promedio_venta:
      ventas.con_monto === 0 ? 0 : redondear(ventas.facturado / ventas.con_monto),
    tasa_cierre_ia: porcentaje(cierres.ia, leads),
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
    una_moneda,
    facturado_por_moneda,
    facturado_por_canal: canales
      .map((c) => ({ canal_id: c.canal_id, nombre: c.nombre, facturado: redondear(c.ventas), moneda: c.moneda }))
      // De mayor a menor, y con el nombre como desempate para que dos canales
      // en cero no se intercambien de sitio entre una recarga y la siguiente.
      .sort((a, b) => b.facturado - a.facturado || a.nombre.localeCompare(b.nombre)),
    por_canal: canales.map((c) => ({
      canal_id: c.canal_id,
      nombre: c.nombre,
      phone: c.phone.startsWith("pendiente:") ? null : c.phone,
      pais: c.pais,
      pais_nombre: obtenerPais(c.pais)?.nombre ?? null,
      modo: modoDelCanal(c),
      tipo: c.tipo,
      estado: c.estado,
      vinculado: !c.phone.startsWith("pendiente:"),
      sin_monto: Math.max(c.cierres_ia + c.cierres_humano - c.con_monto, 0),
      moneda: c.moneda,
      leads: c.leads,
      leads_anuncio: c.leads_anuncio,
      cierres_ia: c.cierres_ia,
      cierres_humano: c.cierres_humano,
      facturas: c.facturas,
      facturas_de_antes: c.facturas_de_antes,
      sin_cerrar: c.sin_cerrar,
      revision: c.revision,
      ventas: redondear(c.ventas),
      ventas_ia: redondear(c.ventas_ia),
      ventas_humano: redondear(c.ventas_humano),
      envios: redondear(c.envios),
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
  rango: { desde: number; hasta: number; huso?: string },
  maxDias = 92,
): typeof serie {
  // El mismo huso con el que `serieDiaria` cortó los días: si no, el relleno
  // y los datos hablarían de días distintos.
  const huso = rango.huso ?? husoDelServidor();
  const aISO = (epoch: number) => fechaISOEn(huso, epoch);

  // Con "Todo" el rango empieza en 1970: se ancla al primer día con datos para
  // no generar veinte mil columnas vacías.
  const primero = serie[0]?.dia;
  let desdeISO = aISO(rango.desde);
  if (rango.desde === 0) desdeISO = primero ?? aISO(rango.hasta);

  // Nunca más allá de hoy: un rango que termina a las 23:59 no dibuja mañana.
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
