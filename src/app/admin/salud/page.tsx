import Link from "next/link";
import { Vacio, hace } from "@/components/panel/Piezas";
import { expirarSoportes, saludTecnica } from "@/lib/admin-db";
import { requerirSuperadmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function PaginaSalud() {
  const ctx = await requerirSuperadmin();

  // Buen momento para cerrar las sesiones de soporte vencidas.
  expirarSoportes(ctx);
  const s = saludTecnica(ctx);

  return (
    <>
      <h1 className="h1-pagina" style={{ marginBottom: 16 }}>Salud técnica</h1>

      <section className="tarjeta" style={{ marginBottom: 14 }}>
        <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Webhooks caídos</h2>
        <p className="tenue" style={{ marginBottom: 12 }}>
          Canales conectados que no reciben un mensaje desde hace más de 24 horas. Casi siempre es
          que la recepción dejó de estar configurada.
        </p>

        {s.webhooks_caidos.length === 0 ? (
          <p className="tenue">Todos los canales están recibiendo mensajes.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Canal</th>
                <th style={{ textAlign: "right" }}>Último evento</th>
              </tr>
            </thead>
            <tbody>
              {s.webhooks_caidos.map((w) => (
                <tr key={`${w.org_id}-${w.canal}`}>
                  <td>
                    <Link href={`/admin/orgs/${w.org_id}`} className="enlace" style={{ color: "var(--ink)" }}>
                      {w.org}
                    </Link>
                  </td>
                  <td style={{ color: "var(--ink-2)" }}>{w.canal}</td>
                  <td className="tenue" style={{ textAlign: "right" }}>{hace(w.ultimo_evento_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="sd-mitades">
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Anomalías sin resolver</h2>
          {s.anomalias_por_org.length === 0 ? (
            <p className="tenue">Ninguna cuenta tiene anomalías pendientes.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th style={{ textAlign: "right" }}>Altas</th>
                  <th style={{ textAlign: "right" }}>Medias</th>
                </tr>
              </thead>
              <tbody>
                {s.anomalias_por_org.map((a) => (
                  <tr key={a.org_id}>
                    <td>
                      <Link href={`/admin/orgs/${a.org_id}`} className="enlace" style={{ color: "var(--ink)" }}>
                        {a.org}
                      </Link>
                    </td>
                    <td style={{ textAlign: "right", color: a.altas ? "var(--red)" : undefined }}>{a.altas}</td>
                    <td style={{ textAlign: "right", color: "var(--ink-2)" }}>{a.medias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 4 }}>Fallos de modelo</h2>
          <p className="tenue" style={{ marginBottom: 12 }}>
            Últimos 7 días. Muchos fallos en un modelo gratuito suele ser su límite diario.
          </p>

          {s.fallos_de_modelo.length === 0 ? (
            <p className="tenue">Sin fallos registrados.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Modelo</th>
                  <th style={{ textAlign: "right" }}>Fallos</th>
                </tr>
              </thead>
              <tbody>
                {s.fallos_de_modelo.map((f) => (
                  <tr key={`${f.org_id}-${f.modelo}`}>
                    <td>
                      <Link href={`/admin/orgs/${f.org_id}`} className="enlace" style={{ color: "var(--ink)" }}>
                        {f.org}
                      </Link>
                    </td>
                    <td className="tenue">{f.modelo}</td>
                    <td style={{ textAlign: "right", color: "var(--red)" }}>{f.fallos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
