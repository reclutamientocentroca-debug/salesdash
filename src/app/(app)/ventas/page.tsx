import Link from "next/link";
import AnalizarPerdidas from "@/components/panel/AnalizarPerdidas";
import { FilasPorMoneda, Importes, Kpi, Pastilla, Vacio, dinero, fechaCorta } from "@/components/panel/Piezas";
import { IconoMoneda, IconoPersona, IconoRayo, IconoVentas } from "@/components/panel/Iconos";
import { conteoMotivosPerdida, listarCanales, listarVentas } from "@/lib/db";
import { calcularMetricas } from "@/lib/metrics";
import { rangoDeLaCuenta, requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Ventas · SalesDash" };
export const dynamic = "force-dynamic";

/**
 * Cuántas ventas se listan por estado. Es un tope de la PÁGINA, no del cálculo:
 * los KPIs y el pie del periodo salen de SQL sobre todas. Existe para que una
 * cuenta con años de historia no intente pintar veinte mil filas de golpe.
 */
const LIMITE_LISTA = 500;

interface Props {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string; cerro?: string; canal?: string; solo?: string }>;
}

export default async function PaginaVentas({ searchParams }: Props) {
  const ctx = await requerirSesion();
  const { rango: clave = "7d", desde, hasta, cerro: cerroParam, canal: canalParam, solo } = await searchParams;

  /*
   * El mismo periodo que el resto del panel: la clave de rango, y por encima
   * las fechas exactas del calendario si el usuario eligió unas. Si Ventas
   * ignorara `desde`/`hasta`, elegir un periodo en la barra lateral cambiaría
   * el dashboard y dejaría esta página hablando de otras semanas sin avisar.
   */
  const parametros = new URLSearchParams();
  parametros.set("rango", clave);
  if (desde) parametros.set("desde", desde);
  if (hasta) parametros.set("hasta", hasta);

  /*
   * Los filtros de la lista, también en la URL: quién cerró (`cerro`), qué
   * número (`canal`) y si solo cuentan los leads de anuncio (`solo`). Son los
   * que trae el enlace de cada cifra del dashboard, para que «Automatizada 3»
   * de un número abra esas tres ventas y no otras.
   */
  const cerro = cerroParam === "ia" || cerroParam === "humano" ? cerroParam : undefined;
  const canales = listarCanales(ctx.orgId);
  const canal = canales.find((c) => c.id === Number(canalParam));
  const soloAnuncio = solo === "anuncio";
  if (canal) parametros.set("canal", String(canal.id));
  if (soloAnuncio) parametros.set("solo", "anuncio");

  const rango = { ...rangoDeLaCuenta(ctx.orgId, parametros), canalId: canal?.id, soloAnuncio };

  const m = calcularMetricas(ctx.orgId, rango);
  const nombres = new Map(canales.map((c) => [c.id, c.nombre]));
  // Cada venta se escribe en la moneda del número por el que entró.
  const monedas = new Map(m.por_canal.map((c) => [c.canal_id, c.moneda]));
  const motivos = conteoMotivosPerdida(ctx.orgId, rango);

  // Por el día en que se CERRÓ, como los KPIs: ver `listarVentas`.
  const ventas = listarVentas(ctx.orgId, rango, { cerradoPor: cerro, limite: LIMITE_LISTA });

  /** La misma página con un filtro puesto o quitado; el periodo se queda. */
  const url = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(parametros);
    if (cerro) p.set("cerro", cerro);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    return `/ventas?${p.toString()}`;
  };

  const totalPerdidas = motivos.reduce((n, x) => n + x.n, 0);

  /*
   * El pie de la tabla: cada columna sumada.
   *
   * Se suman las filas que se están viendo, no las cifras del periodo, y por eso
   * el pie cuadra con lo que hay encima: si alguien repasa la columna con el
   * dedo tiene que llegar al mismo número. `Facturado` se suma con la MISMA
   * resta de cada fila —total menos envío, nunca por debajo de cero—, que es la
   * de `facturado()` en SQL: dos maneras de sumar lo mismo darían dos cifras y
   * una de las dos estaría mal.
   */
  const suma = ventas.reduce(
    (a, v) => ({
      total: a.total + (v.total ?? 0),
      envio: a.envio + (v.envio ?? 0),
      facturado: a.facturado + Math.max((v.total ?? 0) - (v.envio ?? 0), 0),
    }),
    { total: 0, envio: 0, facturado: 0 },
  );

  /*
   * La lista tiene tope; el periodo, no. Cuando se queda corta, el pie sumaría
   * menos que el KPI de arriba sin explicar por qué: se dice cuántas se están
   * listando y cuál es el facturado del periodo entero.
   */
  const cerradasDelPeriodo = m.cierres_ia + m.cierres_humano;
  const cerradasListables = cerro === "ia" ? m.cierres_ia : cerro === "humano" ? m.cierres_humano : cerradasDelPeriodo;
  const listaIncompleta = ventas.length < cerradasListables;
  const campoFacturado = cerro === "ia" ? "facturado_ia" : cerro === "humano" ? "facturado_humano" : "facturado";
  const queCerro = cerro === "ia" ? "automatizada" : cerro === "humano" ? "asistida" : "";

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Ventas</h1>
          {/* Las del periodo, no las que quepan en la tabla: el subtítulo
              cuenta lo que pasó, y la tabla enseña lo que cabe. */}
          <p className="tenue" style={{ marginTop: 2 }}>
            {cerradasDelPeriodo} venta{cerradasDelPeriodo === 1 ? "" : "s"} cerrada
            {cerradasDelPeriodo === 1 ? "" : "s"} en el rango ·{" "}
            <Importes lista={m.facturado_por_moneda} campo="facturado" /> facturados
          </p>
        </div>
      </div>

      <div className="sd-kpis" style={{ marginBottom: 14 }}>
        {/* Las mismas palabras que el dashboard: «facturado» es el pedido sin
            el envío, aquí y allí. Dos pantallas con el mismo número no pueden
            llamarlo distinto. */}
        {/* Con varias monedas no hay una cifra: el dinero va moneda por moneda. */}
        <Kpi
          etiqueta="Facturado"
          valor={m.una_moneda ? dinero(m.facturado, m.una_moneda) : `${cerradasDelPeriodo} venta${cerradasDelPeriodo === 1 ? "" : "s"}`}
          icono={<IconoMoneda tam={17} />}
          tono="ambar"
          pie={
            <>
              {!m.una_moneda && (
                <>
                  <Importes lista={m.facturado_por_moneda} campo="facturado" color="var(--amber)" />
                  <br />
                </>
              )}
              <Importes lista={m.facturado_por_moneda} campo="envios" /> de envíos aparte
            </>
          }
        />
        <Kpi
          etiqueta="Promedio por pedido"
          valor={m.una_moneda ? dinero(m.valor_promedio_venta, m.una_moneda) : "por moneda"}
          icono={<IconoVentas tam={17} />}
          tono="neutro"
          pie={m.una_moneda ? undefined : <Importes lista={m.facturado_por_moneda} campo="promedio" />}
        />
        {/* Las dos tarjetas de quién cerró filtran la tabla: un clic y quedan
            solo esas ventas del periodo, con su dinero; otro clic, todas. */}
        <Link
          href={url({ cerro: cerro === "ia" ? null : "ia" })}
          className="sd-kpi-filtro acento"
          aria-current={cerro === "ia" ? "true" : undefined}
          title={cerro === "ia" ? "Ver todas las ventas" : "Ver solo las ventas automatizadas"}
        >
          <Kpi
            etiqueta="Automatizada"
            valor={m.cierres_ia}
            icono={<IconoRayo tam={17} />}
            tono="acento"
            pie={<><Importes lista={m.facturado_por_moneda} campo="facturado_ia" color="var(--acc)" /> facturados</>}
          />
        </Link>
        <Link
          href={url({ cerro: cerro === "humano" ? null : "humano" })}
          className="sd-kpi-filtro azul"
          aria-current={cerro === "humano" ? "true" : undefined}
          title={cerro === "humano" ? "Ver todas las ventas" : "Ver solo las ventas asistidas"}
        >
          <Kpi
            etiqueta="Asistida"
            valor={m.cierres_humano}
            icono={<IconoPersona tam={17} />}
            tono="azul"
            pie={<><Importes lista={m.facturado_por_moneda} campo="facturado_humano" color="var(--blue)" /> facturados</>}
          />
        </Link>
      </div>

      <div className="sd-fila-3">
        <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
          <div className="sd-ventas-cabecera">
            <h2 className="titulo-tarjeta">
              {cerro === "ia" ? "Ventas automatizadas" : cerro === "humano" ? "Ventas asistidas" : "Cada venta"}
            </h2>
            {/* Lo que está filtrando la tabla, a la vista y con su equis: una
                lista recortada sin decir por qué parece una lista incompleta. */}
            {(cerro || canal || soloAnuncio) && (
              <div className="sd-ventas-filtros">
                {cerro && (
                  <Link href={url({ cerro: null })} className={`sd-filtro-quitar ${cerro === "ia" ? "acento" : "azul"}`}>
                    Solo {queCerro}s <span aria-hidden>×</span>
                  </Link>
                )}
                {canal && (
                  <Link href={url({ canal: null })} className="sd-filtro-quitar">
                    {canal.nombre} <span aria-hidden>×</span>
                  </Link>
                )}
                {soloAnuncio && (
                  <Link href={url({ solo: null })} className="sd-filtro-quitar">
                    Solo leads de anuncio <span aria-hidden>×</span>
                  </Link>
                )}
              </div>
            )}
          </div>

          {ventas.length === 0 ? (
            <Vacio
              titulo={cerro ? `No hubo ventas ${queCerro}s en este rango` : "Aún no hay ventas cerradas en este rango"}
              texto={
                cerro
                  ? "Elige otro periodo en el calendario, o quita el filtro para ver todas las ventas."
                  : "Analiza tus conversaciones para que el analista detecte los cierres."
              }
            />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tabla tabla-hover">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 17 }}>Cliente</th>
                    <th>Producto</th>
                    <th>Número</th>
                    <th>Cerró</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th style={{ textAlign: "right" }}>Envío</th>
                    <th style={{ textAlign: "right" }}>Facturado</th>
                    <th style={{ textAlign: "right", paddingRight: 17 }}>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((v) => (
                    <tr key={v.id}>
                      <td style={{ paddingLeft: 17 }}>
                        <Link href={`/conversaciones/${v.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                          <div style={{ fontWeight: 600 }}>{v.cliente_nombre ?? "Sin nombre"}</div>
                          <div className="num tenue">+{v.cliente_phone}</div>
                        </Link>
                      </td>
                      <td>{v.producto_vendido ?? <span className="tenue">sin identificar</span>}</td>
                      <td style={{ color: "var(--ink-2)" }}>{nombres.get(v.canal_id) ?? "—"}</td>
                      <td><Pastilla estado={v.cerrado_por} /></td>
                      <td className="num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{dinero(v.total, monedas.get(v.canal_id))}</td>
                      <td className="num tenue" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{dinero(v.envio, monedas.get(v.canal_id))}</td>
                      {/* La resta a la vista: es de donde sale el KPI de arriba,
                          y con las tres columnas nadie tiene que fiarse. */}
                      <td className="num" style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {dinero(Math.max((v.total ?? 0) - (v.envio ?? 0), 0), monedas.get(v.canal_id))}
                      </td>
                      <td className="tenue" style={{ textAlign: "right", paddingRight: 17 }}>
                        {fechaCorta(v.fecha_cierre)}
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* La suma de cada columna de dinero, al pie de su columna.
                    «Facturado» es la que manda: el total menos los envíos, que
                    es lo que el negocio se queda. */}
                <tfoot>
                  <tr>
                    <td style={{ paddingLeft: 17 }} colSpan={4}>
                      <span className="rotulo-total">
                        Total de {ventas.length} venta{ventas.length === 1 ? "" : "s"}
                      </span>
                    </td>
                    {/* Con una sola moneda, la suma de la columna; con varias, la
                        suma no existe y el pie enseña lo facturado por moneda. */}
                    <td className="num" style={{ textAlign: "right" }}>{m.una_moneda ? dinero(suma.total, m.una_moneda) : "—"}</td>
                    <td className="num" style={{ textAlign: "right" }}>{m.una_moneda ? dinero(suma.envio, m.una_moneda) : "—"}</td>
                    <td className="num" style={{ textAlign: "right", color: "var(--amber)", whiteSpace: "nowrap" }}>
                      {m.una_moneda ? dinero(suma.facturado, m.una_moneda) : <FilasPorMoneda lista={m.facturado_por_moneda} campo={campoFacturado} color="var(--amber)" />}
                    </td>
                    <td style={{ paddingRight: 17 }} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {listaIncompleta && (
            <p className="tenue" style={{ padding: "10px 17px 14px" }}>
              Se listan las {ventas.length} ventas{queCerro ? ` ${queCerro}s` : ""} más recientes de {cerradasListables}. El facturado
              del periodo completo es <Importes lista={m.facturado_por_moneda} campo={campoFacturado} />; usa un rango más corto para ver todas.
            </p>
          )}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Por qué no cerraron</h2>
          <p className="tenue" style={{ marginBottom: 14 }}>
            {m.sin_cerrar} conversaciones se quedaron sin cerrar. Este suele ser el grupo más grande
            y el que nadie sabe explicar.
          </p>

          {totalPerdidas === 0 ? (
            <Vacio
              titulo="Sin analizar todavía"
              texto="Analiza una muestra para descubrir qué las está frenando."
              accion={<AnalizarPerdidas consulta={parametros.toString()} />}
            />
          ) : (
            <>
              <ul style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                {motivos.map((x) => (
                  <li key={x.motivo}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ textTransform: "capitalize" }}>{x.motivo}</span>
                      <span className="num" style={{ fontWeight: 600 }}>{x.n}</span>
                    </div>
                    <div style={{ height: 4, background: "var(--soft)", borderRadius: 2, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${(x.n / totalPerdidas) * 100}%`,
                          height: "100%",
                          background: x.motivo === "sin clasificar" ? "var(--ink-4)" : "var(--amber)",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <AnalizarPerdidas consulta={parametros.toString()} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
