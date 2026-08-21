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
  /** En este número contesta una IA que no es la nuestra. */
  contesta_ia: boolean;
  activo: boolean;
  ultimo_evento_at: number | null;
}

const ESTADOS: Record<string, { texto: string; color: string }> = {
  conectado: { texto: "Conectado", color: "var(--acc)" },
  esperando: { texto: "Esperando escaneo", color: "var(--amber)" },
  escaneando: { texto: "Conectando", color: "var(--blue)" },
  iniciando: { texto: "Preparando", color: "var(--amber)" },
  pendiente: { texto: "Sin vincular", color: "var(--ink-3)" },
  desconectado: { texto: "Desconectado", color: "var(--red)" },
  error: { texto: "Con problema", color: "var(--red)" },
};

export default function ListaNumeros({ canales }: { canales: CanalVista[] }) {
  const router = useRouter();
  const [conectando, setConectando] = useState(canales.length === 0);
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

  /**
   * Quién contesta en este número.
   *
   * Encenderlo no cambia solo lo que venga: recalcula lo que ya está. Por eso
   * se pregunta antes — es la diferencia entre «la IA cerró 12 ventas» y «el
   * equipo cerró 12 ventas», y el panel entero se lee distinto.
   */
  async function marcarContestaIa(id: number, nombre: string, valor: boolean) {
    if (
      valor &&
      !confirm(
        `¿En «${nombre}» contesta TU IA?\n\n` +
          "El panel NO va a responder a nadie. Solo mira las conversaciones y, cuando vea el " +
          "resumen de pedido de tu IA, apunta esa venta como cerrada por ella.\n\n" +
          "Además, el agente vendedor del panel se apaga en este número y no puede volver a " +
          "hablar aquí, para que ningún cliente reciba dos respuestas.\n\n" +
          "Las conversaciones que ya están se recalculan: se les quita «intervino un humano» y sus " +
          "ventas pasan al lado de la IA. Apagarlo después no deshace lo recalculado.",
      )
    ) {
      return;
    }

    setOcupado(id);
    setError(null);
    const r = await fetch(`/api/canales/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contesta_ia: valor }),
    });
    setOcupado(null);
    if (!r.ok) {
      const datos = await r.json().catch(() => ({}));
      setError(datos.error ?? "No se pudo guardar quién contesta en este número.");
      return;
    }
    router.refresh();
  }

  /**
   * Desconectar borra las conversaciones y las métricas del número, y no se
   * deshace. Por eso ya no lo pregunta un `confirm()` del navegador: un aviso
   * que solo se puede aceptar o cancelar deja al dueño eligiendo entre perderlo
   * todo o no hacer nada.
   *
   * En su lugar se abre este paso, donde la salida buena —descargar el informe—
   * está delante y en verde, y el botón rojo espera debajo. Cuesta un clic más
   * y evita la llamada de «¿se puede recuperar?», que no.
   */
  const [despidiendo, setDespidiendo] = useState<number | null>(null);
  const [descargado, setDescargado] = useState<number | null>(null);

  async function desconectar(id: number) {
    setOcupado(id);
    setError(null);
    const r = await fetch(`/api/canales/${id}`, { method: "DELETE" });
    const datos = await r.json();
    setOcupado(null);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo desconectar.");
      return;
    }
    setDespidiendo(null);
    router.refresh();
  }

  if (conectando) {
    return (
      <>
        <ConectarNumero
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
                    {/* Si en el número contesta otra IA, el nuestro se calla
                        aunque esté encendido: dos vendedores contestando el
                        mismo mensaje es peor que ninguno. */}
                    <dd
                      style={{
                        color: c.agente_activo && !c.contesta_ia ? "var(--acc)" : "var(--ink-3)",
                        fontWeight: 600,
                      }}
                    >
                      {c.contesta_ia
                        ? "Callado: aquí contesta otra IA"
                        : c.agente_activo
                          ? "Encendido"
                          : "Apagado"}
                    </dd>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <dt style={{ color: "var(--ink-2)" }}>Quién contesta</dt>
                    <dd style={{ color: c.contesta_ia ? "var(--acc)" : "var(--ink-3)", fontWeight: 600 }}>
                      {c.contesta_ia ? "Tu IA · el panel solo vigila" : "Personas"}
                    </dd>
                  </div>
                </dl>

                {/*
                  De quién son los mensajes que salen de este número. No manda
                  nada ni enciende nada: solo dice quién escribe, que es de lo
                  que salen la pastilla de «intervino un humano» y el lado al
                  que va cada venta cerrada.
                */}
                <p className="tenue" style={{ marginBottom: 10 }}>
                  {c.contesta_ia
                    ? "El panel solo mira este número: no contesta. Lo que salga de aquí se cuenta como de la IA, y cuando vea un resumen de pedido lo apuntará como venta cerrada por ella."
                    : "Las respuestas que no salgan de aquí se cuentan como escritas por una persona. Si en este número contesta un bot tuyo, díselo o sus ventas se las llevará el equipo."}
                </p>

                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {/* Antes había «Ver token» y «Reintentar configuración». El
                      primero no tiene sentido sin proveedor —la credencial es la
                      vinculación del teléfono, no un texto— y el segundo apuntaba
                      un webhook que ya no existe. Los sustituye reconectar, que es
                      lo único accionable cuando un número aparece caído. */}
                  <button
                    type="button"
                    className="btn btn-secundario"
                    disabled={ocupado === c.id}
                    onClick={() => accion(c.id, { accion: "reconectar" })}
                  >
                    Reconectar
                  </button>

                  <button
                    type="button"
                    className={`btn ${c.contesta_ia ? "btn-acento" : "btn-secundario"}`}
                    disabled={ocupado === c.id}
                    aria-pressed={c.contesta_ia}
                    onClick={() => marcarContestaIa(c.id, c.nombre, !c.contesta_ia)}
                  >
                    {/* «Tu IA» y no «una IA» a secas: lo que se marca es que
                        contesta la del dueño y que el panel se limita a mirar.
                        Leído deprisa, «Aquí contesta una IA» se puede entender
                        como que se enciende la nuestra, que es justo lo
                        contrario de lo que hace. */}
                    {c.contesta_ia
                      ? "Aquí vuelven a contestar personas"
                      : "Aquí contesta tu IA (el panel solo vigila)"}
                  </button>

                  {/*
                    El informe no vive solo en la despedida: se puede bajar
                    cuando se quiera. Un dueño que quiere el histórico de su
                    número no tiene por qué pasar por la pantalla de borrarlo.

                    Es un enlace y no un botón con `fetch` porque el navegador
                    ya sabe descargar: el servidor manda el archivo con su
                    nombre y el navegador lo guarda, sin pasar por memoria.
                  */}
                  <a
                    className="btn btn-secundario"
                    style={{ textDecoration: "none" }}
                    href={`/api/canales/${c.id}/informe`}
                    onClick={() => setDescargado(c.id)}
                  >
                    Descargar informe
                  </a>

                  <button
                    type="button"
                    className="btn btn-tenue"
                    style={{ color: "var(--red)", marginLeft: "auto" }}
                    disabled={ocupado === c.id}
                    onClick={() => setDespidiendo(despidiendo === c.id ? null : c.id)}
                  >
                    Desconectar
                  </button>
                </div>

                {despidiendo === c.id && (
                  <div
                    className="aviso aviso-error"
                    style={{ marginTop: 12, display: "grid", gap: 10 }}
                    role="alertdialog"
                    aria-label={`Desconectar ${c.nombre}`}
                  >
                    <div>
                      Al desconectar <strong>{c.nombre}</strong> se borran sus conversaciones, sus
                      mensajes y sus métricas. No se puede deshacer y no queda copia en el servidor.
                      Llévate antes el informe: trae el panel de este número, sus porcentajes, sus
                      cierres y los hilos con cada cliente, en un archivo que se abre en cualquier
                      navegador y se imprime a PDF.
                    </div>

                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                      <a
                        className="btn btn-acento"
                        style={{ textDecoration: "none" }}
                        href={`/api/canales/${c.id}/informe`}
                        onClick={() => setDescargado(c.id)}
                      >
                        Descargar el informe
                      </a>

                      <button
                        type="button"
                        className="btn btn-tenue"
                        style={{ color: "var(--red)" }}
                        disabled={ocupado === c.id}
                        onClick={() => desconectar(c.id)}
                      >
                        {descargado === c.id ? "Ya lo tengo: desconectar" : "Desconectar sin informe"}
                      </button>

                      <button
                        type="button"
                        className="btn btn-tenue"
                        style={{ marginLeft: "auto" }}
                        disabled={ocupado === c.id}
                        onClick={() => setDespidiendo(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
