import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import {
  armarSistema,
  atenderConversacion,
  dentroDeHorario,
  pideHumano,
  revisarAgente,
} from "../src/lib/agent";
import { contieneMarcador, duenoDelCierre, registrarCierre } from "../src/lib/cierre";
import type { Resultado } from "../src/lib/agent";

/** Estrecha la unión: si el agente respondió, la prueba debe fallar aquí. */
function motivoDe(r: Resultado): string {
  assert.equal(r.atendida, false, "el agente no debía haber respondido");
  return r.atendida === false ? r.motivo : "";
}

/**
 * Salvaguardas del agente vendedor.
 *
 * Todas las condiciones de silencio se evalúan ANTES de llamar al modelo, así
 * que estas pruebas no tocan la red. Si alguna dejara pasar el control hasta
 * la generación, fallaría por falta de OPENROUTER_API_KEY: eso también sería
 * una señal correcta de que la salvaguarda no funcionó.
 */

const { orgId } = D.crearOrgConDueno({
  negocio: "Agente",
  color: "#12876a",
  nombre: "Dueño",
  email: "agente@prueba.com",
  passwordHash: "hash",
});

const canalId = D.crearCanal(orgId, {
  nombre: "Ventas",
  phone: "18092220000",
  tokenCifrado: "x",
  webhookSecret: "s",
  whapiChannelId: null,
  estado: "conectado",
});

let telefono = 18_090_000_000;
function hilo(mensajes: { emisor: D.Emisor; content: string; hace: number }[]) {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, String(++telefono), {
    cuando: D.ahora() - 86_400,
  });

  for (const [i, m] of mensajes.entries()) {
    D.insertMessage(orgId, {
      conversationId: conversacion.id,
      whapiMessageId: `${conversacion.id}-${i}`,
      emisor: m.emisor,
      tipo: "texto",
      content: m.content,
      createdAt: D.ahora() - m.hace,
    });
  }
  return conversacion.id;
}

/*
 * Encender el agente en un número le quita el sitio a la IA del dueño, igual
 * que hace la API: por número contesta uno solo. Un canal nace en modo vigilar
 * —`contesta_ia = 1`—, así que sin esto todas las pruebas de silencio darían
 * «contesta_otra_ia» y no probarían la salvaguarda que dicen probar.
 */
const encender = (v: boolean) =>
  D.actualizarCanal(orgId, canalId, { agente_activo: v ? 1 : 0, contesta_ia: v ? 0 : 1 });

// ── Funciones puras ─────────────────────────────────────────────────────────

test("detecta que el cliente pide una persona", () => {
  assert.equal(pideHumano("quiero hablar con una persona por favor"), true);
  assert.equal(pideHumano("me pasas con UN ASESOR?"), true);
  assert.equal(pideHumano("eres un bot?"), true);
  assert.equal(pideHumano("quiero dos camisas talla M"), false);
});

test("el horario nocturno cruza la medianoche", () => {
  const a = (h: number, m = 0) => new Date(2026, 0, 15, h, m);

  // Horario normal 09:00–18:00
  assert.equal(dentroDeHorario("09:00", "18:00", a(12)), true);
  assert.equal(dentroDeHorario("09:00", "18:00", a(20)), false);
  assert.equal(dentroDeHorario("09:00", "18:00", a(3)), false);

  // Nocturno 20:00–02:00: la medianoche no puede dejar al agente mudo.
  assert.equal(dentroDeHorario("20:00", "02:00", a(23)), true);
  assert.equal(dentroDeHorario("20:00", "02:00", a(1)), true);
  assert.equal(dentroDeHorario("20:00", "02:00", a(12)), false);

  // Sin horario configurado, siempre dentro.
  assert.equal(dentroDeHorario(null, null, a(4)), true);
});

// ── Condiciones de silencio ─────────────────────────────────────────────────

test("con el agente apagado no hace nada", async () => {
  encender(false);
  const id = hilo([{ emisor: "cliente", content: "hola", hace: 10 }]);

  const r = await atenderConversacion(orgId, canalId, id);
  assert.deepEqual(r, { atendida: false, motivo: "agente_apagado" });
});

