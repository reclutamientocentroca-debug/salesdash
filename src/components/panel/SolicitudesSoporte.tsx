"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SoporteAcceso } from "@/lib/db";
import { fechaHora } from "./Piezas";

/**
 * Accesos de soporte, del lado del cliente.
 *
 * Nunca hay un acceso silencioso: aquí el dueño ve quién pidió entrar, por
 * qué, cuándo, y hasta cuándo duró. Y es él quien aprueba, no la plataforma.
 */

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  solicitado: { texto: "Esperando tu respuesta", clase: "pastilla-revision" },
  aprobado: { texto: "Aprobado", clase: "pastilla-ia" },
  rechazado: { texto: "Rechazado", clase: "pastilla-abierta" },
  expirado: { texto: "Expirado", clase: "pastilla-abierta" },
};

export default function SolicitudesSoporte({
  accesos,
  soyDueno,
}: {
  accesos: SoporteAcceso[];
  soyDueno: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function responder(id: number, aprobar: boolean) {
    setOcupado(id);
    setError(null);

    const r = await fetch("/api/soporte", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, aprobar }),
    });

    setOcupado(null);
    if (!r.ok) {
      const datos = await r.json();
      setError(datos.error ?? "No se pudo guardar la respuesta.");
      return;
    }
    router.refresh();
  }

  const pendientes = accesos.filter((a) => a.estado === "solicitado");

  return (
    <section className="tarjeta">
      <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Acceso de soporte</h2>
      <p className="tenue" style={{ marginBottom: 14 }}>
        Nadie del equipo de SalesDash puede entrar a tu cuenta sin que tú lo apruebes. Cuando lo
        haces, el acceso dura 60 minutos y se cierra solo. Todo queda registrado aquí.
      </p>

      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {accesos.length === 0 ? (
        <p className="tenue">Nadie ha pedido entrar a tu cuenta.</p>
      ) : (
        <ul style={{ display: "grid", gap: 12 }}>
          {accesos.map((a) => {
            const e = ESTADOS[a.estado] ?? ESTADOS.solicitado!;
            return (
              <li
                key={a.id}
                style={{
                  display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
                  paddingBottom: 12, borderBottom: "1px solid var(--line)",
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span className={`pastilla ${e.clase}`}>{e.texto}</span>
                    <span className="tenue">{fechaHora(a.solicitado_at)}</span>
                  </div>
                  <p style={{ fontSize: 12.5 }}>{a.motivo}</p>
                  {a.estado === "aprobado" && a.expira_at && (
                    <p className="tenue" style={{ marginTop: 4 }}>
                      Válido hasta {fechaHora(a.expira_at)}
                    </p>
                  )}
                </div>

                {a.estado === "solicitado" && soyDueno && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secundario"
                      disabled={ocupado === a.id}
                      onClick={() => responder(a.id, true)}
                    >
                      Dar acceso 60 min
                    </button>
                    <button
                      type="button"
                      className="btn btn-tenue"
                      style={{ color: "var(--red)" }}
                      disabled={ocupado === a.id}
                      onClick={() => responder(a.id, false)}
                    >
                      Rechazar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pendientes.length > 0 && !soyDueno && (
        <p className="tenue" style={{ marginTop: 10 }}>
          Solo el dueño de la cuenta puede responder a estas solicitudes.
        </p>
      )}
    </section>
  );
}
