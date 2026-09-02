import AnunciosMeta from "@/components/panel/AnunciosMeta";
import BandejaMeta from "@/components/panel/BandejaMeta";
import EstadoAppMeta from "@/components/panel/EstadoAppMeta";
import PaginasMeta from "@/components/panel/PaginasMeta";
import PestanasMeta from "@/components/panel/PestanasMeta";
import { fechaHora } from "@/components/panel/Piezas";
import {
  bandejaMeta,
  eventosMetaHuerfanos,
  listarAnunciosMeta,
  listarCatalogo,
  listarPaginasMeta,
  ultimosEventosMeta,
} from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Messenger · SalesDash" };
export const dynamic = "force-dynamic";

/** Solo si está definida y no vacía. Aquí no se lee NUNCA el valor. */
function estaPuesta(clave: string): boolean {
  return (process.env[clave] ?? "").trim() !== "";
}

/*
 * ─── EL ORDEN DE LA PANTALLA ───
 *
 * Arriba, la bandeja: es lo que se mira veinte veces al día. Abajo, conectar
 * páginas: se hace una vez y no se vuelve. Cuando estaba al revés, lo que se
 * usaba a diario quedaba debajo de un formulario que ya nadie necesitaba.
 *
 * Las páginas conectadas siguen visibles arriba, pero en una línea de fichas —
 * el nombre, si está viva y quién contesta— porque eso sí se consulta, y no
 * necesita media tarjeta.
 *
 * ─── LO QUE VE CADA UNO ───
 *
 * Esta pantalla la abre el dueño de una tienda, no quien mantiene el servidor.
 * Nombres de variables, URLs de webhook y volcados de eventos no le dicen nada:
 * le enseñan que hay tuberías y le dan cosas que tocar que no son suyas. Todo
 * eso vive al final, plegado y solo para superadmin.
 */
const VARIABLES: { clave: string; para: string; critica: boolean }[] = [
  { clave: "APP_URL", para: "arma la URL del webhook que se registra en Meta", critica: true },
  { clave: "META_APP_SECRET", para: "valida la firma y cambia el código de la ventana", critica: true },
  { clave: "META_VERIFY_TOKEN", para: "responde al GET de verificación del webhook", critica: true },
  { clave: "META_GRAPH_VERSION", para: "fija la versión de la Graph API", critica: false },
  { clave: "META_APP_ID", para: "abre la ventana de «Entrar con Facebook»", critica: false },
  { clave: "META_LOGIN_CONFIG_ID", para: "hace que esa ventana enseñe el selector de páginas", critica: false },
];

