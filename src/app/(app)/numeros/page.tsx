import ListaNumeros from "@/components/panel/ListaNumeros";
import { listarCanales } from "@/lib/db";
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

  return <ListaNumeros canales={canales} />;
}
