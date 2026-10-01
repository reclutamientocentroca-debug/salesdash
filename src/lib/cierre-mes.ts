/**
 * SalesDash — el cierre de mes: el informe corporativo del dashboard.
 *
 * Es el dashboard en un documento para llevar a una reunión: cifras reales del
 * periodo, círculos de medición de lo automatizado y de lo asistido, gráficos,
 * una lectura de si los vendedores interrumpen a la IA, y un plan con lo que
 * falta para llegar a las metas. Todo sale de `calcularMetricas` y de las
 * consultas de `db.ts`: ni una cifra se escribe a mano, y los consejos son
 * reglas sobre esos mismos números (no hay un modelo que invente nada).
 *
 * ANTES DE DESCARGAR SE DEPURA (`depurar`). Un informe de cierre con un hilo
 * sin sellar o una intervención mal marcada reparte mal las ventas entre IA y
 * equipo, que es justo lo que este informe mide. La depuración es mecánica,
 * idempotente y no llama a ningún modelo; lo que no puede arreglar solo lo
 * dice en el propio documento.
 *
 * El archivo es un HTML de una pieza, sin nada que cargar de fuera: se abre en
 * cualquier navegador y se imprime a PDF (hay un botón).
 */
import { sellarCierresPendientes } from "./cierre";
import {
  cierresConIntervencionHumana,
  conteoConIntervencionHumana,
  depurarIntervenciones,
  incoherenciasDeCierre,
  interrupciones,
  obtenerOrg,
  type Interrupciones,
  type Rango,
} from "./db";
import { ESTILO, dinero, esc, fecha, porMoneda } from "./informe";
import { calcularMetricas, formatearDuracion, semaforo, type Metricas, type Semaforo } from "./metrics";
import { fechaISOEn, husoDelServidor } from "./rango";

const VERDE = "#12876a";
const AMBAR = "#d9930d";
const ROJO = "#c0392b";
const AZUL = "#3b6fd4";
const GRIS = "#dfe6e3";

const COLOR: Record<Semaforo, string> = { verde: VERDE, ambar: AMBAR, rojo: ROJO };

const pct1 = (parte: number, total: number) => (total === 0 ? 0 : Math.round((parte / total) * 1000) / 10);
const num = (n: number) => n.toLocaleString("es");
const pc = (n: number) => `${n.toLocaleString("es", { maximumFractionDigits: 1 })} %`;

// ─────────────────────────────────────────────────────────────────────────────
// La depuración
// ─────────────────────────────────────────────────────────────────────────────

export interface Depuracion {
  /** Hilos con un resumen de pedido que nadie había contado, ya sellados. */
  selladas: number;
  /** Hilos cuya marca de «intervino una persona» no cuadraba con los mensajes. */
  intervenciones_corregidas: number;
  asistidas_sin_vendedor: number;
  automatizadas_tras_vendedor: number;
  /** Lo que la depuración no puede arreglar sola y hay que mirar a mano. */
  avisos: string[];
}

/**
 * Pone en orden lo automatizado y lo asistido ANTES de calcular nada.
 *
 *  1. Sella los cierres que tienen resumen de la IA y no estaban contados.
 *  2. Vuelve a leer, hilo por hilo, si escribió una persona.
 *  3. Audita el reparto: ventas asistidas sin vendedor en el hilo, ventas de la
 *     IA tras un vendedor, ventas sin monto y conversaciones sin clasificar.
 */
export function depurar(orgId: number, rango: Rango): Depuracion {
  const selladas = sellarCierresPendientes(orgId);
  const intervenciones_corregidas = depurarIntervenciones(orgId, rango);
  const { asistidas_sin_vendedor, automatizadas_tras_vendedor } = incoherenciasDeCierre(orgId, rango);

  const m = calcularMetricas(orgId, rango);
  const avisos: string[] = [];
  if (!m.cuadra) {
    avisos.push("Los números no cuadran: hay conversaciones del periodo sin clasificar. Revisa la bandeja de revisión.");
  }
  if (m.revision > 0) {
    avisos.push(`${num(m.revision)} conversaciones están en revisión y no cuentan como venta ni como pérdida hasta que se clasifiquen.`);
  }
  const sinMonto = m.facturado_por_moneda.reduce((a, f) => a + f.sin_monto, 0);
  if (sinMonto > 0) {
    avisos.push(`${num(sinMonto)} ventas cerradas no tienen monto: cuentan como pedido y facturan cero.`);
  }
  if (asistidas_sin_vendedor > 0) {
    avisos.push(
      `${num(asistidas_sin_vendedor)} ventas figuran como asistidas y en el hilo no escribió ninguna persona: ` +
        "probablemente la factura llegó por otro canal o el número lo atiende otro bot.",
    );
  }
  return { selladas, intervenciones_corregidas, asistidas_sin_vendedor, automatizadas_tras_vendedor, avisos };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dibujos (SVG a mano: ni una librería, ni nada que cargar de fuera)
// ─────────────────────────────────────────────────────────────────────────────

/** Un círculo de medición: el valor en el aro, la meta como una marca. */
function rosca(opts: { valor: number; meta: number | null; titulo: string; pie: string; color: string }): string {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, opts.valor));
  let marca = "";
  if (opts.meta !== null) {
    const ang = (opts.meta / 100) * 2 * Math.PI - Math.PI / 2;
    const x1 = 70 + (r - 9) * Math.cos(ang), y1 = 70 + (r - 9) * Math.sin(ang);
    const x2 = 70 + (r + 9) * Math.cos(ang), y2 = 70 + (r + 9) * Math.sin(ang);
    marca = `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#0f1a17" stroke-width="3"/>`;
  }
  return `<figure class="rosca">
    <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="${esc(opts.titulo)}: ${esc(pc(opts.valor))}">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${GRIS}" stroke-width="14"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${opts.color}" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${((v / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 70 70)"/>
      ${marca}
      <text x="70" y="76" text-anchor="middle" font-size="22" font-weight="700" fill="#0f1a17">${esc(pc(opts.valor))}</text>
    </svg>
    <figcaption><strong>${esc(opts.titulo)}</strong><span>${esc(opts.pie)}</span></figcaption>
  </figure>`;
}

