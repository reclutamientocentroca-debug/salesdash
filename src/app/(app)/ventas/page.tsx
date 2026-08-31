import Link from "next/link";
import AnalizarPerdidas from "@/components/panel/AnalizarPerdidas";
import { Kpi, Pastilla, Vacio, dinero, fechaCorta } from "@/components/panel/Piezas";
import { IconoMoneda, IconoPersona, IconoRayo, IconoVentas } from "@/components/panel/Iconos";
import { conteoMotivosPerdida, listarCanales, listarConversaciones } from "@/lib/db";
import { calcularMetricas } from "@/lib/metrics";
import { rangoDesdeQuery, requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Ventas · SalesDash" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ rango?: string; desde?: string; hasta?: string }>;
}

export default async function PaginaVentas({ searchParams }: Props) {
  const ctx = await requerirSesion();
  const { rango: clave = "7d", desde, hasta } = await searchParams;

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

  const rango = rangoDesdeQuery(parametros);

  const m = calcularMetricas(ctx.orgId, rango);
  const nombres = new Map(listarCanales(ctx.orgId).map((c) => [c.id, c.nombre]));
  const motivos = conteoMotivosPerdida(ctx.orgId, rango);

  const ventas = [
    ...listarConversaciones(ctx.orgId, { ...rango, estado: "ia", limite: 100 }),
    ...listarConversaciones(ctx.orgId, { ...rango, estado: "humano", limite: 100 }),
  ].sort((a, b) => (b.fecha_cierre ?? 0) - (a.fecha_cierre ?? 0));

  const totalPerdidas = motivos.reduce((n, x) => n + x.n, 0);

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Ventas</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            {ventas.length} venta{ventas.length === 1 ? "" : "s"} cerrada{ventas.length === 1 ? "" : "s"} en el rango
          </p>
        </div>
      </div>

      <div className="sd-kpis" style={{ marginBottom: 14 }}>
        {/* Las mismas palabras que el dashboard: «facturado» es el pedido sin
            el envío, aquí y allí. Dos pantallas con el mismo número no pueden
            llamarlo distinto. */}
        <Kpi
          etiqueta="Facturado"
          valor={dinero(m.facturado)}
          icono={<IconoMoneda tam={17} />}
          tono="ambar"
          pie={`${dinero(m.envios_cobrados)} de envíos aparte`}
        />
        <Kpi etiqueta="Promedio por pedido" valor={dinero(m.valor_promedio_venta)} icono={<IconoVentas tam={17} />} tono="neutro" />
        <Kpi
          etiqueta="Automatizada"
          valor={m.cierres_ia}
          icono={<IconoRayo tam={17} />}
          tono="acento"
          pie={`${dinero(m.facturado_ia)} facturados`}
        />
        <Kpi
          etiqueta="Asistida"
          valor={m.cierres_humano}
          icono={<IconoPersona tam={17} />}
          tono="azul"
          pie={`${dinero(m.facturado_humano)} facturados`}
        />
      </div>

      <div className="sd-fila-3">
        <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
          <h2 className="titulo-tarjeta" style={{ padding: "16px 17px 12px" }}>Cada venta</h2>

          {ventas.length === 0 ? (
            <Vacio
              titulo="Aún no hay ventas cerradas en este rango"
              texto="Analiza tus conversaciones para que el analista detecte los cierres."
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
                      <td style={{ textAlign: "right" }}>{dinero(v.total)}</td>
                      <td className="tenue" style={{ textAlign: "right" }}>{dinero(v.envio)}</td>
                      {/* La resta a la vista: es de donde sale el KPI de arriba,
                          y con las tres columnas nadie tiene que fiarse. */}
                      <td style={{ textAlign: "right", fontWeight: 600 }}>
                        {dinero(Math.max((v.total ?? 0) - (v.envio ?? 0), 0))}
                      </td>
                      <td className="tenue" style={{ textAlign: "right", paddingRight: 17 }}>
                        {fechaCorta(v.fecha_cierre)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
