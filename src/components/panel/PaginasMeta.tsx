"use client";

import { useState } from "react";
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

/**
 * Conectar páginas de Meta y vincular sus anuncios a productos.
 *
 * El token se pide a mano en vez de por Facebook Login. Es más feo y es más
 * honesto: el inicio de sesión de Meta exige que la app esté revisada y en
 * producción, y hasta que eso pase el botón bonito no funcionaría para nadie.
 * Pegar el token de la página se puede hacer hoy.
 */
export default function PaginasMeta({
  paginas,
  anuncios,
  productos,
}: {
  paginas: PaginaMeta[];
  anuncios: AnuncioPorVincular[];
  productos: { id: number; nombre: string }[];
}) {
  const router = useRouter();
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function conectar(e: React.FormEvent) {
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
          <p className="tenue" style={{ marginBottom: 12 }}>
            El ID y el token de página salen de{" "}
            <span className="num">developers.facebook.com</span> → tu app → Messenger →
            Configuración.
          </p>

          <form onSubmit={conectar}>
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
              placeholder="EAAG..."
              style={{ marginBottom: 12 }}
              required
            />

            {error && (
              <div className="aviso aviso-error" role="alert" style={{ marginBottom: 10 }}>
                {error}
              </div>
            )}
            {aviso && (
              <div className="aviso aviso-ambar" role="status" style={{ marginBottom: 10 }}>
                {aviso}
              </div>
            )}

            <button type="submit" className="btn btn-acento" disabled={ocupado}>
              {ocupado ? "Comprobando con Meta…" : "Conectar página"}
            </button>

            <p className="tenue" style={{ marginTop: 10 }}>
              El token se comprueba contra Meta antes de guardarlo y se guarda cifrado. La
              suscripción a los eventos se hace sola.
            </p>
          </form>
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
