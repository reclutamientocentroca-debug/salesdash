/**
 * SalesDash — lo que WhatsApp manda y NO es un mensaje del cliente.
 *
 * Un «protocolMessage» es un aviso interno —un borrado, una sincronización
 * de claves, una edición—; un «senderKeyDistributionMessage» es criptografía;
 * una «reactionMessage» es un pulgar arriba. Entraban al hilo como si el
 * cliente hubiera escrito «[protocolMessage]» y el agente les contestaba
 * «parece que no mandó ningún mensaje»: un chat abierto con un saludo a la
 * nada, y encima lo contaba como conversación.
 *
 * Se reconocen por su clave y no entran. Y los que ya entraron antes de esto
 * se reconocen por su texto, para que el agente no los conteste.
 */

/** Las claves de Baileys que no son un mensaje de una persona. */
export const CLAVES_DE_SISTEMA = new Set([
  "protocolMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "reactionMessage",
  "pollUpdateMessage",
  "keepInChatMessage",
  "encReactionMessage",
  "deviceSentMessage",
  "callLogMesssage",
  "callLogMessage",
  "pinInChatMessage",
  "placeholderMessage",
  "peerDataOperationRequestMessage",
  "peerDataOperationRequestResponseMessage",
  "botInvokeMessage",
  "bcallMessage",
  "secretEncryptedMessage",
]);

/** ¿Esta clave de mensaje es de sistema? */
export function esClaveDeSistema(clave: string | undefined | null): boolean {
  return !!clave && CLAVES_DE_SISTEMA.has(clave);
}

/**
 * ¿Este contenido guardado es un mensaje de sistema? Es el texto con el que
 * entraban antes: la clave entre corchetes y nada más.
 */
export function esMensajeDeSistema(contenido: string | null | undefined): boolean {
  const t = contenido?.trim() ?? "";
  const m = t.match(/^\[([A-Za-z]+)\]$/);
  return !!m && esClaveDeSistema(m[1]);
}
