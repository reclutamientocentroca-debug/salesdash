import Link from "next/link";
import { Kpi, Vacio, dinero, fechaCorta, hace } from "@/components/panel/Piezas";
import { IconoConversaciones, IconoMoneda, IconoNumeros, IconoRayo } from "@/components/panel/Iconos";
import { listarOrgs, resumenPlataforma } from "@/lib/admin-db";
import { requerirSuperadmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function PaginaAdmin() {
  const ctx = await requerirSuperadmin();
  const r = resumenPlataforma(ctx);
  const orgs = listarOrgs(ctx);

  return (
    <>
      <h1 className="h1-pagina" style={{ marginBottom: 16 }}>Resumen de la plataforma</h1>

      <div className="sd-kpis" style={{ marginBottom: 14 }}>
        <Kpi
          etiqueta="Cuentas"
          valor={r.cuentas}
          icono={<IconoConversaciones tam={17} />}
          tono="neutro"
          pie={`${r.cuentas_activas_7d} activas en 7 días${r.cuentas_suspendidas ? ` · ${r.cuentas_suspendidas} suspendidas` : ""}`}
        />
        <Kpi
          etiqueta="Números conectados"
          valor={r.numeros_conectados}
          icono={<IconoNumeros tam={17} />}
          tono="acento"
          pie={`${r.agentes_activos} con agente vendedor`}
        />
        <Kpi
          etiqueta="Leads por anuncio"
          valor={r.leads_anuncio}
          icono={<IconoRayo tam={17} />}
          tono="azul"
          pie={`de ${r.leads} conversaciones · ${r.cierres_ia} cerró la IA, ${r.cierres_humano} los equipos`}
        />
        <Kpi
          etiqueta="Facturado"
          valor={dinero(r.ventas_totales)}
          icono={<IconoMoneda tam={17} />}
          tono="ambar"
        />
      </div>

      <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
        <h2 className="titulo-tarjeta" style={{ padding: "16px 17px 12px" }}>Organizaciones</h2>

        {orgs.length === 0 ? (
          <Vacio titulo="Todavía no hay cuentas" texto="Cuando alguien se registre, aparecerá aquí." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tabla tabla-hover">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 17 }}>Cuenta</th>
                  <th>Alta</th>
                  <th style={{ textAlign: "right" }}>Números</th>
                  <th style={{ textAlign: "right" }}>Leads (30 d)</th>
                  <th style={{ textAlign: "right" }}>Conversaciones</th>
                  <th style={{ textAlign: "right" }}>Automatizada</th>
                  <th style={{ textAlign: "right" }}>Asistida</th>
                  <th style={{ textAlign: "right" }}>Tasa</th>
                  <th style={{ textAlign: "right", paddingRight: 17 }}>Actividad</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td style={{ paddingLeft: 17 }}>
                      <Link href={`/admin/orgs/${o.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                        <div style={{ fontWeight: 600 }}>
                          {o.nombre}
                          {o.suspendida && (
                            <span className="pastilla pastilla-revision" style={{ marginLeft: 7 }}>
                              Suspendida
                            </span>
                          )}
                          {o.anomalias_altas > 0 && (
                            <span className="pastilla" style={{ marginLeft: 7, background: "var(--red-bg)", color: "var(--red)" }}>
                              {o.anomalias_altas}
                            </span>
                          )}
                        </div>
                        <div className="tenue">{o.correo_dueno}</div>
                      </Link>
                    </td>
                    <td className="tenue">{fechaCorta(o.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      {o.numeros_conectados}
                      {o.numeros !== o.numeros_conectados && (
                        <span className="tenue"> de {o.numeros}</span>
                      )}
                    </td>
                    {/* «Leads» es lo que trajo la publicidad; el total va al lado
                        porque es el trabajo que esa cuenta le da al sistema. */}
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{o.leads_anuncio_mes}</td>
                    <td className="tenue" style={{ textAlign: "right" }}>{o.leads_mes}</td>
                    <td style={{ textAlign: "right", color: "var(--acc)" }}>{o.cierres_ia}</td>
                    <td style={{ textAlign: "right", color: "var(--blue)" }}>{o.cierres_humano}</td>
                    <td style={{ textAlign: "right" }}>{o.tasa_cierre}%</td>
                    <td className="tenue" style={{ textAlign: "right", paddingRight: 17 }}>
                      {hace(o.ultima_actividad)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="tenue" style={{ marginTop: 14, maxWidth: "72ch" }}>
        Esta consola no muestra el contenido de ninguna conversación, ni nombres o teléfonos de los
        clientes finales, ni tokens en claro. Para entrar a una cuenta hay que pedir permiso a su
        dueño desde su ficha.
      </p>
    </>
  );
}
