"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Vacio, fechaHora } from "./Piezas";

export interface FilaRevision {
  id: number;
  cliente: string;
  telefono: string;
  canal: string;
  justificacion: string | null;
  ultimoMensaje: string;
  fecha: number | null;
}

/**
 * Bandeja de revisión: dos botones y se acabó. Un clic resuelve y se
 * recalculan las métricas.
 *
 * Esta corrección manual es lo único que rompe el sellado de la regla
 * maestra, y por eso queda registrada como anomalía para poder auditarla.
 */
export default function BandejaRevision({ filas }: { filas: FilaRevision[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolver(id: number, quien: "ia" | "humano") {
    setOcupado(id);
    setError(null);

    const r = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolver: quien }),
    });

    setOcupado(null);
    if (!r.ok) {
      setError("No se pudo guardar la corrección.");
      return;
    }
    router.refresh();
  }

  if (filas.length === 0) {
    return (
      <div className="tarjeta">
        <Vacio
          titulo="No hay nada que revisar"
          texto="Cuando el analista no pueda decidir quién cerró una venta, la conversación aparecerá aquí para que lo resuelvas de un clic."
        />
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="rejilla">
        {filas.map((f) => (
          <article key={f.id} className="tarjeta">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link
                  href={`/conversaciones/${f.id}`}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: 600, fontSize: 13.5 }}
                >
                  {f.cliente}
                </Link>
                <div className="num tenue" style={{ marginBottom: 8 }}>
                  +{f.telefono} · {f.canal} · {fechaHora(f.fecha)}
                </div>

                {f.justificacion && (
                  <div className="aviso aviso-ambar" style={{ marginBottom: 8 }}>
                    {f.justificacion}
                  </div>
                )}

                <p style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  Último mensaje: “{f.ultimoMensaje}”
                </p>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn btn-acento"
                  disabled={ocupado === f.id}
                  onClick={() => resolver(f.id, "ia")}
                >
                  Fue automatizada
                </button>
                <button
                  type="button"
                  className="btn btn-secundario"
                  style={{ color: "var(--blue)", borderColor: "var(--blue-bg)" }}
                  disabled={ocupado === f.id}
                  onClick={() => resolver(f.id, "humano")}
                >
                  Fue asistida
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
