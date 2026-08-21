import Link from "next/link";
import {
  Donut,
  GraficoArea,
  Kpi,
  LeyendaGrafico,
  Meta,
  Vacio,
  dinero,
} from "@/components/panel/Piezas";
import {
  IconoConversaciones,
  IconoMoneda,
  IconoPersona,
  IconoRayo,
  IconoReloj,
  IconoRevision,
} from "@/components/panel/Iconos";
import { contarCanales, contarRevisiones, listarAnomalias } from "@/lib/db";
import { calcularMetricas, formatearDuracion } from "@/lib/metrics";
import { rangoAEpochs, requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Dashboard · SalesDash" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ rango?: string }>;
}

export default async function Dashboard({ searchParams }: Props) {
  const ctx = await requerirSesion();
  const { rango: clave = "7d" } = await searchParams;

  const rango = rangoAEpochs(clave);
  const m = calcularMetricas(ctx.orgId, rango);
  const anomalias = listarAnomalias(ctx.orgId);
  const enRevision = contarRevisiones(ctx.orgId);
  const numeros = contarCanales(ctx.orgId);

  /*
   * Sin números conectados NO se sustituye el panel por una pantalla vacía.
   * El dashboard se enseña entero, con sus ceros, y la invitación a conectar
   * va en una franja arriba. Un panel completo en cero comunica qué vas a
   * tener; una pantalla vacía no comunica nada y parece un producto a medio
   * hacer.
   */
  const sinConectar = numeros === 0;
  const altas = anomalias.filter((a) => a.severidad === "alta").length;

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Dashboard</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            {m.leads} leads en el rango · {m.escribieron_por_su_cuenta} escribieron por su cuenta
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {enRevision > 0 && (
            <Link href="/revision" className="btn btn-secundario" style={{ textDecoration: "none" }}>
              <IconoRevision />
              {enRevision} sin clasificar
            </Link>
          )}
          {altas > 0 && (
            <Link href="/conversaciones" className="btn btn-secundario" style={{ textDecoration: "none", color: "var(--red)" }}>
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
          Los números no cuadran: hay {m.leads} leads pero {m.cierres_ia + m.cierres_humano + m.sin_cerrar + m.revision}{" "}
          conversaciones clasificadas. Alguna se está perdiendo y el reporte no es fiable.
        </div>
      )}

      <div className="sd-kpis" style={{ marginBottom: 14 }}>
        <Kpi
          etiqueta="Leads"
          valor={m.leads}
          icono={<IconoConversaciones tam={17} />}
          tono="neutro"
          pie={`${m.escribieron_por_su_cuenta} por su cuenta`}
        />
        <Kpi
          etiqueta="Cerró la IA"
          valor={m.cierres_ia}
          icono={<IconoRayo tam={17} />}
          tono="acento"
          pie={`${m.tasa_cierre_ia}% de los leads`}
        />
        <Kpi
          etiqueta="Cerró el equipo"
          valor={m.cierres_humano}
          icono={<IconoPersona tam={17} />}
          tono="azul"
          pie={`${formatearDuracion(m.tiempo_promedio_humano)} de media`}
        />
        <Kpi
          etiqueta="Ventas generadas"
          valor={dinero(m.ventas_generadas)}
          icono={<IconoMoneda tam={17} />}
          tono="ambar"
          pie={`${dinero(m.valor_promedio_venta)} por venta`}
        />
      </div>

      <div className="sd-fila-2" style={{ marginBottom: 14 }}>
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 10 }}>Leads y cierres por día</h2>
          <GraficoArea serie={m.serie_diaria} />
          {m.serie_diaria.length >= 2 && <LeyendaGrafico />}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Quién cerró</h2>
          <Donut
            centro={`${m.cobertura_ia.valor}%`}
            pie="lo cerró la IA"
            porciones={[
              { etiqueta: "IA", valor: m.cierres_ia, color: "var(--acc)" },
              { etiqueta: "Equipo", valor: m.cierres_humano, color: "var(--blue)" },
            ]}
          />
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Resumen</h2>

          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <Meta
              etiqueta="Cobertura de la IA"
              valor={m.cobertura_ia.valor}
              meta={m.cobertura_ia.meta}
              estado={m.cobertura_ia.estado}
            />
            <Meta
              etiqueta="Efectividad del equipo"
              valor={m.efectividad_humana.valor}
              meta={m.efectividad_humana.meta}
              estado={m.efectividad_humana.estado}
            />
          </div>

          <ul style={{ display: "grid", gap: 9 }}>
            <FilaResumen
              icono={<IconoReloj tam={15} />}
              etiqueta="La IA tarda"
              valor={formatearDuracion(m.tiempo_promedio_ia)}
            />
            <FilaResumen
              icono={<IconoPersona tam={15} />}
              etiqueta="El equipo tarda"
              valor={formatearDuracion(m.tiempo_promedio_humano)}
            />
            <FilaResumen
              icono={<IconoConversaciones tam={15} />}
              etiqueta="Sin cerrar"
              valor={String(m.sin_cerrar)}
            />
            <FilaResumen
              icono={<IconoRevision tam={15} />}
              etiqueta="En revisión"
              valor={String(m.revision)}
            />
          </ul>
        </section>
      </div>

      <div className="sd-fila-3">
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Rendimiento por número</h2>

          {m.por_canal.length === 0 ? (
            <Vacio titulo="Sin actividad en este rango" texto="Prueba con un rango de fechas más amplio." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th style={{ textAlign: "right" }}>Leads</th>
                    <th style={{ textAlign: "right" }}>IA</th>
                    <th style={{ textAlign: "right" }}>Equipo</th>
                    <th style={{ textAlign: "right" }}>Tasa</th>
                    <th style={{ textAlign: "right" }}>Ventas</th>
                  </tr>
                </thead>
                <tbody>
                  {m.por_canal.map((c) => (
                    <tr key={c.canal_id}>
                      <td>
                        <div className="sd-franja">
                          <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                          <div className="tenue">{c.phone ?? "sin vincular"}</div>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>{c.leads}</td>
                      <td style={{ textAlign: "right", color: "var(--acc)" }}>{c.cierres_ia}</td>
                      <td style={{ textAlign: "right", color: "var(--blue)" }}>{c.cierres_humano}</td>
                      <td style={{ textAlign: "right", minWidth: 66 }}>
                        {c.tasa}%
                        <div className="sd-minibarra">
                          <div style={{ width: `${Math.min(c.tasa, 100)}%`, height: "100%", background: "var(--acc)" }} />
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>{dinero(c.ventas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Lo que más se vende</h2>

          {m.top_productos.length === 0 ? (
            <Vacio
              titulo="Aún no hay ventas con producto"
              texto="Analiza tus conversaciones para que aparezca qué se vendió."
            />
          ) : (
            <ol style={{ display: "grid", gap: 11 }}>
              {m.top_productos.map((p, i) => (
                <li key={p.producto} style={{ display: "flex", gap: 11, alignItems: "baseline" }}>
                  <span className="num" style={{ color: "var(--ink-4)", fontSize: 12.5, width: 14 }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, minWidth: 0 }}>{p.producto}</span>
                  <span style={{ textAlign: "right" }}>
                    <span className="num" style={{ fontWeight: 600, fontSize: 13 }}>{dinero(p.monto)}</span>
                    <span className="tenue" style={{ display: "block" }}>
                      {p.unidades} venta{p.unidades === 1 ? "" : "s"}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

function FilaResumen({
  icono,
  etiqueta,
  valor,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  valor: string;
}) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
      <span style={{ color: "var(--ink-3)", display: "flex" }}>{icono}</span>
      <span style={{ flex: 1, color: "var(--ink-2)" }}>{etiqueta}</span>
      <span className="num" style={{ fontWeight: 600 }}>{valor}</span>
    </li>
  );
}
