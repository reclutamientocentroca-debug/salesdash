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
  const [nuevo, setNuevo] = useState({ nombre: "", variantes: "", precio: "", canalId: 0, fotoUrl: "", descripcion: "" });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [link, setLink] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errorLink, setErrorLink] = useState<string | null>(null);

  // La foto, cuando se arrastra o se elige a mano en vez de traerla del link.
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

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
        fotoUrl: nuevo.fotoUrl.trim() || null,
        descripcion: nuevo.descripcion.trim() || null,
      }),
    });
    const datos = await r.json();

    setOcupado(false);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo guardar el producto.");
      return;
    }
    setNuevo({ nombre: "", variantes: "", precio: "", canalId: nuevo.canalId, fotoUrl: "", descripcion: "" });
    setLink("");
    router.refresh();
  }

  /**
   * TRAE COLORES Y TALLAS DEL LINK DEL PRODUCTO.
   *
   * Solo llena lo que en el formulario esté vacío —nombre y precio— y
   * reemplaza Variantes con lo que diga esa página: es lo que se le pidió al
   * traerlo. Sigue habiendo que darle a «Agregar», así que hay ocasión de
   * revisarlo o corregirlo antes de que quede en el catálogo.
   */
  async function buscarDeLink() {
    if (!link.trim()) return;
    setBuscando(true);
    setErrorLink(null);

    const r = await fetch("/api/catalogo/importar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: link.trim() }),
    });
    const datos = await r.json();

    setBuscando(false);
    if (!r.ok) {
      setErrorLink(datos.error ?? "No se pudo leer ese link.");
      return;
    }

    if (!datos.variantes) {
      setErrorLink("Se abrió el link, pero no se encontraron colores ni tallas en su descripción.");
    }

    setNuevo((n) => ({
      ...n,
      nombre: n.nombre.trim() || datos.nombre || n.nombre,
      precio: n.precio.trim() ? n.precio : datos.precio != null ? String(datos.precio) : n.precio,
      variantes: datos.variantes ?? n.variantes,
      fotoUrl: datos.fotoUrl ?? n.fotoUrl,
      descripcion: datos.descripcion ?? n.descripcion,
    }));
  }

  /**
   * SUBE LA FOTO QUE LA DUEÑA ARRASTRA O ELIGE A MANO.
   *
   * Alternativa a la del link: no todos los productos tienen tienda en línea,
   * y a veces la foto que trae el link no es la que quiere enseñar. Se guarda
   * en el servidor (ver `/api/catalogo/foto` y `media.ts`) y queda en el mismo
   * campo `fotoUrl` que usa la del link, así que el resto del formulario no
   * necesita saber de cuál de las dos se trata.
   */
  async function subirFoto(archivo: File | undefined | null) {
    if (!archivo) return;
    setSubiendoFoto(true);
    setErrorFoto(null);

    const cuerpo = new FormData();
    cuerpo.append("archivo", archivo);
    const r = await fetch("/api/catalogo/foto", { method: "POST", body: cuerpo });
    const datos = await r.json();

    setSubiendoFoto(false);
    if (!r.ok) {
      setErrorFoto(datos.error ?? "No se pudo subir la imagen.");
      return;
    }
    setNuevo((n) => ({ ...n, fotoUrl: datos.fotoUrl }));
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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ flex: 3, minWidth: 220 }}>
            <label className="etiqueta-campo" htmlFor="p-link">Link del producto (tu tienda)</label>
            <input
              id="p-link" className="campo" placeholder="https://tu-tienda.com/producto/..."
              value={link} onChange={(e) => setLink(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-tenue" onClick={buscarDeLink} disabled={buscando || !link.trim()}>
            {buscando ? "Buscando…" : "Buscar colores y tallas"}
          </button>
        </div>

        {errorLink && (
          <div className="aviso aviso-error" role="alert" style={{ marginBottom: 12 }}>
            {errorLink}
          </div>
        )}

        <label
          htmlFor="p-foto-input"
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            void subirFoto(e.dataTransfer.files[0]);
          }}
          style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 10px",
            border: `1px dashed ${arrastrando ? "var(--acc)" : "var(--line)"}`,
            borderRadius: 8, cursor: "pointer",
            background: arrastrando ? "var(--soft)" : "transparent",
          }}
        >
          <input
            id="p-foto-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
            onChange={(e) => { void subirFoto(e.target.files?.[0]); e.target.value = ""; }}
          />
          {nuevo.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={nuevo.fotoUrl} alt="Foto del producto"
              style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
            />
          ) : (
            <span className="tenue" style={{ fontSize: 20 }} aria-hidden="true">📷</span>
          )}
          <span className="tenue" style={{ fontSize: 12.5 }}>
            {subiendoFoto
              ? "Subiendo…"
              : nuevo.fotoUrl
                ? "Arrastra otra imagen para cambiarla, o haz clic"
                : "Arrastra la foto del producto aquí, o haz clic para elegirla"}
          </span>
          {nuevo.fotoUrl && (
            <button
              type="button" className="btn btn-tenue" style={{ padding: "4px 10px", fontSize: 12, marginLeft: "auto" }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNuevo({ ...nuevo, fotoUrl: "" }); }}
            >
              Quitar foto
            </button>
          )}
        </label>

        {errorFoto && (
          <div className="aviso aviso-error" role="alert" style={{ marginBottom: 12 }}>
            {errorFoto}
          </div>
        )}

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
