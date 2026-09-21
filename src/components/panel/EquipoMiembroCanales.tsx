"use client";

import { useState } from "react";

/**
 * LAS PASTILLAS DE NÚMEROS QUE UN MIEMBRO PUEDE ATENDER.
 *
 * Sin marcar ninguna, ese miembro ve TODOS los números de la cuenta — es el
 * comportamiento de siempre, y sigue siéndolo hasta que el dueño marca al
 * menos uno—. En cuanto marca el primero, ese miembro queda limitado a los
 * marcados: deja de ver —y de poder tocar— las conversaciones de los demás.
 * Ver la nota de `equipo_canales` en el esquema y `puedeAtenderCanal` en
 * `tenant.ts`, que es donde se aplica de verdad.
 *
 * Cada clic guarda solo: no hay un botón «Guardar» aparte porque no hay nada
 * más que rellenar en este control, y un guardado que se queda a medias
 * —alguien cierra la pestaña con el formulario abierto— sería peor que
 * guardar de una vez cada cambio.
 */
export default function EquipoMiembroCanales({
  userId,
  canales,
  asignadosIniciales,
}: {
  userId: number;
  canales: { id: number; nombre: string }[];
  asignadosIniciales: number[];
}) {
  const [asignados, setAsignados] = useState<Set<number>>(new Set(asignadosIniciales));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alternar(id: number) {
    const anterior = asignados;
    const siguiente = new Set(anterior);
    if (siguiente.has(id)) siguiente.delete(id);
    else siguiente.add(id);

    setAsignados(siguiente);
    setGuardando(true);
    setError(null);

    try {
      const r = await fetch(`/api/equipo/${userId}/canales`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canalIds: [...siguiente] }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(datos.error ?? "No se pudo guardar");
    } catch (e) {
      // El clic no se queda a medias en la pantalla: si Facebook... si el
      // servidor no lo aceptó, se vuelve a como estaba antes de tocarlo.
      setAsignados(anterior);
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  if (canales.length === 0) {
    return <span className="tenue">Todavía no hay números que repartir.</span>;
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {canales.map((c) => {
          const activo = asignados.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              disabled={guardando}
              onClick={() => void alternar(c.id)}
              className={`pastilla ${activo ? "pastilla-ia" : "pastilla-abierta"}`}
              style={{ cursor: guardando ? "wait" : "pointer", border: "none" }}
              title={activo ? "Quitarle este número o página" : "Darle este número o página"}
            >
              {c.nombre}
            </button>
          );
        })}
      </div>

      {asignados.size === 0 && (
        <p className="tenue" style={{ marginTop: 6, fontSize: 12 }}>
          Sin ninguna marcada, ve y atiende todos los números.
        </p>
      )}

      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