test("nunca responde a un mensaje que no escribió el cliente", async () => {
  encender(true);

  const deIa = hilo([
    { emisor: "cliente", content: "hola", hace: 200 },
    { emisor: "ia", content: "¡Hola! ¿En qué te ayudo?", hace: 100 },
  ]);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, deIa)), "ultimo_no_es_cliente");

  const deHumano = hilo([
    { emisor: "cliente", content: "hola", hace: 200 },
    { emisor: "humano", content: "ya te atiendo", hace: 100 },
  ]);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, deHumano)), "ultimo_no_es_cliente");
});

test("si un vendedor escribió hace poco, el agente se calla", async () => {
  encender(true);
  const id = hilo([
    { emisor: "cliente", content: "precio?", hace: 3600 },
    { emisor: "humano", content: "son 1850", hace: 1800 }, // hace media hora
    { emisor: "cliente", content: "ok, lo quiero", hace: 60 },
  ]);

  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "vendedor_reciente");
});

test("pasadas las dos horas, el vendedor ya no lo silencia", async () => {
  encender(true);
  const id = hilo([
    { emisor: "humano", content: "son 1850", hace: 3 * 60 * 60 }, // hace tres horas
    { emisor: "cliente", content: "sigo interesado", hace: 60 },
  ]);

  // Ya no hay silencio: el control llega hasta el modelo, que sin clave falla.
  const r = await atenderConversacion(orgId, canalId, id);
  assert.notEqual(motivoDe(r), "vendedor_reciente");
});

test("si el cliente pide una persona, se calla y deja constancia", async () => {
  encender(true);
  const id = hilo([{ emisor: "cliente", content: "quiero hablar con una persona", hace: 30 }]);

  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "pidio_humano");

  const anomalias = D.listarAnomalias(orgId).filter((a) => a.conversation_id === id);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0]!.tipo, "pidio_humano");
  assert.equal(anomalias[0]!.severidad, "alta");
});

test("una vez que pidió una persona, sigue callado aunque escriba otra cosa", async () => {
  encender(true);
  const id = hilo([{ emisor: "cliente", content: "me pasas con un asesor", hace: 300 }]);
  await atenderConversacion(orgId, canalId, id);

  D.insertMessage(orgId, {
    conversationId: id,
    whapiMessageId: `${id}-luego`,
    emisor: "cliente",
    tipo: "texto",
    content: "bueno, ¿cuánto cuesta la camisa?",
    createdAt: D.ahora() - 10,
  });

  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "pidio_humano");
  // Y no se duplica la anomalía.
  assert.equal(D.listarAnomalias(orgId).filter((a) => a.conversation_id === id).length, 1);
});

test("fuera del horario configurado no responde", async () => {
  encender(true);
  const ahoraH = new Date().getHours();
  // Una franja de una hora que con seguridad no incluye este momento.
  const lejos = (ahoraH + 5) % 24;
  const dos = (lejos + 1) % 24;
  const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;

  D.actualizarAgente(orgId, { horario_activo: 1, horario_desde: hh(lejos), horario_hasta: hh(dos) });

  const id = hilo([{ emisor: "cliente", content: "hola", hace: 10 }]);
  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "fuera_de_horario");

  D.actualizarAgente(orgId, { horario_activo: 0 });
});

test("se detiene tras ocho respuestas en una hora, para no inundar al cliente", async () => {
  encender(true);
  const mensajes: { emisor: D.Emisor; content: string; hace: number }[] = [];

  for (let i = 0; i < 8; i++) {
    mensajes.push({ emisor: "cliente", content: `pregunta ${i}`, hace: 2000 - i * 100 });
    mensajes.push({ emisor: "ia", content: `respuesta ${i}`, hace: 1990 - i * 100 });
  }
  mensajes.push({ emisor: "cliente", content: "una más", hace: 5 });

  const id = hilo(mensajes);
  const r = await atenderConversacion(orgId, canalId, id);

  assert.equal(motivoDe(r), "limite_por_hora");
  const anomalia = D.listarAnomalias(orgId).find(
    (a) => a.conversation_id === id && a.tipo === "agente_en_bucle",
  );
  assert.ok(anomalia, "debe quedar registrado que el agente se detuvo");
});


