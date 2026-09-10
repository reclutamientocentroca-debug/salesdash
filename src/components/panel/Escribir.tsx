"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * DÓNDE SE LE ESCRIBE AL CLIENTE.
 *
 * El motor ya existía —`enviarAMano` en `agent.ts`, que es el único módulo del
 * proyecto autorizado a escribirle a nadie— y la bandeja de Messenger e
 * Instagram ya lo usaba. Lo que no había era una caja en la bandeja de
 * WhatsApp: se podía leer el hilo entero y no había forma de contestar sin
 * coger el teléfono. Esta es esa caja, y sirve para los dos sitios porque el
 * envío es el mismo para los dos canales.
 *
 * ═══ ESCRIBIR ES TOMAR EL CHAT, Y SE DICE ANTES ═══
 *
 * Mientras contesta la IA la caja no deja escribir: hace falta pulsar «Contesto
 * yo» primero, y por eso el botón está aquí dentro y no solo en la ficha. No es
 * un trámite: dos voces contestando al mismo cliente —una de ellas sin dormir—
 * es algo que el cliente ya leyó y que no se arregla después. Tomar el chat es
 * una decisión, y se toma a la vista.
 *
 * Al devolverlo, la IA sigue por donde iba: eso es el botón «Contesta la IA»
 * de la ficha del hilo.
 */
export default function Escribir({
  conversationId,
  atiende,
  esComentario = false,
}: {
  conversationId: number;
  /** Quién lleva este hilo ahora mismo: «ia» o «humano». */
  atiende: string;
  /** El hilo nació de un comentario público: la respuesta se cuelga de él. */
  esComentario?: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mio = atiende === "humano";

  async function tomarElChat() {
    setOcupado(true);
    setError(null);

    const r = await fetch(`/api/conversations/${conversationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "atiende_humano" }),
    });
    const datos = await r.json().catch(() => ({}));
    setOcupado(false);

    if (!r.ok) {
      setError(datos.error ?? "No se pudo tomar este chat.");
      return;
    }
    router.refresh();
  }

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio || ocupado) return;
    setOcupado(true);
    setError(null);

    try {
      const r = await fetch(`/api/conversations/${conversationId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: limpio }),
      });
      const datos = await r.json().catch(() => ({}));

      if (!r.ok) {
        /*
         * El error de WhatsApp o de Meta se enseña tal cual viene. Los que se
         * ven de verdad —la sesión caída, la ventana de 24 horas, el permiso
         * que falta— se arreglan de tres formas distintas, y un «no se pudo
         * enviar» genérico deja a quien lo lee sin saber cuál le tocó.
         */
        setError(datos.error ?? "No se pudo enviar el mensaje.");
        return;
      }

      setTexto("");
      router.refresh();
    } catch {
      setError("No se pudo hablar con el servidor.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="sd-redactar">
      <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
        <textarea
          rows={1}
          value={texto}
          disabled={!mio || ocupado}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía, Mayús+Enter hace párrafo. Es lo que ya hacen las
            // manos de quien atiende una bandeja todo el día.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder={
            mio
              ? esComentario
                ? "Tu respuesta se publica en el comentario…"
                : "Escribe tu mensaje…"
              : "Contesta la IA. Pulsa «Contesto yo» para escribirle tú."
          }
          aria-label="Tu mensaje para el cliente"
        />

        {mio ? (
          <button
            type="button"
            className="btn btn-acento"
            disabled={ocupado || !texto.trim()}
            onClick={() => void enviar()}
          >
            {ocupado ? "Enviando…" : "Enviar"}
          </button>
        ) : (
          <button type="button" className="btn btn-secundario" disabled={ocupado} onClick={() => void tomarElChat()}>
            Contesto yo
          </button>
        )}
      </div>

      {error ? (
        <p style={{ fontSize: 12, marginTop: 8, color: "var(--red)" }}>{error}</p>
      ) : (
        <p className="tenue" style={{ marginTop: 8 }}>
          {mio
            ? esComentario
              ? "Se publica colgado del comentario, a la vista de todos."
              : "Sale al WhatsApp del cliente a nombre de tu número. La IA no contesta en este chat."
            : "Al tomarlo, la IA se calla solo en este chat: sigue contestando a los demás."}
        </p>
      )}
    </div>
  );
}
