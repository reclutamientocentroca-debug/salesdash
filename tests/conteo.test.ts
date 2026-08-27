import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { llegoPorAnuncio, anuncioParaModelo } from "../src/lib/anuncio";
import { registrarCierre, sellarCierresPendientes } from "../src/lib/cierre";
import { informeDeCanal, informeDeCuenta } from "../src/lib/informe";
import { calcularMetricas, rellenarDias } from "../src/lib/metrics";

/**
 * La invariante del procedimiento diario:
 *
 *   leads = cerradas_ia + cerradas_humano + abiertas + revision
 *
 * Si no cuadra, hay conversaciones perdiéndose y el reporte es falso.
 */

const RANGO = { desde: 0, hasta: 9_999_999_999 };

const { orgId } = D.crearOrgConDueno({
  negocio: "Conteo",
  color: "#12876a",
  nombre: "Dueño",
  email: "conteo@prueba.com",
  passwordHash: "hash",
});

const canalId = D.crearCanal(orgId, {
  nombre: "Ventas",
  phone: "18091110000",
  tokenCifrado: "x",
  webhookSecret: "s",
  whapiChannelId: null,
  estado: "conectado",
});

let siguiente = 1;
function nuevaConversacion(t = 1_700_000_000) {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, `1809000${siguiente++}`, {
    cuando: t,
  });
  return conversacion.id;
}

// 3 cerradas por la IA, 2 por humanos, 4 abiertas, 2 en revisión = 11 leads.
const cerradasIa = [0, 1, 2].map(() => nuevaConversacion());
const cerradasHumano = [0, 1].map(() => nuevaConversacion());
const abiertas = [0, 1, 2, 3].map(() => nuevaConversacion());
const enRevision = [0, 1].map(() => nuevaConversacion());

for (const id of cerradasIa) {
  D.sellarCierre(orgId, id, { cerradoPor: "ia", senal: "resumen_ia", fechaCierre: 1_700_000_600 });
  D.actualizarConversacion(orgId, id, { total: 1000, envio: 200, producto_vendido: "Camisa" });
}
for (const id of cerradasHumano) {
  D.sellarCierre(orgId, id, { cerradoPor: "humano", senal: "imagen_factura", fechaCierre: 1_700_001_200 });
  D.actualizarConversacion(orgId, id, { total: 2000, envio: 200, producto_vendido: "camisa " });
}
for (const id of enRevision) {
  D.marcarRevision(orgId, id, "empate de horas");
}

test("leads = ia + humano + abiertas + revision", () => {
  const e = D.conteoPorEstado(orgId, RANGO);
  assert.equal(D.totalLeads(orgId, RANGO), 11);
  assert.equal(e.ia + e.humano + e.abierta + e.revision, 11);
  assert.deepEqual(e, { ia: 3, humano: 2, abierta: 4, revision: 2 });
});

test("calcularMetricas expone la invariante y no la esconde", () => {
  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.cuadra, true);
  assert.equal(m.leads, m.cierres_ia + m.cierres_humano + m.sin_cerrar + m.revision);
  assert.equal(m.revision, 2);
});

test("la invariante aguanta después de resolver una revisión", () => {
  D.resolverRevision(orgId, enRevision[0]!, "humano");

  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.cuadra, true);
  assert.equal(m.leads, 11);
  assert.equal(m.cierres_humano, 3);
  assert.equal(m.revision, 1);
});

test("el ranking agrupa productos aunque el modelo los escriba distinto", () => {
  // "Camisa" y "camisa " son el mismo producto: 5 unidades, no dos filas.
  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.top_productos.length, 1);
  assert.equal(m.top_productos[0]!.producto, "Camisa");
  assert.equal(m.top_productos[0]!.unidades, 5);
});

test("los tiempos promedio excluyen las conversaciones abiertas", () => {
  const m = calcularMetricas(orgId, RANGO);
  // Las cerradas por la IA tardaron 600 s; las abiertas no cuentan.
  assert.equal(m.tiempo_promedio_ia, 600);
  assert.notEqual(m.tiempo_promedio_humano, null);
});

test("una conversación nueva entra como lead y sigue cuadrando", () => {
  nuevaConversacion();
  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.leads, 12);
  assert.equal(m.sin_cerrar, 5);
  assert.equal(m.cuadra, true);
});

