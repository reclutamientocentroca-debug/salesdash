import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 y argon2 son módulos nativos: no deben pasar por el bundler
  serverExternalPackages: ["better-sqlite3", "argon2"],
};

export default nextConfig;
