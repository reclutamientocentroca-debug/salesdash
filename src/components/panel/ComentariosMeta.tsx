"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Vacio, hace } from "@/components/panel/Piezas";

export interface ComentarioEnPanel {
  id: number;
  canalId: number;
  canal: string;
  cliente: string | null;
  texto: string;
  cuando: number;
  respuestas: number;
}

/**
 * Los comentarios de las páginas, en una sola bandeja.
 *
 * Se filtra en el navegador y no con otra consulta: son unas decenas de filas
 * que ya están cargadas, y cambiar de página tiene que ser instantáneo. Pedirle
 * al servidor una lista nueva por cada clic haría parpadear la pantalla a
 * cambio de nada.
 *
 * Cada fila lleva a su conversación entera. Un comentario suelto no dice si se
 * cerró la venta; el hilo, sí.
 */
export default function ComentariosMeta({
  comentarios,
  paginas,
}: {
  comentarios: ComentarioEnPanel[];
  paginas: { id: number; nombre: string }[];
}) {
  const [canal, setCanal] = useState<number | "todas">("todas");

  const visibles = useMemo(
    () => (canal === "todas" ? comentarios : comentarios.filter((c) => c.canalId === canal)),
    [comentarios, canal],
  );

  const sinResponder = visibles.filter((c) => c.respuestas === 0).length;

  return (
    <section className="tarjeta">
      <div
        style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          flexWrap: "wrap", marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>
            Comentarios
          </h2>
          <p className="tenue" style={{ margin: 0 }}>
            Lo que la gente escribe debajo de tus publicaciones y anuncios. Se contesta en el
            mismo comentario, en público, y la conversación sigue en el hilo del cliente.
          </p>
        </div>

        {paginas.length > 1 && (
          <select
            className="campo"
            style={{ width: "auto", minWidth: 190 }}
            aria-label="Filtrar por página"
            value={canal}
            onChange={(e) => setCanal(e.target.value === "todas" ? "todas" : Number(e.target.value))}
          >
            <option value="todas">Todas las páginas</option>
            {paginas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      {visibles.length === 0 ? (
        <Vacio
          titulo="Todavía no hay comentarios"
          texto="Cuando alguien comente en una publicación o en un anuncio de tus páginas, aparecerá aquí."
        />
      ) : (
        <>
          {sinResponder > 0 && (
            <p className="tenue" style={{ marginBottom: 10, fontSize: 12.5 }}>
              {sinResponder === 1
                ? "1 comentario sigue sin respuesta."
                : `${sinResponder} comentarios siguen sin respuesta.`}
            </p>
          )}

          <ul style={{ display: "grid", gap: 2 }}>
            {visibles.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/conversaciones/${c.id}`}
                  className="sd-chat"
                  style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {c.cliente ?? "Alguien"}
                    </span>
                    {/* El comentario, entero pero sin romper la fila: se corta
                        con puntos suspensivos y se lee completo al abrirlo. */}
                    <span
                      style={{
                        display: "block", fontSize: 13, marginTop: 2,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {c.texto || "(comentario sin texto)"}
                    </span>
                    <span className="tenue" style={{ display: "block", fontSize: 11.5, marginTop: 3 }}>
                      {paginas.length > 1 ? `${c.canal} · ` : ""}
                      {hace(c.cuando)}
                    </span>
                  </span>

                  <span
                    className={`pastilla ${c.respuestas > 0 ? "pastilla-ia" : "pastilla-abierta"}`}
                    style={{ flexShrink: 0, marginTop: 2 }}
                  >
                    {c.respuestas > 0 ? "Respondido" : "Sin responder"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
