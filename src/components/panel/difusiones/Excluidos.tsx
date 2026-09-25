"use client";

import { useEffect, useState } from "react";
import { Vacio, fechaCorta } from "../Piezas";

export interface ExcluidoVista {
  telefono: string;
  motivo: string | null;
  created_at: number;
}

const NOMBRE_MOTIVO: Record<string, string> = {
  salir: "Respondió «SALIR»",
};

export default function Excluidos({ iniciales }: { iniciales: ExcluidoVista[] }) {
  const [excluidos, setExcluidos] = useState(iniciales);
  const [cargando, setCargando] = useState(false);

  async function recargar() {
    setCargando(true);
    const r = await fetch("/api/difusion/excluidos");
    const datos = await r.json().catch(() => null);
    setCargando(false);
    if (r.ok && datos?.excluidos) setExcluidos(datos.excluidos);
  }

  // Se refresca al entrar a la pestaña: alguien pudo pedir salir hace un minuto.
  useEffect(() => {
    void recargar();
  }, []);

  if (excluidos.length === 0) {
    return (
      <section className="tarjeta">
        <Vacio
          titulo="Nadie ha pedido salir todavía"
          texto="Quien responda «SALIR» (o «no más», «stop»…) a cualquier difusión aparece aquí, y no vuelve a recibir ninguna campaña de esta cuenta."
        />
      </section>
    );
  }

  return (
    <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 17px" }}>
        <p className="tenue" style={{ margin: 0, fontSize: 12.5 }}>
          No vuelven a recibir ninguna difusión de esta cuenta, en ningún canal.
        </p>
        <button type="button" className="btn btn-tenue" disabled={cargando} onClick={() => void recargar()}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
      <table className="tabla">
        <thead>
          <tr>
            <th style={{ paddingLeft: 17 }}>Teléfono</th>
            <th>Motivo</th>
            <th style={{ paddingRight: 17 }}>Desde</th>
          </tr>
        </thead>
        <tbody>
          {excluidos.map((e) => (
            <tr key={e.telefono}>
              <td style={{ paddingLeft: 17, fontWeight: 600 }}>{e.telefono}</td>
              <td>{(e.motivo && NOMBRE_MOTIVO[e.motivo]) ?? e.motivo ?? "—"}</td>
              <td style={{ paddingRight: 17 }} className="tenue">{fechaCorta(e.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
