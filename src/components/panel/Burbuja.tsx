import type { Mensaje } from "@/lib/db";
import { urlServida } from "@/lib/media";

/**
 * Una burbuja del hilo.
 *
 * Vivía dentro de la ficha de la conversación. Salió de ahí cuando la bandeja
 * pasó a enseñar el hilo también: dos copias del mismo dibujo acaban
 * divergiendo, y el color de quién dijo qué es justo lo que no puede diferir
 * entre dos pantallas.
 *
 * Cliente a la izquierda; IA y vendedor a la derecha, con colores distintos.
 * Que la IA y el humano se distingan por color y no por una etiqueta es el
 * punto entero del producto: los dos salen del mismo número.
 */

const CATEGORIAS: Record<string, string> = {
  factura: "factura",
  comprobante_pago: "comprobante de pago",
  foto_producto: "foto del producto",
  otro: "otro",
};

export function Burbuja({ m }: { m: Mensaje }) {
  const clase =
    m.emisor === "cliente" ? "sd-burbuja-cliente" : m.emisor === "ia" ? "sd-burbuja-ia" : "sd-burbuja-humano";

  const archivo = urlServida(m.media_url);

  /*
   * Una nota de voz se escucha. Antes solo se veía «[nota de voz]», que en una
   * conversación de venta es un agujero: media negociación puede ir hablada.
   * Debajo va su transcripción, que es lo mismo que lee la IA — si difieren,
   * se ve al instante.
   */
  if (m.tipo === "audio" && archivo) {
    return (
      <div className={`sd-burbuja ${clase}`} style={{ maxWidth: "82%" }}>
        {/* `preload="none"`: en un hilo de treinta audios, precargarlos todos
            son treinta descargas para escuchar quizá uno. */}
        <audio controls preload="none" src={archivo} style={{ width: "100%", maxWidth: 260 }} />
        {m.transcripcion && (
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9, fontStyle: "italic" }}>
            {m.transcripcion}
          </div>
        )}
      </div>
    );
  }

  /*
   * La foto se ve. Se guarda en el volumen y se sirve por una ruta que exige
   * sesión, nunca por una URL pública. Debajo, lo que el modelo entendió de
   * ella: es lo que decide si esa imagen cuenta como cierre.
   */
  if (m.tipo === "imagen" && archivo) {
    return (
      <div className={`sd-burbuja ${clase}`} style={{ maxWidth: "82%" }}>
        {/* Sin next/image: la ruta exige sesión y su optimizador no la lleva. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={archivo}
          alt={m.descripcion_imagen ?? "Imagen enviada en la conversación"}
          style={{ display: "block", maxWidth: "100%", borderRadius: 8, marginBottom: 6 }}
        />
        {m.descripcion_imagen && (
          <div style={{ fontSize: 11.5, opacity: 0.85 }}>
            {m.descripcion_imagen}
            {m.categoria_imagen && ` · ${CATEGORIAS[m.categoria_imagen] ?? m.categoria_imagen}`}
          </div>
        )}
      </div>
    );
  }

  /*
   * Lo que no se pudo descargar —o no se descarga a propósito, como los
   * documentos— se sigue enseñando como una fila con su descripción.
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
