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

/**
 * Extensión ↔ mime para lo que puede llegar de fuera. WhatsApp (Baileys) SIEMPRE
 * entrega la nota de voz en ogg/opus y la foto en jpeg, así que `guardar()` no
 * necesitaba saber de más formatos. Pero Messenger e Instagram no entregan
 * bytes: mandan una URL, y el content-type de esa URL no es siempre el mismo
 * —una nota de voz puede llegar como audio/mpeg, audio/mp4 o hasta video/mp4
 * con solo pista de audio—. Sin esta tabla, `descargarMedia` no sabría con qué
 * extensión guardar lo que bajó, y `transcribirAudio` —que saca el formato de
 * la extensión del archivo— le mandaría al modelo un formato que no es el real.
 */
export const EXT_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/x-m4a": "m4a",
  // Notas de voz de Messenger, servidas como vídeo sin imagen.
  "video/mp4": "mp4",
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
 *
 * `ext`, si se da, manda sobre la extensión por defecto del tipo: es lo que
 * usa `descargarMedia` para guardar el formato REAL de lo que bajó de
 * Messenger/Instagram, en vez de forzarlo siempre a jpg u ogg.
 */
export function guardar(orgId: number, idMensaje: string, tipo: "imagen" | "audio", datos: Buffer, ext?: string): string | null {
  if (datos.length === 0 || datos.length > MAX_BYTES) return null;

  const extension = ext || TIPOS[tipo]!.ext;
  const nombre = `${createHash("sha256").update(idMensaje).digest("hex").slice(0, 32)}.${extension}`;

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
  const mime =
    Object.values(TIPOS).find((t) => t.ext === ext)?.mime ??
    Object.entries(EXT_POR_MIME).find(([, e]) => e === ext)?.[0] ??
    "application/octet-stream";

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

/**
 * DESCARGA UNA IMAGEN DE FUERA, para lo que llega como enlace y no como bytes.
 *
 * WhatsApp manda la miniatura del anuncio DENTRO del mensaje —Baileys la
 * entrega en bytes y no hay nada que pedir—. Messenger no: en su referral
 * manda `photo_url`, un enlace al CDN de Facebook. Sin esta función, el mismo
 * anuncio se describe cuando el cliente llega por WhatsApp y no se describe
 * cuando llega por Messenger, que es la mitad de la publicidad.
 *
 * Los tres límites son los mismos que gobiernan todo este archivo, y ninguno
 * es decorativo:
 *
 *   - EL TIEMPO. Esto corre dentro de la petición del webhook, y Meta
 *     desactiva un webhook que tarda. Cuatro segundos es de sobra para una
 *     imagen de anuncio y es poco para hacer daño: si no llega, se sigue sin
 *     ella y el agente conserva el título.
 *   - EL TAMAÑO, dos veces. Antes de leer, por lo que diga la cabecera; y
 *     después, por lo que de verdad pesa, porque `content-length` puede venir
 *     mentido o no venir.
 *   - EL TIPO. Solo imágenes. Un anuncio de vídeo devuelve la miniatura en
 *     `video_url`, pero si algún día devolviera el vídeo entero, aquí se para.
 *
 * Devuelve null ante cualquier problema y NUNCA lanza: el anuncio es contexto,
 * y quedarse sin él no puede impedir que entre el mensaje del cliente.
 */
export async function descargarImagen(url: string, timeoutMs = 4000): Promise<Buffer | null> {
  if (!/^https:\/\//i.test(url)) return null;

  const corte = AbortSignal.timeout(timeoutMs);

  try {
    const r = await fetch(url, { signal: corte, redirect: "follow" });
    if (!r.ok) return null;

    const tipo = r.headers.get("content-type") ?? "";
    if (!tipo.startsWith("image/")) return null;

    const declarado = Number(r.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > MAX_BYTES) return null;

    const datos = Buffer.from(await r.arrayBuffer());
    return datos.length > 0 && datos.length <= MAX_BYTES ? datos : null;
  } catch {
    return null;
  }
}

export interface MediaDescargada {
  datos: Buffer;
  /** La extensión real, según el content-type que devolvió el servidor. Ver `guardar`. */
  ext: string;
}

/**
 * LO MISMO QUE `descargarImagen`, PERO PARA CUALQUIER ARCHIVO DEL CLIENTE —foto
 * o nota de voz—, no solo la creatividad del anuncio.
 *
 * El agujero que tapa: en Meta (Messenger/Instagram) el mensaje del CLIENTE
 * también llega como una URL del CDN de Facebook, igual que la del anuncio,
 * pero nadie la bajaba —`descargarImagen` es solo para la imagen del anuncio—.
 * `mediaUrl` se guardaba tal cual, la URL remota, y `comoDataUrl` solo sabe
 * leer un archivo LOCAL: para todo mensaje de un cliente por Messenger o
 * Instagram con foto o audio, la IA nunca llegaba a verlo ni a oírlo, sin que
 * saltara ningún error —`comoDataUrl` simplemente no encontraba el archivo—.
 *
 * Messenger no siempre manda el mismo content-type para una nota de voz —a
 * veces `audio/mpeg`, a veces `video/mp4` con solo pista de audio—, así que
 * se acepta esa variante cuando se pide audio, y se devuelve la extensión real
 * para que `guardar` no la fuerce siempre a `.ogg`.
 */
export async function descargarMedia(
  url: string,
  familia: "imagen" | "audio",
  timeoutMs = 6000,
): Promise<MediaDescargada | null> {
  if (!/^https:\/\//i.test(url)) return null;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    if (!r.ok) return null;

    const mime = (r.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const prefijo = familia === "imagen" ? "image/" : "audio/";
    const esDeLaFamilia = mime.startsWith(prefijo) || (familia === "audio" && mime === "video/mp4");
    if (!esDeLaFamilia) return null;

    const declarado = Number(r.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > MAX_BYTES) return null;

    const datos = Buffer.from(await r.arrayBuffer());
    if (datos.length === 0 || datos.length > MAX_BYTES) return null;

    const ext = EXT_POR_MIME[mime] ?? TIPOS[familia]!.ext;
    return { datos, ext };
  } catch {
    return null;
  }
}