export default async function PaginaMeta() {
  const ctx = await requerirSesion();
  const orgId = ctx.orgId;

  const canales = listarPaginasMeta(orgId);

  const paginas = canales.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    igUserId: c.meta_ig_id,
    agenteActivo: c.agente_activo === 1,
    ultimoEventoAt: c.ultimo_evento_at,
  }));

  const filas = (canales.length > 0 ? bandejaMeta(orgId, { limite: 120 }) : []).map((f) => ({
    id: f.id,
    canalId: f.canal_id,
    canal: f.canal,
    cliente: f.cliente_nombre,
    superficie: f.superficie ?? "messenger",
    atiende: f.atiende,
    cerradoPor: f.cerrado_por,
    ultimoTexto: f.ultimo_texto,
    ultimoEmisor: f.ultimo_emisor,
    cuando: f.last_message_at ?? f.fecha_inicio,
  }));

  const anuncios = listarAnunciosMeta(orgId).map((a) => ({
    adId: a.ad_id,
    titulo: a.titulo,
    productoId: a.producto_id,
    productoNombre: a.producto_nombre,
    /*
     * El anuncio, para poder abrirlo. Vincularlo a un producto a ciegas —con
     * un título de cuatro palabras o, si no lo trae, con un número de quince
     * cifras— es adivinar: el enlace es lo que deja VER cuál de los seis
     * anuncios de esta semana es este antes de elegir el producto.
     *
     * «(no se pudo leer)» es la marca de que se preguntó y Meta no contestó.
     * No es un enlace y no se pinta como tal.
     */
    enlace: a.enlace && a.enlace.startsWith("http") ? a.enlace : null,
  }));

  const productos = listarCatalogo(orgId, true).map((p) => ({ id: p.id, nombre: p.nombre }));

  const sinResponder = filas.filter((f) => f.ultimoEmisor === "cliente").length;
  const sinVincular = anuncios.filter((a) => a.productoId === null).length;

  const config = VARIABLES.map((v) => ({ ...v, puesta: estaPuesta(v.clave) }));
  const faltanCriticas = config.filter((v) => v.critica && !v.puesta);
  /*
   * LOS EVENTOS QUE HACEN FALTA SON, JUSTAMENTE, LOS QUE NO TIENEN DUEÑO.
   *
   * `ultimosEventosMeta` filtra por `org_id`, y los dos fallos que dejan una
   * página conectada sin recibir nada se guardan con `org_id = NULL`: la firma
   * inválida —que se registra antes de saber de quién es el evento— y la página
   * que nadie conectó. Enseñando solo los de la cuenta, esta pantalla decía
   * «todavía no ha llegado ningún evento» mientras Meta mandaba y nosotros
   * tirábamos uno tras otro: la respuesta exacta que manda a buscar el problema
   * a Meta cuando está aquí dentro.
   *
   * Los huérfanos son de la plataforma, no de la cuenta, y por eso este bloque
   * entero es solo de superadmin. Ver `eventosMetaHuerfanos` en `db.ts`.
   */
  const eventos = ctx.superadmin
    ? [
        ...ultimosEventosMeta(orgId, 8).map((e) => ({ ...e, huerfano: false })),
        ...eventosMetaHuerfanos(8).map((e) => ({
          ...e, procesado: 0, mensajes: 0, huerfano: true,
        })),
      ]
        .sort((a, b) => b.recibido_at - a.recibido_at || b.id - a.id)
        .slice(0, 10)
    : [];
  const urlWebhook = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/meta/webhook`;

  /*
   * El ID de la app y el de la configuración viajan al navegador a propósito:
   * los dos son públicos —aparecen en la URL del panel de Meta y en la propia
   * ventana de inicio de sesión— y hacen falta para abrirla. Lo que no baja
   * nunca es el secreto, que es lo que firma.
   *
   * Se leen aquí y no con NEXT_PUBLIC_: esas se congelan al construir la
   * imagen, y entonces cambiar la variable no haría nada hasta reconstruir.
   * Como props, basta con reiniciar.
   */
  const appId = (process.env.META_APP_ID ?? "").trim() || null;

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Messenger</h1>
          <p className="tenue" style={{ marginTop: 3 }}>
            Mensajes, comentarios y directos de Instagram. Todo entra en las mismas
            conversaciones y las mismas ventas.
          </p>

          {paginas.length > 0 && (
            <div className="sd-meta-chips">
              {paginas.map((p) => (
                <span key={p.id} className="sd-meta-chip">
                  <span className="sd-meta-ini" aria-hidden="true">
                    {p.nombre.charAt(0).toUpperCase()}
                  </span>
                  <span style={{ fontWeight: 600 }}>{p.nombre}</span>
                  <span
                    className={`sd-meta-pulso ${p.agenteActivo ? "" : "sd-meta-pulso-gris"}`}
                    aria-hidden="true"
                  />
                  <span className="tenue">{p.agenteActivo ? "Responde la IA" : "Solo mira"}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* El atajo a la zona de conectar, que vive al final de la pantalla. */}
        <a href="#paginas" className="btn btn-secundario" style={{ textDecoration: "none" }}>
          + Conectar página
        </a>
      </div>

      {faltanCriticas.length > 0 && (
        <div className="aviso aviso-ambar" role="status" style={{ marginBottom: 14 }}>
          {ctx.superadmin ? (
            <>
              Falta configurar {faltanCriticas.map((v) => v.clave).join(", ")} en el servidor. Sin
              eso el webhook no puede darse de alta ni validar lo que llega.
            </>
          ) : (
            <>
              La conexión con Facebook se está terminando de preparar en este panel. Puedes
              conectar tus páginas en cuanto esté lista.
            </>
          )}
        </div>
      )}

      {canales.length > 0 ? (
        <PestanasMeta
          sinResponder={sinResponder}
          sinVincular={sinVincular}
          bandeja={
            <BandejaMeta
              filas={filas}
              paginas={paginas.map((p) => ({ id: p.id, nombre: p.nombre }))}
            />
          }
          anuncios={<AnunciosMeta anuncios={anuncios} productos={productos} />}
        />
      ) : (
        <div className="tarjeta" style={{ textAlign: "center", padding: "38px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 5 }}>
            Todavía no hay ninguna página conectada
          </div>
          <p className="tenue" style={{ maxWidth: "46ch", margin: "0 auto" }}>
            Conecta una página de Facebook aquí abajo y en esta zona aparecerán sus mensajes,
            sus comentarios y los directos de su Instagram.
          </p>
        </div>
      )}

      {/* ── Al final: las páginas y el botón ──────────────────────── */}
      <div className="sd-separador" id="paginas">
        <span>Tus páginas de Facebook</span>
        <i />
      </div>

      <PaginasMeta
        paginas={paginas}
        appId={appId}
        configId={(process.env.META_LOGIN_CONFIG_ID ?? "").trim() || null}
        avanzado={ctx.superadmin}
      />

      {/*
        ─── DIAGNÓSTICO TÉCNICO ───

        Solo superadmin, y plegado. Es la pantalla que contesta «conecté la
        página y no me llega nada»: o hay filas y el problema es nuestro, o no
        hay ninguna y el problema está en Meta. Sin esto, esa pregunta no se
        puede responder sin entrar al servidor a mirar registros — pero
        enseñársela a quien solo quiere vender es ruido y es una fuga de cómo
        está montada la plataforma.
      */}
      {ctx.superadmin && (
        <details className="tarjeta" style={{ marginTop: 14 }}>
          <summary className="tenue" style={{ cursor: "pointer", userSelect: "none" }}>
            Diagnóstico técnico
          </summary>

          <div className="sd-mitades" style={{ marginTop: 14 }}>
            <section>
              <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>La URL del webhook</h2>
              <p className="tenue" style={{ marginBottom: 10 }}>
                Se pega en Meta → tu app → Messenger → Webhooks, junto con el
                <span className="num"> META_VERIFY_TOKEN</span>.
              </p>
              <div
                className="num"
                style={{
                  padding: "9px 11px", borderRadius: 8, background: "var(--soft)",
                  fontSize: 12.5, wordBreak: "break-all",
                }}
              >
                {process.env.APP_URL ? urlWebhook : "(falta APP_URL)"}
              </div>

              <ul style={{ display: "grid", gap: 9, marginTop: 12 }}>
                {config.map((v) => (
                  <li
                    key={v.clave}
                    style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 12.5 }}
                  >
                    {/* El color nunca es la única señal: al punto lo acompaña la palabra. */}
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                        background: v.puesta ? "var(--acc)" : "var(--ink-4)",
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="num" style={{ fontWeight: 600 }}>{v.clave}</span>
                      <span className="tenue" style={{ display: "block" }}>{v.para}</span>
                    </span>
                    <span
                      style={{
                        fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
                        color: v.puesta ? "var(--acc)" : "var(--ink-3)",
                      }}
                    >
                      {v.puesta ? "puesta" : "sin poner"}
                    </span>
                  </li>
                ))}
              </ul>

              {/*
                Y encima de las variables, lo que de verdad decide si un cliente
                puede conectar: el estado de la app en Meta. Ninguna variable de
                este servidor lo dice, porque no vive aquí.
              */}
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <EstadoAppMeta />
              </div>
            </section>

            <section>
              <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Últimos eventos recibidos</h2>
              <p className="tenue" style={{ marginBottom: 12 }}>
                Lo que Meta mandó, antes de interpretarlo. Incluye lo que se descartó por firma
                inválida o por venir de una página que nadie conectó: sin eso, la lista vacía
                y «Meta no manda nada» se ven igual.
              </p>

              {eventos.length === 0 ? (
                <p className="tenue">
                  Todavía no ha llegado ningún evento. Si ya se conectó la página y se dio de
                  alta el webhook, escríbele desde otra cuenta para probar — y recuerda que en
                  modo Desarrollo solo llegan los de gente con rol en la app.
                </p>
              ) : (
                <ul style={{ display: "grid", gap: 9, fontSize: 12.5 }}>
                  {eventos.map((e) => (
                    <li key={e.id} style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                      <span className="tenue num" style={{ whiteSpace: "nowrap" }}>
                        {fechaHora(e.recibido_at)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {e.objeto}
                        {e.detalle && (
                          <span className="tenue" style={{ display: "block" }}>{e.detalle}</span>
                        )}
                      </span>
                      <span
                        className={`pastilla ${
                          e.firma_ok !== 1 || e.huerfano
                            ? "pastilla-revision"
                            : e.procesado === 1
                              ? "pastilla-ia"
                              : "pastilla-abierta"
                        }`}
                      >
                        {e.firma_ok !== 1
                          ? "firma mala"
                          : e.huerfano
                            ? "descartado"
                            : e.procesado === 1
                              ? `${e.mensajes} mensaje${e.mensajes === 1 ? "" : "s"}`
                              : "sin procesar"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </details>
      )}
    </>
  );
}
