import Link from "next/link";
import { notFound } from "next/navigation";
import AnalizarBoton from "@/components/panel/AnalizarBoton";
import { Pastilla, dinero, fechaHora } from "@/components/panel/Piezas";
import { getConversation, listarCanales, listarMensajes, type Mensaje } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Conversación · SalesDash" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rango?: string }>;
}

const SENALES: Record<string, string> = {
  resumen_ia: "resumen de la IA con el marcador de cierre",
  resumen_tras_intervencion: "resumen de la IA, pero un vendedor ya había escrito antes",
  imagen_factura: "el vendedor mandó la factura",
  imagen_comprobante: "el vendedor mandó un comprobante de pago",
  confirmacion_texto: "confirmación por texto de un vendedor",
  correccion_manual: "lo corrigió una persona desde la bandeja de revisión",
};

export default async function PaginaConversacion({ params, searchParams }: Props) {
  const ctx = await requerirSesion();
  const { id } = await params;
  const { rango = "7d" } = await searchParams;

  const conv = getConversation(ctx.orgId, Number(id));
  if (!conv) notFound();

  const mensajes = listarMensajes(ctx.orgId, conv.id);
  const canal = listarCanales(ctx.orgId).find((c) => c.id === conv.canal_id);
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

        <AnalizarBoton conversationId={conv.id} yaAnalizada={conv.analizada_at !== null} />
      </div>

      <div className="sd-fila-3">
        <section className="tarjeta" style={{ background: "var(--page)" }}>
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Hilo</h2>

          <div className="sd-hilo">
            {mensajes.map((m) => (
              <Burbuja key={m.id} m={m} />
            ))}
          </div>
        </section>

        <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <section className="tarjeta">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 className="titulo-tarjeta">Pedido</h2>
              <Pastilla estado={conv.cerrado_por} />
            </div>

            <dl style={{ display: "grid", gap: 9, fontSize: 12.5 }}>
              <Dato etiqueta="Producto" valor={conv.producto_vendido ?? "—"} />
              <Dato etiqueta="Total" valor={dinero(conv.total)} />
              <Dato etiqueta="Envío" valor={dinero(conv.envio)} />
              <Dato etiqueta="Del anuncio" valor={conv.producto_anuncio ?? "—"} />
              <Dato etiqueta="Primer mensaje" valor={fechaHora(conv.fecha_inicio)} />
              <Dato etiqueta="Cierre" valor={fechaHora(conv.fecha_cierre)} />
            </dl>

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

const CATEGORIAS: Record<string, string> = {
  factura: "factura",
  comprobante_pago: "comprobante de pago",
  foto_producto: "foto del producto",
  otro: "otro",
};

function Burbuja({ m }: { m: Mensaje }) {
  const clase =
    m.emisor === "cliente" ? "sd-burbuja-cliente" : m.emisor === "ia" ? "sd-burbuja-ia" : "sd-burbuja-humano";

  /*
   * Las imágenes se muestran como una fila con su descripción y categoría.
   * Nunca la foto: el archivo no se almacena en ningún momento.
   */
  if (m.tipo !== "texto") {
    return (
      <div className={`sd-burbuja ${clase}`} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          style={{ flexShrink: 0, marginTop: 2, opacity: 0.75 }} aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <circle cx="8.5" cy="10" r="1.6" />
          <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
        </svg>
        <span>
          {m.descripcion_imagen ?? m.content}
          {m.categoria_imagen && (
            <span style={{ display: "block", fontSize: 11, opacity: 0.8, marginTop: 2 }}>
              {CATEGORIAS[m.categoria_imagen] ?? m.categoria_imagen}
            </span>
          )}
        </span>
      </div>
    );
  }

  return <div className={`sd-burbuja ${clase}`}>{m.content}</div>;
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
