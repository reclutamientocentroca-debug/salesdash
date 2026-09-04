import Link from "next/link";
import {
  Donut,
  FilasPorMoneda,
  GraficoArea,
  Importes,
  Kpi,
  LeyendaGrafico,
  Meta,
  Vacio,
  dinero,
  hace,
} from "@/components/panel/Piezas";
import {
  IconoConversaciones,
  IconoMoneda,
  IconoPersona,
  IconoRayo,
  IconoReloj,
  IconoRevision,
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
import { calcularMetricas, formatearDuracion } from "@/lib/metrics";
import { rangoDeLaCuenta, requerirSesion } from "@/lib/tenant";
import type { Moneda } from "@/lib/moneda";

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

  // En la hora de los países de la cuenta: «hoy» es hoy en Santo Domingo.
  const rango = { ...rangoDeLaCuenta(ctx.orgId, parametros), soloAnuncio };
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
   * «Necesita tu atención»: lo que no puede esperar a mañana. Se arma con lo
   * que ya está en la base —números caídos, Messenger sin responder, anuncios
   * sin producto, cierres en revisión y anomalías altas— y cada fila trae su
   * botón. Ver `filasDeAtencion`.
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

  // Lo de arriba a la derecha de cada KPI y lo que se dice debajo de la meta.
  const cerradas = m.cierres_ia + m.cierres_humano;
  const diferencia = (valor: number, meta: number) => {
    const d = Math.round(valor - meta);
    if (d === 0) return "Justo en tu meta";
    return `${Math.abs(d)} punto${Math.abs(d) === 1 ? "" : "s"} por ${d > 0 ? "encima" : "debajo"} de tu meta`;
  };
  const claseInsignia = (estado: "verde" | "ambar" | "rojo") => (estado === "verde" ? "" : estado);
  const colorSemaforo = (estado: "verde" | "ambar" | "rojo") =>
    estado === "verde" ? "var(--verde)" : estado === "ambar" ? "var(--amber)" : "var(--red)";

  // Los números, ordenados por lo que cerraron, con la barra relativa al mejor.
  const ranking = [...m.por_canal].sort(
    (a, b) => b.cierres_ia + b.cierres_humano - (a.cierres_ia + a.cierres_humano) || b.leads - a.leads,
  );
  const mejor = Math.max(1, ...ranking.map((c) => c.cierres_ia + c.cierres_humano));

  // El pie del gráfico: lo de ayer, que es el último día completo.
  const ayer = m.serie_diaria.length >= 2 ? m.serie_diaria[m.serie_diaria.length - 2] : null;

  /*
   * El pie de «Rendimiento por número»: cada columna sumada.
   *
   * Se suman las FILAS que se están viendo y no las cifras sueltas del periodo,
   * aunque valgan lo mismo: el pie de una tabla es la promesa de que esa
   * columna suma eso, y quien la repase con el dedo tiene que llegar al mismo
   * número. El dinero no se suma aquí: cada número factura en la moneda de
   * su país, y el pie lo enseña moneda por moneda (`facturado_por_moneda`,
   * que es la suma de estas mismas filas).
   */
  const totalCanales = m.por_canal.reduce(
    (a, c) => ({
      leads: a.leads + c.leads,
      leads_anuncio: a.leads_anuncio + c.leads_anuncio,
      cierres_ia: a.cierres_ia + c.cierres_ia,
      cierres_humano: a.cierres_humano + c.cierres_humano,
      sin_cerrar: a.sin_cerrar + c.sin_cerrar,
      revision: a.revision + c.revision,
    }),
    { leads: 0, leads_anuncio: 0, cierres_ia: 0, cierres_humano: 0, sin_cerrar: 0, revision: 0 },
  );
  const cerradasDelPeriodo = totalCanales.cierres_ia + totalCanales.cierres_humano;

  const tasaTotal =
    totalCanales.leads === 0
      ? 0
      : Math.round(((totalCanales.cierres_ia + totalCanales.cierres_humano) / totalCanales.leads) * 1000) / 10;

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
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
          Los números no cuadran: hay conversaciones del periodo sin clasificar. Alguna se está
          perdiendo y el reporte no es fiable.
        </div>
      )}

      <div className="sd-kpis" style={{ marginBottom: 14 }}>
        {/*
          Los cuatro números que se miran primero: cuánta gente escribió, qué
          parte cerró la IA sola, qué parte cerró el equipo cuando entró, y
          cuántos pedidos hubo. El dinero va en su moneda, país por país.
        */}
        <Kpi
          etiqueta="Conversaciones"
          valor={m.leads}
          icono={<IconoConversaciones tam={17} />}
          tono="acento"
          pie={`${m.cierres_ia} cerradas por la IA · ${m.cierres_humano} con vendedor`}
        />
        <Kpi
          etiqueta="Cobertura automatizada"
          valor={`${m.cobertura_ia.valor} %`}
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
          valor={`${m.efectividad_humana.valor} %`}
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
          etiqueta="Pedidos"
          valor={cerradas}
          icono={<IconoMoneda tam={17} />}
          tono="ambar"
          pie={
            <>
              Ticket promedio <Importes lista={m.facturado_por_moneda} campo="promedio" />
              <br />
              Facturado <Importes lista={m.facturado_por_moneda} campo="facturado" color="var(--amber)" />
            </>
          }
        />
      </div>

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

        <section className="tarjeta">
          <h2 className="titulo-tarjeta">Rendimiento por número</h2>
          <div className="tenue" style={{ marginBottom: 6 }}>Pedidos cerrados en el rango</div>
          {ranking.length === 0 ? (
            <Vacio titulo="Sin números conectados" texto="Conecta un número y aquí verás cuánto cierra cada uno." />
          ) : (
            <div className="sd-canales-barras">
              {ranking.map((c) => {
                const pedidos = c.cierres_ia + c.cierres_humano;
                return (
                  <div key={c.canal_id} className="sd-canal-barra">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.nombre}
                      </div>
                      <div className="tenue">{[c.pais_nombre, c.modo].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="sd-pista">
                      <div style={{ width: `${Math.round((pedidos / mejor) * 100)}%` }} />
                    </div>
                    <div className="num" style={{ fontWeight: 600, fontSize: 14, minWidth: 30, textAlign: "right" }}>
                      {pedidos}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

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

      <div className="sd-mitades" style={{ marginBottom: 14 }}>

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
            QUÉ SIGNIFICA CADA MITAD, escrito donde se mira el reparto.

            Es la pregunta que el dueño hace en cuanto ve esta rosca, y sin la
            respuesta a la vista cada uno se inventa la suya —«asistida será
            donde contestó alguien del equipo»—, que no es lo que cuenta el
            panel. La regla es corta y cabe en dos líneas: una venta es
            automatizada si se mandó el resumen del pedido, venga de nuestro
            agente, del bot del número o del móvil de un vendedor; es asistida
            si la cerró la foto de la factura y en el hilo no hubo resumen.

            Que además interviniera una persona es otro dato, y se lee en la
            pastilla de cada conversación.
          */}
          <p className="tenue" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--acc)" }}>Automatizada</strong>: se mandó el resumen del
            pedido. <strong style={{ color: "var(--blue)" }}>Asistida</strong>: la cerró la foto de
            la factura, sin resumen en el hilo.
          </p>

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
              <FilasPorMoneda lista={m.facturado_por_moneda} campo="facturado" tam={15} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, color: "var(--ink-2)" }}>Automatizada</span>
              <FilasPorMoneda lista={m.facturado_por_moneda} campo="facturado_ia" color="var(--acc)" tam={12.5} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, color: "var(--ink-2)" }}>Asistida</span>
              <FilasPorMoneda lista={m.facturado_por_moneda} campo="facturado_humano" color="var(--blue)" tam={12.5} />
            </div>
            <div className="tenue">
              <Importes lista={m.facturado_por_moneda} campo="envios" /> de envíos cobrados, fuera de esta cuenta.
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
                    {/* Las ventas CERRADAS en el periodo, por el día en que se
                        cerraron y en la hora del país del número. Pueden ser
                        más que las conversaciones de la fila: son pedidos de
                        gente que escribió antes. */}
                    <th style={{ textAlign: "right" }}>Automatizada</th>
                    <th style={{ textAlign: "right" }}>Asistida</th>
                    {/* Sin cerrar y En revisión son de las conversaciones que
                        LLEGARON en el periodo y siguen sin venta. */}
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
                      {/* En la moneda del país del número: RD$, ₡ o US$. */}
                      <td className="num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {dinero(c.ventas, c.moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* La cuenta entera, sumando los números uno a uno. La última
                    celda es lo facturado sin envíos, moneda por moneda: la
                    misma cifra de la tarjeta de arriba. */}
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
                    <td style={{ textAlign: "right", color: "var(--amber)", whiteSpace: "nowrap" }}>
                      <FilasPorMoneda lista={m.facturado_por_moneda} campo="facturado" color="var(--amber)" />
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
                    <span className="num" style={{ fontWeight: 600, fontSize: 13 }}>{dinero(p.monto, m.una_moneda)}</span>
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
  canales: { canal_id: number; nombre: string; facturado: number; moneda: Moneda }[];
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
              whiteSpace: "nowrap",
            }}
          >
            {dinero(c.facturado, c.moneda)}
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