// ── El anuncio en el prompt ─────────────────────────────────────────────────

/**
 * El anuncio que trajo al cliente TIENE que llegar al modelo.
 *
 * Sin él, el agente abre preguntando «¿qué producto te interesa?» a alguien que
 * acaba de pinchar la foto de ese producto. Es la primera frase de la
 * conversación y la que decide si el cliente sigue escribiendo.
 */
test("el prompt del agente lleva el producto del anuncio y lo que prometía", () => {
  const agente = D.obtenerAgente(orgId);
  const catalogo = D.listarCatalogo(orgId, true);

  const conAnuncio = armarSistema("Tienda", agente, catalogo, {
    origen: "anuncio",
    producto_anuncio: "Nevera 12 pies",
    descripcion_anuncio: "Nevera 12 pies · 0 % de interés a 6 meses",
  });

  assert.ok(conAnuncio.includes("Nevera 12 pies"), "el modelo tiene que saber qué producto lo trajo");
  assert.ok(
    conAnuncio.includes("0 % de interés a 6 meses"),
    "y qué se le prometió: es lo que explica lo que el cliente va a preguntar",
  );
  assert.ok(
    conAnuncio.includes("no le preguntes de qué producto habla"),
    "con anuncio delante, preguntar por el producto sobra",
  );
  assert.ok(
    conAnuncio.includes("dile que lo confirmas con el equipo"),
    "el anuncio no amplía el catálogo: lo que promete de más se confirma, no se afirma",
  );
});

/**
 * Un anuncio sin título sigue siendo el anuncio que lo trajo. Meta no siempre
 * manda `title`, y ese cliente no puede quedarse sin contexto.
 */
test("sin título, el anuncio entra igual por su descripción", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId), [], {
    origen: "anuncio",
    producto_anuncio: null,
    descripcion_anuncio: "Colchones ortopédicos · entrega en 24 horas",
  });

  assert.ok(prompt.includes("Colchones ortopédicos"));
  assert.ok(prompt.includes("Este cliente llegó por un anuncio"));
});

test("quien escribió por su cuenta no arrastra ningún anuncio al prompt", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId), [], {
    origen: null,
    producto_anuncio: null,
    descripcion_anuncio: null,
  });

  assert.equal(prompt.includes("llegó por un anuncio"), false);
  assert.equal(
    prompt.includes("no le preguntes de qué producto habla"),
    false,
    "sin anuncio, el agente SÍ tiene que preguntar por el producto",
  );
});


// -- El cierre se registra cuando ocurre -------------------------------------

/**
 * LA AVERIA QUE ESTAS PRUEBAS CUIDAN.
 *
 * El marcador solo se miraba dentro del analista, y el analista solo corre
 * cuando alguien pulsa «Analizar». Una venta que la IA cerraba a las diez de la
 * mañana no existía para el dashboard hasta que a alguien se le ocurría pedir
 * el barrido: ni cierre, ni facturación, ni nada.
 *
 * Ninguna de estas pruebas toca la red. Reconocer el marcador es mecánico, y
 * ese es justo el argumento para hacerlo al entrar el mensaje.
 */

let siguienteCierre = 18_095_000_000;
function conversacionCon(mensajes: { emisor: D.Emisor; content: string; t: number }[]) {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, String(++siguienteCierre), {
    cuando: 1_000,
  });

  for (const [i, x] of mensajes.entries()) {
    D.insertMessage(orgId, {
      conversationId: conversacion.id,
      whapiMessageId: `cierre-${conversacion.id}-${i}`,
      emisor: x.emisor,
      tipo: "texto",
      content: x.content,
      createdAt: x.t,
    });
  }
  return conversacion.id;
}

test("el marcador se reconoce donde sea y como sea que se escriba", () => {
  assert.equal(contieneMarcador("Resumen: 2 camisas, 2500", "Resumen:"), true);
  assert.equal(contieneMarcador("Listo. resumen: 2 camisas", "Resumen:"), true, "sin distinguir mayúsculas");
  assert.equal(
    contieneMarcador("te hago un resumen de lo que hablamos", "Resumen:"),
    false,
    "sin los dos puntos no es el marcador",
  );
});

