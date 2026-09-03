/**
 * SalesDash — IA vendedora.
 *
 * ═══ EL ÚNICO MÓDULO QUE ENVÍA ═══
 * Este es el único archivo del sistema que puede mandar un mensaje a un
 * cliente. El transporte vive en `wa.ts`, pero ESTE es el único módulo que
 * importa su función de envío, y una prueba barre el código para comprobarlo.
 * El analista no la tiene ni la puede alcanzar.
 *
 * El agente es opcional y va apagado por defecto. Se dispara solo si el canal
 * tiene `agente_activo = 1`, el mensaje es del cliente, y no aplica ninguna
 * condición de silencio.
 *
 * Regla que no se rompe nunca: si algo falla, el agente SE CALLA. Jamás le
 * escribe "hubo un error" a un cliente. Es preferible el silencio y que un
 * vendedor lo tome.
 */
import {
  ahora,
  contarRespuestasIa,
  crearAnomalia,
  getConversation,
  hayAnomaliaAbierta,
  huboHumanoReciente,
  insertMessage,
  listarCatalogo,
  listarMensajes,
  obtenerAgente,
  obtenerCanal,
  obtenerOrg,
  ponerAtiende,
  registrarAiSent,
  registrarSeguimiento,
  ultimasRespuestasIa,
  ultimosMensajes,
  usoDelDia,
  type Agente,
  type Mensaje,
  type Producto,
  type Conversacion,
  type TipoSeguimiento,
} from "./db";
import { descifrar } from "./auth";
import { anuncioParaModelo, anuncioVigente, type DatosAnuncio } from "./anuncio";
import { contieneMarcador, MARCADOR_POR_DEFECTO, registrarCierre } from "./cierre";
import { completar, ErrorIA, hoyISO } from "./ia";
import { bloqueHumano } from "./humano";
import {
  avisoDeClienteQueVuelve,
  clienteCompartioUbicacion,
  esClienteQueVuelve,
  fichaDelHilo,
  fichaParaModelo,
  mensajesDeLaSesion,
  textosDelClienteEnSesion,
} from "./memoria";
import {
  agenteDePais,
  baseComportamiento,
  bloqueCliente,
  bloqueDelPais,
  esGuionRetirado,
  guionRD,
  lineasDelResumen,
  lugarEscritoPorElCliente,
  saludoDe,
} from "../agents";
import { bloqueDePais, obtenerPais, saludoDelPais, type Pais } from "./paises";
import { bloqueDeEnvio } from "./envio";
import { conLoVistoYOido, modelosDePercepcion, percibir } from "./percepcion";
import { ubicacionParaModelo, validarUbicacion, type UbicacionValidada } from "./ubicacion";

/** Ventana en la que un mensaje de vendedor silencia al agente. */
const SILENCIO_TRAS_HUMANO = 2 * 60 * 60;
/**
 * Tope de mensajes por conversación y hora. Es un cortafuegos contra bucles,
 * NO un límite de conversación.
 *
 * Eran 8 y mataban ventas. Una venta por WhatsApp se cierra preguntando de uno
 * en uno —artículo, talla, color, nombre, dirección, referencia, si le sirve el
 * día de entrega, el resumen— y eso son ocho respuestas ANTES de la primera
 * objeción. El agente llegaba al tope justo en la recta final, se callaba con
 * el cliente a medio pedido y no volvía en una hora. Desde fuera es lo peor que
 * puede hacer: contestar diez veces, enganchar al cliente y desaparecer cuando
 * ya iba a comprar.
 *
 * Treinta deja pasar cualquier venta de verdad —incluidas las que empiezan con
 * el saludo aparte, que cuesta dos mensajes— y sigue frenando en seco lo único
 * que este tope existe para frenar: dos bots contestándose el uno al otro, que
 * no hacen treinta mensajes en una hora sino trescientos.
 *
 * Un bucle de verdad se reconoce mejor por lo que dice que por cuánto habla:
 * ver `SE_REPITE`.
 */
const MAX_RESPUESTAS_HORA = 30;

/**
 * Cuántas respuestas idénticas seguidas son un bucle.
 *
 * Esta es la señal honesta: el agente atascado manda la MISMA frase una y otra
 * vez —«¿qué talla necesita?», «¿qué talla necesita?»— y ahí no hay venta que
 * salvar, hay que parar. Un vendedor que avanza no se repite nunca palabra por
 * palabra, así que esto no puede cortar una conversación sana.
 */
const SE_REPITE = 3;
/**
 * Cuánto de la conversación recuerda el agente al contestar.
 *
 * Eran 20 y se quedaban cortos. Una venta que recoge seis datos de uno en uno
 * —artículo, talla, color, nombre, dirección, confirmación— son doce mensajes
 * como mínimo, y con un saludo, una objeción y una foto se pasa de veinte sin
 * esfuerzo. Cuando eso ocurría, el nombre que el cliente dio al principio se
 * salía de la ventana y el agente VOLVÍA A PREGUNTARLO. Desde fuera parece que
 * no escucha; desde dentro es que ya no lo tiene delante.
 *
 * Cuarenta cubre una venta entera con holgura. Son mensajes de WhatsApp, cortos:
 * el doble de ventana no es el doble de coste ni de lejos, y el coste de que un
 * cliente repita su dirección dos veces es la venta.
 */
const MAX_MENSAJES_CONTEXTO = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Envío — privado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El envío por el socket de WhatsApp vive en `wa.ts`, que es el transporte.
 *
 * Esta función existe igualmente, y sigue sin exportarse, porque la garantía
 * del producto no es «el código de enviar está en este archivo» sino «nadie
 * salvo el agente puede enviar». `wa.enviarTexto` tiene que ser público para
 * que este módulo lo use; lo que lo mantiene a raya es que ESTE es el único
 * archivo que lo importa, y hay una prueba que lo comprueba barriendo el
 * código. Si mañana otro módulo lo importa, esa prueba falla.
 */
async function enviarTexto(canalId: number, para: string, texto: string): Promise<string> {
  const { enviarTexto: enviar } = await import("./wa");
  return enviar(canalId, para, texto);
}

/**
 * Lo que se espera entre el saludo y el mensaje que va detrás.
 *
 * Los dos salen del mismo turno, y sin pausa llegan en el mismo segundo, uno
 * pegado al otro. Eso no lo escribe una persona: lo escribe un sistema que
 * tenía las dos cosas listas de antemano. Un segundo largo es lo que tarda
 * alguien en saludar y ponerse a lo suyo.
 */
const PAUSA_ENTRE_MENSAJES = 1_200;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Con qué nombre saluda el agente.
 *
 * Por orden: lo que el dueño escribió a mano, el perfil de WhatsApp de ESE
 * número —o el nombre de la página de Meta, que es el que firma los anuncios— y
 * por último el nombre de la cuenta del panel.
 *
 * Ese último era el único que había, y es el que estaba mal: lo escribe quien
 * abre la cuenta, no tiene por qué ser el nombre de la tienda, y el cliente
 * lleva el nombre bueno delante desde antes de escribir —es lo que ve arriba
 * del chat—. Recibir «bienvenido a» otro nombre suena a conversación
 * equivocada, que es justo lo contrario de lo que un saludo tiene que hacer.
 */
export function nombreDelNegocio(
  agente: { negocio?: string | null },
  canal: { negocio?: string | null } | null,
  org: { nombre?: string | null } | null,
): string {
  return (
    agente.negocio?.trim() || canal?.negocio?.trim() || org?.nombre?.trim() || "el negocio"
  );
}

/**
 * Cuántos segundos falta esperar antes de contestar.
 *
 * El retardo es un MÍNIMO desde que entró el mensaje del cliente, no un recargo
 * encima de lo que ya se tardó: mirar la foto, oír la nota de voz y pensar la
 * respuesta cuestan segundos, y esos cuentan. Con un modelo lento no espera
 * nada; con uno rápido espera lo que falte para que la respuesta no llegue
 * antes de que a nadie le dé tiempo de leerla.
 *
 * Se topa en dos minutos por si alguien escribe un número absurdo en el panel:
 * el socket que llama a esto está atendiendo a más clientes.
 */
export function esperaDeCortesia(retardoSeg: number | null | undefined, transcurrido: number): number {
  const retardo = Math.min(Math.max(retardoSeg ?? 0, 0), 120);
  return Math.max(0, retardo - Math.max(transcurrido, 0));
}

/**
 * EL SALUDO SALE EN SU PROPIO MENSAJE.
 *
 * Un vendedor no manda un párrafo que abre con «hola, bienvenido a la tienda»
 * y sigue, sin respirar, con el precio y una pregunta. Manda el saludo, y
 * aparte lo que le preguntaron. Son dos globos en la pantalla del cliente, y
 * esa separación es la mitad de lo que hace que parezca una persona.
 *
 * El acuerdo con el modelo es una LÍNEA EN BLANCO: lo que escriba antes de la
 * primera sale solo, y todo lo que venga después sale en un segundo mensaje
 * con sus líneas tal cual —así el «sí, lo tenemos» y el «¿qué talla necesita?»
 * quedan separados dentro de ese mensaje, que es como se lee bien—. Se parte
 * UNA vez y nunca más: tres globos seguidos ya no son un vendedor atento, son
 * un bot escupiendo.
 *
 * Dos cosas no se parten jamás:
 *
 *  - El resumen del pedido. Lleva líneas en blanco por dentro —nombre,
 *    dirección, total— y partirlo mandaría medio pedido en un mensaje y medio
 *    en otro. Se reconoce por el marcador de cierre, el mismo con el que se
 *    sella la venta.
 *  - Todo lo que no sea la apertura del hilo. `saludoAparte` solo es cierto en
 *    el primer mensaje del agente: a partir de ahí no hay nada que saludar, y
 *    contestar en dos globos cada vez cansa.
 */
export function partirEnMensajes(
  texto: string,
  {
    saludoAparte,
    marcador = MARCADOR_POR_DEFECTO,
  }: { saludoAparte: boolean; marcador?: string },
): string[] {
  const limpio = texto.trim();
  if (!limpio) return [];
  if (!saludoAparte || contieneMarcador(limpio, marcador)) return [limpio];

  const corte = limpio.search(/\n[ \t]*\n/);
  if (corte < 0) return [limpio];

  const saludo = limpio.slice(0, corte).trim();
  const resto = limpio.slice(corte).trim();

  // Un hueco al principio o al final no es un corte, es un espacio de más del
  // modelo: partir ahí mandaría un mensaje vacío.
  if (!saludo || !resto) return [limpio];

  return [saludo, resto];
}

/**
 * UN PEDIDO SE CIERRA UNA VEZ. Quita el resumen de un mensaje que llega tarde.
 *
 * El agente manda el resumen, la venta queda sellada, y en los mensajes que
 * siguen vuelve a escribirlo: al despedirse, cuando el cliente pregunta cuándo
 * llega, cada vez que confirma algo. Está en el guion que no lo haga y aun así
 * lo hace, porque para el modelo repetir el pedido se parece a ser servicial.
 *
 * Lo que rompe no es la conversación, es el dinero. El primero que cierra se
 * lleva la venta —regla maestra—, así que el segundo resumen no vuelve a sellar
 * nada; lo que hace es dejar el hilo con tres pedidos escritos, con totales que
 * no coinciden porque entre uno y otro se añadió un artículo o se ajustó el
 * envío. Cuando el analista va a sacar el monto, no hay UN pedido en el hilo:
 * hay tres, y el que elija puede no ser el que el cliente va a pagar.
 *
 * Al cliente tampoco le sienta bien: recibir la misma orden tres veces se lee
 * como que se le cobró tres veces.
 *
 * Se corta desde la línea del marcador hasta el final, que es donde vive el
 * resumen —el guion lo pide como último bloque del último mensaje—, y se manda
 * lo de delante: la respuesta a lo que el cliente acababa de preguntar, que sí
 * hace falta. Si delante no había nada, no hay mensaje que mandar.
 *
 * Devuelve `null` cuando no queda nada, y el texto tal cual si no había
 * marcador que quitar.
 */
