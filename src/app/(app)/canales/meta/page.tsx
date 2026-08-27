import PaginasMeta from "@/components/panel/PaginasMeta";
import { listarAnunciosMeta, listarCatalogo, listarPaginasMeta, ultimosEventosMeta } from "@/lib/db";
import { fechaHora } from "@/components/panel/Piezas";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Messenger · SalesDash" };
export const dynamic = "force-dynamic";

/** Solo si está definida y no vacía. Aquí no se lee NUNCA el valor. */
function estaPuesta(clave: string): boolean {
  return (process.env[clave] ?? "").trim() !== "";
}

const VARIABLES: { clave: string; para: string }[] = [
  { clave: "APP_URL", para: "arma la URL del webhook que se registra en Meta" },
  { clave: "META_APP_SECRET", para: "firma: valida la cabecera X-Hub-Signature-256" },
  { clave: "META_VERIFY_TOKEN", para: "responde al GET de verificación del webhook" },
  { clave: "META_GRAPH_VERSION", para: "fija la versión de la Graph API" },
];

export default async function PaginaMeta() {
  const ctx = await requerirSesion();
  const orgId = ctx.orgId;

  const paginas = listarPaginasMeta(orgId).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    pageId: c.phone,
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
  const eventos = ultimosEventosMeta(orgId, 8);

  /*
   * Se calcula en el servidor y solo viaja el booleano. El valor de
   * META_APP_SECRET no puede acabar en el HTML ni por descuido: esta página la
   * abre cualquier miembro de la cuenta.
   */
  const config = VARIABLES.map((v) => ({ ...v, puesta: estaPuesta(v.clave) }));
  const faltan = config.filter((v) => !v.puesta);
  const urlWebhook = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/meta/webhook`;

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Messenger</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Messenger, mensajes directos de Instagram y comentarios de anuncios. Todo entra en
            las mismas conversaciones y las mismas ventas.
          </p>
        </div>
      </div>

      {faltan.length > 0 && (
        <div className="aviso aviso-ambar" role="status" style={{ marginBottom: 14 }}>
          Falta configurar {faltan.map((v) => v.clave).join(", ")} en el servidor. Sin eso el
          webhook no puede darse de alta ni validar lo que llega.
        </div>
      )}

      <PaginasMeta paginas={paginas} anuncios={anuncios} productos={productos} />

      <div className="sd-mitades" style={{ marginTop: 14 }}>
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
            La URL del webhook
          </h2>
          <p className="tenue" style={{ marginBottom: 10 }}>
            Esto es lo que se pega en Meta → tu app → Messenger → Webhooks, junto con el
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
              <li key={v.clave} style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 12.5 }}>
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
        </section>

        {/*
          Lo que llegó de verdad, con su firma.

          Es la pantalla que contesta «conecté la página y no me llega nada»:
          o hay filas y el problema es nuestro, o no hay ninguna y el problema
          está en Meta. Sin esto, esa pregunta no se puede responder sin entrar
          al servidor a mirar registros.
        */}
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
            Últimos eventos recibidos
          </h2>
          <p className="tenue" style={{ marginBottom: 12 }}>
            Lo que Meta mandó a esta cuenta, antes de interpretarlo.
          </p>

          {eventos.length === 0 ? (
            <p className="tenue">
              Todavía no ha llegado ningún evento. Si ya conectaste la página y diste de alta el
              webhook, escríbele a la página desde otra cuenta para probar — y recuerda que en
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
    </>
  );
}
