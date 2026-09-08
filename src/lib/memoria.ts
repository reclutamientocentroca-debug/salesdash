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
import { reColores } from "@/agents/base-comportamiento";
import { nombraUnArticulo } from "./apertura";
import { nombresDeLugar } from "./envio";
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
    // Un cliente que CONTESTA lo que se le preguntó no vuelve: termina de
    // contestar. Ver `contestaLaPreguntaPendiente`.
    if (m.created_at - previo.created_at > horas * 3600 && !contestaLaPreguntaPendiente(previo, m)) inicio = i;
  }
  return inicio;
}

/** La última pregunta de un mensaje del agente. Null si no preguntó nada. */
function ultimaPregunta(contenido: string): string | null {
  const preguntas = contenido
    .split(/(?<=[?.!\n])/)
    .map((f) => f.trim())
    // Una petición en imperativo («Indique su dirección exacta de entrega.») también pregunta.
    .filter((f) => (f.endsWith("?") || /^(indique|ind[ií]queme|me indica|d[ií]game|escr[ií]bame)\b/i.test(f)) && f.length >= 6);
  return preguntas[preguntas.length - 1] ?? null;
}

/**
 * QUÉ DATO DEJÓ PEDIDO EL AGENTE EN SU ÚLTIMO MENSAJE. Null si no pidió
 * ninguno —o si el mensaje anterior no es suyo—. Lo que el cliente escriba
 * debajo contesta a ESE dato: ver `fichaDe`.
 */
function campoPendiente(previo: MensajeDeMemoria | undefined): CampoDelPedido | null {
  if (!previo || previo.emisor !== "ia") return null;
  const pregunta = ultimaPregunta(previo.content);
  return pregunta ? campoDeLaPregunta(pregunta) : null;
}

/**
 * ¿ESTE MENSAJE CONTESTA LA PREGUNTA QUE EL AGENTE DEJÓ ABIERTA?
 *
 * El caso real de República Dominicana: al cliente se le preguntó la talla,
 * contestó «XXL» al día siguiente, y como habían pasado más de doce horas el
 * hilo empezó de cero: se perdió la talla y le salió el saludo entero por
 * segunda vez, palabra por palabra. Un «XXL» a las catorce horas no es un
 * cliente que vuelve a escribir: es el que termina de contestar, y la venta
 * sigue donde estaba.
 */
export function contestaLaPreguntaPendiente(previo: MensajeDeMemoria, mensaje: MensajeDeMemoria): boolean {
  if (previo.emisor !== "ia" || mensaje.emisor !== "cliente") return false;
  const pregunta = ultimaPregunta(previo.content);
  if (!pregunta) return false;
  const campo = campoDeLaPregunta(pregunta);
  return !!campo && contestaDeVerdad(campo, mensaje.content);
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

/**
 * LO QUE NO ESCRIBIÓ EL CLIENTE. Una foto, una nota de voz o un audio que no
 * se entendió llegan al hilo como un marcador entre corchetes —«[imagen]»,
 * «[nota de voz]», «[audio ininteligible]»—. El caso real: se le preguntó la
 * talla, mandó una nota de voz que no se entendía, y «[audio ininteligible]»
 * se guardó en la ficha COMO SU TALLA. El agente leyó la ficha y le contestó
 * «Perfecto, ya me llegó su talla. ¿Qué color prefiere?». Eso no es un dato:
 * es el hueco que dejó algo que no se pudo leer.
 */
const MARCADOR_SIN_PALABRAS = /^\[[^\]]*\]$/;

/**
 * ¿ESTO PARECE UNA DIRECCIÓN? El caso real, y el más caro de todos: a
 * «Indique su dirección exacta de entrega.» el cliente contestó «Si yo.le
 * escomprado», y eso se guardó como su dirección y salió en el resumen del
 * pedido, con su envío y su total. Un paquete a una casa que no existe.
 *
 * Vale como dirección un sitio del país, algo con un número —«Calle 3 #12»— o
 * una seña de las que se dan por aquí. Lo que no, se vuelve a preguntar: una
 * pregunta de más no cuesta nada; un envío perdido, sí.
 */
