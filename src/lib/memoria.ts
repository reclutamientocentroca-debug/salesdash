/**
 * SalesDash — la memoria del pedido.
 *
 * ═══ LO QUE EL CLIENTE YA DIJO NO SE VUELVE A PREGUNTAR ═══
 *
 * Decírselo al modelo en una regla no basta: en una conversación de treinta
 * mensajes, la talla que el cliente dio hace ocho turnos está tan lejos como
 * cualquier otra frase, y la vuelve a pedir. Al cliente le llega «¿qué talla?»
 * por segunda vez y entiende, con razón, que no le escuchan. Ahí se cae la
 * venta, y nadie se entera de por qué.
 *
 * Esto arma UNA FICHA con lo que ya se sabe del pedido —talla, color,
 * dirección, nombre, celular, cantidad— sacada del propio hilo y sin llamar a
 * ningún modelo: cada pregunta del agente se empareja con lo que el cliente
 * contestó justo después, y se clasifica por lo que preguntaba. La ficha va al
 * final del prompt, que es donde más pesa, y el revisor la usa para RECHAZAR
 * cualquier respuesta que vuelva a preguntar un dato que ya está en ella. La
 * memoria deja de ser un consejo y pasa a ser una puerta.
 *
 * Lo que no se reconoce se deja en blanco: un hueco se pregunta, un dato mal
 * leído se convierte en un paquete a la casa equivocada.
 */
import { agenteDePais, zonaDelCliente, type DatosPais } from "@/agents";

export interface FichaDelPedido {
  talla: string | null;
  color: string | null;
  direccion: string | null;
  nombre: string | null;
  celular: string | null;
  cantidad: string | null;
}

export type CampoDelPedido = keyof FichaDelPedido;

const VACIA: FichaDelPedido = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

/** Sin tildes ni mayúsculas, para comparar. */
function llano(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * De qué dato del pedido habla una pregunta del agente. Null si de ninguno:
 * «¿le interesa?» no es un dato.
 */
export function campoDeLaPregunta(pregunta: string): CampoDelPedido | null {
  const p = llano(pregunta);
  if (/\bcolor/.test(p)) return "color";
  if (/\btalla|numero de (zapato|calzado)|\bmedida\b/.test(p)) return "talla";
  if (/a nombre de|su nombre|como se llama|nombre completo/.test(p)) return "nombre";
  if (/(numero|celular|telefono|whatsapp).*(llama|contact|mensajero)|a este mismo|mismo numero/.test(p)) return "celular";
  if (/direccion|donde se lo|a donde|sector|provincia|canton|corregimiento|ubicacion/.test(p)) return "direccion";
  if (/cuant[oa]s|cantidad|unidades/.test(p)) return "cantidad";
  return null;
}

/** ¿Esto parece una contestación, y no otra pregunta ni un «ok»? */
function contestaDeVerdad(campo: CampoDelPedido, texto: string): boolean {
  const t = texto.trim();
  if (!t || t.includes("?")) return false;
  const l = llano(t);
  if (campo === "celular") return true;
  if (/^(ok|okey|vale|si|s[ií]|no|hola|gracias|listo|perfecto|bien|claro)\b[.!]*$/.test(l)) return false;
  return true;
}

/** Lo que se guarda en la ficha de una contestación al celular. */
function celularDe(texto: string): string | null {
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length >= 7) return digitos;
  if (/^(s[ií]|claro|ese|este|el mismo|a este|correcto|ok|exacto)/i.test(texto.trim())) return "este mismo número";
  return null;
}

/**
 * LA FICHA, sacada del hilo.
 *
 * Dos fuentes, y la más reciente manda porque el cliente se puede corregir:
 *   1. Cada pregunta del agente con lo que el cliente contestó justo después.
 *   2. Lo que el cliente escribió por su cuenta y se reconoce solo: un sitio
 *      del país (dirección) y un número de teléfono (celular).
 */
