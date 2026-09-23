"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { Vacio, dinero } from "./Piezas";

interface LinkProducto {
  id: number;
  url: string;
  importado_at: number | null;
  error: string | null;
}

/** Un producto encontrado en el listado de una categoría. Ver `/api/catalogo/categoria`. */
interface ProductoDeCategoria {
  nombre: string | null;
  precio: number | null;
  fotoUrl: string | null;
  url: string;
  /** Ya se mandó al catálogo desde esta pantalla. */
  agregado: boolean;
}

/** Una columna: lo que trajo UN link de categoría. */
interface ColumnaCategoria {
  id: string;
  url: string;
  estado: "cargando" | "listo" | "error";
  error?: string;
  productos: ProductoDeCategoria[];
}

/** El dominio y la ruta del link, para el encabezado de su columna. Sin protocolo ni query. */
function dominioDeLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

export interface ProductoVista {
  id: number;
  /** De qué número es. 0 = de toda la cuenta. Ver `listarCatalogo`. */
  canal_id: number;
  nombre: string;
  variantes: string | null;
  precio: number | null;
  activo: number;
  /** La foto de referencia, si el producto se importó de un link. */
  foto_url: string | null;
  /** La descripción de la página del link, tal como la escribió la tienda. */
  descripcion: string | null;
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

  const [nuevoLink, setNuevoLink] = useState("");
  const [columnas, setColumnas] = useState<ColumnaCategoria[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);

  /** El producto cuya ficha (foto + descripción tal como está en la tienda) está abierta. */
  const [verProducto, setVerProducto] = useState<number | null>(null);

  /** El producto cuyos links de tienda están abiertos, o null si ninguno. */
  const [verLinks, setVerLinks] = useState<number | null>(null);

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

