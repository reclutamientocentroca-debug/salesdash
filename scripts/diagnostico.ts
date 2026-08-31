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
import {
  db,
  listarAnomalias,
  listarCanales,
  obtenerAgente,
  obtenerOrg,
  rutaDatos,
  usoDelDia,
} from "../src/lib/db";
import { hoyISO } from "../src/lib/ia";
import { obtenerPais } from "../src/lib/paises";

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
      /*
       * QUIÉN CONTESTA EN ESTE NÚMERO, dicho con las mismas dos banderas que
       * mira `atenderConversacion`. «El agente está encendido» no basta: con
       * `contesta_ia` puesto, el agente se calla a propósito —ahí contesta el
       * bot del dueño— y desde fuera se ve exactamente igual que una avería.
       */
      const quienContesta = !c.activo
        ? "nadie · el número está apagado"
        : c.contesta_ia
          ? "la IA del dueño · nuestro agente NO escribe (modo vigilar)"
          : c.agente_activo
            ? "nuestro agente"
            : "personas · el agente está apagado";

      console.log(`     agente vendedor  ${c.agente_activo ? "encendido" : "apagado"}`);
      console.log(`     contesta         ${quienContesta}`);

      if (c.agente_activo && c.contesta_ia) {
        console.log("     ✗ el agente está encendido pero el número está en modo vigilar:");
        console.log("       → Agente de IA → «Dónde responde» → enciende el interruptor de este número.");
      }

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

    /*
     * POR QUÉ EL AGENTE NO CONTESTA.
     *
     * Es la otra mitad de la pregunta y hasta ahora este diagnóstico no la
     * miraba: se puede tener el número conectado, los mensajes entrando y el
     * agente encendido, y aun así no sale ni una respuesta —sin clave del
     * modelo, con el cupo gratuito agotado, fuera de horario o con el número en
     * modo vigilar—. Cada una de esas cuatro se ve desde aquí, y ninguna deja
     * rastro en la pantalla del dueño.
     */
    const uso = usoDelDia(org.id, hoyISO()).filter((u) => u.proposito === "agente");
    const exitos = uso.reduce((n, u) => n + u.exitos, 0);
    const fallos = uso.reduce((n, u) => n + u.fallos, 0);

    console.log("\n  agente de IA");
    console.log(`     clave del modelo ${process.env.OPENROUTER_API_KEY ? "puesta" : "✗ FALTA OPENROUTER_API_KEY: no puede responder"}`);
    console.log(`     hoy              ${exitos} respuesta(s), ${fallos} fallo(s) · toda la cuenta`);

    /*
     * UN AGENTE POR NÚMERO, así que esto va número a número.
     *
     * El modelo, el horario y el país son de cada canal: enseñar «el modelo de
     * la cuenta» aquí sería enseñar el de ninguno de los tres, y este
     * diagnóstico existe justo para responder por qué NO contesta uno concreto.
     */
    for (const c of canales) {
      const a = obtenerAgente(org.id, c.id);
      const pais = obtenerPais(a.pais);

      console.log(`\n     ${c.nombre} (+${c.phone})`);
      console.log(
        `       contesta       ${
          c.contesta_ia === 1
            ? "✗ tu IA, el panel solo vigila"
            : c.agente_activo === 1
              ? "el agente del panel"
              : "✗ nadie: el agente está apagado en este número"
        }`,
      );
      console.log(
        `       país           ${pais ? `${pais.nombre} · ${pais.moneda.simbolo}` : "✗ sin país: habla en neutro y no valida mapas"}`,
      );
      console.log(`       modelo         ${a.modelo}${a.modelo.endsWith(":free") ? " (gratuito: cupo diario limitado)" : ""}`);
      console.log(`       respaldo       ${a.modelo_respaldo ?? "ninguno"}`);
      console.log(
        `       horario        ${
          a.horario_activo
            ? `solo de ${a.horario_desde ?? "?"} a ${a.horario_hasta ?? "?"} · fuera de esa franja NO contesta`
            : "siempre"
        }`,
      );
      console.log(
        `       entiende       ${
          [a.ver_imagenes === 1 && "fotos", a.oir_audios === 1 && "audios", a.validar_mapa === 1 && "mapas"]
            .filter(Boolean)
            .join(", ") || "solo texto"
        }`,
      );
      console.log(
        `       vende con      ${
          [a.usar_catalogo === 1 && "el catálogo", a.conocimiento.trim() && "lo escrito en el canal"]
            .filter(Boolean)
            .join(" y ") || "✗ nada: no tiene de dónde sacar precios"
        }`,
      );
    }

    if (fallos > 0 && exitos === 0) {
      console.log("     ✗ todas las llamadas al modelo fallaron hoy.");
      console.log("       → clave inválida, o el modelo gratuito agotó su cupo: pon uno de respaldo.");
    }

    /*
     * Las anomalías del agente son su caja negra: cuando el modelo falla o el
     * envío no sale, se guarda una con el motivo exacto. Se enseñan las de este
     * grupo y no todas, para que el diagnóstico no se llene de avisos de venta.
     */
    const DEL_AGENTE = ["agente_sin_modelo", "envio_fallido", "agente_en_bucle", "atribucion_perdida"];
    const avisos = listarAnomalias(org.id).filter((a) => DEL_AGENTE.includes(a.tipo));

    if (avisos.length) {
      console.log(`\n     ${avisos.length} anomalía(s) del agente sin resolver, las 3 últimas:`);
      for (const a of avisos.slice(0, 3)) {
        console.log(`       ${hace(a.created_at).padEnd(18)} ${a.tipo.padEnd(20)} ${a.detalle}`);
      }
    }
  }

  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
