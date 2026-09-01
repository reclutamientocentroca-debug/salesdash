"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Vacio, hace } from "@/components/panel/Piezas";

export interface PaginaMeta {
  id: number;
  nombre: string;
  pageId: string;
  igUserId: string | null;
  agenteActivo: boolean;
  ultimoEventoAt: number | null;
}

export interface AnuncioPorVincular {
  adId: string;
  titulo: string | null;
  productoId: number | null;
  productoNombre: string | null;
}

/** Lo que devuelve Meta por cada página que administra quien entró. */
interface Disponible {
  pageId: string;
  nombre: string;
  tieneInstagram: boolean;
  conectada: boolean;
}

/*
 * ─── EL SDK DE FACEBOOK ───
 *
 * Se declara solo lo que se usa. El SDK trae decenas de funciones y tiparlo
 * entero sería inventarse un contrato que no controlamos; con esto TypeScript
 * comprueba lo único que llamamos.
 */
interface RespuestaLogin {
  authResponse?: { code?: string; accessToken?: string } | null;
  status?: string;
}

interface SdkFacebook {
  init(opciones: { appId: string; version: string; xfbml: boolean; cookie: boolean }): void;
  login(cb: (r: RespuestaLogin) => void, opciones: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: SdkFacebook;
    fbAsyncInit?: () => void;
  }
}

/**
 * Los permisos del camino de respaldo.
 *
 * Solo se usan cuando NO hay configuración de Business Login: con ella, los
 * permisos y los activos los decide esa configuración en el panel de Meta, que
 * es lo que hace que la ventana enseñe el selector de páginas.
 */
const PERMISOS = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_manage_engagement",
].join(",");

/**
 * Conectar páginas de Meta y vincular sus anuncios a productos.
 *
 * Dos caminos hacia lo mismo. El botón de Facebook abre la ventana de Meta y el
 * token no pasa por el navegador: la ventana devuelve un código y el servidor
 * lo cambia. Pegar el ID y el token a mano sigue estando, plegado, porque el
 * botón necesita que la app tenga su configuración puesta en Meta y pegar un
 * token se puede hacer siempre.
 */
