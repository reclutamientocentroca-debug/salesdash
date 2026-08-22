/**
 * El conteo de cada número, con las mismas cuentas que el panel.
 *
 *   npm run conteo
 *
 * Sirve para una cosa: comprobar que lo que se ve en pantalla es lo que hay en
 * la base. Las cifras NO se recalculan aquí de otra manera —salen de
 * `calcularMetricas`, el mismo módulo que pinta el dashboard—, así que si esta
 * salida y el panel discrepan, el problema es del navegador (una página vieja
 * en caché), no de los datos.
 *
 * De cada número dice quién contesta, cuántos leads trajo la publicidad, quién
 * cerró cada venta y cuánto se facturó, y comprueba la invariante:
 *
 *     conversaciones = cerró la IA + cerró el equipo + sin cerrar + en revisión
 *
 * Si algún número no cuadra, lo dice y termina con código 1: eso significa que
 * hay conversaciones perdiéndose y que el reporte no es fiable.
 *
 * No imprime ni un teléfono de cliente ni el texto de un mensaje: solo cifras.
 * La salida se puede pegar en un chat sin exponer nada de nadie.
 */
import "./env-loader";
import { db, listarCanales, obtenerOrg } from "../src/lib/db";
import { calcularMetricas } from "../src/lib/metrics";

/** Todo el histórico: un conteo de la mitad de los datos no comprueba nada. */
const TODO = { desde: 0, hasta: 9_999_999_999 };

const dinero = (n: number) =>
  n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fila = (etiqueta: string, valor: string | number) =>
  console.log(`    ${etiqueta.padEnd(26)} ${String(valor).padStart(12)}`);

function main() {
  const orgs = db.prepare("SELECT id FROM orgs ORDER BY id").all() as { id: number }[];
  let algoNoCuadra = false;

  for (const { id: orgId } of orgs) {
    const org = obtenerOrg(orgId);
    const canales = listarCanales(orgId);
    if (canales.length === 0) continue;

    console.log(`\n${"═".repeat(62)}`);
    console.log(`  ${org?.nombre ?? `Organización ${orgId}`}`);
    console.log("═".repeat(62));

    for (const canal of canales) {
      const m = calcularMetricas(orgId, { ...TODO, canalId: canal.id });
      const telefono = canal.phone.startsWith("pendiente:") ? "sin vincular" : `+${canal.phone}`;

      const quien = canal.contesta_ia === 1
        ? "tu IA · el panel solo vigila"
        : canal.agente_activo === 1
          ? "el agente del panel"
          : "personas";

      console.log(`\n  ${canal.nombre}  (${telefono})`);
      console.log(`    contesta: ${quien}`);
      console.log("");

      fila("Conversaciones", m.leads);
      fila("Leads por anuncio", `${m.leads_anuncio} (${m.tasa_cierre_anuncio}% cerrados)`);
      fila("Escribieron por su cuenta", m.escribieron_por_su_cuenta);
      fila("Cerró la IA", m.cierres_ia);
      fila("Cerró el equipo", m.cierres_humano);
      fila("Sin cerrar", m.sin_cerrar);
      fila("En revisión", m.revision);
      fila("Facturado sin envío", dinero(m.facturado));
      fila("  de la IA", dinero(m.facturado_ia));
      fila("  del equipo", dinero(m.facturado_humano));
      fila("Envíos cobrados aparte", dinero(m.envios_cobrados));

      const suma = m.cierres_ia + m.cierres_humano + m.sin_cerrar + m.revision;
      if (m.cuadra) {
        console.log(`    ✓ cuadra: ${m.cierres_ia} + ${m.cierres_humano} + ${m.sin_cerrar} + ${m.revision} = ${m.leads}`);
      } else {
        algoNoCuadra = true;
        console.log(`    ✗ NO CUADRA: hay ${m.leads} conversaciones pero ${suma} clasificadas.`);
        console.log("      Alguna se está perdiendo y el reporte de este número no es fiable.");
      }
    }

    // El total de la cuenta, que es lo que enseña el dashboard sin filtrar.
    const t = calcularMetricas(orgId, TODO);
    console.log(`\n  ${"─".repeat(58)}`);
    console.log(`  TODOS LOS NÚMEROS`);
    fila("Conversaciones", t.leads);
    fila("Leads por anuncio", t.leads_anuncio);
    fila("Cerró la IA", t.cierres_ia);
    fila("Cerró el equipo", t.cierres_humano);
    fila("Facturado sin envío", dinero(t.facturado));
    fila("Cobertura de la IA", `${t.cobertura_ia.valor}% / ${t.cobertura_ia.meta}%`);
    fila("Efectividad del equipo", `${t.efectividad_humana.valor}% / ${t.efectividad_humana.meta}%`);
    if (!t.cuadra) algoNoCuadra = true;
  }

  console.log("");
  if (algoNoCuadra) {
    console.log("Hay números que no cuadran. Revisa los marcados arriba con ✗.\n");
    process.exit(1);
  }
  console.log("Todo cuadra: lo que enseña el panel es lo que hay en la base.\n");
}

main();
