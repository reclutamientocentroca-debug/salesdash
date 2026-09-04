import Link from "next/link";
import {
  GraficoArea,
  Importes,
  Kpi,
  LeyendaGrafico,
  Vacio,
  dinero,
  hace,
} from "@/components/panel/Piezas";
import {
  IconoConversaciones,
  IconoDescargar,
  IconoMoneda,
  IconoPersona,
  IconoRayo,
  IconoRosca,
} from "@/components/panel/Iconos";
import {
  bandejaMeta,
  contarCanales,
  contarRevisiones,
  listarAnomalias,
  listarAnunciosMeta,
  listarCanales,
  listarPaginasMeta,
} from "@/lib/db";
import { filasDeAtencion } from "@/lib/atencion";
import { calcularMetricas, type Metricas } from "@/lib/metrics";
import type { Moneda } from "@/lib/moneda";
import { rangoDeLaCuenta, requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Resumen · SalesDash" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ rango?: string; solo?: string; desde?: string; hasta?: string }>;
}

/** «6,3 %»: el porcentaje como se escribe aquí, con la coma. */
function pct(n: number, decimales = 1): string {
  return `${n.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: decimales })} %`;
}

/** «Rep. Dominicana»: el país corto, para las cabeceras. */
function paisCorto(nombre: string | null): string {
  if (!nombre) return "Sin país";
  return nombre.replace("República", "Rep.");
}

