"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { leerImporte } from "@/lib/moneda";
import type { FichaDeLaFoto } from "@/lib/meta/contexto-anuncio";

/**
 * QUÉ ES Y CUÁNTO VALE LO QUE SALE EN LA FOTO.
 *
 * LA CAPTURA DE LA DUEÑA (2026-09-08): un anuncio de Facebook que es solo una
 * imagen —unos jeans, con «RD$1,400» escrito encima de la foto—. El agente no
 * sabía cómo se llamaba eso ni cuánto costaba, así que le ofreció al cliente
 * otro artículo del catálogo: «no tenemos pantalones, pero le ofrezco los
 * polos». El cliente pedía tres pantalones y se fue con un «yo le aviso».
 *
 * Lo que hace el agente ahora es transferir. Y esta es la casilla donde la
 * persona que entra escribe las dos cosas que faltaban, sin salir del chat: el
 * nombre y el monto. Van al catálogo —que es de donde sale el precio, nunca del
 * modelo— y quedan pegadas al anuncio, así que sirven para este cliente y para
 * todos los que lleguen después por esa misma foto.
 *
 * Guardar el dato y devolverle el hilo a la IA son dos cosas distintas: aquí
 * solo se guarda el dato. Quién sigue contestando lo decide quien atiende, con
 * el botón de siempre.
 */
export default function ProductoDeLaFoto({
  conversationId,
  foto,
  onGuardado,
}: {
  conversationId: number;
  foto: FichaDeLaFoto | null;
  /** La bandeja de Meta recarga el hilo a su manera; el hilo del panel, no. */
  onGuardado?: () => void;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(foto?.nombre ?? "");
  const [monto, setMonto] = useState(foto?.precio !== null && foto?.precio !== undefined ? String(foto.precio) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);

  // Sin foto que nombrar —ni anuncio ni imagen del cliente— no hay nada que
  // preguntar aquí, y una casilla de más en una bandeja es ruido.
  if (!foto) return null;

  async function guardar() {
    const cifra = leerImporte(monto);
    if (!nombre.trim() || cifra === null || !Number.isFinite(cifra) || cifra <= 0) {
      setError("Escribe cómo se llama y cuánto vale.");
      return;
    }

    setGuardando(true);
    setError(null);
    setGuardado(null);

    const r = await fetch(`/api/conversations/${conversationId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre: nombre.trim(), monto: cifra }),
    });
    const datos = await r.json().catch(() => ({}));
    setGuardando(false);

    if (!r.ok) {
      setError(datos.error ?? "No se pudo guardar.");
      return;
    }

    setGuardado(
      datos.destino === "anuncio"
        ? "Guardado. La IA ya vende esto, y también a los próximos que lleguen por este anuncio."
        : "Guardado. La IA ya se lo vende a este cliente, y el anuncio se queda como estaba.",
    );
    if (onGuardado) onGuardado();
    else router.refresh();
  }

  const yaTiene = foto.nombre !== null && foto.precio !== null;
  const delChat = foto.destino === "chat";

  /*
   * DE QUÉ FOTO SE ESTÁ HABLANDO. No es lo mismo la del anuncio —que valdrá
   * para todos los que lleguen por él— que la que el cliente mandó a mitad de
   * la conversación preguntando por otra cosa, que es suya y de nadie más.
   * Quien atiende tiene que verlo antes de escribir, no después de guardar.
   */
  return (
    <div style={{ display: "grid", gap: 9 }}>
      <p className="tenue" style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
        {yaTiene
          ? delChat
            ? "Es lo que la IA le vende a ESTE cliente por la foto que mandó. El anuncio no se toca."
            : "Es lo que la IA vende en este chat. Cámbialo y se cambia también para los que lleguen por este anuncio."
          : delChat
            ? "El cliente mandó una foto preguntando por otra cosa, y la IA no sabe qué es ni cuánto vale: por eso transfiere. Escríbelo y se lo vende a él; el anuncio se queda como está."
            : "Este cliente llegó por una foto, y de esa foto no hay nombre ni precio: por eso la IA transfiere en vez de cotizar. Escríbelos y vende con eso."}
      </p>

      {/* Lo que la máquina vio en esa foto: es lo único que hay para saber
          qué se está nombrando sin abrir el chat y buscarla. */}
      {foto.descripcion && (
        <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)", margin: 0 }}>
          <strong>En la foto se ve:</strong> {foto.descripcion}
        </p>
      )}

      <label style={{ display: "grid", gap: 4 }}>
        <span className="tenue" style={{ fontSize: 11.5 }}>Cómo se llama</span>
        <input
          className="campo"
          value={nombre}
          maxLength={120}
          placeholder={delChat ? "Botas de cuero" : "Pantalones jeans"}
          disabled={guardando}
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span className="tenue" style={{ fontSize: 11.5 }}>Cuánto vale (solo el número)</span>
        <input
          className="campo num"
          inputMode="decimal"
          value={monto}
          placeholder="1400"
          disabled={guardando}
          onChange={(e) => setMonto(e.target.value)}
        />
      </label>

      <button
        type="button"
        className="btn btn-acento"
        disabled={guardando || !nombre.trim() || !monto.trim()}
        onClick={() => void guardar()}
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>

      {guardado && (
        <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)", margin: 0 }}>
          {guardado} Si quieres que siga ella, pulsa «Contesta la IA».
        </p>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "var(--red)", margin: 0 }}>{error}</p>
      )}
    </div>
  );
}

