"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Agente {
  nombre: string;
  tono: string;
  instrucciones: string;
  modelo: string;
  modelo_respaldo: string | null;
  pasar_a_humano: boolean;
  silenciar_si_humano: boolean;
  horario_activo: boolean;
  horario_desde: string | null;
  horario_hasta: string | null;
}

interface CanalAgente {
  id: number;
  nombre: string;
  phone: string | null;
  agente_activo: boolean;
  conectado: boolean;
}

interface Consumo {
  respuestas_hoy: number;
  fallos_hoy: number;
  modelo_gratuito: boolean;
  cupo_estimado: number | null;
}

interface Modelo {
  id: string;
  nombre: string;
  gratis: boolean;
  precioEntrada: number | null;
  precioSalida: number | null;
  vision: boolean;
}

const TONOS = [
  { clave: "cercano", texto: "Cercano" },
  { clave: "formal", texto: "Formal" },
  { clave: "directo", texto: "Directo" },
  { clave: "alegre", texto: "Alegre" },
];

function Interruptor({
  activo,
  onChange,
  etiqueta,
  descripcion,
}: {
  activo: boolean;
  onChange: (v: boolean) => void;
  etiqueta: string;
  descripcion: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        className="sd-switch"
        onClick={() => onChange(!activo)}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{etiqueta}</div>
        <div className="tenue">{descripcion}</div>
      </div>
    </div>
  );
}

