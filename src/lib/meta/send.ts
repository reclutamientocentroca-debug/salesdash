/**
 * TODO LO QUE LE ESCRIBE A UN CLIENTE POR META.
 *
 * Gemelo de `enviarTexto` en `wa.ts`, y sujeto a la MISMA regla: solo
 * `agent.ts` puede importar este módulo. Hay una prueba que barre `src/` y falla
 * si cualquier otro archivo lo nombra.
 *
 * La razón no es de estilo. Si dos módulos pueden escribirle al cliente, un día
 * dos le escriben a la vez y el cliente lee dos respuestas distintas de dos
 * vendedores que no se conocen entre sí. Eso no se arregla después: ya lo leyó.
 *
 * Lo que NO le escribe a nadie —leer el nombre de una página, suscribirla— está
 * en `paginas.ts`, y el transporte crudo en `graph.ts`. Esa separación es lo
 * que permite que el panel conecte páginas sin agujerear esta regla.
 */
import type { Canal } from "@/lib/db";
import { ErrorMeta, postGraph } from "./graph";

/**
 * Un mensaje directo, por Messenger o por Instagram.
 *
 * Devuelve el `message_id` de Meta, y ese identificador NO es decorativo: es el
 * que `agent.ts` registra como «esto lo mandó la IA». El eco de este mismo
 * mensaje volverá por el webhook con ese `mid`, y así se cuenta del lado
 * correcto en vez de como intervención humana.
 */
export async function enviarMensajeMeta(
  canal: Canal,
  destinatarioId: string,
  texto: string,
): Promise<string> {
  const datos = await postGraph(canal, `${canal.phone}/messages`, {
    recipient: { id: destinatarioId },
    messaging_type: "RESPONSE",
    message: { text: texto },
  });

  const id = typeof datos.message_id === "string" ? datos.message_id : "";
  if (!id) throw new ErrorMeta("Meta aceptó el mensaje pero no devolvió su identificador");
  return id;
}

/**
 * La respuesta a un comentario, colgada del propio comentario.
 *
 * Va al hilo público, que es donde preguntó el cliente. Llevarlo solo a un
 * privado deja la pregunta a la vista y sin respuesta, y el siguiente que la
 * lea se va.
 */
export async function responderComentarioMeta(
  canal: Canal,
  comentarioId: string,
  texto: string,
): Promise<string> {
  const datos = await postGraph(canal, `${comentarioId}/comments`, { message: texto });

  const id = typeof datos.id === "string" ? datos.id : "";
  if (!id) throw new ErrorMeta("Meta aceptó el comentario pero no devolvió su identificador");
  return id;
}