test("el gráfico rellena los días sin actividad", () => {
  // serieDiaria solo devuelve días con datos: sin rellenar, un martes en cero
  // desaparece y la línea une el lunes con el miércoles ocultando la caída.
  const serie = [
    { dia: "2026-08-15", leads: 7, leads_anuncio: 4, cierres_ia: 2, cierres_humano: 1 },
    { dia: "2026-08-18", leads: 5, leads_anuncio: 2, cierres_ia: 3, cierres_humano: 2 },
  ];
  const desde = Math.floor(Date.parse("2026-08-15T00:00:00Z") / 1000);
  const hasta = Math.floor(Date.parse("2026-08-18T23:59:59Z") / 1000);

  const llena = rellenarDias(serie, { desde, hasta });

  assert.equal(llena.length, 4, "del 15 al 18 son cuatro días");
  assert.deepEqual(
    llena.map((d) => d.leads),
    [7, 0, 0, 5],
    "los días 16 y 17 tienen que aparecer en cero",
  );
});

test("el gráfico no dibuja días futuros", () => {
  // El rango se calcula en hora local y llega hasta las 23:59 de hoy; SQLite
  // agrupa en UTC. Al oeste de Greenwich esas 23:59 ya son mañana en UTC.
  const finDeHoyLocal = Math.floor(
    new Date(new Date().setHours(23, 59, 59, 0)).getTime() / 1000,
  );
  const hace2Dias = finDeHoyLocal - 2 * 86_400;

  const llena = rellenarDias([], { desde: hace2Dias, hasta: finDeHoyLocal });
  const hoyUTC = new Date().toISOString().slice(0, 10);

  assert.ok(llena.length > 0, "debe generar días");
  assert.ok(
    llena[llena.length - 1]!.dia <= hoyUTC,
    `el último día del gráfico (${llena[llena.length - 1]!.dia}) no puede ser posterior a hoy (${hoyUTC})`,
  );
});

/**
 * Los leads de anuncio son otra pregunta, no una redefinición.
 *
 * El panel enseña «Leads por anuncio» porque es lo que le importa a quien paga
 * publicidad. Pero el total sigue siendo la base de la invariante de arriba y
 * de los porcentajes de cierre: si algún día alguien sustituye uno por otro,
 * los porcentajes empiezan a mentir y el aviso de «los números no cuadran»
 * salta sin que nada esté roto de verdad.
 */
test("los leads de anuncio se cuentan aparte del total", () => {
  // Se mide el antes y el después en vez de fijar totales absolutos: otras
  // pruebas del archivo crean conversaciones, y una cifra escrita a mano aquí
  // se rompería en cuanto alguien añada un caso más arriba.
  const antes = calcularMetricas(orgId, RANGO);

  const deAnuncio = D.getOrCreateConversation(orgId, canalId, `1809999${siguiente++}`, {
    cuando: 1_700_000_000,
    origen: "anuncio",
    productoAnuncio: "Zapatos de cuero",
    descripcionAnuncio: "Zapatos de cuero · envío gratis",
  }).conversacion.id;

  const m = calcularMetricas(orgId, RANGO);

  assert.equal(m.leads_anuncio, antes.leads_anuncio + 1, "llegó uno por anuncio");
  assert.equal(m.leads, antes.leads + 1, "el total cuenta a todos, con anuncio o sin él");
  assert.equal(
    m.escribieron_por_su_cuenta,
    antes.escribieron_por_su_cuenta,
    "el que llega por anuncio no cuenta como que escribió por su cuenta",
  );
  assert.equal(
    m.leads_anuncio + m.escribieron_por_su_cuenta,
    m.leads,
    "no puede faltar ni sobrar nadie entre los dos grupos",
  );

  assert.equal(
    m.cuadra,
    true,
    "contar los de anuncio aparte no puede romper la invariante del total",
  );

  const p = m.productos_anuncio.find((x) => x.producto === "Zapatos de cuero");
  assert.equal(p?.leads, 1);
  assert.equal(p?.descripcion, "Zapatos de cuero · envío gratis", "la descripción del anuncio se conserva");

  // Se deja como estaba para no arrastrar estado a otras pruebas del archivo.
  D.actualizarConversacion(orgId, deAnuncio, { producto_anuncio: null, origen: null });
});

/**
 * Un anuncio sin título sigue siendo un anuncio.
 *
 * Meta no siempre manda `title`: hay creatividades que solo llevan texto. Si el
 * conteo se hace sobre el título, ese cliente aparece como que escribió por su
 * cuenta y la publicidad que lo trajo no se lleva el mérito — que es justo la
 * cifra por la que se paga.
 */
