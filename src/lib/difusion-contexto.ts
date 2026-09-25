/**
 * SalesDash — el contexto de campaña para el modelo, cuando el cliente
 * responde a una difusión.
 *
 * Gemela deliberada de `anuncioParaModelo` (`anuncio.ts`), con la misma
 * disciplina: el precio es el que quedó guardado con la campaña, nunca se
 * inventa. Separada a propósito de `anuncioParaModelo` — no se reusa el
 * mecanismo de anuncio tal cual — porque `deAnuncio()` alimenta las métricas
 * de publicidad pagada (Meta Ads) y mezclar ahí un lead que vino de un
 * mensaje nuestro por WhatsApp falsearía cuánto rinde la publicidad. Ver la
 * nota de diseño en `db.ts`, junto a `deDifusion()`.
 */

export interface DatosDifusion {
  campana_id: number | null;
  producto_difusion: string | null;
  precio_difusion: number | null;
}

/** ¿Esta conversación nació de una campaña de difusión? */
export function llegoPorDifusion(c: DatosDifusion): boolean {
  return c.campana_id !== null || !!c.producto_difusion;
}

export function difusionParaModelo(c: DatosDifusion, simbolo: string | null = null): string | null {
  if (!llegoPorDifusion(c)) return null;

  const producto = c.producto_difusion?.trim();
  const precio = c.precio_difusion;

  const lineas = ["Este cliente llegó porque le mandamos un mensaje de una campaña de difusión:"];
  lineas.push(`- Producto ofrecido: ${producto || "(la campaña no tenía un producto puesto)"}`);
  if (precio !== null && precio !== undefined) {
    lineas.push(`- Precio que se le ofreció: ${simbolo ?? ""}${precio}`);
  }
  lineas.push(
    "El precio es EXACTAMENTE ese: no lo cambies ni lo redondees, y no le pongas otro nombre al artículo. " +
      "Si te pregunta por otro artículo que no es este, no lo vendes ni le pones precio: transfieres como dice el guion.",
  );
  if (!precio) {
    lineas.push(
      "No hay precio guardado para este producto: no te lo inventes. Dile que un representante se lo confirma y transfiere.",
    );
  }
  lineas.push("Nunca menciones la palabra «difusión» ni «campaña» al cliente: para él, esto es una conversación normal.");

  return lineas.join("\n");
}
