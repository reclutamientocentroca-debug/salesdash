/**
 * LOS TRES AGENTES DE PAÍS, por el código ISO que lleva el canal.
 *
 * Un canal tiene UN país (`agentes.pais`, que se deduce del prefijo del
 * número) y ese país tiene UN archivo aquí. Es lo único que une un número con
 * un agente, y por eso un agente nunca puede leer los datos de otro país: la
 * función de abajo devuelve un solo archivo o ninguno, nunca dos.
 *
 * Añadir un país es añadir un archivo y una línea aquí.
 */
import type { DatosPais } from "../tipos";
import { RD } from "./rd";
import { CR } from "./cr";
import { PA } from "./pa";

export const AGENTES_DE_PAIS: Readonly<Record<string, DatosPais>> = Object.freeze({
  do: RD,
  cr: CR,
  pa: PA,
});

/** El agente del país de un canal, o null si ese país no tiene archivo. */
export function agenteDePais(codigo: string | null | undefined): DatosPais | null {
  if (!codigo) return null;
  return AGENTES_DE_PAIS[codigo.toLowerCase()] ?? null;
}
