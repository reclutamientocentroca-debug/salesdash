"use client";

import { Fragment, useState } from "react";
import { Vacio, fechaCorta } from "../Piezas";
import type { CanalVista } from "./DifusionesPanel";

export interface CampanaVista {
  id: number; org_id: number; canal_id: number; lista_id: number; nombre: string;
  modo: "qr" | "oficial"; estado: string; motivo_auto_pausa: string | null;
  mensajes_por_dia: number; created_at: number;
}

interface Detalle {
  campana: CampanaVista;
  pendientes: number; en_progreso: number; enviados: number; entregados: number; fallos: number; excluidos: number;
  dias_estimados_restantes: number; fecha_estimada_fin: string;
  resultados: {
    enviados: number; entregados: number; respondieron: number; pidieron_salir: number;
    ventas_ia: number; ventas_humano: number; monto_total: number;
  };
}

const NOMBRE_ESTADO: Record<string, string> = {
  borrador: "Borrador", activa: "Activa", pausada: "Pausada", auto_pausada: "Pausada sola",
  terminada: "Terminada", cancelada: "Cancelada",
};

export default function SeguimientoCampana({
  soyDueno,
  campanas,
  canales,
  onCambio,
}: {
  soyDueno: boolean;
  campanas: CampanaVista[];
  canales: CanalVista[];
  onCambio: () => void;
}) {
  const [abierta, setAbierta] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nuevaCantidad, setNuevaCantidad] = useState("");

  const nombreCanal = (id: number) => canales.find((c) => c.id === id)?.nombre ?? "—";

  async function abrir(id: number) {
    if (abierta === id) { setAbierta(null); setDetalle(null); return; }
    setAbierta(id);
    setDetalle(null);
    setError(null);
    setCargando(true);
    const r = await fetch(`/api/difusion/campanas/${id}`);
    const datos = await r.json().catch(() => null);
    setCargando(false);
    if (r.ok) { setDetalle(datos); setNuevaCantidad(String(datos.campana.mensajes_por_dia)); }
  }

  async function accion(id: number, ruta: "pausar" | "reanudar", cuerpo?: unknown) {
    setOcupado(true);
    setError(null);
    const r = await fetch(`/api/difusion/campanas/${id}/${ruta}`, {
      method: "POST",
      headers: cuerpo ? { "content-type": "application/json" } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await r.json().catch(() => null);
    setOcupado(false);
    if (!r.ok) { setError(datos?.error ?? "No se pudo completar la acción."); return; }
    onCambio();
    await abrirDeNuevo(id);
  }

  async function abrirDeNuevo(id: number) {
    const r = await fetch(`/api/difusion/campanas/${id}`);
    const datos = await r.json().catch(() => null);
    if (r.ok) setDetalle(datos);
  }

  async function cambiarCantidad(id: number) {
    const n = Number(nuevaCantidad);
    if (!Number.isInteger(n) || n < 1) return;
    setOcupado(true);
    setError(null);
    const r = await fetch(`/api/difusion/campanas/${id}/cantidad-diaria`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cantidad: n }),
    });
    const datos = await r.json().catch(() => null);
    setOcupado(false);
    if (!r.ok) { setError(datos?.error ?? "No se pudo cambiar la cantidad."); return; }
    onCambio();
    await abrirDeNuevo(id);
  }

  if (campanas.length === 0) {
    return (
      <section className="tarjeta">
        <Vacio titulo="Todavía no hay ninguna campaña" texto="Créala en la pestaña «Nueva campaña»." />
      </section>
    );
  }

  return (
    <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
      <table className="tabla">
        <thead>
          <tr>
            <th style={{ paddingLeft: 17 }}>Campaña</th>
            <th>Canal</th>
            <th>Estado</th>
            <th>Creada</th>
            <th style={{ paddingRight: 17 }} />
          </tr>
        </thead>
        <tbody>
          {campanas.map((c) => (
            <Fragment key={c.id}>
              <tr>
                <td style={{ paddingLeft: 17, fontWeight: 600 }}>{c.nombre}</td>
                <td>{nombreCanal(c.canal_id)}</td>
                <td>
                  <span className={`pastilla ${c.estado === "activa" ? "pastilla-ia" : c.estado === "auto_pausada" ? "pastilla-revision" : "pastilla-abierta"}`}>
                    {NOMBRE_ESTADO[c.estado] ?? c.estado}
                  </span>
                </td>
                <td className="tenue">{fechaCorta(c.created_at)}</td>
                <td style={{ paddingRight: 17, textAlign: "right" }}>
                  <button type="button" className="btn btn-tenue" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => abrir(c.id)}>
                    {abierta === c.id ? "Ocultar" : "Ver"}
                  </button>
                </td>
              </tr>
              {abierta === c.id && (
                <tr>
                  <td colSpan={5} style={{ padding: 0 }}>
                    <div style={{ padding: "14px 17px", background: "var(--soft)", borderTop: "1px solid var(--line)" }}>
                      {cargando || !detalle ? (
                        <p className="tenue">Cargando…</p>
                      ) : (
                        <>
                          {c.motivo_auto_pausa && (
                            <div className="aviso aviso-error" role="alert" style={{ marginBottom: 12 }}>
                              {c.motivo_auto_pausa}
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
                            <span>Enviados: <strong>{detalle.enviados}</strong></span>
                            <span>Entregados: <strong>{detalle.entregados}</strong></span>
                            <span>Pendientes: <strong>{detalle.pendientes}</strong></span>
                            <span>Fallos: <strong>{detalle.fallos}</strong></span>
                            <span>Excluidos: <strong>{detalle.excluidos}</strong></span>
                          </div>

                          {detalle.pendientes > 0 && detalle.dias_estimados_restantes > 0 && (
                            <p className="tenue" style={{ fontSize: 12.5, marginBottom: 12 }}>
                              Faltan {detalle.dias_estimados_restantes} día(s), termina aproximadamente el {detalle.fecha_estimada_fin}.
                            </p>
                          )}

                          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 14, fontSize: 13 }}>
                            <span>Respondieron: <strong>{detalle.resultados.respondieron}</strong></span>
                            <span>Pidieron SALIR: <strong>{detalle.resultados.pidieron_salir}</strong></span>
                            <span>Ventas automatizadas: <strong>{detalle.resultados.ventas_ia}</strong></span>
                            <span>Ventas asistidas: <strong>{detalle.resultados.ventas_humano}</strong></span>
                            <span>Monto: <strong>{detalle.resultados.monto_total}</strong></span>
                          </div>

                          {soyDueno && (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {c.estado === "activa" && (
                                <button type="button" className="btn btn-tenue" disabled={ocupado} onClick={() => accion(c.id, "pausar")}>
                                  Pausar
                                </button>
                              )}
                              {(c.estado === "pausada" || c.estado === "auto_pausada" || c.estado === "borrador") && (
                                <button type="button" className="btn btn-primario" disabled={ocupado} onClick={() => accion(c.id, "reanudar")}>
                                  {c.estado === "borrador" ? "Iniciar" : "Reanudar"}
                                </button>
                              )}
                              <input
                                type="number" min={1} className="campo" style={{ width: 90 }}
                                value={nuevaCantidad} onChange={(e) => setNuevaCantidad(e.target.value)}
                              />
                              <button type="button" className="btn btn-tenue" disabled={ocupado} onClick={() => cambiarCantidad(c.id)}>
                                Cambiar cantidad diaria
                              </button>
                            </div>
                          )}
                          {error && <div className="aviso aviso-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
