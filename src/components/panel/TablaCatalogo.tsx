"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Vacio, dinero } from "./Piezas";

export interface ProductoVista {
  id: number;
  /** De qué número es. 0 = de toda la cuenta. Ver `listarCatalogo`. */
  canal_id: number;
  nombre: string;
  variantes: string | null;
  precio: number | null;
  activo: number;
}

/** Los números conectados, para poder decir de cuál es cada producto. */
export interface CanalVista {
  id: number;
  nombre: string;
  /** El país en el que vende ese número, si tiene uno puesto. */
  pais: string | null;
}

/**
 * El catálogo es lo que el agente vendedor da por cierto. Lo que no esté aquí,
 * no lo promete.
 */
export default function TablaCatalogo({
  productos,
  canales = [],
}: {
  productos: ProductoVista[];
  canales?: CanalVista[];
}) {
  const router = useRouter();
  const [nuevo, setNuevo] = useState({ nombre: "", variantes: "", precio: "", canalId: 0 });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * EL REPARTO SOLO SE ENSEÑA CUANDO HACE FALTA.
   *
   * Con un número, «de toda la cuenta» y «de este número» son lo mismo y la
   * columna sobra. Con varios países empieza a importar de verdad: el precio se
   * guarda sin moneda, así que un producto de 1690 pesos puesto en la lista de
   * todos le llega al agente tico como 1.690 colones.
   */
  const reparte = canales.length > 1;
  const paises = new Set(canales.map((c) => c.pais).filter(Boolean));
  const variosPaises = paises.size > 1;
  const sueltos = productos.filter((p) => p.canal_id === 0).length;

  const comoSeLlama = (id: number) => {
    if (id === 0) return "Toda la cuenta";
    const c = canales.find((x) => x.id === id);
    if (!c) return "Toda la cuenta";
    return c.pais ? `${c.nombre} · ${c.pais}` : c.nombre;
  };

  async function mover(id: number, canalId: number) {
    await fetch("/api/catalogo", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, canalId }),
    });
    router.refresh();
  }

  async function agregar() {
    if (nuevo.nombre.trim().length < 1) return;
    setOcupado(true);
    setError(null);

    const r = await fetch("/api/catalogo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: nuevo.nombre.trim(),
        variantes: nuevo.variantes.trim() || null,
        precio: nuevo.precio.trim() ? Number(nuevo.precio) : null,
        canalId: nuevo.canalId,
      }),
    });
    const datos = await r.json();

    setOcupado(false);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo guardar el producto.");
      return;
    }
    setNuevo({ nombre: "", variantes: "", precio: "", canalId: nuevo.canalId });
    router.refresh();
  }

  async function alternar(id: number, activo: boolean) {
    await fetch("/api/catalogo", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, activo }),
    });
    router.refresh();
  }

  async function borrar(id: number, nombre: string) {
    if (!confirm(`¿Quitar «${nombre}» del catálogo?`)) return;
    await fetch(`/api/catalogo?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <section className="tarjeta" style={{ marginBottom: 14 }}>
        <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Agregar producto</h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label className="etiqueta-campo" htmlFor="p-nombre">Nombre</label>
            <input
              id="p-nombre" className="campo" placeholder="Camisa manga larga"
              value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            />
          </div>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label className="etiqueta-campo" htmlFor="p-variantes">Variantes</label>
            <input
              id="p-variantes" className="campo" placeholder="S, M, L · azul, negro"
              value={nuevo.variantes} onChange={(e) => setNuevo({ ...nuevo, variantes: e.target.value })}
            />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label className="etiqueta-campo" htmlFor="p-precio">Precio</label>
            <input
              id="p-precio" className="campo num" inputMode="decimal" placeholder="1850"
              value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })}
            />
          </div>
          {reparte && (
            <div style={{ flex: 1, minWidth: 170 }}>
              <label className="etiqueta-campo" htmlFor="p-canal">¿De qué número es?</label>
              <select
                id="p-canal" className="campo"
                value={nuevo.canalId}
                onChange={(e) => setNuevo({ ...nuevo, canalId: Number(e.target.value) })}
              >
                <option value={0}>Toda la cuenta</option>
                {canales.map((c) => (
                  <option key={c.id} value={c.id}>{comoSeLlama(c.id)}</option>
                ))}
              </select>
            </div>
          )}
          <button type="button" className="btn btn-primario" onClick={agregar} disabled={ocupado}>
            Agregar
          </button>
        </div>

        {error && (
          <div className="aviso aviso-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </section>

      {variosPaises && sueltos > 0 && (
        <div className="aviso" role="status" style={{ marginBottom: 14 }}>
          Vendes en {paises.size} países y {sueltos === 1 ? "hay 1 producto" : `hay ${sueltos} productos`}{" "}
          en «Toda la cuenta»: los agentes de los {paises.size} los leen como suyos, con el precio en
          la moneda de cada uno. Dile a cada producto de qué número es.
        </div>
      )}

      <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
        {productos.length === 0 ? (
          <Vacio
            titulo="Tu catálogo está vacío"
            texto="Agrega lo que vendes para que el agente responda precios sin inventárselos."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 17 }}>Producto</th>
                  <th>Variantes</th>
                  {reparte && <th>Número</th>}
                  <th style={{ textAlign: "right" }}>Precio</th>
                  <th style={{ textAlign: "right", paddingRight: 17 }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.5 }}>
                    <td style={{ paddingLeft: 17, fontWeight: 600 }}>{p.nombre}</td>
                    <td style={{ color: "var(--ink-2)" }}>{p.variantes ?? "—"}</td>
                    {reparte && (
                      <td>
                        <select
                          className="campo"
                          style={{ padding: "4px 8px", fontSize: 12 }}
                          value={p.canal_id}
                          onChange={(e) => mover(p.id, Number(e.target.value))}
                          aria-label={`De qué número es ${p.nombre}`}
                        >
                          <option value={0}>Toda la cuenta</option>
                          {canales.map((c) => (
                            <option key={c.id} value={c.id}>{comoSeLlama(c.id)}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td style={{ textAlign: "right" }}>{dinero(p.precio)}</td>
                    <td style={{ textAlign: "right", paddingRight: 17 }}>
                      <button
                        type="button"
                        className="btn btn-tenue"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => alternar(p.id, p.activo !== 1)}
                      >
                        {p.activo ? "Activo" : "Oculto"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-tenue"
                        style={{ padding: "4px 10px", fontSize: 12, color: "var(--red)" }}
                        onClick={() => borrar(p.id, p.nombre)}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
