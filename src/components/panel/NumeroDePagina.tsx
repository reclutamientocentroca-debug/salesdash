"use client";

import { useState } from "react";

/**
 * El número que esta página da cuando un cliente lo pide.
 *
 * En Messenger, Instagram y los comentarios no hay teléfono: el cliente
 * escribe a una página, y cuando pide «el número» quiere el WhatsApp del
 * negocio que la atiende. Cada página tiene el suyo. Sin número puesto, el
 * agente no lo inventa: contesta como siempre.
 */
const limpio = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** El WhatsApp que se llama como la página («RINCON» → «RINCON DCM»), si solo hay uno. */
function sugerido(nombrePagina: string, numeros: { id: number; nombre: string; numero: string }[]) {
  const p = limpio(nombrePagina);
  if (!p) return null;
  const coinciden = numeros.filter((n) => {
    const w = limpio(n.nombre);
    return w === p || w.startsWith(`${p} `) || p.startsWith(`${w} `);
  });
  return coinciden.length === 1 ? coinciden[0]! : null;
}

export default function NumeroDePagina({
  canalId,
  inicial,
  nombrePagina,
  numeros,
}: {
  canalId: number;
  inicial: string | null;
  nombrePagina: string;
  numeros: { id: number; nombre: string; numero: string }[];
}) {
  const propuesto = !inicial ? sugerido(nombrePagina, numeros) : null;
  const [valor, setValor] = useState(inicial ?? "");
  const [estado, setEstado] = useState<"quieto" | "guardando" | "guardado">("quieto");
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setEstado("guardando");
    setError(null);
    try {
      const r = await fetch(`/api/meta/canales/${canalId}/contacto`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: valor }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(datos.error ?? "No se pudo guardar el número.");
        setEstado("quieto");
        return;
      }
      setValor(datos.numero ?? "");
      setEstado("guardado");
    } catch {
      setError("No se pudo hablar con el servidor");
      setEstado("quieto");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <label className="tenue" htmlFor={`num-${canalId}`} style={{ fontSize: 12 }}>
        Número que se da si lo piden
      </label>
      <input
        id={`num-${canalId}`}
        type="tel"
        inputMode="tel"
        placeholder="+506 8888 8888"
        value={valor}
        onChange={(e) => { setValor(e.target.value); setEstado("quieto"); }}
        style={{ padding: "5px 8px", width: 170 }}
      />
      <button type="button" className="btn btn-secundario" disabled={estado === "guardando"} onClick={guardar}>
        {estado === "guardando" ? "Guardando…" : "Guardar"}
      </button>
      {numeros.length > 0 && (
        <select
          aria-label="Usar el número de uno de tus WhatsApp"
          value=""
          onChange={(e) => {
            const n = numeros.find((x) => String(x.id) === e.target.value);
            if (n) { setValor(n.numero); setEstado("quieto"); }
          }}
          style={{ padding: "5px 8px" }}
        >
          <option value="">Usar uno de mis WhatsApp…</option>
          {numeros.map((n) => (
            <option key={n.id} value={n.id}>{n.nombre} · {n.numero}</option>
          ))}
        </select>
      )}
      {propuesto && !valor.trim() && (
        <button type="button" className="btn btn-tenue" onClick={() => { setValor(propuesto.numero); setEstado("quieto"); }}>
          Usar el de {propuesto.nombre} ({propuesto.numero})
        </button>
      )}
      {estado === "guardado" && <span className="tenue" style={{ fontSize: 12 }}>Guardado</span>}
      {!valor.trim() && estado !== "guardado" && (
        <span className="tenue" style={{ fontSize: 12 }}>Sin número: el agente no dará ninguno.</span>
      )}
      {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