test("el que llega por un anuncio sin título cuenta igual como lead de anuncio", () => {
  const antes = calcularMetricas(orgId, RANGO);

  const sinTitulo = D.getOrCreateConversation(orgId, canalId, `1809888${siguiente++}`, {
    cuando: 1_700_000_000,
    origen: "anuncio",
    productoAnuncio: null,
    descripcionAnuncio: "Colchones ortopédicos · entrega en 24 horas",
  }).conversacion.id;

  const m = calcularMetricas(orgId, RANGO);

  assert.equal(m.leads_anuncio, antes.leads_anuncio + 1, "sin título, pero lo trajo el anuncio");
  assert.equal(
    m.escribieron_por_su_cuenta,
    antes.escribieron_por_su_cuenta,
    "no escribió por su cuenta: venía de un anuncio",
  );
  assert.equal(
    m.leads_anuncio + m.escribieron_por_su_cuenta,
    m.leads,
    "los dos grupos tienen que seguir sumando el total exacto",
  );
  assert.equal(m.cuadra, true);

  const fila = m.productos_anuncio.find(
    (p) => p.descripcion === "Colchones ortopédicos · entrega en 24 horas",
  );
  assert.equal(fila?.leads, 1, "el anuncio sin título tiene su propia fila");
  assert.equal(fila?.producto, "Anuncio sin título", "la fila se nombra, no se deja en blanco");

  D.actualizarConversacion(orgId, sinTitulo, { origen: null, descripcion_anuncio: null });
});

/**
 * El anuncio puede llegar después del «hola».
 *
 * El cliente escribe, y es el segundo mensaje —o el de días más tarde, al
 * pinchar el anuncio— el que trae el `externalAdReply`. Antes ese lead se
 * quedaba para siempre contado como que escribió por su cuenta.
 */
test("el anuncio que llega tarde se anota en la conversación que ya existía", () => {
  const telefono = `1809777${siguiente++}`;
  const primera = D.getOrCreateConversation(orgId, canalId, telefono, { cuando: 1_700_000_000 });
  assert.equal(primera.nueva, true);
  assert.equal(primera.conversacion.producto_anuncio, null);

  const antes = calcularMetricas(orgId, RANGO);

  const segunda = D.getOrCreateConversation(orgId, canalId, telefono, {
    cuando: 1_700_000_500,
    origen: "anuncio",
    productoAnuncio: "Nevera 12 pies",
    descripcionAnuncio: "Nevera 12 pies · 0 % de interés a 6 meses",
  });

  assert.equal(segunda.nueva, false, "el lead no se cuenta dos veces");
  assert.equal(segunda.conversacion.producto_anuncio, "Nevera 12 pies");
  assert.equal(segunda.conversacion.descripcion_anuncio, "Nevera 12 pies · 0 % de interés a 6 meses");

  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.leads, antes.leads, "no nace ningún lead nuevo: es el mismo cliente");
  assert.equal(m.leads_anuncio, antes.leads_anuncio + 1, "pero ahora se sabe que lo trajo el anuncio");
  assert.equal(m.escribieron_por_su_cuenta, antes.escribieron_por_su_cuenta - 1);

  // Un segundo anuncio no le roba el lead al primero: se cuenta una sola vez, y
  // esa vez la pagó quien lo trajo.
  const tercera = D.getOrCreateConversation(orgId, canalId, telefono, {
    cuando: 1_700_001_000,
    origen: "anuncio",
    productoAnuncio: "Estufa de 4 hornillas",
    descripcionAnuncio: "Estufa de 4 hornillas · envío gratis",
  });
  assert.equal(tercera.conversacion.producto_anuncio, "Nevera 12 pies", "manda el anuncio que lo trajo");

  D.actualizarConversacion(orgId, primera.conversacion.id, {
    origen: null, producto_anuncio: null, descripcion_anuncio: null,
  });
});


/**
 * La condición de «llegó por un anuncio» está escrita dos veces: en SQL para
 * contar y en JavaScript para pintar. Esta prueba las enfrenta.
 *
 * Si alguien toca una y se olvida de la otra, el panel enseña una pastilla de
 * anuncio en un hilo que el dashboard no está contando —o al revés—, y el
 * número que se mira para decidir cuánto se invierte en publicidad deja de
 * corresponder con los hilos que se pueden abrir y leer.
 */
test("la bandeja y el conteo deciden lo mismo sobre quién vino de un anuncio", () => {
  D.getOrCreateConversation(orgId, canalId, `1809555${siguiente++}`, {
    cuando: 1_700_000_000,
    origen: "anuncio",
    productoAnuncio: "Aire acondicionado",
    descripcionAnuncio: "Aire 12 000 BTU · instalación incluida",
  });
  D.getOrCreateConversation(orgId, canalId, `1809556${siguiente++}`, {
    cuando: 1_700_000_000,
    origen: "anuncio",
    productoAnuncio: null,
    descripcionAnuncio: "Sin título, pero de un anuncio",
  });
  nuevaConversacion();

  const m = calcularMetricas(orgId, RANGO);
  const enPantalla = D.listarConversaciones(orgId, { limite: 500 }).filter(llegoPorAnuncio);

  assert.equal(
    enPantalla.length,
    m.leads_anuncio,
    "lo que el panel marca como de anuncio es exactamente lo que el conteo suma",
  );
});

