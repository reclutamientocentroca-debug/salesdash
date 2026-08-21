/**
 * Identificadores de chat de WhatsApp.
 *
 * Vivían en `whapi.ts`. Salieron de ahí porque no tienen nada que ver con un
 * proveedor: el formato `<número>@s.whatsapp.net` es de WhatsApp, y lo hablan
 * igual Whapi, Baileys o cualquier otro. Ahora `ingesta.ts` puede usarlos sin
 * arrastrar un módulo de integración entero.
 */

/**
 * `18095550000@s.whatsapp.net` → `18095550000`. Solo dígitos.
 *
 * Sirve también para los identificadores nuevos de WhatsApp (`@lid`), que
 * llevan el número en la misma posición.
 */
export function normalizarTelefono(bruto: string): string {
  return (bruto.split("@")[0] ?? "").replace(/\D/g, "");
}

/** Los grupos no se miden: no son conversaciones de venta uno a uno. */
export function esGrupo(chatId: string): boolean {
  return chatId.endsWith("@g.us");
}

/** El número al que se le escribe, en el formato que espera WhatsApp. */
export function jidDeTelefono(telefono: string): string {
  return `${telefono.replace(/\D/g, "")}@s.whatsapp.net`;
}