export function fichaDelPedido(
  mensajes: { emisor: string; content: string }[],
  datos: DatosPais | null = null,
): FichaDelPedido {
  const ficha: FichaDelPedido = { ...VACIA };

  for (const [i, m] of mensajes.entries()) {
    if (m.emisor === "cliente") {
      // Un sitio del país escrito por él es su dirección hasta que dé otra.
      if (datos && zonaDelCliente(datos, m.content) !== null) ficha.direccion = m.content.trim().slice(0, 160);
      // Un número de teléfono suelto es el celular.
      const tel = m.content.match(/(?:\+?\d[\d\s().-]{8,}\d)/);
      if (tel && tel[0].replace(/\D/g, "").length >= 10) ficha.celular = tel[0].replace(/\D/g, "");
      continue;
    }
    if (m.emisor !== "ia") continue;

    const preguntas = m.content
      .split(/(?<=[?.!\n])/)
      .map((f) => f.trim())
      .filter((f) => f.endsWith("?") && f.length >= 6);
    if (!preguntas.length) continue;

    const contesto = mensajes.slice(i + 1).find((x) => x.emisor === "cliente");
    if (!contesto) continue;
    const respuesta = contesto.content.trim();

    // Si el agente hizo varias preguntas, la contestación es de la última.
    const campo = campoDeLaPregunta(preguntas[preguntas.length - 1]!);
    if (!campo || !contestaDeVerdad(campo, respuesta)) continue;

    if (campo === "celular") {
      const c = celularDe(respuesta);
      if (c) ficha.celular = c;
    } else {
      ficha[campo] = respuesta.slice(0, campo === "direccion" ? 160 : 60);
    }
  }

  return ficha;
}

const ETIQUETAS: Record<CampoDelPedido, string> = {
  talla: "Talla",
  color: "Color",
  direccion: "Dirección",
  nombre: "Nombre con el que recibe",
  celular: "Celular al que llama el mensajero",
  cantidad: "Cantidad",
};

/** La ficha, escrita para el modelo. Vacía si todavía no se sabe nada. */
export function fichaParaModelo(f: FichaDelPedido): string {
  const sabidos = (Object.keys(ETIQUETAS) as CampoDelPedido[]).filter((k) => f[k]);
  if (!sabidos.length) return "";

  const lineas = (Object.keys(ETIQUETAS) as CampoDelPedido[]).map((k) =>
    f[k] ? `- ${ETIQUETAS[k]}: ${f[k]}` : `- ${ETIQUETAS[k]}: (falta)`,
  );

  return (
    "\n\nFICHA DEL PEDIDO — lo que este cliente YA TE DIO. Es tuyo: úsalo tal cual en el pedido y NO lo vuelvas a preguntar, ni «para confirmar», ni con otras palabras.\n" +
    lineas.join("\n") +
    "\nLo que dice «(falta)» es LO ÚNICO que te queda por preguntar, en el orden del cierre y de uno en uno. Si el cliente pregunta algo, se lo contestas primero y después pides lo que falte."
  );
}

/** Cómo suena una pregunta por cada dato, en el borrador del agente. */
const PREGUNTA_POR: Record<CampoDelPedido, RegExp> = {
  talla: /[¿?][^?¿]*\b(que|cual|de que)\b[^?¿]*\btalla\b[^?¿]*\?/i,
  color: /[¿?][^?¿]*\bcolor\b[^?¿]*\?/i,
  direccion: /[¿?][^?¿]*(direccion|donde se lo|a donde|en que (sector|provincia|canton|corregimiento))[^?¿]*\?/i,
  nombre: /[¿?][^?¿]*(a nombre de quien|su nombre|como se llama)[^?¿]*\?/i,
  celular: /[¿?][^?¿]*((numero|celular|telefono)[^?¿]*(llama|contact|mensajero)|a este mismo|mismo numero)[^?¿]*\?/i,
  cantidad: /[¿?][^?¿]*\b(cuant[oa]s|cantidad)\b[^?¿]*\?/i,
};

/**
 * Las preguntas del borrador que ya están contestadas en la ficha. Cada una
 * es una falla con la que el revisor para la respuesta.
 */
export function preguntasRepetidas(borrador: string, f: FichaDelPedido): string[] {
  const b = llano(borrador);
  const fallas: string[] = [];
  for (const campo of Object.keys(PREGUNTA_POR) as CampoDelPedido[]) {
    if (!f[campo]) continue;
    if (PREGUNTA_POR[campo].test(b)) {
      fallas.push(`vuelve a preguntar ${ETIQUETAS[campo].toLowerCase()}, y el cliente ya lo dijo: «${f[campo]}»`);
    }
  }
  return fallas;
}

/** Atajo: la ficha del hilo de un canal, por el código de su país. */
export function fichaDelHilo(mensajes: { emisor: string; content: string }[], pais: string | null | undefined): FichaDelPedido {
  return fichaDelPedido(mensajes, agenteDePais(pais));
}