/**
 * El anuncio que se le pasa a la IA. Es texto, no una cifra, pero decide lo
 * mismo: lo que el agente sabe del cliente antes de escribirle.
 */
test("el anuncio se le cuenta a la IA con producto y promesa", () => {
  const completo = anuncioParaModelo({
    origen: "anuncio",
    producto_anuncio: "Estufa de 4 hornillas",
    descripcion_anuncio: "Estufa de 4 hornillas · envío gratis",
  });
  assert.ok(completo?.includes("Estufa de 4 hornillas"));
  assert.ok(completo?.includes("envío gratis"), "la promesa del anuncio va incluida");

  const sinTitulo = anuncioParaModelo({
    origen: "anuncio",
    producto_anuncio: null,
    descripcion_anuncio: "Colchones ortopédicos",
  });
  assert.ok(sinTitulo?.includes("Colchones ortopédicos"));
  assert.ok(sinTitulo?.includes("no traía título"), "se dice que falta, no se calla");

  assert.equal(
    anuncioParaModelo({ origen: null, producto_anuncio: null, descripcion_anuncio: null }),
    null,
    "sin anuncio no se le mete nada al prompt",
  );
});


/**
 * Lo facturado es el pedido, no lo cobrado.
 *
 * El envío se le cobra al cliente y se le paga al mensajero: sumarlo a la
 * facturación infla la cifra justo con el dinero que el negocio no se queda, y
 * es el número que el dueño compara con lo que le entra de verdad.
 */
test("lo facturado descuenta el envío del total del pedido", () => {
  const antes = calcularMetricas(orgId, RANGO);

  const conEnvio = nuevaConversacion();
  D.actualizarConversacion(orgId, conEnvio, {
    total: 2800, envio: 300, producto_vendido: "Nevera 12 pies",
  });
  D.sellarCierre(orgId, conEnvio, {
    cerradoPor: "ia", senal: "resumen_ia", fechaCierre: 1_700_000_100,
  });

  const m = calcularMetricas(orgId, RANGO);

  assert.equal(m.facturado, antes.facturado + 2500, "2800 cobrados menos 300 de envío");
  assert.equal(m.facturado_ia, antes.facturado_ia + 2500, "lo cerró la IA, así que es suyo");
  assert.equal(m.envios_cobrados, antes.envios_cobrados + 300, "el envío se enseña aparte, no se pierde");

  const fila = m.top_productos.find((x) => x.producto === "Nevera 12 pies");
  assert.equal(fila?.monto, 2500, "el ranking cuenta lo mismo: un producto no vende más por ir más lejos");
});

/**
 * Los montos los saca un modelo de un chat escrito a mano. De vez en cuando
 * apunta un envío mayor que el total —el cliente escribió el precio sin el
 * envío, o el modelo se equivocó—. Esa fila no puede restarle a las demás: una
 * venta mal leída bajaría la facturación del mes entero.
 */
test("un envío mayor que el total no le resta a la facturación", () => {
  const antes = calcularMetricas(orgId, RANGO);

  const raro = nuevaConversacion();
  D.actualizarConversacion(orgId, raro, { total: 500, envio: 900 });
  D.sellarCierre(orgId, raro, {
    cerradoPor: "humano", senal: "confirmacion_texto", fechaCierre: 1_700_000_200,
  });

  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.facturado, antes.facturado, "aporta cero, nunca en negativo");
  assert.ok(m.facturado >= 0);
});

/**
 * El filtro «solo leads de anuncio» tiene que alcanzar a TODO el panel.
 *
 * Es lo que se rompe solo si algún día se añade una consulta de métricas que no
 * pase por `filtroRango`: el conteo de leads se filtraría y los cierres no, la
 * tasa dividiría cierres de todo el mundo entre leads de anuncio —y pasaría del
 * 100 %—, y la invariante que el panel enseña en rojo dejaría de cuadrar sin
 * que nada estuviera roto de verdad.
 */
