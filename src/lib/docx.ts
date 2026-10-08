/**
 * Saca el texto de un .docx sin dependencias.
 *
 * Un .docx es un zip y el texto vive en `word/document.xml`. Se lee el
 * directorio central del zip, se descomprime esa sola entrada (almacenada o
 * deflate, que son las dos que usa Word) y se recorren los párrafos.
 */
import { inflateRawSync } from "node:zlib";

const FIRMA_FIN_DIRECTORIO = 0x06054b50;
const FIRMA_ENTRADA_CENTRAL = 0x02014b50;
const FIRMA_ENTRADA_LOCAL = 0x04034b50;

/** El tope de lo que se descomprime: un zip bomba no puede comerse la memoria. */
const MAX_DESCOMPRIMIDO = 20 * 1024 * 1024;

function leerEntrada(zip: Buffer, nombreBuscado: string): Buffer | null {
  // El registro de fin de directorio está en los últimos 64 KB (22 + comentario).
  let fin = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === FIRMA_FIN_DIRECTORIO) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("El archivo no es un .docx válido");

  const total = zip.readUInt16LE(fin + 10);
  let pos = zip.readUInt32LE(fin + 16);

  for (let n = 0; n < total; n++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== FIRMA_ENTRADA_CENTRAL) break;

    const metodo = zip.readUInt16LE(pos + 10);
    const tamComprimido = zip.readUInt32LE(pos + 20);
    const largoNombre = zip.readUInt16LE(pos + 28);
    const largoExtra = zip.readUInt16LE(pos + 30);
    const largoComentario = zip.readUInt16LE(pos + 32);
    const desplazamiento = zip.readUInt32LE(pos + 42);
    const nombre = zip.toString("utf8", pos + 46, pos + 46 + largoNombre);

    if (nombre === nombreBuscado) {
      if (zip.readUInt32LE(desplazamiento) !== FIRMA_ENTRADA_LOCAL) throw new Error("El .docx está dañado");
      const inicio = desplazamiento + 30 + zip.readUInt16LE(desplazamiento + 26) + zip.readUInt16LE(desplazamiento + 28);
      const datos = zip.subarray(inicio, inicio + tamComprimido);

      if (metodo === 0) return Buffer.from(datos);
      if (metodo === 8) return inflateRawSync(datos, { maxOutputLength: MAX_DESCOMPRIMIDO });
      throw new Error("El .docx usa una compresión no admitida");
    }

    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return null;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] === "#") {
      const codigo = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : "";
    }
    return ENTIDADES[e.toLowerCase()] ?? todo;
  });
}

export function textoDeDocx(archivo: Buffer): string {
  const xml = leerEntrada(archivo, "word/document.xml");
  if (!xml) throw new Error("El .docx no tiene texto que leer");

  const parrafos = xml
    .toString("utf8")
    .split(/<\/w:p>/)
    .map((p) => {
      // Solo cuentan los trozos de texto, los tabuladores y los saltos de línea;
      // lo demás (campos, instrucciones, propiedades) no es lo que se lee.
      let linea = "";
      for (const t of p.matchAll(/<w:t\b[^>/]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
        linea += t[1] !== undefined ? decodificar(t[1]) : t[0].startsWith("<w:tab") ? "\t" : "\n";
      }
      return linea.trimEnd();
    });

  return parrafos.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
