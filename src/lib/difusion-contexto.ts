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

/**
 * LA DIFUSIÓN VIGENTE: la última campaña a la que responde el cliente.
 *
 * Gemela de `anuncioVigente` (`anuncio.ts`): `campana_id`/`producto_difusion`
 * guardan la campaña que abrió el lead, para siempre —la atribución, para no
 * falsear a qué campaña se le acredita la respuesta—; un cliente que ya tenía
 * conversación y responde a una campaña MÁS NUEVA pregunta por otro producto,
 * y venderle el de la primera vez es venderle otra cosa.
 *
 * SIN «o, si no hay, las de siempre»: a diferencia del anuncio, aquí SÍ hace
 * falta poder apagar la difusión vigente sin resucitar una vieja —cuando llega
 * un anuncio de verdad, que es una señal más fresca, `getOrCreateConversation`
 * limpia `difusion_actual_*` a propósito—, y un `||` con las columnas de
 * atribución habría vuelto a leer esa campaña vieja. `difusion_actual_*` se
 * inicializa siempre igual que la atribución —al crear la fila y en la
 * migración que las trajo—, así que no hace falta ese respaldo: si está en
 * blanco es porque algo más fresco la apagó, no porque nunca se haya llenado.
 */
export function difusionVigente(
  c: {
    difusion_actual_campana_id?: number | null;
    difusion_actual_producto?: string | null;
    difusion_actual_precio?: number | null;
  },
): DatosDifusion {
  return {
    campana_id: c.difusion_actual_campana_id ?? null,
    producto_difusion: c.difusion_actual_producto?.trim() || null,
    precio_difusion: c.difusion_actual_precio ?? null,
  };
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