const SEÑAS_DE_DIRECCION = new RegExp(
  "\\b(calle|call?e?j[oó]n|avenida|av|ave|carretera|autopista|km|kil[oó]metro|sector|barrio|residencial|" +
    "urbanizaci[oó]n|condominio|edificio|apto|apartamento|torre|manzana|mz|solar|casa|villa|reparto|ensanche|" +
    "proyecto|frente a|al lado de|detr[aá]s de|esquina|entrada|pr[oó]ximo a|cerca de|iglesia|colmado|parque|" +
    "plaza|escuela|liceo|hospital|banco|supermercado|" +
    /*
     * Y LAS SEÑAS DE COSTA RICA, donde no hay calle ni número: la dirección se
     * da desde un punto conocido —«200 metros norte de la pulpería, portón
     * verde»— y sin estas palabras esa dirección no se reconocía como tal, así
     * que se le volvía a pedir a un cliente que ya la había dado.
     */
    "pulper[ií]a|abastecedor|gasolinera|bomba|ferreter[ií]a|panader[ií]a|soda|cl[ií]nica|ebais|sal[oó]n comunal|" +
    "cancha|r[oó]tulo|port[oó]n|tapia|sem[aá]foro|contiguo|diagonal|costado|metros? (al )?(norte|sur|este|oeste)|" +
    "cuadras?)\\b",
  "i",
);

export function pareceDireccion(texto: string, datos: DatosPais | null = null): boolean {
  const t = texto.trim();
  if (t.length < 6) return false;
  // Un sitio del país es dirección aunque venga solo: «Los Alcarrizos».
  if (datos && zonaDelCliente(datos, t) !== null) return true;
  if (SEÑAS_DE_DIRECCION.test(t)) return true;
  // «Calle 3 #12» sin la palabra «calle»: un número y algo más.
  return /\d/.test(t) && t.split(/\s+/).length >= 2;
}

/** ¿Esto parece un color? Uno de los que la casa reconoce, y no una frase. */
export function pareceColor(texto: string): boolean {
  return reColores().test(texto.trim());
}

/**
 * ¿ESTO PARECE UNA TALLA? Que lleve una talla dentro: una letra de las de la
 * tabla o un número de los que se calzan o se visten. El cliente contesta
 * «la 42», «talla M» o «XXL» en una nota de voz, y todo eso es su talla;
 * «Para cuando» no lo es, y hasta ahora se guardaba igual.
 */
export function pareceTalla(texto: string): boolean {
  const t = llano(texto).replace(/\(nota de voz\)/g, " ").trim();
  if (!t || t.length > 25) return false;
  const letra = /(^|[^\p{L}\p{N}])(x{0,3}s|m|l|x{1,3}l|unica)([^\p{L}\p{N}]|$)/u;
  const numero = /(^|\D)\d{1,2}(\.5)?(\D|$)/;
  return letra.test(t) || numero.test(t);
}

/**
 * ¿ESTO ES EL NOMBRE DE UNA PERSONA?
 *
 * El nombre del pedido es el que el cliente DA, no lo que escriba mientras se
 * lo preguntan. En la línea «Nombre:» va la persona que recibe el paquete y
 * firma: si ahí acaba una frase suya, un lugar, un color o el propio artículo,
 * el mensajero llega con un paquete a nombre de nadie.
 *
 * Se lee como lo leería una persona: son una a cuatro palabras de letras, no
 * son palabras corrientes del idioma, no son un sitio del país, ni un color,
 * ni lo que se vende. Lo que no lo parece se vuelve a preguntar.
 */