test("el resumen de la IA cierra la venta al instante, sin pasar por el analista", () => {
  const texto = "Resumen: 2 camisas talla M — 2500 en total, 300 de envío";
  const id = conversacionCon([
    { emisor: "cliente", content: "quiero dos camisas", t: 2_000 },
    { emisor: "ia", content: texto, t: 2_100 },
  ]);

  const cerro = registrarCierre(orgId, id, { emisor: "ia", content: texto, cuando: 2_100 });
  assert.equal(cerro, true);

  const conv = D.getConversation(orgId, id)!;
  assert.equal(conv.cerrado_por, "ia", "la cerró la IA sola: es de la IA");
  assert.equal(conv.senal_de_cierre, "resumen_ia");
  assert.equal(conv.fecha_cierre, 2_100, "la venta se fecha cuando se cerró, no cuando se analiza");
  assert.equal(conv.analizada_at, null, "el pedido sigue sin extraer: eso sí pide el modelo");
});

/**
 * La conversación se cerró sola, pero el pedido de dentro sigue sin sacar. Si
 * el analista no la volviera a mirar, esa venta contaría como cierre y
 * facturaría cero para siempre.
 */
test("una venta cerrada sin analizar sigue en la cola del analista", () => {
  const texto = "Resumen: 1 camisa, 1850";
  const id = conversacionCon([{ emisor: "ia", content: texto, t: 3_000 }]);
  registrarCierre(orgId, id, { emisor: "ia", content: texto, cuando: 3_000 });

  const pendientes = D.conversacionesPorAnalizar(orgId, 0).map((c) => c.id);
  assert.ok(pendientes.includes(id), "cerrada pero sin analizar: hay que sacarle el pedido");

  D.actualizarConversacion(orgId, id, { analizada_at: D.ahora() });
  const despues = D.conversacionesPorAnalizar(orgId, 0).map((c) => c.id);
  assert.equal(despues.includes(id), false, "ya analizada y cerrada: no se vuelve a pagar por ella");
});

/**
 * Aunque un vendedor haya escrito antes, el resumen que manda la IA cierra
 * para la IA. Antes bastaba un «ya te confirmo» para que la venta que la IA
 * cerró media hora después contara para el equipo.
 *
 * Que una persona metiera mano no se pierde: se ve en `intervencion_humana`,
 * que es un dato aparte y sigue en 1. Quién cerró y si alguien ayudó son dos
 * preguntas distintas.
 */
test("aunque un vendedor escribiera antes, el resumen de la IA cierra para la IA", () => {
  const id = conversacionCon([
    { emisor: "cliente", content: "hola", t: 4_000 },
    { emisor: "humano", content: "te lo dejo en 2500", t: 4_050 },
  ]);

  registrarCierre(orgId, id, { emisor: "ia", content: "Resumen: 1 camisa, 2500", cuando: 4_100 });

  const conv = D.getConversation(orgId, id)!;
  assert.equal(conv.cerrado_por, "ia", "el resumen es de la IA: la venta también");
  assert.equal(conv.senal_de_cierre, "resumen_ia");
  assert.equal(conv.intervencion_humana, 1, "que una persona escribiera se sigue viendo");
});

test("el vendedor cierra escribiendo el marcador desde su móvil", () => {
  const id = conversacionCon([{ emisor: "cliente", content: "me lo llevo", t: 5_000 }]);

  registrarCierre(orgId, id, { emisor: "humano", content: "Resumen: 1 nevera, 32000", cuando: 5_100 });

  const conv = D.getConversation(orgId, id)!;
  assert.equal(conv.cerrado_por, "humano");
  assert.equal(conv.senal_de_cierre, "confirmacion_texto");
});

