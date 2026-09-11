/**
 * Piezas del panel: KPIs, pastillas de estado, estados vacíos y los dos
 * gráficos. Todo en SVG dibujado a mano — sin librería de gráficos.
 */
import type { EstadoCierre } from "@/lib/db";
import { formatearImporte, type Moneda } from "@/lib/moneda";
import type { FacturadoPorMoneda } from "@/lib/metrics";
import { IconoPedido } from "./Iconos";

/**
 * LA NUBECITA DEL PEDIDO. Va en la lista de chats y en la cabecera del hilo:
 * con un vistazo se sabe qué conversaciones ya tienen un pedido hecho, sin
 * abrirlas ni leer la pastilla.
 */
export function Nube({ texto = "Pedido" }: { texto?: string }) {
  return (
    <span className="sd-nube" title="Esta conversación tiene un pedido">
      <IconoPedido tam={12} />
      {texto}
    </span>
  );
}

/** ¿Tiene un pedido? Cerrada por resumen o por factura, o con el resumen escrito. */
export function tienePedido(c: { cerrado_por: string; resumen_pedido?: string | null }): boolean {
  return c.cerrado_por === "ia" || c.cerrado_por === "humano" || !!c.resumen_pedido;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pastilla de estado
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETAS: Record<EstadoCierre, { texto: string; clase: string }> = {
  ia: { texto: "Automatizada", clase: "pastilla-ia" },
  humano: { texto: "Asistida", clase: "pastilla-humano" },
  abierta: { texto: "Abierta", clase: "pastilla-abierta" },
  revision: { texto: "Revisión", clase: "pastilla-revision" },
};

/** El color nunca es la única señal: la etiqueta siempre lleva su texto. */
export function Pastilla({ estado }: { estado: EstadoCierre }) {
  const e = ETIQUETAS[estado] ?? ETIQUETAS.abierta;
  return <span className={`pastilla ${e.clase}`}>{e.texto}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI
// ─────────────────────────────────────────────────────────────────────────────

export type TonoKpi = "acento" | "azul" | "ambar" | "neutro";

const FONDOS: Record<TonoKpi, { fondo: string; color: string }> = {
  acento: { fondo: "var(--acc-bg)", color: "var(--acc)" },
  azul: { fondo: "var(--blue-bg)", color: "var(--blue)" },
  ambar: { fondo: "var(--amber-bg)", color: "var(--amber)" },
  neutro: { fondo: "var(--soft)", color: "var(--ink-2)" },
};

export function Kpi({
  etiqueta,
  valor,
  pie,
  cuerpo,
  icono,
  tono = "neutro",
  insignia,
}: {
  etiqueta: string;
  valor: string | number;
  pie?: React.ReactNode;
  /**
   * Detalle que va debajo de la cifra a ancho completo y SIN el gris del pie.
   *
   * El pie es una línea de contexto; esto es contenido —un desglose, una lista—
   * que necesita todo el ancho de la tarjeta y su propio contraste. Meterlo en
   * `pie` lo dejaba encogido contra el icono y en color tenue.
   */
  cuerpo?: React.ReactNode;
  icono: React.ReactNode;
  tono?: TonoKpi;
  /** Una pastilla arriba a la derecha: «Meta 90 %». */
  insignia?: React.ReactNode;
}) {
  const t = FONDOS[tono];
  return (
    <div className="tarjeta" style={{ display: "flex", gap: 13, alignItems: "flex-start", position: "relative" }}>
      {insignia && <span className="sd-kpi-insignia">{insignia}</span>}
      <div
        style={{
          width: 36, height: 36, borderRadius: 10, background: t.fondo, color: t.color,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        {icono}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.15 }}>
          {valor}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{etiqueta}</div>
        {pie && <div className="tenue" style={{ marginTop: 3 }}>{pie}</div>}
        {cuerpo}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Semáforo
// ─────────────────────────────────────────────────────────────────────────────

const COLORES_SEMAFORO = {
  verde: "var(--acc)",
  ambar: "var(--amber)",
  rojo: "var(--red)",
} as const;

export function Meta({
  etiqueta,
  valor,
  meta,
  estado,
}: {
  etiqueta: string;
  valor: number;
  meta: number;
  estado: "verde" | "ambar" | "rojo";
}) {
  const color = COLORES_SEMAFORO[estado];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5 }}>{etiqueta}</span>
        <span className="num" style={{ fontSize: 13.5, fontWeight: 600, color }}>
          {valor}% <span className="tenue">de {meta}%</span>
        </span>
      </div>
      <div style={{ height: 5, background: "var(--soft)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(valor, 100)}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado vacío
// ─────────────────────────────────────────────────────────────────────────────

/** Los estados vacíos invitan a actuar; nunca dicen "no hay datos". */
export function Vacio({
  titulo,
  texto,
  accion,
}: {
  titulo: string;
  texto?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div style={{ padding: "34px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 5 }}>{titulo}</div>
      {texto && (
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", maxWidth: "46ch", margin: "0 auto 14px" }}>
          {texto}
        </div>
      )}
      {accion}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gráfico de área con las series de cierres encima
// ─────────────────────────────────────────────────────────────────────────────

export interface PuntoSerie {
  dia: string;
  leads: number;
  /** Los que trajo la publicidad. Es la línea que se mira cuando se paga por ella. */
  leads_anuncio: number;
  cierres_ia: number;
  cierres_humano: number;
}

/**
 * `soloAnuncio` no cambia los datos: cuando el panel ya está filtrado, la línea
 * de anuncio y la de conversaciones son la MISMA y dibujarlas las dos deja un
 * trazo ámbar encima de otro verde que parece un fallo de pintado. Se dibuja
 * una sola y la leyenda la nombra por lo que es.
 */
/**
 * El rótulo de un día en el eje. Con una semana o dos, el nombre del día —«vie»,
 * «sáb»— que es como uno piensa en la semana pasada; con más, la fecha corta.
 * La fecha viene en ISO y se parte a mano: leerla con `new Date` la tomaría
 * como UTC y en media América caería en el día anterior.
 */
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function etiquetaDelDia(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return iso.slice(5);
  if (dias > 14) return `${d}/${m}`;
  return DIAS_CORTOS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? iso.slice(5);
}

export function GraficoArea({
  serie,
  soloAnuncio = false,
  modo = "completo",
}: {
  serie: PuntoSerie[];
  soloAnuncio?: boolean;
  /** «simple»: solo las entradas y las cerradas. Es el del resumen. */
  modo?: "completo" | "simple";
}) {
  if (serie.length < 2) {
    return (
      <Vacio
        titulo="Todavía no hay suficientes días"
        texto="En cuanto tengas un par de días con conversaciones, aquí verás cómo evoluciona."
      />
    );
  }

  const An = 640;
  const Al = 190;
  const margen = { arriba: 12, derecha: 8, abajo: 22, izquierda: 30 };
  const anchoUtil = An - margen.izquierda - margen.derecha;
  const altoUtil = Al - margen.arriba - margen.abajo;

  const maximo = Math.max(1, ...serie.map((p) => p.leads));
  const x = (i: number) => margen.izquierda + (i * anchoUtil) / (serie.length - 1);
  const y = (v: number) => margen.arriba + altoUtil - (v / maximo) * altoUtil;

  const valor = (p: PuntoSerie, campo: keyof PuntoSerie | "cerradas") =>
    campo === "cerradas" ? p.cierres_ia + p.cierres_humano : Number(p[campo]);
  const linea = (campo: keyof PuntoSerie | "cerradas") =>
    serie.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(valor(p, campo)).toFixed(1)}`).join(" ");

  const area = `${linea("leads")} L${x(serie.length - 1).toFixed(1)},${margen.arriba + altoUtil} L${margen.izquierda},${margen.arriba + altoUtil} Z`;

  const primero = serie[0]!;
  const ultimo = serie[serie.length - 1]!;
  const tendencia =
    ultimo.leads > primero.leads ? "al alza" : ultimo.leads < primero.leads ? "a la baja" : "estable";

  return (
    <svg
      viewBox={`0 0 ${An} ${Al}`}
      style={{ width: "100%", height: "auto" }}
      role="img"
      aria-label={`Conversaciones por día, tendencia ${tendencia}. De ${primero.leads} el ${primero.dia} a ${ultimo.leads} el ${ultimo.dia}, de las cuales ${ultimo.leads_anuncio} llegaron por un anuncio. Máximo ${maximo}.`}
    >
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={margen.izquierda}
          x2={An - margen.derecha}
          y1={margen.arriba + altoUtil * f}
          y2={margen.arriba + altoUtil * f}
          stroke="var(--line)"
        />
      ))}

      {[maximo, Math.round(maximo / 2), 0].map((v, i) => (
        <text
          key={v + "-" + i}
          x={margen.izquierda - 7}
          y={margen.arriba + altoUtil * (i / 2) + 3.5}
          textAnchor="end"
          fontSize="9.5"
          fill="var(--ink-4)"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {v}
        </text>
      ))}

      <path d={area} fill="var(--acc-bg)" />
      <path d={linea("leads")} fill="none" stroke="var(--acc)" strokeWidth="1.8" />
      {modo === "simple" ? (
        // Las cerradas, en verde y a trazos: cuántas de las que entran terminan en pedido.
        <path d={linea("cerradas")} fill="none" stroke="var(--verde)" strokeWidth="1.5" strokeDasharray="4 3" />
      ) : (
        <>
          {/* Los de anuncio van en ámbar: son un subconjunto de la línea de arriba,
              y la distancia entre las dos es exactamente la gente que escribió sin
              que la publicidad la trajera. */}
          {!soloAnuncio && (
            <path d={linea("leads_anuncio")} fill="none" stroke="var(--amber)" strokeWidth="1.6" />
          )}
          <path d={linea("cierres_ia")} fill="none" stroke="var(--acc)" strokeWidth="1.4" strokeDasharray="4 3" />
          <path d={linea("cierres_humano")} fill="none" stroke="var(--blue)" strokeWidth="1.4" />
        </>
      )}
      {modo === "simple" && (
        <circle cx={x(serie.length - 1)} cy={y(ultimo.leads)} r="3.5" fill="var(--acc)" stroke="var(--card)" strokeWidth="1.5" />
      )}

      {serie.map((p, i) =>
        i === 0 || i === serie.length - 1 || serie.length <= 8 ? (
          <text
            key={p.dia}
            x={x(i)}
            y={Al - 6}
            textAnchor={i === 0 ? "start" : i === serie.length - 1 ? "end" : "middle"}
            fontSize="9.5"
            fill="var(--ink-4)"
          >
            {etiquetaDelDia(p.dia, serie.length)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function LeyendaGrafico({
  soloAnuncio = false,
  modo = "completo",
}: {
  soloAnuncio?: boolean;
  modo?: "completo" | "simple";
}) {
  if (modo === "simple") {
    return (
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--ink-2)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--acc)" }} /> Entradas
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--verde)" }} /> Cerradas
        </span>
      </div>
    );
  }
  const items = [
    { color: "var(--acc)", texto: soloAnuncio ? "Leads por anuncio" : "Conversaciones", guion: false },
    ...(soloAnuncio
      ? []
      : [{ color: "var(--amber)", texto: "Leads por anuncio", guion: false }]),
    { color: "var(--acc)", texto: "Cierres automatizados", guion: true },
    { color: "var(--blue)", texto: "Cierres asistidos", guion: false },
  ];

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
      {items.map((i) => (
        <span key={i.texto} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-2)" }}>
          <span
            style={{
              width: 14, height: 0, borderTop: `2px ${i.guion ? "dashed" : "solid"} ${i.color}`,
            }}
          />
          {i.texto}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Donut
// ─────────────────────────────────────────────────────────────────────────────

export interface PorcionDonut {
  etiqueta: string;
  valor: number;
  color: string;
}

export function Donut({ porciones, centro, pie }: { porciones: PorcionDonut[]; centro: string; pie: string }) {
  const total = porciones.reduce((n, p) => n + p.valor, 0);

  if (total === 0) {
    return <Vacio titulo="Aún no hay cierres que repartir" texto="Cuando se cierre la primera venta, aquí verás quién la cerró." />;
  }

  const radio = 54;
  const grosor = 15;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg
        width="132"
        height="132"
        viewBox="0 0 132 132"
        role="img"
        aria-label={`${pie}. ${porciones.map((p) => `${p.etiqueta}: ${p.valor}`).join(", ")}.`}
      >
        <g transform="rotate(-90 66 66)">
          {porciones.map((p) => {
            const fraccion = p.valor / total;
            const trazo = fraccion * circunferencia;
            const desfase = -acumulado * circunferencia;
            acumulado += fraccion;

            return (
              <circle
                key={p.etiqueta}
                cx="66" cy="66" r={radio}
                fill="none"
                stroke={p.color}
                strokeWidth={grosor}
                strokeDasharray={`${trazo} ${circunferencia - trazo}`}
                strokeDashoffset={desfase}
              />
            );
          })}
        </g>
        <text
          x="66" y="63" textAnchor="middle"
          fontSize="21" fontWeight="700" fill="var(--ink)"
          style={{ letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}
        >
          {centro}
        </text>
        <text x="66" y="79" textAnchor="middle" fontSize="9.5" fill="var(--ink-3)">
          {pie}
        </text>
      </svg>

      <div style={{ display: "grid", gap: 9, minWidth: 128 }}>
        {porciones.map((p) => (
          <div key={p.etiqueta} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: "var(--ink-2)" }}>{p.etiqueta}</span>
            <span className="num" style={{ fontWeight: 600 }}>{p.valor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de presentación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un importe para leer. Con moneda, como lo escribe la gente de ese país
 * —«RD$2,750», «₡23.500», «US$45.00»—; sin ella, el número a secas, que es lo
 * que hay cuando el canal no tiene país.
 */
export function dinero(n: number | null | undefined, moneda?: Moneda | null): string {
  if (n === null || n === undefined) return "—";
  if (moneda && moneda.codigo) return formatearImporte(n, moneda);
  return n.toLocaleString("es-DO", { maximumFractionDigits: 0 });
}

/**
 * UN IMPORTE POR MONEDA, en línea: «RD$5,500 · ₡23.500 · US$45.00».
 *
 * Es la única forma honesta de enseñar el dinero de una cuenta que vende en
 * tres países: una cifra por moneda, sin sumarlas. Con una sola moneda es un
 * importe normal.
 */
export function Importes({
  lista,
  campo,
  color,
}: {
  lista: FacturadoPorMoneda[];
  campo: "facturado" | "facturado_ia" | "facturado_humano" | "envios" | "promedio";
  color?: string;
}) {
  if (lista.length === 0) return <strong style={{ color }}>{dinero(0)}</strong>;
  return (
    <>
      {lista.map((f, i) => (
        <span key={f.moneda.codigo || "sin"}>
          {i > 0 && <span className="tenue"> · </span>}
          <strong style={{ color }}>{dinero(f[campo], f.moneda)}</strong>
        </span>
      ))}
    </>
  );
}

/** Una fila por moneda, con su etiqueta. Para las tarjetas y los pies de tabla. */
export function FilasPorMoneda({
  lista,
  campo,
  color,
  tam = 13,
}: {
  lista: FacturadoPorMoneda[];
  campo: "facturado" | "facturado_ia" | "facturado_humano" | "envios" | "promedio";
  color?: string;
  tam?: number;
}) {
  if (lista.length === 0) return <span className="num">{dinero(0)}</span>;
  return (
    <span style={{ display: "inline-grid", gap: 2, justifyItems: "end" }}>
      {lista.map((f) => (
        <span key={f.moneda.codigo || "sin"} className="num" style={{ fontWeight: 600, fontSize: tam, color }}>
          {dinero(f[campo], f.moneda)}
        </span>
      ))}
    </span>
  );
}

export function fechaCorta(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleDateString("es", { day: "2-digit", month: "short" });
}

export function fechaHora(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * «hoy, 3:42 p. m.», «ayer, 9:05 a. m.», «10 sept, 8:15 p. m.»: cuándo fue, con
 * la hora, EN LA HORA DEL PAÍS del número. Sin huso, la del servidor.
 *
 * «Hace 2 d» no dice qué día fue ni a qué hora, y para cuadrar una factura con
 * lo que pasó ese día hacen falta las dos cosas.
 */
export function fechaYHora(epoch: number | null, huso?: string): string {
  if (!epoch) return "—";
  const hora = horaDelMensaje(epoch, huso);
  const atras = diasAtras(epoch, huso);
  if (atras === 0) return `hoy, ${hora}`;
  if (atras === 1) return `ayer, ${hora}`;

  const zona = huso ? { timeZone: huso } : {};
  const fecha = new Date(epoch * 1000).toLocaleDateString("es", {
    day: "numeric", month: "short", ...(otroAno(epoch, huso) ? { year: "numeric" } : {}), ...zona,
  });
  return `${fecha}, ${hora}`;
}

/** «3:42 p. m.»: la hora de un mensaje, como la pone WhatsApp debajo del globo. */
export function horaDelMensaje(epoch: number, huso?: string): string {
  return new Date(epoch * 1000).toLocaleTimeString("es", {
    hour: "numeric", minute: "2-digit", hour12: true, ...(huso ? { timeZone: huso } : {}),
  });
}

/**
 * El rótulo que separa los días en el hilo, como en WhatsApp: «Hoy», «Ayer»,
 * el día de la semana si fue esta semana, y si no la fecha entera.
 */
export function diaDelHilo(epoch: number, huso?: string): string {
  const atras = diasAtras(epoch, huso);
  if (atras === 0) return "Hoy";
  if (atras === 1) return "Ayer";
  const zona = huso ? { timeZone: huso } : {};
  const cuando = new Date(epoch * 1000);
  const texto = atras > 1 && atras < 7
    ? cuando.toLocaleDateString("es", { weekday: "long", ...zona })
    : cuando.toLocaleDateString("es", {
        day: "numeric", month: "long", ...(otroAno(epoch, huso) ? { year: "numeric" } : {}), ...zona,
      });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** «2026-09-11»: el día del calendario de ese instante en el huso. */
export function diaISO(epoch: number, huso?: string): string {
  return new Date(epoch * 1000).toLocaleDateString("en-CA", huso ? { timeZone: huso } : {});
}

/** Cuántos días de calendario —no de 24 horas— hay entre ese día y hoy, allá. */
function diasAtras(epoch: number, huso?: string): number {
  const hoy = diaISO(Math.floor(Date.now() / 1000), huso);
  return Math.round((Date.parse(hoy) - Date.parse(diaISO(epoch, huso))) / 86_400_000);
}

function otroAno(epoch: number, huso?: string): boolean {
  return diaISO(epoch, huso).slice(0, 4) !== diaISO(Math.floor(Date.now() / 1000), huso).slice(0, 4);
}

export function hace(epoch: number | null): string {
  if (!epoch) return "sin actividad";
  const seg = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  if (seg < 60) return "hace un momento";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86_400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86_400)} d`;
}
