import Link from "next/link";
import { Vacio, fechaYHora } from "@/components/panel/Piezas";
import { husoDeLaCuenta } from "@/lib/db";
import { diasQueCambiaron, informeDeRecalculo, type VentasDelDia } from "@/lib/recalculo";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Recálculo de ventas · SalesDash" };
export const dynamic = "force-dynamic";

/** «10 sept 2026», del «2026-09-10» del informe. Sin huso: ya es un día. */
function nombreDelDia(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("es", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

const QUIEN: Record<string, string> = {
  ia: "Automatizada", humano: "Asistida", revision: "En revisión", abierta: "Sin cerrar",
};

function Celdas({ v, tenue }: { v: VentasDelDia; tenue?: boolean }) {
  const estilo = { textAlign: "right" as const, color: tenue ? "var(--ink-3)" : undefined };
  return (
    <>
      <td className="num" style={estilo}>{v.ia}</td>
      <td className="num" style={estilo}>{v.humano}</td>
      <td className="num" style={{ ...estilo, fontWeight: 600 }}>{v.ia + v.humano}</td>
    </>
  );
}

/**
 * LO QUE MOVIÓ EL CAMBIO DE REGLA. La venta pasó a contar el día en que se
 * cerró, no el de la factura, y el histórico se recalculó una vez al
 * desplegar. Aquí se ven las ventas por día antes y después, y cada venta que
 * cambió: nadie tiene que fiarse de que el número nuevo está bien.
 */
export default async function PaginaRecalculo() {
  const ctx = await requerirSesion();
  const informe = informeDeRecalculo(ctx.orgId);
  const huso = husoDeLaCuenta(ctx.orgId);

  if (!informe) {
    return (
      <>
        <div className="sd-cabecera"><h1 className="h1-pagina">Recálculo de ventas</h1></div>
        <div className="tarjeta">
          <Vacio
            titulo="Todavía no se ha recalculado"
            texto="El histórico se recalcula solo al desplegar la nueva versión. Vuelve en un minuto."
          />
        </div>
      </>
    );
  }

  const dias = diasQueCambiaron(informe);
  const r = informe.resumen;
  const suma = (x: Record<string, VentasDelDia>) =>
    Object.values(x).reduce((a, v) => ({ ia: a.ia + v.ia, humano: a.humano + v.humano }), { ia: 0, humano: 0 });
  const totalAntes = suma(informe.antes);
  const totalDespues = suma(informe.despues);

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Recálculo de ventas</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Hecho {fechaYHora(informe.creado_at, huso)} · la venta cuenta el día en que se cerró, no el de la factura
          </p>
        </div>
        <Link href="/ventas" className="btn btn-secundario" style={{ textDecoration: "none", padding: "6px 12px", fontSize: 12.5 }}>
          Volver a Ventas
        </Link>
      </div>

      <section className="tarjeta" style={{ marginBottom: 14 }}>
        <h2 className="titulo-tarjeta" style={{ marginBottom: 8 }}>La regla</h2>
        <ul className="tenue" style={{ display: "grid", gap: 4, paddingLeft: 18, listStyle: "disc" }}>
          <li><strong style={{ color: "var(--ink)" }}>Automatizada</strong>: cuenta el día del resumen de la IA («PEDIDO REGISTRADO»).</li>
          <li><strong style={{ color: "var(--ink)" }}>Asistida</strong>: sin resumen, cuenta el día de la primera factura del representante.</li>
          <li>La factura de una venta que ya existe no crea otra: la marca como facturada y la deja en su día.</li>
        </ul>
        <p style={{ marginTop: 12, fontSize: 13 }}>
          {r.movidas_de_dia} venta{r.movidas_de_dia === 1 ? "" : "s"} cambiaron de día ·{" "}
          {r.a_automatizada} pasaron a automatizada · {r.a_asistida} a asistida ·{" "}
          {r.duplicados} duplicada{r.duplicados === 1 ? "" : "s"} quitada{r.duplicados === 1 ? "" : "s"} ·{" "}
          {r.selladas_nuevas} con resumen que no se contaban · {r.facturadas} marcada{r.facturadas === 1 ? "" : "s"} como facturada{r.facturadas === 1 ? "" : "s"}
        </p>
        <p className="tenue" style={{ marginTop: 4 }}>
          En total: {totalAntes.ia + totalAntes.humano} ventas antes, {totalDespues.ia + totalDespues.humano} después.
        </p>
      </section>

      <section className="tarjeta" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
        <h2 className="titulo-tarjeta" style={{ padding: "16px 17px 12px" }}>Ventas por día, antes y después</h2>
        {dias.length === 0 ? (
          <Vacio titulo="Ningún día cambió" texto="Todas las ventas ya estaban en el día en que se cerraron." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tabla">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 17 }} rowSpan={2}>Día</th>
                  <th colSpan={3} style={{ textAlign: "center" }}>Antes</th>
                  <th colSpan={3} style={{ textAlign: "center" }}>Después</th>
                  <th rowSpan={2} style={{ textAlign: "right", paddingRight: 17 }}>Diferencia</th>
                </tr>
                <tr>
                  <th style={{ textAlign: "right" }}>Auto.</th>
                  <th style={{ textAlign: "right" }}>Asist.</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th style={{ textAlign: "right" }}>Auto.</th>
                  <th style={{ textAlign: "right" }}>Asist.</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((d) => {
                  const dif = d.despues.ia + d.despues.humano - (d.antes.ia + d.antes.humano);
                  return (
                    <tr key={d.dia}>
                      <td style={{ paddingLeft: 17, whiteSpace: "nowrap" }}>{nombreDelDia(d.dia)}</td>
                      <Celdas v={d.antes} tenue />
                      <Celdas v={d.despues} />
                      <td className="num" style={{ textAlign: "right", paddingRight: 17, fontWeight: 600, color: dif > 0 ? "var(--verde)" : dif < 0 ? "var(--red)" : "var(--ink-3)" }}>
                        {dif > 0 ? `+${dif}` : dif}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {informe.cambios.length > 0 && (
        <section className="tarjeta" style={{ padding: 0, overflow: "hidden" }}>
          <h2 className="titulo-tarjeta" style={{ padding: "16px 17px 12px" }}>Cada venta que cambió</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="tabla tabla-hover">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 17 }}>Cliente</th>
                  <th>Antes</th>
                  <th>Después</th>
                  <th style={{ paddingRight: 17 }}>Por qué</th>
                </tr>
              </thead>
              <tbody>
                {informe.cambios.map((c) => (
                  <tr key={c.id}>
                    <td style={{ paddingLeft: 17 }}>
                      <Link href={`/conversaciones/${c.id}`} style={{ color: "inherit", fontWeight: 600, textDecoration: "none" }}>
                        {c.cliente ?? `Chat #${c.id}`}
                      </Link>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {c.antes ? `${QUIEN[c.antes.quien] ?? c.antes.quien} · ${nombreDelDia(c.antes.dia)}` : <span className="tenue">no contaba</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {c.despues ? `${QUIEN[c.despues.quien] ?? c.despues.quien} · ${nombreDelDia(c.despues.dia)}` : <span style={{ color: "var(--red)" }}>ya no cuenta</span>}
                    </td>
                    <td className="tenue" style={{ paddingRight: 17 }}>{c.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {informe.cambios_sin_listar > 0 && (
            <p className="tenue" style={{ padding: "10px 17px 14px" }}>
              Y {informe.cambios_sin_listar} más que no se listan; los totales por día de arriba sí las cuentan.
            </p>
          )}
        </section>
      )}
    </>
  );
}
