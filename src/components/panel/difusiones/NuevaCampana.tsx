"use client";

import { useMemo, useState } from "react";
import { Vacio } from "../Piezas";
import { calcularReparto } from "@/lib/difusion-calculo";
import { estimarCosto } from "@/lib/meta/difusion-oficial";
import type { CanalVista } from "./DifusionesPanel";
import type { ListaVista } from "./ListasDeClientes";

export interface ProductoVista {
  id: number; nombre: string; precio: number | null; canal_id: number;
}

const DIAS = [
  { valor: 1, letra: "L" }, { valor: 2, letra: "M" }, { valor: 3, letra: "M" }, { valor: 4, letra: "J" },
  { valor: 5, letra: "V" }, { valor: 6, letra: "S" }, { valor: 7, letra: "D" },
];

export default function NuevaCampana({
  soyDueno,
  canales,
  listas,
  catalogo,
  onCreada,
}: {
  soyDueno: boolean;
  canales: CanalVista[];
  listas: ListaVista[];
  catalogo: ProductoVista[];
  onCreada: () => void;
}) {
  const [canalId, setCanalId] = useState<number | "">(canales[0]?.id ?? "");
  const [listaId, setListaId] = useState<number | "">("");
  const [nombre, setNombre] = useState("");
  const [productoCatalogoId, setProductoCatalogoId] = useState<number | "">("");
  const [productoNombre, setProductoNombre] = useState("");
  const [productoPrecio, setProductoPrecio] = useState("");
  const [mensajeBase, setMensajeBase] = useState("");
  const [variaciones, setVariaciones] = useState<string[]>([]);
  const [generando, setGenerando] = useState(false);
  const [imagenClave, setImagenClave] = useState<string | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [mensajesPorDia, setMensajesPorDia] = useState(50);
  const [diasSemana, setDiasSemana] = useState<number[]>([1, 2, 3, 4, 5]);
  const [horaDesde, setHoraDesde] = useState("09:00");
  const [horaHasta, setHoraHasta] = useState("18:00");
  const [modo, setModo] = useState<"qr" | "oficial">("qr");
  const [costoPorMensaje, setCostoPorMensaje] = useState(0.06);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<{ id: number; destinatarios: number } | null>(null);
  const [iniciando, setIniciando] = useState(false);

  const producto = catalogo.find((p) => p.id === productoCatalogoId);
  const totalClientes = listas.find((l) => l.id === listaId)?.contactos ?? 0;
  const reparto = useMemo(
    () => calcularReparto(totalClientes, mensajesPorDia, diasSemana),
    [totalClientes, mensajesPorDia, diasSemana],
  );
  const costoEstimado = useMemo(() => estimarCosto(totalClientes, costoPorMensaje), [totalClientes, costoPorMensaje]);

  function alternarDia(d: number) {
    setDiasSemana((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));
  }

  async function generarVariaciones() {
    if (!mensajeBase.trim()) return;
    setGenerando(true);
    setError(null);
    const r = await fetch("/api/difusion/variaciones", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mensajeBase: mensajeBase.trim() }),
    });
    const datos = await r.json().catch(() => null);
    setGenerando(false);
    if (!r.ok) {
      setError(datos?.error ?? "No se pudieron generar las variaciones.");
      return;
    }
    setVariaciones(datos.variaciones ?? []);
  }

  async function subirImagen(archivo: File) {
    setSubiendoImagen(true);
    setError(null);
    const forma = new FormData();
    forma.append("archivo", archivo);
    const r = await fetch("/api/difusion/imagen", { method: "POST", body: forma });
    const datos = await r.json().catch(() => null);
    setSubiendoImagen(false);
    if (!r.ok) {
      setError(datos?.error ?? "No se pudo subir la imagen.");
      return;
    }
    setImagenClave(datos.clave);
  }

  async function crear() {
    if (!canalId || !listaId || !nombre.trim() || !mensajeBase.trim()) {
      setError("Completa el canal, la lista, el nombre y el mensaje.");
      return;
    }
    if (diasSemana.length === 0) {
      setError("Elige al menos un día de la semana.");
      return;
    }
    setCreando(true);
    setError(null);

    const r = await fetch("/api/difusion/campanas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canalId, listaId, nombre: nombre.trim(), modo, mensajeBase: mensajeBase.trim(),
        variaciones: variaciones.length ? variaciones : null,
        imagenClave,
        productoCatalogoId: productoCatalogoId || null,
        productoNombre: productoCatalogoId ? null : productoNombre.trim() || null,
        productoPrecio: productoCatalogoId ? null : productoPrecio ? Number(productoPrecio) : null,
        mensajesPorDia, diasSemana, horaDesde, horaHasta,
        costoEstimadoPorMensaje: costoPorMensaje,
      }),
    });
    const datos = await r.json().catch(() => null);
    setCreando(false);

    if (!r.ok) {
      setError(datos?.error ?? "No se pudo crear la campaña.");
      return;
    }
    setCreada(datos);
  }

  async function iniciar() {
    if (!creada) return;
    setIniciando(true);
    setError(null);
    const r = await fetch(`/api/difusion/campanas/${creada.id}/iniciar`, { method: "POST" });
    const datos = await r.json().catch(() => null);
    setIniciando(false);
    if (!r.ok) {
      setError(datos?.error ?? "No se pudo iniciar la campaña.");
      return;
    }
    onCreada();
  }

  if (!soyDueno) {
    return (
      <section className="tarjeta">
        <Vacio titulo="Solo el dueño de la cuenta crea campañas de difusión" />
      </section>
    );
  }

  if (creada) {
    return (
      <section className="tarjeta">
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Campaña creada</h2>
        <p style={{ fontSize: 13, marginBottom: 14 }}>
          «{nombre}» quedó guardada con {creada.destinatarios} destinatario(s), lista para iniciar.
        </p>
        {error && <div className="aviso aviso-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          {modo === "qr" ? (
            <button type="button" className="btn btn-primario" onClick={iniciar} disabled={iniciando}>
              {iniciando ? "Iniciando…" : "Iniciar campaña"}
            </button>
          ) : (
            <span className="aviso" role="status">
              Modo oficial: disponible próximamente. La campaña queda guardada en borrador.
            </span>
          )}
          <button
            type="button" className="btn btn-tenue"
            onClick={() => {
              setCreada(null); setNombre(""); setMensajeBase(""); setVariaciones([]); setImagenClave(null);
            }}
          >
            Crear otra campaña
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="tarjeta">
      <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Nueva campaña</h2>
      <p className="tenue" style={{ fontSize: 13, marginBottom: 14 }}>
        El precio del producto siempre sale del catálogo: elígelo de la lista y no se puede inventar aparte.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 12 }}>
        <div>
          <label className="etiqueta-campo" htmlFor="camp-canal">Canal que envía</label>
          <select id="camp-canal" className="campo" value={canalId} onChange={(e) => setCanalId(Number(e.target.value))}>
            <option value="">Elige un canal</option>
            {canales.filter((c) => c.tipo === "whatsapp").map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}{c.pais ? ` · ${c.pais}` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta-campo" htmlFor="camp-lista">Lista de clientes</label>
          <select id="camp-lista" className="campo" value={listaId} onChange={(e) => setListaId(Number(e.target.value))}>
            <option value="">Elige una lista</option>
            {listas.map((l) => (
              <option key={l.id} value={l.id}>{l.nombre}{l.contactos !== null ? ` (${l.contactos})` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta-campo" htmlFor="camp-nombre">Nombre de la campaña</label>
          <input id="camp-nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Promo de septiembre" />
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 12 }}>
        <div>
          <label className="etiqueta-campo" htmlFor="camp-producto">Producto del catálogo (el precio sale de aquí)</label>
          <select id="camp-producto" className="campo" value={productoCatalogoId} onChange={(e) => setProductoCatalogoId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin producto de catálogo</option>
            {catalogo.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}{p.precio ? ` — ${p.precio}` : ""}</option>
            ))}
          </select>
        </div>
        {!productoCatalogoId && (
          <>
            <div>
              <label className="etiqueta-campo" htmlFor="camp-prod-nombre">Producto (a mano)</label>
              <input id="camp-prod-nombre" className="campo" value={productoNombre} onChange={(e) => setProductoNombre(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta-campo" htmlFor="camp-prod-precio">Precio (a mano)</label>
              <input id="camp-prod-precio" type="number" className="campo" value={productoPrecio} onChange={(e) => setProductoPrecio(e.target.value)} />
            </div>
          </>
        )}
      </div>
      {producto && (
        <p className="tenue" style={{ fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>
          Se usará: {producto.nombre} — {producto.precio ?? "sin precio"}
        </p>
      )}

      <div style={{ marginBottom: 12 }}>
        <label className="etiqueta-campo" htmlFor="camp-mensaje">
          Mensaje — puedes usar <code>{"{nombre}"}</code> y <code>{"{producto}"}</code>
        </label>
        <textarea
          id="camp-mensaje" className="campo" rows={3} value={mensajeBase}
          onChange={(e) => setMensajeBase(e.target.value)}
          placeholder="Hola {nombre}, tenemos {producto} disponible..."
        />
        <p className="tenue" style={{ fontSize: 12, marginTop: 4 }}>
          «Responda SALIR si no desea recibir más mensajes.» se agrega solo, al final.
        </p>
      </div>

      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-tenue" onClick={generarVariaciones} disabled={generando || !mensajeBase.trim()}>
          {generando ? "Generando…" : "Generar variaciones con IA"}
        </button>
        {variaciones.length > 0 && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <p className="tenue" style={{ fontSize: 12 }}>
              Revisa y edita las variaciones. Cada destinatario recibe una, para que no salgan mensajes idénticos.
            </p>
            {variaciones.map((v, i) => (
              <textarea
                key={i} className="campo" rows={2} value={v}
                onChange={(e) => setVariaciones((vs) => vs.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="etiqueta-campo" htmlFor="camp-imagen">Imagen del producto (opcional)</label>
        <input
          id="camp-imagen" type="file" accept="image/*" className="campo"
          disabled={subiendoImagen}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subirImagen(f); }}
        />
        {subiendoImagen && <span className="tenue" style={{ fontSize: 12 }}>Subiendo…</span>}
        {imagenClave && <span className="tenue" style={{ fontSize: 12 }}>✓ Imagen lista</span>}
      </div>

      <div style={{ marginBottom: 6 }}>
        <label className="etiqueta-campo">Días de la semana</label>
        <div style={{ display: "flex", gap: 6 }}>
          {DIAS.map((d) => (
            <button
              key={d.valor} type="button"
              className={`btn ${diasSemana.includes(d.valor) ? "btn-primario" : "btn-tenue"}`}
              style={{ padding: "4px 10px", fontSize: 12, minWidth: 32 }}
              onClick={() => alternarDia(d.valor)}
            >
              {d.letra}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", margin: "12px 0" }}>
        <div>
          <label className="etiqueta-campo" htmlFor="camp-cantidad">Mensajes por día</label>
          <input id="camp-cantidad" type="number" min={1} className="campo" value={mensajesPorDia} onChange={(e) => setMensajesPorDia(Math.max(1, Number(e.target.value)))} />
          <p className="tenue" style={{ fontSize: 11.5, marginTop: 3 }}>El tope duro del sistema es 250/día por número, aunque pongas más.</p>
        </div>
        <div>
          <label className="etiqueta-campo" htmlFor="camp-desde">Horario desde</label>
          <input id="camp-desde" type="time" className="campo" value={horaDesde} onChange={(e) => setHoraDesde(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta-campo" htmlFor="camp-hasta">hasta</label>
          <input id="camp-hasta" type="time" className="campo" value={horaHasta} onChange={(e) => setHoraHasta(e.target.value)} />
        </div>
      </div>

      {totalClientes > 0 && reparto.diasNecesarios > 0 && (
        <p className="aviso" role="status" style={{ marginBottom: 14 }}>
          Se reparte en {reparto.diasNecesarios} día(s), termina aproximadamente el {reparto.fechaEstimadaFin}.
        </p>
      )}

      <div style={{ marginBottom: 14 }}>
        <label className="etiqueta-campo">Modo de envío</label>
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" checked={modo === "qr"} onChange={() => setModo("qr")} />
            WhatsApp (QR) — gratis
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="radio" checked={modo === "oficial"} onChange={() => setModo("oficial")} />
            Oficial (Cloud API) — próximamente
          </label>
        </div>
        {modo === "oficial" && (
          <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
            <label className="etiqueta-campo" htmlFor="camp-costo" style={{ margin: 0 }}>Costo estimado por mensaje</label>
            <input
              id="camp-costo" type="number" step="0.01" className="campo" style={{ width: 100 }}
              value={costoPorMensaje} onChange={(e) => setCostoPorMensaje(Number(e.target.value))}
            />
            <span className="tenue" style={{ fontSize: 12.5 }}>Total estimado: {costoEstimado.toFixed(2)}</span>
          </div>
        )}
      </div>

      {error && <div className="aviso aviso-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <button type="button" className="btn btn-primario" onClick={crear} disabled={creando}>
        {creando ? "Creando…" : "Crear campaña"}
      </button>
    </section>
  );
}