const PALABRA_QUE_NO_ES_NOMBRE =
  /^(s[ií]|no|ok|okey|okay|vale|claro|dale|listo|perfecto|gracias|hola|buenas|buenos|d[ií]as?|tardes?|noches?|favor|por|para|con|sin|que|qu[eé]|cual|cu[aá]l|cuando|cu[aá]ndo|cuanto|cu[aá]nto|como|c[oó]mo|donde|d[oó]nde|porque|pero|yo|me|mi|tu|su|el|la|lo|los|las|un|una|unos|unas|del|de|y|o|es|soy|era|esta|est[aá]|estoy|ya|eso|esa|ese|esta|aqui|aqu[ií]|alli|all[ií]|ahora|luego|hoy|ma[ñn]ana|ayer|bien|mal|mas|m[aá]s|menos|todo|nada|algo|alguien|quiero|puedo|tengo|necesito|env[ií]o|envio|precio|talla|color|numero|n[uú]mero|direccion|direcci[oó]n|pedido|producto|articulo|art[ií]culo|pago|pagar|efectivo|dinero|cuenta|whatsapp|telefono|tel[eé]fono|celular|casa|calle|sector|provincia|zona|dios|amen|am[eé]n|se[ñn]or|se[ñn]ora|don|do[ñn]a|mismo|misma|igual|igualmente|tambien|tambi[eé]n|solo|s[oó]lo|correcto|exacto|saludos|bendiciones|abrazo|abrazos|enviar|env[ií]elo|mande|m[aá]ndelo|espere|esperando)$/i;

/**
 * LO QUE SE DICE AQUÍ Y NO ES UN NOMBRE.
 *
 * EL CASO REAL DE COSTA RICA: «¿A nombre de quién sale el pedido?» → «Pura
 * vida», y el pedido salió a nombre de Pura vida. Aquí «pura vida» es hola,
 * gracias y adiós a la vez, así que un cliente la escribe en cualquier turno,
 * también cuando le preguntan cómo se llama. Y con ella «mae», «diay»,
 * «tuanis», «a la orden», «ahorita», «xopá».
 *
 * No hace falta una lista nueva: cada país ya trae las suyas escritas entre
 * comillas en su archivo (`habla.expresiones`), que es donde el dueño las
 * edita. Si mañana añade una, deja de ser un nombre el mismo día.
 */
export function expresionesDelPais(datos: DatosPais | null): string[] {
  return (datos?.habla?.expresiones ?? []).flatMap((e) =>
    [...e.matchAll(/«([^»]+)»/g)].map((m) => llano(m[1]!).trim()),
  );
}

/**
 * ¿ESTE TEXTO ES, ENTERO, UN SITIO DEL PAÍS?
 *
 * EL CASO REAL DE COSTA RICA, y el que le quitó la memoria al agente: «¿A
 * nombre de quién sale el pedido?» → «María Jiménez», y el nombre se tiraba a
 * la basura porque Jiménez es un cantón de Cartago. Con él se caían Acosta,
 * Mora, Alvarado, Flores, Osa, Corredores, Grecia y media guía telefónica del
 * país: el cliente daba su nombre, la ficha lo rechazaba, y el agente se lo
 * volvía a preguntar en el siguiente mensaje, y en el siguiente. Lo mismo en
 * República Dominicana con Duarte y con Santiago.
 *
 * Un apellido que además es un cantón no convierte a una persona en un lugar.
 * Lo que no es un nombre es el texto que ES el lugar y nada más —«Villa
 * Mella», «Los Alcarrizos»—, así que aquí se compara el texto ENTERO con los
 * nombres de sitio del país, no se busca uno dentro.
 */
function esLugarEntero(datos: DatosPais, texto: string): boolean {
  const t = llano(texto).replace(/\s+/g, " ").trim();
  if (!t) return false;
  const entradas = [
    ...datos.envio.zonas.flatMap((z) => [z.nombre, ...z.lugares]),
    ...(datos.envio.restoDelPais.lugares ?? []),
    ...datos.mapa.regiones.flatMap((r) => r.lugares),
  ];
  return entradas.flatMap(nombresDeLugar).some((l) => llano(l).replace(/\s+/g, " ").trim() === t);
}