  /**
   * TRAE TODOS LOS PRODUCTOS DE UN LINK DE CATEGORÍA (o del catálogo entero
   * de la tienda). Cada uno llega con nombre, precio y foto —lo que ya se ve
   * en el listado—, sin abrir su propia página: eso es un paso aparte, para
   * después, con «Links» en la fila del producto una vez que esté en el
   * catálogo. Ver `/api/catalogo/categoria`.
   */
  async function cargarLink() {
    const url = nuevoLink.trim();
    if (!url) return;
    setNuevoLink("");

    const id = `${Date.now()}-${Math.random()}`;
    setColumnas((cs) => [...cs, { id, url, estado: "cargando", productos: [] }]);

    const r = await fetch("/api/catalogo/categoria", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const datos = await r.json();

    setColumnas((cs) =>
      cs.map((c) =>
        c.id !== id
          ? c
          : r.ok
            ? {
                ...c,
                estado: "listo",
                productos: (datos.productos as Omit<ProductoDeCategoria, "agregado">[]).map((p) => ({
                  ...p,
                  agregado: false,
                })),
              }
            : { ...c, estado: "error", error: datos.error ?? "No se pudo leer ese link." },
      ),
    );
  }

  function quitarColumna(id: string) {
    setColumnas((cs) => cs.filter((c) => c.id !== id));
  }

  /** Manda UN producto del listado al catálogo, con su link ya guardado para buscarle talla después. */
  async function enviarAlCatalogo(columnaId: string, producto: ProductoDeCategoria) {
    const clave = `${columnaId}:${producto.url}`;
    setEnviando(clave);

    await fetch("/api/catalogo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: producto.nombre?.trim() || "Producto sin nombre",
        precio: producto.precio,
        fotoUrl: producto.fotoUrl,
        linkUrl: producto.url,
      }),
    });

    setEnviando(null);
    setColumnas((cs) =>
      cs.map((c) =>
        c.id !== columnaId
          ? c
          : { ...c, productos: c.productos.map((p) => (p.url === producto.url ? { ...p, agregado: true } : p)) },
      ),
    );
    router.refresh();
  }

  async function enviarTodo(columna: ColumnaCategoria) {
    for (const p of columna.productos) {
      if (!p.agregado) await enviarAlCatalogo(columna.id, p);
    }
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
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Importar de la tienda</h2>
        <p className="tenue" style={{ fontSize: 13, marginBottom: 12 }}>
          Pega el link de una categoría de tu tienda (o del catálogo completo) y trae todos sus
          productos, con foto y precio, para elegir cuáles mandar al catálogo.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label className="etiqueta-campo" htmlFor="p-link-categoria">Link de la categoría (tu tienda)</label>
            <input
              id="p-link-categoria" className="campo" placeholder="https://tu-tienda.com/categoria/..."
              value={nuevoLink}
              onChange={(e) => setNuevoLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") cargarLink(); }}
            />
          </div>
          <button type="button" className="btn btn-primario" onClick={cargarLink} disabled={!nuevoLink.trim()}>
            + Agregar link
          </button>
        </div>

        {columnas.length > 0 && (
          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
            {columnas.map((c) => (
              <ColumnaProductos
                key={c.id}
                columna={c}
                enviando={enviando}
                onQuitar={() => quitarColumna(c.id)}
                onEnviar={(p) => enviarAlCatalogo(c.id, p)}
                onEnviarTodo={() => enviarTodo(c)}
              />
            ))}
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
                  {reparte && <th>Número</th>}
                  <th style={{ textAlign: "right" }}>Precio</th>
                  <th style={{ textAlign: "right", paddingRight: 17 }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <Fragment key={p.id}>
                  <tr style={{ opacity: p.activo ? 1 : 0.5 }}>
                    <td style={{ paddingLeft: 17, fontWeight: 600 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {p.foto_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.foto_url} alt={`Ver colores y tallas de ${p.nombre}`}
                            title="Ver colores y tallas"
                            onClick={() => setVerProducto(verProducto === p.id ? null : p.id)}
                            style={{
                              width: 28, height: 28, objectFit: "cover", borderRadius: 4, flexShrink: 0,
                              cursor: "pointer",
                            }}
                          />
                        )}
                        {p.nombre}
                      </div>
                    </td>
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
                      {/* Con foto, se abre haciendo clic en ella (ver la miniatura arriba). Este botón es
                          solo el respaldo para cuando no hay foto pero sí quedó una descripción del link. */}
                      {!p.foto_url && p.descripcion && (
                        <button
                          type="button"
                          className="btn btn-tenue"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => setVerProducto(verProducto === p.id ? null : p.id)}
                        >
                          {verProducto === p.id ? "Ocultar producto" : "Ver producto"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-tenue"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => setVerLinks(verLinks === p.id ? null : p.id)}
                      >
                        {verLinks === p.id ? "Ocultar links" : "Links"}
                      </button>
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
                  {verProducto === p.id && (
                    <tr>
                      <td colSpan={reparte ? 4 : 3} style={{ padding: 0 }}>
                        <FichaProducto producto={p} />
                      </td>
                    </tr>
                  )}
                  {verLinks === p.id && (
                    <tr>
                      <td colSpan={reparte ? 4 : 3} style={{ padding: 0 }}>
                        <FilaLinks productoId={p.id} onCambio={() => router.refresh()} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * LO QUE TRAJO UN LINK DE CATEGORÍA: una columna con cada producto que
 * enseña, listo para revisar y mandar al catálogo. Colores y tallas no
 * salen aquí a propósito —eso es un paso aparte, después, producto por
 * producto con «Links» en su fila (ver `cargarLink` en el componente padre)—.
 */
function ColumnaProductos({
  columna,
  enviando,
  onQuitar,
  onEnviar,
  onEnviarTodo,
}: {
  columna: ColumnaCategoria;
  enviando: string | null;
  onQuitar: () => void;
  onEnviar: (p: ProductoDeCategoria) => void;
  onEnviarTodo: () => void;
}) {
  const pendientes = columna.productos.filter((p) => !p.agregado).length;

  return (
    <div
      style={{
        flex: "0 0 280px", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14,
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <span
          style={{ fontWeight: 600, fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          title={columna.url}
        >
          {dominioDeLink(columna.url)}
        </span>
        {columna.estado === "listo" && (
          <span className="tenue" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
            {columna.productos.length === 1 ? "1 producto" : `${columna.productos.length} productos`}
          </span>
        )}
        <button type="button" onClick={onQuitar} title="Quitar" style={{ border: 0, background: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>
          ×
        </button>
      </div>

      {columna.estado === "cargando" && (
        <p className="tenue" style={{ padding: 14, fontSize: 13 }}>Buscando productos…</p>
      )}

      {columna.estado === "error" && (
        <p style={{ padding: 14, fontSize: 13, color: "var(--red)" }}>{columna.error}</p>
      )}

      {columna.estado === "listo" && (
        <>
          <div style={{ maxHeight: 480, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {columna.productos.map((p) => (
              <div key={p.url} style={{ display: "flex", gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                {p.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.fotoUrl} alt="" aria-hidden="true" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                ) : (
                  <div className="tenue" style={{ width: 44, height: 44, borderRadius: 6, background: "var(--soft)", flexShrink: 0, display: "grid", placeItems: "center", fontSize: 10 }}>
                    Sin foto
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.nombre ?? "Producto sin nombre"}
                  </div>
                  <div className="tenue" style={{ fontSize: 12, marginBottom: 6 }}>{dinero(p.precio)}</div>
                  <button
                    type="button"
                    className="btn btn-tenue"
                    style={{ padding: "3px 8px", fontSize: 11.5 }}
                    disabled={p.agregado || enviando === `${columna.id}:${p.url}`}
                    onClick={() => onEnviar(p)}
                  >
                    {p.agregado ? "✓ Agregado" : enviando === `${columna.id}:${p.url}` ? "Agregando…" : "Agregar al catálogo"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: 10, borderTop: "1px solid var(--line)" }}>
            <button
              type="button" className="btn btn-primario" style={{ width: "100%" }}
              disabled={pendientes === 0 || enviando !== null}
              onClick={onEnviarTodo}
            >
              {pendientes === 0 ? "Todo agregado" : `Enviar todo al catálogo (${pendientes})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * LA FICHA DEL PRODUCTO, TAL COMO SE VE EN EL LINK: la foto grande, la
 * descripción de la página y sus colores con las tallas disponibles de cada
 * uno —lo mismo que trajo `importarProductoDeLink`, ver `importar-producto.ts`—,
 * en vez de tener que abrir el link de la tienda para volver a verlo.
 */
function FichaProducto({ producto }: { producto: ProductoVista }) {
  const variantes = (producto.variantes ?? "").split(" · ").map((v) => v.trim()).filter(Boolean);

  return (
    <div
      style={{
        padding: "14px 17px", background: "var(--soft)", borderTop: "1px solid var(--line)",
        display: "flex", gap: 16, flexWrap: "wrap",
      }}
    >
      {producto.foto_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={producto.foto_url} alt={producto.nombre}
          style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 220, display: "grid", gap: 8, alignContent: "start" }}>
        <div style={{ fontWeight: 600 }}>{producto.nombre}</div>
        {producto.descripcion && (
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)", margin: 0 }}>{producto.descripcion}</p>
        )}
        {variantes.length > 0 && (
          <div>
            <div className="tenue" style={{ fontSize: 11.5, marginBottom: 4 }}>Colores y tallas disponibles</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {variantes.map((v) => (
                <li key={v} style={{ fontSize: 13 }}>{v}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * LOS LINKS DE LA TIENDA DE UN PRODUCTO.
 *
 * Puede haber más de uno a propósito: en Roplis, a veces cada color de un
 * mismo artículo es una ficha separada, no botones dentro de una sola página,
 * así que hace falta un link por color para juntarlos todos en Variantes.
 *
 * Un link ya importado no se vuelve a tocar solo (esa es la memoria que pidió
 * la dueña: al llegar un cliente por un anuncio de este producto, el sistema
 * mira esto mismo antes de salir a Roplis otra vez). «Actualizar todo» es la
 * salida manual para cuando cambia el stock.
 */
function FilaLinks({ productoId, onCambio }: { productoId: number; onCambio: () => void }) {
  const [links, setLinks] = useState<LinkProducto[] | null>(null);
  const [nuevoLink, setNuevoLink] = useState("");
  const [ocupado, setOcupado] = useState<"agregar" | "importar" | "actualizar" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    const r = await fetch(`/api/catalogo/${productoId}/links`);
    const datos = await r.json();
    if (r.ok) setLinks(datos.links);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId]);

  async function agregarLink() {
    if (!nuevoLink.trim()) return;
    setOcupado("agregar");
    setError(null);
    const r = await fetch(`/api/catalogo/${productoId}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: nuevoLink.trim() }),
    });
    const datos = await r.json();
    setOcupado(null);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo agregar ese link.");
      return;
    }
    setNuevoLink("");
    await cargar();
  }

  async function quitarLink(id: number) {
    await fetch(`/api/catalogo/${productoId}/links?id=${id}`, { method: "DELETE" });
    await cargar();
  }

  async function importar(forzar: boolean) {
    setOcupado(forzar ? "actualizar" : "importar");
    setError(null);
    const r = await fetch(`/api/catalogo/${productoId}/links/importar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forzar }),
    });
    const datos = await r.json();
    setOcupado(null);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo importar.");
      return;
    }
    if (datos.fallidos?.length) {
      setError(`${datos.fallidos.length} link(s) no se pudieron leer: ${datos.fallidos[0].error}`);
    }
    await cargar();
    onCambio();
  }

  const hayPendientes = links?.some((l) => l.importado_at === null) ?? false;

  return (
    <div style={{ padding: "14px 17px", background: "var(--soft)", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="etiqueta-campo" htmlFor={`nuevo-link-${productoId}`}>Agregar link de este producto</label>
          <input
            id={`nuevo-link-${productoId}`} className="campo" placeholder="https://tu-tienda.com/producto/..."
            value={nuevoLink} onChange={(e) => setNuevoLink(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-tenue" onClick={agregarLink} disabled={ocupado === "agregar" || !nuevoLink.trim()}>
          {ocupado === "agregar" ? "Agregando…" : "Agregar link"}
        </button>
        <button
          type="button" className="btn btn-tenue" onClick={() => importar(false)}
          disabled={ocupado !== null || !hayPendientes}
        >
          {ocupado === "importar" ? "Buscando…" : "Buscar pendientes"}
        </button>
        <button
          type="button" className="btn btn-tenue" onClick={() => importar(true)}
          disabled={ocupado !== null || !links?.length}
        >
          {ocupado === "actualizar" ? "Actualizando…" : "Actualizar todo"}
        </button>
      </div>

      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      {links === null ? (
        <p className="tenue">Cargando…</p>
      ) : links.length === 0 ? (
        <p className="tenue">Este producto todavía no tiene ningún link de la tienda.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {links.map((l) => (
            <li key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span
                title={l.error ?? undefined}
                style={{
                  display: "inline-block", width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                  background: l.error ? "var(--red)" : l.importado_at ? "var(--verde)" : "var(--ink-3, #999)",
                }}
              />
              <a href={l.url} target="_blank" rel="noreferrer" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {l.url}
              </a>
              <span className="tenue" style={{ flexShrink: 0 }}>
                {l.error ? "Error" : l.importado_at ? "Importado" : "Pendiente"}
              </span>
              <button
                type="button" className="btn btn-tenue" style={{ padding: "2px 8px", fontSize: 12 }}
                onClick={() => quitarLink(l.id)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
