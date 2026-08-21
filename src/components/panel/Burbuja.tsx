import type { Mensaje } from "@/lib/db";

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
