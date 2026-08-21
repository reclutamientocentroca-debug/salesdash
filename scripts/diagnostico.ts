/**
 * Diagnóstico de por qué no aparecen conversaciones.
 *
 *   npm run diagnostico
 *
 * Responde a la pregunta en orden, de fuera hacia dentro:
 *   1. ¿Hay algún canal conectado?
 *   2. ¿Whapi tiene registrada NUESTRA url de webhook, o ninguna?
 *   3. ¿Han llegado mensajes?
 *   4. Si llegaron, ¿en qué estado quedaron?
 *
 * No imprime tokens ni el contenido de los mensajes: solo metadatos. La salida
 * se puede pegar en un chat sin exponer nada.
 */
import "./env-loader";
import { db, listarCanales, obtenerOrg } from "../src/lib/db";
import { descifrar } from "../src/lib/auth";
import { armarUrlWebhook } from "../src/lib/whapi";

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

      const nuestra = armarUrlWebhook(c.id, c.webhook_secret);
      console.log(`     webhook esperado ${nuestra.replace(/s=[^&]+/, "s=***")}`);

      // Lo que Whapi tiene registrado de verdad. Es LA comprobación: un canal
      // conectado sin webhook apuntado aquí funciona en WhatsApp y no manda
      // absolutamente nada al panel.
      let token = "";
      try {
        token = descifrar(c.token_cifrado);
      } catch {
        console.log("     ⚠ el token guardado no se puede descifrar (¿cambió SESSION_SECRET?)");
        continue;
      }

      try {
        const r = await fetch("https://gate.whapi.cloud/settings", {
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        });

        if (!r.ok) {
          console.log(`     ⚠ Whapi respondió ${r.status} al consultar la configuración`);
        } else {
          const s = (await r.json()) as { webhooks?: { url?: string; events?: unknown[] }[] };
          const hooks = s.webhooks ?? [];

          if (!hooks.length) {
            console.log("     ✗ Whapi NO tiene ningún webhook registrado.");
            console.log("       → nada de lo que ocurra en WhatsApp llegará al panel.");
            console.log("       → Números → «Reintentar configuración»");
          } else {
            for (const h of hooks) {
              const url = h.url ?? "";
              const coincide = url.split("?")[0] === nuestra.split("?")[0];
              console.log(`     webhook en Whapi ${url.replace(/s=[^&]+/, "s=***")}`);
              console.log(`     ${coincide ? "✓ apunta a este panel" : "✗ apunta a OTRA dirección"}`);
              console.log(`       eventos: ${JSON.stringify(h.events ?? [])}`);
            }
          }
        }

        // Estado real del número en WhatsApp.
        const rh = await fetch("https://gate.whapi.cloud/health?wakeup=false", {
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (rh.ok) {
          const h = (await rh.json()) as { status?: { text?: string }; user?: { id?: string } };
          console.log(`     estado en Whapi  ${h.status?.text ?? "?"}`);
        }
      } catch (e) {
        console.log(`     ⚠ no se pudo consultar a Whapi: ${e instanceof Error ? e.message : e}`);
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
      console.log("    Si escribiste al número y el webhook de arriba apunta bien,");
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
