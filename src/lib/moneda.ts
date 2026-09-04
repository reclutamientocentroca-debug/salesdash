/**
 * SalesDash — el dinero se cuenta en la moneda de cada país.
 *
 * Un canal de República Dominicana factura en pesos, uno de Costa Rica en
 * colones y uno de Panamá en dólares. Sumar los tres en una sola cifra da un
 * número que no es de ninguna moneda: RD$2,750 más ₡23.500 más US$45 no son
 * «26.295» de nada. El panel enseña cada importe con su símbolo y, cuando hay
 * varias monedas, una línea por moneda; la suma cruzada no existe.
 *
 * La moneda sale del país del agente del canal —el mismo archivo del que sale
 * cómo la escribe el agente al cliente—, así que el panel y el chat escriben
 * los importes igual.
 */
import { agenteDePais } from "@/agents/paises";

export interface Moneda {
  /** «DOP», «CRC», «USD». Vacío cuando el canal no tiene país. */
  codigo: string;
  /** Como lo escribe la gente del país: «RD$», «₡», «US$». */
  simbolo: string;
  /** Separador de miles: «,» en Santo Domingo, «.» en San José. */
  miles: "," | ".";
  /** Cuántos decimales se escriben. Los pesos y los colones van sin ellos. */
  decimales: number;
}

/** Sin país no hay moneda: el importe se escribe a secas, como hasta ahora. */
export const SIN_MONEDA: Moneda = Object.freeze({ codigo: "", simbolo: "", miles: ",", decimales: 0 });

/** La moneda del país de un canal, o `SIN_MONEDA` si no tiene país conocido. */
export function monedaDelPais(codigoPais: string | null | undefined): Moneda {
  const d = agenteDePais(codigoPais);
  if (!d) return SIN_MONEDA;
  return {
    codigo: d.moneda.codigo,
    simbolo: d.moneda.simbolo,
    miles: d.moneda.miles === "." ? "." : ",",
    decimales: d.moneda.decimales,
  };
}

/** ¿Es la misma moneda? Dos canales sin país comparten «ninguna». */
export function mismaMoneda(a: Moneda, b: Moneda): boolean {
  return a.codigo === b.codigo;
}

/**
 * «RD$2,750», «₡23.500», «US$45.00». La misma forma que usa el agente en el
 * chat, para que el dueño lea en el panel lo que el cliente leyó en WhatsApp.
 */
export function formatearImporte(monto: number | null | undefined, moneda: Moneda = SIN_MONEDA): string {
  if (monto === null || monto === undefined) return "—";
  const fijo = Math.abs(monto).toFixed(moneda.decimales);
  const [entero, decimales] = fijo.split(".");
  const conMiles = (entero ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, moneda.miles);
  const separadorDecimal = moneda.miles === "," ? "." : ",";
  const signo = monto < 0 ? "-" : "";
  return `${signo}${moneda.simbolo}${conMiles}${decimales ? `${separadorDecimal}${decimales}` : ""}`;
}

/**
 * LEE UN IMPORTE ESCRITO A MANO: «RD$2,750», «₡23.500», «US$5.00», «1.234,50».
 *
 * La regla es la de la gente, no la de un país: un separador seguido de
 * exactamente tres cifras es de miles («2,750», «23.500»); seguido de una o
 * dos, es decimal («5.00», «1234,5»). Si hay dos separadores distintos, el
 * último es el decimal. Devuelve null si no hay ningún número.
 */
export function leerImporte(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const m = texto.match(/\d[\d.,\s]*\d|\d/);
  if (!m) return null;
  const crudo = m[0].replace(/\s+/g, "");

  const ultimoPunto = crudo.lastIndexOf(".");
  const ultimaComa = crudo.lastIndexOf(",");
  const ultimo = Math.max(ultimoPunto, ultimaComa);

  let entero = crudo;
  let decimal = "";
  if (ultimo >= 0) {
    const cola = crudo.slice(ultimo + 1);
    const hayDosSeparadores = ultimoPunto >= 0 && ultimaComa >= 0;
    const esDecimal = hayDosSeparadores || cola.length !== 3;
    if (esDecimal) {
      entero = crudo.slice(0, ultimo);
      decimal = cola;
    }
  }
  const n = Number(`${entero.replace(/[.,]/g, "") || "0"}${decimal ? `.${decimal.replace(/[.,]/g, "")}` : ""}`);
  return Number.isFinite(n) ? n : null;
}

/**
 * EL TOTAL Y EL ENVÍO DEL RESUMEN DE PEDIDO, leídos del propio texto.
 *
 * Es lo que hace que una venta entre en el panel CON su dinero en cuanto se
 * cierra, sin esperar a que el analista pase por el hilo. El resumen ya dice
 * «Costo de envío: RD$250» y «Total a pagar: RD$2,750»; leerlo no necesita un
 * modelo. El analista, cuando pase, lo confirma o lo corrige.
 */
export function montosDelResumen(texto: string | null | undefined): { total: number | null; envio: number | null } {
  const salida = { total: null as number | null, envio: null as number | null };
  if (!texto) return salida;

  const llano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/^[\s*\-•📋👤📱📍💰🚚💵]+/u, "").trim();
    if (!linea.includes(":")) continue;
    const [etiqueta, ...resto] = linea.split(":");
    const valor = resto.join(":");
    const e = llano(etiqueta ?? "");

    if (salida.total === null && /^total\b/.test(e)) {
      salida.total = leerImporte(valor);
    } else if (salida.envio === null && /(^|\b)(costo de(l)? )?env[ií]o\b/.test(e) && !/^total/.test(e)) {
      salida.envio = leerImporte(valor);
    }
  }
  return salida;
}