test("el segundo resumen no le quita la venta al primero", () => {
  const id = conversacionCon([{ emisor: "cliente", content: "dale", t: 6_000 }]);

  assert.equal(
    registrarCierre(orgId, id, { emisor: "ia", content: "Resumen: 1 camisa", cuando: 6_100 }),
    true,
  );
  assert.equal(
    registrarCierre(orgId, id, { emisor: "humano", content: "Resumen: 1 camisa y un pantalón", cuando: 6_200 }),
    false,
    "el primero que cierra se lleva la venta: esa regla no la rompe nadie",
  );

  const conv = D.getConversation(orgId, id)!;
  assert.equal(conv.cerrado_por, "ia");
  assert.equal(conv.fecha_cierre, 6_100);
});

test("un mensaje del cliente nunca cierra una venta", () => {
  const id = conversacionCon([{ emisor: "cliente", content: "Resumen: me llevo dos", t: 7_000 }]);

  assert.equal(
    registrarCierre(orgId, id, { emisor: "cliente", content: "Resumen: me llevo dos", cuando: 7_000 }),
    false,
    "el cliente puede escribir lo que quiera: la venta la cierra el negocio",
  );
  assert.equal(D.getConversation(orgId, id)!.cerrado_por, "abierta");
});

/**
 * El resumen es de quien lo escribe. Si lo mandó la IA, la venta es de la IA:
 * ni un vendedor que escribió antes ni una factura que llega después se la
 * quitan. Que una persona metiera mano se ve en la pastilla de intervención,
 * que es otro dato.
 */
test("la atribución del cierre es la misma regla en todas partes", () => {
  assert.deepEqual(duenoDelCierre("ia"), { quien: "ia", senal: "resumen_ia" });
  assert.deepEqual(duenoDelCierre("humano"), { quien: "humano", senal: "confirmacion_texto" });
  assert.equal(duenoDelCierre("cliente"), null);
});

/**
 * Y la otra mitad de la avería: al agente nunca se le dijo que tenía que
 * escribir el marcador. Cerraba la venta con un resumen cualquiera, y ese
 * resumen no lo reconocía nadie.
 */
test("el prompt del agente explica cómo cerrar una venta, con el marcador de la cuenta", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId), [], null, "Pedido cerrado:");

  assert.ok(prompt.includes("Pedido cerrado:"), "se le exige el marcador de la cuenta, no uno fijo");
  assert.ok(prompt.includes("CÓMO SE CIERRA UNA VENTA"));
  assert.ok(
    prompt.includes("producto, cantidad, total y envío"),
    "el resumen tiene que traer los datos que luego se extraen",
  );
});

test("ninguna de estas rutas envió un mensaje", () => {
  // Si algo se hubiera enviado, existiría un mensaje de la IA registrado
  // después de que empezaron las pruebas. Solo están los que insertamos.
  const todos = D.listarConversaciones(orgId).flatMap((c) => D.listarMensajes(orgId, c.id));
  const inventados = todos.filter((m) => m.whapi_message_id?.startsWith("wamid"));
  assert.deepEqual(inventados, []);
});

/**
 * DOS IAS EN EL MISMO WHATSAPP NO PUEDEN CONTESTAR.
 *
 * Cuando el dueño marca un número como atendido por su propia IA, el papel del
 * panel es vigilar: leer los hilos y apuntar la venta cuando vea el resumen del
 * pedido. Si nuestro agente hablara ahí —porque quedó encendido de una prueba
 * vieja—, el cliente recibiría dos respuestas de dos vendedores que no se
 * conocen entre sí, y eso no se arregla después: ya lo leyó.
 *
 * La guarda va en el agente y no en la pantalla del interruptor a propósito: lo
 * que no puede pasar es que hable, no que quede mal configurado.
 */
test("en un número donde contesta otra IA, el agente se calla aunque esté encendido", async () => {
  encender(true);
  D.actualizarCanal(orgId, canalId, { contesta_ia: 1 });

  const id = hilo([{ emisor: "cliente", content: "¿me lo pueden mandar hoy?", hace: 30 }]);

  assert.equal(
    motivoDe(await atenderConversacion(orgId, canalId, id)),
    "contesta_otra_ia",
    "el agente no abre la boca en un número que ya atiende otra IA",
  );

  // Y vigilar sí vigila: el resumen de esa IA ajena cierra la venta igual.
  D.insertMessage(orgId, {
    conversationId: id, whapiMessageId: `vigila-${id}`, emisor: "ia",
    tipo: "texto", content: "Resumen de su pedido: 1 cartera, TOTAL A PAGAR: USD 30",
    createdAt: D.ahora(),
  });
  assert.equal(
    registrarCierre(orgId, id, {
      emisor: "ia",
      content: "Resumen de su pedido: 1 cartera, TOTAL A PAGAR: USD 30",
      cuando: D.ahora(),
    }),
    true,
    "el panel mira y apunta, aunque el mensaje no salga de él",
  );
  assert.equal(D.getConversation(orgId, id)!.cerrado_por, "ia");

  D.actualizarCanal(orgId, canalId, { contesta_ia: 0 });
  encender(false);
});

