"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Nube, Vacio, dinero, hace, tienePedido } from "@/components/panel/Piezas";
import ProductoDeLaFoto from "@/components/panel/ProductoDeLaFoto";
import type { FichaDeLaFoto } from "@/lib/meta/contexto-anuncio";

/**
 * LA BANDEJA DE META.
 *
 * Mensajes privados y comentarios en la MISMA lista y en el MISMO hilo. No es
 * una preferencia de diseño: quien comenta «¿cuánto cuesta?» debajo de un
 * anuncio es el mismo lead que después escribe por Messenger, y en dos
 * pantallas distintas se atiende dos veces o no se atiende ninguna.
 *
 * Lo demás gira alrededor de una sola pregunta —quién contesta aquí—, porque es
 * la que decide si el cliente recibe una respuesta o dos. La banda de color lo
 * dice a todo lo ancho, y la caja de escribir está cerrada mientras conteste la
 * IA: para escribir hay que tomar el chat, y tomarlo calla al agente en este
 * hilo y solo en este.
 */

export interface FilaMeta {
  id: number;
  canalId: number;
  canal: string;
  cliente: string | null;
  superficie: string;
  atiende: string;
  cerradoPor: string;
  /** Ya tiene un pedido: cerrado o con el resumen escrito. Es la nubecita. */
  pedido: boolean;
  ultimoTexto: string | null;
  ultimoEmisor: string | null;
  cuando: number;
}

interface MensajeHilo {
  id: number;
  emisor: string;
  tipo: string;
  content: string;
  descripcion_imagen: string | null;
  created_at: number;
}

interface Hilo {
  conversacion: {
    id: number;
    cliente_nombre: string | null;
    superficie: string | null;
    atiende: string;
    cerrado_por: string;
    canal: string;
    total: number | null;
    envio: number | null;
    producto_vendido: string | null;
    producto_anuncio: string | null;
    /** Lo que el anuncio le prometió a ESTE cliente. Ver `anuncioParaModelo`. */
    descripcion_anuncio: string | null;
    resumen_pedido: string | null;
    datos_faltantes: string[];
    intervencion_humana: number;
  };
  mensajes: MensajeHilo[];
  /** Qué es y cuánto vale lo que sale en la foto de este chat. Ver `ProductoDeLaFoto`. */
  foto: FichaDeLaFoto | null;
  /** Lo que de verdad decía el anuncio de Meta: su texto y su enlace. */
  anuncio: { descripcion: string | null; enlace: string | null } | null;
}

type Filtro = "todo" | "mensajes" | "comentarios" | "pendientes";

const FILTROS: { clave: Filtro; texto: string }[] = [
  { clave: "todo", texto: "Todo" },
  { clave: "mensajes", texto: "Mensajes" },
  { clave: "comentarios", texto: "Comentarios" },
  { clave: "pendientes", texto: "Sin responder" },
];

/** La marca del canal sobre el avatar. Dos letras como mucho. */
const CANALES: Record<string, { clase: string; letra: string; nombre: string }> = {
  messenger: { clase: "sd-meta-messenger", letra: "m", nombre: "Messenger" },
  instagram: { clase: "sd-meta-instagram", letra: "ig", nombre: "Instagram" },
  comentario: { clase: "sd-meta-comentario", letra: "“", nombre: "Comentario" },
};

function canalDe(superficie: string | null) {
  return CANALES[superficie ?? "messenger"] ?? CANALES.messenger;
}

/** Un color estable por cliente: el mismo nombre da siempre el mismo tono. */
const TONOS = ["#3f6b8a", "#b4674a", "#7a5ba6", "#4d7c63", "#a1683c", "#5a6b65"];
function tonoDe(texto: string): string {
  let n = 0;
  for (let i = 0; i < texto.length; i++) n = (n + texto.charCodeAt(i)) % TONOS.length;
  return TONOS[n];
}

