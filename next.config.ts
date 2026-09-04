import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/*
 * QUÉ VERSIÓN ES ESTA. Se fija al construir y la enseña /api/salud: es la
 * única forma de saber desde fuera si el servidor corre lo último que se
 * subió o una imagen vieja. La fecha siempre existe; el commit solo si la
 * carpeta .git llegó a la construcción (en Docker no llega, y no pasa nada).
 */
function commitActual(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.SOURCE_COMMIT?.slice(0, 7) || process.env.GIT_COMMIT?.slice(0, 7) || "desconocido";
  }
}

const nextConfig: NextConfig = {
  env: {
    SALESDASH_COMMIT: commitActual(),
    SALESDASH_CONSTRUIDO: new Date().toISOString(),
  },
  /*
   * better-sqlite3 y argon2 son módulos nativos: no deben pasar por el bundler.
   *
   * baileys entra en la misma lista por otro motivo: carga descriptores de
   * protobuf y usa libsignal, y empaquetarlo rompe esas rutas en tiempo de
   * ejecución. Externalizarlo es además lo que evita meter ocho megas de
   * biblioteca dentro del bundle del servidor.
   */
  serverExternalPackages: ["better-sqlite3", "argon2", "baileys"],
};

export default nextConfig;
