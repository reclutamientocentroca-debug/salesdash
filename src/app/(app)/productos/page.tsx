import TablaCatalogo from "@/components/panel/TablaCatalogo";
import { listarCatalogo } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Productos · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaProductos() {
  const ctx = await requerirSesion();
  const productos = listarCatalogo(ctx.orgId);

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

      <TablaCatalogo productos={productos} />
    </>
  );
}
