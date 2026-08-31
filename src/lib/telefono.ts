/**
 * Identificadores de chat de WhatsApp.
 *
 * Vivían en `whapi.ts`. Salieron de ahí porque no tienen nada que ver con un
 * proveedor: el formato `<número>@s.whatsapp.net` es de WhatsApp, y lo hablan
 * igual Whapi, Baileys o cualquier otro. Ahora `ingesta.ts` puede usarlos sin
 * arrastrar un módulo de integración entero.
 *
 * ═══ DOS DIRECCIONES PARA LA MISMA PERSONA ═══
 *
 * WhatsApp ya no identifica a todo el mundo por su teléfono. Desde el cambio a
 * LID, un mismo cliente puede llegar como `18095550000@s.whatsapp.net` —su
 * número— o como `123456789012345@lid`, un identificador interno que NO es un
 * teléfono y que no se le parece más que en que también son dígitos.
 *
 * Aquí se creía lo contrario: que el LID «lleva el número en la misma
 * posición». No lo lleva. Al contestar se armaba `<lid>@s.whatsapp.net`, una
 * dirección que no es de nadie: WhatsApp aceptaba el envío y devolvía su
 * identificador —así que el panel guardaba la respuesta y la enseñaba en el
 * hilo— y el cliente no recibía nada.
 *
 * Por eso ahora se guarda la dirección EXACTA a la que hay que contestar, y se
 * escribe a esa, en vez de reconstruirla a partir de unos dígitos.
 */

/**
 * `18095550000@s.whatsapp.net` → `18095550000`. Solo dígitos.
 *
 * Con un `@lid` devuelve el identificador interno, que no es un teléfono. Es lo
 * mejor que hay cuando WhatsApp no manda el número, y sirve igual para lo que
 * esta clave hace —distinguir un hilo de otro—, pero NO para escribirle: para
 * eso está `cliente_jid`, que guarda la dirección tal cual llegó.
 */
export function normalizarTelefono(bruto: string): string {
  return (bruto.split("@")[0] ?? "").replace(/\D/g, "");
}

/** Los grupos no se miden: no son conversaciones de venta uno a uno. */
export function esGrupo(chatId: string): boolean {
  return chatId.endsWith("@g.us");
}

/** Un identificador interno de WhatsApp, no un teléfono. */
export function esLid(jid: string): boolean {
  return jid.endsWith("@lid");
}

/** El número al que se le escribe, en el formato que espera WhatsApp. */
export function jidDeTelefono(telefono: string): string {
  return `${telefono.replace(/\D/g, "")}@s.whatsapp.net`;
}

/**
 * La dirección a la que se envía.
 *
 * Acepta las dos cosas que hay guardadas: una dirección completa —`…@lid` o
 * `…@s.whatsapp.net`, que se usa tal cual— o unos dígitos sueltos, de las
 * conversaciones anteriores a que se guardara la dirección, que se convierten
 * en la dirección de toda la vida.
 */
export function jidDeDestino(destino: string): string {
  return destino.includes("@") ? destino : jidDeTelefono(destino);
}

/**
 * De las dos direcciones que trae un mensaje, la buena para contestar.
 *
 * Baileys manda la del chat y, cuando existe, su equivalente en el otro
 * formato (`remoteJidAlt`). Se prefiere SIEMPRE la del teléfono: es la que
 * también entiende un vendedor mirando el panel, la que se puede enseñar como
 * «+1 809…» y la que hace que el mismo cliente no abra dos hilos según por
 * dónde llegara. Si solo hay LID, se contesta al LID, que es donde está.
 */
export function direccionDelChat(jid: string, alterno?: string | null): string {
  if (!esLid(jid)) return jid;
  return alterno && !esLid(alterno) ? alterno : jid;
}