test("filtrando por anuncio, el panel entero cuenta solo a esos leads", () => {
  const conAnuncio = D.getOrCreateConversation(orgId, canalId, `1809666${siguiente++}`, {
    cuando: 1_700_000_000,
    origen: "anuncio",
    productoAnuncio: "Abanico de techo",
    descripcionAnuncio: "Abanico de techo · instalación incluida",
  }).conversacion.id;
  D.actualizarConversacion(orgId, conAnuncio, { total: 3000, envio: 500 });
  D.sellarCierre(orgId, conAnuncio, {
    cerradoPor: "ia", senal: "resumen_ia", fechaCierre: 1_700_000_600,
  });

  const todos = calcularMetricas(orgId, RANGO);
  const soloAnuncio = calcularMetricas(orgId, { ...RANGO, soloAnuncio: true });

  assert.equal(soloAnuncio.leads, todos.leads_anuncio, "el total pasa a ser el de anuncio");
  assert.equal(soloAnuncio.leads_anuncio, soloAnuncio.leads);
  assert.equal(soloAnuncio.escribieron_por_su_cuenta, 0, "quien escribió solo no entra");
  assert.equal(soloAnuncio.cuadra, true, "la invariante cuadra también dentro del filtro");
  assert.ok(soloAnuncio.leads < todos.leads, "y es un panel más pequeño que el de todos");

  assert.ok(
    soloAnuncio.tasa_cierre_total <= 100,
    `la tasa no puede pasar del 100 % (salió ${soloAnuncio.tasa_cierre_total})`,
  );
  assert.ok(
    soloAnuncio.cierres_ia <= todos.cierres_ia && soloAnuncio.facturado <= todos.facturado,
    "los cierres y lo facturado se filtran con los leads, no se quedan con el total",
  );

  const dia = soloAnuncio.serie_diaria.find((d) => d.leads > 0);
  assert.ok(dia, "el gráfico tiene que traer algún día con leads");
  assert.equal(dia.leads, dia.leads_anuncio, "en el gráfico filtrado las dos líneas son la misma");

  const canal = soloAnuncio.por_canal.find((c) => c.canal_id === canalId);
  assert.equal(canal?.leads, canal?.leads_anuncio, "y en la tabla por número, también");

  D.actualizarConversacion(orgId, conAnuncio, { origen: null, producto_anuncio: null });
});

/**
 * Una venta con resumen de pedido dentro es una venta cerrada, aunque el
 * resumen se mandara antes de que existiera el sellado automático.
 *
 * Es la avería que se veía en el panel: conversaciones con su pedido escrito en
 * el hilo, que seguían apareciendo como abiertas y no entraban en el conteo de
 * cierres de la IA. El barrido del arranque las sella con la hora del mensaje
 * que las cerró, no con la de hoy.
 */
test("el barrido cuenta las ventas con resumen que nadie había sellado", () => {
  const antes = calcularMetricas(orgId, RANGO);

  const vieja = nuevaConversacion();
  D.insertMessage(orgId, {
    conversationId: vieja, whapiMessageId: `viejo-${siguiente++}`, emisor: "cliente",
    tipo: "texto", content: "¿me lo pueden enviar hoy?", createdAt: 1_700_000_100,
  });
  D.insertMessage(orgId, {
    conversationId: vieja, whapiMessageId: `viejo-${siguiente++}`, emisor: "ia",
    tipo: "texto", content: "Resumen: 1 camisa manga larga, total 1850, envío 200",
    createdAt: 1_700_000_400,
  });

  const sinBarrer = calcularMetricas(orgId, RANGO);
  assert.equal(sinBarrer.cierres_ia, antes.cierres_ia, "todavía nadie la ha contado");
  assert.equal(D.getConversation(orgId, vieja)?.cerrado_por, "abierta");

  assert.equal(sellarCierresPendientes(orgId), 1, "el barrido encuentra exactamente esa");

  const conv = D.getConversation(orgId, vieja);
  assert.equal(conv?.cerrado_por, "ia", "el resumen lo mandó la IA sola: la venta es suya");
  assert.equal(conv?.senal_de_cierre, "resumen_ia");
  assert.equal(conv?.fecha_cierre, 1_700_000_400, "se cierra cuando se cerró, no cuando se barrió");

  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.cierres_ia, antes.cierres_ia + 1, "ahora sí cuenta como cierre de la IA");
  assert.equal(m.sin_cerrar, sinBarrer.sin_cerrar - 1, "y deja de contar como abierta");
  assert.equal(m.cuadra, true);

  assert.equal(sellarCierresPendientes(orgId), 0, "pasarlo dos veces no sella nada nuevo");
});

/**
 * El barrido aplica la MISMA regla que el sellado en vivo, no una copia
 * relajada: el resumen es de quien lo escribió. Un vendedor que contestó antes
 * no le quita a la IA la venta que cerró su resumen; que metiera mano se ve en
 * la pastilla de intervención, aparte.
 */
