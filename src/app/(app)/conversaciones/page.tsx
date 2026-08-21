import Link from "next/link";
import { Pastilla, Vacio, dinero, hace } from "@/components/panel/Piezas";
import { listarCanales, listarConversaciones, type EstadoCierre } from "@/lib/db";
import { rangoAEpochs, requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Conversaciones · SalesDash" };
export const dynamic = "force-dynamic";

const FILTROS: { clave: string; texto: string }[] = [
  { clave: "", texto: "Todas" },
  { clave: "ia", texto: "Cerró la IA" },
  { clave: "humano", texto: "Cerró el equipo" },
  { clave: "abierta", texto: "Sin cerrar" },
  { clave: "revision", texto: "En revisión" },
];

interface Props {
  searchParams: Promise<{ rango?: string; estado?: string }>;
}

export default async function PaginaConversaciones({ searchParams }: Props) {
  const ctx = await requerirSesion();
  const { rango: clave = "7d", estado } = await searchParams;
  const rango = rangoAEpochs(clave);

  const nombres = new Map(listarCanales(ctx.orgId).map((c) => [c.id, c.nombre]));
  const conversaciones = listarConversaciones(ctx.orgId, {
    desde: rango.desde,
    hasta: rango.hasta,
    estado: (estado as EstadoCierre) || undefined,
    limite: 150,
  });

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Conversaciones</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            {conversaciones.length} en el rango seleccionado
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTROS.map((f) => {
            const activo = (estado ?? "") === f.clave;
            return (
              <Link
                key={f.clave || "todas"}
                href={`/conversaciones?rango=${clave}${f.clave ? `&estado=${f.clave}` : ""}`}
                className={`btn ${activo ? "btn-primario" : "btn-secundario"}`}
                style={{ textDecoration: "none", padding: "6px 12px", fontSize: 12.5 }}
              >
                {f.texto}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
        {conversaciones.length === 0 ? (
          <Vacio
            titulo="Aquí no hay conversaciones todavía"
            texto="En cuanto un cliente escriba a alguno de tus números, aparecerá en esta lista."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tabla tabla-hover">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 17 }}>Cliente</th>
                  <th>Número</th>
                  <th>Producto</th>
                  <th style={{ textAlign: "right" }}>Monto</th>
                  <th>Cerró</th>
                  <th style={{ textAlign: "right", paddingRight: 17 }}>Actividad</th>
                </tr>
              </thead>
              <tbody>
                {conversaciones.map((c) => (
                  <tr key={c.id}>
                    <td style={{ paddingLeft: 17 }}>
                      <Link
                        href={`/conversaciones/${c.id}?rango=${clave}`}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        <div style={{ fontWeight: 600 }}>{c.cliente_nombre ?? "Sin nombre"}</div>
                        <div className="num tenue">+{c.cliente_phone}</div>
                      </Link>
                    </td>
                    <td style={{ color: "var(--ink-2)" }}>{nombres.get(c.canal_id) ?? "—"}</td>
                    <td>
                      {c.producto_vendido ?? (
                        <span className="tenue">{c.producto_anuncio ?? "—"}</span>
                      )}
                      {/* Lo que prometía el anuncio, debajo del producto: sin
                          esto no se entiende por qué el cliente pregunta lo que
                          pregunta. */}
                      {c.descripcion_anuncio && (
                        <div
                          className="tenue"
                          style={{ fontSize: 11.5, maxWidth: 260, marginTop: 2 }}
                          title={c.descripcion_anuncio}
                        >
                          {c.descripcion_anuncio}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{dinero(c.total)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <Pastilla estado={c.cerrado_por} />
                        {/* Un vendedor llegó a escribir aquí. Va aparte del
                            estado y no en su lugar: quién cerró y si alguien
                            tuvo que meter mano son dos datos distintos, y una
                            conversación que cerró la IA también puede haber
                            tenido intervención antes. */}
                        {c.intervencion_humana === 1 && (
                          <span className="pastilla pastilla-intervencion" title="Un vendedor escribió en esta conversación">
                            Intervino
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="tenue" style={{ textAlign: "right", paddingRight: 17 }}>
                      {hace(c.last_message_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
