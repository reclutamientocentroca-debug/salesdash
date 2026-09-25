"use client";

import { useState } from "react";
import ListasDeClientes, { type ListaVista } from "./ListasDeClientes";
import NuevaCampana, { type ProductoVista } from "./NuevaCampana";
import SeguimientoCampana, { type CampanaVista } from "./SeguimientoCampana";

export interface CanalVista {
  id: number; nombre: string; tipo: string; pais: string | null; moneda: string | null;
}

export default function DifusionesPanel({
  soyDueno,
  canales,
  listasIniciales,
  campanasIniciales,
  catalogo,
}: {
  soyDueno: boolean;
  canales: CanalVista[];
  listasIniciales: ListaVista[];
  campanasIniciales: CampanaVista[];
  catalogo: ProductoVista[];
}) {
  const [cual, setCual] = useState<"listas" | "nueva" | "seguimiento">(
    campanasIniciales.length === 0 ? "listas" : "seguimiento",
  );
  const [listas, setListas] = useState(listasIniciales);
  const [campanas, setCampanas] = useState(campanasIniciales);

  async function recargarListas() {
    const r = await fetch("/api/difusion/listas");
    const datos = await r.json().catch(() => null);
    if (r.ok && datos?.listas) setListas(datos.listas);
  }

  async function recargarCampanas() {
    const r = await fetch("/api/difusion/campanas");
    const datos = await r.json().catch(() => null);
    if (r.ok && datos?.campanas) setCampanas(datos.campanas);
  }

  return (
    <>
      <div className="sd-pestanas" role="tablist">
        <button type="button" role="tab" className="sd-pestana" aria-selected={cual === "listas"} onClick={() => setCual("listas")}>
          Listas de clientes
        </button>
        <button type="button" role="tab" className="sd-pestana" aria-selected={cual === "nueva"} onClick={() => setCual("nueva")}>
          Nueva campaña
        </button>
        <button type="button" role="tab" className="sd-pestana" aria-selected={cual === "seguimiento"} onClick={() => setCual("seguimiento")}>
          Seguimiento
          {campanas.some((c) => c.estado === "activa") && (
            <span className="sd-cuenta sd-cuenta-viva">
              {campanas.filter((c) => c.estado === "activa").length} activa(s)
            </span>
          )}
        </button>
      </div>

      <div role="tabpanel" hidden={cual !== "listas"}>
        <ListasDeClientes soyDueno={soyDueno} canales={canales} listas={listas} onCambio={recargarListas} />
      </div>
      <div role="tabpanel" hidden={cual !== "nueva"}>
        <NuevaCampana
          soyDueno={soyDueno}
          canales={canales}
          listas={listas}
          catalogo={catalogo}
          onCreada={() => {
            recargarCampanas();
            setCual("seguimiento");
          }}
        />
      </div>
      <div role="tabpanel" hidden={cual !== "seguimiento"}>
        <SeguimientoCampana soyDueno={soyDueno} campanas={campanas} canales={canales} onCambio={recargarCampanas} />
      </div>
    </>
  );
}
