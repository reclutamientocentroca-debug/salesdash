/**
 * Conectar una página: el paso final de los DOS caminos.
 *
 * Da igual si el token vino de la ventana de Facebook o si el dueño lo pegó a
 * mano: a partir de aquí es lo mismo, y por eso está en un solo sitio. Cuando
 * esto vivía dentro de la ruta, el camino nuevo tenía que copiarlo, y una copia
 * es una comprobación que un día se olvida en una de las dos.
 */
import { cifrar, secretoAleatorio } from "@/lib/auth";
import { contarPaginasMeta, crearPaginaMeta, obtenerCanal } from "@/lib/db";
import { datosDePagina, suscribirInstagram, suscribirPagina } from "./paginas";

/** Mismo tope que los números: el panel se diseñó para veinte canales. */
export const MAX_PAGINAS = 20;

export type ResultadoConexion =
  | { ok: true; id: number; nombre: string; igUserId: string | null; aviso?: string }
  | { ok: false; estado: number; error: string };

export async function conectarPagina(
  orgId: number,
  pageId: string,
  token: string,
): Promise<ResultadoConexion> {
  if (contarPaginasMeta(orgId) >= MAX_PAGINAS) {
    return { ok: false, estado: 400, error: `El panel admite hasta ${MAX_PAGINAS} páginas conectadas.` };
  }

  /*
   * Se comprueba el token contra Meta ANTES de guardar nada.
   *
   * Guardar primero y validar después deja páginas «conectadas» que no reciben
   * ni un mensaje, y el dueño no tiene forma de saber por qué: en el panel se
   * ven igual que las que funcionan.
   */
  let nombre: string;
  let igUserId: string | null;

  try {
    const datos = await datosDePagina(pageId, token);
    nombre = datos.nombre;
    igUserId = datos.igUserId;
  } catch (e) {
    return {
      ok: false,
      estado: 400,
      error: `Meta rechazó el token: ${e instanceof Error ? e.message : "error desconocido"}`,
    };
  }

  let canalId: number;
  try {
    canalId = crearPaginaMeta(orgId, {
      pageId,
      nombre,
      tokenCifrado: cifrar(token),
      // Meta firma con el secreto de la app, no con uno por canal. La columna
      // es NOT NULL y se rellena para no dejarla vacía, pero no se usa.
      webhookSecret: secretoAleatorio(),
      igUserId,
    });
  } catch {
    return { ok: false, estado: 409, error: "Esa página ya está conectada en esta cuenta." };
  }

  /*
   * SUSCRIBIR LA PÁGINA NO ES OPCIONAL.
   *
   * Dar de alta el webhook en la app de Meta no basta: cada página tiene que
   * suscribirse aparte, y sin eso la página queda conectada y NO llega ni un
   * mensaje. Es la causa número uno de «lo configuré todo y no pasa nada».
   *
   * Si falla, la página se queda guardada pero avisada: es un problema de
   * permisos que se arregla en Meta, y borrar la fila obligaría a repetir todo.
   */
  const canal = obtenerCanal(orgId, canalId);

  try {
    if (canal) await suscribirPagina(canal);
  } catch (e) {
    return {
      ok: true,
      id: canalId,
      nombre,
      igUserId,
      aviso:
        `La página se guardó, pero Meta no aceptó suscribirla a los eventos: ` +
        `${e instanceof Error ? e.message : "error desconocido"}. ` +
        `Revisa que el acceso incluya pages_messaging y pages_manage_metadata.`,
    };
  }

  /*
   * SI LA PÁGINA TIENE INSTAGRAM, SE SUSCRIBE APARTE.
   *
   * No es opcional por las mismas razones que la página: sin esto, la cuenta
   * de Instagram queda enlazada en el panel y no llega ni un directo ni un
   * comentario. Si falla, no se deshace la conexión de la página —Messenger ya
   * quedó funcionando— pero se avisa, porque es el mismo problema que «lo
   * conecté y no llega nada», solo que en Instagram.
   */
  if (canal && igUserId) {
    try {
      await suscribirInstagram(canal);
    } catch (e) {
      return {
        ok: true,
        id: canalId,
        nombre,
        igUserId,
        aviso:
          `La página se conectó, pero Meta no aceptó suscribir su cuenta de Instagram: ` +
          `${e instanceof Error ? e.message : "error desconocido"}. ` +
          `Revisa que el acceso incluya instagram_manage_messages e instagram_manage_comments.`,
      };
    }
  }

  return { ok: true, id: canalId, nombre, igUserId };
}
