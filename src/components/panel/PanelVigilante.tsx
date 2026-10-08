"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface CanalVigilante {
  id: number;
  nombre: string;
  pais: string;
  activa: boolean;
  modo: "corregir" | "vigilar";
  guia: string;
  reglas: string;
}

interface Props {
  puedeEditarGeneral: boolean;
  general: { activa: boolean; prompt: string };
  defectos: { prompt: string; reglas: string; guiaRD: string };
  canales: CanalVigilante[];
}

interface ResultadoPrueba {
  veredicto: "APROBADA" | "CORREGIDA" | "FALLO";
  motivos: string[];
  respuestaFinal: string;
  error: string | null;
}

async function guardar(cuerpo: Record<string, unknown>): Promise<string | null> {
  const r = await fetch("/api/vigilante/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (r.ok) return null;
  return ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "No se pudo guardar";
}

function Interruptor({ activo, onChange, etiqueta, descripcion, deshabilitado }: {
  activo: boolean;
  onChange: (v: boolean) => void;
  etiqueta: string;
  descripcion: string;
  deshabilitado?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        className="sd-switch"
        disabled={deshabilitado}
        onClick={() => onChange(!activo)}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{etiqueta}</div>
        <div className="tenue">{descripcion}</div>
      </div>
    </div>
  );
}

export default function PanelVigilante({ puedeEditarGeneral, general, defectos, canales }: Props) {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // ── General ───────────────────────────────────────────────────────────────
  const [generalActiva, setGeneralActiva] = useState(general.activa);
  const [prompt, setPrompt] = useState(general.prompt);

  async function cambiarGeneral(cuerpo: { activa?: boolean; prompt?: string | null }) {
    const error = await guardar({ canal: 0, ...cuerpo });
    setAviso(error ? { tipo: "error", texto: error } : { tipo: "ok", texto: "Guardado" });
    if (!error) router.refresh();
    return !error;
  }

  // ── Por canal ─────────────────────────────────────────────────────────────
  const [estado, setEstado] = useState(() => Object.fromEntries(canales.map((c) => [c.id, c])));
  const [canalId, setCanalId] = useState<number | null>(canales[0]?.id ?? null);
  const canal = canalId !== null ? estado[canalId] : undefined;

  function cambiarLocal(parche: Partial<CanalVigilante>) {
    if (canalId === null) return;
    setEstado((e) => ({ ...e, [canalId]: { ...e[canalId]!, ...parche } }));
  }

  async function guardarCanal(cuerpo: Record<string, unknown>) {
    if (canalId === null) return;
    const error = await guardar({ canal: canalId, ...cuerpo });
    setAviso(error ? { tipo: "error", texto: error } : { tipo: "ok", texto: "Guardado" });
    if (!error) router.refresh();
  }

  // ── .docx ─────────────────────────────────────────────────────────────────
  const entradaArchivo = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);

  async function subirDocx(archivo: File) {
    setLeyendo(true);
    setAviso(null);
    const forma = new FormData();
    forma.set("archivo", archivo);
    const r = await fetch("/api/vigilante/docx", { method: "POST", body: forma });
    const j = (await r.json().catch(() => null)) as { texto?: string; error?: string } | null;
    setLeyendo(false);
    if (entradaArchivo.current) entradaArchivo.current.value = "";

    if (!r.ok || !j?.texto) {
      setAviso({ tipo: "error", texto: j?.error ?? "No se pudo leer el archivo" });
      return;
    }
    cambiarLocal({ guia: j.texto });
    setAviso({ tipo: "ok", texto: "Texto cargado en la guía. Revísalo y pulsa «Guardar guía y reglas»." });
  }

  // ── Prueba ────────────────────────────────────────────────────────────────
  const [mensajeCliente, setMensajeCliente] = useState("");
  const [respuestaAgente, setRespuestaAgente] = useState("");
  const [producto, setProducto] = useState("");
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null);
  const [errorPrueba, setErrorPrueba] = useState<string | null>(null);

  async function probar() {
    if (!canal) return;
    setProbando(true);
    setPrueba(null);
    setErrorPrueba(null);
    const r = await fetch("/api/vigilante/probar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canal: canal.id,
        mensajeCliente,
        respuestaAgente,
        producto: producto || undefined,
        // Lo que está escrito ahora, aunque todavía no se haya guardado.
        guia: canal.guia,
        reglas: canal.reglas,
        prompt,
      }),
    });
    const j = (await r.json().catch(() => null)) as (ResultadoPrueba & { error?: string }) | null;
    setProbando(false);
    if (!r.ok || !j) {
      setErrorPrueba((j as { error?: string } | null)?.error ?? "No se pudo probar");
      return;
    }
    setPrueba(j);
  }

  return (
    <>
      {aviso && (
        <div className={aviso.tipo === "ok" ? "aviso" : "aviso aviso-error"} role="status" style={{ marginBottom: 14 }}>
          {aviso.texto}
        </div>
      )}

      {/* ── General ─────────────────────────────────────────────────────── */}
      <div className="tarjeta" style={{ marginBottom: 14 }}>
        <div className="titulo-tarjeta">General</div>
        <Interruptor
          activo={generalActiva}
          deshabilitado={!puedeEditarGeneral}
          etiqueta="IA Vigilante activada"
          descripcion="Interruptor general de la cuenta. Además hay que encenderla en cada canal, abajo."
          onChange={async (v) => {
            setGeneralActiva(v);
            if (!(await cambiarGeneral({ activa: v }))) setGeneralActiva(!v);
          }}
        />

        <label style={{ display: "block", marginTop: 14 }}>
          <span className="etiqueta-campo">Prompt de sistema de la vigilante</span>
          <textarea
            className="campo"
            rows={14}
            value={prompt}
            disabled={!puedeEditarGeneral}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ width: "100%", fontFamily: "inherit" }}
          />
          <span className="tenue">
            Cómo debe revisar. La guía, las reglas fijas y el formato JSON de salida se le añaden solos; no hace falta
            escribirlos aquí.
          </span>
        </label>
        {puedeEditarGeneral && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-primario" onClick={() => void cambiarGeneral({ prompt })}>
              Guardar prompt
            </button>
            <button
              type="button"
              className="btn btn-secundario"
              onClick={async () => {
                if (await cambiarGeneral({ prompt: null })) setPrompt(defectos.prompt);
              }}
            >
              Restaurar el de fábrica
            </button>
          </div>
        )}
      </div>

      {/* ── Por canal ───────────────────────────────────────────────────── */}
      {canales.length === 0 || !canal ? (
        <div className="tarjeta">
          <p className="tenue">Conecta un número para configurar su vigilante.</p>
        </div>
      ) : (
        <div className="tarjeta" style={{ marginBottom: 14 }}>
          <div className="titulo-tarjeta">Por canal o país</div>

          <label style={{ display: "block", marginBottom: 14 }}>
            <span className="etiqueta-campo">Canal</span>
            <select className="campo" value={canal.id} onChange={(e) => setCanalId(Number(e.target.value))}>
              {canales.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.pais ? ` (${c.pais.toUpperCase()})` : ""} — {c.activa ? "activa" : "apagada"}
                </option>
              ))}
            </select>
          </label>

          <Interruptor
            activo={canal.activa}
            etiqueta={`Vigilante en ${canal.nombre}`}
            descripcion="Revisa las respuestas de este agente antes de enviarlas."
            onChange={async (v) => {
              cambiarLocal({ activa: v });
              await guardarCanal({ activa: v });
            }}
          />

          <fieldset style={{ border: 0, padding: 0, margin: "14px 0" }}>
            <legend className="etiqueta-campo">Modo</legend>
            {(
              [
                ["corregir", "Corregir", "Revisa y reemplaza la respuesta si está mal (por defecto)."],
                ["vigilar", "Solo vigilar", "Revisa y registra, pero envía siempre la original. Sirve para probar sin riesgo."],
              ] as const
            ).map(([valor, nombre, texto]) => (
              <label key={valor} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                <input
                  type="radio"
                  name={`modo-${canal.id}`}
                  checked={canal.modo === valor}
                  onChange={async () => {
                    cambiarLocal({ modo: valor });
                    await guardarCanal({ modo: valor });
                  }}
                />
                <span>
                  <strong>{nombre}</strong> <span className="tenue">{texto}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label style={{ display: "block", marginBottom: 6 }}>
            <span className="etiqueta-campo">Guía de venta de {canal.nombre}</span>
            <textarea
              className="campo"
              rows={16}
              value={canal.guia}
              onChange={(e) => cambiarLocal({ guia: e.target.value })}
              style={{ width: "100%", fontFamily: "inherit" }}
              placeholder="Escribe la guía de venta de este país, o sube un documento .docx."
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <input
              ref={entradaArchivo}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subirDocx(f);
              }}
            />
            <button type="button" className="btn btn-secundario" disabled={leyendo} onClick={() => entradaArchivo.current?.click()}>
              {leyendo ? "Leyendo…" : "Subir .docx"}
            </button>
            {canal.pais === "do" && (
              <button type="button" className="btn btn-secundario" onClick={() => cambiarLocal({ guia: defectos.guiaRD })}>
                Poner la guía de fábrica de RD
              </button>
            )}
          </div>

          <label style={{ display: "block", marginBottom: 10 }}>
            <span className="etiqueta-campo">Reglas fijas (mandan por encima de la guía)</span>
            <textarea
              className="campo"
              rows={12}
              value={canal.reglas}
              onChange={(e) => cambiarLocal({ reglas: e.target.value })}
              style={{ width: "100%", fontFamily: "inherit" }}
            />
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primario" onClick={() => void guardarCanal({ guia: canal.guia, reglas: canal.reglas })}>
              Guardar guía y reglas
            </button>
            <button
              type="button"
              className="btn btn-secundario"
              onClick={async () => {
                await guardarCanal({ guia: null, reglas: null });
                cambiarLocal({ reglas: defectos.reglas, guia: canal.pais === "do" ? defectos.guiaRD : "" });
              }}
            >
              Restaurar los de fábrica
            </button>
          </div>
        </div>
      )}

      {/* ── Prueba manual ───────────────────────────────────────────────── */}
      {canal && (
        <div className="tarjeta">
          <div className="titulo-tarjeta">Probar la vigilante</div>
          <p className="tenue" style={{ marginBottom: 10 }}>
            Pega un mensaje de cliente y una respuesta del agente para ver qué haría. No se envía nada a ningún cliente
            ni queda en el registro. Usa lo que está escrito arriba para {canal.nombre}, aunque no lo hayas guardado.
          </p>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span className="etiqueta-campo">Mensaje del cliente</span>
            <textarea className="campo" rows={2} value={mensajeCliente} onChange={(e) => setMensajeCliente(e.target.value)} style={{ width: "100%", fontFamily: "inherit" }} />
          </label>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span className="etiqueta-campo">Respuesta del agente</span>
            <textarea className="campo" rows={3} value={respuestaAgente} onChange={(e) => setRespuestaAgente(e.target.value)} style={{ width: "100%", fontFamily: "inherit" }} />
          </label>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span className="etiqueta-campo">Producto y precio (opcional)</span>
            <textarea className="campo" rows={2} value={producto} onChange={(e) => setProducto(e.target.value)} style={{ width: "100%", fontFamily: "inherit" }} placeholder="Ej.: Zapatos BROX. RD$1,400 la unidad, RD$1,190 desde 3." />
          </label>
          <button type="button" className="btn btn-primario" disabled={probando || !mensajeCliente.trim() || !respuestaAgente.trim()} onClick={() => void probar()}>
            {probando ? "Revisando…" : "Probar"}
          </button>

          {errorPrueba && <div className="aviso aviso-error" style={{ marginTop: 12 }}>{errorPrueba}</div>}

          {prueba && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {prueba.veredicto === "APROBADA" && "✅ APROBADA — se enviaría la original"}
                {prueba.veredicto === "CORREGIDA" && "✏️ CORREGIDA — se enviaría esta versión"}
                {prueba.veredicto === "FALLO" && "⚠️ No se pudo revisar — se enviaría la original"}
              </div>
              {prueba.error && <div className="aviso aviso-ambar" style={{ marginBottom: 8 }}>{prueba.error}</div>}
              {prueba.motivos.length > 0 && (
                <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>
                  {prueba.motivos.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              <div className="sd-burbuja sd-burbuja-ia" style={{ whiteSpace: "pre-wrap" }}>{prueba.respuestaFinal}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
