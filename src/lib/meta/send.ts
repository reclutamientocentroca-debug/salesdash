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
import { ErrorMeta, postGraph, postGraphMultipart } from "./graph";

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
 * LA FOTO DEL ANUNCIO, DE VUELTA AL CLIENTE QUE LA PIDE.
 *
 * «¿Me manda una foto?» es de las preguntas más frecuentes que hay y hasta
 * ahora no se podía contestar: el agente escribía, y solo escribía. Decirle a
 * alguien que acaba de pinchar la foto de un producto que no puedes enseñársela
 * es raro y cuesta la venta.
 *
 * DOS CAMINOS, Y EL PRIMERO ES EL QUE SE USA CASI SIEMPRE. Si Meta ya tiene la
 * imagen —porque se la subimos la primera vez que alguien la pidió— basta con
 * su `attachment_id`: no viajan bytes y la respuesta es inmediata. Solo la
 * primera vez se sube el archivo, con `is_reusable`, y Meta devuelve ese
 * identificador para que no haya una segunda. Un anuncio que funciona trae
 * cientos de clientes y la foto es la misma para todos.
 *
 * Devuelve también el identificador cuando acaba de subirla, para que quien
 * llama lo guarde. Ver `guardarAdjuntoAnuncio`.
 */
export async function enviarImagenMeta(
  canal: Canal,
  destinatarioId: string,
  imagen:
    | { attachmentId: string }
    | { datos: Buffer; mime: string },
): Promise<{ messageId: string; attachmentId: string | null }> {
  const recipient = JSON.stringify({ id: destinatarioId });

  if ("attachmentId" in imagen) {
    const datos = await postGraph(canal, `${canal.phone}/messages`, {
      recipient: { id: destinatarioId },
      messaging_type: "RESPONSE",
      message: {
        attachment: { type: "image", payload: { attachment_id: imagen.attachmentId } },
      },
    });

    const id = typeof datos.message_id === "string" ? datos.message_id : "";
    if (!id) throw new ErrorMeta("Meta aceptó la imagen pero no devolvió su identificador");
    return { messageId: id, attachmentId: null };
  }

  const datos = await postGraphMultipart(
    canal,
    `${canal.phone}/messages`,
    {
      recipient,
      messaging_type: "RESPONSE",
      /* `is_reusable` es lo que hace que esta subida sea la única. */
      message: JSON.stringify({
        attachment: { type: "image", payload: { is_reusable: true } },
      }),
    },
    { nombre: "anuncio.jpg", mime: imagen.mime, datos: imagen.datos },
  );

  const id = typeof datos.message_id === "string" ? datos.message_id : "";
  if (!id) throw new ErrorMeta("Meta aceptó la imagen pero no devolvió su identificador");

  return {
    messageId: id,
    attachmentId: typeof datos.attachment_id === "string" ? datos.attachment_id : null,
  };
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
