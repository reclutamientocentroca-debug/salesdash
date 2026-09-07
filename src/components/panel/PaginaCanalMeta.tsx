import Link from "next/link";
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

/** Solo si está definida y no vacía. Aquí no se lee NUNCA el valor. */
function estaPuesta(clave: string): boolean {
  return (process.env[clave] ?? "").trim() !== "";
}

const VARIABLES: { clave: string; para: string; critica: boolean }[] = [
  { clave: "APP_URL", para: "arma la URL del webhook que se registra en Meta", critica: true },
  { clave: "META_APP_SECRET", para: "valida la firma y cambia el código de la ventana", critica: true },
  { clave: "META_VERIFY_TOKEN", para: "responde al GET de verificación del webhook", critica: true },
  { clave: "META_GRAPH_VERSION", para: "fija la versión de la Graph API", critica: false },
  { clave: "META_APP_ID", para: "abre la ventana de «Entrar con Facebook»", critica: false },
  { clave: "META_LOGIN_CONFIG_ID", para: "hace que esa ventana enseñe el selector de páginas", critica: false },
];

/**
 * EL CUERPO DE LA PANTALLA DE META, PARA UNA RED.
 *
 * Messenger e Instagram son la misma tubería —el mismo webhook, la misma app,
 * las mismas conversaciones guardadas— y solo se diferencian en qué conjunto
 * de hilos enseñan. Por eso esto no es dos componentes: es uno solo con `red`
 * como parámetro, y cada `page.tsx` lo llama con la suya. Duplicarlo en dos
 * archivos casi iguales es lo primero que se desincroniza el día que cambia
 * un detalle de la bandeja.
 *
 * Conectar una cuenta sigue siendo, siempre, conectar una PÁGINA de Facebook
 * —Instagram no se conecta suelto, se enlaza a una—, así que ese formulario
 * completo vive solo en Messenger. Aquí, en Instagram, solo se enseña qué
 * cuentas ya están enlazadas y un enlace de vuelta para gestionarlas.
 */
export default async function PaginaCanalMeta({ red }: { red: "facebook" | "instagram" }) {
  const ctx = await requerirSesion();
  const orgId = ctx.orgId;

  const canales = listarPaginasMeta(orgId);
  // Instagram no se conecta suelto: solo entran las páginas que lo tienen enlazado.
  const canalesRed = red === "instagram" ? canales.filter((c) => c.meta_ig_id) : canales;

  const paginas = canalesRed.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    igUserId: c.meta_ig_id,
    agenteActivo: c.agente_activo === 1,
    ultimoEventoAt: c.ultimo_evento_at,
  }));

  const filas = (canalesRed.length > 0 ? bandejaMeta(orgId, { limite: 120, red }) : []).map((f) => ({
    id: f.id,
    canalId: f.canal_id,
    canal: f.canal,
    cliente: f.cliente_nombre,
    superficie: f.superficie ?? "messenger",
    atiende: f.atiende,
    cerradoPor: f.cerrado_por,
    pedido: f.cerrado_por === "ia" || f.cerrado_por === "humano" || !!f.resumen_pedido,
    ultimoTexto: f.ultimo_texto,
    ultimoEmisor: f.ultimo_emisor,
    cuando: f.last_message_at ?? f.fecha_inicio,
  }));

  const anuncios = listarAnunciosMeta(orgId).map((a) => ({
    adId: a.ad_id,
    titulo: a.titulo,
    productoId: a.producto_id,
    productoNombre: a.producto_nombre,
    enlace: a.enlace && a.enlace.startsWith("http") ? a.enlace : null,
  }));

  const productos = listarCatalogo(orgId, true).map((p) => ({ id: p.id, nombre: p.nombre }));

  const sinResponder = filas.filter((f) => f.ultimoEmisor === "cliente").length;
  const sinVincular = anuncios.filter((a) => a.productoId === null).length;

  const config = VARIABLES.map((v) => ({ ...v, puesta: estaPuesta(v.clave) }));
  const faltanCriticas = config.filter((v) => v.critica && !v.puesta);

  const eventos = ctx.superadmin && red === "facebook"
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
  const appId = (process.env.META_APP_ID ?? "").trim() || null;

  const esInstagram = red === "instagram";
  const titulo = esInstagram ? "Instagram" : "Messenger";
  const subtitulo = esInstagram
    ? "Directos y comentarios de anuncios de tus cuentas de Instagram. Todo entra en las mismas conversaciones y las mismas ventas."
    : "Mensajes y comentarios de anuncios de tus páginas de Facebook. Todo entra en las mismas conversaciones y las mismas ventas.";

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">{titulo}</h1>
          <p className="tenue" style={{ marginTop: 3 }}>{subtitulo}</p>

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

        {esInstagram ? (
          <Link href="/canales/meta#paginas" className="btn btn-secundario" style={{ textDecoration: "none" }}>
            Conectar cuenta
          </Link>
        ) : (
          <a href="#paginas" className="btn btn-secundario" style={{ textDecoration: "none" }}>
            + Conectar página
          </a>
        )}
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

      {canalesRed.length > 0 ? (
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
            {esInstagram
              ? "Todavía no hay ninguna cuenta de Instagram conectada"
              : "Todavía no hay ninguna página conectada"}
          </div>
          <p className="tenue" style={{ maxWidth: "46ch", margin: "0 auto" }}>
            {esInstagram
              ? "Una cuenta de Instagram se conecta enlazándola a su página de Facebook. Conéctala desde Messenger y sus directos y comentarios aparecerán aquí."
              : "Conecta una página de Facebook aquí abajo y en esta zona aparecerán sus mensajes y sus comentarios."}
          </p>
        </div>
      )}

      {/* ── Al final: las cuentas y el botón ──────────────────────── */}
      <div className="sd-separador" id="paginas">
        <span>{esInstagram ? "Tus cuentas de Instagram" : "Tus páginas de Facebook"}</span>
        <i />
      </div>

      {esInstagram ? (
        <div className="tarjeta" style={{ padding: 16 }}>
          <p className="tenue" style={{ margin: canalesRed.length > 0 ? "0 0 14px" : 0 }}>
            Una cuenta de Instagram no se conecta sola: se enlaza a su página de Facebook. Para
            conectar una nueva, desconectar una, o revisar por qué no le llega algo, hazlo desde{" "}
            <Link href="/canales/meta#paginas" className="enlace">Messenger</Link>.
          </p>

          {canalesRed.length > 0 && (
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
      ) : (
        <PaginasMeta
          paginas={paginas}
          appId={appId}
          configId={(process.env.META_LOGIN_CONFIG_ID ?? "").trim() || null}
          avanzado={ctx.superadmin}
        />
      )}

      {ctx.superadmin && red === "facebook" && (
        <details className="tarjeta" style={{ marginTop: 14 }}>
          <summary className="tenue" style={{ cursor: "pointer", userSelect: "none" }}>
            Diagnóstico técnico
          </summary>

          <div className="sd-mitades" style={{ marginTop: 14 }}>
            <section>
              <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>La URL del webhook</h2>
              <p className="tenue" style={{ marginBottom: 10 }}>
                Se pega en Meta → tu app → Messenger → Webhooks, junto con el
                <span className="num"> META_VERIFY_TOKEN</span>. Es la misma URL para Messenger e
                Instagram: Meta manda los dos a un solo webhook.
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
