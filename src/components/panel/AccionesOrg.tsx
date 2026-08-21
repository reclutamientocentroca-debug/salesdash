"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Acciones del superadmin sobre una cuenta.
 *
 * "Entrar a la cuenta" no existe como botón: lo que existe es PEDIR permiso.
 * El dueño aprueba desde su panel y el acceso caduca solo a los 60 minutos.
 */
export default function AccionesOrg({
  orgId,
  suspendida,
  nombre,
}: {
  orgId: number;
  suspendida: boolean;
  nombre: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accion(accion: "suspender" | "reactivar") {
    if (accion === "suspender" && !confirm(`¿Suspender «${nombre}»? Sus usuarios no podrán entrar.`)) {
      return;
    }

    setOcupado(true);
    setError(null);
    setNota(null);

    const r = await fetch(`/api/admin/orgs/${orgId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accion }),
    });
    const datos = await r.json();

    setOcupado(false);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo completar la acción.");
      return;
    }
    router.refresh();
  }

  async function pedirAcceso() {
    setOcupado(true);
    setError(null);
    setNota(null);

    const r = await fetch("/api/admin/soporte", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, motivo }),
    });
    const datos = await r.json();

    setOcupado(false);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo enviar la solicitud.");
      return;
    }

    setNota(datos.aviso ?? "Solicitud enviada. El dueño de la cuenta la verá en su panel.");
    setPidiendo(false);
    setMotivo("");
    router.refresh();
  }

  return (
    <div style={{ textAlign: "right", maxWidth: 380 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secundario" disabled={ocupado} onClick={() => setPidiendo(!pidiendo)}>
          Pedir acceso
        </button>
        <button
          type="button"
          className="btn btn-secundario"
          style={{ color: suspendida ? "var(--acc)" : "var(--red)" }}
          disabled={ocupado}
          onClick={() => accion(suspendida ? "reactivar" : "suspender")}
        >
          {suspendida ? "Reactivar" : "Suspender"}
        </button>
      </div>

      {pidiendo && (
        <div className="tarjeta" style={{ marginTop: 10, textAlign: "left" }}>
          <label className="etiqueta-campo" htmlFor="motivo">¿Para qué necesitas entrar?</label>
          <textarea
            id="motivo"
            className="campo"
            rows={3}
            style={{ resize: "vertical", fontFamily: "inherit" }}
            placeholder="El cliente reporta que sus cierres no se están contando…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <p className="tenue" style={{ margin: "8px 0 10px" }}>
            El dueño recibirá este motivo por correo y decidirá. Si acepta, el acceso dura 60 minutos
            y queda registrado en su panel.
          </p>
          <button
            type="button"
            className="btn btn-primario"
            style={{ width: "100%" }}
            disabled={ocupado || motivo.trim().length < 10}
            onClick={pedirAcceso}
          >
            Enviar solicitud
          </button>
        </div>
      )}

      {nota && (
        <div className="aviso aviso-acento" style={{ marginTop: 10, textAlign: "left" }}>
          {nota}
        </div>
      )}
      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginTop: 10, textAlign: "left" }}>
          {error}
        </div>
      )}
    </div>
  );
}
