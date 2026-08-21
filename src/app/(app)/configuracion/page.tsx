import FormularioConfiguracion from "@/components/panel/FormularioConfiguracion";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Configuración · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaConfiguracion() {
  const ctx = await requerirSesion();

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Configuración</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Cómo se ve el panel y cómo se miden tus ventas.
          </p>
        </div>
      </div>

      <FormularioConfiguracion
        orgInicial={{
          nombre: ctx.org.nombre,
          color: ctx.org.color,
          meta_cobertura: ctx.org.meta_cobertura,
          meta_efectividad: ctx.org.meta_efectividad,
          marcador_cierre: ctx.org.marcador_cierre,
          modelo_analisis: ctx.org.modelo_analisis,
          modelo_vision: ctx.org.modelo_vision,
        }}
      />
    </>
  );
}
