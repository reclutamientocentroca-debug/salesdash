/**
 * SalesDash — el marcador de cierre.
 *
 * UNA VENTA SE REGISTRA EN CUANTO SE CIERRA, NO CUANDO ALGUIEN LO PIDE.
 *
 * El marcador (`Resumen:` por defecto, configurable por cuenta) es la frase con
 * la que un mensaje saliente declara que el pedido quedó cerrado. Reconocerlo
 * es MECÁNICO: no hace falta modelo, ni visión, ni una llamada a nadie. Por eso
 * el sellado ocurre aquí, en el momento en que el mensaje entra en la base de
 * datos, y no en el barrido del analista.
 *
 * Antes esto vivía solo dentro del analista, y el analista solo corre cuando
 * alguien pulsa «Analizar». Una venta cerrada a las diez de la mañana no
 * existía para el dashboard hasta que a alguien se le ocurría entrar a pedir el
 * barrido. Esa era la avería.
 *
 * Lo que el analista sigue haciendo después, y esto no cambia: sacar del hilo
 * el producto, el total y el envío. Eso sí necesita el modelo.
 */
import {
  asentarMontosSiFaltan,
  obtenerOrg,
  orgsParaBarrerCierres,
  reatribuirCierrePorResumen,
  salientesDeHilosPorSellar,
  sellarCierre,
  type Emisor,
} from "./db";
import { montosDelResumen } from "./moneda";

/** Marcador por defecto cuando la cuenta no tiene uno propio. */
export const MARCADOR_POR_DEFECTO = "Resumen:";

/**
 * ¿Este mensaje lleva el marcador de cierre?
 *
 * Sin distinguir mayúsculas y en cualquier parte del mensaje: la IA lo pone
 * tras el saludo y la despedida, y un vendedor lo escribe como le sale.
 *
 * Y ADMITIENDO PALABRAS EN MEDIO. Esta era la avería de verdad: el marcador es
 * «Resumen:» y la IA escribe «Resumen de su pedido:», que no contiene
 * «Resumen:» por ningún lado. La venta estaba cerrada, con su total y su
 * dirección escritos en el hilo, y el panel la enseñaba abierta. Nadie va a
 * pelearse con el prompt de su agente para que escriba los dos puntos pegados;
 * el que tiene que ceder es esto.
 *
 * Solo se afloja cuando el marcador termina en dos puntos, que es lo que lo
 * hace reconocible: son el «aquí viene el pedido». Un marcador sin dos puntos
 * («Pedido confirmado») se sigue buscando tal cual, porque ahí la frase entera
 * ES la señal y aflojarla la convertiría en cualquier cosa.
 */
export function contieneMarcador(texto: string, marcador: string): boolean {
  const bruto = marcador.trim();
  if (!bruto) return false;

  if (!bruto.endsWith(":")) return texto.toLowerCase().includes(bruto.toLowerCase());

  const raiz = bruto.slice(0, -1).trim();
  if (!raiz) return texto.includes(":");

  const escapada = raiz.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hastaSeisPalabras = `(?:[ \\t]+[\\p{L}\\p{N}]+){0,6}`;

  /*
   * Dos formas de escribir lo mismo, y las dos son un resumen de pedido.
   *
   * CON DOS PUNTOS, en cualquier parte del mensaje: «Resumen:», «Resumen de su
   * pedido:». Los dos puntos tienen que estar en la MISMA línea que la raíz —
   * unos que aparecen tres párrafos más abajo son de otra frase.
   */
  const conDosPuntos = new RegExp(`${escapada}${hastaSeisPalabras}[ \\t]*:`, "iu");

  /*
   * COMO TÍTULO: una línea que empieza por la raíz y no dice nada más, que es
   * como lo escriben casi todos los agentes — «📋 RESUMEN DEL PEDIDO» y debajo
   * el pedido. Sin esto, una venta con su producto, su total y su dirección
   * escritos en el hilo se quedaba abierta para siempre por no llevar dos
   * puntos.
   *
   * Empezar la línea es la condición que lo hace seguro: delante y detrás solo
   * se admite adorno —emojis, viñetas, los asteriscos de las negritas de
   * WhatsApp—, nunca más palabras. «Ahora le paso el resumen» no empieza por la
   * raíz, así que sigue sin cerrar nada: es una promesa, no un pedido.
   */
  const adorno = `[^\\p{L}\\p{N}\\n]*`;
  const comoTitulo = new RegExp(`^${adorno}${escapada}${hastaSeisPalabras}${adorno}$`, "imu");

  return conDosPuntos.test(texto) || comoTitulo.test(texto);
}

export interface Cierre {
  quien: "ia" | "humano";
  senal: string;
}

/**
 * De quién es el cierre. LO DECIDE LA SEÑAL, no quién la mandó.
 *
 * EL RESUMEN DE PEDIDO ES SIEMPRE AUTOMATIZADO. Si en el hilo sale el resumen,
 * la venta es de la IA: da igual que lo escriba nuestro agente, el bot propio
 * del dueño en un número que solo vigilamos, o que salga por el móvil de un
 * vendedor. Desde que se manda el resumen, el pedido lo cerró la máquina.
 *
 * Y ESO ES LO ÚNICO QUE HAY AQUÍ. Lo asistido no se cierra con texto: se cierra
 * con la FOTO DE LA FACTURA sin que en el hilo haya habido resumen, y esa señal
 * no pasa por esta función —pide visión y la reconoce el analista, en
 * `buscarPrimeraSenal`—. Si un cierre lleva `resumen_ia`, es de la IA; si lleva
 * `imagen_factura` o `imagen_comprobante`, es del equipo. No hay un tercer caso.
 *
 * Antes esto miraba el emisor del mensaje y de ahí salía el error que el panel
 * enseñaba: desde fuera, un resumen escrito por el bot ajeno del dueño y uno
 * escrito a mano son idénticos, así que medio catálogo de ventas automatizadas
 * se contaba del lado del equipo. Que una persona metiera mano en el hilo se
 * sigue viendo donde le toca —la pastilla de intervención—, que es otro dato:
 * quién cerró y si alguien ayudó son dos preguntas distintas.
 *
 * `confirmacion_texto` y `resumen_tras_intervencion` ya no se producen. Se
 * siguen reconociendo al mostrarlos porque hay conversaciones viejas selladas
 * con esas señales; la migración las convierte, pero un informe exportado antes
 * puede traerlas.
 */
