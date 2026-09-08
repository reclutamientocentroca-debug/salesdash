/**
 * EL PROMPT DE LA IA, ENTERO Y EN PANTALLA.
 *
 * El prompt no está en ningún cuadro de texto del panel: se ARMA en código,
 * juntando el comportamiento base, el guion del país, los datos del país, el
 * anuncio que trajo al cliente y la ficha del pedido. Esto lo imprime tal cual
 * lo recibe el modelo, para poder leerlo entero antes de tocar nada.
 *
 *   npx tsx scripts/ver-prompt.ts            → República Dominicana
 *   npx tsx scripts/ver-prompt.ts cr         → Costa Rica
 *   npx tsx scripts/ver-prompt.ts do revisor → el prompt de la SEGUNDA IA
 *
 * Usa una base de datos aparte y de usar y tirar: no toca la del negocio.
 */
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const RUTA = resolve(process.cwd(), "data", "ver-prompt.tmp.db");
mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
for (const sufijo of ["", "-wal", "-shm"]) rmSync(RUTA + sufijo, { force: true });
process.env.SALESDASH_DB = RUTA;
process.env.SESSION_SECRET ??= "solo-para-ver-el-prompt-1234567890";

const pais = process.argv[2] ?? "do";
const cual = process.argv[3] ?? "agente";

async function main() {
  const D = await import("@/lib/db");
  const { armarSistema } = await import("@/lib/agent");
  const { agenteDePais, bloqueDelPais } = await import("@/agents");

  const { orgId } = D.crearOrgConDueno({
    negocio: "RINCON DCM", color: "#7c3aed", nombre: "Dueña", email: "ver@prompt.local", passwordHash: "x",
  });
  D.actualizarAgente(orgId, { pais });
  const agente = D.obtenerAgente(orgId);

  // Un anuncio de ejemplo, para ver también el bloque del anuncio.
  const anuncio = {
    anuncio_id: "1",
    producto_anuncio: "Rincondcm",
    descripcion_anuncio:
      "¡COMPRA SEGURO! COMBO 2 EN 1 — SOLO RD$1,690 Cepillo secador + plancha alisadora. Envíos a todo el país.",
    canal_entrada: "meta",
  };

  if (cual === "revisor") {
    const { promptRevisor } = await import("@/lib/revisor");
    const datos = agenteDePais(pais)!;
    console.log(
      promptRevisor({
        datos,
        nombresDeLaCasa: [datos.nombreAgente ?? "", datos.tienda].filter(Boolean),
        catalogo: "Catálogo:\n- (lo que tenga la cuenta)",
        anuncio: `Anuncio: ${anuncio.descripcion_anuncio}`,
        bloqueDelPais: bloqueDelPais(datos, null, "RINCON DCM"),
      }),
    );
    return;
  }

  console.log(armarSistema("RINCON DCM", agente, [], anuncio as never));
}

void main();
