"use client";

import { useState } from "react";
import { Vacio } from "./Piezas";

interface Canal { id: number; nombre: string }
export interface AnuncioVista {
  id: number; nombre: string; descripcion: string; canal_id: number; sin_envio: boolean; foto: string | null;
}

interface AnuncioApi {
  id: number; nombre: string; descripcion: string; canal_id: number; sin_envio: number; imagen_clave: string | null;
}

export default function AnunciosManuales({ canales, iniciales }: { canales: Canal[]; iniciales: AnuncioVista[] }) {
  const [anuncios, setAnuncios] = useState(iniciales);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [canalId, setCanalId] = useState(0);
  const [sinEnvio, setSinEnvio] = useState(true);
  const [imagenClave, setImagenClave] = useState<string | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function recargar() {
    const r = await fetch("/api/anuncios-manuales");
    const d = await r.json().catch(() => null);
    if (r.ok && d?.anuncios) {
      setAnuncios(
        (d.anuncios as AnuncioApi[]).map((a) => ({
          id: a.id, nombre: a.nombre, descripcion: a.descripcion, canal_id: a.canal_id, sin_envio: a.sin_envio === 1,
          foto: a.imagen_clave?.startsWith("local:") ? `/api/media/${a.imagen_clave.slice(6)}` : a.imagen_clave,
        })),
      );
    }
  }

  async function subirFoto(archivo: File | undefined) {
    setError(null);
    if (!archivo) return;
    const forma = new FormData();
    forma.append("archivo", archivo);
    const r = await fetch("/api/difusion/imagen", { method: "POST", body: forma });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.clave) return setError(d?.error ?? "No se pudo subir la foto.");
    setImagenClave(d.clave);
    setVista(URL.createObjectURL(archivo));
  }

  async function guardar() {
    setError(null);
    setGuardando(true);
    const r = await fetch("/api/anuncios-manuales", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre, descripcion, canalId, imagenClave, sinEnvio }),
    });
    const d = await r.json().catch(() => null);
    setGuardando(false);
    if (!r.ok) return setError(d?.error ?? "No se pudo guardar.");
    setNombre(""); setDescripcion(""); setImagenClave(null); setVista(null); setSinEnvio(true);
    await recargar();
  }

  async function quitar(id: number) {
    await fetch(`/api/anuncios-manuales?id=${id}`, { method: "DELETE" });
    setAnuncios((a) => a.filter((x) => x.id !== id));
  }

  return (
    <>
      <section className="tarjeta" style={{ display: "grid", gap: 10, maxWidth: 640 }}>
        <label className="etiqueta-campo" htmlFor="an-nombre">Nombre del anuncio</label>
        <input id="an-nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Polos 2x ₡12.000" />

        <label className="etiqueta-campo" htmlFor="an-desc">Descripción del producto (tal como sale en el anuncio, con el precio)</label>
        <textarea id="an-desc" className="campo" rows={5} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />

        <label className="etiqueta-campo" htmlFor="an-foto">Foto del anuncio (opcional)</label>
        <input id="an-foto" type="file" accept="image/*" className="campo" onChange={(e) => void subirFoto(e.target.files?.[0])} />
        {vista && <img src={vista} alt="Foto del anuncio" style={{ maxWidth: 160, borderRadius: 8 }} />}

        <label className="etiqueta-campo" htmlFor="an-canal">Número</label>
        <select id="an-canal" className="campo" value={canalId} onChange={(e) => setCanalId(Number(e.target.value))}>
          <option value={0}>Todos los números</option>
          {canales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={sinEnvio} onChange={(e) => setSinEnvio(e.target.checked)} />
          No cobrar envío (el envío va incluido y la IA se lo dice al cliente)
        </label>

        {error && <div style={{ color: "#c0392b", fontSize: 13 }}>{error}</div>}
        <div>
          <button type="button" className="btn btn-primario" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar anuncio"}
          </button>
        </div>
      </section>

      <section className="tarjeta" style={{ marginTop: 16 }}>
        {anuncios.length === 0 ? (
          <Vacio titulo="Todavía no hay anuncios" texto="Los que guardes aparecen aquí." />
        ) : (
          anuncios.map((a) => (
            <div key={a.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid rgba(128,128,128,.2)" }}>
              {a.foto && <img src={a.foto} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {a.nombre}{" "}
                  <span className="tenue" style={{ fontSize: 12 }}>
                    · {a.canal_id === 0 ? "todos los números" : canales.find((c) => c.id === a.canal_id)?.nombre ?? "otro número"}
                    {a.sin_envio ? " · envío incluido" : " · envío se cobra"}
                  </span>
                </div>
                <div className="tenue" style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{a.descripcion}</div>
              </div>
              <button type="button" className="btn btn-tenue" onClick={() => void quitar(a.id)}>Quitar</button>
            </div>
          ))
        )}
      </section>
    </>
  );
}
