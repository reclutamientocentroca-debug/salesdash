import DifusionesPanel from "@/components/panel/difusiones/DifusionesPanel";
import { listarCampanas, listarCanales, listarCatalogo, listarExcluidos, listarListasDifusion, obtenerAgente } from "@/lib/db";
import { agenteDePais } from "@/agents";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Difusiones · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaDifusiones() {
  const ctx = await requerirSesion();
  const soyDueno = ctx.usuario.rol === "dueno";

  const canales = listarCanales(ctx.orgId)
    .filter((c) => ctx.canalesPermitidos === null || ctx.canalesPermitidos.includes(c.id))
    .map((c) => {
      const datos = agenteDePais(obtenerAgente(ctx.orgId, c.id).pais);
      return {
        id: c.id, nombre: c.nombre || c.phone, tipo: c.tipo,
        pais: datos?.nombre ?? null, moneda: datos?.moneda.simbolo ?? null,
      };
    });

  const listas = listarListasDifusion(ctx.orgId);
  const campanas = listarCampanas(ctx.orgId).filter(
    (c) => ctx.canalesPermitidos === null || ctx.canalesPermitidos.includes(c.canal_id),
  );
  const catalogo = listarCatalogo(ctx.orgId, true);
  const excluidos = listarExcluidos(ctx.orgId);

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Difusiones</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Mensajes masivos de WhatsApp, repartidos en el tiempo para no arriesgar el número.
          </p>
        </div>
      </div>

      <DifusionesPanel
        soyDueno={soyDueno}
        canales={canales}
        listasIniciales={listas.map((l) => ({ id: l.id, nombre: l.nombre, tipo: l.tipo, created_at: l.created_at, contactos: null }))}
        campanasIniciales={campanas}
        catalogo={catalogo.map((p) => ({ id: p.id, nombre: p.nombre, precio: p.precio, canal_id: p.canal_id }))}
        excluidosIniciales={excluidos}
      />
    </>
  );
}
