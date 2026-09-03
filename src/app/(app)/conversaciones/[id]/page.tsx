import Link from "next/link";
import { notFound } from "next/navigation";
import AgenteEnHilo from "@/components/panel/AgenteEnHilo";
import AnalizarBoton from "@/components/panel/AnalizarBoton";
import BorrarConversacionBoton from "@/components/panel/BorrarConversacionBoton";
import { Burbuja } from "@/components/panel/Burbuja";
import { Pastilla, dinero, fechaHora } from "@/components/panel/Piezas";
import { llegoPorAnuncio } from "@/lib/anuncio";
import { getConversation, listarCanales, listarMensajes } from "@/lib/db";
import { porQueCalla } from "@/lib/agent";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Conversación · SalesDash" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rango?: string }>;
}

const SENALES: Record<string, string> = {
  resumen_ia: "se mandó el resumen del pedido",
  imagen_factura: "se mandó la foto de la factura, y en el hilo no hubo resumen",
  imagen_comprobante: "se mandó un comprobante de pago, y en el hilo no hubo resumen",
  correccion_manual: "lo corrigió una persona desde la bandeja de revisión",
  // Señales viejas: ya no se producen, pero quedan hilos sellados con ellas.
  resumen_tras_intervencion: "se mandó el resumen del pedido",
  confirmacion_texto: "se mandó el resumen del pedido",
};

export default async function PaginaConversacion({ params, searchParams }: Props) {
  const ctx = await requerirSesion();
  const { id } = await params;
  const { rango = "7d" } = await searchParams;

  const conv = getConversation(ctx.orgId, Number(id));
  if (!conv) notFound();

  const mensajes = listarMensajes(ctx.orgId, conv.id);
  const canal = listarCanales(ctx.orgId).find((c) => c.id === conv.canal_id);
  /* Por qué el agente contesta —o no— en este hilo. Ver `porQueCalla`: son
     lecturas de la base, ni una llamada a ningún modelo. */
  const agente = porQueCalla(ctx.orgId, conv.canal_id, conv.id);
  const faltantes = leerLista(conv.datos_faltantes);

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <Link href={`/conversaciones?rango=${rango}`} className="tenue" style={{ textDecoration: "none" }}>
            ← Conversaciones
          </Link>
          <h1 className="h1-pagina" style={{ marginTop: 4 }}>
            {conv.cliente_nombre ?? "Sin nombre"}
          </h1>
          <p className="num tenue" style={{ marginTop: 2 }}>
            +{conv.cliente_phone} · {canal?.nombre ?? "—"}
          </p>
        </div>

        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
          <AnalizarBoton conversationId={conv.id} yaAnalizada={conv.analizada_at !== null} />
          <BorrarConversacionBoton conversationId={conv.id} />
        </div>
      </div>

      <div className="sd-fila-3">
        <section className="tarjeta" style={{ background: "var(--page)" }}>
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Hilo</h2>

          <div className="sd-hilo">
            {mensajes.map((m) => (
              <Burbuja key={m.id} m={m} anuncio={conv} />
            ))}
          </div>
        </section>

        <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <section className="tarjeta">
            <h2 className="titulo-tarjeta" style={{ marginBottom: 10 }}>Agente</h2>
            <AgenteEnHilo conversationId={conv.id} estado={agente} atiende={conv.atiende} />
          </section>

          <section className="tarjeta">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 className="titulo-tarjeta">Pedido</h2>
              <Pastilla estado={conv.cerrado_por} />
            </div>

            <dl style={{ display: "grid", gap: 9, fontSize: 12.5 }}>
              <Dato etiqueta="Producto" valor={conv.producto_vendido ?? "—"} />
              <Dato etiqueta="Total" valor={dinero(conv.total)} />
              <Dato etiqueta="Envío" valor={dinero(conv.envio)} />
              <Dato
                etiqueta="Del anuncio"
                valor={
                  conv.producto_anuncio ??
                  (llegoPorAnuncio(conv) ? "Anuncio sin título" : "—")
                }
              />
              <Dato etiqueta="Primer mensaje" valor={fechaHora(conv.fecha_inicio)} />
              <Dato etiqueta="Cierre" valor={fechaHora(conv.fecha_cierre)} />
            </dl>

            {/*
              Lo que el anuncio le prometió a este cliente. Va con el pedido y
              no en una tarjeta aparte porque es lo que se lee justo antes de
              entender por qué pide lo que pide: el título dice qué producto lo
              trajo, y el texto, qué se le dijo que iba a encontrar.
            */}
            {conv.descripcion_anuncio && (
              <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--ink)" }}>Prometía:</strong>{" "}
                {conv.descripcion_anuncio}
              </p>
            )}

            {conv.resumen_pedido && (
              <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--ink-2)" }}>{conv.resumen_pedido}</p>
            )}

            {faltantes.length > 0 && (
              <div className="aviso aviso-ambar" style={{ marginTop: 12 }}>
                Falta por confirmar: {faltantes.join(", ")}.
              </div>
            )}
          </section>

          <section className="tarjeta">
            <h2 className="titulo-tarjeta" style={{ marginBottom: 10 }}>Por qué se clasificó así</h2>

            {conv.senal_de_cierre ? (
              <p style={{ fontSize: 12.5, marginBottom: 8 }}>
                Señal usada:{" "}
                <strong>{SENALES[conv.senal_de_cierre] ?? conv.senal_de_cierre}</strong>
              </p>
            ) : (
              <p className="tenue" style={{ marginBottom: 8 }}>
                Todavía no se ha detectado ninguna señal de cierre.
              </p>
            )}

            {conv.justificacion && (
              <p style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{conv.justificacion}</p>
            )}

            {conv.intervencion_humana === 1 && (
              <p className="tenue" style={{ marginTop: 8 }}>
                Un vendedor participó en esta conversación.
              </p>
            )}

            {conv.motivo_perdida && (
              <p style={{ fontSize: 12.5, marginTop: 8 }}>
                Motivo de que no cerrara: <strong>{conv.motivo_perdida}</strong>
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <dt style={{ color: "var(--ink-2)" }}>{etiqueta}</dt>
      <dd className="num" style={{ fontWeight: 600, textAlign: "right" }}>{valor}</dd>
    </div>
  );
}

function leerLista(bruto: string | null): string[] {
  if (!bruto) return [];
  try {
    const v = JSON.parse(bruto);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [bruto];
  }
}
