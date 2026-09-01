"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hace } from "@/components/panel/Piezas";

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

  /**
   * Traerse las páginas que el servidor dejó en su memoria al volver.
   *
   * La lista no viaja por la dirección del navegador —enseñar en la barra qué
   * páginas administra alguien no aporta nada y se le queda en el historial—:
   * se pide aquí, con su sesión.
   */
  const traerPaginas = useCallback(async () => {
    setCargando(true);
    setError(null);

    try {
      const r = await fetch("/api/meta/oauth");
      const d = await r.json();
      const lista = (d.paginas ?? []) as Disponible[];

      if (lista.length === 0) {
        setError("La sesión con Facebook caducó. Vuelve a pulsar el botón.");
        return;
      }
      setDisponibles(lista);
    } catch {
      setError("No se pudo hablar con el servidor");
    } finally {
      setCargando(false);
    }
  }, []);

  /*
   * LO QUE DICE LA VENTANA FLOTANTE AL CERRARSE.
   *
   * Se comprueba el origen ANTES de mirar nada: `message` lo puede mandar
   * cualquier página que tenga una referencia a esta, así que un aviso de otro
   * sitio no puede hacer que el panel se ponga a pedir páginas. Y la marca
   * `fuente` descarta el ruido de extensiones, que hablan por este mismo canal.
   */
  useEffect(() => {
    function recibir(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;

      const d = e.data as { fuente?: string; error?: string; elegir?: string } | null;
      if (!d || d.fuente !== "salesdash-meta") return;

      if (d.error) {
        setError(d.error);
        return;
      }
      if (d.elegir === "1") void traerPaginas();
    }

    window.addEventListener("message", recibir);
    return () => window.removeEventListener("message", recibir);
  }, [traerPaginas]);

  /*
   * Y EL CAMINO DE RESPALDO: cuando el navegador bloqueó la ventana flotante,
   * el panel navegó a Facebook y vuelve por la dirección, con `?elegir=1` o con
   * un `?error=`. Es el mismo final por otro camino.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const problema = q.get("error");
    const elegir = q.get("elegir") === "1";

    if (!problema && !elegir) return;

    // La dirección se limpia en cuanto se lee: recargar no puede repetir un
    // error viejo ni volver a abrir un selector que ya se usó.
    window.history.replaceState({}, "", window.location.pathname);

    if (problema) setError(problema);
    else void traerPaginas();
  }, [traerPaginas]);

  /**
   * ABRIR FACEBOOK EN UNA VENTANA FLOTANTE.
   *
   * Encima del panel y sin perderlo de vista: el dueño ve dónde estaba mientras
   * elige la página, y al cerrarse la ventana la lista aparece donde estaba
   * mirando. Irse de la página entera funciona igual, pero se siente como salir
   * del sitio.
   *
   * `window.open` va DENTRO del clic y sin nada asíncrono delante: así es como
   * los navegadores lo dejan pasar. Aun así puede bloquearse —hay quien lo tiene
   * apagado del todo—, y entonces no se le enseña un error: se navega, que es
   * el camino que siempre funciona.
   */
  function entrarConFacebook() {
    setError(null);
    setDisponibles(null);

    const ancho = 620;
    const alto = 760;
    const x = window.screenX + Math.max(0, (window.outerWidth - ancho) / 2);
    const y = window.screenY + Math.max(0, (window.outerHeight - alto) / 3);

    const ventana = window.open(
      "/api/meta/oauth/entrar?flotante=1",
      "salesdash-facebook",
      `popup=1,width=${ancho},height=${alto},left=${Math.round(x)},top=${Math.round(y)}`,
    );

    if (!ventana || ventana.closed) {
      window.location.href = "/api/meta/oauth/entrar";
      return;
    }

    ventana.focus();
  }

  /**
   * Encender o apagar la IA en esta página.
   *
   * Es la misma ruta que usa Números para un WhatsApp, así que la regla de «por
   * canal contesta uno solo» se aplica igual: encender el agente apaga el modo
   * vigilar, y apagarlo lo devuelve. No se duplica aquí ninguna decisión.
   */
  async function alternarAgente(id: number, activo: boolean) {
    setOcupado(true);
    setError(null);

    const r = await fetch(`/api/canales/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agente_activo: activo }),
    });
    const datos = await r.json().catch(() => ({}));
    setOcupado(false);

    if (!r.ok) {
      setError(datos.error ?? "No se pudo cambiar quién contesta en esta página.");
      return;
    }

    /*
     * Se contesta con el estado REAL del agente, no con un «guardado»: puede
     * faltar la clave del modelo o el país, y quien acaba de encenderlo tiene
     * que enterarse ahora y no cuando un cliente se quede sin respuesta.
     */
    const impedimento = datos.agente?.impedimentos?.[0];
    if (activo && impedimento) setError(impedimento);

    router.refresh();
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

  /*
   * DOS PANORAMAS, Y EL PRIMERO ES UN BOTÓN.
   *
   * Sin ninguna página conectada, partir la pantalla en dos mitades deja media
   * pantalla diciendo «aquí no hay nada» al lado de lo único que hay que hacer.
   * Cuando no hay nada conectado, esta pantalla ES el botón: una tarjeta sola,
   * con lo que se gana al conectar y el botón azul debajo.
   *
   * Con páginas ya conectadas manda la lista —que es lo que se viene a mirar— y
   * conectar otra pasa a ser lo secundario, en su mitad de siempre.
   */
  const sinPaginas = paginas.length === 0;

  return (
    <div className={sinPaginas ? "" : "sd-mitades"} style={{ marginBottom: 14 }}>
      {!sinPaginas && (
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>
            Páginas conectadas
          </h2>

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

                {/*
                  EL AGENTE SE ENCIENDE AQUÍ, en la página, y no en otra
                  pantalla. Estaba en Números —donde viven los WhatsApp— y a una
                  página de Facebook no se llega por ahí: quien conectaba una
                  página se quedaba con la bandeja llena y sin forma de decirle
                  a la IA que contestara.

                  Encenderlo aquí es lo mismo que encenderlo allí: la misma
                  ruta, la misma regla de que por canal contesta uno solo.
                */}
                <button
                  type="button"
                  className={`btn ${p.agenteActivo ? "btn-acento" : "btn-secundario"}`}
                  disabled={ocupado}
                  aria-pressed={p.agenteActivo}
                  onClick={() => alternarAgente(p.id, !p.agenteActivo)}
                  title={
                    p.agenteActivo
                      ? "La IA contesta los mensajes de esta página"
                      : "El panel solo mira: nadie contesta desde aquí"
                  }
                >
                  {p.agenteActivo ? "Responde la IA" : "Solo mira"}
                </button>

                {/* Y su guion, que es donde se le pone el país. Cada página
                    tiene el suyo, como cada número. */}
                <a
                  className="btn btn-tenue"
                  style={{ textDecoration: "none" }}
                  href={`/agente?canal=${p.id}`}
                  title="El país, el guion y el modelo de esta página"
                >
                  Su agente
                </a>

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
        </section>
      )}

      <section className="tarjeta" style={sinPaginas ? { maxWidth: 560, margin: "0 auto" } : undefined}>
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
          {sinPaginas ? "Conecta tu página de Facebook" : "Conectar una página"}
        </h2>
        <p className="tenue" style={{ marginBottom: 14 }}>
          {sinPaginas
            ? "Sus mensajes de Messenger, los directos de su Instagram y los comentarios de sus anuncios entran aquí, en las mismas conversaciones y en las mismas ventas."
            : "Se abre Facebook en una ventana encima de esta, con la sesión que ya tienes. Eliges ahí qué página nos dejas atender, la ventana se cierra sola y terminas aquí."}
        </p>

        {appId ? (
          /*
            UN ENLACE DE VERDAD, que además abre la ventana flotante.
            El `href` no es decorativo: es lo que hace que funcione el «abrir en
            otra pestaña» del botón derecho, y es a donde cae el navegador que
            bloquea las ventanas emergentes. El clic normal abre la flotante y
            cancela la navegación.
          */
          <a
            href="/api/meta/oauth/entrar"
            className="btn"
            onClick={(e) => {
              e.preventDefault();
              entrarConFacebook();
            }}
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
