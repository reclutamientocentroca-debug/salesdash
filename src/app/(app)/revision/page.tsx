import BandejaRevision, { type FilaRevision } from "@/components/panel/BandejaRevision";
import { listarCanales, listarConversaciones, ultimosMensajes } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Revisión · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaRevision() {
  const ctx = await requerirSesion();
  const nombres = new Map(listarCanales(ctx.orgId).map((c) => [c.id, c.nombre]));

  // Sin filtro de fechas: lo pendiente de revisar hay que resolverlo sea de
  // cuando sea, o se queda fuera del conteo para siempre.
  const filas: FilaRevision[] = listarConversaciones(ctx.orgId, { estado: "revision", limite: 100 }).map((c) => {
    const ultimo = ultimosMensajes(ctx.orgId, c.id, 1)[0];
    return {
      id: c.id,
      cliente: c.cliente_nombre ?? "Sin nombre",
      telefono: c.cliente_phone,
      canal: nombres.get(c.canal_id) ?? "—",
      justificacion: c.justificacion,
      ultimoMensaje: (ultimo?.content ?? "").slice(0, 140) || "sin mensajes",
      fecha: c.last_message_at,
    };
  });

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Bandeja de revisión</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            {filas.length === 0
              ? "Todo clasificado"
              : `${filas.length} conversación${filas.length === 1 ? "" : "es"} que el analista no pudo decidir`}
          </p>
        </div>
      </div>

      <BandejaRevision filas={filas} />
    </>
  );
}
