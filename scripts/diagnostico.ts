/**
 * Diagnóstico de por qué no aparecen conversaciones.
 *
 *   npm run diagnostico
 *
 * Responde a la pregunta en orden, de fuera hacia dentro:
 *   1. ¿Hay algún canal conectado?
 *   2. ¿Está la sesión de WhatsApp guardada en el disco?
 *   3. ¿Han llegado mensajes?
 *   4. Si llegaron, ¿en qué estado quedaron?
 *
 * No imprime tokens ni el contenido de los mensajes: solo metadatos. La salida
 * se puede pegar en un chat sin exponer nada.
 */
import "./env-loader";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, listarCanales, obtenerOrg, rutaDatos } from "../src/lib/db";

const hace = (t: number | null) => {
  if (!t) return "nunca";
  const s = Math.floor(Date.now() / 1000) - t;
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86_400)} d`;
};

async function main() {
  const linea = (t: string) => console.log(`\n${"─".repeat(66)}\n${t}\n`);

  linea("ENTORNO");
  console.log("  APP_URL        ", process.env.APP_URL ?? "(vacía)");
  console.log("  base de datos  ", process.env.SALESDASH_DB ?? "./data/salesdash.db");

  const orgs = db.prepare("SELECT id, nombre FROM orgs ORDER BY id").all() as {
    id: number;
    nombre: string;
  }[];

  if (!orgs.length) {
    console.log("\n  No hay ninguna cuenta creada todavía.");
    return;
  }

  for (const org of orgs) {
    linea(`CUENTA ${org.id} · ${org.nombre}`);

    const canales = listarCanales(org.id);
    if (!canales.length) {
      console.log("  Sin números conectados. Nada puede llegar todavía.");
      continue;
    }

    for (const c of canales) {
      const phone = c.phone.startsWith("pendiente:") ? "(sin vincular)" : `+${c.phone}`;
      console.log(`  ── ${c.nombre} · ${phone}`);
      console.log(`     estado local     ${c.estado}`);
      console.log(`     último evento    ${hace(c.ultimo_evento_at)}`);
      console.log(`     agente vendedor  ${c.agente_activo ? "encendido" : "apagado"}`);

      /*
       * LA comprobación, ahora que se conecta por QR: ¿existe la sesión en el
       * disco? Es lo único que decide si el número vuelve solo tras un
       * reinicio o si hay que reescanear el código. No se imprime ni un byte de
       * las credenciales, solo si están y a qué número pertenecen.
       */
      const carpeta = join(rutaDatos(), "sesiones", String(c.id));
      console.log(`     sesión en disco  ${carpeta}`);

      if (!existsSync(join(carpeta, "creds.json"))) {
        console.log("     ✗ NO hay sesión guardada.");
        console.log("       → el número no recibirá nada hasta escanear el QR.");
        console.log("       → Números → abre el número y escanea el código.");
      } else {
        try {
          const creds = JSON.parse(readFileSync(join(carpeta, "creds.json"), "utf8")) as {
            registered?: boolean;
            me?: { id?: string };
          };
          const vinculado = (creds.me?.id ?? "").split(":")[0];

          if (creds.registered) {
            console.log(`     ✓ sesión vinculada al número ${vinculado ? `+${vinculado}` : "(desconocido)"}`);
            console.log("       reconecta sola al arrancar el servidor.");
          } else {
            console.log("     ⚠ hay carpeta de sesión pero sin vincular: falta escanear el QR.");
          }
        } catch {
          console.log("     ⚠ las credenciales del disco están corruptas: hay que reescanear.");
        }
      }
      console.log();
    }

    const conv = db
      .prepare("SELECT COUNT(*) n FROM conversations WHERE org_id = ?")
      .get(org.id) as { n: number };
    const msg = db
      .prepare("SELECT COUNT(*) n FROM messages WHERE org_id = ?")
      .get(org.id) as { n: number };

    console.log(`  conversaciones: ${conv.n} · mensajes: ${msg.n}`);

    if (msg.n > 0) {
      const ultimos = db
        .prepare(
          `SELECT emisor, tipo, created_at, length(content) AS largo
             FROM messages WHERE org_id = ? ORDER BY created_at DESC LIMIT 5`,
        )
        .all(org.id) as { emisor: string; tipo: string; created_at: number; largo: number }[];

      console.log("\n  últimos mensajes (sin contenido, solo metadatos):");
      for (const m of ultimos) {
        console.log(`   ${hace(m.created_at).padEnd(18)} ${m.emisor.padEnd(8)} ${m.tipo.padEnd(10)} ${m.largo} caracteres`);
      }
    } else {
      console.log("\n  ✗ No ha llegado NI UN mensaje al panel.");
      console.log("    Si escribiste al número y la sesión de arriba está vinculada,");
      console.log("    revisa que el mensaje fuera ENTRANTE: un mensaje que sale del");
      console.log("    propio número hacia alguien con quien nunca hubo conversación");
      console.log("    no abre una nueva, para no inflar el conteo de leads.");
    }

    const marcador = obtenerOrg(org.id)?.marcador_cierre;
    console.log(`\n  marcador de cierre: "${marcador}"`);
  }

  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
