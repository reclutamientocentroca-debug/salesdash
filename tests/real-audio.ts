/**
 * Verificación real de la transcripción de notas de voz.
 *
 *   npm run verificar-audio -- ruta/al/audio.ogg
 *
 * **CONSUME CRÉDITO.** Manda un audio de verdad al modelo configurado.
 *
 * Existe porque el punto frágil de esta función no es el código sino el
 * FORMATO. WhatsApp manda las notas de voz en ogg/opus, y no todos los modelos
 * que dicen aceptar audio lo aceptan en ogg. Esa incompatibilidad no se ve
 * compilando ni con pruebas que no tocan la red: se ve la primera vez que un
 * cliente manda un audio, y entonces la conversación se queda coja en
 * silencio.
 *
 * Sin argumento busca el audio más reciente que haya guardado la aplicación en
 * `<datos>/media`, que es exactamente lo que recibirá en producción.
 */
import "../scripts/env-loader";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { completar, ErrorIA } from "../src/lib/ia";
import { rutaDatos } from "../src/lib/db";

const MODELO = process.env.MODELO_AUDIO ?? "google/gemini-3.5-flash-lite";

const PROMPT = `Transcribe literalmente este audio. Devuelve SOLO lo que se dice, sin comentarlo.
Si no se entiende nada, devuelve exactamente: [audio ininteligible]`;

const linea = (t: string) => console.log(`\n${"─".repeat(72)}\n${t}\n`);

/** El audio más reciente de los que ya guardó la aplicación. */
function ultimoGuardado(): string | null {
  const raiz = join(rutaDatos(), "media");
  const encontrados: { ruta: string; cuando: number }[] = [];

  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(ogg|opus|mp3|m4a|wav)$/i.test(e.name)) {
        encontrados.push({ ruta, cuando: statSync(ruta).mtimeMs });
      }
    }
  };

  try {
    recorrer(raiz);
  } catch {
    return null;
  }

  encontrados.sort((a, b) => b.cuando - a.cuando);
  return encontrados[0]?.ruta ?? null;
}

async function main() {
  const ruta = process.argv[2] ?? ultimoGuardado();

  if (!ruta) {
    console.error("Uso: npm run verificar-audio -- ruta/al/audio.ogg");
    console.error("(sin argumento se usa el audio más reciente recibido por WhatsApp)");
    process.exit(1);
  }

  const datos = readFileSync(ruta);
  const formato = ruta.split(".").pop()!.toLowerCase();

  linea("QUÉ SE MANDA");
  console.log("  archivo ", ruta);
  console.log("  formato ", formato);
  console.log("  tamaño  ", Math.round(datos.length / 1024), "KB");
  console.log("  modelo  ", MODELO);

  linea("RESPUESTA DEL MODELO");

  try {
    const r = await completar({
      orgId: 1,
      proposito: "audio",
      modelo: MODELO,
      mensajes: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "input_audio", input_audio: { data: datos.toString("base64"), format: formato } },
          ],
        },
      ],
      maxTokens: 700,
      temperatura: 0,
    });

    console.log(`  ${r.texto.trim()}`);
    linea(`✓ El modelo acepta ${formato} y transcribe.`);
  } catch (e) {
    console.error("  ✗ No transcribió.");
    console.error("  ", e instanceof ErrorIA ? `${e.status} · ${e.message}` : e);
    console.error(
      "\n  Si el error habla del formato, el modelo no acepta ese contenedor:\n" +
        "  prueba otro en Configuración → Transcripción de notas de voz.",
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
