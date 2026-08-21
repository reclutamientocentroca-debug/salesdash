/**
 * Se importa ANTES que cualquier módulo de src/lib para que la base de las
 * pruebas sea una aparte y no la de desarrollo.
 *
 * Cada archivo de prueba corre en su propio proceso y el runner los lanza en
 * paralelo, así que cada uno necesita su propia base: compartiéndola se
 * pisan y SQLite responde SQLITE_BUSY.
 *
 * Funciona porque tsx compila estos archivos a CommonJS y los `import` se
 * ejecutan en el orden en que están escritos. Si algún día el paquete pasa a
 * "type": "module", habrá que fijar SALESDASH_DB desde el script de npm.
 */
import { mkdirSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";

const archivo = basename(process.argv[1] ?? "pruebas", ".ts");
const RUTA = resolve(process.cwd(), "data", `pruebas-${archivo}.db`);

mkdirSync(resolve(process.cwd(), "data"), { recursive: true });

function limpiar() {
  for (const sufijo of ["", "-wal", "-shm"]) {
    rmSync(RUTA + sufijo, { force: true });
  }
}

// Solo al empezar: en Windows el archivo sigue abierto al salir y borrarlo da EPERM.
limpiar();

process.env.SALESDASH_DB = RUTA;
process.env.SESSION_SECRET ??= "clave-de-pruebas-suficientemente-larga-1234567890";
