"use client";

import { useState, type ReactNode } from "react";

/**
 * Bandeja y Anuncios, en la misma pantalla.
 *
 * Son dos ritmos distintos del mismo canal: la bandeja se mira cada rato y los
 * anuncios se tocan una vez por campaña. Apilarlas obligaría a bajar media
 * pantalla para llegar a lo que se usa a diario; separarlas en dos páginas
 * partiría Meta en dos sitios del menú.
 *
 * Los contadores van en la propia pestaña porque son la razón de entrar: lo que
 * lleva a mirar la bandeja es que haya algo sin responder.
 */
export default function PestanasMeta({
  sinResponder,
  sinVincular,
  bandeja,
  anuncios,
}: {
  sinResponder: number;
  sinVincular: number;
  bandeja: ReactNode;
  anuncios: ReactNode;
}) {
  const [cual, setCual] = useState<"bandeja" | "anuncios">("bandeja");

  return (
    <>
      <div className="sd-pestanas" role="tablist">
        <button
          type="button"
          role="tab"
          className="sd-pestana"
          aria-selected={cual === "bandeja"}
          onClick={() => setCual("bandeja")}
        >
          Bandeja
          {sinResponder > 0 && (
            <span className="sd-cuenta sd-cuenta-viva">
              {sinResponder} sin responder
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          className="sd-pestana"
          aria-selected={cual === "anuncios"}
          onClick={() => setCual("anuncios")}
        >
          Anuncios
          {sinVincular > 0 && <span className="sd-cuenta">{sinVincular} sin vincular</span>}
        </button>
      </div>

      {/*
        Los dos paneles se montan y uno se oculta, en vez de desmontarse: la
        bandeja tiene dentro la conversación abierta y su scroll, y volver de
        Anuncios no puede devolverte al principio de la lista.
      */}
      <div role="tabpanel" hidden={cual !== "bandeja"}>{bandeja}</div>
      <div role="tabpanel" hidden={cual !== "anuncios"}>{anuncios}</div>
    </>
  );
}
