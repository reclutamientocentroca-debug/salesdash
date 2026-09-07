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
 * ═══ Y LA MEMORIA ES DE ESTA COMPRA, NO DEL HILO ENTERO ═══
 *
 * Un cliente que vuelve tres días después por otro anuncio empieza otro
 * pedido. Si la ficha leyera el hilo entero, «sabría» la talla y la dirección
 * del pedido anterior, daría por hecho todo, saltaría al teléfono y emparejaría
 * un «¿a nombre de quién?» de la semana pasada con el «quiero información» de
 * hoy —y eso salió a un cliente, como resumen, con su frase entera en la línea
 * del nombre—. Por eso la ficha solo mira LA SESIÓN ACTUAL: desde el último
 * mensaje del cliente que llegó tras un silencio largo. Lo anterior sigue en
 * el hilo para que el modelo lo lea, pero no se da por dicho.
 *
 * Lo que no se reconoce se deja en blanco: un hueco se pregunta, un dato mal
 * leído se convierte en un paquete a la casa equivocada.
 */
import { agenteDePais, zonaDelCliente, type DatosPais } from "@/agents";
import { esUbicacion } from "./ubicacion";

export interface FichaDelPedido {
  talla: string | null;
  color: string | null;
  direccion: string | null;
  nombre: string | null;
  celular: string | null;
  cantidad: string | null;
}

export type CampoDelPedido = keyof FichaDelPedido;

/** Un mensaje del hilo, con lo mínimo que la memoria necesita. */
export interface MensajeDeMemoria {
  emisor: string;
  content: string;
  /** Segundos. Sin él no se puede separar una sesión de otra y se toma todo. */
  created_at?: number;
}

/** Un silencio de más de esto abre otra sesión: otra compra. */
export const SESION_HORAS = 12;

/** Una contestación que llega más tarde que esto no contesta a esa pregunta. */
const RESPUESTA_HORAS = 6;

/** «soy talla 34», «talla M», «la talla es 42», «uso la 40», «calzo 39». */
const TALLA_DICHA =
  /(?:\btalla\b\s*(?:es\s+)?(?:la\s+)?|\b(?:uso|calzo|llevo)\s+(?:la\s+)?)(\d{1,2}(?:[.,]5)?|xs|s|m|l|xl|xxl|xxxl|[23]xl)\b(?![\d.,])/i;

const VACIA: FichaDelPedido = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

