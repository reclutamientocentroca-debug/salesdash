"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Sacar a alguien del equipo. En dos toques, como el de borrar conversación. */
export default function EquipoQuitarMiembroBoton({ userId, nombre }: { userId: number; nombre: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function quitar() {
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch(`/api/equipo/${userId}`, { method: "DELETE" });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(datos.error ?? "No se pudo quitar.");
        setOcupado(false);
        return;
      }
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
        className="btn btn-tenue"
        style={{ color: "#b3261e", fontSize: 12 }}
        onClick={() => setConfirmando(true)}
      >
        Quitar
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
      <span className="tenue" style={{ fontSize: 11.5 }}>¿Quitar a {nombre}?</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-tenue" style={{ fontSize: 12 }} disabled={ocupado} onClick={() => setConfirmando(false)}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primario"
          style={{ background: "#b3261e", fontSize: 12 }}
          disabled={ocupado}
          onClick={quitar}
        >
          {ocupado ? "Quitando…" : "Sí, quitar"}
        </button>
      </div>
      {error && (
        <div className="aviso aviso-error" role="alert" style={{ fontSize: 11.5 }}>
          {error}
        </div>
      )}
    </div>
  );
}
