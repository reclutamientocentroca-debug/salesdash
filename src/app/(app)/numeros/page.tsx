import ListaNumeros from "@/components/panel/ListaNumeros";
import { listarCanales, listarPaginasMeta } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Números · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaNumeros() {
  const ctx = await requerirSesion();

  /*
   * Ya no hay token que enmascarar. Al conectar por QR la credencial es la
   * vinculación del teléfono y vive como archivos de sesión en el disco del
   * servidor: no es un texto que se pueda enseñar, copiar ni revelar. Esa
   * pantalla desapareció con el proveedor, y con ella el riesgo de filtrar un
   * token por la interfaz.
   */
  /*
   * SOLO LOS WHATSAPP. Una página de Facebook es un canal más para el resto del
   * panel, pero aquí no pinta nada: no tiene QR que escanear, ni historial que
   * pedirle al teléfono, ni sesión que reconectar. Se conecta y se enciende en
   * Messenger, que es donde vive.
   */
  const canales = listarCanales(ctx.orgId)
    .filter((c) => c.tipo !== "meta")
    .map((c) => ({
    id: c.id,
    nombre: c.nombre,
    phone: c.phone.startsWith("pendiente:") ? null : c.phone,
    estado: c.estado,
    agente_activo: c.agente_activo === 1,
    contesta_ia: c.contesta_ia === 1,
    activo: c.activo === 1,
    ultimo_evento_at: c.ultimo_evento_at,
  }));

  /*
   * CONECTAR WHATSAPP CON FACEBOOK. Los anuncios que traen clientes a estos
   * números son anuncios de Facebook, y el texto y la foto de cada anuncio
   * —de donde la IA saca el producto, el precio y los colores— se leen con la
   * página de Facebook conectada. Sin ella, la IA solo ve el título del
   * anuncio. El botón lleva a la misma ventana de Meta que usa Messenger; el
   * valor de la app no se enseña, solo si está puesta.
   */
  const facebook = {
    disponible: (process.env.META_APP_ID ?? "").trim() !== "",
    paginas: listarPaginasMeta(ctx.orgId).length,
  };

  return <ListaNumeros canales={canales} facebook={facebook} />;
}
