"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * BORRAR CONVERSACIÓN — en dos toques, y sin diálogo del navegador.
 *
 * Borrar un hilo es irreversible: se va con sus mensajes, sus recordatorios y
 * sus anomalías, y si tenía una venta cerrada, la venta deja de contar. Por
 * eso el primer toque no borra: cambia el botón por la pregunta y la
 * confirmación, y solo el segundo lo hace. Cualquier otro clic lo devuelve a
 * como estaba.
 */
export default function BorrarConversacionBoton({ conversationId }: { conversationId: number }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function borrar() {
    setOcupado(true);
    setError(null);

    try {
      const r = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(datos.error ?? "No pudimos borrar la conversación.");
        setOcupado(false);
        return;
      }
      // El hilo ya no existe: la lista es el único sitio al que se puede volver.
      router.push("/conversaciones");
      router.refresh();
    } catch {
      setError("No hay conexión con el servidor.");
      setOcupado(false);
    }
  }

  if (!confirmando) {
    return (
      <button
        type="button"
        className="btn btn-secundario"
        style={{ color: "#b3261e", borderColor: "#e8b4b0" }}
        onClick={() => setConfirmando(true)}
      >
        Borrar conversación
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
      <p style={{ margin: 0, fontSize: 12.5 }} className="tenue">
        Se borra el hilo entero, con sus mensajes y su venta. No se puede deshacer.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-tenue"
          onClick={() => setConfirmando(false)}
          disabled={ocupado}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primario"
          style={{ background: "#b3261e" }}
          onClick={borrar}
          disabled={ocupado}
        >
          {ocupado ? "Borrando…" : "Sí, borrar"}
        </button>
      </div>
      {error && (
        <div className="aviso aviso-error" role="alert" style={{ maxWidth: 320 }}>
          {error}
        </div>
      )}
    </div>
  );
}
