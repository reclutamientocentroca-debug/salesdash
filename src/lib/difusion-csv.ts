/**
 * SalesDash — sube un CSV de clientes para una difusión.
 *
 * SIN LIBRERÍA NUEVA A PROPÓSITO: el proyecto es deliberadamente liviano
 * (Baileys y better-sqlite3 ya son las dependencias pesadas), y un CSV de dos
 * columnas cabe en un parser de unas líneas. Se pide CSV y no Excel: en dos
 * clics —Archivo → Guardar como → CSV— cualquier hoja de cálculo lo exporta.
 * Si algún día hace falta leer un `.xlsx` real, esa es una dependencia nueva
 * y una decisión aparte.
 */
import { normalizarTelefono } from "@/lib/telefono";

export interface ClienteCsv {
  telefono: string;
  nombre: string | null;
}

function partirLinea(linea: string, separador: string): string[] {
  return linea.split(separador).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
}

/** ¿Esta columna, tal cual viene del CSV, es un teléfono? Al menos 7 dígitos, sea cual sea el formato. */
function pareceTelefono(campo: string): boolean {
  return normalizarTelefono(campo).length >= 7;
}

/** ¿Esta fila es la cabecera («nombre,telefono») y no un cliente de verdad? */
function esCabecera(campos: string[]): boolean {
  return campos.every((c) => !pareceTelefono(c)) && /nombre|telefono|tel[eé]fono|phone|name|celular/i.test(campos.join(" "));
}

/**
 * Lee un CSV de nombre y teléfono, en cualquier orden de columnas y con coma
 * o punto y coma. Descarta las filas sin un teléfono reconocible: no se
 * inventa a quién mandarle nada.
 */
export function parsearCsv(texto: string): ClienteCsv[] {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lineas.length) return [];

  const separador = lineas[0]!.includes(";") && !lineas[0]!.includes(",") ? ";" : ",";
  const clientes: ClienteCsv[] = [];

  for (const [i, linea] of lineas.entries()) {
    const campos = partirLinea(linea, separador);
    if (i === 0 && esCabecera(campos)) continue;

    const telefonoCrudo = campos.find(pareceTelefono);
    if (!telefonoCrudo) continue;

    const telefono = normalizarTelefono(telefonoCrudo);
    const nombre = campos.find((c) => c !== telefonoCrudo && c.length > 0) ?? null;

    clientes.push({ telefono, nombre });
  }

  return clientes;
}
