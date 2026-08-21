import SolicitudesSoporte from "@/components/panel/SolicitudesSoporte";
import { fechaCorta } from "@/components/panel/Piezas";
import { listarMiembros, listarSoporteAccesos } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Equipo · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaEquipo() {
  const ctx = await requerirSesion();
  const miembros = listarMiembros(ctx.orgId);
  const accesos = listarSoporteAccesos(ctx.orgId);

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Equipo</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Quién entra a esta cuenta.
          </p>
        </div>
      </div>

      <section className="tarjeta" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
        <table className="tabla">
          <thead>
            <tr>
              <th style={{ paddingLeft: 17 }}>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th style={{ paddingRight: 17 }}>Alta</th>
            </tr>
          </thead>
          <tbody>
            {miembros.map((u) => (
              <tr key={u.id}>
                <td style={{ paddingLeft: 17, fontWeight: 600 }}>
                  {u.nombre}
                  {u.id === ctx.userId && <span className="tenue"> · tú</span>}
                </td>
                <td style={{ color: "var(--ink-2)" }}>{u.email}</td>
                <td>
                  <span className={`pastilla ${u.rol === "dueno" ? "pastilla-ia" : "pastilla-abierta"}`}>
                    {u.rol === "dueno" ? "Dueño" : "Miembro"}
                  </span>
                  {!u.verificado && (
                    <span className="pastilla pastilla-revision" style={{ marginLeft: 6 }}>
                      Sin verificar
                    </span>
                  )}
                </td>
                <td className="tenue" style={{ paddingRight: 17 }}>{fechaCorta(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <SolicitudesSoporte accesos={accesos} soyDueno={ctx.usuario.rol === "dueno"} />
    </>
  );
}