function SelectorModelo({
  valor,
  modelos,
  onChange,
  id,
  permitirVacio,
}: {
  valor: string;
  modelos: Modelo[];
  onChange: (v: string) => void;
  id: string;
  permitirVacio?: boolean;
}) {
  const gratuitos = modelos.filter((m) => m.gratis);
  const dePago = modelos.filter((m) => !m.gratis);

  const precio = (m: Modelo) =>
    m.precioSalida === null ? "" : ` · $${m.precioSalida.toFixed(2)}/M`;

  return (
    <select id={id} className="campo" value={valor} onChange={(e) => onChange(e.target.value)}>
      {permitirVacio && <option value="">Sin respaldo</option>}
      {modelos.length === 0 && <option value={valor}>{valor}</option>}

      {gratuitos.length > 0 && (
        <optgroup label="Gratuitos">
          {gratuitos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre} · Gratis
            </option>
          ))}
        </optgroup>
      )}

      {dePago.length > 0 && (
        <optgroup label="De pago">
          {dePago.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
              {precio(m)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export default function PanelAgente({
  agenteInicial,
  canalesIniciales,
  consumo,
}: {
  agenteInicial: Agente;
  canalesIniciales: CanalAgente[];
  consumo: Consumo;
}) {
  const router = useRouter();
  const [agente, setAgente] = useState(agenteInicial);
  const [canales, setCanales] = useState(canalesIniciales);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chat de prueba
  const [prueba, setPrueba] = useState("");
  const [respuesta, setRespuesta] = useState<{ texto: string; modelo: string; fueRespaldo: boolean } | null>(null);
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    fetch("/api/modelos")
      .then((r) => r.json())
      .then((d) => setModelos([...(d.gratuitos ?? []), ...(d.de_pago ?? [])]))
      .catch(() => {
        /* Sin lista, los selectores muestran el modelo guardado y ya. */
      });
  }, []);

  const encendidos = canales.filter((c) => c.agente_activo).length;
  const esGratuito = agente.modelo.endsWith(":free") || modelos.find((m) => m.id === agente.modelo)?.gratis;

  function cambiar<K extends keyof Agente>(campo: K, valor: Agente[K]) {
    setAgente((a) => ({ ...a, [campo]: valor }));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setNota(null);

    const r = await fetch("/api/agente", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(agente),
    });
    const datos = await r.json();

    setGuardando(false);
    if (!r.ok) setError(datos.error ?? "No se pudo guardar.");
    else {
      setNota("Guardado.");
      router.refresh();
    }
  }

  async function alternarCanal(id: number, activo: boolean) {
    setCanales((cs) => cs.map((c) => (c.id === id ? { ...c, agente_activo: activo } : c)));

    const r = await fetch(`/api/canales/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agente_activo: activo }),
    });

    if (!r.ok) {
      setCanales((cs) => cs.map((c) => (c.id === id ? { ...c, agente_activo: !activo } : c)));
      setError("No se pudo cambiar el número.");
    }
  }

  async function probar() {
    if (!prueba.trim()) return;
    setProbando(true);
    setError(null);
    setRespuesta(null);

    const r = await fetch("/api/agente/probar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversacion: [{ rol: "cliente", texto: prueba }] }),
    });
    const datos = await r.json();

    setProbando(false);
    if (!r.ok) setError(datos.error ?? "No se pudo generar la respuesta.");
    else setRespuesta(datos);
  }

  return (
    <div className="rejilla">
      {/* ── Activación ────────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2 className="titulo-tarjeta" style={{ marginBottom: 10 }}>Dónde responde</h2>

        <div className="aviso aviso-ambar" style={{ marginBottom: 14 }}>
          <strong>Este agente sí escribe a tus clientes.</strong> Enciéndelo solo en los números donde
          quieras que conteste solo. La IA que mide tus ventas es otra y nunca escribe a nadie.
        </div>

        {canales.length === 0 ? (
          <p className="tenue">Conecta un número primero.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {canales.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.agente_activo}
                  aria-label={`Agente en ${c.nombre}`}
                  className="sd-switch"
                  disabled={!c.conectado}
                  onClick={() => alternarCanal(c.id, !c.agente_activo)}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.nombre}</div>
                  <div className="num tenue">
                    {c.phone ? `+${c.phone}` : "sin vincular"}
                    {!c.conectado && " · desconectado"}
                  </div>
                </div>
                <span
                  className={`pastilla ${c.agente_activo ? "pastilla-ia" : "pastilla-abierta"}`}
                >
                  {c.agente_activo ? "Responde" : "Apagado"}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gap: 14, marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <Interruptor
            activo={agente.silenciar_si_humano}
            onChange={(v) => cambiar("silenciar_si_humano", v)}
            etiqueta="Callarse si un vendedor está atendiendo"
            descripcion="Si alguien de tu equipo escribió en las últimas 2 horas, el agente no responde. Evita que le escriban encima al cliente."
          />
          <Interruptor
            activo={agente.pasar_a_humano}
            onChange={(v) => cambiar("pasar_a_humano", v)}
            etiqueta="Pasar a una persona cuando lo pidan"
            descripcion="Si el cliente pide hablar con alguien, el agente deja de responder y la conversación se marca."
          />
          <Interruptor
            activo={agente.horario_activo}
            onChange={(v) => cambiar("horario_activo", v)}
            etiqueta="Responder solo en un horario"
            descripcion="Fuera de la franja que elijas, el agente no contesta."
          />

          {agente.horario_activo && (
            <div style={{ display: "flex", gap: 10, paddingLeft: 50 }}>
              <div>
                <label className="etiqueta-campo" htmlFor="desde">Desde</label>
                <input
                  id="desde" type="time" className="campo" style={{ width: 130 }}
                  value={agente.horario_desde ?? "09:00"}
                  onChange={(e) => cambiar("horario_desde", e.target.value)}
                />
              </div>
              <div>
                <label className="etiqueta-campo" htmlFor="hasta">Hasta</label>
                <input
                  id="hasta" type="time" className="campo" style={{ width: 130 }}
                  value={agente.horario_hasta ?? "18:00"}
                  onChange={(e) => cambiar("horario_hasta", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="sd-mitades">
        {/* ── Personalidad ────────────────────────────────────────────────── */}
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Cómo habla</h2>

          <label className="etiqueta-campo" htmlFor="nombre-agente">Nombre del agente</label>
          <input
            id="nombre-agente" className="campo" style={{ marginBottom: 14 }}
            value={agente.nombre} onChange={(e) => cambiar("nombre", e.target.value)}
          />

          <div className="etiqueta-campo">Tono</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {TONOS.map((t) => (
              <button
                key={t.clave}
                type="button"
                className={`pastilla ${agente.tono === t.clave ? "pastilla-ia" : "pastilla-abierta"}`}
                style={{ cursor: "pointer", border: "none", padding: "5px 13px" }}
                onClick={() => cambiar("tono", t.clave)}
              >
                {t.texto}
              </button>
            ))}
          </div>

          <label className="etiqueta-campo" htmlFor="instrucciones">Instrucciones de tu negocio</label>
          <textarea
            id="instrucciones" className="campo" rows={6}
            style={{ resize: "vertical", fontFamily: "inherit" }}
            placeholder="Los envíos a la capital cuestan 200 y llegan al día siguiente. No damos descuentos por debajo de 3 unidades…"
            value={agente.instrucciones}
            onChange={(e) => cambiar("instrucciones", e.target.value)}
          />
          <p className="tenue" style={{ marginTop: 6 }}>
            Lo que escribas aquí es lo que el agente da por cierto. No inventará precios que no estén
            aquí ni en tu catálogo.
          </p>
        </section>

        {/* ── Modelo ──────────────────────────────────────────────────────── */}
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Modelo</h2>

          <label className="etiqueta-campo" htmlFor="modelo">Modelo principal</label>
          <SelectorModelo
            id="modelo" valor={agente.modelo} modelos={modelos}
            onChange={(v) => cambiar("modelo", v)}
          />

          {esGratuito && (
            <div className="aviso aviso-ambar" style={{ marginTop: 10 }}>
              Los modelos gratuitos tienen un límite diario bajo. Al agotarse, tu agente deja de
              responder hasta el día siguiente. Sirven para probar; para atender clientes de verdad,
              usa un modelo de pago.
            </div>
          )}

          <label className="etiqueta-campo" htmlFor="respaldo" style={{ marginTop: 14 }}>
            Modelo de respaldo
          </label>
          <SelectorModelo
            id="respaldo" valor={agente.modelo_respaldo ?? ""} modelos={modelos} permitirVacio
            onChange={(v) => cambiar("modelo_respaldo", v || null)}
          />
          <p className="tenue" style={{ marginTop: 6 }}>
            Si el principal falla o agota su límite, se intenta una vez con este. Si tampoco hay
            respuesta, el agente se calla y marca la conversación: nunca le escribe un error al cliente.
          </p>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <div className="rotulo" style={{ marginBottom: 8 }}>Consumo de hoy</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Respuestas generadas</span>
              <span className="num" style={{ fontWeight: 600 }}>
                {consumo.respuestas_hoy}
                {consumo.cupo_estimado && <span className="tenue"> de ~{consumo.cupo_estimado}</span>}
              </span>
            </div>

            {consumo.cupo_estimado && (
              <div style={{ height: 5, background: "var(--soft)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min((consumo.respuestas_hoy / consumo.cupo_estimado) * 100, 100)}%`,
                    height: "100%",
                    background:
                      consumo.respuestas_hoy / consumo.cupo_estimado > 0.8 ? "var(--amber)" : "var(--acc)",
                  }}
                />
              </div>
            )}

            {consumo.fallos_hoy > 0 && (
              <p className="tenue" style={{ marginTop: 8, color: "var(--red)" }}>
                {consumo.fallos_hoy} intento{consumo.fallos_hoy === 1 ? "" : "s"} fallido
                {consumo.fallos_hoy === 1 ? "" : "s"} hoy.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* ── Chat de prueba ─────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Pruébalo</h2>
        <p className="tenue" style={{ marginBottom: 12 }}>
          Genera una respuesta con la configuración actual. No se envía a nadie.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="campo"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Escribe lo que diría un cliente…"
            value={prueba}
            onChange={(e) => setPrueba(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void probar();
            }}
          />
          <button type="button" className="btn btn-secundario" onClick={probar} disabled={probando}>
            {probando ? "Pensando…" : "Probar"}
          </button>
        </div>

        {respuesta && (
          <div className="sd-hilo" style={{ marginTop: 14 }}>
            <div className="sd-burbuja sd-burbuja-cliente">{prueba}</div>
            <div className="sd-burbuja sd-burbuja-ia">{respuesta.texto}</div>
            <p className="tenue" style={{ alignSelf: "flex-end" }}>
              {respuesta.modelo}
              {respuesta.fueRespaldo && " · respondió el respaldo"}
            </p>
          </div>
        )}
      </section>

      {error && (
        <div className="aviso aviso-error" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-primario" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar cambios"}
        </button>
        {nota && <span className="tenue">{nota}</span>}
        <span className="tenue" style={{ marginLeft: "auto" }}>
          {encendidos === 0
            ? "El agente no responde en ningún número."
            : `Responde en ${encendidos} número${encendidos === 1 ? "" : "s"}.`}
        </span>
      </div>
    </div>
  );
}
