"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Analiza una muestra de las conversaciones sin cerrar del rango para
 * descubrir por qué se cayeron. Interesa la proporción, no el censo: por eso
 * es una muestra y no todas.
 */
export default function AnalizarPerdidas({ rango }: { rango: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);

  async function analizar() {
    setOcupado(true);
    setError(null);
    setNota(null);

    try {
      const r = await fetch(`/api/analyze/perdidas?rango=${encodeURIComponent(rango)}`, { method: "POST" });
      const datos = await r.json();

      if (!r.ok) setError(datos.error ?? "No pudimos analizarlas.");
      else {
        setNota(
          datos.analizadas === 0
            ? "No quedaban conversaciones nuevas que analizar."
            : `Analizadas ${datos.analizadas}.`,
        );
        router.refresh();
      }
    } catch {
      setError("No hay conexión con el servidor.");
    }
    setOcupado(false);
  }

  return (
    <div>
      <button type="button" className="btn btn-secundario" onClick={analizar} disabled={ocupado}>
        {ocupado ? "Analizando una muestra…" : "Analizar por qué no cerraron"}
      </button>
      {nota && <p className="tenue" style={{ marginTop: 8 }}>{nota}</p>}
      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
