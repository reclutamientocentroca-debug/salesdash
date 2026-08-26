"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Org {
  nombre: string;
  color: string;
  meta_cobertura: number;
  meta_efectividad: number;
  marcador_cierre: string;
  modelo_analisis: string;
  modelo_vision: string;
  modelo_audio: string;
}

interface Modelo {
  id: string;
  nombre: string;
  gratis: boolean;
  precioSalida: number | null;
  vision: boolean;
  audio: boolean;
}

/** La misma paleta de seis que se reparte al registrarse. */
const PALETA = ["#12876a", "#0e7490", "#4f46e5", "#7c3aed", "#b45309", "#9f1239"];

export default function FormularioConfiguracion({ orgInicial }: { orgInicial: Org }) {
  const router = useRouter();
  const [org, setOrg] = useState(orgInicial);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/modelos")
      .then((r) => r.json())
      .then((d) => setModelos([...(d.gratuitos ?? []), ...(d.de_pago ?? [])]))
      .catch(() => {});
  }, []);

  function cambiar<K extends keyof Org>(campo: K, valor: Org[K]) {
    setOrg((o) => ({ ...o, [campo]: valor }));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setNota(null);

    const r = await fetch("/api/org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(org),
    });
    const datos = await r.json();

    setGuardando(false);
    if (!r.ok) setError(datos.error ?? "No se pudo guardar.");
    else {
      setNota("Guardado.");
      router.refresh();
    }
  }

  const conVision = modelos.filter((m) => m.vision);
  const conAudio = modelos.filter((m) => m.audio);

  return (
    <div className="rejilla">
      <div className="sd-mitades">
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Tu negocio</h2>

          <label className="etiqueta-campo" htmlFor="nombre-org">Nombre</label>
          <input
            id="nombre-org" className="campo" style={{ marginBottom: 14 }}
            value={org.nombre} onChange={(e) => cambiar("nombre", e.target.value)}
          />

          <div className="etiqueta-campo">Color del panel</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            {PALETA.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={org.color.toLowerCase() === c}
                onClick={() => cambiar("color", c)}
                style={{
                  width: 30, height: 30, borderRadius: 8, background: c, cursor: "pointer",
                  border: org.color.toLowerCase() === c ? "2px solid var(--ink)" : "1px solid var(--line-2)",
                }}
              />
            ))}
          </div>
          <p className="tenue">Se aplica al recargar la página.</p>
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Tus metas</h2>

          <label className="etiqueta-campo" htmlFor="cobertura">
            Cobertura de la IA — cuánto de lo que se vende quieres que cierre sola
          </label>
          <input
            id="cobertura" className="campo num" type="number" min={0} max={100}
            style={{ marginBottom: 14 }}
            value={org.meta_cobertura}
            onChange={(e) => cambiar("meta_cobertura", Number(e.target.value))}
          />

          <label className="etiqueta-campo" htmlFor="efectividad">
            Efectividad del equipo — de los hilos que toca un vendedor, cuántos deben cerrar
          </label>
          <input
            id="efectividad" className="campo num" type="number" min={0} max={100}
            value={org.meta_efectividad}
            onChange={(e) => cambiar("meta_efectividad", Number(e.target.value))}
          />
          <p className="tenue" style={{ marginTop: 8 }}>
            Verde cumple la meta, ámbar hasta 5 puntos por debajo, rojo más abajo.
          </p>
        </section>
      </div>

      <section className="tarjeta">
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Cómo se detecta un cierre</h2>
        <p className="tenue" style={{ marginBottom: 12 }}>
          Cuando tu IA manda el resumen del pedido, ¿con qué palabra empieza? Es la señal con la que
          el analista sabe que ahí se cerró la venta.
        </p>

        <label className="etiqueta-campo" htmlFor="marcador">Marcador de cierre</label>
        <input
          id="marcador" className="campo" style={{ maxWidth: 300, fontFamily: "var(--font-mono)" }}
          value={org.marcador_cierre}
          onChange={(e) => cambiar("marcador_cierre", e.target.value)}
        />
        <p className="tenue" style={{ marginTop: 8 }}>
          Con <strong>Resumen:</strong> también cuentan <strong>Resumen de su pedido:</strong> y{" "}
          <strong>RESUMEN DEL PEDIDO</strong> como título de una línea, aunque no lleve dos puntos —
          que es como lo escribe casi todo agente. Lo que no cuenta es nombrar la palabra a mitad de
          una frase («ahora le paso el resumen»): eso es una promesa, no un pedido.
        </p>
        <p className="tenue" style={{ marginTop: 6 }}>
          Distingue mayúsculas de minúsculas solo al mostrarlo; al buscar, no. Si lo cambias, las
          conversaciones ya clasificadas no se vuelven a evaluar.
        </p>
      </section>

      <section className="tarjeta">
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Modelos del analista</h2>
        <p className="tenue" style={{ marginBottom: 14 }}>
          Esta IA solo lee y clasifica. Nunca escribe a un cliente.
        </p>

        <div className="sd-mitades">
          <div>
            <label className="etiqueta-campo" htmlFor="m-analisis">Análisis de texto</label>
            <select
              id="m-analisis" className="campo"
              value={org.modelo_analisis}
              onChange={(e) => cambiar("modelo_analisis", e.target.value)}
            >
              {modelos.length === 0 && <option value={org.modelo_analisis}>{org.modelo_analisis}</option>}
              <optgroup label="Gratuitos">
                {modelos.filter((m) => m.gratis).map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre} · Gratis</option>
                ))}
              </optgroup>
              <optgroup label="De pago">
                {modelos.filter((m) => !m.gratis).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                    {m.precioSalida !== null && ` · $${m.precioSalida.toFixed(2)}/M`}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="etiqueta-campo" htmlFor="m-vision">
              Descripción de imágenes
            </label>
            <select
              id="m-vision" className="campo"
              value={org.modelo_vision}
              onChange={(e) => cambiar("modelo_vision", e.target.value)}
            >
              {conVision.length === 0 && <option value={org.modelo_vision}>{org.modelo_vision}</option>}
              {conVision.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                  {m.gratis ? " · Gratis" : m.precioSalida !== null ? ` · $${m.precioSalida.toFixed(2)}/M` : ""}
                </option>
              ))}
            </select>
            <p className="tenue" style={{ marginTop: 6 }}>
              Solo se listan modelos que aceptan imágenes. Se usa para distinguir una factura de una
              foto de producto: sin eso, cualquier imagen del vendedor contaría como venta cerrada.
            </p>
          </div>

          <div>
            <label className="etiqueta-campo" htmlFor="m-audio">
              Transcripción de notas de voz
            </label>
            <select
              id="m-audio" className="campo"
              value={org.modelo_audio}
              onChange={(e) => cambiar("modelo_audio", e.target.value)}
            >
              {conAudio.length === 0 && <option value={org.modelo_audio}>{org.modelo_audio}</option>}
              {conAudio.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                  {m.gratis ? " · Gratis" : m.precioSalida !== null ? ` · $${m.precioSalida.toFixed(2)}/M` : ""}
                </option>
              ))}
            </select>
            <p className="tenue" style={{ marginTop: 6 }}>
              Solo se listan modelos que aceptan audio, que son bastantes menos. Sin esto una nota de
              voz es un agujero en la conversación: el analista ve «[nota de voz]» y no puede decidir
              nada, y media venta puede cerrarse hablando.
            </p>
          </div>
        </div>

        {(org.modelo_analisis.endsWith(":free") || modelos.find((m) => m.id === org.modelo_analisis)?.gratis) && (
          <div className="aviso aviso-ambar" style={{ marginTop: 12 }}>
            Los modelos gratuitos tienen un límite diario bajo. Al agotarse, el análisis deja de
            funcionar hasta el día siguiente. Sirven para probar; para trabajar de verdad, usa uno de pago.
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
      </div>
    </div>
  );
}
