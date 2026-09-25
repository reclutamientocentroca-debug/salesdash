"use client";

import { useState } from "react";
import { Vacio } from "../Piezas";
import { fechaCorta } from "../Piezas";
import type { CanalVista } from "./DifusionesPanel";

export interface ListaVista {
  id: number; nombre: string; tipo: "automatica" | "csv"; created_at: number; contactos: number | null;
}

export default function ListasDeClientes({
  soyDueno,
  canales,
  listas,
  onCambio,
}: {
  soyDueno: boolean;
  canales: CanalVista[];
  listas: ListaVista[];
  onCambio: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"automatica" | "csv">("automatica");
  const [canalId, setCanalId] = useState<number | "">("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [producto, setProducto] = useState("");
  const [soloConCompra, setSoloConCompra] = useState(true);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subiendoA, setSubiendoA] = useState<number | null>(null);
  const [avisoSubida, setAvisoSubida] = useState<{ id: number; texto: string } | null>(null);

  const aEpoch = (fecha: string) => (fecha ? Math.floor(new Date(`${fecha}T00:00:00`).getTime() / 1000) : null);

  async function crear() {
    if (!nombre.trim()) return;
    setCreando(true);
    setError(null);

    const filtros =
      tipo === "automatica"
        ? {
            canalId: canalId === "" ? null : canalId,
            desde: aEpoch(desde),
            hasta: aEpoch(hasta),
            producto: producto.trim() || null,
            soloConCompra,
          }
        : null;

    const r = await fetch("/api/difusion/listas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre: nombre.trim(), tipo, filtros }),
    });
    const datos = await r.json().catch(() => null);
    setCreando(false);

    if (!r.ok) {
      setError(datos?.error ?? "No se pudo crear la lista.");
      return;
    }

    setNombre("");
    setProducto("");
    setDesde("");
    setHasta("");
    onCambio();
  }

  async function subirCsv(listaId: number, archivo: File) {
    setSubiendoA(listaId);
    setAvisoSubida(null);
    const forma = new FormData();
    forma.append("archivo", archivo);
    const r = await fetch(`/api/difusion/listas/${listaId}/csv`, { method: "POST", body: forma });
    const datos = await r.json().catch(() => null);
    setSubiendoA(null);

    if (!r.ok) {
      setAvisoSubida({ id: listaId, texto: datos?.error ?? "No se pudo leer el archivo." });
      return;
    }
    setAvisoSubida({ id: listaId, texto: `${datos.contactos} contacto(s) cargados.` });
    onCambio();
  }

  if (!soyDueno) {
    return (
      <section className="tarjeta">
        <Vacio titulo="Solo el dueño de la cuenta administra las listas de difusión" />
      </section>
    );
  }

  return (
    <>
      <section className="tarjeta" style={{ marginBottom: 14 }}>
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Nueva lista</h2>
        <p className="tenue" style={{ fontSize: 13, marginBottom: 12 }}>
          Automática: se arma sola con los clientes que ya escribieron o compraron en un canal. O sube un
          CSV con nombre y teléfono (una columna cada uno, con o sin cabecera).
        </p>

        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" checked={tipo === "automatica"} onChange={() => setTipo("automatica")} />
            Lista automática
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" checked={tipo === "csv"} onChange={() => setTipo("csv")} />
            Subir un CSV
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="etiqueta-campo" htmlFor="lista-nombre">Nombre de la lista</label>
            <input id="lista-nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Clientes de Santo Domingo" />
          </div>
        </div>

        {tipo === "automatica" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <div style={{ minWidth: 180 }}>
              <label className="etiqueta-campo" htmlFor="lista-canal">Canal / tienda</label>
              <select id="lista-canal" className="campo" value={canalId} onChange={(e) => setCanalId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Todos los canales</option>
                {canales.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}{c.pais ? ` · ${c.pais}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta-campo" htmlFor="lista-desde">Compró desde</label>
              <input id="lista-desde" type="date" className="campo" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta-campo" htmlFor="lista-hasta">hasta</label>
              <input id="lista-hasta" type="date" className="campo" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div style={{ minWidth: 180 }}>
              <label className="etiqueta-campo" htmlFor="lista-producto">Producto comprado (opcional)</label>
              <input id="lista-producto" className="campo" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej. camisa" />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingBottom: 8 }}>
              <input type="checkbox" checked={soloConCompra} onChange={(e) => setSoloConCompra(e.target.checked)} />
              Solo quien compró
            </label>
          </div>
        )}

        {error && <div className="aviso aviso-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

        <button type="button" className="btn btn-primario" onClick={crear} disabled={creando || !nombre.trim()}>
          {creando ? "Creando…" : "Crear lista"}
        </button>
      </section>

      <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
        {listas.length === 0 ? (
          <Vacio titulo="Todavía no hay ninguna lista" texto="Crea una arriba para poder armar una campaña." />
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th style={{ paddingLeft: 17 }}>Lista</th>
                <th>Tipo</th>
                <th>Contactos</th>
                <th>Creada</th>
                <th style={{ paddingRight: 17 }} />
              </tr>
            </thead>
            <tbody>
              {listas.map((l) => (
                <tr key={l.id}>
                  <td style={{ paddingLeft: 17, fontWeight: 600 }}>{l.nombre}</td>
                  <td>{l.tipo === "automatica" ? "Automática" : "CSV"}</td>
                  <td className="num">{l.contactos ?? "—"}</td>
                  <td className="tenue">{fechaCorta(l.created_at)}</td>
                  <td style={{ paddingRight: 17, textAlign: "right" }}>
                    {l.tipo === "csv" && (
                      <>
                        <label className="btn btn-tenue" style={{ padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
                          {subiendoA === l.id ? "Subiendo…" : "Subir CSV"}
                          <input
                            type="file" accept=".csv,text/csv" style={{ display: "none" }}
                            disabled={subiendoA !== null}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) subirCsv(l.id, f); e.target.value = ""; }}
                          />
                        </label>
                        {avisoSubida?.id === l.id && (
                          <span className="tenue" style={{ marginLeft: 8, fontSize: 12 }}>{avisoSubida.texto}</span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
