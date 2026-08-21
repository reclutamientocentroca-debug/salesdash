"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * El análisis solo corre cuando alguien lo pide. Nunca en automático sobre
 * todo el histórico, que es lo que dispara la factura del modelo.
 */
export default function AnalizarBoton({
  conversationId,
  yaAnalizada,
}: {
  conversationId: number;
  yaAnalizada: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analizar() {
    setOcupado(true);
    setError(null);

    try {
      const r = await fetch(`/api/analyze/${conversationId}`, { method: "POST" });
      const datos = await r.json();
      if (!r.ok) setError(datos.error ?? "No pudimos analizar la conversación.");
      else router.refresh();
    } catch {
      setError("No hay conexión con el servidor.");
    }
    setOcupado(false);
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button type="button" className="btn btn-primario" onClick={analizar} disabled={ocupado}>
        {ocupado ? "Analizando…" : yaAnalizada ? "Analizar de nuevo" : "Analizar"}
      </button>
      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginTop: 8, maxWidth: 320 }}>
          {error}
        </div>
      )}
    </div>
  );
}
