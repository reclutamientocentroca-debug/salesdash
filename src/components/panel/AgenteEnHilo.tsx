"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Quién atiende ESTA conversación, y por qué el agente calla cuando calla.
 *
 * Dos cosas que faltaban en la misma tarjeta:
 *
 *  - EL INTERRUPTOR. Hasta ahora solo se podía decidir por número —el agente
 *    encendido para todos los clientes, o apagado para todos—. En una bandeja
 *    real hay clientes que el agente lleva solo hasta el cierre y clientes que
 *    un vendedor prefiere atender a mano, y eso se decide hilo a hilo.
 *
 *  - EL PORQUÉ. Un agente callado se ve exactamente igual que un agente roto.
 *    Quien abre una conversación y no entiende por qué nadie contestó no tiene
 *    dónde mirar; esto lo dice aquí, con las palabras del negocio.
 *
 * Los dos silencios permanentes —el cliente pidió una persona, o el agente pasó
 * el caso a un asesor— se deshacen con el mismo botón. Antes no se deshacían en
 * ningún sitio: ese hilo se quedaba sin agente para siempre.
 */
export interface EstadoAgente {
  callado: boolean;
  motivo: string | null;
  explicacion: string | null;
  reversible: boolean;
  aviso: string | null;
}

export default function AgenteEnHilo({
  conversationId,
  estado,
  atiende,
}: {
  conversationId: number;
  estado: EstadoAgente;
  atiende: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cambiar(accion: "devolver_a_la_ia" | "atiende_humano") {
    setOcupado(true);
    setError(null);

    const r = await fetch(`/api/conversations/${conversationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accion }),
    });
    const datos = await r.json().catch(() => ({}));
    setOcupado(false);

    if (!r.ok) {
      setError(datos.error ?? "No se pudo cambiar quién atiende esta conversación.");
      return;
    }

    /*
     * Devolver el hilo a la IA no garantiza que vaya a hablar: el número puede
     * estar apagado, puede ser de madrugada, puede haber escrito un vendedor
     * hace un minuto. Se dice AHORA, y no cuando el cliente se quede sin
     * respuesta.
     */
    if (accion === "devolver_a_la_ia" && datos.agente?.callado) {
      setError(datos.agente.explicacion ?? null);
    }
    router.refresh();
  }

  const enManosDeUnHumano = atiende === "humano";

  return (
    <div style={{ display: "grid", gap: 9 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className={`btn ${enManosDeUnHumano ? "btn-secundario" : "btn-acento"}`}
          style={{ flex: 1 }}
          disabled={ocupado || !enManosDeUnHumano}
          aria-pressed={!enManosDeUnHumano}
          onClick={() => cambiar("devolver_a_la_ia")}
        >
          Contesta la IA
        </button>

        <button
          type="button"
          className={`btn ${enManosDeUnHumano ? "btn-acento" : "btn-secundario"}`}
          style={{ flex: 1 }}
          disabled={ocupado || enManosDeUnHumano}
          aria-pressed={enManosDeUnHumano}
          onClick={() => cambiar("atiende_humano")}
        >
          Contesto yo
        </button>
      </div>

      {estado.callado ? (
        <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          <strong>El agente no contesta aquí.</strong> {estado.explicacion}
        </p>
      ) : (
        <p className="tenue" style={{ fontSize: 12.5 }}>
          El agente contesta en esta conversación hasta cerrar la venta.
        </p>
      )}

      {/* Callado por algo que este botón no arregla: el número apagado, la
          madrugada, un vendedor que acaba de escribir. Se dice, para que nadie
          pulse esperando otra cosa. */}
      {estado.callado && !estado.reversible && !enManosDeUnHumano && (
        <p className="tenue" style={{ fontSize: 12 }}>
          Esto no se cambia desde aquí: se arregla en Números o en Agente.
        </p>
      )}

      {estado.aviso && (
        <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--amber)" }}>{estado.aviso}</p>
      )}

      {error && (
        <p className="tenue" style={{ fontSize: 12, color: "var(--red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
