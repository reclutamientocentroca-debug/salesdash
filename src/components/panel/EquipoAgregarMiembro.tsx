"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * DAR DE ALTA A ALGUIEN DEL EQUIPO, sin correo de por medio.
 *
 * El dueño escribe la contraseña él mismo y se la pasa por fuera del panel —
 * de palabra, por WhatsApp—: entra con eso de inmediato, sin depender de que
 * un correo le llegue. Mismo espíritu que el registro de la cuenta.
 */
export default function EquipoAgregarMiembro() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cerrar() {
    setAbierto(false);
    setNombre("");
    setEmail("");
    setPassword("");
    setError(null);
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);

    try {
      const r = await fetch("/api/equipo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre, email, password }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(datos.error ?? "No se pudo agregar.");
        setOcupado(false);
        return;
      }
      cerrar();
      router.refresh();
    } catch {
      setError("No hay conexión con el servidor.");
      setOcupado(false);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn btn-primario" onClick={() => setAbierto(true)}>
        + Agregar al equipo
      </button>
    );
  }

  return (
    <form
      onSubmit={agregar}
      className="tarjeta"
      style={{ display: "grid", gap: 10, maxWidth: 380, padding: 16, marginBottom: 14 }}
    >
      <div>
        <label className="tenue" style={{ fontSize: 12.5, display: "block", marginBottom: 4 }}>
          Nombre
        </label>
        <input
          className="campo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Cómo se llama"
          required
          minLength={2}
        />
      </div>

      <div>
        <label className="tenue" style={{ fontSize: 12.5, display: "block", marginBottom: 4 }}>
          Correo
        </label>
        <input
          className="campo"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="su@correo.com"
          required
        />
      </div>

      <div>
        <label className="tenue" style={{ fontSize: 12.5, display: "block", marginBottom: 4 }}>
          Contraseña
        </label>
        <input
          className="campo"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Se la pasas tú, fuera del panel"
          required
          minLength={8}
        />
        <p className="tenue" style={{ fontSize: 11.5, marginTop: 4 }}>
          Entra con este correo y esta contraseña. Pásasela tú misma; no se le manda nada por correo.
        </p>
      </div>

      {error && (
        <div className="aviso aviso-error" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-tenue" onClick={cerrar} disabled={ocupado}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primario" disabled={ocupado}>
          {ocupado ? "Agregando…" : "Agregar"}
        </button>
      </div>
    </form>
  );
}
