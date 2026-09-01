import AnunciosMeta from "@/components/panel/AnunciosMeta";
import ComentariosMeta from "@/components/panel/ComentariosMeta";
import PaginasMeta from "@/components/panel/PaginasMeta";
import { fechaHora } from "@/components/panel/Piezas";
import {
  listarAnunciosMeta,
  listarCatalogo,
  listarComentariosMeta,
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
 * ─── LO QUE VE CADA UNO ───
 *
 * Esta pantalla la abre el dueño de una tienda, no quien mantiene el servidor.
 * Nombres de variables, URLs de webhook y volcados de eventos no le dicen nada:
 * le enseñan que hay tuberías y le dan cosas que tocar que no son suyas. Todo
 * eso vive abajo, plegado y solo para superadmin.
 *
 * Lo que sí ve todo el mundo es el estado en una frase —«esto funciona» o «esto
 * todavía no»— porque eso sí es información suya.
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

  const anuncios = listarAnunciosMeta(orgId).map((a) => ({
    adId: a.ad_id,
    titulo: a.titulo,
    productoId: a.producto_id,
    productoNombre: a.producto_nombre,
  }));

  const productos = listarCatalogo(orgId, true).map((p) => ({ id: p.id, nombre: p.nombre }));

  // Los comentarios solo se consultan si hay alguna página: sin ninguna, la
  // respuesta es siempre vacía y la sección no se enseña.
  const comentarios = canales.length > 0 ? listarComentariosMeta(orgId, { limite: 40 }) : [];

  // Los eventos crudos solo se leen para quien los va a mirar.
  const eventos = ctx.superadmin ? ultimosEventosMeta(orgId, 8) : [];

  const config = VARIABLES.map((v) => ({ ...v, puesta: estaPuesta(v.clave) }));
  const faltanCriticas = config.filter((v) => v.critica && !v.puesta);
  const urlWebhook = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/meta/webhook`;

  /*
   * El ID de la app y el de la configuración viajan al navegador a propósito:
   * los dos son públicos —aparecen en la URL del panel de Meta y en la propia
   * ventana de inicio de sesión— y hacen falta para abrirla. Lo que no baja
   * nunca es el secreto, que es lo que firma.
   *
   * Se leen aquí y no con NEXT_PUBLIC_: esas se congelan al construir la
   * imagen, y en un despliegue así cambiar la variable no haría nada hasta
   * reconstruir. Como props, basta con reiniciar.
   */
  const appId = (process.env.META_APP_ID ?? "").trim() || null;

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Messenger</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Mensajes, comentarios y directos de Instagram de tus páginas de Facebook. Todo entra
            en las mismas conversaciones y las mismas ventas.
          </p>
        </div>
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

      <PaginasMeta
        paginas={paginas}
        appId={appId}
        configId={(process.env.META_LOGIN_CONFIG_ID ?? "").trim() || null}
        graphVersion={process.env.META_GRAPH_VERSION || "v23.0"}
        avanzado={ctx.superadmin}
      />

      {/* Los comentarios, debajo de las páginas y antes de los anuncios: se
          miran a diario, y los anuncios se tocan una vez por campaña. */}
      {canales.length > 0 && (
        <ComentariosMeta
          comentarios={comentarios}
          paginas={paginas.map((p) => ({ id: p.id, nombre: p.nombre }))}
        />
      )}

      <AnunciosMeta anuncios={anuncios} productos={productos} />

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
          <summary
            className="tenue"
            style={{ cursor: "pointer", fontSize: 12.5, userSelect: "none" }}
          >
            Diagnóstico técnico
          </summary>

          <div className="sd-mitades" style={{ marginTop: 14 }}>
            <section>
              <h3 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
                La URL del webhook
              </h3>
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

              <ul style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {config.map((v) => (
                  <li
                    key={v.clave}
                    style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 12.5 }}
                  >
                    {/* El color nunca es la única señal: al punto lo acompaña
                        la palabra. */}
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
            </section>

            <section>
              <h3 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
                Últimos eventos recibidos
              </h3>
              <p className="tenue" style={{ marginBottom: 12 }}>
                Lo que Meta mandó a esta cuenta, antes de interpretarlo.
              </p>

              {eventos.length === 0 ? (
                <p className="tenue">
                  Todavía no ha llegado ningún evento. Si ya se conectó la página y se dio de
                  alta el webhook, escríbele desde otra cuenta para probar — y recuerda que en
                  modo Desarrollo solo llegan los de gente con rol en la app.
                </p>
              ) : (
                <ul style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
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
                          e.firma_ok !== 1
                            ? "pastilla-revision"
                            : e.procesado === 1
                              ? "pastilla-ia"
                              : "pastilla-abierta"
                        }`}
                      >
                        {e.firma_ok !== 1
                          ? "firma mala"
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
