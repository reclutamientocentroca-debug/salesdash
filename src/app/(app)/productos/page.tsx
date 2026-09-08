import TablaCatalogo from "@/components/panel/TablaCatalogo";
import { listarCanales, listarCatalogo, obtenerAgente } from "@/lib/db";
import { agenteDePais } from "@/agents";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Productos · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaProductos() {
  const ctx = await requerirSesion();
  const productos = listarCatalogo(ctx.orgId);

  /*
   * DE QUÉ NÚMERO ES CADA PRODUCTO.
   *
   * Una cuenta que vende en tres países tiene tres monedas y tres listas de
   * precios, y el precio se guarda sin moneda: con el catálogo colgado de la
   * cuenta, el agente de Costa Rica leía un combo dominicano de 1690 como
   * 1.690 colones. Por eso aquí se reparte, y cada agente solo lee lo suyo.
   */
  const canales = listarCanales(ctx.orgId).map((c) => {
    const pais = obtenerAgente(ctx.orgId, c.id).pais;
    return { id: c.id, nombre: c.nombre || c.phone, pais: agenteDePais(pais)?.nombre ?? null };
  });

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Productos</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Lo que el agente puede ofrecer y a qué precio.
          </p>
        </div>
      </div>

      <TablaCatalogo productos={productos} canales={canales} />
    </>
  );
}