/** Un círculo partido en tramos (automatizada / asistida / sin cerrar). */
function roscaPartida(tramos: { valor: number; color: string }[], centro: string, titulo: string, pie: string): string {
  const r = 52;
  const c = 2 * Math.PI * r;
  const total = tramos.reduce((a, t) => a + t.valor, 0);
  let acumulado = 0;
  const arcos = total === 0
    ? ""
    : tramos
        .filter((t) => t.valor > 0)
        .map((t) => {
          const largo = (t.valor / total) * c;
          const arco = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${t.color}" stroke-width="14"
            stroke-dasharray="${largo.toFixed(1)} ${(c - largo).toFixed(1)}" stroke-dashoffset="${(-acumulado).toFixed(1)}"
            transform="rotate(-90 70 70)"/>`;
          acumulado += largo;
          return arco;
        })
        .join("");
  return `<figure class="rosca">
    <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="${esc(titulo)}">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${GRIS}" stroke-width="14"/>
      ${arcos}
      <text x="70" y="76" text-anchor="middle" font-size="22" font-weight="700" fill="#0f1a17">${esc(centro)}</text>
    </svg>
    <figcaption><strong>${esc(titulo)}</strong><span>${esc(pie)}</span></figcaption>
  </figure>`;
}

/** Barras día a día: conversaciones de fondo y ventas (automatizadas + asistidas) apiladas. */
function graficoDias(m: Metricas): string {
  const dias = m.serie_diaria;
  if (dias.length === 0) return `<p class="vacio">Sin días que dibujar.</p>`;
  const W = 920, H = 230, izq = 34, abajo = 28, arriba = 10;
  const alto = H - abajo - arriba;
  const maximo = Math.max(1, ...dias.map((d) => Math.max(d.leads, d.cierres_ia + d.cierres_humano)));
  const paso = (W - izq) / dias.length;
  const ancho = Math.max(2, Math.min(22, paso * 0.34));
  const cada = Math.ceil(dias.length / 12);
  const y = (v: number) => arriba + alto - (v / maximo) * alto;

  const barras = dias
    .map((d, i) => {
      const x = izq + i * paso + paso / 2;
      const ia = d.cierres_ia, hu = d.cierres_humano;
      const etiqueta = i % cada === 0 ? `<text x="${x.toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="#5a6b65">${esc(d.dia.slice(5))}</text>` : "";
      return `
        <rect x="${(x - ancho - 1).toFixed(1)}" y="${y(d.leads).toFixed(1)}" width="${ancho.toFixed(1)}" height="${(arriba + alto - y(d.leads)).toFixed(1)}" fill="${GRIS}"><title>${esc(d.dia)}: ${d.leads} conversaciones</title></rect>
        <rect x="${(x + 1).toFixed(1)}" y="${y(ia).toFixed(1)}" width="${ancho.toFixed(1)}" height="${(arriba + alto - y(ia)).toFixed(1)}" fill="${VERDE}"><title>${esc(d.dia)}: ${ia} automatizadas</title></rect>
        <rect x="${(x + 1).toFixed(1)}" y="${y(ia + hu).toFixed(1)}" width="${ancho.toFixed(1)}" height="${(y(ia) - y(ia + hu)).toFixed(1)}" fill="${AZUL}"><title>${esc(d.dia)}: ${hu} asistidas</title></rect>
        ${etiqueta}`;
    })
    .join("");

  const guias = [0, 0.5, 1]
    .map((f) => {
      const v = Math.round(maximo * f);
      return `<line x1="${izq}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#eef2f0"/>
        <text x="${izq - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#5a6b65">${v}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Conversaciones y ventas por día">${guias}${barras}</svg>
    <p class="leyenda"><i style="background:${GRIS}"></i>Conversaciones <i style="background:${VERDE}"></i>Automatizadas <i style="background:${AZUL}"></i>Asistidas</p>`;
}

/** Barras horizontales: una fila por elemento, con su valor escrito al lado. */
function barrasHorizontales(filas: { etiqueta: string; valor: number; texto: string; color?: string }[]): string {
  if (filas.length === 0) return `<p class="vacio">Sin datos en el periodo.</p>`;
  const maximo = Math.max(1, ...filas.map((f) => f.valor));
  return `<div class="barras">${filas
    .map(
      (f) => `<div class="barra"><span class="et">${esc(f.etiqueta)}</span>
        <span class="pista"><span style="width:${Math.max(1, (f.valor / maximo) * 100).toFixed(1)}%;background:${f.color ?? VERDE}"></span></span>
        <span class="val num">${esc(f.texto)}</span></div>`,
    )
    .join("")}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Si los vendedores interrumpen a la IA
// ─────────────────────────────────────────────────────────────────────────────

function sumarInterrupciones(filas: Interrupciones[]): Interrupciones {
  const cero: Interrupciones = {
    canal_id: 0, total: 0, ia_sola: 0, ia_sola_cerradas: 0, interrumpidas: 0, interrumpidas_cerradas: 0,
    ia_retomo: 0, vendedor_primero: 0, vendedor_primero_cerradas: 0, sin_respuesta: 0,
  };
  for (const f of filas) {
    for (const k of Object.keys(cero) as (keyof Interrupciones)[]) {
      if (k !== "canal_id") cero[k] += f[k];
    }
  }
  return cero;
}

/** Cuánto interrumpen, sobre lo que la IA llevó. Null si la IA no llevó nada. */
function tasaDeInterrupcion(i: Interrupciones): number | null {
  const conIa = i.ia_sola + i.interrumpidas;
  return conIa === 0 ? null : pct1(i.interrumpidas, conIa);
}

function veredictoIa(i: Interrupciones): { estado: Semaforo; texto: string } {
  const tasa = tasaDeInterrupcion(i);
  if (tasa === null) return { estado: "ambar", texto: "La IA no llevó ningún hilo en el periodo: no hay nada que medir." };
  const sola = pct1(i.ia_sola_cerradas, i.ia_sola);
  const inter = pct1(i.interrumpidas_cerradas, i.interrumpidas);
  if (tasa <= 15) {
    return { estado: "verde", texto: `La IA camina bien: solo ${pc(tasa)} de sus hilos los interrumpió un vendedor, y los que llevó sola cerraron ${pc(sola)}.` };
  }
  if (tasa <= 30) {
    return { estado: "ambar", texto: `Hay interrupciones: un vendedor entró en ${pc(tasa)} de los hilos que la IA llevaba. Los que la IA llevó sola cerraron ${pc(sola)} y los interrumpidos ${pc(inter)}.` };
  }
  return { estado: "rojo", texto: `Los vendedores interrumpen demasiado: entraron en ${pc(tasa)} de los hilos de la IA. Con la IA sola se cerró ${pc(sola)}; con interrupción, ${pc(inter)}.` };
}

function seccionInterrupciones(filas: Interrupciones[], nombres: Map<number, string>): string {
  const t = sumarInterrupciones(filas);
  const v = veredictoIa(t);
  const tasa = tasaDeInterrupcion(t);
  const conIa = t.ia_sola + t.interrumpidas;

  const circulos = [
    rosca({
      valor: tasa === null ? 0 : 100 - tasa,
      meta: 85,
      titulo: "IA sin interrupción",
      pie: conIa === 0 ? "sin hilos de IA" : `${num(t.ia_sola)} de ${num(conIa)} hilos de la IA`,
      color: COLOR[v.estado],
    }),
    rosca({
      valor: pct1(t.ia_sola_cerradas, t.ia_sola),
      meta: null,
      titulo: "Cierre con la IA sola",
      pie: `${num(t.ia_sola_cerradas)} de ${num(t.ia_sola)} hilos`,
      color: VERDE,
    }),
    rosca({
      valor: pct1(t.interrumpidas_cerradas, t.interrumpidas),
      meta: null,
      titulo: "Cierre tras interrumpir",
      pie: `${num(t.interrumpidas_cerradas)} de ${num(t.interrumpidas)} hilos`,
      color: AZUL,
    }),
  ].join("");

  const lineas = filas
    .map((f) => {
      const tf = tasaDeInterrupcion(f);
      const est = tf === null ? "—" : pc(tf);
      return `<tr>
        <td>${esc(nombres.get(f.canal_id) ?? `Número ${f.canal_id}`)}</td>
        <td class="num">${num(f.total)}</td>
        <td class="num">${num(f.ia_sola)} <span class="tenue">(${pc(pct1(f.ia_sola_cerradas, f.ia_sola))} cierran)</span></td>
        <td class="num">${num(f.interrumpidas)} <span class="tenue">(${pc(pct1(f.interrumpidas_cerradas, f.interrumpidas))} cierran)</span></td>
        <td class="num">${num(f.ia_retomo)}</td>
        <td class="num">${num(f.vendedor_primero)} <span class="tenue">(${pc(pct1(f.vendedor_primero_cerradas, f.vendedor_primero))} cierran)</span></td>
        <td class="num"><strong>${esc(est)}</strong></td>
      </tr>`;
    })
    .join("");

  return `
  <div class="veredicto ${v.estado}">${esc(v.texto)}</div>
  <div class="roscas">${circulos}</div>
  <p class="tenue">«Interrumpida» es un hilo donde la IA ya había contestado y después escribió un vendedor.
    «IA retomó» cuenta las interrumpidas en las que la IA volvió a contestar. «Vendedor primero» son los hilos que
    un vendedor contestó desde el primer mensaje, sin IA antes. Las conversaciones sin ninguna respuesta
    (${num(t.sin_respuesta)}) no entran en la comparación.</p>
  <table class="rejilla">
    <thead><tr><th>Número</th><th class="num">Conversaciones</th><th class="num">IA sola</th><th class="num">Interrumpidas</th><th class="num">IA retomó</th><th class="num">Vendedor primero</th><th class="num">Interrupción</th></tr></thead>
    <tbody>${lineas || `<tr><td colspan="7" class="vacio">Sin conversaciones.</td></tr>`}</tbody>
  </table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consejos: reglas sobre los números reales
// ─────────────────────────────────────────────────────────────────────────────

interface Consejo {
  tono: Semaforo;
  titulo: string;
  texto: string;
}

function consejos(
  m: Metricas,
  anterior: Metricas | null,
  inter: Interrupciones[],
  humano: { hilos: number; cerrados: number },
): Consejo[] {
  const out: Consejo[] = [];
  const cerradas = m.cierres_ia + m.cierres_humano;
  const t = sumarInterrupciones(inter);

  // — La meta de cobertura automatizada —
  const metaC = m.cobertura_ia.meta;
  if (cerradas > 0) {
    if (m.cobertura_ia.valor >= metaC) {
      out.push({
        tono: "verde",
        titulo: "Cobertura automatizada: meta cumplida",
        texto: `La IA cerró ${num(m.cierres_ia)} de ${num(cerradas)} ventas (${pc(m.cobertura_ia.valor)}; la meta es ${metaC} %). Para mantenerla, no dejes que los vendedores tomen hilos que la IA ya va cerrando bien.`,
      });
    } else {
      const faltan = Math.max(0, Math.ceil((metaC / 100) * cerradas) - m.cierres_ia);
      out.push({
        tono: m.cobertura_ia.estado,
        titulo: `Cobertura automatizada: faltan ${num(faltan)} ventas para la meta`,
        texto: `La IA cerró ${num(m.cierres_ia)} de ${num(cerradas)} ventas (${pc(m.cobertura_ia.valor)}) y la meta es ${metaC} %. Con las mismas ventas, ${num(faltan)} de las ${num(m.cierres_humano)} que cerró una persona tenían que haberlas cerrado la IA. Lee esos hilos: lo que se repite (una pregunta sin respuesta, un precio que no tenía, un envío) es lo que hay que enseñarle al agente.`,
      });
    }
  }

  // — La meta de efectividad asistida —
  const metaE = m.efectividad_humana.meta;
  if (humano.hilos > 0) {
    if (m.efectividad_humana.valor >= metaE) {
      out.push({
        tono: "verde",
        titulo: "Efectividad asistida: meta cumplida",
        texto: `De ${num(humano.hilos)} hilos que tocó un vendedor, ${num(humano.cerrados)} acabaron en venta (${pc(m.efectividad_humana.valor)}; meta ${metaE} %). Mantén ese ritmo.`,
      });
    } else {
      const faltan = Math.max(0, Math.ceil((metaE / 100) * humano.hilos) - humano.cerrados);
      out.push({
        tono: m.efectividad_humana.estado,
        titulo: `Efectividad asistida: faltan ${num(faltan)} ventas para la meta`,
        texto: `De ${num(humano.hilos)} hilos que tocó un vendedor, ${num(humano.cerrados)} acabaron en venta (${pc(m.efectividad_humana.valor)}) y la meta es ${metaE} %. Faltaron ${num(faltan)} ventas. Haz seguimiento el mismo día a los hilos en que un vendedor escribió y el cliente dejó de contestar.`,
      });
    }
  }

  // — Interrupciones —
  const tasaInt = tasaDeInterrupcion(t);
  if (tasaInt !== null && t.interrumpidas > 0) {
    const sola = pct1(t.ia_sola_cerradas, t.ia_sola);
    const conInt = pct1(t.interrumpidas_cerradas, t.interrumpidas);
    if (conInt < sola) {
      out.push({
        tono: tasaInt > 30 ? "rojo" : "ambar",
        titulo: "Los hilos interrumpidos cierran menos que los de la IA sola",
        texto: `Interrumpidos cierran ${pc(conInt)}; con la IA sola, ${pc(sola)}. Los vendedores entraron en ${num(t.interrumpidas)} hilos. Acuerden cuándo se interrumpe (pedido de descuento, queja, cliente enojado) y dejen el resto a la IA.`,
      });
    } else {
      out.push({
        tono: "verde",
        titulo: "Cuando el vendedor interrumpe, ayuda",
        texto: `Los hilos interrumpidos cierran ${pc(conInt)} contra ${pc(sola)} de la IA sola. Las ${num(t.interrumpidas)} interrupciones están rescatando ventas: revisa qué dijeron en ellas y pásaselo al agente como regla.`,
      });
    }
    if (t.interrumpidas > 0 && t.ia_retomo < t.interrumpidas / 2) {
      out.push({
        tono: "ambar",
        titulo: "La IA casi no retoma después de una interrupción",
        texto: `Solo en ${num(t.ia_retomo)} de ${num(t.interrumpidas)} hilos interrumpidos la IA volvió a contestar. Si el vendedor ya resolvió lo suyo, devuelve el hilo a la IA para que cierre y mande el resumen.`,
      });
    }
  }

  // — Conversaciones sin cerrar: la bolsa más grande de ventas —
  if (m.sin_cerrar > 0) {
    const unica = m.facturado_por_moneda.length === 1 ? m.facturado_por_moneda[0] : null;
    const recuperar = Math.max(1, Math.round(m.sin_cerrar * 0.2));
    const dinero1 = unica && unica.promedio > 0 ? `, unos ${dinero(recuperar * unica.promedio, unica.moneda)} con el promedio por pedido del periodo` : "";
    out.push({
      tono: pct1(m.sin_cerrar, m.leads) > 50 ? "rojo" : "ambar",
      titulo: `${num(m.sin_cerrar)} conversaciones quedaron sin cerrar (${pc(pct1(m.sin_cerrar, m.leads))})`,
      texto: `Si se recupera 1 de cada 5 son ${num(recuperar)} ventas más${dinero1}. Escribe de nuevo a quien quedó en «lo pienso» en las primeras 24 horas y manda el catálogo con precio.`,
    });
  }

  // — Anuncios —
  const conLeads = m.productos_anuncio.filter((p) => p.leads >= 5);
  if (conLeads.length > 0) {
    const tasa = (p: { leads: number; cerrados: number }) => pct1(p.cerrados, p.leads);
    const ordenados = [...conLeads].sort((a, b) => tasa(b) - tasa(a) || b.leads - a.leads);
    const mejor = ordenados[0]!;
    const peor = ordenados[ordenados.length - 1]!;
    out.push({
      tono: "verde",
      titulo: `Mejor anuncio: ${mejor.producto}`,
      texto: `${num(mejor.leads)} leads y ${num(mejor.cerrados)} ventas (${pc(tasa(mejor))}). Sube la inversión en ese y copia su texto en los demás.`,
    });
    if (ordenados.length > 1 && tasa(peor) < tasa(mejor)) {
      out.push({
        tono: peor.cerrados === 0 ? "rojo" : "ambar",
        titulo: `Anuncio a corregir: ${peor.producto}`,
        texto: `${num(peor.leads)} leads y ${num(peor.cerrados)} ventas (${pc(tasa(peor))}). ${peor.cerrados === 0 ? "Trae gente y no vende: revisa precio, foto y lo que promete el anuncio, o pausa el gasto." : "Revisa qué preguntan esos clientes y qué responde el agente."}`,
      });
    }
  }

  // — Números —
  const sinVida = m.por_canal.filter((c) => c.vinculado && c.estado === "conectado" && c.leads === 0);
  if (sinVida.length > 0) {
    out.push({
      tono: "ambar",
      titulo: "Números conectados sin conversaciones",
      texto: `${sinVida.map((c) => c.nombre).join(", ")}: conectado${sinVida.length === 1 ? "" : "s"} y sin una sola conversación en el periodo. Comprueba que el número recibe mensajes y que tiene anuncios apuntando a él.`,
    });
  }
  const comparables = m.por_canal.filter((c) => c.leads >= 10);
  if (comparables.length > 1) {
    const orden = [...comparables].sort((a, b) => b.tasa - a.tasa);
    const arriba = orden[0]!, abajo = orden[orden.length - 1]!;
    if (arriba.tasa - abajo.tasa >= 10) {
      out.push({
        tono: "ambar",
        titulo: `${abajo.nombre} cierra mucho menos que ${arriba.nombre}`,
        texto: `${pc(abajo.tasa)} contra ${pc(arriba.tasa)} de las conversaciones. Compara los guiones y el producto que vende cada uno: si el de arriba hace algo distinto, copiarlo es la mejora más barata.`,
      });
    }
  }

  // — Tendencia contra el periodo anterior —
  if (anterior && anterior.leads > 0) {
    const antes = anterior.cierres_ia + anterior.cierres_humano;
    const dLeads = Math.round(((m.leads - anterior.leads) / anterior.leads) * 1000) / 10;
    const dVentas = antes === 0 ? null : Math.round(((cerradas - antes) / antes) * 1000) / 10;
    out.push({
      tono: dVentas !== null && dVentas < 0 ? "ambar" : "verde",
      titulo: "Contra el periodo anterior",
      texto: `Conversaciones: ${dLeads >= 0 ? "+" : ""}${pc(dLeads)} (${num(anterior.leads)} → ${num(m.leads)}). Ventas: ${num(antes)} → ${num(cerradas)}${dVentas === null ? "" : ` (${dVentas >= 0 ? "+" : ""}${pc(dVentas)})`}. ${dVentas !== null && dVentas < dLeads ? "Entra más gente de la que se convierte: el cuello está en el cierre, no en los anuncios." : "El cierre acompaña al tráfico."}`,
    });
  }

  // — Velocidad —
  if (m.tiempo_promedio_ia !== null && m.tiempo_promedio_humano !== null && m.tiempo_promedio_humano > m.tiempo_promedio_ia * 2) {
    out.push({
      tono: "ambar",
      titulo: "Las ventas asistidas tardan mucho más en cerrar",
      texto: `La IA cierra en ${formatearDuracion(m.tiempo_promedio_ia)} y las asistidas en ${formatearDuracion(m.tiempo_promedio_humano)}. Un cliente que espera se enfría: fija un tiempo máximo de respuesta para el equipo.`,
    });
  }

  if (out.length === 0) {
    out.push({ tono: "ambar", titulo: "Pocos datos", texto: "No hay suficiente actividad en el periodo para dar consejos con números." });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// El documento
// ─────────────────────────────────────────────────────────────────────────────

const ESTILO_CIERRE = `
  .portada { background: #0f1a17; color: #fff; border-radius: 12px; padding: 26px 28px; }
  .portada h1 { font-size: 26px; margin: 0 0 4px; }
  .portada p { color: #b9c9c3; margin: 0; }
  .portada .periodo { font-size: 18px; color: #fff; margin: 12px 0 4px; font-weight: 600; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-top: 14px; }
  .kpi { background: #fff; border: 1px solid #e8edeb; border-radius: 10px; padding: 12px 14px; }
  .kpi .v { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .kpi .e { color: #5a6b65; font-size: 12px; }
  .roscas { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-around; background: #fff;
            border: 1px solid #e8edeb; border-radius: 10px; padding: 16px 8px; margin: 10px 0; }
  .rosca { margin: 0; text-align: center; width: 200px; }
  .rosca figcaption { display: grid; gap: 2px; font-size: 13px; }
  .rosca figcaption span { color: #5a6b65; font-size: 12px; }
  .leyenda { font-size: 12px; color: #5a6b65; }
  .leyenda i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 12px; }
  .panel { background: #fff; border: 1px solid #e8edeb; border-radius: 10px; padding: 14px 16px; }
  .barras { display: grid; gap: 7px; }
  .barra { display: grid; grid-template-columns: 200px 1fr 140px; gap: 10px; align-items: center; font-size: 12.5px; }
  .barra .et { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .barra .pista { background: #eef2f0; border-radius: 4px; height: 12px; overflow: hidden; }
  .barra .pista span { display: block; height: 100%; border-radius: 4px; }
  .barra .val { text-align: right; }
  .veredicto { border-radius: 8px; padding: 11px 14px; font-weight: 600; margin: 8px 0; }
  .veredicto.verde, .consejo.verde { background: #e7f4f0; border-left: 4px solid ${VERDE}; }
  .veredicto.ambar, .consejo.ambar { background: #fdf3e2; border-left: 4px solid ${AMBAR}; }
  .veredicto.rojo, .consejo.rojo { background: #fbeae8; border-left: 4px solid ${ROJO}; }
  .consejo { border-radius: 8px; padding: 10px 14px; margin: 8px 0; break-inside: avoid; }
  .consejo h3 { font-size: 14px; margin-bottom: 3px; }
  .consejo p { margin: 0; font-size: 13px; }
  .depuracion { background: #fff; border: 1px dashed #b9c9c3; border-radius: 10px; padding: 12px 16px; font-size: 13px; }
  .depuracion ul { margin: 6px 0 0; padding-left: 18px; }
  .imprimir { float: right; }
  .imprimir button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #12876a;
                     background: #12876a; color: #fff; cursor: pointer; }
  @media print {
    .imprimir { display: none; }
    .portada { background: #fff; color: #0f1a17; border: 1px solid #ccc; }
    .portada p { color: #444; }
    .portada .periodo { color: #0f1a17; }
    h2 { break-after: avoid; }
    .roscas, .panel, .kpi { break-inside: avoid; }
  }
`;

function etiquetaDelPeriodo(rango: Rango & { huso?: string }): string {
  if (rango.desde <= 0 && rango.hasta >= 9_999_999_999) return "Todo el histórico";
  const huso = rango.huso ?? husoDelServidor();
  const a = fechaISOEn(huso, rango.desde);
  const b = fechaISOEn(huso, Math.min(rango.hasta, 4_102_444_800));
  return a === b ? a : `${a} al ${b}`;
}

export function informeDeCierre(
  orgId: number,
  opciones: {
    rango: Rango & { huso?: string };
    /** «Septiembre 2026»: cuando se pidió un mes entero. */
    etiqueta?: string;
    ahora?: Date;
    soloAnuncio?: boolean;
    canalIds?: number[] | null;
  },
): { nombre: string; html: string; depuracion: Depuracion } {
  const hoy = opciones.ahora ?? new Date();
  const canalIds = opciones.canalIds ?? undefined;
  const rango = { ...opciones.rango, soloAnuncio: opciones.soloAnuncio === true, canalIds };

  // Primero se depura, después se mide: las cifras ya salen en limpio.
  const dep = depurar(orgId, rango);
  const org = obtenerOrg(orgId);
  const m = calcularMetricas(orgId, rango);

  const largo = rango.hasta - rango.desde + 1;
  const anterior =
    rango.desde > 0
      ? calcularMetricas(orgId, { ...rango, desde: rango.desde - largo, hasta: rango.desde - 1 })
      : null;

  const inter = interrupciones(orgId, rango);
  const nombres = new Map(m.por_canal.map((c) => [c.canal_id, c.nombre]));
  const humano = {
    hilos: conteoConIntervencionHumana(orgId, rango),
    cerrados: cierresConIntervencionHumana(orgId, rango),
  };
  const plan = consejos(m, anterior, inter, humano);

  const cerradas = m.cierres_ia + m.cierres_humano;
  const periodo = opciones.etiqueta ?? etiquetaDelPeriodo(rango);
  const generado = fecha(Math.floor(hoy.getTime() / 1000));

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="v">${num(m.leads)}</div><div class="e">Conversaciones · ${num(m.leads_anuncio)} por anuncio</div></div>
      <div class="kpi"><div class="v">${num(cerradas)}</div><div class="e">Ventas cerradas · ${pc(m.tasa_cierre_total)} de las conversaciones</div></div>
      <div class="kpi"><div class="v">${esc(porMoneda(m, "facturado"))}</div><div class="e">Facturado sin envío</div></div>
      <div class="kpi"><div class="v">${esc(porMoneda(m, "promedio"))}</div><div class="e">Promedio por pedido</div></div>
    </div>`;

  const medicion = `
    <div class="roscas">
      ${rosca({ valor: m.cobertura_ia.valor, meta: m.cobertura_ia.meta, titulo: "Cobertura automatizada", pie: `${num(m.cierres_ia)} de ${num(cerradas)} ventas · meta ${m.cobertura_ia.meta} %`, color: COLOR[m.cobertura_ia.estado] })}
      ${rosca({ valor: m.efectividad_humana.valor, meta: m.efectividad_humana.meta, titulo: "Efectividad asistida", pie: `${num(humano.cerrados)} de ${num(humano.hilos)} hilos con vendedor · meta ${m.efectividad_humana.meta} %`, color: COLOR[m.efectividad_humana.estado] })}
      ${rosca({ valor: m.tasa_cierre_total, meta: null, titulo: "Cierre total", pie: `${num(cerradas)} de ${num(m.leads)} conversaciones`, color: AZUL })}
      ${roscaPartida(
        [{ valor: m.cierres_ia, color: VERDE }, { valor: m.cierres_humano, color: AZUL }, { valor: m.sin_cerrar + m.revision, color: GRIS }],
        num(m.leads),
        "Cómo acabaron",
        `${num(m.cierres_ia)} automatizadas · ${num(m.cierres_humano)} asistidas · ${num(m.sin_cerrar + m.revision)} sin cerrar`,
      )}
    </div>
    <p class="tenue">La marca negra del aro es la meta. Automatizada: cerró un resumen de pedido de la IA.
      Asistida: cerró una factura sin resumen en el hilo. Efectividad asistida: de los hilos donde escribió un vendedor,
      cuántos acabaron en venta, la cerrara quien la cerrara.</p>`;

  const porNumero = m.por_canal.length === 0
    ? `<p class="vacio">No hay números conectados.</p>`
    : `<table class="rejilla"><thead><tr><th>Número</th><th class="num">Conversaciones</th><th class="num">Automatizadas</th><th class="num">Asistidas</th><th class="num">Sin cerrar</th><th class="num">Cierre</th><th class="num">Facturado</th></tr></thead><tbody>${m.por_canal
        .map(
          (c) => `<tr><td>${esc(c.nombre)}<div class="tenue">${esc(c.pais_nombre ?? "")} · ${esc(c.modo)}</div></td>
            <td class="num">${num(c.leads)}</td><td class="num">${num(c.cierres_ia)}</td><td class="num">${num(c.cierres_humano)}</td>
            <td class="num">${num(c.sin_cerrar)}</td><td class="num">${pc(c.tasa)}</td><td class="num">${esc(dinero(c.ventas, c.moneda))}</td></tr>`,
        )
        .join("")}</tbody></table>`;

  const anuncios = barrasHorizontales(
    [...m.productos_anuncio]
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 8)
      .map((p) => ({ etiqueta: p.producto, valor: p.leads, texto: `${num(p.leads)} leads · ${num(p.cerrados)} ventas`, color: AZUL })),
  );
  const productos = barrasHorizontales(
    m.top_productos.map((p) => ({ etiqueta: p.producto, valor: p.unidades, texto: `${num(p.unidades)} u.` })),
  );

  const depHtml = `
    <div class="depuracion">
      <strong>Depuración hecha antes de descargar (automatizada frente a asistida)</strong>
      <ul>
        <li>${num(dep.selladas)} cierres con resumen de la IA estaban sin sellar y se contaron.</li>
        <li>${num(dep.intervenciones_corregidas)} hilos tenían mal la marca «intervino una persona» y se corrigieron según sus mensajes.</li>
        <li>${num(dep.automatizadas_tras_vendedor)} ventas las cerró la IA después de que un vendedor tocara el hilo (buen trabajo en equipo).</li>
        <li>Las cifras ${m.cuadra ? "cuadran: cada conversación está en un solo estado" : "<strong>NO cuadran</strong>: alguna conversación se está perdiendo"}.</li>
        ${dep.avisos.map((a) => `<li><strong>Atención:</strong> ${esc(a)}</li>`).join("")}
      </ul>
    </div>`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cierre ${esc(periodo)} · ${esc(org?.nombre ?? "SalesDash")}</title>
<style>${ESTILO}${ESTILO_CIERRE}</style>
</head>
<body>
<main>
  <div class="imprimir"><button type="button" onclick="window.print()">Imprimir / guardar PDF</button></div>
  <div class="portada">
    <p>Informe de cierre</p>
    <h1>${esc(org?.nombre ?? "SalesDash")}</h1>
    <p class="periodo">${esc(periodo)}</p>
    <p>Generado el ${esc(generado)}${opciones.soloAnuncio ? " · cuenta SOLO a los clientes que llegaron por un anuncio" : ""}</p>
  </div>
  ${kpis}

  <h2>Cómo cerró el periodo</h2>
  ${depHtml}

  <h2>Círculos de medición: automatizada y asistida</h2>
  ${medicion}

  <h2>¿Los vendedores interrumpen a la IA?</h2>
  ${seccionInterrupciones(inter, nombres)}

  <h2>Día a día</h2>
  <div class="panel">${graficoDias(m)}</div>

  <h2>Cada número</h2>
  ${porNumero}

  <h2>Lo que traen los anuncios</h2>
  <div class="panel">${anuncios}</div>

  <h2>Lo que más se vendió</h2>
  <div class="panel">${productos}</div>

  <h2>Plan para cumplir las metas</h2>
  <p class="tenue">Cada punto sale de los números de este periodo y de las metas de la cuenta
    (cobertura ${m.cobertura_ia.meta} %, efectividad ${m.efectividad_humana.meta} %).</p>
  ${plan.map((c) => `<div class="consejo ${c.tono}"><h3>${esc(c.titulo)}</h3><p>${esc(c.texto)}</p></div>`).join("")}
</main>
</body>
</html>`;

  const dia = (e: number) => fechaISOEn(rango.huso ?? husoDelServidor(), e);
  const sufijo =
    rango.desde <= 0 ? dia(Math.floor(hoy.getTime() / 1000)) : `${dia(rango.desde)}_${dia(Math.min(rango.hasta, 4_102_444_800))}`;
  return { nombre: `cierre-${sufijo}.html`, html, depuracion: dep };
}
