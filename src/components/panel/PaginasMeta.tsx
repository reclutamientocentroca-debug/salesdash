"use client";

import { useEffect, useState } from "react";
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

/**
 * Conectar páginas de Facebook.
 *
 * EL BOTÓN LLEVA A FACEBOOK, no abre una ventanita. El dueño pulsa, va a
 * facebook.com con la sesión que ya tiene abierta, elige ahí la página en la
 * pantalla de Meta —la misma que ya conoce de conectar cualquier otra
 * herramienta— y vuelve al panel con la lista lista para elegir.
 *
 * Antes esto era el SDK de Facebook y una ventana emergente. Se cayó por lo de
 * siempre: medio navegador de móvil bloquea los popups, y cuando lo bloquea no
 * pasa NADA —el dueño pulsa el botón azul y se queda mirando una pantalla que
 * no se mueve, sin un error que enseñar porque no hubo error—. De paso se van
 * doscientos kilobytes de JavaScript de un tercero y sus cookies del dominio
 * del panel.
 *
 * Pegar el identificador y el token a mano sigue estando, pero solo lo ve quien
 * administra la plataforma: a un dueño de tienda esa pantalla no le dice nada y
 * le da una forma nueva de equivocarse.
 */
export default function PaginasMeta({
  paginas,
  appId,
  configId,
  avanzado,
}: {
  paginas: PaginaMeta[];
  appId: string | null;
  configId: string | null;
  /** Enseña el camino manual. Reservado a quien administra la plataforma. */
  avanzado: boolean;
}) {
  const router = useRouter();

  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [disponibles, setDisponibles] = useState<Disponible[] | null>(null);
  const [cargando, setCargando] = useState(false);

  /*
   * LA VUELTA DE FACEBOOK.
   *
   * El servidor deja las páginas en su memoria y manda al panel con `?elegir=1`
   * —o con un `?error=` si el dueño canceló o Meta se quejó—. La lista no viaja
   * por la dirección del navegador: enseñar en la barra qué páginas administra
   * alguien no aporta nada y se queda en su historial. Se pide aquí, con su
   * sesión.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const problema = q.get("error");
    const elegir = q.get("elegir") === "1";

    if (!problema && !elegir) return;

    // La dirección se limpia en cuanto se lee: recargar no puede repetir un
    // error viejo ni volver a abrir un selector que ya se usó.
    window.history.replaceState({}, "", window.location.pathname);

    if (problema) {
      setError(problema);
      return;
    }

    setCargando(true);
    fetch("/api/meta/oauth")
      .then((r) => r.json())
      .then((d) => {
        const lista = (d.paginas ?? []) as Disponible[];
        if (lista.length === 0) {
          setError("La sesión con Facebook caducó. Vuelve a pulsar el botón.");
          return;
        }
        setDisponibles(lista);
      })
      .catch(() => setError("No se pudo hablar con el servidor"))
      .finally(() => setCargando(false));
  }, []);

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
          Te lleva a Facebook con la sesión que ya tienes abierta. Eliges ahí qué página nos dejas
          atender y vuelves aquí para terminar.
        </p>

        {appId ? (
          /*
            UN ENLACE, NO UN BOTÓN CON JAVASCRIPT.
            Es una navegación de verdad: el navegador va a facebook.com y vuelve.
            Ningún popup que bloquear, ninguna espera a que cargue un SDK, y
            funciona igual en el móvil —que es donde se conecta la mitad de las
            páginas— y con la pestaña de Facebook ya abierta al lado.
          */
          <a
            href="/api/meta/oauth/entrar"
            className="btn"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              width: "100%", background: "#1877F2", color: "#fff", border: "none",
              fontWeight: 600, padding: "11px 14px", textDecoration: "none",
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="#fff">
              <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.955.93-1.955 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
            </svg>
            Continuar con Facebook
          </a>
        ) : (
          <div className="aviso aviso-ambar" role="status">
            La conexión con Facebook todavía no está disponible en este panel.
          </div>
        )}

        {cargando && (
          <p className="tenue" style={{ marginTop: 10 }}>
            Trayendo tus páginas de Facebook…
          </p>
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