/** «Sin responder» es que el último que habló fue el cliente. */
function sinResponder(f: FilaMeta): boolean {
  return f.ultimoEmisor === "cliente";
}

export default function BandejaMeta({
  filas,
  paginas,
  superficie = "messenger",
}: {
  filas: FilaMeta[];
  paginas: { id: number; nombre: string }[];
  superficie?: "messenger" | "instagram";
}) {
  const router = useRouter();

  const [filtro, setFiltro] = useState<Filtro>("todo");
  const [pagina, setPagina] = useState<number | "todas">("todas");
  const [abierta, setAbierta] = useState<number | null>(filas[0]?.id ?? null);

  const [hilo, setHilo] = useState<Hilo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finDelHilo = useRef<HTMLDivElement>(null);

  const filasDeSuperficie = filas.filter((f) => superficie === "instagram"
    ? f.superficie === "instagram"
    : f.superficie !== "instagram");

  const visibles = filasDeSuperficie.filter((f) => {
    if (pagina !== "todas" && f.canalId !== pagina) return false;
    if (filtro === "comentarios") return f.superficie === "comentario";
    if (filtro === "mensajes") return f.superficie !== "comentario";
    if (filtro === "pendientes") return sinResponder(f);
    return true;
  });

  const cargarHilo = useCallback(async (id: number) => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/conversations/${id}`);
      const datos = await r.json();
      if (!r.ok) {
        setError(datos.error ?? "No se pudo abrir la conversación");
        return;
      }
      setHilo(datos as Hilo);
    } catch {
      setError("No se pudo hablar con el servidor");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (abierta !== null) void cargarHilo(abierta);
  }, [abierta, cargarHilo]);

  // El hilo se abre por abajo, que es donde está lo último. Abrirlo arriba
  // obliga a bajar a mano cada vez para leer lo que acaba de pasar.
  useEffect(() => {
    finDelHilo.current?.scrollIntoView({ block: "end" });
  }, [hilo]);

  async function cambiarQuienAtiende(accion: "devolver_a_la_ia" | "atiende_humano") {
    if (abierta === null) return;
    setError(null);

    const r = await fetch(`/api/conversations/${abierta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion }),
    });
    const datos = await r.json().catch(() => ({}));

    if (!r.ok) {
      setError(datos.error ?? "No se pudo cambiar quién atiende.");
      return;
    }

    /*
     * Devolver el hilo a la IA no garantiza que vaya a hablar: el número puede
     * estar apagado, o un vendedor puede haber escrito hace un minuto. Se dice
     * AHORA y no cuando el cliente se quede sin respuesta.
     */
    // Y si el intento ya terminó sin escribir nada, se dice por qué: ver
    // `porQueNoContesto`.
    if (accion === "devolver_a_la_ia" && !datos.agente?.callado && datos.noContesto) {
      setError(datos.noContesto);
    }
    if (accion === "devolver_a_la_ia" && datos.agente?.callado) {
      setError(datos.agente.explicacion ?? null);
    }

    await cargarHilo(abierta);
    router.refresh();
  }

  async function enviar() {
    if (abierta === null || !texto.trim()) return;
    setEnviando(true);
    setError(null);

    try {
      const r = await fetch(`/api/conversations/${abierta}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      const datos = await r.json().catch(() => ({}));

      if (!r.ok) {
        setError(datos.error ?? "No se pudo enviar el mensaje");
        return;
      }

      setTexto("");
      await cargarHilo(abierta);
      router.refresh();
    } catch {
      setError("No se pudo hablar con el servidor");
    } finally {
      setEnviando(false);
    }
  }

  const conv = hilo?.conversacion;
  const esHumano = conv?.atiende === "humano";
  const esComentario = conv?.superficie === "comentario";

  return (
    <div className="sd-meta-bandeja">
      {/* ── La lista ─────────────────────────────────────────────── */}
      <aside className="sd-meta-lista">
        <div className="sd-meta-filtros" role="group" aria-label="Filtrar la bandeja">
          {FILTROS.map((f) => (
            <button
              key={f.clave}
              type="button"
              className="sd-meta-filtro"
              aria-pressed={filtro === f.clave}
              onClick={() => setFiltro(f.clave)}
            >
              {f.texto}
            </button>
          ))}

          {paginas.length > 1 && (
            <select
              className="campo"
              style={{ width: "auto", marginLeft: "auto", padding: "4px 8px", fontSize: 12 }}
              aria-label="Página"
              value={pagina}
              onChange={(e) => setPagina(e.target.value === "todas" ? "todas" : Number(e.target.value))}
            >
              <option value="todas">Todas</option>
              {paginas.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          )}
        </div>

        <div className="sd-meta-filas">
          {visibles.length === 0 ? (
            <Vacio
              titulo="Nada por aquí"
              texto="Cuando alguien escriba o comente en tus páginas, aparecerá en esta lista."
            />
          ) : (
            visibles.map((f) => {
              const ch = canalDe(f.superficie);
              const nombre = f.cliente ?? "Sin nombre";

              return (
                <button
                  key={f.id}
                  type="button"
                  className="sd-meta-fila"
                  aria-current={f.id === abierta}
                  onClick={() => setAbierta(f.id)}
                >
                  <span className="sd-meta-avatar" style={{ background: tonoDe(nombre) }} aria-hidden="true">
                    {nombre.charAt(0).toUpperCase()}
                    <span className={`sd-meta-canalito ${ch.clase}`}>{ch.letra}</span>
                  </span>

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 13, fontWeight: 600, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {nombre}
                      </span>
                      <span className="tenue num" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                        {hace(f.cuando)}
                      </span>
                    </span>

                    <span
                      style={{
                        display: "block", fontSize: 12.5, color: "var(--ink-2)", marginTop: 2,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {(f.ultimoTexto ?? "").replace(/\n/g, " · ") || "—"}
                    </span>

                    <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, flexWrap: "wrap" }}>
                      {f.pedido && <Nube />}
                      {sinResponder(f) ? (
                        <span className="pastilla pastilla-intervencion">Sin responder</span>
                      ) : f.atiende === "humano" ? (
                        <span className="pastilla pastilla-humano">Contesta el equipo</span>
                      ) : f.cerradoPor === "ia" ? (
                        <span className="pastilla pastilla-ia">Automatizada</span>
                      ) : (
                        <span className="pastilla pastilla-ia">Contesta la IA</span>
                      )}
                      {paginas.length > 1 && (
                        <span className="tenue" style={{ color: "var(--ink-4)" }}>{f.canal}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── El hilo ──────────────────────────────────────────────── */}
      <main className="sd-meta-hilo">
        <div className="sd-meta-cabecera">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-.012em" }}>
              {conv?.cliente_nombre ?? (cargando ? "Abriendo…" : "Elige una conversación")}
            </h2>
            <div className="tenue" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {conv ? `${canalDe(conv.superficie).nombre} · ${conv.canal}` : "—"}
              {conv && tienePedido(conv) && <Nube />}
            </div>
          </div>

          {conv && (
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <button
                type="button"
                className={`btn ${esHumano ? "btn-secundario" : "btn-acento"}`}
                disabled={!esHumano}
                aria-pressed={!esHumano}
                onClick={() => cambiarQuienAtiende("devolver_a_la_ia")}
              >
                Contesta la IA
              </button>
              <button
                type="button"
                className={`btn ${esHumano ? "btn-acento" : "btn-secundario"}`}
                disabled={esHumano}
                aria-pressed={esHumano}
                onClick={() => cambiarQuienAtiende("atiende_humano")}
              >
                Contesto yo
              </button>
            </div>
          )}
        </div>

        {conv && (
          <div className={`sd-meta-banda ${esHumano ? "sd-meta-banda-humano" : "sd-meta-banda-ia"}`}>
            {esHumano ? (
              <>
                <strong>Tomaste este chat.</strong> La IA no escribe aquí hasta que se lo devuelvas.
              </>
            ) : (
              <>
                <strong>La IA está atendiendo.</strong> Contesta sola hasta cerrar la venta,
                comentarios incluidos.
              </>
            )}
          </div>
        )}

        <div className="sd-meta-mensajes">
          {!conv && !cargando && (
            <Vacio titulo="Elige una conversación" texto="Las de la izquierda están ordenadas por lo más reciente." />
          )}

          {hilo?.mensajes.map((m) => {
            /*
             * El comentario público no es una burbuja. Va a lo ancho y con su
             * cabecera porque contestarlo se lee delante de todo el mundo, y
             * confundirlo con un privado es contestar en el sitio equivocado.
             */
            if (esComentario && m.tipo === "texto" && esElComentario(hilo, m)) {
              const mio = m.emisor !== "cliente";
              return (
                <div key={m.id} className={`sd-meta-comment ${mio ? "sd-meta-comment-mio" : ""}`}>
                  <div className="sd-meta-comment-cab">
                    {mio ? "Nuestra respuesta, en el comentario" : "Comentó en tu publicación"}
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.content}</div>
                  <div className="tenue" style={{ marginTop: 7 }}>
                    {conv?.producto_anuncio ? `${conv.producto_anuncio} · ` : ""}
                    {hace(m.created_at)}
                  </div>
                </div>
              );
            }

            const clase =
              m.emisor === "cliente"
                ? "sd-burbuja-cliente"
                : m.emisor === "ia"
                  ? "sd-burbuja-ia"
                  : "sd-burbuja-humano";

            return (
              <div key={m.id} className={`sd-burbuja ${clase}`}>
                {m.content}
                {m.descripcion_imagen && (
                  <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9, fontStyle: "italic" }}>
                    {m.descripcion_imagen}
                  </div>
                )}
                <div style={{ fontSize: 10.5, marginTop: 5, opacity: m.emisor === "cliente" ? 1 : 0.75, color: m.emisor === "cliente" ? "var(--ink-3)" : undefined }}>
                  {m.emisor === "ia" ? "IA · " : m.emisor === "humano" ? "Equipo · " : ""}
                  {hace(m.created_at)}
                </div>
              </div>
            );
          })}

          <div ref={finDelHilo} />
        </div>

        <div className="sd-redactar">
          <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
            <textarea
              rows={1}
              value={texto}
              disabled={!conv || !esHumano || enviando}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter envía, Mayús+Enter hace párrafo. Es lo que ya hacen las
                // manos de quien atiende una bandeja todo el día.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              placeholder={
                !conv
                  ? "Elige una conversación"
                  : esHumano
                    ? esComentario
                      ? "Tu respuesta se publica en el comentario…"
                      : "Escribe tu respuesta…"
                    : "La IA está contestando este chat"
              }
              aria-label="Tu respuesta"
            />
            <button
              type="button"
              className="btn btn-acento"
              disabled={!conv || !esHumano || enviando || !texto.trim()}
              onClick={() => void enviar()}
            >
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>

          {error ? (
            <p style={{ fontSize: 12, marginTop: 8, color: "var(--red)" }}>{error}</p>
          ) : (
            <p className="tenue" style={{ marginTop: 8 }}>
              {!conv
                ? ""
                : esHumano
                  ? esComentario
                    ? "Se publica colgado del comentario, a la vista de todos."
                    : "Sale a nombre de la página."
                  : "Pulsa «Contesto yo» para escribir. La IA se calla solo en este chat."}
            </p>
          )}
        </div>
      </main>

      {/* ── La ficha ─────────────────────────────────────────────── */}
      <aside className="sd-meta-ficha">
        <h3 className="titulo-tarjeta" style={{ marginBottom: 11 }}>Pedido</h3>

        {conv ? (
          <>
            <dl style={{ display: "grid", gap: 10, fontSize: 12.5, margin: "0 0 16px" }}>
              {/*
                QUÉ SE VENDE EN ESTE CHAT, aunque todavía no se haya cerrado.
                Antes esta línea decía «—» hasta el cierre y el título del
                anuncio era un nombre de campaña —«Nuevo Ventas Anuncio»—: quien
                abría la bandeja no sabía qué le estaban pidiendo. Sin venta
                cerrada vale el artículo que la IA tiene delante.
              */}
              <Par etiqueta="Producto" valor={conv.producto_vendido ?? hilo?.foto?.nombre ?? "—"} />
              <Par etiqueta="Del anuncio" valor={conv.producto_anuncio ?? "—"} />
              <Par etiqueta="Envío" valor={dinero(conv.envio)} />
              <Par etiqueta="Total" valor={dinero(conv.total)} />
            </dl>

            {/*
              Y LO QUE ESE ANUNCIO PROMETÍA, que es lo que el cliente leyó antes
              de escribir. `descripcion_anuncio` solo se rellena en WhatsApp; en
              Meta el texto real vive en `anuncios_meta` y llega aparte, en
              `hilo.anuncio` — es el mismo que ya usa el agente para cotizar.
            */}
            {(() => {
              const prometia = conv.descripcion_anuncio || hilo?.anuncio?.descripcion;
              const enlace = hilo?.anuncio?.enlace;
              if (!prometia && !enlace) return null;
              return (
                <div style={{ margin: "-6px 0 16px" }}>
                  {prometia && (
                    <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)", margin: 0 }}>
                      <strong style={{ color: "var(--ink)" }}>Prometía:</strong> {prometia}
                    </p>
                  )}
                  {enlace && (
                    <p style={{ fontSize: 12, margin: "4px 0 0" }}>
                      <a href={enlace} target="_blank" rel="noreferrer noopener">
                        Ver el anuncio ↗
                      </a>
                    </p>
                  )}
                </div>
              );
            })()}

            {hilo?.foto && (
              <div style={{ borderTop: "1px solid var(--line)", padding: "15px 0", marginBottom: 1 }}>
                <h3 className="titulo-tarjeta" style={{ marginBottom: 8 }}>Lo que sale en la foto</h3>
                <ProductoDeLaFoto
                  conversationId={conv.id}
                  foto={hilo.foto}
                  onGuardado={() => {
                    void cargarHilo(conv.id);
                    router.refresh();
                  }}
                />
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 15 }}>
              <h3 className="titulo-tarjeta" style={{ marginBottom: 8 }}>Estado</h3>
              <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "0 0 12px" }}>
                {conv.cerrado_por === "ia"
                  ? "Cerró la IA."
                  : conv.cerrado_por === "humano"
                    ? "Cerró el equipo."
                    : conv.intervencion_humana === 1
                      ? "Abierta. Un vendedor ya participó."
                      : "Abierta."}
              </p>

              {conv.resumen_pedido && (
                <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
                  {conv.resumen_pedido}
                </p>
              )}

              {conv.datos_faltantes.length > 0 && (
                <div className="aviso aviso-ambar">
                  Falta por confirmar: {conv.datos_faltantes.join(", ")}.
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="tenue">Elige una conversación para ver su pedido.</p>
        )}
      </aside>
    </div>
  );
}

function Par({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <dt style={{ color: "var(--ink-2)" }}>{etiqueta}</dt>
      <dd className="num" style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{valor}</dd>
    </div>
  );
}

/**
 * ¿Este mensaje es el comentario público, o ya es el privado que vino después?
 *
 * En un hilo que empezó como comentario, el comentario original y nuestra
 * respuesta pública son los dos primeros mensajes; lo que sigue ya es la
 * conversación privada. Es una heurística de presentación, no de datos: si se
 * equivoca, el mensaje se ve como burbuja en vez de como tarjeta y nada más.
 */
function esElComentario(hilo: Hilo, m: MensajeHilo): boolean {
  const i = hilo.mensajes.findIndex((x) => x.id === m.id);
  return i >= 0 && i < 2;
}
