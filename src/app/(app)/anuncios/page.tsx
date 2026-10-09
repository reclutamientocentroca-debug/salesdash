import AnunciosManuales from "@/components/panel/AnunciosManuales";
import { listarAnunciosManuales, listarCanales } from "@/lib/db";
import { urlServida } from "@/lib/media";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Anuncios · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaAnuncios() {
  const ctx = await requerirSesion();

  const canales = listarCanales(ctx.orgId)
    .filter((c) => ctx.canalesPermitidos === null || ctx.canalesPermitidos.includes(c.id))
    .map((c) => ({ id: c.id, nombre: c.nombre || c.phone }));

  const anuncios = listarAnunciosManuales(ctx.orgId).map((a) => ({
    id: a.id, nombre: a.nombre, descripcion: a.descripcion, canal_id: a.canal_id,
    sin_envio: a.sin_envio === 1, foto: urlServida(a.imagen_clave),
  }));

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Anuncios</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Pon aquí la descripción y la foto de un anuncio. Cuando un cliente llegue por ese anuncio, la IA sabrá si el envío es gratis.
          </p>
        </div>
      </div>
      <AnunciosManuales canales={canales} iniciales={anuncios} />
    </>
  );
}
