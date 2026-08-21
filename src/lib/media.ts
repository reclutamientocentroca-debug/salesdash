/**
 * SalesDash — archivos de las conversaciones.
 *
 * UN CAMBIO DE POSTURA, Y CONVIENE SABERLO
 *
 * Antes los archivos no se guardaban: el proveedor daba una URL temporal, el
 * modelo con visión la leía, y aquí solo quedaba la descripción en texto. Al
 * conectar por QR eso dejó de ser posible — por el socket llegan bytes
 * cifrados, no enlaces. Para que una nota de voz se pueda escuchar y para que
 * la IA vea una foto, el archivo tiene que estar en algún sitio.
 *
 * Así que ahora se guardan, en el volumen, junto a la base de datos. Con tres
 * límites que acotan lo que eso implica:
 *
 *   1. SOLO imágenes y audio. Los documentos —facturas en PDF, contratos— no
 *      se descargan: son los que más datos personales llevan y no aportan nada
 *      que el texto del mensaje no diga ya.
 *   2. Tamaño máximo. Un vídeo de veinte megas por conversación llena el disco
 *      del servidor en una semana.
 *   3. Aislados por organización en carpetas separadas, y servidos solo a
 *      través de una ruta que comprueba la sesión. Nunca por URL pública.
 *
 * Al borrar una conversación se borran sus archivos: está en `eliminarCanal`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { rutaDatos } from "@/lib/db";

/** Cuatro megas. Una nota de voz larga ronda el medio mega; una foto, dos. */
export const MAX_BYTES = 4 * 1024 * 1024;

const TIPOS: Record<string, { ext: string; mime: string }> = {
  imagen: { ext: "jpg", mime: "image/jpeg" },
  audio: { ext: "ogg", mime: "audio/ogg" },
};

export function esDescargable(tipo: string): tipo is "imagen" | "audio" {
  return tipo === "imagen" || tipo === "audio";
}

function carpeta(orgId: number): string {
  return join(rutaDatos(), "media", String(orgId));
}

/**
 * Guarda el archivo y devuelve la clave con la que se pide después.
 *
 * El nombre sale de un hash del identificador del mensaje y no del propio
 * identificador: los de WhatsApp traen caracteres que no son válidos en un
 * nombre de archivo, y un identificador dentro de una ruta es una invitación a
 * que alguien pruebe a poner `../` en él.
 */
export function guardar(orgId: number, idMensaje: string, tipo: "imagen" | "audio", datos: Buffer): string | null {
  if (datos.length === 0 || datos.length > MAX_BYTES) return null;

  const { ext } = TIPOS[tipo]!;
  const nombre = `${createHash("sha256").update(idMensaje).digest("hex").slice(0, 32)}.${ext}`;

  const dir = carpeta(orgId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, nombre), datos);

  // El prefijo distingue lo guardado por nosotros de una URL externa, que es
  // lo que había antes en esta columna.
  return `local:${orgId}/${nombre}`;
}

/**
 * Lee un archivo a partir de la clave guardada, comprobando que pertenece a la
 * organización que lo pide.
 *
 * La ruta se resuelve y se compara con la carpeta de la organización en vez de
 * confiar en la clave: sin eso, un `..` en la clave leería cualquier archivo
 * del servidor. Que la clave la escribamos nosotros no basta — llega por la URL
 * y la escribe quien quiera.
 */
export function leer(orgId: number, clave: string): { datos: Buffer; mime: string } | null {
  const limpia = clave.startsWith("local:") ? clave.slice("local:".length) : clave;
  const [org, nombre] = limpia.split("/");

  if (!org || !nombre || Number(org) !== orgId) return null;

  const dir = resolve(carpeta(orgId));
  const ruta = resolve(join(dir, nombre));
  if (!ruta.startsWith(dir)) return null;
  if (!existsSync(ruta)) return null;

  const ext = nombre.split(".").pop() ?? "";
  const mime = Object.values(TIPOS).find((t) => t.ext === ext)?.mime ?? "application/octet-stream";

  return { datos: readFileSync(ruta), mime };
}

/** Para pasárselo a un modelo: los archivos no son alcanzables desde fuera. */
export function comoDataUrl(orgId: number, clave: string): string | null {
  const archivo = leer(orgId, clave);
  if (!archivo) return null;
  return `data:${archivo.mime};base64,${archivo.datos.toString("base64")}`;
}

/** La ruta pública —autenticada— con la que el navegador pide el archivo. */
export function urlServida(clave: string | null): string | null {
  if (!clave?.startsWith("local:")) return clave;
  return `/api/media/${clave.slice("local:".length)}`;
}

/** Todo lo de una organización. Se usa al borrar. */
export function borrarDeOrg(orgId: number): void {
  try {
    rmSync(carpeta(orgId), { recursive: true, force: true });
  } catch (e) {
    console.error("[media] no se pudieron borrar los archivos", e);
  }
}
