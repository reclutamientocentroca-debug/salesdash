import ListaNumeros from "@/components/panel/ListaNumeros";
import { descifrar, enmascarar } from "@/lib/auth";
import { listarCanales } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Números · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaNumeros() {
  const ctx = await requerirSesion();

  // El token nunca sale en claro de aquí: solo su versión enmascarada.
  const canales = listarCanales(ctx.orgId).map((c) => {
    let token = "";
    try {
      token = descifrar(c.token_cifrado);
    } catch {
      // SESSION_SECRET cambió; el canal se muestra igual para poder rehacerlo.
    }

    return {
      id: c.id,
      nombre: c.nombre,
      phone: c.phone.startsWith("pendiente:") ? null : c.phone,
      estado: c.estado,
      agente_activo: c.agente_activo === 1,
      activo: c.activo === 1,
      ultimo_evento_at: c.ultimo_evento_at,
      token_enmascarado: enmascarar(token),
    };
  });

  return <ListaNumeros canales={canales} />;
}
