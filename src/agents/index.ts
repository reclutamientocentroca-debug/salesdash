/**
 * SalesDash — los agentes de venta por país.
 *
 * Un solo comportamiento (`base-comportamiento.ts`) más un archivo de datos
 * por país (`paises/`). El prompt de un canal se arma en tiempo de ejecución
 * en `armarSistema` (lib/agent.ts) con la base y UN archivo de país: el del
 * país del canal. Ver `tipos.ts` para qué va en cada sitio.
 */
export { agenteDePais, AGENTES_DE_PAIS } from "./paises";
export { baseComportamiento, bloqueCliente, TALLAS_BASE, tablaDeTallas } from "./base-comportamiento";
export { bloqueDelPais, importe, lineasDelResumen, saludoDe, zonaDelCliente } from "./armar";
export type { DatosPais, ZonaDeEnvio } from "./tipos";

/**
 * ¿Esto es el guion viejo, pegado en las instrucciones del panel?
 *
 * Antes el guion de venta entero vivía en el cuadro «Instrucciones» de cada
 * número, copiado de una plantilla. Ahora vive en el código, y un número que
 * todavía tenga pegado el viejo mandaría al modelo DOS guiones a la vez, con
 * reglas que se contradicen. Se reconoce por los rótulos del molde que llevaban
 * todas sus versiones, y cuando se reconoce no entra en el prompt: el panel
 * avisa para que se borre.
 */
export function esGuionRetirado(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return /=== (COMO SE VEN EL RESUMEN Y LA ORDEN|EL RITMO DEL CIERRE|COMO ESCRIBES) ===/.test(texto);
}