test("un vendedor que escribió antes no le quita al barrido el cierre de la IA", () => {
  const hilo = nuevaConversacion();
  D.insertMessage(orgId, {
    conversationId: hilo, whapiMessageId: `mixto-${siguiente++}`, emisor: "humano",
    tipo: "texto", content: "ya mismo te confirmo disponibilidad", createdAt: 1_700_000_200,
  });
  D.insertMessage(orgId, {
    conversationId: hilo, whapiMessageId: `mixto-${siguiente++}`, emisor: "ia",
    tipo: "texto", content: "Resumen: 2 pantalones, total 4800", createdAt: 1_700_000_500,
  });
  D.recalcularIntervencionHumana(orgId, hilo);

  assert.equal(sellarCierresPendientes(orgId), 1);

  const conv = D.getConversation(orgId, hilo);
  assert.equal(conv?.cerrado_por, "ia");
  assert.equal(conv?.senal_de_cierre, "resumen_ia");
  assert.equal(conv?.intervencion_humana, 1, "intervino, y se sigue viendo");
});

/**
 * UN NÚMERO DONDE CONTESTA UNA IA AJENA.
 *
 * El dueño tiene su propio bot en ese WhatsApp. Sus respuestas no salen de aquí
 * —así que no llevan nuestro identificador— y hasta ahora se guardaban como de
 * un humano: el panel enseñaba «intervino un humano» en conversaciones donde no
 * habló ninguno, y le acreditaba al equipo las ventas que cerró esa IA.
 *
 * Marcar el número corrige el origen: los mensajes pasan a ser de la IA, y de
 * ahí se derivan solas la pastilla y la atribución de la venta.
 */
test("marcar el número como atendido por una IA corrige lo que ya estaba mal", () => {
  const hilo = nuevaConversacion();
  D.insertMessage(orgId, {
    conversationId: hilo, whapiMessageId: `bot-${siguiente++}`, emisor: "cliente",
    tipo: "texto", content: "vi el anuncio, ¿precio?", createdAt: 1_700_000_100,
  });
  // Lo escribió el bot del dueño, pero entró sin identificador: «humano».
  D.insertMessage(orgId, {
    conversationId: hilo, whapiMessageId: `bot-${siguiente++}`, emisor: "humano",
    tipo: "texto", content: "Resumen de su pedido:\nProducto: cartera\nTOTAL A PAGAR: USD 30",
    createdAt: 1_700_000_300,
  });
  D.recalcularIntervencionHumana(orgId, hilo);

  assert.equal(sellarCierresPendientes(orgId), 1, "el resumen cierra la venta igual");
  const mal = D.getConversation(orgId, hilo);
  assert.equal(mal?.cerrado_por, "humano", "pero se la lleva el equipo, que es lo que el dueño ve mal");
  assert.equal(mal?.intervencion_humana, 1, "y con la pastilla de intervino");

  const r = D.reatribuirCanalAIa(orgId, canalId);
  assert.ok(r.mensajes >= 1, "reatribuye los mensajes del número");
  assert.ok(r.cierres >= 1, "y los cierres que venían de una señal de texto");

  const bien = D.getConversation(orgId, hilo);
  assert.equal(bien?.cerrado_por, "ia", "la venta es de la IA que la cerró");
  assert.equal(bien?.senal_de_cierre, "resumen_ia");
  assert.equal(bien?.intervencion_humana, 0, "y no intervino nadie");
  assert.equal(
    D.listarMensajes(orgId, hilo).some((m) => m.emisor === "humano"),
    false,
    "en este número no hay mensajes de humano: los escribe una IA",
  );
});

/**
 * EL INFORME QUE UNO SE LLEVA.
 *
 * Desconectar un número borra sus conversaciones y sus métricas para siempre.
 * El informe es la única salida por la que el dueño no lo pierde todo, así que
 * tiene que traer lo mismo que el panel: las cifras del número, sus hilos y lo
 * que se habló dentro.
 */
test("el informe de un número trae sus cifras, sus hilos y lo que se dijo", () => {
  const canal = D.obtenerCanal(orgId, canalId);
  assert.ok(canal, "el canal de las pruebas tiene que existir");

  const conv = nuevaConversacion();
  D.insertMessage(orgId, {
    conversationId: conv, whapiMessageId: `inf-${siguiente++}`, emisor: "cliente",
    tipo: "texto", content: "¿tienen la cartera roja?", createdAt: 1_700_000_100,
  });
  D.actualizarConversacion(orgId, conv, { cliente_nombre: "Ana <b>Pérez</b>" });

  const m = calcularMetricas(orgId, { ...RANGO, canalId });
  const { nombre, html } = informeDeCanal(orgId, canal, { ahora: new Date("2026-08-21T12:00:00Z") });

  assert.equal(nombre, "informe-ventas-2026-08-21.html", "el archivo se llama por su número y su día");

  assert.ok(html.includes(`<td class="fuerte">${m.leads}</td>`), "las conversaciones del número");
  assert.ok(html.includes("Facturado sin envío"), "el dinero, sin el envío");
  assert.ok(html.includes("Cobertura automatizada"), "los porcentajes con su meta");
  assert.ok(html.includes("¿tienen la cartera roja?"), "y lo que el cliente escribió");

  /*
   * Lo de dentro lo escribió gente por WhatsApp: si el nombre de un cliente
   * lleva etiquetas, tienen que verse como texto y no ejecutarse cuando el
   * dueño abra su propio informe.
   */
  assert.ok(html.includes("Ana &lt;b&gt;Pérez&lt;/b&gt;"), "el HTML de dentro va escapado");
  assert.equal(html.includes("<b>Pérez</b>"), false);

  // Un archivo de una pieza: sin nada que cargar de fuera, que es lo que le
  // permite abrirse dentro de dos años y sin internet.
  assert.equal(/<script|src="http|href="http/i.test(html), false, "nada que traer de la red");
});