export default function PaginasMeta({
  paginas,
  anuncios,
  productos,
  appId,
  configId,
  graphVersion,
}: {
  paginas: PaginaMeta[];
  anuncios: AnuncioPorVincular[];
  productos: { id: number; nombre: string }[];
  appId: string | null;
  configId: string | null;
  graphVersion: string;
}) {
  const router = useRouter();

  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [sdkListo, setSdkListo] = useState(false);
  const [disponibles, setDisponibles] = useState<Disponible[] | null>(null);

  /*
   * El SDK se carga una sola vez y solo si hay app configurada. Sin appId el
   * botón no se enseña, así que tampoco hay nada que cargar: pedir un script a
   * Facebook en una instalación que no usa Meta es tráfico y es un tercero
   * mirando, los dos a cambio de nada.
   */
  useEffect(() => {
    if (!appId || typeof window === "undefined") return;

    if (window.FB) {
      setSdkListo(true);
      return;
    }

    if (document.getElementById("fb-sdk")) return;

    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: graphVersion, xfbml: false, cookie: false });
      setSdkListo(true);
    };

    const s = document.createElement("script");
    s.id = "fb-sdk";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    document.body.appendChild(s);
  }, [appId, graphVersion]);

  /** Manda a nuestro servidor lo que devolvió la ventana y pide las páginas. */
  const pedirPaginas = useCallback(async (datos: { code?: string; token?: string }) => {
    setOcupado(true);
    setError(null);
    setAviso(null);

    try {
      const r = await fetch("/api/meta/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      const cuerpo = await r.json();

      if (!r.ok) {
        setError(cuerpo.error ?? "Meta no devolvió las páginas");
        return;
      }

      setDisponibles(cuerpo.paginas as Disponible[]);
    } catch {
      setError("No se pudo hablar con el servidor");
    } finally {
      setOcupado(false);
    }
  }, []);

  function entrarConFacebook() {
    if (!window.FB) return;

    setError(null);
    setAviso(null);

    /*
     * Con configuración de Business Login se pide un CÓDIGO: así el token de
     * página no llega al navegador ni un instante, y la ventana enseña el
     * selector de páginas de Meta. Sin ella, el SDK solo sabe devolver un token
     * de usuario, que vale para preguntar las páginas y nada más.
     */
    const opciones: Record<string, unknown> = configId
      ? { config_id: configId, response_type: "code", override_default_response_type: true }
      : { scope: PERMISOS };

    window.FB.login((r) => {
      const code = r.authResponse?.code;
      const accessToken = r.authResponse?.accessToken;

      if (!code && !accessToken) {
        // Cerrar la ventana no es un fallo: es una decisión. Se dice sin
        // alarma y no se deja el botón girando.
        setError("Se cerró la ventana de Facebook sin dar acceso.");
        return;
      }

      void pedirPaginas(code ? { code } : { token: accessToken });
    }, opciones);
  }

  async function conectarElegida(elegida: string) {
    setOcupado(true);
    setError(null);
    setAviso(null);

    try {
      const r = await fetch("/api/meta/oauth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: elegida }),
      });
      const datos = await r.json();

      if (!r.ok) {
        setError(datos.error ?? "No se pudo conectar la página");
        return;
      }

      if (datos.aviso) setAviso(datos.aviso);
      setDisponibles(null);
      router.refresh();
    } catch {
      setError("No se pudo hablar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  async function conectarAMano(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    setAviso(null);

    try {
      const r = await fetch("/api/meta/canales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: pageId.trim(), token: token.trim() }),
      });
      const datos = await r.json();

      if (!r.ok) {
        setError(datos.error ?? "No se pudo conectar la página");
        return;
      }

      if (datos.aviso) setAviso(datos.aviso);
      setPageId("");
      setToken("");
      router.refresh();
    } catch {
      setError("No se pudo hablar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar(id: number, nombre: string) {
    // Se va con sus conversaciones: `eliminarCanal` las borra. Sin este aviso,
    // desconectar por error se lleva por delante el historial de esa página.
    if (!confirm(`¿Desconectar «${nombre}»? Se borran también sus conversaciones y ventas.`)) return;

    setOcupado(true);
    await fetch(`/api/meta/canales?id=${id}`, { method: "DELETE" });
    setOcupado(false);
    router.refresh();
  }

  async function vincular(adId: string, productoId: number | null) {
    await fetch("/api/meta/canales", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId, productoId }),
    });
    router.refresh();
  }

  return (
    <>
      <div className="sd-mitades" style={{ marginBottom: 14 }}>
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>
            Páginas conectadas
          </h2>

          {paginas.length === 0 ? (
            <Vacio
              titulo="Todavía no hay ninguna página"
              texto="Conecta una página de Facebook para recibir sus mensajes de Messenger, los directos de su Instagram y los comentarios de sus anuncios."
            />
          ) : (
            <ul style={{ display: "grid", gap: 11 }}>
              {paginas.map((p) => (
                <li
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{p.nombre}</span>
                    <span className="tenue" style={{ display: "block" }}>
                      <span className="num">{p.pageId}</span>
                      {p.igUserId ? " · Instagram enlazado" : " · sin Instagram"}
                      {" · "}
                      {p.ultimoEventoAt ? hace(p.ultimoEventoAt) : "sin actividad"}
                    </span>
                  </span>

                  {/* El agente se enciende donde se encienden todos: en Números.
                      Aquí solo se dice si está, para no partir el interruptor en
                      dos sitios que puedan contradecirse. */}
                  <span
                    className={`pastilla ${p.agenteActivo ? "pastilla-ia" : "pastilla-abierta"}`}
                  >
                    {p.agenteActivo ? "Responde la IA" : "Solo mira"}
                  </span>

                  <button
                    type="button"
                    className="btn btn-secundario"
                    disabled={ocupado}
                    onClick={() => desconectar(p.id, p.nombre)}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
            Conectar una página
          </h2>
          <p className="tenue" style={{ marginBottom: 14 }}>
            Entra con la cuenta de Facebook que administra la página. Meta abre su propia ventana
            y elige ahí qué páginas nos dejas usar.
          </p>

          {appId ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={entrarConFacebook}
                disabled={!sdkListo || ocupado}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                  width: "100%", background: "#1877F2", color: "#fff", border: "none",
                  fontWeight: 600, padding: "11px 14px",
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="#fff">
                  <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.955.93-1.955 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
                </svg>
                {!sdkListo ? "Cargando Facebook…" : ocupado ? "Hablando con Meta…" : "Entrar con Facebook"}
              </button>

              {!configId && (
                <p className="tenue" style={{ marginTop: 9 }}>
                  Sin <span className="num">META_LOGIN_CONFIG_ID</span> la ventana pide los permisos
                  uno a uno en vez de enseñar el selector de páginas de Meta. Funciona igual, pero
                  con la configuración de Business Login puesta es la pantalla que ya conoces.
                </p>
              )}
            </>
          ) : (
            <div className="aviso aviso-ambar" role="status">
              Falta <span className="num">META_APP_ID</span> en el servidor. Sin eso no se puede
              abrir la ventana de Facebook: conecta la página con el token de abajo, o pon la
              variable y reinicia.
            </div>
          )}

          {/* ── Las páginas que devolvió Meta ─────────────────────────────
              Aparece justo debajo del botón, en la misma tarjeta: la elección
              es el segundo tiempo del mismo gesto, no otra pantalla. */}
          {disponibles && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <p style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 9 }}>
                Elige la página que atenderá el panel
              </p>

              <ul style={{ display: "grid", gap: 9 }}>
                {disponibles.map((d) => (
                  <li
                    key={d.pageId}
                    style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{d.nombre}</span>
                      <span className="tenue" style={{ display: "block" }}>
                        <span className="num">{d.pageId}</span>
                        {d.tieneInstagram ? " · Instagram enlazado" : " · sin Instagram"}
                      </span>
                    </span>

                    {d.conectada ? (
                      <span className="pastilla pastilla-ia">Ya conectada</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-acento"
                        disabled={ocupado}
                        onClick={() => conectarElegida(d.pageId)}
                      >
                        Conectar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="aviso aviso-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
          {aviso && (
            <div className="aviso aviso-ambar" role="status" style={{ marginTop: 12 }}>
              {aviso}
            </div>
          )}

          {/* ── El camino de repuesto ─────────────────────────────────────
              Plegado, porque es el que casi nadie necesita ya. Sigue aquí
              porque la ventana depende de la configuración de la app en Meta,
              y pegar un token funciona el primer día. */}
          <details style={{ marginTop: 16 }}>
            <summary
              className="tenue"
              style={{ cursor: "pointer", fontSize: 12.5, userSelect: "none" }}
            >
              Conectar pegando el token de página
            </summary>

            <form onSubmit={conectarAMano} style={{ marginTop: 12 }}>
              <p className="tenue" style={{ marginBottom: 12 }}>
                El ID y el token salen de <span className="num">developers.facebook.com</span> → tu
                app → Messenger → Configuración.
              </p>

              <label className="etiqueta-campo" htmlFor="pageId">
                ID de la página
              </label>
              <input
                id="pageId"
                className="campo num"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                placeholder="102938475601234"
                style={{ marginBottom: 12 }}
                required
              />

              <label className="etiqueta-campo" htmlFor="token">
                Token de acceso de la página
              </label>
              <input
                id="token"
                className="campo"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="EAAG…"
                style={{ marginBottom: 12 }}
                required
              />

              <button type="submit" className="btn btn-secundario" disabled={ocupado}>
                {ocupado ? "Comprobando con Meta…" : "Conectar con el token"}
              </button>
            </form>
          </details>

          <p className="tenue" style={{ marginTop: 12 }}>
            Por cualquiera de los dos caminos, el token se comprueba contra Meta antes de guardarlo
            y se guarda cifrado. La suscripción a los eventos se hace sola.
          </p>
        </section>
      </div>

      {/*
        LA REGLA DEL PRECIO, EN PANTALLA.

        Un anuncio sin producto es un hilo donde el agente NO cotiza: contesta
        que le atiende una persona y se calla. Esta lista es donde eso se
        arregla, y por eso vive aquí y no escondida en otra pantalla.
      */}
      <section className="tarjeta">
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
          Anuncios y sus productos
        </h2>
        <p className="tenue" style={{ marginBottom: 12 }}>
          El precio sale del catálogo, nunca del modelo. Si un anuncio no tiene producto, el
          agente no cotiza en esa conversación: la pasa a una persona.
        </p>

        {anuncios.length === 0 ? (
          <Vacio
            titulo="Todavía no ha llegado nadie por un anuncio"
            texto="Cuando alguien escriba desde un anuncio, aparecerá aquí para que le digas qué producto es."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Anuncio</th>
                  <th>Producto del catálogo</th>
                  <th style={{ textAlign: "right" }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {anuncios.map((a) => (
                  <tr key={a.adId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.titulo ?? "Anuncio sin título"}</div>
                      <div className="tenue num">{a.adId}</div>
                    </td>
                    <td>
                      <select
                        className="campo"
                        value={a.productoId ?? ""}
                        onChange={(e) =>
                          vincular(a.adId, e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">— sin vincular —</option>
                        {productos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span
                        className={`pastilla ${a.productoId ? "pastilla-ia" : "pastilla-revision"}`}
                      >
                        {a.productoId ? "Cotiza" : "No cotiza"}
                      </span>
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
