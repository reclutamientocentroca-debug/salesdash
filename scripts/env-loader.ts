/**
 * Carga .env / .env.local para los scripts que corren fuera de Next
 * (seed, pruebas). Next ya lo hace solo en dev y en build.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function cargar(archivo: string) {
  const ruta = resolve(process.cwd(), archivo);
  if (!existsSync(ruta)) return;

  for (const linea of readFileSync(ruta, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const corte = limpia.indexOf("=");
    if (corte === -1) continue;

    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();

    // Quita comillas envolventes, si las hay
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    // El entorno real siempre gana sobre el archivo
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}

cargar(".env");
cargar(".env.local");