/**
 * Un número con años de historia no cabe entero en una página que se pueda
 * abrir. Se recorta, sí — pero el documento tiene que DECIRLO: un informe que
 * se calla lo que le falta es peor que no tenerlo, porque se confía en él.
 */
test("si el informe recorta hilos, lo dice en su cabecera", () => {
  const canal = D.obtenerCanal(orgId, canalId);
  assert.ok(canal);

  const { html } = informeDeCanal(orgId, canal, { hilos: 2 });

  assert.ok(html.includes("Se transcriben los 2 hilos más recientes"), "lo avisa arriba del todo");
  assert.equal((html.match(/class="hilo"/g) ?? []).length, 2, "y transcribe exactamente esos");

  // La tabla de conversaciones sigue entera: se recortan los mensajes, nunca
  // las ventas.
  const filas = (html.match(/<a href="#hilo-/g) ?? []).length;
  assert.ok(filas > 2, `la tabla lista las ${filas} conversaciones, no solo las transcritas`);
});

/**
 * EL RESUMEN LE QUITA LA VENTA A LA FACTURA, TAMBIÉN EN CALIENTE.
 *
 * El caso real: el analista ya selló la venta con la foto de la factura que
 * mandó el vendedor, y minutos después la IA manda su resumen de pedido. La
 * regla maestra —el primero que cierra se lleva la venta— dejaría esa venta en
 * el lado del equipo para siempre. La excepción la mueve, porque el resumen es
 * el cierre y la factura es papeleo.
 */
test("una venta cerrada por la factura pasa a la IA cuando llega el resumen", () => {
  const hilo = nuevaConversacion();
  D.insertMessage(orgId, {
    conversationId: hilo, whapiMessageId: `fact-${siguiente++}`, emisor: "humano",
    tipo: "imagen", content: "[imagen]", createdAt: 1_700_000_200,
  });
  D.sellarCierre(orgId, hilo, {
    cerradoPor: "humano", senal: "imagen_factura", fechaCierre: 1_700_000_200,
  });

  const antes = calcularMetricas(orgId, RANGO);

  const cambio = registrarCierre(orgId, hilo, {
    emisor: "ia",
    content: "Resumen de su pedido: 1 abanico, TOTAL A PAGAR: USD 45",
    cuando: 1_700_000_800,
  });

  assert.equal(cambio, true, "el resumen se queda con la venta");
  const conv = D.getConversation(orgId, hilo);
  assert.equal(conv?.cerrado_por, "ia");
  assert.equal(conv?.senal_de_cierre, "resumen_ia");
  assert.equal(
    conv?.fecha_cierre,
    1_700_000_200,
    "la venta se cerró cuando se cerró: esto decide de quién es, no cuándo pasó",
  );

  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.cierres_ia, antes.cierres_ia + 1);
  assert.equal(m.cierres_humano, antes.cierres_humano - 1);
  assert.equal(m.leads, antes.leads, "no aparece ninguna venta nueva: es la misma");
  assert.equal(m.cuadra, true);
});

/**
 * Y en un solo sentido: una factura NUNCA le quita la venta a un resumen, ni
 * un resumen posterior se la quita a otro anterior. Si esta se rompe, la
 * excepción se comió la regla maestra.
 */
test("la factura no reasigna una venta que ya cerró un resumen", () => {
  const hilo = nuevaConversacion();
  D.sellarCierre(orgId, hilo, {
    cerradoPor: "ia", senal: "resumen_ia", fechaCierre: 1_700_000_300,
  });

  // Un vendedor manda su factura y se sella otra vez: no se mueve nada.
  assert.equal(
    D.reatribuirCierrePorResumen(orgId, hilo, { cerradoPor: "humano", senal: "imagen_factura" }),
    false,
    "un cierre por resumen no se toca",
  );
  assert.equal(D.getConversation(orgId, hilo)?.cerrado_por, "ia");

  // Ni un segundo resumen, más tarde, se la quita al primero.
  assert.equal(
    registrarCierre(orgId, hilo, {
      emisor: "humano", content: "Resumen del pedido: otra cosa", cuando: 1_700_009_000,
    }),
    false,
    "entre dos resúmenes manda el primero",
  );
  assert.equal(D.getConversation(orgId, hilo)?.cerrado_por, "ia");

  // Y una corrección manual tampoco la puede pisar un resumen que llegue luego.
  const manual = nuevaConversacion();
  D.marcarRevision(orgId, manual, "sin señal clara");
  D.resolverRevision(orgId, manual, "humano");
  assert.equal(
    registrarCierre(orgId, manual, {
      emisor: "ia", content: "Resumen de su pedido: tarde", cuando: 1_700_009_500,
    }),
    false,
    "lo que firmó una persona no lo mueve una regla",
  );
  assert.equal(D.getConversation(orgId, manual)?.cerrado_por, "humano");
});

/**
 * UN NÚMERO NACE VIGILANDO.
 *
 * Quien conecta su WhatsApp aquí ya tiene a alguien contestando —su propio
 * bot— y lo que necesita es que le cuenten las ventas, no que le hablen a sus
 * clientes. El panel contesta solo donde se le encienda el agente a propósito.
 */
test("un número recién conectado vigila, no contesta", () => {
  const nuevo = D.crearCanal(orgId, {
    nombre: "Recién conectado",
    phone: `1809555${siguiente++}`,
    tokenCifrado: "x",
    webhookSecret: "s",
    whapiChannelId: null,
    estado: "conectado",
  });

  const canal = D.obtenerCanal(orgId, nuevo);
  assert.equal(canal?.contesta_ia, 1, "contesta la IA del dueño y el panel mira");
  assert.equal(canal?.agente_activo, 0, "nuestro agente no habla hasta que se le encienda");
});

/**
 * La fila de cada número tiene que cuadrar sola.
 *
 * El panel enseña un conteo por WhatsApp, y esa fila se lee como un panel
 * pequeño: si sus cuatro estados no suman sus propias conversaciones, el
 * número está enseñando una cifra que no es.
 */
test("el conteo de cada número cuadra por sí solo", () => {
  const m = calcularMetricas(orgId, RANGO);

  let leads = 0;
  for (const c of m.por_canal) {
    assert.equal(
      c.cierres_ia + c.cierres_humano + c.sin_cerrar + c.revision,
      c.leads,
      `el número «${c.nombre}» no cuadra: ${c.leads} conversaciones y otra cosa clasificada`,
    );
    assert.ok(c.leads_anuncio <= c.leads, "los de anuncio son un subconjunto, nunca más que el total");
    leads += c.leads;
  }

  assert.equal(leads, m.leads, "y entre todos los números suman el total de la cuenta");
});

/**
 * EL RESUMEN DE UN PERIODO.
 *
 * «Descárgame lo de esta semana» no se responde con el histórico entero. El
 * rango tiene que llegar hasta el archivo: si el documento dice «del 18 al 25»
 * pero cuenta desde el principio de los tiempos, es peor que no tenerlo,
 * porque se manda a alguien creyendo que dice otra cosa.
 */
test("el resumen de la cuenta cuenta solo el periodo que se le pide", () => {
  const viejo = 1_600_000_000; // muy anterior a las conversaciones de arriba
  const reciente = D.getOrCreateConversation(orgId, canalId, `1809444${siguiente++}`, {
    cuando: 1_800_000_000,
  }).conversacion.id;
  assert.ok(reciente);

  const todo = informeDeCuenta(orgId, { ahora: new Date("2026-08-25T12:00:00Z") });
  const soloReciente = informeDeCuenta(orgId, {
    rango: { desde: 1_799_000_000, hasta: 1_801_000_000 },
    ahora: new Date("2026-08-25T12:00:00Z"),
  });

  const filas = (html: string) => (html.match(/<tbody>|<\/tr>/g) ?? []).length;
  assert.ok(filas(soloReciente.html) < filas(todo.html), "el periodo corto trae menos");

  assert.ok(todo.html.includes("todo el histórico"), "sin rango, el documento lo dice");
  assert.ok(soloReciente.html.includes("del "), "con rango, enseña las fechas del periodo");

  // El nombre del archivo lleva el periodo: dos resúmenes distintos no pueden
  // llamarse igual en la carpeta de descargas.
  assert.match(soloReciente.nombre, /^resumen-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.html$/);
  assert.notEqual(soloReciente.nombre, todo.nombre);

  // El resumen de la cuenta trae la tabla por número y NO transcribe hilos:
  // la pregunta es cómo fue el periodo, no qué se dijo en cada chat.
  assert.ok(soloReciente.html.includes("<th>Número</th>"));
  assert.equal(/class="hilo"/.test(soloReciente.html), false);

  assert.ok(viejo < 1_700_000_000);
});
