import EquipoAgregarMiembro from "@/components/panel/EquipoAgregarMiembro";
import EquipoMiembroCanales from "@/components/panel/EquipoMiembroCanales";
import EquipoQuitarMiembroBoton from "@/components/panel/EquipoQuitarMiembroBoton";
import SolicitudesSoporte from "@/components/panel/SolicitudesSoporte";
import { fechaCorta } from "@/components/panel/Piezas";
import { canalesDeMiembro, listarCanales, listarMiembros, listarSoporteAccesos } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Equipo · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaEquipo() {
  const ctx = await requerirSesion();
  const miembros = listarMiembros(ctx.orgId);
  const accesos = listarSoporteAccesos(ctx.orgId);
  const soyDueno = ctx.usuario.rol === "dueno";

  // El dueño reparte con la lista ENTERA de la cuenta, no con la suya propia
  // —la suya nunca está restringida—: es él quien decide quién ve qué.
  const canales = soyDueno
    ? listarCanales(ctx.orgId).map((c) => ({ id: c.id, nombre: c.nombre }))
    : [];

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Equipo</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Quién entra a esta cuenta.
          </p>
        </div>
        {soyDueno && <EquipoAgregarMiembro />}
      </div>

      <section className="tarjeta" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
        <table className="tabla">
          <thead>
            <tr>
              <th style={{ paddingLeft: 17 }}>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              {soyDueno && <th>Números y páginas que atiende</th>}
              <th style={{ paddingRight: 17 }}>Alta</th>
              {soyDueno && <th />}
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
                </td>
                {soyDueno && (
                  <td style={{ maxWidth: 340 }}>
                    {u.rol === "dueno" ? (
                      <span className="tenue">Ve todos, siempre</span>
                    ) : (
                      <EquipoMiembroCanales
                        userId={u.id}
                        canales={canales}
                        asignadosIniciales={canalesDeMiembro(ctx.orgId, u.id)}
                      />
                    )}
                  </td>
                )}
                <td className="tenue" style={{ paddingRight: 17 }}>{fechaCorta(u.created_at)}</td>
                {soyDueno && (
                  <td style={{ paddingRight: 17, textAlign: "right" }}>
                    {u.rol !== "dueno" && <EquipoQuitarMiembroBoton userId={u.id} nombre={u.nombre} />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <SolicitudesSoporte accesos={accesos} soyDueno={soyDueno} />
    </>
  );
}