/** Sin tildes ni mayúsculas, para comparar. */
function llano(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * DÓNDE EMPIEZA LA SESIÓN ACTUAL: el índice del último mensaje del cliente
 * que llegó después de un silencio de más de `SESION_HORAS`. Sin fechas, o
 * sin silencios, es el principio del hilo.
 */
export function inicioDeSesion(mensajes: MensajeDeMemoria[], horas = SESION_HORAS): number {
  let inicio = 0;
  for (let i = 1; i < mensajes.length; i++) {
    const m = mensajes[i]!;
    const previo = mensajes[i - 1]!;
    if (m.emisor !== "cliente") continue;
    if (m.created_at === undefined || previo.created_at === undefined) continue;
    if (m.created_at - previo.created_at > horas * 3600) inicio = i;
  }
  return inicio;
}

/** Los mensajes de la sesión actual. Ver `inicioDeSesion`. */
export function mensajesDeLaSesion<T extends MensajeDeMemoria>(mensajes: T[], horas = SESION_HORAS): T[] {
  return mensajes.slice(inicioDeSesion(mensajes, horas));
}

/**
 * ¿EL CLIENTE VUELVE? Hay conversación anterior y esta empieza tras un
 * silencio largo. Entonces se saluda otra vez y el pedido empieza de cero.
 */
export function esClienteQueVuelve(mensajes: MensajeDeMemoria[], horas = SESION_HORAS): boolean {
  return inicioDeSesion(mensajes, horas) > 0;
}

/**
 * ¿ES LA APERTURA? Nadie de la casa —ni el agente ni una persona— ha escrito
 * todavía en la sesión actual. El caso real (Costa Rica, 2026-09-05): con
 * «cliente que vuelve» valiendo para toda la sesión, el agente saludó y
 * presentó el producto TRES veces seguidas. La apertura es un momento, no un
 * estado: en cuanto alguien contesta, ya pasó.
 */
export function esAperturaDeSesion(mensajes: MensajeDeMemoria[], horas = SESION_HORAS): boolean {
  return mensajesDeLaSesion(mensajes, horas).every((m) => m.emisor === "cliente");
}

/**
 * De qué dato del pedido habla una pregunta del agente. Null si de ninguno:
 * «¿le interesa?» no es un dato.
 */
export function campoDeLaPregunta(pregunta: string): CampoDelPedido | null {
  const p = llano(pregunta);
  if (/\bcolor/.test(p)) return "color";
  // El celular va antes que la talla: «¿a qué número le llama el mensajero?» también dice «número».
  if (/(numero|celular|telefono|whatsapp).*(llama|contact|mensajero)|a este mismo|mismo numero|numero de (telefono|celular|whatsapp)|su (telefono|celular)|facilita su numero|su numero de contacto/.test(p)) return "celular";
  // «¿Qué número calza?» pregunta la talla: el caso real fue un «39» que nadie tomó.
  if (/\btalla|numero de (zapato|calzado)|numero (que )?(calza|usa)|que numero (calza|usa|es|necesita|quiere|lleva)|\bsize\b|\bmedida\b/.test(p)) return "talla";
  if (/a nombre de|su nombre|como se llama|nombre completo/.test(p)) return "nombre";
  if (/direccion|donde se lo|a donde|sector|provincia|canton|corregimiento|ubicacion/.test(p)) return "direccion";
  if (/cuant[oa]s|cantidad|unidades/.test(p)) return "cantidad";
  return null;
}

/**
 * Lo que escribe alguien que ACABA de llegar, no alguien que contesta: un
 * «quiero más información» nunca es un nombre ni una dirección.
 */
const APERTURA =
  /\b(informaci[oó]n|\binfo\b|quiero saber|me interesa|disponible|precio|cu[aá]nto (cuesta|vale|es)|hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|negocio|anuncio|catalogo|cat[aá]logo|gracias)\b/i;

/** ¿Esto parece una contestación a ESE dato, y no otra cosa? */
function contestaDeVerdad(campo: CampoDelPedido, texto: string): boolean {
  const t = texto.trim();
  if (!t || t.includes("?")) return false;
  const l = llano(t);
  if (campo === "celular") return true;
  if (/^(ok|okey|vale|si|s[ií]|no|hola|gracias|listo|perfecto|bien|claro)\b[.!]*$/.test(l)) return false;
  if (APERTURA.test(t)) return false;

  const palabras = t.split(/\s+/).length;
  switch (campo) {
    case "nombre":
      // Un nombre son de una a cuatro palabras de letras: ni frases ni números.
      return palabras <= 4 && /^[\p{L}][\p{L}'’.\- ]*$/u.test(t);
    case "talla":
      return t.length <= 25;
    case "color":
      return t.length <= 40;
    case "cantidad":
      return /\d|\b(un[oa]?|dos|tres|cuatro|cinco|seis|par|pares)\b/i.test(t);
    case "direccion":
      return palabras >= 2 || t.length >= 8;
  }
}

/** Lo que se guarda en la ficha de una contestación al celular. */
function celularDe(texto: string): string | null {
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length >= 7) return digitos;
  if (/^(s[ií]|claro|ese|este|el mismo|a este|correcto|ok|exacto)/i.test(texto.trim())) return "este mismo número";
  return null;
}

/**
 * LA FICHA, sacada de la sesión actual del hilo.
 *
 * Dos fuentes, y la más reciente manda porque el cliente se puede corregir:
 *   1. Cada pregunta del agente con lo que el cliente contestó justo después,
 *      si contestó dentro de unas horas.
 *   2. Lo que el cliente escribió por su cuenta y se reconoce solo: un sitio
 *      del país (dirección) y un número de teléfono (celular).
 */
export function fichaDelPedido(
  mensajes: MensajeDeMemoria[],
  datos: DatosPais | null = null,
): FichaDelPedido {
  const inicio = inicioDeSesion(mensajes);
  const ficha = fichaDe(mensajes.slice(inicio), datos);

  /*
   * LO QUE NO CAMBIA DE UN PEDIDO A OTRO SE HEREDA. El caso real: el cliente
   * dio su teléfono, pasó la noche, y al día siguiente el agente se lo volvió
   * a pedir. El nombre, el celular y la dirección son de la persona, no de la
   * compra: si esta sesión no los trae, valen los de la anterior. La talla, el
   * color y la cantidad sí son de esta compra y empiezan de cero.
   */
  if (inicio > 0) {
    const previa = fichaDe(mensajes.slice(0, inicio), datos);
    for (const k of ["nombre", "celular", "direccion"] as const) {
      if (!ficha[k] && previa[k]) ficha[k] = previa[k];
    }
  }
  return ficha;
}

/** La ficha de UNA lista de mensajes, tal cual, sin mirar sesiones. */
function fichaDe(sesion: MensajeDeMemoria[], datos: DatosPais | null): FichaDelPedido {
  const ficha: FichaDelPedido = { ...VACIA };

  for (const [i, m] of sesion.entries()) {
    if (m.emisor === "cliente") {
      // Un sitio del país escrito por él es su dirección hasta que dé otra.
      // «¿Envían a Las Matas de Farfán?» es una pregunta, no su dirección.
      if (datos && !APERTURA.test(m.content) && !m.content.includes("?") && zonaDelCliente(datos, m.content) !== null) {
        ficha.direccion = m.content.trim().slice(0, 160);
      }
      // Un número de teléfono suelto es el celular.
      const tel = m.content.match(/(?:\+?\d[\d\s().-]{8,}\d)/);
      if (tel && tel[0].replace(/\D/g, "").length >= 10) ficha.celular = tel[0].replace(/\D/g, "");
      // «Soy talla 34», «talla M», «uso la 40»: la talla dicha por su cuenta,
      // aunque nadie la haya preguntado en esta sesión (Costa Rica, 2026-09-05).
      if (!m.content.includes("?")) {
        const talla = m.content.match(TALLA_DICHA);
        if (talla) ficha.talla = talla[1].toUpperCase();
      }
      continue;
    }
    // La pregunta de una persona del equipo también cuenta: el cliente le
    // contesta igual, y ese dato es del pedido.
    if (m.emisor !== "ia" && m.emisor !== "humano") continue;

    const preguntas = m.content
      .split(/(?<=[?.!\n])/)
      .map((f) => f.trim())
      // Una petición en imperativo («Indique su dirección exacta de entrega.») también pregunta.
      .filter((f) => (f.endsWith("?") || /^(indique|ind[ií]queme|me indica|d[ií]game|escr[ií]bame)\b/i.test(f)) && f.length >= 6);
    if (!preguntas.length) continue;

    const contesto = sesion.slice(i + 1).find((x) => x.emisor === "cliente");
    if (!contesto) continue;
    if (
      contesto.created_at !== undefined &&
      m.created_at !== undefined &&
      contesto.created_at - m.created_at > RESPUESTA_HORAS * 3600
    ) {
      continue;
    }
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

  // La cantidad nunca «falta»: es 1 salvo que el cliente haya dicho otra.
  const lineas = (Object.keys(ETIQUETAS) as CampoDelPedido[]).map((k) =>
    f[k] ? `- ${ETIQUETAS[k]}: ${f[k]}`
      : k === "cantidad" ? "- Cantidad: 1 (no se pregunta; solo cambia si el cliente dice que quiere más)"
        : `- ${ETIQUETAS[k]}: (falta)`,
  );

  return (
    "\n\nFICHA DEL PEDIDO — lo que este cliente YA TE DIO en esta conversación. Es tuyo: úsalo tal cual en el pedido y NO lo vuelvas a preguntar, ni «para confirmar», ni con otras palabras.\n" +
    lineas.join("\n") +
    "\nLo que dice «(falta)» es LO ÚNICO que te queda por preguntar, en el orden del cierre y de uno en uno. Si el cliente pregunta algo, se lo contestas primero y después pides lo que falte."
  );
}

/**
 * EL AVISO DE QUE EL CLIENTE VUELVE. Va al final del prompt cuando la sesión
 * actual empieza tras un silencio largo y hay conversación anterior.
 */
export function avisoDeClienteQueVuelve(mensajes: MensajeDeMemoria[]): string {
  if (!esClienteQueVuelve(mensajes)) return "";
  // Ya se le contestó en esta sesión: el saludo ya pasó, y no se repite.
  if (!esAperturaDeSesion(mensajes)) {
    return (
      "\n\nESTE CLIENTE VOLVIÓ A ESCRIBIR DESPUÉS DE UN TIEMPO y en esta sesión YA se le saludó y se le presentó el artículo: no vuelvas a saludar ni a presentarlo. " +
      "Lo de arriba de la conversación, antes del silencio, es de otro día: la talla, el color y la cantidad de entonces no valen; el nombre, el celular y la dirección sí, si están en la ficha. " +
      "Sigue con el paso que toca."
    );
  }
  return (
    "\n\nESTE CLIENTE VUELVE A ESCRIBIR DESPUÉS DE UN TIEMPO: lo de arriba de la conversación es de otro día y de otro pedido. " +
    "Esta es una conversación NUEVA: salúdalo otra vez como la primera vez, con el artículo del anuncio de ahora y su precio, y empieza el pedido desde la talla. " +
    "La talla, el color y la cantidad de la vez anterior NO valen para este pedido: se vuelven a pedir en su paso, y no le llegó ninguna ubicación hoy. " +
    "El nombre, el celular y la dirección son de la persona y sí valen: si están en la ficha del pedido del final, úsalos tal cual y no los vuelvas a preguntar."
  );
}

/** Cómo suena una pregunta por cada dato, en el borrador del agente. */
const PREGUNTA_POR: Record<CampoDelPedido, RegExp> = {
  talla: /[¿?][^?¿]*(\b(que|cual|de que)\b[^?¿]*\btalla\b|numero (que )?(calza|usa)|numero de (zapato|calzado)|\bsize\b)[^?¿]*\?/i,
  color: /[¿?][^?¿]*\bcolor\b[^?¿]*\?/i,
  direccion: /[¿?][^?¿]*(direccion|donde se lo|a donde|donde (esta|vive|se encuentra)|en que (sector|provincia|canton|corregimiento|zona)|ubicacion)[^?¿]*\?/i,
  nombre: /[¿?][^?¿]*(a nombre de quien|su nombre|como se llama)[^?¿]*\?/i,
  celular: /[¿?][^?¿]*((numero|celular|telefono)[^?¿]*(llama|contact|mensajero)|a este mismo|mismo numero|numero de (telefono|celular|whatsapp)|su (telefono|celular)|facilita su numero)[^?¿]*\?/i,
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

/** ¿El cliente compartió su ubicación por el mapa EN ESTA SESIÓN? */
export function clienteCompartioUbicacion(mensajes: MensajeDeMemoria[]): boolean {
  return mensajesDeLaSesion(mensajes).some((m) => m.emisor === "cliente" && esUbicacion(m.content));
}

/** Lo que el cliente escribió en esta sesión, para comprobar el resumen contra ello. */
export function textosDelClienteEnSesion(mensajes: MensajeDeMemoria[]): string[] {
  return mensajesDeLaSesion(mensajes)
    .filter((m) => m.emisor === "cliente")
    .map((m) => m.content);
}

/** Atajo: la ficha del hilo de un canal, por el código de su país. */
export function fichaDelHilo(mensajes: MensajeDeMemoria[], pais: string | null | undefined): FichaDelPedido {
  return fichaDelPedido(mensajes, agenteDePais(pais));
}

/**
 * PIENSA COMO VENDEDORA. Va al final del prompt, después de la ficha: es lo
 * que convierte una lista de preguntas en una conversación. El caso real: el
 * cliente preguntó «¿dónde están?», contestó «39» a «¿qué número calza?», y
 * el agente mandó «¿Qué número calza?» tres veces seguidas.
 */
export const PIENSA_COMO_VENDEDOR =
  "\n\nANTES DE ESCRIBIR, LEE LO ÚLTIMO QUE DIJO EL CLIENTE Y DECIDE QUÉ ES:\n" +
  "- Si CONTESTA lo que le preguntaste —aunque sea con una palabra o un número: «39» después de «¿qué número calza?» ES el número que calza, «negro» después de «¿en qué color?» ES el color—, lo tomas como bueno y pasas al siguiente dato. No lo vuelvas a preguntar ni lo pongas en duda.\n" +
  "- Si te PREGUNTA algo —dónde están, cuánto es el envío, cómo se paga, cuánto tarda, si hay otro color—, se lo contestas PRIMERO, en una línea y con lo que sabes, y después sigues con el dato que falta. Nunca ignores una pregunta del cliente para repetir la tuya.\n" +
  "- Si dice algo que no es ni respuesta ni pregunta —un comentario, una broma, un lugar que no existe—, lo atiendes con naturalidad en una frase corta y retomas la venta donde iba.\n" +
  "- Si pregunta QUÉ TALLAS o tamaños hay, díselas primero —las de la descripción del anuncio o las de la tabla de tallas— y después pregúntale cuál quiere. Contestar «¿qué talla necesita?» a «¿qué tallas hay?» es no haber leído.\n" +
  "- NUNCA mandes dos veces seguidas el mismo mensaje ni la misma pregunta con las mismas palabras. Si no te contestó, pregúntalo de otra forma o sigue con otro dato y vuelve después.\n" +
  "- TRATO FORMAL Y DE EMPRESA, siempre: al cliente no se le llama «maestro», «jefe», «amigo», «mi amor», «mae» ni ningún apodo. Se le habla de usted, por su nombre si lo dio, o sin nada. Educada, cercana y profesional: como una vendedora de una empresa seria, no como en la calle.\n" +
  "Eres una vendedora que quiere que el cliente se sienta bien atendido hasta el cierre, no un formulario: cada mensaje tuyo responde al suyo.";