export default async function Dashboard({ searchParams }: Props) {
  const ctx = await requerirSesion();
  const { rango: clave = "7d", solo, desde, hasta } = await searchParams;

  /*
   * El filtro vive en la URL y no en un estado del cliente: así el panel se
   * puede compartir o guardar en marcadores tal como se está mirando, y la
   * página sigue siendo de servidor —el filtro se aplica en el SQL, no
   * escondiendo filas ya pintadas—.
   */
  const soloAnuncio = solo === "anuncio";

  const parametros = new URLSearchParams();
  parametros.set("rango", clave);
  if (desde) parametros.set("desde", desde);
  if (hasta) parametros.set("hasta", hasta);
  if (soloAnuncio) parametros.set("solo", "anuncio");

  // En la hora de los países de la cuenta: «hoy» es hoy en Santo Domingo.
  const rango = { ...rangoDeLaCuenta(ctx.orgId, parametros), soloAnuncio };
  const m = calcularMetricas(ctx.orgId, rango);

  /*
   * EL PERIODO ANTERIOR, del mismo largo y justo antes: de ahí sale el «+12,4 %»
   * de las conversaciones y el «+31» de los pedidos. Con «Todo» no hay antes.
   */
  const largo = rango.hasta - rango.desde + 1;
  const anterior =
    rango.desde > 0
      ? calcularMetricas(ctx.orgId, { desde: rango.desde - largo, hasta: rango.desde - 1, huso: rango.huso, soloAnuncio })
      : null;
  const variacion = (ahora: number, antes: number | undefined): string | null => {
    if (antes === undefined || antes === 0) return null;
    const v = Math.round(((ahora - antes) / antes) * 1000) / 10;
    return `${v > 0 ? "+" : ""}${v.toLocaleString("es", { maximumFractionDigits: 1 })} %`;
  };
  const cerradas = m.cierres_ia + m.cierres_humano;
  const cerradasAntes = anterior ? anterior.cierres_ia + anterior.cierres_humano : undefined;
  const variacionLeads = variacion(m.leads, anterior?.leads);
  const variacionPedidos = cerradasAntes === undefined ? null : `${cerradas - cerradasAntes >= 0 ? "+" : ""}${cerradas - cerradasAntes}`;

  const anomalias = listarAnomalias(ctx.orgId);
  const enRevision = contarRevisiones(ctx.orgId);
  const numeros = contarCanales(ctx.orgId);
  const sinConectar = numeros === 0;
  const altas = anomalias.filter((a) => a.severidad === "alta").length;

  /*
   * «Necesita tu atención»: lo que no puede esperar a mañana. Se arma con lo
   * que ya está en la base y cada fila trae su botón. Ver `filasDeAtencion`.
   */
  const paginas = listarPaginasMeta(ctx.orgId);
  const atencion = filasDeAtencion({
    canales: listarCanales(ctx.orgId),
    sinResponder: paginas.length > 0 ? bandejaMeta(ctx.orgId, { limite: 120 }).filter((f) => f.ultimo_emisor === "cliente").length : 0,
    paginas: paginas.map((p) => p.nombre),
    sinVincular: listarAnunciosMeta(ctx.orgId).filter((a) => a.producto_id === null).length,
    enRevision,
    anomalias: anomalias.filter((a) => a.severidad === "alta"),
  });

  // Lo que dice cada KPI debajo de su meta.
  const diferencia = (valor: number, meta: number) => {
    const d = Math.round(valor - meta);
    if (d === 0) return "Justo en tu meta";
    return `${Math.abs(d)} punto${Math.abs(d) === 1 ? "" : "s"} por ${d > 0 ? "encima" : "debajo"} de tu meta`;
  };
  const claseInsignia = (estado: "verde" | "ambar" | "rojo") => (estado === "verde" ? "" : estado);
  const colorSemaforo = (estado: "verde" | "ambar" | "rojo") =>
    estado === "verde" ? "var(--verde)" : estado === "ambar" ? "var(--amber)" : "var(--red)";

  // El pie del gráfico: lo de ayer, que es el último día completo.
  const ayer = m.serie_diaria.length >= 2 ? m.serie_diaria[m.serie_diaria.length - 2] : null;

  // Las dos tablas: los números de WhatsApp y las páginas de Meta.
  const whatsapp = m.por_canal.filter((c) => c.tipo !== "meta");
  const meta = m.por_canal.filter((c) => c.tipo === "meta");
  const lineasActivas = whatsapp.filter((c) => c.vinculado && c.estado === "conectado").length;

  return (
    <>
      <div className="sd-cabecera" style={{ marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
            {soloAnuncio
              ? `${m.leads} leads por anuncio · el resto del panel no los cuenta`
              : `${m.leads_anuncio} leads por anuncio · ${m.leads} conversaciones en total`}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            href={(() => {
              const p = new URLSearchParams(parametros);
              if (soloAnuncio) p.delete("solo");
              else p.set("solo", "anuncio");
              return `/dashboard?${p.toString()}`;
            })()}
            className={`btn ${soloAnuncio ? "btn-acento" : "btn-secundario"}`}
            style={{ textDecoration: "none", padding: "6px 12px", fontSize: 12.5 }}
            aria-pressed={soloAnuncio}
          >
            {soloAnuncio ? "Solo leads de anuncio" : "Contando a todos"}
          </Link>
          {enRevision > 0 && (
            <Link href="/revision" className="btn btn-secundario" style={{ textDecoration: "none", padding: "6px 12px", fontSize: 12.5 }}>
              {enRevision} sin clasificar
            </Link>
          )}
          {altas > 0 && (
            <Link href="/conversaciones" className="btn btn-secundario" style={{ textDecoration: "none", color: "var(--red)", padding: "6px 12px", fontSize: 12.5 }}>
              {altas} anomalía{altas === 1 ? "" : "s"} alta{altas === 1 ? "" : "s"}
            </Link>
          )}
        </div>
      </div>

      {sinConectar && (
        <div
          className="tarjeta"
          style={{
            marginBottom: 14, display: "flex", alignItems: "center", gap: 16,
            flexWrap: "wrap", borderColor: "var(--acc-bg)", background: "var(--acc-bg)",
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--acc)" }}>
              Así se verá tu panel en cuanto conectes un número
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>
              Ahora mismo todo está en cero porque todavía no llega ninguna conversación.
            </div>
          </div>
          <Link href="/numeros" className="btn btn-acento" style={{ textDecoration: "none" }}>
            Conectar número
          </Link>
        </div>
      )}

      {!m.cuadra && (
        <div className="aviso aviso-error" role="alert" style={{ marginBottom: 14 }}>
          Los números no cuadran: hay conversaciones del periodo sin clasificar. Alguna se está
          perdiendo y el reporte no es fiable.
        </div>
      )}

      {/* ── Los cuatro números ─────────────────────────────────────────── */}
      <div className="sd-kpis" style={{ marginBottom: 14 }}>
        <Kpi
          etiqueta="Conversaciones"
          valor={m.leads}
          icono={<IconoConversaciones tam={17} />}
          tono="acento"
          insignia={variacionLeads ? <span className={`texto${variacionLeads.startsWith("-") ? " baja" : ""}`}>{variacionLeads}</span> : undefined}
          pie={
            <>
              <strong style={{ color: "var(--ink)" }}>{m.leads_anuncio}</strong> llegaron por un anuncio ·{" "}
              <strong style={{ color: "var(--ink)" }}>{m.escribieron_por_su_cuenta}</strong> escribieron directo
            </>
          }
        />
        <Kpi
          etiqueta="Cobertura automatizada"
          valor={pct(m.cobertura_ia.valor, 0)}
          icono={<IconoRayo tam={17} />}
          tono="acento"
          insignia={<span className={claseInsignia(m.cobertura_ia.estado)}>Meta {m.cobertura_ia.meta} %</span>}
          cuerpo={
            <>
              <div className="sd-kpi-barra">
                <div style={{ width: `${Math.min(m.cobertura_ia.valor, 100)}%`, background: colorSemaforo(m.cobertura_ia.estado) }} />
              </div>
              <div className="tenue">{diferencia(m.cobertura_ia.valor, m.cobertura_ia.meta)}</div>
            </>
          }
        />
        <Kpi
          etiqueta="Efectividad asistida"
          valor={pct(m.efectividad_humana.valor, 0)}
          icono={<IconoPersona tam={17} />}
          tono="azul"
          insignia={<span className={claseInsignia(m.efectividad_humana.estado)}>Meta {m.efectividad_humana.meta} %</span>}
          cuerpo={
            <>
              <div className="sd-kpi-barra">
                <div style={{ width: `${Math.min(m.efectividad_humana.valor, 100)}%`, background: colorSemaforo(m.efectividad_humana.estado) }} />
              </div>
              <div className="tenue">De los hilos que tocó un vendedor</div>
            </>
          }
        />
        <Kpi
          etiqueta="Pedidos cerrados"
          valor={cerradas}
          icono={<IconoMoneda tam={17} />}
          tono="ambar"
          insignia={variacionPedidos ? <span className={`texto${variacionPedidos.startsWith("-") ? " baja" : ""}`}>{variacionPedidos}</span> : undefined}
          pie={
            <>
              Ticket promedio <Importes lista={m.facturado_por_moneda} campo="promedio" />
            </>
          }
        />
      </div>

      {/* ── Lo facturado, país por país ─────────────────────────────────── */}
      {m.facturado_por_moneda.length > 0 && (
        <div className="sd-paises" style={{ marginBottom: 14 }}>
          {m.facturado_por_moneda.map((f) => (
            <section key={f.moneda.codigo || "sin"} className="tarjeta">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Facturado · {paisCorto(f.pais_nombre)}</span>
                {f.sin_monto > 0 && <span className="sd-sin-monto">{f.sin_monto} sin monto</span>}
              </div>
              <div className="sd-pais-cifra">{dinero(f.facturado, f.moneda)}</div>
              <div className="tenue" style={{ marginTop: 4 }}>
                {f.cierres} pedido{f.cierres === 1 ? "" : "s"} cerrado{f.cierres === 1 ? "" : "s"} · sin costo de envío
              </div>
              <div className="sd-pais-lista">
                {m.facturado_por_canal
                  .filter((c) => m.por_canal.find((x) => x.canal_id === c.canal_id)?.moneda.codigo === f.moneda.codigo)
                  .map((c) => (
                    <div key={c.canal_id}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                      <span className="num" style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: c.facturado > 0 ? "var(--ink)" : "var(--ink-4)" }}>
                        {dinero(c.facturado, c.moneda)}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Por día, y los leads de anuncios ────────────────────────────── */}
      <div className="sd-fila-3" style={{ marginBottom: 14 }}>
        <section className="tarjeta">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div>
              <h2 className="titulo-tarjeta">Conversaciones por día</h2>
              <div className="tenue">Cuántas entran y cuántas terminan en pedido</div>
            </div>
            {m.serie_diaria.length >= 2 && <LeyendaGrafico modo="simple" />}
          </div>
          <GraficoArea serie={m.serie_diaria} soloAnuncio={soloAnuncio} modo="simple" />
          {ayer && (
            <div className="tenue" style={{ textAlign: "right", marginTop: 4 }}>
              {ayer.leads} entrada{ayer.leads === 1 ? "" : "s"} ayer · {ayer.cierres_ia + ayer.cierres_humano} pedido
              {ayer.cierres_ia + ayer.cierres_humano === 1 ? "" : "s"}
            </div>
          )}
        </section>

        <LeadsDeAnuncios m={m} />
      </div>

      {/* ── Rendimiento por WhatsApp ───────────────────────────────────── */}
      <TablaRendimiento
        titulo="Rendimiento por WhatsApp"
        subtitulo="Los números en azul se pueden abrir: te llevan a esas conversaciones exactas"
        insignia={<span className="sd-pastilla-verde">{lineasActivas} línea{lineasActivas === 1 ? "" : "s"} activa{lineasActivas === 1 ? "" : "s"}</span>}
        cabecera="Línea de WhatsApp"
        pie="Todo WhatsApp"
        filas={whatsapp}
        parametros={parametros}
        vacio="Conecta un número de WhatsApp y aquí verás cuánto cierra."
        enlaces={(c) => ({
          leads: `/conversaciones?rango=${clave}&canal=${c.canal_id}&solo=anuncio`,
          conversaciones: `/conversaciones?rango=${clave}&canal=${c.canal_id}`,
          automatizada: `/conversaciones?rango=${clave}&canal=${c.canal_id}&estado=ia`,
          asistida: `/conversaciones?rango=${clave}&canal=${c.canal_id}&estado=humano`,
          revision: `/conversaciones?rango=${clave}&canal=${c.canal_id}&estado=revision`,
          ver: `/conversaciones?rango=${clave}&canal=${c.canal_id}`,
        })}
      />

      {/* ── Rendimiento por Messenger e Instagram ──────────────────────── */}
      <TablaRendimiento
        titulo="Rendimiento por Messenger e Instagram"
        subtitulo="Páginas de Facebook y cuentas de Instagram conectadas"
        insignia={<span className="sd-pastilla-azul">{meta.length} página{meta.length === 1 ? "" : "s"}</span>}
        cabecera="Página o cuenta"
        pie="Todo Messenger"
        filas={meta}
        parametros={parametros}
        vacio="Conecta una página de Facebook en Messenger y aquí verás cuánto cierra."
        enlaces={() => ({
          leads: "/canales/meta",
          conversaciones: "/canales/meta",
          automatizada: "/canales/meta",
          asistida: "/canales/meta",
          revision: "/revision",
          ver: "/canales/meta",
        })}
      />

      {/* ── Necesita tu atención ───────────────────────────────────────── */}
      <section className="tarjeta" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <h2 className="titulo-tarjeta">Necesita tu atención</h2>
            <div className="tenue">Lo que no puede esperar a mañana</div>
          </div>
          <Link href="/conversaciones" className="btn btn-secundario" style={{ textDecoration: "none", padding: "6px 12px", fontSize: 12.5 }}>
            Ver todo
          </Link>
        </div>
        {atencion.length === 0 ? (
          <Vacio titulo="Todo en orden" texto="Ningún número caído, nada sin responder y ningún cierre esperando." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tabla sd-atencion">
              <thead>
                <tr>
                  <th>Qué pasa</th>
                  <th>Dónde</th>
                  <th>Desde</th>
                  <th>Impacto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {atencion.map((f) => (
                  <tr key={f.clave}>
                    <td>
                      <span className={`sd-etiqueta sd-etiqueta-${f.tono}`}>{f.etiqueta}</span>
                      <span style={{ fontWeight: 600 }}>{f.que}</span>
                    </td>
                    <td className="num" style={{ color: "var(--ink-2)" }}>{f.donde}</td>
                    <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{f.desde ? hace(f.desde) : "—"}</td>
                    <td style={{ color: "var(--ink-2)" }}>{f.impacto}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={f.accion.href}
                        className={`btn ${f.tono === "rojo" ? "btn-acento" : "btn-secundario"}`}
                        style={{ textDecoration: "none", padding: "6px 12px", fontSize: 12.5, whiteSpace: "nowrap" }}
                      >
                        {f.accion.texto}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * LA ROSCA DE LOS LEADS DE ANUNCIOS: de la gente que trajo la publicidad,
 * cuántos cerró la IA, cuántos un vendedor y cuántos siguen sin cerrar. El
 * centro dice qué parte de lo cerrado lo cerró la IA sola.
 */
function LeadsDeAnuncios({ m }: { m: Metricas }) {
  const total = m.leads_anuncio;
  const ia = m.cierres_anuncio_ia;
  const vendedor = m.cierres_anuncio_humano;
  const sinCerrar = Math.max(total - ia - vendedor, 0);
  const cerrados = ia + vendedor;
  const loCierraLaIA = cerrados === 0 ? 0 : Math.round((ia / cerrados) * 100);

  const porciones = [
    { etiqueta: "Cerrados por la IA", valor: ia, color: "var(--acc)" },
    { etiqueta: "Cerrados por un vendedor", valor: vendedor, color: "var(--blue)" },
    { etiqueta: "Sin cerrar", valor: sinCerrar, color: "var(--line-2)" },
  ];

  const radio = 46;
  const grosor = 12;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;

  return (
    <section className="tarjeta">
      <h2 className="titulo-tarjeta" style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
        <span style={{ color: "var(--acc)", display: "flex" }}><IconoRosca tam={15} /></span>
        Leads de anuncios
      </h2>

      {total === 0 ? (
        <Vacio titulo="Todavía no ha llegado nadie por un anuncio" texto="Cuando un cliente escriba desde un anuncio, aquí verás cuántos cierran." />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${loCierraLaIA} % de los leads de anuncio cerrados los cierra la IA`}>
              <circle cx="60" cy="60" r={radio} fill="none" stroke="var(--soft)" strokeWidth={grosor} />
              <g transform="rotate(-90 60 60)">
                {porciones.map((p) => {
                  const fraccion = total === 0 ? 0 : p.valor / total;
                  const trazo = fraccion * circunferencia;
                  const desfase = -acumulado * circunferencia;
                  acumulado += fraccion;
                  return (
                    <circle
                      key={p.etiqueta}
                      cx="60" cy="60" r={radio}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={grosor}
                      strokeDasharray={`${trazo} ${circunferencia - trazo}`}
                      strokeDashoffset={desfase}
                    />
                  );
                })}
              </g>
              <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--ink)" style={{ letterSpacing: "-0.03em" }}>
                {loCierraLaIA} %
              </text>
              <text x="60" y="73" textAnchor="middle" fontSize="9" fill="var(--ink-3)">
                lo cierra la IA
              </text>
            </svg>

            <div className="sd-rosca-leyenda" style={{ flex: 1, minWidth: 150 }}>
              {porciones.map((p) => (
                <div key={p.etiqueta}>
                  <span className="punto" style={{ background: p.color }} />
                  <span>
                    <span style={{ color: "var(--ink-2)", display: "block" }}>{p.etiqueta}</span>
                    <span className="valor">{p.valor}</span>
                    <span className="pct">{pct(total === 0 ? 0 : (p.valor / total) * 100)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 12.5 }}>
            <span style={{ color: "var(--ink-2)" }}>Total de leads de anuncios</span>
            <strong className="num" style={{ fontSize: 15 }}>{total}</strong>
          </div>
        </>
      )}
    </section>
  );
}

type FilaCanal = Metricas["por_canal"][number];

interface Enlaces {
  leads: string;
  conversaciones: string;
  automatizada: string;
  asistida: string;
  revision: string;
  ver: string;
}

/** Una cifra que se puede abrir cuando es mayor que cero. */
function Cifra({ n, href }: { n: number; href: string }) {
  if (n === 0) return <span className="sd-cero">0</span>;
  return <Link href={href} className="sd-cifra">{n}</Link>;
}

/**
 * LA TABLA DE RENDIMIENTO, una por tipo de canal. Cada fila es una línea de
 * WhatsApp o una página de Meta, con sus leads, sus cierres, su tasa y lo que
 * facturó en su moneda. El pie suma las columnas, y el dinero se apila moneda
 * por moneda porque no se suma entre países.
 */
function TablaRendimiento({
  titulo,
  subtitulo,
  insignia,
  cabecera,
  pie,
  filas,
  parametros,
  vacio,
  enlaces,
}: {
  titulo: string;
  subtitulo: string;
  insignia: React.ReactNode;
  cabecera: string;
  pie: string;
  filas: FilaCanal[];
  parametros: URLSearchParams;
  vacio: string;
  enlaces: (c: FilaCanal) => Enlaces;
}) {
  const total = filas.reduce(
    (a, c) => ({
      leads: a.leads + c.leads_anuncio,
      conversaciones: a.conversaciones + c.leads,
      ia: a.ia + c.cierres_ia,
      humano: a.humano + c.cierres_humano,
      sin_cerrar: a.sin_cerrar + c.sin_cerrar,
      revision: a.revision + c.revision,
    }),
    { leads: 0, conversaciones: 0, ia: 0, humano: 0, sin_cerrar: 0, revision: 0 },
  );
  const tasaTotal = total.conversaciones === 0 ? 0 : Math.round(((total.ia + total.humano) / total.conversaciones) * 1000) / 10;

  // El dinero del pie, moneda por moneda.
  const porMoneda = new Map<string, { moneda: Moneda; facturado: number }>();
  for (const c of filas) {
    const f = porMoneda.get(c.moneda.codigo) ?? { moneda: c.moneda, facturado: 0 };
    f.facturado += c.ventas;
    porMoneda.set(c.moneda.codigo, f);
  }

  return (
    <section className="tarjeta" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <h2 className="titulo-tarjeta">{titulo}</h2>
          <div className="tenue">{subtitulo}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {insignia}
          <Link href={`/api/informe?${parametros.toString()}`} className="btn btn-tenue" style={{ textDecoration: "none", padding: "5px 10px", fontSize: 12.5 }}>
            <IconoDescargar tam={14} /> Exportar
          </Link>
        </div>
      </div>

      {filas.length === 0 ? (
        <Vacio titulo="Nada conectado todavía" texto={vacio} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tabla sd-rendimiento">
            <thead>
              <tr>
                <th>{cabecera}</th>
                <th>Leads</th>
                <th>Conversaciones</th>
                <th>Automatizada</th>
                <th>Asistida</th>
                <th>Sin cerrar</th>
                <th>Revisión</th>
                <th>Tasa</th>
                <th>Facturado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => {
                const e = enlaces(c);
                const detalle = !c.vinculado
                  ? "sin vincular"
                  : c.tipo === "meta"
                    ? `Página de Facebook · ${paisCorto(c.pais_nombre)}`
                    : `${c.phone ? `+${c.phone}` : ""} · ${c.estado === "conectado" ? paisCorto(c.pais_nombre) : c.estado}`;
                return (
                  <tr key={c.canal_id} style={{ opacity: c.vinculado ? 1 : 0.6 }}>
                    <td>
                      <div className="sd-linea" style={{ borderLeftColor: c.vinculado ? "var(--acc)" : "var(--line-2)" }}>
                        <div className="sd-linea-nombre">{c.nombre}</div>
                        <div className="sd-linea-detalle">
                          {c.vinculado && c.tipo !== "meta" && c.estado !== "conectado" ? (
                            <>
                              {c.phone ? `+${c.phone} · ` : ""}
                              <span className="caido">{c.estado}</span>
                            </>
                          ) : (
                            detalle
                          )}
                        </div>
                      </div>
                    </td>
                    <td><Cifra n={c.leads_anuncio} href={e.leads} /></td>
                    <td><Cifra n={c.leads} href={e.conversaciones} /></td>
                    <td><Cifra n={c.cierres_ia} href={e.automatizada} /></td>
                    <td><Cifra n={c.cierres_humano} href={e.asistida} /></td>
                    <td>{c.sin_cerrar === 0 ? <span className="sd-cero">0</span> : c.sin_cerrar}</td>
                    <td>
                      {c.revision === 0 ? <span className="sd-cero">0</span> : <Link href={e.revision} className="sd-cifra">{c.revision}</Link>}
                    </td>
                    <td>
                      <span className="sd-tasa">
                        <span className="sd-minibarra">
                          <span style={{ display: "block", width: `${Math.min(c.tasa, 100)}%`, height: "100%", background: "var(--acc)" }} />
                        </span>
                        {pct(c.tasa)}
                      </span>
                    </td>
                    <td>
                      <span className="sd-apilado">
                        <span style={{ fontWeight: 600, color: c.ventas > 0 ? "var(--ink)" : "var(--ink-4)" }}>
                          {c.vinculado ? dinero(c.ventas, c.moneda) : "—"}
                        </span>
                        {c.sin_monto > 0 && <span className="sd-sin-monto">{c.sin_monto} sin monto</span>}
                      </span>
                    </td>
                    <td>
                      {!c.vinculado ? null : c.revision > 0 ? (
                        <Link href={e.revision} className="btn btn-secundario" style={{ textDecoration: "none", padding: "5px 11px", fontSize: 12.5 }}>
                          Revisar
                        </Link>
                      ) : (
                        <Link href={e.ver} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", textDecoration: "none" }}>
                          Ver
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{pie}</td>
                <td>{total.leads}</td>
                <td>{total.conversaciones}</td>
                <td style={{ color: "var(--acc)" }}>{total.ia}</td>
                <td style={{ color: "var(--blue)" }}>{total.humano}</td>
                <td>{total.sin_cerrar}</td>
                <td style={{ color: total.revision > 0 ? "var(--amber)" : undefined }}>{total.revision}</td>
                <td>{pct(tasaTotal)}</td>
                <td>
                  <span className="sd-apilado">
                    {[...porMoneda.values()].map((f) => (
                      <span key={f.moneda.codigo || "sin"}>{dinero(f.facturado, f.moneda)}</span>
                    ))}
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