export function duenoDelCierre(emisor: Emisor): Cierre | null {
  if (emisor === "cliente") return null;
  return { quien: "ia", senal: "resumen_ia" };
}

/**
 * Sella el cierre si este mensaje lleva el marcador. Devuelve true solo si fue
 * ESTE mensaje el que se quedó con la venta.
 *
 * Sobre una conversación ya cerrada normalmente no hace nada —lo garantiza
 * `sellarCierre`, donde vive la regla maestra de «el primero que cierra se
 * lleva la venta»— con una excepción: si lo que la cerró fue una FACTURA, este
 * resumen se la quita. El resumen es el momento en que el pedido queda cerrado
 * y la factura es papeleo alrededor de esa misma venta; un vendedor que
 * adelanta la factura no le quita a la IA la venta que la IA cerró.
 *
 * Llamar a esto de más es inofensivo; llamarlo de menos deja una venta sin
 * contar, o contada al lado equivocado.
 */
export function registrarCierre(
  orgId: number,
  conversationId: number,
  mensaje: { emisor: Emisor; content: string; cuando: number },
): boolean {
  if (mensaje.emisor === "cliente") return false;

  const marcador = obtenerOrg(orgId)?.marcador_cierre ?? MARCADOR_POR_DEFECTO;
  if (!contieneMarcador(mensaje.content, marcador)) return false;

  const cierre = duenoDelCierre(mensaje.emisor);
  if (!cierre) return false;

  const sellado = sellarCierre(orgId, conversationId, {
    cerradoPor: cierre.quien,
    senal: cierre.senal,
    fechaCierre: mensaje.cuando,
  });

  /*
   * El resumen ya dice el total y el envío: se apuntan aquí mismo, sin
   * esperar al analista, para que la venta facture en el panel desde el
   * minuto en que se cierra. Ver `asentarMontosSiFaltan`.
   */
  const asentarDinero = () =>
    asentarMontosSiFaltan(orgId, conversationId, montosDelResumen(mensaje.content));

  if (sellado) {
    asentarDinero();
    return true;
  }

  // Estaba cerrada. Solo se le quita la venta a una factura, y `WHERE` de
  // `reatribuirCierrePorResumen` es quien lo garantiza.
  const reatribuido = reatribuirCierrePorResumen(orgId, conversationId, {
    cerradoPor: cierre.quien,
    senal: cierre.senal,
  });
  if (reatribuido) asentarDinero();
  return reatribuido;
}

/**
 * Sella las ventas que ya estaban cerradas y nadie había contado.
 *
 * El sellado al entrar el mensaje solo alcanza a lo que entra DESDE que existe.
 * Las conversaciones que ya estaban en la base con su resumen de pedido dentro
 * —cerradas de verdad, con el pedido escrito en el hilo— seguían apareciendo
 * como abiertas: la venta estaba hecha y el panel no la contaba.
 *
 * Y arregla de paso las que se contaron al lado equivocado: si a un hilo lo
 * cerró una factura y dentro hay un resumen de pedido, la venta es de quien
 * escribió el resumen. Ver `reatribuirCierrePorResumen`.
 *
 * Se recorre solo lo que puede cambiar: los mensajes que mandamos nosotros en
 * esos dos grupos de hilos. Del primero que lleve el marcador sale el cierre,
 * con su hora y su dueño; los siguientes de ese mismo hilo ya no importan,
 * porque entre dos resúmenes manda el primero.
 *
 * No llama al modelo. El cierre es mecánico y se cuenta ya; el pedido de dentro
 * —producto, total, envío— lo saca el analista después, y hacer una llamada por
 * cada venta vieja al arrancar convertiría un despliegue en una factura.
 *
 * Es idempotente: a la segunda pasada no queda nada que sellar ni que
 * reatribuir, porque ningún hilo cerrado por un resumen entra en la consulta.
 */
export function sellarCierresPendientes(orgId: number): number {
  const marcador = obtenerOrg(orgId)?.marcador_cierre ?? MARCADOR_POR_DEFECTO;

  const sellados = new Set<number>();

  for (const m of salientesDeHilosPorSellar(orgId)) {
    if (sellados.has(m.conversation_id)) continue;
    if (!contieneMarcador(m.content, marcador)) continue;

    const cerro = registrarCierre(orgId, m.conversation_id, {
      emisor: m.emisor,
      content: m.content,
      cuando: m.created_at,
    });
    if (cerro) sellados.add(m.conversation_id);
  }

  return sellados.size;
}

/**
 * El barrido del arranque, para todas las cuentas.
 *
 * Va en el arranque y no en una migración de una sola vez a propósito: si
 * alguna vez un mensaje entra por un camino que no selle —una importación, un
 * fallo a mitad de lote—, el siguiente despliegue lo arregla solo. Cuando no
 * hay nada pendiente no cuesta nada: una consulta por cuenta con hilos
 * abiertos, y ni un UPDATE.
 */
export function barrerCierresPendientes(): number {
  let total = 0;
  for (const orgId of orgsParaBarrerCierres()) {
    total += sellarCierresPendientes(orgId);
  }
  return total;
}
