"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Vacio, hace } from "@/components/panel/Piezas";

export interface PaginaMeta {
  id: number;
  nombre: string;
  igUserId: string | null;
  agenteActivo: boolean;
  ultimoEventoAt: number | null;
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
 * Conectar páginas de Facebook.
 *
 * Dos caminos hacia lo mismo. El botón abre la ventana de Meta y el token no
 * pasa por el navegador: la ventana devuelve un código y el servidor lo cambia.
 * Pegar el identificador y el token a mano sigue estando, pero solo lo ve quien
 * administra la plataforma: a un dueño de tienda esa pantalla no le dice nada y
 * le da una forma nueva de equivocarse.
 */
export default function PaginasMeta({
  paginas,
  appId,
  configId,
  graphVersion,
  avanzado,
}: {
  paginas: PaginaMeta[];
  appId: string | null;
  configId: string | null;
  graphVersion: string;
  /** Enseña el camino manual. Reservado a quien administra la plataforma. */
  avanzado: boolean;
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
        setError(cuerpo.error ?? "Facebook no devolvió tus páginas");
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

  return (
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
                  {/* Ni identificadores ni tokens: al dueño de la tienda le
                      importa si su página está viva y quién contesta. */}
                  <span className="tenue" style={{ display: "block" }}>
                    {p.igUserId ? "Facebook e Instagram" : "Facebook"}
                    {" · "}
                    {p.ultimoEventoAt ? `activa ${hace(p.ultimoEventoAt)}` : "sin actividad todavía"}
                  </span>
                </span>

                {/* El agente se enciende donde se encienden todos: en Números.
                    Aquí solo se dice si está, para no partir el interruptor en
                    dos sitios que puedan contradecirse. */}
                <span className={`pastilla ${p.agenteActivo ? "pastilla-ia" : "pastilla-abierta"}`}>
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
          Entra con la cuenta de Facebook que administra la página. Facebook abre su propia
          ventana y eliges ahí qué páginas nos dejas atender.
        </p>

        {appId ? (
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
            {!sdkListo ? "Abriendo Facebook…" : ocupado ? "Un momento…" : "Entrar con Facebook"}
          </button>
        ) : (
          <div className="aviso aviso-ambar" role="status">
            La conexión con Facebook todavía no está disponible en este panel.
          </div>
        )}

        {/* ── Las páginas que devolvió Facebook ─────────────────────────
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
                      {d.tieneInstagram ? "Facebook e Instagram" : "Facebook"}
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

        <p className="tenue" style={{ marginTop: 12 }}>
          El acceso se guarda cifrado y puedes quitarlo cuando quieras. No publicamos nada en tu
          nombre: solo respondemos a quien te escribe.
        </p>

        {/* ── El camino de repuesto ─────────────────────────────────────
            Solo para quien administra la plataforma. Existe porque la ventana
            depende de la configuración de la app en Meta, y pegar un token
            funciona siempre; pero enseñárselo a un dueño de tienda es pedirle
            que maneje una credencial que no debería tocar. */}
        {avanzado && (
          <details style={{ marginTop: 16 }}>
            <summary
              className="tenue"
              style={{ cursor: "pointer", fontSize: 12.5, userSelect: "none" }}
            >
              Conectar con un token de página
            </summary>

            <form onSubmit={conectarAMano} style={{ marginTop: 12 }}>
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
                {ocupado ? "Comprobando…" : "Conectar con el token"}
              </button>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
