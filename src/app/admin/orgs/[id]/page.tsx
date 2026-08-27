import Link from "next/link";
import { notFound } from "next/navigation";
import AccionesOrg from "@/components/panel/AccionesOrg";
import { dinero, fechaCorta, fechaHora, hace } from "@/components/panel/Piezas";
import { fichaOrg } from "@/lib/admin-db";
import { requerirSuperadmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function FichaOrganizacion({ params }: Props) {
  const ctx = await requerirSuperadmin();
  const { id } = await params;

  const f = fichaOrg(ctx, Number(id));
  if (!f) notFound();

  const cuadra =
    f.metricas.leads ===
    f.metricas.cierres_ia + f.metricas.cierres_humano + f.metricas.abiertas + f.metricas.revision;

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <Link href="/admin" className="tenue" style={{ textDecoration: "none" }}>
            ← Organizaciones
          </Link>
          <h1 className="h1-pagina" style={{ marginTop: 4 }}>
            {f.nombre}
            {f.suspendida && (
              <span className="pastilla pastilla-revision" style={{ marginLeft: 10 }}>Suspendida</span>
            )}
          </h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Alta el {fechaCorta(f.created_at)} · {f.usuarios.length} usuario
            {f.usuarios.length === 1 ? "" : "s"}
          </p>
        </div>

        <AccionesOrg orgId={f.id} suspendida={f.suspendida} nombre={f.nombre} />
      </div>

      {!cuadra && (
        <div className="aviso aviso-error" style={{ marginBottom: 14 }}>
          Los conteos de esta cuenta no cuadran: {f.metricas.leads} conversaciones contra{" "}
          {f.metricas.cierres_ia + f.metricas.cierres_humano + f.metricas.abiertas + f.metricas.revision}{" "}
          conversaciones clasificadas.
        </div>
      )}

      <div className="sd-mitades" style={{ marginBottom: 14 }}>
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Métricas acumuladas</h2>
          <dl style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            <Fila etiqueta="Leads por anuncio" valor={String(f.metricas.leads_anuncio)} />
            <Fila etiqueta="Conversaciones" valor={String(f.metricas.leads)} />
            <Fila etiqueta="Automatizada" valor={String(f.metricas.cierres_ia)} />
            <Fila etiqueta="Asistida" valor={String(f.metricas.cierres_humano)} />
            <Fila etiqueta="Sin cerrar" valor={String(f.metricas.abiertas)} />
            <Fila etiqueta="En revisión" valor={String(f.metricas.revision)} />
            <Fila etiqueta="Facturado (sin envíos)" valor={dinero(f.metricas.ventas)} />
          </dl>
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Modelos que usa</h2>
          <dl style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            <Fila etiqueta="Agente vendedor" valor={f.modelo_agente} />
            <Fila etiqueta="Respaldo" valor={f.modelo_respaldo ?? "sin configurar"} />
            <Fila etiqueta="Analista" valor={f.modelo_analisis} />
            <Fila etiqueta="Visión" valor={f.modelo_vision} />
          </dl>

          {f.consumo.length > 0 && (
            <>
              <div className="rotulo" style={{ margin: "16px 0 8px" }}>Consumo de 7 días</div>
              <ul style={{ display: "grid", gap: 6, fontSize: 12 }}>
                {f.consumo.map((c) => (
                  <li key={`${c.modelo}-${c.proposito}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.modelo} · {c.proposito}
                    </span>
                    <span className="num">
                      {c.exitos}
                      {c.fallos > 0 && <span style={{ color: "var(--red)" }}> · {c.fallos} fallos</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="tarjeta" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
        <h2 className="titulo-tarjeta" style={{ padding: "16px 17px 12px" }}>Números</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th style={{ paddingLeft: 17 }}>Nombre</th>
              <th>Teléfono</th>
              <th>Estado</th>
              <th>Agente</th>
              <th style={{ textAlign: "right", paddingRight: 17 }}>Último evento</th>
            </tr>
          </thead>
          <tbody>
            {f.canales.map((c) => (
              <tr key={c.id}>
                <td style={{ paddingLeft: 17, fontWeight: 600 }}>{c.nombre}</td>
                <td className="num" style={{ color: "var(--ink-2)" }}>{c.phone ? `+${c.phone}` : "—"}</td>
                <td>
                  <span className={`pastilla ${c.estado === "conectado" ? "pastilla-ia" : "pastilla-abierta"}`}>
                    {c.estado}
                  </span>
                  {!c.webhook_vivo && (
                    <span className="pastilla" style={{ marginLeft: 6, background: "var(--red-bg)", color: "var(--red)" }}>
                      Webhook caído
                    </span>
                  )}
                </td>
                <td style={{ color: c.agente_activo ? "var(--acc)" : "var(--ink-3)" }}>
                  {c.agente_activo ? "Encendido" : "Apagado"}
                </td>
                <td className="tenue" style={{ textAlign: "right", paddingRight: 17 }}>
                  {hace(c.ultimo_evento_at)}
                </td>
              </tr>
            ))}
            {f.canales.length === 0 && (
              <tr>
                <td colSpan={5} className="tenue" style={{ padding: 17 }}>
                  Esta cuenta no ha conectado ningún número.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="sd-mitades">
        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Anomalías sin resolver</h2>
          {f.anomalias.length === 0 ? (
            <p className="tenue">Ninguna.</p>
          ) : (
            <ul style={{ display: "grid", gap: 7, fontSize: 12.5 }}>
              {f.anomalias.map((a) => (
                <li key={`${a.tipo}-${a.severidad}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: a.severidad === "alta" ? "var(--red)" : "var(--ink-2)" }}>
                    {a.tipo.replace(/_/g, " ")}
                  </span>
                  <span className="num" style={{ fontWeight: 600 }}>{a.n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tarjeta">
          <h2 className="titulo-tarjeta" style={{ marginBottom: 12 }}>Historial de acceso de soporte</h2>
          {f.soporte.length === 0 ? (
            <p className="tenue">Nadie ha pedido entrar a esta cuenta.</p>
          ) : (
            <ul style={{ display: "grid", gap: 9, fontSize: 12.5 }}>
              {f.soporte.map((s) => (
                <li key={s.id}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`pastilla ${s.estado === "aprobado" ? "pastilla-ia" : "pastilla-abierta"}`}>
                      {s.estado}
                    </span>
                    <span className="tenue">{fechaHora(s.solicitado_at)}</span>
                  </div>
                  <p style={{ color: "var(--ink-2)", marginTop: 3 }}>{s.motivo}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt style={{ color: "var(--ink-2)" }}>{etiqueta}</dt>
      <dd className="num" style={{ fontWeight: 600, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>
        {valor}
      </dd>
    </div>
  );
}
