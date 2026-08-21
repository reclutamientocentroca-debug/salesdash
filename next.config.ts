import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
