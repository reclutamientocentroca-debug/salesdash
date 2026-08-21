"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConectarNumero from "./ConectarNumero";
import { Vacio, hace } from "./Piezas";

export interface CanalVista {
  id: number;
  nombre: string;
  phone: string | null;
  estado: string;
  agente_activo: boolean;
  activo: boolean;
  ultimo_evento_at: number | null;
  token_enmascarado: string;
}

const ESTADOS: Record<string, { texto: string; color: string }> = {
  conectado: { texto: "Conectado", color: "var(--acc)" },
  esperando: { texto: "Esperando escaneo", color: "var(--amber)" },
  escaneando: { texto: "Conectando", color: "var(--blue)" },
  iniciando: { texto: "Preparando", color: "var(--amber)" },
  pendiente: { texto: "Sin vincular", color: "var(--ink-3)" },
  error: { texto: "Con problema", color: "var(--red)" },
};

export default function ListaNumeros({
  canales,
  puedeCrearCanal,
}: {
  canales: CanalVista[];
  puedeCrearCanal: boolean;
}) {
  const router = useRouter();
  const [conectando, setConectando] = useState(canales.length === 0);
  const [revelado, setRevelado] = useState<{ id: number; token: string } | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accion(id: number, cuerpo: unknown) {
    setOcupado(id);
    setError(null);
    const r = await fetch(`/api/canales/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json();
    setOcupado(null);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo completar la acción.");
      return null;
    }
    return datos;
  }

  async function revelar(id: number) {
    // El token se pide en el momento y no se deja en el DOM al cerrar.
    const datos = await accion(id, { accion: "revelar" });
    if (datos?.token) setRevelado({ id, token: datos.token });
  }

  async function desconectar(id: number, nombre: string) {
    if (!confirm(`¿Desconectar «${nombre}»? Se borran sus conversaciones y métricas, y no se puede deshacer.`)) {
      return;
    }
    setOcupado(id);
    setError(null);
    const r = await fetch(`/api/canales/${id}`, { method: "DELETE" });
    const datos = await r.json();
    setOcupado(null);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo desconectar.");
      return;
    }
    router.refresh();
  }

  if (conectando) {
    return (
      <>
        <ConectarNumero
          puedeCrearCanal={puedeCrearCanal}
          alConectar={() => {
            setConectando(false);
            router.refresh();
          }}
        />
        {canales.length > 0 && (
          <p style={{ textAlign: "center", marginTop: 14 }}>
            <button type="button" className="btn btn-tenue" onClick={() => setConectando(false)}>
              Volver a mis números
            </button>
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Números</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            {canales.length} de 20 conectados
          </p>
        </div>
        <button type="button" className="btn btn-primario" onClick={() => setConectando(true)}>
          Conectar número
        </button>
      </div>

      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {canales.length === 0 ? (
        <div className="tarjeta">
          <Vacio
            titulo="Todavía no has conectado ningún número"
            texto="Escanea un código con tu WhatsApp y empezamos a medir."
            accion={
              <button type="button" className="btn btn-primario" onClick={() => setConectando(true)}>
                Conectar número
              </button>
            }
          />
        </div>
      ) : (
        <div className="rejilla sd-mitades">
          {canales.map((c) => {
            const e = ESTADOS[c.estado] ?? ESTADOS.pendiente!;
            const mudo = c.estado === "conectado" && (c.ultimo_evento_at ?? 0) < Date.now() / 1000 - 86_400;

            return (
              <article key={c.id} className="tarjeta">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.nombre}</div>
                    <div className="num tenue">{c.phone ? `+${c.phone}` : "sin vincular"}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                    <span className="punto" style={{ background: e.color }} />
                    <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{e.texto}</span>
                  </div>
                </div>

                {mudo && (
                  <div className="aviso aviso-ambar" style={{ marginBottom: 10 }}>
                    Sin mensajes en 24 horas. Suele ser que la recepción dejó de funcionar.
                  </div>
                )}

                <dl style={{ display: "grid", gap: 6, fontSize: 12.5, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <dt style={{ color: "var(--ink-2)" }}>Último mensaje</dt>
                    <dd className="num">{hace(c.ultimo_evento_at)}</dd>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <dt style={{ color: "var(--ink-2)" }}>Agente vendedor</dt>
                    <dd style={{ color: c.agente_activo ? "var(--acc)" : "var(--ink-3)", fontWeight: 600 }}>
                      {c.agente_activo ? "Encendido" : "Apagado"}
                    </dd>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <dt style={{ color: "var(--ink-2)" }}>Token</dt>
                    <dd
                      className="num"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {revelado?.id === c.id ? revelado.token : c.token_enmascarado}
                    </dd>
                  </div>
                </dl>

                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {revelado?.id === c.id ? (
                    <button type="button" className="btn btn-secundario" onClick={() => setRevelado(null)}>
                      Ocultar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secundario"
                      disabled={ocupado === c.id}
                      onClick={() => revelar(c.id)}
                    >
                      Ver token
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-secundario"
                    disabled={ocupado === c.id}
                    onClick={() => accion(c.id, { accion: "reintentar_webhook" })}
                  >
                    Reintentar configuración
                  </button>

                  <button
                    type="button"
                    className="btn btn-tenue"
                    style={{ color: "var(--red)", marginLeft: "auto" }}
                    disabled={ocupado === c.id}
                    onClick={() => desconectar(c.id, c.nombre)}
                  >
                    Desconectar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
