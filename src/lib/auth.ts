/**
 * SalesDash — credenciales.
 *
 * Contraseñas, firma de sesiones, cifrado de los tokens de Whapi y límites de
 * intentos. Todo lo que deriva de SESSION_SECRET vive aquí, en un solo archivo
 * auditable.
 *
 * Nada de este módulo escribe una contraseña ni un token en claro a un log. Si
 * necesitas depurar, usa `enmascarar()`.
 */
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Secreto y claves derivadas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Se lee de forma perezosa: si se leyera al importar, `next build` fallaría en
 * una máquina sin el .env aunque solo esté compilando.
 */
function secreto(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "Falta SESSION_SECRET o es demasiado corto (mínimo 32 caracteres). " +
        "Genera uno con: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }
  return s;
}

/** Deriva una clave de 32 bytes por propósito. Nunca se reusa la misma. */
function derivar(proposito: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secreto()), Buffer.from("salesdash"), Buffer.from(proposito), 32),
  );
}

let cacheClaves: Record<string, Buffer> = {};
function clave(proposito: string): Buffer {
  return (cacheClaves[proposito] ??= derivar(proposito));
}

/** Solo para las pruebas, que cambian SESSION_SECRET entre casos. */
export function _olvidarClaves(): void {
  cacheClaves = {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Contraseñas
// ─────────────────────────────────────────────────────────────────────────────

export function hashPassword(plano: string): Promise<string> {
  return argon2.hash(plano, { type: argon2.argon2id });
}

export async function verificarPassword(hash: string, plano: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plano);
  } catch {
    // Hash corrupto o de otro algoritmo: se trata como contraseña incorrecta.
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sesión — cookie firmada con jose
// ─────────────────────────────────────────────────────────────────────────────

export const COOKIE_SESION = "sd_sesion";
export const DURACION_SESION = 60 * 60 * 24 * 30; // 30 días

export interface Sesion {
  userId: number;
  orgId: number;
  superadmin: boolean;
}

export async function firmarSesion(s: Sesion): Promise<string> {
  return new SignJWT({ orgId: s.orgId, sa: s.superadmin ? 1 : 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(s.userId))
    .setIssuedAt()
    .setExpirationTime(`${DURACION_SESION}s`)
    .sign(clave("sesion"));
}

export async function verificarSesion(token: string): Promise<Sesion | null> {
  try {
    const { payload } = await jwtVerify(token, clave("sesion"), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    const orgId = Number(payload.orgId);
    if (!Number.isInteger(userId) || !Number.isInteger(orgId)) return null;
    return { userId, orgId, superadmin: payload.sa === 1 };
  } catch {
    // Firma inválida, expirada o manipulada: no hay sesión.
    return null;
  }
}

/** Opciones de la cookie. `secure` solo en producción: en local no hay HTTPS. */
export function opcionesCookie() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURACION_SESION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cifrado de los tokens de Whapi — AES-256-GCM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formato: `v1.<iv>.<tag>.<datos>`, cada parte en base64url.
 * La clave se deriva de SESSION_SECRET: si ese valor cambia, los tokens
 * guardados dejan de poder descifrarse. Está avisado en .env.example.
 */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave("tokens"), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), datos.toString("base64url")].join(".");
}

export function descifrar(blob: string): string {
  const [version, iv, tag, datos] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !datos) {
    throw new Error("Token cifrado con un formato que no se reconoce");
  }
  const d = createDecipheriv("aes-256-gcm", clave("tokens"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(datos, "base64url")), d.final()]).toString("utf8");
}

/** Secreto del webhook de cada canal. */
export function secretoAleatorio(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Para mostrar un token en la interfaz sin revelarlo. */
export function enmascarar(token: string): string {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}${"•".repeat(Math.min(20, token.length - 8))}${token.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Límite de intentos
//
// En memoria del proceso, a propósito: Redis está fuera del stack y para un
// contenedor único de EasyPanel esto basta. Si algún día se corre en varias
// réplicas, el límite pasa a ser por réplica — documentado en el README.
// ─────────────────────────────────────────────────────────────────────────────

interface Cubeta { conteo: number; expira: number }
const cubetas = new Map<string, Cubeta>();

export function limitar(clave_: string, maximo: number, ventanaSegs: number): {
  ok: boolean; restantes: number; esperaSegs: number;
} {
  const t = Math.floor(Date.now() / 1000);

  // Limpieza perezosa: sin esto el Map crece indefinidamente.
  if (cubetas.size > 5000) {
    for (const [k, v] of cubetas) if (v.expira <= t) cubetas.delete(k);
  }

  const actual = cubetas.get(clave_);
  if (!actual || actual.expira <= t) {
    cubetas.set(clave_, { conteo: 1, expira: t + ventanaSegs });
    return { ok: true, restantes: maximo - 1, esperaSegs: 0 };
  }

  actual.conteo += 1;
  if (actual.conteo > maximo) {
    return { ok: false, restantes: 0, esperaSegs: actual.expira - t };
  }
  return { ok: true, restantes: maximo - actual.conteo, esperaSegs: 0 };
}

/**
 * Borra la cuenta de intentos de una clave.
 *
 * Existe para que un acierto no gaste cupo. Un limitador que cuenta también los
 * intentos correctos acaba castigando justo a quien sí sabe su contraseña: seis
 * entradas buenas en un cuarto de hora y a la séptima le dice «demasiados
 * intentos», que además es mentira. Los fallos siguen sumando, que es lo que
 * protege de verdad contra quien prueba contraseñas a ciegas.
 */
export function olvidarLimite(clave_: string): void {
  cubetas.delete(clave_);
}

export function _limpiarLimites(): void {
  cubetas.clear();
}

/** IP del cliente detrás del proxy de EasyPanel. */
export function ipDe(req: Request): string {
  const h = req.headers;
  const reenviada = h.get("x-forwarded-for");
  if (reenviada) return reenviada.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "desconocida";
}
