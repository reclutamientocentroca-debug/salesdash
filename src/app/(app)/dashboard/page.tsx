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
import { rangoDesdeQuery, requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Dashboard · SalesDash" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ rango?: string; solo?: string; desde?: string; hasta?: string }>;
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

  /*
   * Fechas exactas por encima de la clave de rango.
   *
   * Los rangos de la barra lateral —hoy, 7 días, este mes— resuelven casi
   * todo, pero no «desde el martes pasado». `?desde=…&hasta=…` en segundos sí,
   * y como vive en la URL, ese periodo se puede guardar en marcadores, mandar
   * por chat y descargar, que es de donde salió la necesidad.
   */
  const parametros = new URLSearchParams();
  parametros.set("rango", clave);
  if (desde) parametros.set("desde", desde);
  if (hasta) parametros.set("hasta", hasta);
  if (soloAnuncio) parametros.set("solo", "anuncio");

  const rango = { ...rangoDesdeQuery(parametros), soloAnuncio };
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

  /*
   * El pie de «Rendimiento por número»: cada columna sumada.
   *
   * Se suman las FILAS que se están viendo y no las cifras sueltas del periodo,
   * aunque valgan lo mismo: el pie de una tabla es la promesa de que esa
   * columna suma eso, y quien la repase con el dedo tiene que llegar al mismo
   * número. `facturado` es el total menos los envíos, la misma resta de la
   * tarjeta de arriba.
   */
  const totalCanales = m.por_canal.reduce(
    (a, c) => ({
      leads: a.leads + c.leads,
      leads_anuncio: a.leads_anuncio + c.leads_anuncio,
      cierres_ia: a.cierres_ia + c.cierres_ia,
      cierres_humano: a.cierres_humano + c.cierres_humano,
      sin_cerrar: a.sin_cerrar + c.sin_cerrar,
      revision: a.revision + c.revision,
      facturado: a.facturado + c.ventas,
    }),
    { leads: 0, leads_anuncio: 0, cierres_ia: 0, cierres_humano: 0, sin_cerrar: 0, revision: 0, facturado: 0 },
  );

  const tasaTotal =
    totalCanales.leads === 0
      ? 0
      : Math.round(((totalCanales.cierres_ia + totalCanales.cierres_humano) / totalCanales.leads) * 1000) / 10;

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Dashboard</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            {soloAnuncio
              ? `${m.leads} leads por anuncio · el resto del panel no los cuenta`
              : `${m.leads_anuncio} leads por anuncio · ${m.leads} conversaciones en total`}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/*
            El interruptor de quién entra en el panel. Apagado, el panel cuenta
            toda conversación y «Leads por anuncio» es una cifra más dentro;
            encendido, TODO —la rosca, lo facturado, las tasas, el gráfico y la
            tabla por número— habla solo de la gente que trajo un anuncio.

            Es un enlace y no un interruptor de cliente porque el filtro se
            aplica en el SQL: la página se vuelve a pintar con otras cifras, no
            esconde las que ya estaban.
          */}
          <Link
            href={(() => {
              const p = new URLSearchParams(parametros);
              if (soloAnuncio) p.delete("solo");
              else p.set("solo", "anuncio");
              return `/dashboard?${p.toString()}`;
            })()}
            className={`btn ${soloAnuncio ? "btn-acento" : "btn-secundario"}`}
            style={{ textDecoration: "none" }}
            aria-pressed={soloAnuncio}
          >
            {soloAnuncio ? "Solo leads de anuncio" : "Contando a todos"}
          </Link>

          {/*
            El panel que se está viendo, en un archivo. Lleva los MISMOS
            parámetros que la página —el rango, las fechas exactas si las hay y
            el filtro—, así que lo que se baja es lo que hay en pantalla y no
            otra cosa parecida. Un resumen que no coincide con el panel del que
            salió no se puede enseñar a nadie.
          */}
          <Link
            href={`/api/informe?${parametros.toString()}`}
            className="btn btn-secundario"
            style={{ textDecoration: "none" }}
          >
            Descargar resumen
          </Link>

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
        {/*
          «Leads» son los que llegaron por un anuncio, no todo el que escribe.
          Es la pregunta que se hace de verdad quien paga publicidad: cuánta
          gente me trajo. El total queda al lado porque sigue siendo la base de
          la invariante de conteo y de los porcentajes de cierre.
        */}
        <Kpi
          etiqueta="Leads por anuncio"
          valor={m.leads_anuncio}
          icono={<IconoConversaciones tam={17} />}
          tono="acento"
          pie={
            soloAnuncio
              ? `${m.tasa_cierre_anuncio}% cerrados · nadie más entra en el panel`
              : `de ${m.leads} conversaciones · ${m.tasa_cierre_anuncio}% cerrados`
          }
        />
        {/*
          «de las conversaciones» y no «de los leads»: aquí arriba «lead» ya
          significa el que trajo un anuncio, y este porcentaje se calcula sobre
          el total. Dos palabras distintas para dos denominadores distintos.

          Debajo del número va el dinero que esos cierres facturaron, sin el
          envío. Un contador de cierres no dice si la IA está vendiendo o solo
          despachando pedidos de mil pesos; el importe sí, y es la respuesta a
          «¿qué me está dejando esto?» sin tener que cruzar dos tarjetas.
        */}
        <Kpi
          etiqueta="Automatizada"
          valor={m.cierres_ia}
          icono={<IconoRayo tam={17} />}
          tono="acento"
          pie={
            <>
              {m.tasa_cierre_ia}% {soloAnuncio ? "de los leads de anuncio" : "de las conversaciones"}
              <br />
              <strong style={{ color: "var(--acc)" }}>{dinero(m.facturado_ia)}</strong> facturados
            </>
          }
        />
        {/* El equipo lleva su importe por la misma razón: con uno solo de los
            dos números en pantalla no se puede comparar, que es justo lo que se
            quiere saber cuando se mira esta fila. */}
        <Kpi
          etiqueta="Asistida"
          valor={m.cierres_humano}
          icono={<IconoPersona tam={17} />}
          tono="azul"
          pie={
            <>
              {formatearDuracion(m.tiempo_promedio_humano)} de media
              <br />
              <strong style={{ color: "var(--blue)" }}>{dinero(m.facturado_humano)}</strong> facturados
            </>
          }
        />
        {/*
          Facturado, no cobrado: el envío se le cobra al cliente y se le paga al
          mensajero, así que sumarlo aquí inflaría la cifra justo con el dinero
          que el negocio no se queda. Va en el pie para que el total siga
          cuadrando con lo que el dueño ve en su cuenta.

          Arriba el total de la cuenta entera y debajo canal por canal, porque
          con un solo número no se sabe si el mes lo sostiene una tienda o si
          está repartido —y eso cambia qué se hace con él—. Los canales en cero
          se enseñan igual: están conectados y no están vendiendo, que es
          exactamente lo que hay que ver.
        */}
        <Kpi
          etiqueta="Facturado"
          valor={dinero(m.facturado)}
          icono={<IconoMoneda tam={17} />}
          tono="ambar"
          pie={`${dinero(m.valor_promedio_venta)} por pedido · ${dinero(m.envios_cobrados)} de envíos aparte`}
          cuerpo={<FacturadoPorCanal canales={m.facturado_por_canal} />}
        />
      </div>

      <div className="sd-fila-2" style={{ marginBottom: 14 }}>
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 10 }}>Quién llega y quién cierra, por día</h2>
          <GraficoArea serie={m.serie_diaria} soloAnuncio={soloAnuncio} />
          {m.serie_diaria.length >= 2 && <LeyendaGrafico soloAnuncio={soloAnuncio} />}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Quién cerró</h2>
          <Donut
            centro={`${m.cobertura_ia.valor}%`}
            pie="automatizada"
            porciones={[
              { etiqueta: "Automatizada", valor: m.cierres_ia, color: "var(--acc)" },
              { etiqueta: "Asistida", valor: m.cierres_humano, color: "var(--blue)" },
            ]}
          />

          {/*
            Debajo del reparto de cierres, el dinero de esos cierres. La rosca
            dice cuántos hilos cerró cada uno y esta línea dice cuánto entró por
            ellos: son las dos mitades de la misma pregunta, y separarlas en dos
            tarjetas obliga a mirar arriba y abajo para responderla.

            Sin el envío, que se le cobra al cliente y se le paga al mensajero.
            El importe sale del resumen del pedido que saca el analista.
          */}
          <div
            style={{
              marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)",
              display: "grid", gap: 7, fontSize: 12.5,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, color: "var(--ink-2)" }}>Facturado sin envío</span>
              <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>
                {dinero(m.facturado)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, color: "var(--ink-2)" }}>Automatizada</span>
              <span className="num" style={{ fontWeight: 600, color: "var(--acc)" }}>
                {dinero(m.facturado_ia)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, color: "var(--ink-2)" }}>Asistida</span>
              <span className="num" style={{ fontWeight: 600, color: "var(--blue)" }}>
                {dinero(m.facturado_humano)}
              </span>
            </div>
            <div className="tenue">
              {dinero(m.envios_cobrados)} de envíos cobrados, fuera de esta cuenta.
            </div>
          </div>
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Resumen</h2>

          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <Meta
              etiqueta="Cobertura automatizada"
              valor={m.cobertura_ia.valor}
              meta={m.cobertura_ia.meta}
              estado={m.cobertura_ia.estado}
            />
            <Meta
              etiqueta="Efectividad asistida"
              valor={m.efectividad_humana.valor}
              meta={m.efectividad_humana.meta}
              estado={m.efectividad_humana.estado}
            />
          </div>

          <ul style={{ display: "grid", gap: 9 }}>
            <FilaResumen
              icono={<IconoReloj tam={15} />}
              etiqueta="Automatizada tarda"
              valor={formatearDuracion(m.tiempo_promedio_ia)}
            />
            <FilaResumen
              icono={<IconoPersona tam={15} />}
              etiqueta="Asistida tarda"
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

      {/*
        Qué anuncio trae a cada cliente. La descripción es la mitad útil: el
        título dice el producto, y el texto dice qué se le prometió — que es lo
        que explica por qué el cliente escribe lo que escribe.
      */}
      <section className="tarjeta" style={{ marginBottom: 14 }}>
        <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Productos que traen leads</h2>

        {m.productos_anuncio.length === 0 ? (
          <Vacio
            titulo="Todavía no ha llegado nadie por un anuncio"
            texto="Cuando un cliente escriba desde un anuncio de Facebook o Instagram, aquí aparecerá qué producto lo trajo y qué le prometía."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto anunciado</th>
                  <th>Lo que promete el anuncio</th>
                  <th style={{ textAlign: "right" }}>Leads</th>
                  <th style={{ textAlign: "right" }}>Cerrados</th>
                  <th style={{ textAlign: "right" }}>Tasa</th>
                </tr>
              </thead>
              <tbody>
                {m.productos_anuncio.map((p) => (
                  <tr key={p.producto}>
                    <td style={{ fontWeight: 600, maxWidth: 220 }}>{p.producto}</td>
                    <td className="tenue" style={{ maxWidth: 340 }}>
                      {p.descripcion ?? "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>{p.leads}</td>
                    <td style={{ textAlign: "right", color: "var(--acc)" }}>{p.cerrados}</td>
                    <td style={{ textAlign: "right" }}>
                      {p.leads === 0 ? 0 : Math.round((p.cerrados / p.leads) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                    {/* Con el panel filtrado las dos columnas dirían el mismo
                        número: se deja una y se la llama por su nombre. */}
                    {!soloAnuncio && <th style={{ textAlign: "right" }}>Por anuncio</th>}
                    <th style={{ textAlign: "right" }}>
                      {soloAnuncio ? "Leads de anuncio" : "Conversaciones"}
                    </th>
                    <th style={{ textAlign: "right" }}>Automatizada</th>
                    <th style={{ textAlign: "right" }}>Asistida</th>
                    {/* Sin cerrar y En revisión completan el conteo de cada
                        número: con las cuatro columnas, cada fila suma sus
                        propias conversaciones y se puede comprobar de un
                        vistazo que no se está perdiendo ninguna. */}
                    <th style={{ textAlign: "right" }}>Sin cerrar</th>
                    <th style={{ textAlign: "right" }}>Revisión</th>
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
                      {!soloAnuncio && (
                        <td style={{ textAlign: "right", fontWeight: 600, color: "var(--amber)" }}>
                          {c.leads_anuncio}
                        </td>
                      )}
                      <td style={{ textAlign: "right" }}>{c.leads}</td>
                      <td style={{ textAlign: "right", color: "var(--acc)" }}>{c.cierres_ia}</td>
                      <td style={{ textAlign: "right", color: "var(--blue)" }}>{c.cierres_humano}</td>
                      <td style={{ textAlign: "right" }}>{c.sin_cerrar}</td>
                      <td style={{ textAlign: "right", color: c.revision > 0 ? "var(--amber)" : undefined }}>
                        {c.revision}
                      </td>
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

                {/* La cuenta entera, sumando los números uno a uno. La última
                    celda es lo facturado sin envíos: la misma cifra de la
                    tarjeta de arriba, ahora con el desglose que la produce. */}
                <tfoot>
                  <tr>
                    <td><span className="rotulo-total">Todos los números</span></td>
                    {!soloAnuncio && (
                      <td style={{ textAlign: "right", color: "var(--amber)" }}>{totalCanales.leads_anuncio}</td>
                    )}
                    <td style={{ textAlign: "right" }}>{totalCanales.leads}</td>
                    <td style={{ textAlign: "right", color: "var(--acc)" }}>{totalCanales.cierres_ia}</td>
                    <td style={{ textAlign: "right", color: "var(--blue)" }}>{totalCanales.cierres_humano}</td>
                    <td style={{ textAlign: "right" }}>{totalCanales.sin_cerrar}</td>
                    <td style={{ textAlign: "right" }}>{totalCanales.revision}</td>
                    <td style={{ textAlign: "right" }}>{tasaTotal}%</td>
                    <td style={{ textAlign: "right", color: "var(--amber)" }}>
                      {dinero(totalCanales.facturado)}
                    </td>
                  </tr>
                </tfoot>
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

/**
 * El desglose de lo facturado, un canal por línea.
 *
 * La lista tiene su propio scroll y no crece con la cuenta: la tarjeta vive en
 * la rejilla de cuatro KPIs de arriba, y una cuenta con veinte canales —el tope
 * que soporta el panel— estiraría esa fila hasta empujar el resto del dashboard
 * fuera de la pantalla. Con la altura fija, la fila mide lo mismo con un canal
 * que con veinte y el desglose se recorre dentro.
 */
function FacturadoPorCanal({
  canales,
}: {
  canales: { canal_id: number; nombre: string; facturado: number }[];
}) {
  if (canales.length === 0) {
    return (
      <div className="tenue" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        Sin canales conectados
      </div>
    );
  }

  return (
    <ul
      style={{
        marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)",
        display: "grid", gap: 5, maxHeight: 104, overflowY: "auto",
      }}
    >
      {canales.map((c) => (
        <li
          key={c.canal_id}
          style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}
        >
          <span
            style={{
              flex: 1, minWidth: 0, color: "var(--ink-2)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
            title={c.nombre}
          >
            {c.nombre}
          </span>
          {/*
            El cero se pinta apagado en vez de esconderse: la fila sigue ahí
            para decir que el canal existe, pero no compite con los que sí
            facturaron cuando se recorre la lista de un vistazo.
          */}
          <span
            className="num"
            style={{
              fontWeight: 600,
              color: c.facturado > 0 ? "var(--amber)" : "var(--ink-4)",
            }}
          >
            {dinero(c.facturado)}
          </span>
        </li>
      ))}
    </ul>
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