/**
 * El panel no responde en un número donde contesta la IA del dueño, y no
 * depende de que el interruptor del agente esté bien puesto: la guarda lo
 * impide aunque quedara encendido. Esta prueba fija las DOS mitades, porque la
 * promesa que se le hace al dueño es que su cliente no va a recibir nunca dos
 * respuestas.
 */
test("marcar el número como atendido por tu IA deja mudo al agente del panel", async () => {
  encender(true);
  D.actualizarCanal(orgId, canalId, { contesta_ia: 1 });

  // Mitad 1: aunque `agente_activo` siga en 1, no habla.
  assert.equal(D.obtenerCanal(orgId, canalId)?.agente_activo, 1, "a propósito: queda encendido");
  const id = hilo([{ emisor: "cliente", content: "¿me lo mandan hoy?", hace: 20 }]);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "contesta_otra_ia");

  // Mitad 2: y la pantalla no miente, porque al marcarlo se apaga.
  D.actualizarCanal(orgId, canalId, { agente_activo: 0 });
  assert.equal(D.obtenerCanal(orgId, canalId)?.agente_activo, 0);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "agente_apagado");

  D.actualizarCanal(orgId, canalId, { contesta_ia: 0 });
  encender(false);
});

/**
 * La comprobación que ve el dueño al encender el agente tiene que decir lo
 * mismo que hace la guarda. Si `revisarAgente` dijera «listo» donde
 * `atenderConversacion` se calla, la pantalla estaría mintiendo justo en el
 * momento en que alguien confía en ella para dejar su WhatsApp desatendido.
 */
test("revisarAgente dice lo mismo que hace la guarda", async () => {
  process.env.OPENROUTER_API_KEY ??= "clave-de-pruebas";

  // Apagado: ni listo, ni contesta.
  encender(false);
  const apagado = revisarAgente(orgId, canalId);
  assert.equal(apagado.listo, false);
  const conv = hilo([{ emisor: "cliente", content: "hola", hace: 5 }]);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, conv)), "agente_apagado");

  // En modo vigilar con el interruptor encendido: la guarda calla y la
  // revisión lo dice con esas palabras.
  D.actualizarCanal(orgId, canalId, { agente_activo: 1, contesta_ia: 1 });
  const vigilando = revisarAgente(orgId, canalId);
  assert.equal(vigilando.listo, false);
  assert.ok(
    vigilando.impedimentos.some((t) => t.includes("vigilar")),
    "tiene que nombrar el modo vigilar, que es lo que hay que cambiar",
  );

  // Encendido de verdad: listo, y sin nada que arreglar.
  //
  // Se borra el consumo del día que dejaron las pruebas de arriba: sus llamadas
  // al modelo fallaron todas —no hay red aquí— y eso es, con razón, uno de los
  // impedimentos que `revisarAgente` señala.
  D.db.prepare("DELETE FROM uso_modelo WHERE org_id = ?").run(orgId);
  encender(true);
  const listo = revisarAgente(orgId, canalId);
  assert.equal(listo.listo, true);
  assert.deepEqual(listo.impedimentos, []);

  // Fuera de horario NO lo apaga: es temporal, y avisa.
  D.actualizarAgente(orgId, { horario_activo: 1, horario_desde: "09:00", horario_hasta: "09:01" });
  const fuera = revisarAgente(orgId, canalId);
  assert.equal(fuera.listo, true, "el horario no es una avería");
  D.actualizarAgente(orgId, { horario_activo: 0 });

  encender(false);
});