export function quitarResumenRepetido(texto: string, marcador: string): string | null {
  if (!contieneMarcador(texto, marcador)) return texto;

  const lineas = texto.split("\n");
  /*
   * La PRIMERA línea que dispara el marcador, y no la que lo contenga
   * literalmente: `contieneMarcador` admite «Resumen de su pedido:» y el título
   * sin dos puntos, y buscar el texto crudo se dejaría fuera justo las formas
   * que el agente usa de verdad.
   */
  const corte = lineas.findIndex((l) => contieneMarcador(l, marcador));
  if (corte < 0) return texto;

  const delante = lineas.slice(0, corte).join("\n").trim();
  return delante || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Condiciones de silencio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿Está el cliente pidiendo una persona?
 *
 * Se detecta de forma mecánica y no con el modelo: es la condición más
 * importante de acertar y no puede depender de que el modelo esté disponible.
 *
 * Y hay que acertarla en las DOS direcciones, porque las dos se pagan caras. No
 * reconocerla deja a un cliente enfadado hablando con un bot; reconocerla donde
 * no está deja al agente MUDO EN ESE HILO PARA SIEMPRE —la anomalía que abre no
 * se cierra sola— y esa venta ya no la cierra nadie.
 *
 * Por eso hay dos listas y no una:
 *
 *  - `PETICIONES` son frases que ya son una petición enteras. Se buscan tal
 *    cual y no hace falta nada más.
 *  - `A_QUIEN` son personas a secas —«asesor», «vendedor»— que NO piden nada
 *    por sí solas. «Un vendedor me dijo ayer que costaba 20» no es alguien
 *    pidiendo un vendedor, es alguien contando algo, y antes callaba al agente
 *    para siempre. Estas solo cuentan si delante hay algo que las PIDA, o si el
 *    mensaje entero es tan corto que no puede ser otra cosa («asesor por
 *    favor»).
 */
const PETICIONES = [
  "hablar con una persona",
  "hablar con alguien",
  "con un humano",
  "una persona real",
  "atencion humana",
  "no quiero un bot",
  "no quiero hablar con un bot",
  "eres un bot",
  "eres una maquina",
  "es un robot",
  "esto es un bot",
];

const A_QUIEN =
  /\b(asesor|vendedor|humano|encargad[oa]|supervisor|agente humano|persona real|alguien del equipo)/;

/**
 * Lo que convierte a una persona NOMBRADA en una persona PEDIDA.
 *
 * Por raíces, para que valgan todas las formas del verbo: «atiende»,
 * «atienda», «atiéndame». «Hable» se queda fuera a propósito: sin tildes es
 * idéntico a «hablé», y «hablé con un vendedor ayer» no es nadie pidiendo un
 * vendedor —es un cliente contando algo mientras compra—.
 */
const LO_PIDE =
  /\b(quier\w*|quisier\w*|dese[oa]|necesit\w*|pued\w*|podr\w*|pas[ae]\w*|comunic\w+|hablar|atien\w*|atender|contact\w*|dame|deme|pong\w*|urge\w*|mand[ae]\w*)\b/;

/** Sin tildes y en minúsculas: «atención» y «atencion» son la misma petición. */
function llano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function pideHumano(texto: string): boolean {
  const limpio = llano(texto);

  if (PETICIONES.some((f) => limpio.includes(f))) return true;

  const quien = A_QUIEN.exec(limpio);
  if (!quien) return false;

  // «asesor», «un asesor por favor»: un mensaje así de corto no habla de otra
  // cosa. El umbral es generoso a propósito y sigue dejando fuera una frase.
  if (limpio.trim().length <= 30) return true;

  return LO_PIDE.test(limpio.slice(0, quien.index));
}

/** "20:00"–"02:00" también es un horario válido: cruza la medianoche. */
export function dentroDeHorario(desde: string | null, hasta: string | null, fecha = new Date()): boolean {
  if (!desde || !hasta) return true;

  const aMinutos = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  const ahoraMin = fecha.getHours() * 60 + fecha.getMinutes();
  const d = aMinutos(desde);
  const h = aMinutos(hasta);

  return d <= h ? ahoraMin >= d && ahoraMin <= h : ahoraMin >= d || ahoraMin <= h;
}

/**
 * ¿VA A CONTESTAR ESTE NÚMERO? Dicho antes de que escriba un cliente.
 *
 * Encender el agente y descubrir tres días después —por un cliente que se fue
 * sin respuesta— que faltaba la clave del modelo, o que el número estaba en
 * modo vigilar, no es aceptable. Esta función mira exactamente las mismas
 * condiciones que `atenderConversacion` y las dice en voz alta, para que la
 * pantalla que enciende el interruptor pueda contestar «listo» o «esto falta».
 *
 * Vive AQUÍ, pegada a las guardas que copia, porque si alguien añade una
 * condición de silencio allí y no aquí, el panel diría que todo está bien
 * mientras el agente calla. No llama a ningún modelo: son lecturas de la base.
 *
 * `listo` es lo que impide hablar. Los avisos de horario y de conexión no lo
 * apagan: uno es temporal por definición y el otro se arregla solo al
 * reconectar el socket.
 */
export interface RevisionAgente {
  /** Nada impide que conteste al próximo cliente. */
  listo: boolean;
  /** Lo que hay que arreglar, en el orden en que lo frena. */
  impedimentos: string[];
  /** Cierto ahora mismo, pero no es una avería. */
  avisos: string[];
}

/**
 * ¿HAY DINERO DE OTRO PAÍS ESCRITO EN ESTE GUION?
 *
 * El caso real: un número dominicano con el guion de la tienda de Panamá
 * aplicado. Todo parece bien —el agente contesta, vende, cierra— y en cada
 * pedido dice que el envío son US$5.00, que es el envío de Panamá. Nadie lo ve
 * hasta que un cliente lo repite en voz alta, y para entonces lleva semanas
 * cotizando mal.
 *
 * Se reconoce por la MONEDA, que es lo que no se puede falsificar: si el guion
 * habla de dólares y este número vende en pesos dominicanos, ese guion es de
 * otro sitio. No se toca nada —lo escribió el dueño y puede tener sus razones—
 * pero se dice en la pantalla que enciende el número, que es donde se mira.
 *
 * Panamá es la excepción justa: allí se cobra en balboas y en dólares
 * indistintamente, y su propio guion escribe US$.
 */
const MONEDAS: { codigo: string; nombre: string; marca: RegExp }[] = [
  { codigo: "USD", nombre: "dólares", marca: /\bUS\$|\bUSD\b|\bd[oó]lar/i },
  { codigo: "DOP", nombre: "pesos dominicanos", marca: /\bRD\$|\bDOP\b/i },
  // «Colón» a secas es una provincia de Panamá y «Ciudad Colón» un distrito de
  // Costa Rica: la moneda se reconoce en plural o pegada a una cifra.
  { codigo: "CRC", nombre: "colones", marca: /₡|\bCRC\b|\bcolones\b|\d\s*col[oó]n\b/i },
  { codigo: "PAB", nombre: "balboas", marca: /B\/\.|\bPAB\b|\bbalboa/i },
];

/** Lo que un país acepta como suyo. En Panamá el dólar es de casa. */
function monedasPropias(codigo: string): string[] {
  return codigo === "PAB" ? ["PAB", "USD"] : [codigo];
}

export function monedaAjena(texto: string, codigoDelPais: string): string | null {
  const propias = monedasPropias(codigoDelPais);

  for (const m of MONEDAS) {
    if (propias.includes(m.codigo)) continue;
    if (m.marca.test(texto)) return m.nombre;
  }

  return null;
}

export function revisarAgente(orgId: number, canalId: number): RevisionAgente {
  const impedimentos: string[] = [];
  const avisos: string[] = [];

  const canal = obtenerCanal(orgId, canalId);
  if (!canal) return { listo: false, impedimentos: ["El número no existe."], avisos };

  if (canal.activo !== 1) {
    impedimentos.push("El número está apagado: enciéndelo en Números.");
  }

  if (canal.contesta_ia === 1) {
    impedimentos.push(
      "Este número está en modo vigilar —aquí contesta tu propia IA y el panel solo mira—, " +
        "así que el agente no escribe. Enciende el interruptor de este número aquí abajo.",
    );
  }

  if (canal.agente_activo !== 1) {
    impedimentos.push("El agente está apagado en este número.");
  }

  if (!process.env.OPENROUTER_API_KEY) {
    impedimentos.push(
      "Falta la clave del modelo (OPENROUTER_API_KEY) en el servidor: sin ella no se puede generar ni una respuesta.",
    );
  }

  const agente = obtenerAgente(orgId, canalId);

  /*
   * Sin país, el agente vende en neutro: no sabe en qué moneda cobrar, cómo se
   * dan las direcciones ahí ni con qué paga la gente, y no puede comprobar si
   * un pin del mapa cae donde este número entrega. Funciona —así funcionó
   * siempre— pero suena a tienda de fuera, así que se dice.
   */
  if (!agente.pais) {
    avisos.push(
      "Este número no tiene país. El agente contestará, pero en neutro: sin moneda propia, sin la " +
        "forma de pedir una dirección de ese país y sin poder avisar cuando una ubicación cae fuera.",
    );
  }

  /*
   * Y sin nada que vender no puede cotizar: contesta, pero a todo lo que sea un
   * precio responde que lo confirma con el equipo. Es la avería más silenciosa
   * de todas, porque el agente parece estar funcionando.
   */
  const sinCatalogo = agente.usar_catalogo !== 1 || listarCatalogo(orgId, true).length === 0;
  if (sinCatalogo && !agente.conocimiento.trim()) {
    avisos.push(
      "Este número no tiene de dónde sacar precios: ni catálogo ni artículos escritos. El agente " +
        "atenderá, pero a cada pregunta de precio dirá que lo confirma con el equipo.",
    );
  }

  /*
   * EL GUION DE OTRO PAÍS. Ver `monedaAjena`: es el fallo que no se ve solo,
   * porque el agente sigue vendiendo y cerrando mientras cotiza el envío de
   * otra tienda.
   */
  const pais = obtenerPais(agente.pais);

  if (pais) {
    const ajena = monedaAjena(`${agente.instrucciones} ${agente.conocimiento}`, pais.moneda.codigo);

    if (ajena) {
      avisos.push(
        `Lo que tiene escrito este número habla de ${ajena}, y aquí se vende en ` +
          `${pais.moneda.nombre} (${pais.moneda.simbolo}). Casi seguro es el guion de otro país: ` +
          "revisa los precios y sobre todo el COSTO DE ENVÍO, porque el agente lo está diciendo " +
          "en cada pedido. En Agente puedes aplicar la plantilla de este país y cargar el envío.",
      );
    }
  }

  /*
   * CÓMO SE PRESENTA, con el saludo delante y escrito tal cual lo lee el cliente.
   *
   * Es la primera frase de la conversación y la única que sale SIEMPRE, y a la
   * vez es lo que menos se mira: se configura una vez al abrir la cuenta y no
   * se vuelve a ver nunca, porque el dueño no se escribe a sí mismo.
   *
   * Los dos fallos que salen de aquí no se notan desde dentro y se notan
   * muchísimo desde fuera:
   *
   *   «Le asiste Asistente» — el nombre que traen los agentes recién creados.
   *   Anuncia una máquina en la primera línea, después de todo el trabajo que
   *   hace el resto del prompt para no sonar a una. Y es redundante hasta en
   *   castellano: le asiste el asistente.
   *
   *   «de Roplis cr. Telleria Pal.» — el nombre del PERFIL de la página, con su
   *   cola de ciudad y categoría, leído en voz alta como si fuera el nombre de
   *   la tienda. Nadie se presenta así.
   *
   * No se corrige solo —el nombre de la tienda lo sabe el dueño y no nosotros—,
   * así que se enseña el saludo entero y que lo juzgue quien puede arreglarlo.
   */
  const datos = agenteDePais(agente.pais);
  const negocioNombre = nombreDelNegocio(agente, canal, obtenerOrg(orgId) ?? null);
  const saludo = datos
    ? saludoDe(datos, agente.nombre, negocioNombre)
    : saludoDelPais(pais, agente.nombre, negocioNombre);

  /*
   * EL GUION VIEJO, TODAVÍA PEGADO. Con un archivo de país el guion vive en
   * el código, y lo que quede de la plantilla antigua en «Instrucciones» no
   * entra en el prompt —mandaría dos guiones—. Se dice, para que se borre.
   */
  if (datos && esGuionRetirado(agente.instrucciones)) {
    avisos.push(
      "En «Instrucciones» sigue pegado el guion de venta antiguo. Ese guion ya vive en el código " +
        `(src/agents/paises/${datos.codigo === "do" ? "rd" : datos.codigo}.ts) y el agente no lee el del cuadro: ` +
        "bórralo y deja ahí solo notas —precios, condiciones— o nada.",
    );
  }

  // Con el nombre fijado en el archivo del país, el del panel no sale en ningún saludo.
  const nombreDeMaquina =
    !datos?.nombreAgente && /asistent|bot\b|^ia$|chat ?gpt|agente|virtual/i.test(agente.nombre.trim());

  if (nombreDeMaquina) {
    avisos.push(
      `Tu agente se presenta así: «${saludo}». Ponle un nombre de PERSONA —Mildred, Ana, ` +
        "Carlos— en «Nombre del agente»: es la primera línea que lee el cliente, y «le asiste " +
        "Asistente» le dice que está hablando con una máquina antes de nada más.",
    );
  } else if (
    !agente.negocio?.trim() &&
    canal.negocio &&
    canal.negocio.trim().split(/\s+/).length > 3 &&
    saludo.includes(canal.negocio.trim())
  ) {
    /*
     * El nombre del perfil, colado en el saludo. Solo se avisa cuando NADIE
     * escribió un nombre corto y el del perfil es largo: si el dueño ya puso el
     * suyo, es el que quiere, sea del largo que sea.
     *
     * Y solo si el saludo DE ESE PAÍS lo dice: el dominicano se presenta sin el
     * nombre de la tienda, así que ahí el del perfil no lo lee nadie y avisar
     * sería mandar al dueño a arreglar algo que el cliente no ve. Se comprueba
     * sobre el saludo ya armado para que valga también para el país que venga.
     */
    avisos.push(
      `Tu agente se presenta así: «${saludo}». Ese es el nombre del perfil de la página, con su ` +
        "cola de ciudad y categoría. Si tu tienda se llama más corto, escríbelo en «Nombre del " +
        "negocio» y el saludo dirá solo eso.",
    );
  }

  if (agente.horario_activo === 1 && !dentroDeHorario(agente.horario_desde, agente.horario_hasta)) {
    avisos.push(
      `Ahora mismo está fuera del horario (${agente.horario_desde ?? "?"}–${agente.horario_hasta ?? "?"}): ` +
        "volverá a contestar dentro de la franja.",
    );
  }

  if (canal.estado !== "conectado") {
    avisos.push(
      `El número aparece «${canal.estado}» en WhatsApp: los mensajes no entran hasta que reconecte. ` +
        "El agente ya queda encendido y contestará en cuanto vuelva.",
    );
  }

  /*
   * El cupo del modelo gratuito se agota a media tarde y el agente enmudece sin
   * que nada cambie en la pantalla. Si hoy TODAS las llamadas fallaron, eso es
   * lo que está pasando.
   */
  const uso = usoDelDia(orgId, hoyISO()).filter((u) => u.proposito === "agente");
  const exitos = uso.reduce((n, u) => n + u.exitos, 0);
  const fallos = uso.reduce((n, u) => n + u.fallos, 0);

  if (fallos > 0 && exitos === 0) {
    impedimentos.push(
      `Hoy fallaron las ${fallos} llamadas al modelo y no salió ninguna respuesta. ` +
        (agente.modelo.endsWith(":free")
          ? "El modelo gratuito agota su cupo diario: elige uno de pago o configura un respaldo."
          : "Revisa el modelo y la clave."),
    );
  }

  return { listo: impedimentos.length === 0, impedimentos, avisos };
}

export type MotivoSilencio =
  | "agente_apagado"
  /** En este número ya contesta otra IA. Ver la guarda en `atenderConversacion`. */
  | "contesta_otra_ia"
  /** El propio agente pasó el caso a un asesor con la etiqueta de handoff. */
  | "pasado_a_asesor"
  /** Alguien puso ESTE hilo en manos de una persona desde el panel. */
  | "atiende_humano"
  | "canal_apagado"
  | "ultimo_no_es_cliente"
  | "vendedor_reciente"
  | "pidio_humano"
  | "fuera_de_horario"
  | "limite_por_hora"
  /**
   * La respuesta era el resumen de un pedido YA cerrado, y nada más. Ver
   * `quitarResumenRepetido`: al quitarlo no quedaba mensaje que mandar.
   */
  | "resumen_repetido";

// ─────────────────────────────────────────────────────────────────────────────
// Generación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El tono cambia la calidez, NO el trato.
 *
 * Los cuatro son de usted a propósito. Un negocio que tutea a un desconocido
 * por WhatsApp se lee informal, y en una venta lo informal se paga: el cliente
 * duda de a quién le está dando su dirección. El tono elige si ese usted suena
 * cálido, seco o con energía; no si hay usted.
 */
const TONOS: Record<string, string> = {
  cercano: "Cercano y cálido, pero de usted y sin jerga: un vendedor amable que trata bien.",
  formal: "Cortés y de usted, con frases completas y cuidadas.",
  directo: "Al grano y de usted. Frases cortas, sin rodeos ni relleno.",
  alegre: "Con energía y de usted, sin exagerar y sin perder la compostura.",
};

/**
 * El prompt del sistema. Se exporta para que una prueba pueda leerlo: que el
 * anuncio llegue al modelo no hay forma de comprobarlo sin llamar a la red, y
 * es justo lo que no puede volver a perderse.
 */
/**
 * QUÉ PUEDE VENDER — de dos sitios, y los dos los escribió el negocio.
 *
 * El catálogo es una tabla con precios. «Lo que vendes» es texto escrito a
 * mano en el canal, y existe porque la mayoría de estas tiendas vende diez
 * artículos y no va a cargarlos uno a uno: escribirlos en cuatro líneas es lo
 * que de verdad hacen. Los dos valen igual —los dos los escribió el dueño— y
 * por eso el agente puede cotizar con cualquiera de los dos delante.
 *
 * Es una función porque lo leen DOS: el agente para cotizar y el revisor para
 * comprobar que cotizó bien. Si leyeran dos textos distintos, el revisor
 * pararía precios correctos.
 */
export function textoDeLoQueVende(
  agente: Pick<Agente, "conocimiento" | "usar_catalogo">,
  catalogo: Producto[],
): string {
  const productos = catalogo
    .map((p) => {
      const partes = [p.nombre];
      if (p.variantes) partes.push(`(${p.variantes})`);
      if (p.precio !== null) partes.push(`— ${p.precio}`);
      return `- ${partes.join(" ")}`;
    })
    .join("\n");

  const conocimiento = agente.conocimiento?.trim() ?? "";
  const conCatalogo = agente.usar_catalogo !== 0 && productos.length > 0;

  return (
    [
      conCatalogo ? `Catálogo:\n${productos}` : "",
      conocimiento
        ? `LO QUE VENDES (lo escribió el negocio; vale exactamente igual que el catálogo, y de aquí salen precios y condiciones):\n${conocimiento}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n") || "Catálogo:\n(sin catálogo cargado)"
  );
}

export function armarSistema(
  negocio: string,
  agente: Agente,
  catalogo: Producto[],
  anuncio: DatosAnuncio | null,
  /** El marcador con el que se declara cerrada una venta. */
  marcador: string = MARCADOR_POR_DEFECTO,
  /**
   * Quién está al otro lado. El número lo tenemos desde el primer mensaje y el
   * agente no: sin decírselo, al levantar un pedido escribe «el número de este
   * WhatsApp» en la línea del teléfono —lo he visto hacerlo— y el pedido sale
   * sin un dato con el que llamar al cliente si el mensajero no lo encuentra.
   */
  cliente: { telefono: string; nombre: string | null } | null = null,
  /**
   * El pin que acaba de mandar el cliente, ya comprobado contra el país. Ver
   * `ubicacionParaModelo`. Null en todo mensaje que no sea una ubicación.
   */
  ubicacion: UbicacionValidada | null = null,
  /**
   * ¿Hay una foto del anuncio guardada que se pueda mandar?
   *
   * La regla de «[FOTO]» solo entra si la hay. Prometerle una foto que no
   * existe es peor que no ofrecerla: el cliente dice que sí, no le llega nada,
   * y el agente queda contestando a una promesa que no puede cumplir.
   */
  conFoto: boolean = false,
  /**
   * El mensaje en el que el cliente escribió su zona, si escribió alguna. Ver
   * `lugarEscritoPorElCliente`. Manda el pin del mapa si lo hay: es más exacto.
   */
  lugarEscrito: string | null = null,
): string {
  // Qué puede vender: ver `textoDeLoQueVende`, que también lee el revisor.
  const queVende = textoDeLoQueVende(agente, catalogo);

  /*
   * El anuncio que trajo al cliente entra en el prompt, y esto no es un lujo.
   *
   * Es lo que el cliente vino buscando: sin ello el agente abre preguntando
   * «¿qué producto te interesa?» a alguien que acaba de pinchar la foto de ese
   * producto, y esa primera pregunta boba es la que hace que no conteste. El
   * anuncio lo publicó el propio negocio, así que se puede dar por bueno para
   * SABER de qué se habla; el catálogo sigue mandando en precios y condiciones,
   * y eso lo dicen las reglas de la base.
   */
  const deAnuncio = anuncio ? anuncioParaModelo(anuncio) : null;

  /*
   * EL PAÍS DEL CANAL, en sus dos mitades.
   *
   * `paises.ts` sabe la geografía: con qué caja se valida un pin del mapa, qué
   * ciudad está cerca, qué prefijo tiene. `src/agents/paises` sabe lo que se
   * le DICE al modelo: tienda, moneda, envío, pago, tallas, cómo habla la
   * gente. Un canal tiene un país y ese país tiene un archivo; el agente de
   * este canal recibe ese archivo y ninguno más.
   */
  const pais = obtenerPais(agente.pais);
  const datos = agenteDePais(agente.pais);
  const donde = ubicacion?.direccion?.provincia ?? ubicacion?.zona?.nombre ?? lugarEscrito;

  /*
   * LAS NOTAS DEL NEGOCIO, detrás de los datos del país.
   *
   * Con un archivo de país, el guion de venta ya no sale del cuadro de
   * instrucciones del panel: sale del código. Lo que el dueño escriba ahí
   * sigue valiendo como DATOS —un precio, una condición, lo que no se
   * promete—, y se le dice así al modelo. Y si en ese cuadro sigue pegado el
   * guion viejo entero, no entra: mandaría dos guiones que se contradicen. El
   * panel avisa para que se borre (ver `revisarAgente`).
   */
  const guionViejo = datos !== null && esGuionRetirado(agente.instrucciones);
  const instrucciones = guionViejo ? "" : agente.instrucciones.trim();
  const notas = instrucciones
    ? [
        datos
          ? `NOTAS ADICIONALES DEL NEGOCIO (las escribió el dueño; valen para datos y condiciones, y NUNCA cambian el orden de venta ni la forma del resumen de más abajo):\n${instrucciones}`
          : `Instrucciones del negocio:\n${instrucciones}`,
        /*
         * Con la moneda que dice el ARCHIVO del país, no `paises.ts`: en
         * Panamá el archivo cobra en dólares y la geografía habla de balboas,
         * y lo que se le dice al modelo tiene que ser una sola cosa.
         */
        pais
          ? regirsePorElPais(
              datos
                ? { ...pais, moneda: { ...pais.moneda, nombre: datos.moneda.nombre, simbolo: datos.moneda.simbolo } }
                : pais,
            )
          : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  const pinDelMapa = ubicacion ? ubicacionParaModelo(ubicacion, pais?.nombre ?? null) : "";

  if (datos) {
    /*
     * UN AGENTE DE PAÍS: base + su archivo, y nada de los otros dos.
     *
     * El orden importa. El país y lo que vende van primero porque son datos;
     * el comportamiento va al final porque lo último que lee el modelo es lo
     * que más pesa, y el pin del mapa —una instrucción para ESTA respuesta—
     * cierra.
     */
    const tienda = datos.tienda || negocio;
    const quien = datos.nombreAgente ?? agente.nombre;

    return [
      `Eres ${quien}, quien atiende el WhatsApp de ${tienda}.`,
      bloqueDelPais(datos, donde, negocio),
      bloqueHumano(pais),
      queVende,
      deAnuncio ?? "",
      notas,
      // En RD el teléfono no se pregunta: el guion de la dueña usa el del chat.
      bloqueCliente(cliente, { pedirCelular: datos.codigo !== "do" }),
      /*
       * REPÚBLICA DOMINICANA LLEVA SU PROPIO GUION, escrito desde cero por
       * orden de la dueña (`src/agents/paises/rd-guion.ts`): corto y en su
       * orden. Costa Rica y Panamá siguen con la base compartida.
       */
      datos.codigo === "do"
        ? guionRD({
            saludo: saludoDe(datos, agente.nombre, negocio),
            marcador,
            conAnuncio: deAnuncio !== null,
            conFoto,
            lineasResumen: lineasDelResumen(datos),
            pieDelResumen: datos.pieDelResumen,
            datosParaCerrar: datos.envio.datosParaCerrar,
          })
        : baseComportamiento({
            saludo: saludoDe(datos, agente.nombre, negocio),
            marcador,
            trato: datos.trato,
            conAnuncio: deAnuncio !== null,
            conFoto,
            lineasResumen: lineasDelResumen(datos),
            pieDelResumen: datos.pieDelResumen,
            datosParaCerrar: datos.envio.datosParaCerrar,
          }),
      pinDelMapa,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /*
   * SIN ARCHIVO DE PAÍS: el número vende en neutro, como siempre vendió.
   *
   * Es el caso del canal sin país puesto. El comportamiento es EL MISMO —sale
   * de la misma base—; lo que no hay es tienda, moneda ni envío escritos en
   * código, así que salen de lo que sepa `paises.ts` y de las tarifas
   * cargadas en el panel, y el formato del resumen de las instrucciones.
   */
  const envio = pais
    ? bloqueDeEnvio(
        pais,
        { envio_cerca: agente.envio_cerca, envio_lejos: agente.envio_lejos },
        donde,
      )
    : "";

  return [
    `Eres ${agente.nombre}, quien atiende el WhatsApp de ${negocio}.`,
    TONOS[agente.tono] ?? TONOS.cercano,
    pais ? bloqueDePais(pais) : "",
    bloqueHumano(pais),
    envio,
    queVende,
    deAnuncio ?? "",
    notas,
    bloqueCliente(cliente),
    baseComportamiento({
      saludo: saludoDelPais(pais, agente.nombre, negocio),
      marcador,
      trato: "usted",
      conAnuncio: deAnuncio !== null,
      conFoto,
      lineasResumen: null,
      pieDelResumen: [],
      datosParaCerrar: pais?.datosParaCerrar ?? null,
    }),
    pinDelMapa,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * LO QUE YA PREGUNTÓ Y LO QUE EL CLIENTE LE CONTESTÓ, delante de sus ojos.
 *
 * Decirle «no repitas preguntas» no basta: en una conversación de treinta
 * mensajes, la pregunta que hizo hace ocho turnos está tan lejos como cualquier
 * otra frase, y vuelve a hacerla. Al cliente le llega «¿a qué dirección?» por
 * segunda vez y entiende, con razón, que no le están escuchando. Ahí se cae la
 * venta, y ni el vendedor ni el dueño se enteran de por qué.
 *
 * Esto sale del propio hilo y no cuesta una llamada: las frases del agente que
 * terminan en interrogación, y pegado a cada una LO QUE EL CLIENTE CONTESTÓ
 * después —que es su respuesta, esté donde esté ahora en el historial—. El
 * modelo lo lee como una lista corta al final del prompt, que es donde más
 * pesa, y ya no tiene que reconstruir la conversación para saber qué sabe.
 *
 * Las últimas ocho y sin repetidas: una lista larga se lee como ruido.
 */
export interface Recordado {
  pregunta: string;
  /** Lo que el cliente escribió justo después. Null si no ha contestado. */
  respuesta: string | null;
}

/** Sin tildes ni signos: «¿Qué talla?» y «que talla» son la misma pregunta. */
function clavePregunta(frase: string): string {
  return frase
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function loYaPreguntado(mensajes: Mensaje[], tope = 8): Recordado[] {
  const vistas = new Map<string, Recordado>();

  for (const [i, m] of mensajes.entries()) {
    if (m.emisor !== "ia") continue;

    // Se corta DESPUÉS de un cierre de frase, nunca después del signo de
    // apertura: partir en «¿» dejaría la pregunta sin él.
    const preguntas = m.content
      .split(/(?<=[?.!\n])/)
      .map((f) => f.trim())
      .filter((f) => f.endsWith("?") && f.length >= 8);

    if (preguntas.length === 0) continue;

    /*
     * La respuesta es el siguiente mensaje del cliente, sea cual sea. No se
     * intenta adivinar si «la 42» contesta a la talla o al color: el modelo
     * tiene el hilo entero delante para eso. Lo que aquí importa es que un dato
     * que el cliente YA MANDÓ no vuelva a pedirse.
     */
    const contesto = mensajes.slice(i + 1).find((x) => x.emisor === "cliente");
    const respuesta = contesto?.content.trim().slice(0, 120) || null;

    for (const pregunta of preguntas) {
      const clave = clavePregunta(pregunta);
      if (clave) vistas.set(clave, { pregunta, respuesta });
    }
  }

  return [...vistas.values()].slice(-tope);
}

/**
 * ESTE NÚMERO VENDE AQUÍ, DIGA LO QUE DIGA EL GUION.
 *
 * Un guion se copia de un número a otro y se queda: el de la tienda de Panamá
 * aplicado en un número dominicano trae dentro dólares, corregimientos, Yappy y
 * un envío de US$5.00, y el agente lo lee como si fuera la verdad de esta
 * tienda. Sigue vendiendo y cerrando igual de bien mientras cotiza el envío de
 * otro país, que es lo que lo hace tan difícil de ver.
 *
 * Esto va DESPUÉS de las instrucciones, a propósito: lo último que se lee es lo
 * que más pesa, y lo que dice es que ante una contradicción entre el guion y el
 * país del número, gana el país. No borra el guion —lo escribió el dueño y casi
 * todo lo que dice sigue siendo suyo: qué vende, qué no promete, cómo cierra—
 * pero le quita el dinero y la geografía de otro sitio.
 *
 * Y la salida cuando el dato que falta solo estaba en esa moneda ajena no es
 * traducirlo: es decir que se confirma. Un envío convertido a ojo es un envío
 * inventado con más pasos.
 */
export function regirsePorElPais(pais: Pais): string {
  return [
    `LO DE ARRIBA LO ESCRIBIÓ EL NEGOCIO, PERO ESTE NÚMERO VENDE EN ${pais.nombre.toUpperCase()}.`,
    `Si en esas instrucciones aparece un precio, un envío o un monto que NO esté en ` +
      `${pais.moneda.nombre} (${pais.moneda.simbolo}), no lo uses: es el guion de otra tienda, de ` +
      "otro país. No lo conviertas ni lo estimes tú; si te falta ese dato, di que lo confirmas con " +
      "el equipo y sigue con el resto del pedido.",
    "Lo mismo con la geografía y las formas de pago: no nombres provincias, distritos, transportes " +
      "ni métodos de pago que no sean los de este país, que son los que tienes escritos más arriba. " +
      "Un cliente al que le hablan de un sitio que no es el suyo sabe al instante que quien le " +
      "escribe no está donde dice estar.",
    "Todo lo demás del guion sigue mandando: qué vendes, qué no prometes, cómo se cierra un pedido.",
  ].join("\n");
}

/**
 * El hilo, escrito como lo tiene que leer el modelo.
 *
 * Lo que el cliente mandó sin escribir —una foto, una nota de voz— entra aquí
 * ya en palabras: en el historial de un modelo de texto solo caben palabras, y
 * un «[imagen]» a secas es exactamente el agujero por el que el agente
 * preguntaba «¿qué artículo te interesa?» a quien acababa de enseñárselo. Ver
 * `conLoVistoYOido` en `percepcion.ts`.
 */
function aHistorial(mensajes: Mensaje[]) {
  return mensajes.map((m) => ({
    role: m.emisor === "cliente" ? ("user" as const) : ("assistant" as const),
    content:
      m.emisor === "humano"
        ? `(mensaje de un compañero del equipo) ${m.content}`
        : m.emisor === "cliente"
          ? conLoVistoYOido(m)
          : m.content,
  }));
}

export interface RespuestaGenerada {
  /** Lo que se le manda al cliente: ya sin la etiqueta `[HANDOFF]`. */
  texto: string;
  /** El agente pidió que siga una persona. Ver `PIDE_ASESOR`. */
  pideAsesor: boolean;
  modelo: string;
  fueRespaldo: boolean;
}

/**
 * Genera una respuesta SIN enviarla. La usan el chat de prueba del panel y
 * `atenderConversacion`.
 */
export async function generarRespuesta(
  orgId: number,
  /**
   * De qué canal contesta. Cada canal tiene su propio agente —su país, su
   * guion, su modelo—, así que sin esto no se sabe cuál de los tres habla.
   * `AGENTE_DE_LA_CUENTA` (0) es la plantilla, que es lo que usa el chat de
   * prueba cuando todavía no hay ningún número conectado.
   */
  canalId: number,
  mensajes: Mensaje[],
  /** El anuncio del hilo, si lo trajo uno. El chat de prueba no tiene. */
  anuncio: DatosAnuncio | null = null,
  /**
   * Qué se puede cotizar en este hilo, según el catálogo. Va DESPUÉS del prompt
   * normal a propósito: lo último que lee el modelo es lo que más pesa, y esta
   * es la regla que no puede saltarse.
   */
  reglaPrecio: string | null = null,
  /** Quién escribe. El chat de prueba no tiene cliente de verdad. */
  cliente: { telefono: string; nombre: string | null } | null = null,
  /** El pin que acaba de mandar el cliente, ya comprobado contra el país. */
  ubicacion: UbicacionValidada | null = null,
): Promise<RespuestaGenerada> {
  const org = obtenerOrg(orgId);
  const agente = obtenerAgente(orgId, canalId);
  const catalogo = listarCatalogo(orgId, true);

  /*
   * CON QUÉ NOMBRE SE PRESENTA, y de dónde sale.
   *
   * El cliente lleva el nombre del negocio delante desde antes de escribir: es
   * lo que ve arriba del chat, y en un anuncio es el nombre de la página que lo
   * publicó. Saludarle con OTRO nombre —el de la cuenta del panel, que lo
   * escribió quien la abrió y no tiene por qué coincidir con la tienda— suena a
   * que se ha equivocado de conversación.
   *
   * Por orden: lo que el dueño haya escrito a mano, el perfil de WhatsApp de
   * este número (o la página de Meta), y por último el nombre de la cuenta, que
   * es lo que había antes y sigue valiendo cuando no hay nada mejor.
   */
  const negocio = nombreDelNegocio(
    agente,
    (canalId ? obtenerCanal(orgId, canalId) : null) ?? null,
    org ?? null,
  );

  /*
   * LA CONVERSACIÓN TIENE QUE ACABAR EN EL CLIENTE.
   *
   * No es un capricho nuestro: los modelos actuales rechazan con un 400 una
   * conversación que termina en el turno del asistente —«assistant message
   * prefill»—. `atenderConversacion` ya lo garantiza con su guarda de
   * `ultimo_no_es_cliente`, pero esta función también la llaman el chat de
   * prueba y las verificaciones, y ahí el error llegaba como un «400 Provider
   * returned error» que no explicaba nada.
   *
   * Se corta aquí, con el motivo escrito, en vez de gastar la llamada.
   */
  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo || ultimo.emisor !== "cliente") {
    throw new ErrorIA(
      "No hay nada que contestar: la conversación no termina en un mensaje del cliente",
      400,
      false,
    );
  }

  /*
   * LO QUE YA PREGUNTÓ, al final del prompt y no en medio de las reglas.
   *
   * Lo último que lee el modelo es lo que más pesa, y esto es una instrucción
   * para ESTA respuesta: no vuelvas a preguntar lo que está en esta lista. Ver
   * `preguntasYaHechas`.
   */
  const yaPregunto = loYaPreguntado(mensajes);

  const memoria = yaPregunto.length
    ? "\n\nESTO YA SE LO PREGUNTASTE, Y ESTO TE CONTESTÓ:\n" +
      yaPregunto
        .map((p) =>
          p.respuesta
            ? `- «${p.pregunta}» -> el cliente dijo: «${p.respuesta}»`
            : `- «${p.pregunta}» -> todavía no te ha contestado`,
        )
        .join("\n") +
      "\nLO QUE YA TE CONTESTÓ ES TUYO: dalo por sabido, úsalo en el pedido y NO se lo vuelvas a " +
      "preguntar, ni «para confirmar». Y ninguna de esas preguntas se repite: si se quedó sin " +
      "contestar, no la hagas otra vez igual —sigue con el siguiente dato y déjala para el final—. " +
      "Repetir algo que el cliente ya leyó le dice que no le estás escuchando, y ahí se cae la venta."
    : "";

  /*
   * Y LA FICHA DEL PEDIDO, lo último de todo. Ver `memoria.ts`: lo que ya se
   * sabe —talla, color, dirección, nombre, celular— sacado del hilo sin
   * modelo, y lo que falta marcado como lo único que queda por preguntar. Va
   * al final porque es lo que más pesa, y es lo que el revisor usa para parar
   * una pregunta repetida.
   */
  const ficha = fichaParaModelo(fichaDelHilo(mensajes, agente.pais)) + avisoDeClienteQueVuelve(mensajes);

  const r = await completar({
    orgId,
    proposito: "agente",
    modelo: agente.modelo,
    respaldo: agente.modelo_respaldo,
    mensajes: [
      {
        role: "system",
        content:
          armarSistema(
            negocio,
            agente,
            catalogo,
            anuncio,
            org?.marcador_cierre ?? MARCADOR_POR_DEFECTO,
            cliente,
            ubicacion,
            false,
            // La zona que el cliente escribió EN ESTA SESIÓN, para decirle SU tarifa.
            lugarEscritoPorElCliente(agenteDePais(agente.pais), mensajesDeLaSesion(mensajes)),
          ) + (reglaPrecio ? `\n\n${reglaPrecio}` : "") + memoria + ficha,
      },
      ...aHistorial(mensajes),
    ],
    /*
     * Un resumen de pedido con nombre, dirección completa, producto, talla,
     * color y tres líneas de importes se pasa de los 400 que había aquí: el
     * mensaje salía cortado a media línea y, como ya llevaba el marcador, la
     * venta se sellaba con un resumen incompleto. Subir el tope no cuesta nada
     * mientras no se use —se paga por token escrito, no por el límite— y evita
     * el peor final posible: el cliente leyendo su pedido a medias.
     */
    maxTokens: 1200,
    temperatura: 0.6,
  });

  // Los modelos a veces envuelven la respuesta en comillas pese a pedirlo.
  const limpio = r.texto.trim().replace(/^["“](.*)["”]$/s, "$1").trim();
  const { texto, pideAsesor } = leerEtiquetaDeAsesor(limpio);

  return { texto, pideAsesor, modelo: r.modelo, fueRespaldo: r.fueRespaldo };
}

/**
 * `[HANDOFF]` — la etiqueta con la que el agente pide que entre una persona.
 *
 * Es una convención de las instrucciones del negocio, no una invención nuestra:
 * hay guiones de venta que le piden al agente escribirla al final del resumen
 * del pedido, o cuando el cliente pide algo que no puede resolver. El cliente
 * NO tiene que verla, y hasta que esto existió se le mandaba tal cual —un
 * «[HANDOFF]» al final del mensaje— porque para el agente era texto como
 * cualquier otro.
 *
 * Se reconoce con y sin corchetes, en mayúsculas o minúsculas, porque el modelo
 * la escribe de las dos formas por más que se le pida una.
 */
const PIDE_ASESOR = /\[?\bHANDOFF\b\]?/gi;

/**
 * `[FOTO]` — la etiqueta con la que el agente pide que salga la imagen.
 *
 * Misma mecánica que `[HANDOFF]` y por la misma razón: el modelo solo sabe
 * escribir texto, así que la única forma de que pida algo que no es texto es
 * que lo diga escribiéndolo. El cliente NO tiene que verla, y sin quitarla le
 * llegaría un «[FOTO]» pegado al final del mensaje.
 *
 * Se reconoce con y sin corchetes y en cualquier caja, igual que la otra: el
 * modelo la escribe de las dos formas por más que se le pida una.
 */
const PIDE_FOTO = /\[?\bFOTO\b\]?/gi;

export function leerEtiquetaDeFoto(texto: string): { texto: string; pideFoto: boolean } {
  PIDE_FOTO.lastIndex = 0;
  if (!PIDE_FOTO.test(texto)) return { texto, pideFoto: false };

  return {
    texto: texto.replace(PIDE_FOTO, "").replace(/[ \t]+\n/g, "\n").trim(),
    pideFoto: true,
  };
}

export function leerEtiquetaDeAsesor(texto: string): { texto: string; pideAsesor: boolean } {
  PIDE_ASESOR.lastIndex = 0;
  if (!PIDE_ASESOR.test(texto)) return { texto, pideAsesor: false };

  return {
    texto: texto.replace(PIDE_ASESOR, "").replace(/[ \t]+\n/g, "\n").trim(),
    pideAsesor: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Atender una conversación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * QUÉ PUEDE COTIZAR EL AGENTE EN ESTE HILO.
 *
 * El precio sale del catálogo, NUNCA del modelo. Cuando el cliente llegó por un
 * anuncio de Meta, ese anuncio tiene que estar vinculado a un producto: de ahí
 * sale el precio bueno. Si no lo está, el agente no cotiza — dice que le
 * atiende alguien del equipo y se calla.
 *
 * El `meta_ad_id` se guardó en el PRIMER mensaje del hilo, que es el único que
 * lo trae. Leerlo aquí en cada respuesta es la «reinyección»: el anuncio sigue
 * pesando en la conversación número veinte igual que en la primera.
 *
 * Devuelve null cuando no hay nada que añadir —WhatsApp, o Meta sin anuncio—.
 * Ahí manda el prompt de siempre, que ya prohíbe inventar precios.
 *
 * La anomalía se crea una sola vez por hilo: sin la guarda, cada mensaje del
 * cliente generaría otra y la bandeja de revisión quedaría inservible.
 */
async function reglaDePrecio(orgId: number, conv: Conversacion): Promise<string | null> {
  if (!conv.meta_ad_id) return null;

  const { resolverAnuncio, anuncioParaPrompt, explicarMotivo } = await import(
    "@/lib/meta/contexto-anuncio"
  );

  const contexto = resolverAnuncio(orgId, conv.meta_ad_id, conv.producto_anuncio);

  if (!contexto.puedeCotizar && !hayAnomaliaAbierta(orgId, conv.id, "anuncio_sin_producto")) {
    crearAnomalia(orgId, {
      conversationId: conv.id,
      tipo: "anuncio_sin_producto",
      severidad: "alta",
      detalle: explicarMotivo(contexto),
    });
  }

  return anuncioParaPrompt(contexto);
}

/**
 * ¿POR QUÉ NO CONTESTA EL AGENTE EN ESTA CONVERSACIÓN?
 *
 * Dicho en la pantalla del hilo, antes de que nadie tenga que preguntarlo. Un
 * agente callado se ve igual que un agente roto, y hasta ahora la única forma
 * de saber cuál de los dos era pasaba por leer el registro del servidor.
 *
 * Dos de estos silencios son PERMANENTES y no se apagan solos: el cliente pidió
 * una persona, o el propio agente pasó el caso a un asesor. Cuando el asesor
 * termina, ese hilo se queda sin agente para siempre —también cuando el cliente
 * vuelve tres días después a comprar—. Por eso van marcados como reversibles:
 * hay un botón que los deshace. Ver `devolverALaIa`.
 *
 * Vive pegada a `atenderConversacion` porque copia sus guardas, igual que
 * `revisarAgente` copia las del número. Si alguien añade una condición allí y
 * no aquí, la pantalla dirá que todo está bien mientras el agente calla.
 *
 * No llama a ningún modelo: son lecturas de la base.
 */
export interface SilencioEnHilo {
  /** El agente no va a contestar el próximo mensaje de este cliente. */
  callado: boolean;
  motivo: MotivoSilencio | null;
  /** Escrito para quien atiende, no para quien programa. */
  explicacion: string | null;
  /** Se puede devolver el hilo a la IA desde el panel. */
  reversible: boolean;
  /**
   * No lo calla, pero explica un silencio que ya pasó: la última vez que le
   * tocó contestar, el modelo no respondió. Es la diferencia entre «está
   * callado a propósito» y «está roto», y sin decirlo las dos se ven igual.
   */
  aviso: string | null;
}

export function porQueCalla(
  orgId: number,
  canalId: number,
  conversationId: number,
): SilencioEnHilo {
  const aviso = hayAnomaliaAbierta(orgId, conversationId, "agente_sin_modelo")
    ? "La última vez que le tocó contestar aquí, el modelo no respondió. Si se repite, revisa el " +
      "modelo del agente y su respaldo: un modelo gratuito agota su cupo a media tarde."
    : null;

  const hablando: SilencioEnHilo = {
    callado: false, motivo: null, explicacion: null, reversible: false, aviso,
  };
  const callado = (motivo: MotivoSilencio, explicacion: string, reversible = false): SilencioEnHilo => ({
    callado: true, motivo, explicacion, reversible, aviso,
  });

  const canal = obtenerCanal(orgId, canalId);
  if (!canal || canal.activo !== 1) {
    return callado("canal_apagado", "El número está apagado en el panel.");
  }
  if (canal.contesta_ia === 1) {
    return callado(
      "contesta_otra_ia",
      "Este número está en modo vigilar: aquí contesta tu IA y el panel solo mira.",
    );
  }
  if (canal.agente_activo !== 1) {
    return callado("agente_apagado", "El agente está apagado en este número.");
  }

  if (hayAnomaliaAbierta(orgId, conversationId, "handoff_agente")) {
    return callado(
      "pasado_a_asesor",
      "El agente pasó esta conversación a un asesor y dejó de escribir en ella.",
      true,
    );
  }

  const agente = obtenerAgente(orgId, canalId);

  if (agente.pasar_a_humano === 1 && hayAnomaliaAbierta(orgId, conversationId, "pidio_humano")) {
    return callado(
      "pidio_humano",
      "El cliente pidió hablar con una persona, así que el agente se calló en este hilo.",
      true,
    );
  }

  if (getConversation(orgId, conversationId)?.atiende === "humano") {
    return callado(
      "atiende_humano",
      "Esta conversación está puesta en manos de una persona. El agente no escribe aquí " +
        "—con los demás clientes de este número sigue contestando—.",
      true,
    );
  }

  const t = ahora();

  if (agente.silenciar_si_humano === 1 && huboHumanoReciente(orgId, conversationId, t - SILENCIO_TRAS_HUMANO)) {
    return callado(
      "vendedor_reciente",
      "Escribió alguien del equipo hace poco: el agente espera dos horas para no escribir encima.",
    );
  }

  if (agente.horario_activo === 1 && !dentroDeHorario(agente.horario_desde, agente.horario_hasta)) {
    return callado(
      "fuera_de_horario",
      `Fuera del horario de atención (${agente.horario_desde ?? "?"}–${agente.horario_hasta ?? "?"}).`,
    );
  }

  const ultimas = ultimasRespuestasIa(orgId, conversationId, SE_REPITE);
  const repetida = ultimas[0]?.trim();
  if (repetida && ultimas.length === SE_REPITE && ultimas.every((r) => r.trim() === repetida)) {
    return callado(
      "limite_por_hora",
      "El agente mandó tres veces seguidas el mismo mensaje y se detuvo. Atiende este hilo a mano.",
    );
  }

  if (contarRespuestasIa(orgId, conversationId, t - 3600) >= MAX_RESPUESTAS_HORA) {
    return callado(
      "limite_por_hora",
      `El agente ya mandó ${MAX_RESPUESTAS_HORA} mensajes en esta conversación en la última hora y se ` +
        "frenó. Vuelve a contestar solo, en cuanto pase esa hora.",
    );
  }

  return hablando;
}

export type Resultado =
  | { atendida: false; motivo: MotivoSilencio }
  | { atendida: false; motivo: "fallo_modelo"; detalle: string }
  | { atendida: true; messageId: string; modelo: string };

/**
 * Punto de entrada desde el webhook. Es la ÚNICA ruta por la que sale un
 * mensaje de SalesDash.
 */
export async function atenderConversacion(
  orgId: number,
  canalId: number,
  conversationId: number,
): Promise<Resultado> {
  const canal = obtenerCanal(orgId, canalId);
  if (!canal || canal.activo !== 1) return { atendida: false, motivo: "canal_apagado" };
  if (canal.agente_activo !== 1) return { atendida: false, motivo: "agente_apagado" };

  /*
   * EN UN NÚMERO DONDE YA CONTESTA OTRA IA, ESTE AGENTE NO ABRE LA BOCA.
   *
   * `contesta_ia` lo enciende el dueño para decir que las respuestas de ese
   * WhatsApp las escribe un bot suyo y que el panel solo mira. Si además
   * alguien dejara encendido nuestro agente —por descuido, o porque lo probó
   * hace un mes—, el cliente recibiría dos respuestas distintas al mismo
   * mensaje, de dos vendedores que no se conocen entre sí. Eso no se arregla
   * después: ya lo leyó.
   *
   * Por eso la guarda está AQUÍ, en el único camino por el que sale un mensaje,
   * y no en la pantalla que enciende el interruptor: lo que no puede pasar es
   * que hable, no que quede mal configurado.
   */
  if (canal.contesta_ia === 1) return { atendida: false, motivo: "contesta_otra_ia" };

  const conv = getConversation(orgId, conversationId);
  if (!conv) return { atendida: false, motivo: "canal_apagado" };

  // El agente de ESTE canal: su país, su guion y su modelo son suyos.
  const agente = obtenerAgente(orgId, canalId);
  const t = ahora();

  // ── Nunca responder a algo que no escribió el cliente ───────────────────
  let historial = ultimosMensajes(orgId, conversationId, MAX_MENSAJES_CONTEXTO);
  const ultimo = historial[historial.length - 1];
  if (!ultimo || ultimo.emisor !== "cliente") {
    return { atendida: false, motivo: "ultimo_no_es_cliente" };
  }

  /*
   * ── El propio agente ya pasó el caso a una persona ──────────────────────
   *
   * Cuando escribió `[HANDOFF]` dijo que aquí sigue un asesor: el hilo es de
   * un humano desde ese momento. Sin esta guarda el agente volvería a
   * contestar en el siguiente mensaje y se pisaría con el vendedor que acaba
   * de entrar, que es justo lo que la etiqueta pedía evitar.
   */
  if (hayAnomaliaAbierta(orgId, conversationId, "handoff_agente")) {
    return { atendida: false, motivo: "pasado_a_asesor" };
  }


  // ── El cliente pidió una persona ────────────────────────────────────────
  if (agente.pasar_a_humano === 1) {
    const yaPidio = hayAnomaliaAbierta(orgId, conversationId, "pidio_humano");
    if (yaPidio || pideHumano(ultimo.content)) {
      if (!yaPidio) {
        // Que la pantalla del hilo lo diga con el mismo interruptor que usa
        // una persona: quien lo mire tiene que ver «lo atiende un humano», no
        // deducirlo de una anomalía.
        ponerAtiende(orgId, conversationId, "humano");
        crearAnomalia(orgId, {
          conversationId,
          tipo: "pidio_humano",
          severidad: "alta",
          detalle: `${conv.cliente_nombre ?? conv.cliente_phone} pidió hablar con una persona. El agente dejó de responder.`,
        });
      }
      return { atendida: false, motivo: "pidio_humano" };
    }
  }

  /*
   * ── ESTA CONVERSACIÓN LA LLEVA UNA PERSONA ──────────────────────────────
   *
   * El interruptor del hilo, puesto a mano desde el panel. Quien lo pulsó está
   * escribiéndole al cliente ahora mismo, y lo único que no puede pasar es que
   * el agente conteste por encima. Ver `ponerAtiende`.
   *
   * Va DETRÁS de las dos guardas de arriba aunque calle igual: cuando el hilo
   * pasó a una persona porque el cliente la pidió, el motivo que hay que contar
   * es ese —y no «lo lleva un humano», que es la consecuencia—.
   */
  if (conv.atiende === "humano") {
    return { atendida: false, motivo: "atiende_humano" };
  }

  // ── Un vendedor está en la conversación ─────────────────────────────────
  // Esta es la que evita que el agente y el vendedor le escriban encima al
  // cliente a la vez.
  if (agente.silenciar_si_humano === 1 && huboHumanoReciente(orgId, conversationId, t - SILENCIO_TRAS_HUMANO)) {
    return { atendida: false, motivo: "vendedor_reciente" };
  }

  // ── Horario ─────────────────────────────────────────────────────────────
  if (agente.horario_activo === 1 && !dentroDeHorario(agente.horario_desde, agente.horario_hasta)) {
    return { atendida: false, motivo: "fuera_de_horario" };
  }

  // ── Bucles ──────────────────────────────────────────────────────────────
  /*
   * Se para por REPETIRSE, no por hablar mucho. Una venta larga es una venta,
   * no una avería; el agente diciendo tres veces exactamente lo mismo sí lo es.
   */
  const ultimas = ultimasRespuestasIa(orgId, conversationId, SE_REPITE);
  const repetida = ultimas[0]?.trim();

  if (
    repetida &&
    ultimas.length === SE_REPITE &&
    ultimas.every((r) => r.trim() === repetida)
  ) {
    crearAnomalia(orgId, {
      conversationId,
      tipo: "agente_en_bucle",
      severidad: "alta",
      detalle:
        `El agente mandó ${SE_REPITE} veces seguidas el mismo mensaje ("${repetida.slice(0, 80)}") ` +
        "y se detuvo. Atiende esta conversación a mano.",
    });
    return { atendida: false, motivo: "limite_por_hora" };
  }

  // Y el cortafuegos de siempre, ya con sitio para una venta entera.
  if (contarRespuestasIa(orgId, conversationId, t - 3600) >= MAX_RESPUESTAS_HORA) {
    crearAnomalia(orgId, {
      conversationId,
      tipo: "agente_en_bucle",
      severidad: "alta",
      detalle: `El agente ya mandó ${MAX_RESPUESTAS_HORA} mensajes en una hora en esta conversación. Se detuvo para no inundar al cliente.`,
    });
    return { atendida: false, motivo: "limite_por_hora" };
  }

  /*
   * ── MIRAR Y ESCUCHAR ANTES DE CONTESTAR ─────────────────────────────────
   *
   * Va DESPUÉS de todas las guardas de silencio, y eso es a propósito: mirar
   * una foto cuesta una llamada al modelo, y no se paga por una conversación en
   * la que el agente ni va a abrir la boca porque es de madrugada o porque hay
   * un vendedor dentro.
   *
   * Si esto falla, la respuesta sigue adelante con lo que haya. El agente
   * contestando sin haber visto la foto es peor que con ella, pero callarse
   * porque el modelo de visión está caído es peor que las dos cosas.
   */
  const { modeloVision, modeloAudio } = modelosDePercepcion(agente, obtenerOrg(orgId) ?? null);

  if (agente.ver_imagenes === 1 || agente.oir_audios === 1) {
    try {
      historial = await percibir(orgId, historial, {
        ver: agente.ver_imagenes === 1,
        oir: agente.oir_audios === 1,
        modeloVision,
        modeloAudio,
      });
    } catch (e) {
      console.error(`[agente] no se pudo leer lo que mandó el cliente en ${conversationId}`, e);
    }
  }

  /*
   * ── EL PIN DEL MAPA, COMPROBADO ─────────────────────────────────────────
   *
   * Solo si el ÚLTIMO mensaje es la ubicación: es una instrucción para esta
   * respuesta, no un dato del hilo. Cuando el pin cae fuera del país del canal
   * —una ubicación vieja del móvil, el sitio donde el cliente estaba de viaje—
   * lo que se le dice al agente es que pregunte, no que despache ahí.
   */
  const ultimoFresco = historial[historial.length - 1] ?? ultimo;
  const ubicacion =
    agente.validar_mapa === 1
      ? validarUbicacion(ultimoFresco.content, ultimoFresco.media_url, agente.pais || null)
      : null;

  /*
   * DE UNAS COORDENADAS A UNA DIRECCIÓN: provincia, distrito, barrio y calle.
   *
   * Con esto el agente confirma la zona y pide SOLO lo que un mapa no puede
   * darle —el número de casa y una seña— en vez de la dirección entera. Y la
   * dirección queda escrita en el hilo, que es donde la lee quien despacha.
   *
   * Con reloj y sin ruido: es una llamada a un servicio de fuera, y si no
   * contesta a tiempo el agente responde igual, situando la zona por la ciudad
   * más cercana como hacía antes. Nada de esto puede hacer esperar a un cliente.
   */
  if (ubicacion) {
    try {
      const { describirPunto } = await import("./geocodificacion");
      const direccion = await describirPunto(ubicacion.lat, ubicacion.lng, { timeoutMs: 4_000 });

      if (direccion) {
        ubicacion.direccion = direccion;

        const { textoDeUbicacionResuelta } = await import("./ubicacion");
        const { guardarUbicacionResuelta } = await import("./db");
        guardarUbicacionResuelta(
          orgId,
          ultimoFresco.id,
          textoDeUbicacionResuelta(ultimoFresco.content, direccion),
        );
      }
    } catch (e) {
      console.error(`[agente] no se pudo describir la ubicación de ${conversationId}`, e);
    }
  }

  // ── Generar ─────────────────────────────────────────────────────────────
  /*
   * LO QUE DIJO EL ANUNCIO —texto, precio, lo leído en su imagen— se calcula
   * UNA vez y lo leen los tres: el agente al escribir, el revisor al juzgar y
   * el agente otra vez si tiene que reescribir. Si el revisor no lo viera,
   * pararía como inventado el precio que el propio anuncio escribió.
   */
  const reglaPrecio = await reglaDePrecio(orgId, conv);

  let respuesta: RespuestaGenerada;
  try {
    // `conv` lleva el anuncio que abrió el hilo: producto y promesa. Es lo que
    // el agente necesita para no preguntar lo que el cliente ya vino a pedir.
    respuesta = await generarRespuesta(
      orgId,
      canalId,
      historial,
      anuncioVigente(conv),
      reglaPrecio,
      { telefono: conv.cliente_phone, nombre: conv.cliente_nombre },
      ubicacion,
    );
  } catch (e) {
    /*
     * El modelo falló y su respaldo también, o no había respaldo.
     * NO se le escribe nada al cliente. Se calla, se marca la conversación
     * para atención humana y se genera una anomalía de severidad alta.
     */
    const detalle = e instanceof ErrorIA ? e.message : "El modelo no respondió";
    crearAnomalia(orgId, {
      conversationId,
      tipo: "agente_sin_modelo",
      severidad: "alta",
      detalle:
        `El agente no pudo responder (${detalle}). ` +
        (e instanceof ErrorIA && e.esLimite
          ? "El modelo agotó su límite diario. Cambia de modelo o configura uno de respaldo."
          : "Atiende esta conversación a mano."),
    });
    return { atendida: false, motivo: "fallo_modelo", detalle };
  }

  if (!respuesta.texto) return { atendida: false, motivo: "fallo_modelo", detalle: "respuesta vacía" };

  /*
   * ── EL REVISOR, ANTES DE MANDAR ─────────────────────────────────────────
   *
   * La segunda IA del país. Lee el borrador con los datos del país y del
   * catálogo delante y decide si sale. Ver `revisor.ts`: primero las reglas
   * que no cuestan (moneda ajena, envío que no existe, descuento, resumen con
   * huecos), después el modelo revisor.
   *
   * Si no pasa, el agente vuelve a escribir UNA vez con la corrección
   * delante. Si tampoco pasa, al cliente le llega una sola línea honesta y el
   * hilo pasa a una persona con una anomalía que dice qué se paró y por qué.
   * Un error de venta se paga; una línea de espera, no.
   *
   * Solo en canales con archivo de país: el revisor juzga contra ese archivo.
   */
  const datosPais = agenteDePais(agente.pais);
  if (datosPais) {
    const { correccionParaElAgente, revisarBorrador } = await import("./revisor");
    const org = obtenerOrg(orgId);
    const negocio = nombreDelNegocio(agente, canal, org ?? null);
    const cliente = { telefono: conv.cliente_phone, nombre: conv.cliente_nombre };
    const contexto = {
      datos: datosPais,
      marcador: org?.marcador_cierre ?? MARCADOR_POR_DEFECTO,
      nombresDeLaCasa: [agente.nombre, agente.negocio, datosPais.nombreAgente ?? "", datosPais.tienda].filter(Boolean),
      catalogo: textoDeLoQueVende(agente, listarCatalogo(orgId, true)),
      anuncio: [anuncioParaModelo(anuncioVigente(conv)), reglaPrecio].filter(Boolean).join("\n\n") || null,
      ficha: fichaDelHilo(historial, agente.pais),
      clienteCompartioUbicacion: clienteCompartioUbicacion(historial),
      textosDelCliente: textosDelClienteEnSesion(historial),
      telefonoDelChat: conv.cliente_phone,
      lugarDelCliente:
        ubicacion?.direccion?.provincia ??
        ubicacion?.zona?.nombre ??
        lugarEscritoPorElCliente(datosPais, mensajesDeLaSesion(historial)),
      nombreDeCuenta: conv.cliente_nombre,
      clienteEscribioSuNombre: !!conv.cliente_nombre && historial.some(
        (m) => m.emisor === "cliente" && m.content.toLowerCase().includes(conv.cliente_nombre!.toLowerCase()),
      ),
      bloqueDelPais: bloqueDelPais(
        datosPais,
        ubicacion?.direccion?.provincia ??
          ubicacion?.zona?.nombre ??
          lugarEscritoPorElCliente(datosPais, mensajesDeLaSesion(historial)),
        negocio,
      ),
    };

    let veredicto = await revisarBorrador(orgId, org?.modelo_analisis, historial, respuesta.texto, contexto);

    if (!veredicto.aprobado) {
      console.log(
        `[revisor] paró la respuesta en la conversación ${conversationId} (${veredicto.por}): ` +
          veredicto.fallas.join("; "),
      );
      try {
        const segunda = await generarRespuesta(
          orgId,
          canalId,
          historial,
          anuncioVigente(conv),
          [reglaPrecio, correccionParaElAgente(veredicto)].filter(Boolean).join("\n\n"),
          cliente,
          ubicacion,
        );
        if (segunda.texto) {
          const otra = await revisarBorrador(orgId, org?.modelo_analisis, historial, segunda.texto, contexto);
          if (otra.aprobado) {
            respuesta = segunda;
            veredicto = otra;
          } else {
            veredicto = otra;
          }
        }
      } catch (e) {
        console.error(`[revisor] no se pudo reescribir la respuesta de ${conversationId}`, e);
      }
    }

    if (!veredicto.aprobado) {
      crearAnomalia(orgId, {
        conversationId,
        tipo: "respuesta_rechazada",
        severidad: "alta",
        detalle:
          `El revisor paró la respuesta del agente (${veredicto.por === "reglas" ? "por regla" : "el modelo revisor"}): ` +
          `${veredicto.fallas.join("; ")}. Al cliente se le dijo que un representante le confirma, y el hilo pasó a una persona.`,
      });

      // Una sola línea honesta, con el trato del país, y el hilo a una persona.
      respuesta = {
        ...respuesta,
        texto:
          datosPais.trato === "tu"
            ? "Un momento, por favor: un representante te confirma ese dato enseguida."
            : "Un momento, por favor: un representante le confirma ese dato enseguida.",
        pideAsesor: true,
      };
    }
  }

  /*
   * ── EL SEGUNDO RESUMEN NO SALE ──────────────────────────────────────────
   *
   * Si esta conversación ya tiene su venta sellada y el modelo vuelve a
   * escribir el pedido, se le quita antes de mandarlo. Ver
   * `quitarResumenRepetido`: el hilo se queda con UN pedido, que es el que el
   * cliente va a pagar y el que el analista tiene que leer.
   *
   * Se relee la conversación en vez de usar la copia de arriba: entre aquella
   * lectura y esta línea está la llamada al modelo, que son segundos, y en esos
   * segundos un vendedor puede haber cerrado la venta desde su móvil.
   *
   * Va aquí y no en el guion porque en el guion ya está —«no escribas el
   * marcador en ningún otro momento»— y el modelo lo escribe igual. Lo que se
   * le pide a un prompt casi siempre se cumple; lo que no puede pasar, se
   * impide.
   */
  const marcadorOrg = obtenerOrg(orgId)?.marcador_cierre ?? MARCADOR_POR_DEFECTO;
  // `?? null` a propósito: sin conversación no hay venta cerrada, y un `undefined`
  // comparado con `null` daría «cerrada» y callaría al agente por nada.
  const yaCerrada = (getConversation(orgId, conversationId)?.fecha_cierre ?? null) !== null;

  if (yaCerrada && contieneMarcador(respuesta.texto, marcadorOrg)) {
    const recortado = quitarResumenRepetido(respuesta.texto, marcadorOrg);

    crearAnomalia(orgId, {
      conversationId,
      tipo: "resumen_repetido",
      severidad: "media",
      detalle:
        "El agente volvió a escribir el resumen de un pedido que ya estaba cerrado. Se le quitó " +
        "antes de enviarlo" +
        (recortado
          ? ": el cliente recibió solo la respuesta a lo que preguntaba."
          : ", y no quedaba nada más que mandar, así que no se le escribió."),
    });

    /*
     * Sin nada delante del resumen, el mensaje entero ERA el resumen. Callar
     * es lo correcto: el cliente no se queda sin respuesta a nada —no había
     * respuesta, había un pedido repetido— y el próximo mensaje suyo se atiende
     * con normalidad.
     */
    if (!recortado) {
      return { atendida: false, motivo: "resumen_repetido" };
    }
    respuesta.texto = recortado;
  }

  // ── Enviar ──────────────────────────────────────────────────────────────
  /*
   * Cada canal por su transporte. Es el ÚNICO sitio del código donde se elige,
   * y sigue siendo el único camino por el que sale un mensaje: la regla no era
   * «solo existe wa.ts», era «solo agent.ts envía».
   *
   * Un comentario se responde colgado del comentario, en público, porque es
   * donde preguntó el cliente. Contestar solo por privado deja la pregunta a la
   * vista y sin respuesta, y el siguiente que la lea se va.
   */
  const mandar = async (texto: string): Promise<string> => {
    if (canal.tipo === "meta") {
      const { enviarMensajeMeta, responderComentarioMeta } = await import("@/lib/meta/send");
      return conv.superficie === "comentario"
        ? responderComentarioMeta(canal, ultimo.whapi_message_id ?? "", texto)
        : enviarMensajeMeta(canal, conv.cliente_phone, texto);
    }

    /*
     * A la dirección guardada del cliente, no a su número reconstruido.
     *
     * `cliente_jid` es la dirección tal cual la mandó WhatsApp. Solo cae al
     * teléfono en los hilos viejos, de antes de que se guardara: ahí sigue
     * siendo lo único que hay, y para un cliente identificado por su número
     * es exactamente lo mismo.
     */
    return enviarTexto(canal.id, conv.cliente_jid ?? conv.cliente_phone, texto);
  };

  /*
   * EL SALUDO, APARTE — ver `partirEnMensajes`.
   *
   * En la apertura del hilo esta respuesta sale en DOS mensajes: el «hola,
   * bienvenido» y, un segundo después, lo que el cliente vino a preguntar con
   * la talla pedida al final. En todo lo demás sale en uno solo.
   *
   * Y solo en la apertura, que es lo que mira el hilo: si en la ventana ya
   * escribió la IA o un compañero, esta conversación no empieza aquí y no hay
   * nada que saludar. En un comentario público tampoco, nunca: dos respuestas
   * colgadas del mismo comentario se leen como dos personas contestando a la
   * vez delante de todo el mundo.
   */
  const partes = partirEnMensajes(respuesta.texto, {
    saludoAparte:
      conv.superficie !== "comentario" &&
      (historial.every((m) => m.emisor === "cliente") || esClienteQueVuelve(historial)),
    marcador: marcadorOrg,
  });

  /*
   * Un texto que era solo espacios pasa la guarda de arriba —una cadena en
   * blanco no es vacía— y aquí se queda sin partes. No hay nada que mandar, y
   * mandar un mensaje en blanco es peor que callarse.
   */
  if (partes.length === 0) {
    return { atendida: false, motivo: "fallo_modelo", detalle: "respuesta vacía" };
  }

  /*
   * ── NO CONTESTAR AL INSTANTE ────────────────────────────────────────────
   *
   * Un negocio no responde en medio segundo. Una respuesta inmediata —y encima
   * bien escrita— es lo que delata a un bot antes de la segunda frase: el
   * cliente deja de hablar con una tienda y empieza a hablar con un sistema.
   *
   * El retardo se cuenta desde que ENTRÓ el mensaje del cliente, no desde
   * ahora: mirar la foto, oír la nota de voz y pensar la respuesta ya han
   * costado segundos, y esos cuentan. Así esto es un mínimo de naturalidad y no
   * un impuesto encima de lo que ya se tardó; con el modelo lento no espera
   * nada, y con el modelo rápido espera lo que falte.
   *
   * Mientras espera, el cliente ve «escribiendo…», que es exactamente lo que
   * vería si le estuviera contestando una persona.
   */
  const espera = esperaDeCortesia(agente.retardo_seg, ahora() - ultimo.created_at);

  if (espera > 0) {
    if (canal.tipo !== "meta") {
      const { marcarEscribiendo } = await import("./wa");
      await marcarEscribiendo(canal.id, conv.cliente_jid ?? conv.cliente_phone, true);
    }
    await esperar(espera * 1000);
  }

  const enviados: string[] = [];

  for (const [i, parte] of partes.entries()) {
    if (i > 0) {
      // El saludo ya salió; el cliente ve «escribiendo…» mientras llega lo
      // demás, como cuando al otro lado hay alguien tecleando de verdad.
      if (canal.tipo !== "meta") {
        const { marcarEscribiendo } = await import("./wa");
        await marcarEscribiendo(canal.id, conv.cliente_jid ?? conv.cliente_phone, true);
      }
      await esperar(PAUSA_ENTRE_MENSAJES);
    }

    let idParte: string;
    try {
      idParte = await mandar(parte);
    } catch (e) {
      const causa = e instanceof Error ? e.message : "error desconocido";

      /*
       * Que salga el saludo y se caiga lo de detrás es el peor de los dos
       * fallos: el cliente se queda mirando un «hola» que no lleva a ninguna
       * parte y que parece que alguien empezó a escribirle y se fue. Se dice
       * con esas palabras para que quien lea la bandeja entre a rematarlo.
       */
      crearAnomalia(orgId, {
        conversationId,
        tipo: "envio_fallido",
        severidad: "alta",
        detalle:
          enviados.length === 0
            ? `No se pudo enviar la respuesta: ${causa}`
            : `Salió el saludo pero no la respuesta que iba detrás (${causa}). El cliente se quedó ` +
              "con un «hola» y nada más: contéstale tú.",
      });

      if (enviados.length === 0) {
        return { atendida: false, motivo: "fallo_modelo", detalle: "no se pudo enviar" };
      }
      break;
    }

    enviados.push(idParte);

    /*
     * ATRIBUCIÓN — esto NO puede fallar en silencio.
     *
     * Si el id no se registra, el webhook del saliente lo contará como humano y
     * la métrica central del producto queda al revés. Va inmediatamente después
     * del envío —de CADA envío, que ahora pueden ser dos— y si algo saliera mal
     * se grita en el registro.
     */
    try {
      registrarAiSent(orgId, idParte);
      insertMessage(orgId, {
        conversationId,
        whapiMessageId: idParte,
        emisor: "ia",
        tipo: "texto",
        content: parte,
        createdAt: ahora(),
      });
    } catch (e) {
      console.error(
        `CRÍTICO: se envió el mensaje ${idParte} pero no se pudo registrar como de la IA. ` +
          "Se contará como humano y las métricas quedarán mal.",
        e,
      );
      crearAnomalia(orgId, {
        conversationId,
        tipo: "atribucion_perdida",
        severidad: "alta",
        detalle: "Se envió una respuesta de la IA que no se pudo registrar. Revisa a quién se atribuye.",
      });
    }
  }

  const messageId = enviados[enviados.length - 1]!;

  /*
   * Si este mensaje era el resumen del pedido, la venta queda cerrada AQUÍ.
   *
   * Tiene que ser en este punto y no en la ingesta: el mensaje que el agente
   * acaba de mandar ya está guardado, así que cuando WhatsApp lo devuelva por
   * el socket la inserción no hará nada —es idempotente— y nadie más volvería
   * a mirarlo. Sin esto, la IA cierra la venta y el dashboard no se entera.
   *
   * Se sella con lo que DE VERDAD salió, no con lo que el modelo escribió: un
   * resumen nunca se parte —lleva el marcador— así que o salió entero o no
   * salió, y en ese segundo caso no hay ninguna venta que cerrar.
   */
  try {
    const salido = partes.slice(0, enviados.length).join("\n\n");
    if (registrarCierre(orgId, conversationId, { emisor: "ia", content: salido, cuando: ahora() })) {
      console.log(`[agente] venta cerrada por la IA en la conversación ${conversationId}`);
    }
  } catch (e) {
    console.error(`CRÍTICO: no se pudo sellar el cierre de la conversación ${conversationId}`, e);
  }

  /*
   * El agente pidió que siga una persona: aquí es donde se le avisa.
   *
   * La etiqueta ya se le quitó al mensaje —el cliente no la ve—, pero el aviso
   * tiene que llegar a alguien o la petición se queda en nada. La anomalía es
   * lo que lo saca a la pantalla, y de paso es lo que calla al agente en el
   * siguiente mensaje: a partir de aquí atiende un asesor.
   */
  if (respuesta.pideAsesor && !hayAnomaliaAbierta(orgId, conversationId, "handoff_agente")) {
    ponerAtiende(orgId, conversationId, "humano");
    crearAnomalia(orgId, {
      conversationId,
      tipo: "handoff_agente",
      severidad: "alta",
      detalle:
        `${conv.cliente_nombre ?? conv.cliente_phone} necesita un asesor: el agente pasó el caso ` +
        "y dejó de responder en esta conversación.",
    });
  }

  return { atendida: true, messageId, modelo: respuesta.modelo };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seguimientos — los dos mensajes que salen sin que el cliente escriba
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El aviso de que el pedido va en camino NO lo escribe el modelo.
 *
 * Es un mensaje de una sola frase, siempre el mismo, y lo único que cambia es
 * el nombre. Pedírselo a un modelo costaría dinero, tardaría, podría fallar y
 * —lo que de verdad importa— podría inventarse una hora de entrega o un plazo
 * que nadie prometió. Aquí no hay nada que decidir: el mensajero salió.
 */
function textoDeEntrega(nombre: string | null): string {
  const quien = nombre?.trim().split(/\s+/)[0];
  return (
    `${quien ? `${quien}, s` : "S"}u pedido ya va en camino con el mensajero. ` +
    "Esté pendiente a su teléfono para recibirlo."
  );
}

/**
 * Manda uno de los dos seguimientos y lo deja registrado.
 *
 * Vive AQUÍ, con el resto del agente, porque este sigue siendo el único módulo
 * que puede escribirle a un cliente. `seguimiento.ts` decide a quién le toca;
 * quien manda es este archivo, y así la regla se comprueba en un solo sitio.
 *
 * Devuelve `true` solo si el mensaje salió de verdad. Si algo falla, se calla:
 * un seguimiento es un mensaje que nadie pidió, y ante la duda no se manda.
 */
export async function enviarSeguimiento(
  orgId: number,
  conversationId: number,
  tipo: TipoSeguimiento,
): Promise<boolean> {
  const conv = getConversation(orgId, conversationId);
  if (!conv) return false;

  const canal = obtenerCanal(orgId, conv.canal_id);
  if (!canal || canal.activo !== 1 || canal.agente_activo !== 1 || canal.contesta_ia === 1) {
    return false;
  }

  const agente = obtenerAgente(orgId, canal.id);

  /*
   * El horario manda también aquí, y aquí manda más que en una respuesta: una
   * respuesta a deshora al menos contesta a alguien que acaba de escribir; un
   * recordatorio a las tres de la mañana lo manda el panel solo, a un cliente
   * que no ha hecho nada, y despierta a quien lo recibe.
   */
  if (agente.horario_activo === 1 && !dentroDeHorario(agente.horario_desde, agente.horario_hasta)) {
    return false;
  }
  if (agente.horario_activo !== 1 && !enHoraDecente()) return false;

  let texto: string;

  if (tipo === "entrega") {
    // Sin el nombre de la cuenta: solo cuenta el que el cliente escribió, y
    // ese ya va en el resumen. El aviso sale igual de bien sin nombre.
    texto = textoDeEntrega(null);
  } else {
    /*
     * El de «se quedó en visto» sí lo escribe el modelo: tiene que nombrar el
     * artículo del que se estaba hablando, y eso está en el hilo. Un
     * «¿sigue interesado?» a secas no rescata ninguna venta.
     *
     * La instrucción va como un turno del cliente porque la conversación tiene
     * que terminar en uno —los modelos actuales rechazan lo contrario—, y va
     * marcada como interna para que el modelo no la trate como algo que dijo
     * el cliente ni la repita.
     */
    const historial = ultimosMensajes(orgId, conversationId, MAX_MENSAJES_CONTEXTO);
    if (historial.length === 0) return false;

    let generada: RespuestaGenerada;
    try {
      generada = await generarRespuesta(
        orgId,
        canal.id,
        [...historial, mensajeInterno(orgId, conversationId, INSTRUCCION_VISTO)],
        conv,
        await reglaDePrecio(orgId, conv),
        { telefono: conv.cliente_phone, nombre: conv.cliente_nombre },
      );
    } catch {
      // Ni una anomalía: que no salga un recordatorio no es una avería que
      // haya que enseñarle a nadie. El cliente no está esperando nada.
      return false;
    }
    texto = generada.texto;
  }

  if (!texto.trim()) return false;

  let messageId: string;
  try {
    if (canal.tipo === "meta") {
      const { enviarMensajeMeta } = await import("@/lib/meta/send");
      messageId = await enviarMensajeMeta(canal, conv.cliente_phone, texto);
    } else {
      messageId = await enviarTexto(canal.id, conv.cliente_jid ?? conv.cliente_phone, texto);
    }
  } catch (e) {
    console.error(`[seguimiento] no se pudo enviar el ${tipo} de la conversación ${conversationId}`, e);
    return false;
  }

  registrarAiSent(orgId, messageId);
  insertMessage(orgId, {
    conversationId,
    whapiMessageId: messageId,
    emisor: "ia",
    tipo: "texto",
    content: texto,
    createdAt: ahora(),
  });
  registrarSeguimiento(orgId, conversationId, tipo);
  return true;
}

/** Lo que se le pide al modelo para rescatar una conversación abandonada. */
const INSTRUCCION_VISTO =
  "[Nota interna del sistema, no la escribió el cliente y no debes mencionarla ni repetirla.] " +
  "El cliente dejó de contestar y no ha vuelto. Escríbele UN solo mensaje corto para retomar la " +
  "venta: recuérdale con naturalidad el artículo del que estaban hablando, dile que queda poco " +
  "inventario de ese modelo y termina con una pregunta que lo acerque al cierre —la talla, la " +
  "medida, el color o la dirección, lo que faltara—. Sin saludo largo, sin disculpas, sin repetir " +
  "todo lo hablado, y nunca inventes precios, descuentos ni plazos.";

/** Un turno «del cliente» que en realidad es una instrucción para el modelo. */
function mensajeInterno(orgId: number, conversationId: number, texto: string): Mensaje {
  return {
    id: -1,
    org_id: orgId,
    conversation_id: conversationId,
    whapi_message_id: null,
    emisor: "cliente",
    tipo: "texto",
    descripcion_imagen: null,
    categoria_imagen: null,
    transcripcion: null,
    media_url: null,
    content: texto,
    created_at: ahora(),
  };
}

/**
 * Una hora a la que se le puede escribir a alguien que no ha preguntado nada.
 *
 * Solo se aplica cuando la cuenta no tiene horario propio: si lo tiene, ese
 * manda. De 8 de la mañana a 9 de la noche, hora del servidor.
 */
function enHoraDecente(fecha = new Date()): boolean {
  const h = fecha.getHours();
  return h >= 8 && h < 21;
}

/**
 * Chat de prueba del panel: genera con la configuración real y NO envía.
 *
 * Se prueba UN canal, no «el agente»: el de Panamá y el de Costa Rica contestan
 * distinto a la misma frase, y probar una mezcla de los dos no serviría para
 * decidir nada.
 */
export async function probarAgente(
  orgId: number,
  canalId: number,
  conversacion: { rol: "cliente" | "agente"; texto: string }[],
) {
  const falsos: Mensaje[] = conversacion.map((m, i) => ({
    id: i + 1,
    org_id: orgId,
    conversation_id: 0,
    whapi_message_id: null,
    emisor: m.rol === "cliente" ? "cliente" : "ia",
    tipo: "texto",
    descripcion_imagen: null,
    categoria_imagen: null,
    transcripcion: null,
    media_url: null,
    content: m.texto,
    created_at: ahora() + i,
  }));

  return generarRespuesta(orgId, canalId, falsos);
}

/** Para el analista y el panel: el hilo completo, por si hace falta. */
export function historialCompleto(orgId: number, conversationId: number): Mensaje[] {
  return listarMensajes(orgId, conversationId);
}

/**
 * LO QUE ESCRIBE UNA PERSONA DESDE LA BANDEJA.
 *
 * Vive en `agent.ts` y no en la ruta que la llama, y esa es toda la decisión:
 * la regla del proyecto no es «solo la IA escribe», es «solo este archivo
 * escribe». Un segundo módulo capaz de mandarle un mensaje a un cliente es, el
 * día que falla, dos vendedores contestando a la vez sin saber uno del otro —y
 * eso el cliente ya lo leyó, no se arregla después—. Así sigue habiendo una
 * sola puerta.
 *
 * Tres cosas pasan aquí, y las tres importan:
 *
 *  1. SE ENVÍA por el transporte del canal. Un comentario se contesta colgado
 *     del comentario, en público, porque es donde preguntó el cliente.
 *  2. SE GUARDA como `humano`, y NO se registra en `ai_sent_ids`. Ese registro
 *     es lo que hace que un saliente cuente como de la IA; un mensaje de
 *     vendedor que se colara ahí le regalaría la venta a la IA y dejaría la
 *     métrica central del producto al revés.
 *  3. SE CALLA AL AGENTE en este hilo. Quien toma un chat lo toma entero:
 *     que la IA siguiera contestando por debajo es el mismo desastre de dos
 *     voces, solo que una de ellas no duerme.
 *
 * El cierre se evalúa igual que en cualquier otro mensaje: si el vendedor manda
 * el resumen con el marcador, esa venta queda sellada como suya en el momento
 * en que la manda.
 */
export async function enviarAMano(
  orgId: number,
  conversationId: number,
  texto: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const limpio = texto.trim();
  if (!limpio) return { ok: false, error: "No hay nada que enviar." };

  const conv = getConversation(orgId, conversationId);
  if (!conv) return { ok: false, error: "Esa conversación no existe." };

  const canal = obtenerCanal(orgId, conv.canal_id);
  if (!canal) return { ok: false, error: "El canal de esta conversación ya no está." };

  /*
   * El agente se calla ANTES de enviar, no después.
   *
   * Entre el envío y el apagado hay segundos, y en esos segundos puede entrar
   * un mensaje del cliente que despierte al agente: dos respuestas cruzadas
   * mientras el vendedor cree que ya tomó el chat.
   */
  ponerAtiende(orgId, conversationId, "humano");

  let messageId: string;

  try {
    if (canal.tipo === "meta") {
      const { enviarMensajeMeta, responderComentarioMeta } = await import("@/lib/meta/send");

      if (conv.superficie === "comentario") {
        /*
         * Al comentario se contesta colgándose de él, y para eso hace falta su
         * identificador: es el `whapi_message_id` del último mensaje del hilo.
         * Sin él no hay dónde colgar la respuesta, y mandarla por privado
         * dejaría la pregunta pública sin contestar a la vista de todos.
         */
        const ultimos = ultimosMensajes(orgId, conversationId, 12);
        const comentario = [...ultimos]
          .reverse()
          .find((m) => m.emisor === "cliente" && m.whapi_message_id);

        if (!comentario?.whapi_message_id) {
          return { ok: false, error: "No se encuentra el comentario al que contestar." };
        }

        messageId = await responderComentarioMeta(canal, comentario.whapi_message_id, limpio);
      } else {
        messageId = await enviarMensajeMeta(canal, conv.cliente_phone, limpio);
      }
    } else {
      messageId = await enviarTexto(canal.id, conv.cliente_jid ?? conv.cliente_phone, limpio);
    }
  } catch (e) {
    /*
     * El error de Meta o de WhatsApp se propaga con su texto. Los que se ven de
     * verdad —el token caducado, la ventana de 24 horas, el permiso que falta—
     * se arreglan de tres formas distintas, y un «no se pudo enviar» genérico
     * deja a quien lo lee sin saber cuál le tocó.
     */
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo enviar el mensaje." };
  }

  insertMessage(orgId, {
    conversationId,
    whapiMessageId: messageId,
    emisor: "humano",
    tipo: "texto",
    content: limpio,
    createdAt: ahora(),
  });

  // El resumen del vendedor cierra la venta igual que el de la IA, y se le
  // acredita a él. Ver la regla maestra en `sellarCierre`.
  registrarCierre(orgId, conversationId, { emisor: "humano", content: limpio, cuando: ahora() });

  return { ok: true, messageId };
}
