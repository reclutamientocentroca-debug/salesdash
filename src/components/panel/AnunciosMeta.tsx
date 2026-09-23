"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Vacio } from "@/components/panel/Piezas";

export interface AnuncioPorVincular {
  adId: string;
  titulo: string | null;
  productoId: number | null;
  productoNombre: string | null;
  /** El permalink de la publicación, para poder abrir el anuncio y verlo. */
  enlace: string | null;
  /**
   * EL PRODUCTO QUE MÁS SE PARECE, cuando este anuncio todavía no tiene uno.
   * Es solo una propuesta —ver `sugerirProductoDelCatalogo`—: no cotiza nada
   * hasta que la dueña la confirma con el botón. Null si no hay ninguno
   * parecido o si el anuncio ya está vinculado.
   */
  sugerido: { id: number; nombre: string } | null;
}

/**
 * LA REGLA DEL PRECIO, EN PANTALLA.
 *
 * Un anuncio sin producto es un hilo donde el agente NO cotiza: contesta que
 * le atiende una persona y se calla. Esta lista es donde eso se arregla, y por
 * eso vive aquí y no escondida en otra pantalla.
 */
export default function AnunciosMeta({
  anuncios,
  productos,
}: {
  anuncios: AnuncioPorVincular[];
  productos: { id: number; nombre: string }[];
}) {
  const router = useRouter();

  // Sugerencias que la dueña ya descartó en esta pantalla, para no
  // insistirle con la misma después de decir que no.
  const [descartadas, setDescartadas] = useState<Set<string>>(new Set());

  async function vincular(adId: string, productoId: number | null) {
    await fetch("/api/meta/canales", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId, productoId }),
    });
    router.refresh();
  }

  return (
    <section className="tarjeta" style={{ marginTop: 14 }}>
      <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
        Anuncios y sus productos
      </h2>
      <p className="tenue" style={{ marginBottom: 12 }}>
        El precio sale de tu catálogo, nunca del modelo. Si un anuncio no tiene producto, el
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
                    {/* El identificador de Meta, solo cuando el anuncio no
                        trae título: es lo único que lo distingue de otro. */}
                    {!a.titulo && <div className="tenue num">{a.adId}</div>}
                    {/* Abrir el anuncio y verlo, que es lo que hace que
                        elegir el producto deje de ser adivinar. */}
                    {a.enlace && (
                      <a
                        className="enlace"
                        style={{ fontSize: 11.5 }}
                        href={a.enlace}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ver el anuncio ↗
                      </a>
                    )}
                  </td>
                  <td>
                    <select
                      className="campo"
                      aria-label={`Producto del anuncio ${a.titulo ?? a.adId}`}
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

                    {/* SOLO UNA PROPUESTA: no cotiza nada hasta que se confirma con el botón. */}
                    {a.sugerido && !descartadas.has(a.adId) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12 }}>
                        <span className="tenue">¿Es «{a.sugerido.nombre}»?</span>
                        <button
                          type="button"
                          className="btn btn-tenue"
                          style={{ padding: "2px 8px", fontSize: 12 }}
                          onClick={() => vincular(a.adId, a.sugerido!.id)}
                        >
                          Sí, vincular
                        </button>
                        <button
                          type="button"
                          className="btn btn-tenue"
                          style={{ padding: "2px 8px", fontSize: 12 }}
                          onClick={() => setDescartadas((d) => new Set(d).add(a.adId))}
                        >
                          No
                        </button>
                      </div>
                    )}
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
  );
}