/** Lo que el cliente pone delante de su nombre: «me llamo…», «soy…». */
const ANTES_DEL_NOMBRE = /^(me llamo|mi nombre es|el nombre es|a nombre de|es de|soy|es)\s+/i;

/** Lo que une un nombre y no cuenta como palabra: «María del Carmen». */
const PARTICULA = /^(de|del|la|las|los|y|e|da|das|di|do|dos|van|von|mac|mc|san|santa|santo)$/i;

export function pareceNombreDePersona(texto: string, datos: DatosPais | null = null): boolean {
  const t = texto.trim().replace(ANTES_DEL_NOMBRE, "").trim();
  if (!t) return false;
  const palabras = t.split(/\s+/);
  const utiles = palabras.filter((p) => !PARTICULA.test(p));
  // Un nombre son de una a cuatro palabras de letras: ni frases, ni números, ni signos.
  if (!utiles.length || utiles.length > 4 || !/^[\p{L}][\p{L}'’.\- ]*$/u.test(t)) return false;
  // Y no empieza por una partícula: «Los Alcarrizos» es un sitio, no una persona.
  if (PARTICULA.test(palabras[0]!)) return false;
  /*
   * Ni un saludo ni el artículo que se está vendiendo. Un color NO descalifica:
   * Rosa, Violeta y Perla son nombres de aquí antes que colores, y rechazarlos
   * sería volver a preguntarle el nombre a alguien que ya lo dio.
   */
  if (APERTURA.test(t) || nombraUnArticulo(t)) return false;
  // Ni una expresión de las de aquí: «Pura vida» es un saludo, no una persona.
  if (expresionesDelPais(datos).includes(llano(t))) return false;
  /*
   * Ni un sitio del país, y solo cuando el texto ENTERO es ese sitio: «Los
   * Alcarrizos» y «Villa Mella» son sitios y no personas, pero «María
   * Jiménez», «Carlos Acosta» o «Juan Duarte» son personas aunque su apellido
   * sea además un cantón o una provincia. Ver `esLugarEntero`.
   */
  if (datos && palabras.length >= 2 && esLugarEntero(datos, t)) return false;
  return utiles.every((p) => !PALABRA_QUE_NO_ES_NOMBRE.test(p));
}

/** El nombre que se guarda de una contestación: sin el «me llamo» de delante. */
function nombreDe(texto: string): string | null {
  const t = texto.trim().replace(ANTES_DEL_NOMBRE, "").trim();
  return t || null;
}

/** ¿Esto parece una contestación a ESE dato, y no otra cosa? */
function contestaDeVerdad(campo: CampoDelPedido, texto: string, datos: DatosPais | null = null): boolean {
  const t = texto.trim();
  if (!t || t.includes("?")) return false;
  if (MARCADOR_SIN_PALABRAS.test(t)) return false;
  const l = llano(t);
  if (campo === "celular") return true;
  if (/^(ok|okey|vale|si|s[ií]|no|hola|gracias|listo|perfecto|bien|claro)\b[.!]*$/.test(l)) return false;
  if (APERTURA.test(t)) return false;

  const palabras = t.split(/\s+/).length;
  switch (campo) {
    case "nombre":
      return pareceNombreDePersona(t, datos);
    case "talla":
      return pareceTalla(t);
    case "color":
      return pareceColor(t);
    case "cantidad":
      return /\d|\b(un[oa]?|dos|tres|cuatro|cinco|seis|par|pares)\b/i.test(t);
    case "direccion":
      return pareceDireccion(t, datos);
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
      /*
       * LO QUE CONTESTA UNA PREGUNTA ES DE ESA PREGUNTA, Y DE NINGUNA OTRA.
       *
       * EL CASO REAL DE COSTA RICA: a «¿A nombre de quién sale el pedido?» el
       * cliente contestó «María Jiménez», y ese nombre se guardó COMO SU
       * DIRECCIÓN —Jiménez es un cantón de Cartago—, pisando la dirección que
       * ya había dado. Aquí solo se leen los datos que el cliente ADELANTA sin
       * que se los pidan; lo que contesta a una pregunta lo empareja la
       * lectura de más abajo, que sí sabe de qué dato se trata.
       */
      const abierta = campoPendiente(sesion[i - 1]);

      // Un sitio del país escrito por él es su dirección hasta que dé otra.
      // «¿Envían a Las Matas de Farfán?» es una pregunta, no su dirección.
      if (
        datos &&
        (abierta === null || abierta === "direccion") &&
        !APERTURA.test(m.content) &&
        !m.content.includes("?") &&
        zonaDelCliente(datos, m.content) !== null
      ) {
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

    const pregunta = ultimaPregunta(m.content);
    if (!pregunta) continue;

    const contesto = sesion.slice(i + 1).find((x) => x.emisor === "cliente");
    if (!contesto) continue;
    const tarde =
      contesto.created_at !== undefined &&
      m.created_at !== undefined &&
      contesto.created_at - m.created_at > RESPUESTA_HORAS * 3600;
    // Una contestación que tarda solo vale si es lo SIGUIENTE que se escribió
    // en el hilo: «XXL» al día siguiente sigue siendo la talla que se le pidió,
    // pero un mensaje de días después con otras cosas en medio, no.
    if (tarde && sesion[i + 1] !== contesto) continue;
    const respuesta = contesto.content.trim();

    // Si el agente hizo varias preguntas, la contestación es de la última.
    const campo = campoDeLaPregunta(pregunta);
    if (!campo || !contestaDeVerdad(campo, respuesta, datos)) continue;

    if (campo === "celular") {
      const c = celularDe(respuesta);
      if (c) ficha.celular = c;
    } else if (campo === "nombre") {
      const n = nombreDe(respuesta);
      if (n) ficha.nombre = n.slice(0, 60);
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

/**
 * CUÁNTAS UNIDADES PIDIÓ AL NOMBRAR COLORES. Dos colores son dos artículos,
 * no uno de dos colores (la dueña, RD, 2026-09-07): el cliente que contesta
 * «rojo y azul» ya dijo la cantidad, y el resumen que salió decía «Cantidad: 1»
 * con el precio de uno solo. Se miran el color Y la talla porque ahí es donde
 * el modelo acaba metiendo los colores («Talla: Rojo y azul XL»).
 */
export function unidadesPorColores(f: FichaDelPedido): number {
  const dichos = new Set<string>();
  for (const campo of [f.color, f.talla]) {
    for (const c of llano(campo ?? "").match(reColores("gi")) ?? []) {
      // «negro» y «negra» son el mismo color, no dos.
      dichos.add(c.replace(/[oa]$/, ""));
    }
  }
  return dichos.size;
}

/** La ficha, escrita para el modelo. Vacía si todavía no se sabe nada. */
export function fichaParaModelo(f: FichaDelPedido, pais?: string | null): string {
  const sabidos = (Object.keys(ETIQUETAS) as CampoDelPedido[]).filter((k) => f[k]);
  if (!sabidos.length) return "";

  // La cantidad nunca «falta»: es 1 salvo que el cliente haya dicho otra, y
  // nombrar dos colores ES decir otra.
  const porColores = pais === "do" ? unidadesPorColores(f) : 0;
  const cantidad =
    porColores >= 2
      ? `- Cantidad: ${porColores} (el cliente nombró ${porColores} colores: son ${porColores} unidades, ` +
        `y el total es el precio × ${porColores} más el envío, que va una sola vez)`
      : "- Cantidad: 1 (no se pregunta; solo cambia si el cliente dice que quiere más)";
  const lineas = (Object.keys(ETIQUETAS) as CampoDelPedido[]).map((k) =>
    f[k] ? `- ${ETIQUETAS[k]}: ${f[k]}`
      : k === "cantidad" ? cantidad
        : `- ${ETIQUETAS[k]}: (falta)`,
  );

  return (
    "\n\nFICHA DEL PEDIDO — lo que este cliente YA TE DIO en esta conversación. Es tuyo: úsalo tal cual en el pedido y NO lo vuelvas a preguntar, ni «para confirmar», ni con otras palabras.\n" +
    lineas.join("\n") +
    "\nLo que dice «(falta)» es LO ÚNICO que te queda por preguntar, en el orden del cierre y de uno en uno. Si el cliente pregunta algo, se lo contestas primero y después pides lo que falte." +
    "\nY lo que dice «(falta)» NO LO TIENES: no lo des por recibido ni lo escribas en el pedido. Nada de «Perfecto, ya tenemos su talla», «ya me llegó su dirección» ni «ya tengo su nombre» mientras esa línea siga en «(falta)». Si el cliente contestó otra cosa —te nombró el artículo, te hizo una pregunta, se equivocó de dato—, se lo contestas en una línea y le vuelves a pedir ESE dato, con otras palabras."
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
  // Y si nadie de la casa ha escrito todavía hoy, esta sesión empieza por el saludo.
  return (
    "\n\nESTE CLIENTE VUELVE A ESCRIBIR DESPUÉS DE UN TIEMPO: lo de arriba de la conversación es de otro día y de otro pedido. " +
    "Esta es una conversación NUEVA: salúdalo otra vez como la primera vez, con el artículo del anuncio de ahora y su precio, y empieza el pedido desde el primer paso que ese artículo lleve: la talla solo si la lleva, y si no, la dirección. " +
    "La talla, el color y la cantidad de la vez anterior NO valen para este pedido: se vuelven a pedir en su paso —los que el artículo lleve—, y no le llegó ninguna ubicación hoy. " +
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

/**
 * Lo que la CASA ya escribió en esta sesión —el agente o una persona del
 * equipo—. Con esto el revisor sabe qué se dijo ya y no deja que un paso del
 * guion se vuelva a abrir: el costo del envío se dice una vez, no cada vez.
 */
export function textosDeLaCasaEnSesion(mensajes: MensajeDeMemoria[]): string[] {
  return mensajesDeLaSesion(mensajes)
    .filter((m) => m.emisor !== "cliente")
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
  "- DESPUÉS DE CONTESTAR, NO TE DETENGAS: revisa la ficha, elige el siguiente dato que falte en el orden del cierre y pregúntalo. Haz lo mismo en cada turno hasta tener todos los datos; entonces manda directamente el resumen y cierra. No esperes un «sí» adicional ni vuelvas al saludo.\n" +
  "- Si dice algo que no es ni respuesta ni pregunta —un comentario, una broma, un lugar que no existe—, lo atiendes con naturalidad en una frase corta y retomas la venta donde iba.\n" +
  "- Si pregunta QUÉ TALLAS o tamaños hay, díselas primero —las de la descripción del anuncio o las de la tabla de tallas— y después pregúntale cuál quiere. Contestar «¿qué talla necesita?» a «¿qué tallas hay?» es no haber leído.\n" +
  "- NUNCA mandes dos veces seguidas el mismo mensaje ni la misma pregunta con las mismas palabras. Si no te contestó, pregúntalo de otra forma o sigue con otro dato y vuelve después.\n" +
  "- TRATO FORMAL Y DE EMPRESA, siempre: al cliente no se le llama «maestro», «jefe», «amigo», «mi amor», «mae» ni ningún apodo. Se le habla de usted, por su nombre si lo dio, o sin nada. Educada, cercana y profesional: como una vendedora de una empresa seria, no como en la calle.\n" +
  "Eres una vendedora que quiere que el cliente se sienta bien atendido hasta el cierre, no un formulario: cada mensaje tuyo responde al suyo.";
