import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import {
  armarSistema,
  atenderConversacion,
  monedaAjena,
  dentroDeHorario,
  esperaDeCortesia,
  nombreDelNegocio,
  partirEnMensajes,
  loYaPreguntado,
  pideHumano,
  porQueCalla,
  revisarAgente,
} from "../src/lib/agent";
import { contieneMarcador, duenoDelCierre, registrarCierre } from "../src/lib/cierre";
import { leerEtiquetaDeAsesor } from "../src/lib/agent";
import { ingerir } from "../src/lib/ingesta";
import { direccionDelChat, jidDeDestino } from "../src/lib/telefono";
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


/** Mensajes de mentira, para las funciones puras que leen un hilo. */
function hiloFalso(turnos: { emisor: D.Emisor; content: string }[]): D.Mensaje[] {
  return turnos.map((t, i) => ({
    id: i + 1, org_id: orgId, conversation_id: 0, whapi_message_id: null,
    emisor: t.emisor, tipo: "texto", descripcion_imagen: null, categoria_imagen: null,
    transcripcion: null, media_url: null, content: t.content, created_at: 1_700_000_000 + i,
  }));
}

// ── Funciones puras ─────────────────────────────────────────────────────────

test("detecta que el cliente pide una persona", () => {
  assert.equal(pideHumano("quiero hablar con una persona por favor"), true);
  assert.equal(pideHumano("me pasas con UN ASESOR?"), true);
  assert.equal(pideHumano("eres un bot?"), true);
  assert.equal(pideHumano("quiero dos camisas talla M"), false);

  // Con tilde o sin ella es la misma petición.
  assert.equal(pideHumano("necesito atención humana"), true);
  assert.equal(pideHumano("me atiende un asesor por favor?"), true);
  assert.equal(pideHumano("asesor"), true);
});

/**
 * EL FALSO POSITIVO CUESTA LA VENTA.
 *
 * Reconocer una petición donde no la hay deja al agente MUDO en ese hilo para
 * siempre. «Un vendedor me dijo ayer que costaba 20» no es alguien pidiendo un
 * vendedor: es un cliente contando algo mientras compra, y antes bastaba para
 * apagar al agente en mitad de la venta.
 */
test("nombrar a un vendedor no es pedir uno", () => {
  assert.equal(pideHumano("un vendedor me dijo ayer que costaba 20 dolares"), false);
  assert.equal(pideHumano("¿tienen asesores en Santiago o solo por aqui?"), false);
  assert.equal(pideHumano("soy vendedor de ropa y quiero comprar dos docenas"), false);
  assert.equal(pideHumano("el encargado de mi tienda me pidio cotizar estas camisas"), false);

  // Y cuando de verdad lo pide, sigue saliendo.
  assert.equal(pideHumano("por favor necesito que me atienda un asesor de verdad"), true);
  assert.equal(pideHumano("no quiero un bot, dame un humano"), true);
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

  /*
   * El horario es DEL CANAL, no de la cuenta.
   *
   * Cada numero tiene su propio agente —el de Panama, el de Costa Rica, el de
   * Republica Dominicana— y cada uno con su horario, que ademas esta en un huso
   * distinto. Tocar la plantilla de la cuenta no cambiaria nada en el numero
   * que de verdad va a contestar, y esta prueba pasaria a la generacion en vez
   * de callarse: es exactamente lo que ocurre si alguien vuelve a leer el
   * agente sin decir de que canal.
   */
  D.actualizarAgente(
    orgId,
    { horario_activo: 1, horario_desde: hh(lejos), horario_hasta: hh(dos) },
    canalId,
  );

  const id = hilo([{ emisor: "cliente", content: "hola", hace: 10 }]);
  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "fuera_de_horario");

  D.actualizarAgente(orgId, { horario_activo: 0 }, canalId);
});

/**
 * UNA VENTA LARGA ES UNA VENTA, NO UNA AVERÍA.
 *
 * El tope eran ocho respuestas por hora, y una venta por WhatsApp se cierra
 * preguntando de uno en uno: artículo, talla, color, nombre, dirección,
 * referencia, día de entrega, resumen. Ocho, antes de la primera objeción. El
 * agente se callaba en la recta final —con el cliente a medio pedido— y no
 * volvía en una hora. Enganchar a alguien y desaparecer cuando ya iba a comprar
 * es lo peor que puede hacer.
 */
test("una conversación larga no calla al agente: sigue hasta cerrar", async () => {
  encender(true);
  const mensajes: { emisor: D.Emisor; content: string; hace: number }[] = [];

  // Doce idas y venidas, todas distintas: una venta normal que va avanzando.
  for (let i = 0; i < 12; i++) {
    mensajes.push({ emisor: "cliente", content: `pregunta ${i}`, hace: 2000 - i * 100 });
    mensajes.push({ emisor: "ia", content: `respuesta ${i}`, hace: 1990 - i * 100 });
  }
  mensajes.push({ emisor: "cliente", content: "la 42 entonces", hace: 5 });

  const id = hilo(mensajes);
  const r = await atenderConversacion(orgId, canalId, id);

  // Llega hasta el modelo —que en las pruebas no existe— en vez de callarse
  // por el tope. Eso es lo que se está fijando aquí.
  assert.equal(motivoDe(r), "fallo_modelo", "el tope no puede cortar una venta en marcha");
  assert.equal(
    D.listarAnomalias(orgId).some((a) => a.conversation_id === id && a.tipo === "agente_en_bucle"),
    false,
    "hablar mucho con un cliente no es un bucle",
  );
});

/**
 * Un bucle de verdad se reconoce por lo que dice, no por cuánto habla: el
 * agente atascado manda la MISMA frase una y otra vez. Ahí no hay venta que
 * salvar y hay que parar.
 */
test("tres veces la misma frase sí es un bucle, y ahí para", async () => {
  encender(true);
  const id = hilo([
    { emisor: "cliente", content: "hola", hace: 900 },
    { emisor: "ia", content: "¿Qué talla necesita?", hace: 800 },
    { emisor: "cliente", content: "?", hace: 700 },
    { emisor: "ia", content: "¿Qué talla necesita?", hace: 600 },
    { emisor: "cliente", content: "??", hace: 500 },
    { emisor: "ia", content: "¿Qué talla necesita?", hace: 400 },
    { emisor: "cliente", content: "???", hace: 5 },
  ]);

  const r = await atenderConversacion(orgId, canalId, id);

  assert.equal(motivoDe(r), "limite_por_hora");
  assert.ok(
    D.listarAnomalias(orgId).find((a) => a.conversation_id === id && a.tipo === "agente_en_bucle"),
    "debe quedar registrado que el agente se detuvo",
  );
});

/** Y el cortafuegos de siempre sigue ahí, solo que con sitio para vender. */
test("treinta mensajes en una hora sí frenan al agente", async () => {
  encender(true);
  const mensajes: { emisor: D.Emisor; content: string; hace: number }[] = [];

  for (let i = 0; i < 30; i++) {
    mensajes.push({ emisor: "cliente", content: `p${i}`, hace: 3000 - i * 90 });
    mensajes.push({ emisor: "ia", content: `r${i}`, hace: 2990 - i * 90 });
  }
  mensajes.push({ emisor: "cliente", content: "sigo aquí", hace: 5 });

  const r = await atenderConversacion(orgId, canalId, hilo(mensajes));
  assert.equal(motivoDe(r), "limite_por_hora");
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
  /*
   * Con el anuncio delante el agente SÍ cotiza —lo publicó el propio negocio—
   * pero lo que no esté ni en el anuncio ni en el catálogo sigue sin prometerse.
   * Esa es la línea que separa «vender con el precio del dueño» de «inventar».
   */
  assert.ok(
    conAnuncio.includes("dile que lo confirmas con el equipo"),
    "lo que no está en ningún sitio se confirma, no se afirma",
  );
  assert.ok(
    conAnuncio.includes("el precio que anuncia es un precio bueno"),
    "pero el precio del propio anuncio sí se puede cotizar",
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
  /*
   * La orden lleva los datos que el analista extrae después —producto, montos y
   * envío— y con la forma con la que se lee limpio en un WhatsApp: cada
   * concepto en su línea y el total destacado.
   */
  assert.ok(prompt.includes("Monto del producto"), "el pedido trae lo que luego se extrae");
  assert.ok(prompt.includes("TOTAL A PAGAR"));
  assert.ok(prompt.includes("Envío:"));
});

/**
 * EL SALUDO Y LA RESPUESTA SON DOS MENSAJES, NO UN PÁRRAFO.
 *
 * Es lo que separa a un vendedor de un bot en la pantalla del cliente: el
 * «hola, bienvenido» llega solo, y detrás llega lo que vino a preguntar, con la
 * talla al final. Lo que NO puede pasar es que se parta un resumen de pedido
 * —tiene líneas en blanco dentro y saldría medio pedido en cada mensaje— ni que
 * el agente conteste en dos globos a mitad de la conversación.
 */
test("el saludo sale en su propio mensaje, y solo al abrir la conversación", () => {
  const apertura = partirEnMensajes(
    "Hola, bienvenido a Tienda Rincón\n\nSí, ese modelo está disponible.\n\n¿Qué talla necesita?",
    { saludoAparte: true },
  );

  assert.equal(apertura.length, 2, "el saludo va aparte de la respuesta");
  assert.equal(apertura[0], "Hola, bienvenido a Tienda Rincón");
  assert.equal(
    apertura[1],
    "Sí, ese modelo está disponible.\n\n¿Qué talla necesita?",
    "se parte UNA vez: el hueco entre la respuesta y la pregunta se queda dentro del mensaje",
  );

  // A mitad de conversación no hay nada que saludar: un mensaje y ya.
  const seguido = partirEnMensajes("Entendido.\n\n¿Qué color prefiere?", { saludoAparte: false });
  assert.deepEqual(seguido, ["Entendido.\n\n¿Qué color prefiere?"]);

  // Sin línea en blanco no hay corte que hacer.
  assert.deepEqual(partirEnMensajes("¿Qué talla necesita?", { saludoAparte: true }), [
    "¿Qué talla necesita?",
  ]);

  // Y de un mensaje vacío no sale nada.
  assert.deepEqual(partirEnMensajes("   \n\n  ", { saludoAparte: true }), []);
});

/**
 * El resumen del pedido lleva el nombre, la dirección y el total separados por
 * líneas en blanco. Partirlo por la primera mandaría «Gracias, Yazmin.» por un
 * lado y el pedido por otro, y el cliente leería su compra a trozos.
 */
test("un resumen de pedido nunca se parte, aunque sea el primer mensaje", () => {
  const resumen =
    "Gracias, Yazmin.\n\nResumen de su pedido:\n\nProducto: Mocasines\n\nTOTAL A PAGAR: USD 35";

  assert.deepEqual(partirEnMensajes(resumen, { saludoAparte: true }), [resumen]);

  // Y con el marcador propio de la cuenta, igual.
  const propio = "Hola.\n\nPedido cerrado: 2 camisas talla M";
  assert.deepEqual(partirEnMensajes(propio, { saludoAparte: true, marcador: "Pedido cerrado:" }), [
    propio,
  ]);
});

/** Al agente hay que decírselo, o manda el saludo pegado al precio. */
test("el prompt le dice cómo saluda y con el nombre del negocio", () => {
  const prompt = armarSistema("Tienda Rincón", D.obtenerAgente(orgId), [], null);

  assert.ok(prompt.includes("Hola, bienvenido a Tienda Rincón"), "saluda con el nombre del negocio");
  assert.ok(prompt.includes("LÍNEA EN BLANCO"), "y sabe con qué se separan los dos mensajes");
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
  D.actualizarAgente(
    orgId,
    { horario_activo: 1, horario_desde: "09:00", horario_hasta: "09:01" },
    canalId,
  );
  const fuera = revisarAgente(orgId, canalId);
  assert.equal(fuera.listo, true, "el horario no es una avería");
  D.actualizarAgente(orgId, { horario_activo: 0 }, canalId);

  encender(false);
});

/**
 * A un cliente se le contesta a la dirección que manda WhatsApp, no a sus
 * dígitos.
 *
 * Desde el cambio a LID, el chat de un cliente puede identificarse con
 * `<lid>@lid`, que NO es su teléfono. Reconstruir `<lid>@s.whatsapp.net` para
 * contestarle manda el mensaje a una dirección que no es de nadie: WhatsApp lo
 * acepta y devuelve un identificador, así que el panel guarda la respuesta y la
 * enseña en el hilo, y el cliente no recibe nada. Es el fallo más caro posible
 * —parece que el agente contestó— y por eso está fijado aquí.
 */
test("se contesta a la dirección de WhatsApp, no a los dígitos del identificador", async () => {
  // El teléfono manda cuando WhatsApp lo da.
  assert.equal(
    direccionDelChat("123456789012345@lid", "18095551234@s.whatsapp.net"),
    "18095551234@s.whatsapp.net",
  );
  // Y si no lo da, se contesta al LID: es donde está el cliente.
  assert.equal(direccionDelChat("123456789012345@lid", undefined), "123456789012345@lid");
  assert.equal(direccionDelChat("18095551234@s.whatsapp.net", null), "18095551234@s.whatsapp.net");

  // La dirección guardada se usa tal cual; los dígitos sueltos —hilos viejos—
  // siguen armando la dirección de toda la vida.
  assert.equal(jidDeDestino("123456789012345@lid"), "123456789012345@lid");
  assert.equal(jidDeDestino("18095551234"), "18095551234@s.whatsapp.net");

  // Y el hilo se queda con ella. El agente está apagado: esto no toca la red.
  encender(false);
  const canal = D.obtenerCanal(orgId, canalId)!;
  await ingerir(
    canal,
    [{
      id: "wa-lid-1", deMi: false, chatId: "123456789012345@lid", tipo: "texto",
      content: "hola, ¿tienen la camisa?", mediaUrl: null, cuando: D.ahora(),
      nombre: "Cliente LID", deAnuncio: false, productoAnuncio: null, descripcionAnuncio: null,
    }],
    { dentroDePeticion: false },
  );

  const { conversacion, nueva } = D.getOrCreateConversation(orgId, canalId, "123456789012345");
  assert.equal(nueva, false, "el mensaje tenía que haber abierto el hilo");
  assert.equal(conversacion.cliente_jid, "123456789012345@lid");
});

// ── Etiqueta de asesor y seguimientos ───────────────────────────────────────

/**
 * `[HANDOFF]` es una instrucción para nosotros, no texto para el cliente.
 * Mandársela tal cual —que es lo que pasaba— deja al cliente leyendo una
 * etiqueta en inglés al final de su resumen de pedido.
 */
test("la etiqueta de pasar a un asesor se quita del mensaje y se anota", () => {
  const conResumen = leerEtiquetaDeAsesor("Resumen de su pedido:\nTotal: USD 23.00\n[HANDOFF]");
  assert.equal(conResumen.pideAsesor, true);
  assert.equal(conResumen.texto, "Resumen de su pedido:\nTotal: USD 23.00");

  // Sin corchetes y en minúsculas: el modelo la escribe de las dos formas.
  const suelta = leerEtiquetaDeAsesor("Le atiende un asesor en un momento. handoff");
  assert.equal(suelta.pideAsesor, true);
  assert.equal(suelta.texto, "Le atiende un asesor en un momento.");

  // Y un mensaje normal no se toca.
  const normal = leerEtiquetaDeAsesor("¿Qué talla necesita?");
  assert.deepEqual(normal, { texto: "¿Qué talla necesita?", pideAsesor: false });
});

/**
 * A quién le toca un recordatorio, y —más importante— a quién NO.
 *
 * Un seguimiento es un mensaje que el cliente no pidió: equivocarse aquí no es
 * un dato mal contado, es escribirle a alguien a quien no había que escribirle.
 */
test("solo se recuerda a quien dejó la conversación a medias", () => {
  encender(true);
  const t = D.ahora();
  const hace = (h: number) => t - h * 3600;
  const ventana = { desde: hace(27), hasta: hace(3) };

  const enVisto = hilo([
    { emisor: "cliente", content: "¿tienen la correa?", hace: 6 * 3600 },
    { emisor: "ia", content: "Sí. ¿Qué medida de cintura usa?", hace: 5 * 3600 },
  ]);
  D.actualizarConversacion(orgId, enVisto, { last_message_at: hace(5) });

  // Contestó el cliente: la conversación sigue viva, no se le insiste.
  const viva = hilo([
    { emisor: "ia", content: "¿Qué medida usa?", hace: 6 * 3600 },
    { emisor: "cliente", content: "la 34", hace: 5 * 3600 },
  ]);
  D.actualizarConversacion(orgId, viva, { last_message_at: hace(5) });

  // Escribió un vendedor: hay una persona ocupándose.
  const conVendedor = hilo([
    { emisor: "cliente", content: "¿precio?", hace: 6 * 3600 },
    { emisor: "humano", content: "ya le confirmo", hace: 5 * 3600 },
  ]);
  D.actualizarConversacion(orgId, conVendedor, { last_message_at: hace(5) });

  const ids = () => D.conversacionesEnVisto(orgId, ventana).map((c) => c.id);

  assert.ok(ids().includes(enVisto), "el que se quedó en visto sí entra");
  assert.ok(!ids().includes(viva), "si contestó el cliente, no se le insiste");
  assert.ok(!ids().includes(conVendedor), "si escribió un vendedor, el agente no se mete");

  // Una sola vez: registrado el seguimiento, deja de salir.
  assert.equal(D.registrarSeguimiento(orgId, enVisto, "visto"), true);
  assert.equal(D.registrarSeguimiento(orgId, enVisto, "visto"), false, "no se repite");
  assert.ok(!ids().includes(enVisto), "ya no vuelve a salir");

  encender(false);
});

test("el aviso de pedido en camino sale una vez, y solo de las ventas cerradas", () => {
  encender(true);
  const t = D.ahora();
  const ventana = { desde: t - 42 * 3600, hasta: t - 18 * 3600 };

  const vendida = hilo([{ emisor: "cliente", content: "la quiero", hace: 20 * 3600 }]);
  D.sellarCierre(orgId, vendida, { cerradoPor: "ia", senal: "resumen_ia", fechaCierre: t - 20 * 3600 });

  const abierta = hilo([{ emisor: "cliente", content: "lo pienso", hace: 20 * 3600 }]);

  const ids = () => D.ventasParaRecordar(orgId, ventana).map((c) => c.id);

  assert.ok(ids().includes(vendida), "la venta cerrada hace 20 horas entra");
  assert.ok(!ids().includes(abierta), "una conversación sin cerrar no lleva aviso de entrega");

  D.registrarSeguimiento(orgId, vendida, "entrega");
  assert.ok(!ids().includes(vendida), "y no se repite");

  encender(false);
});

/**
 * EL SILENCIO PERMANENTE TIENE VUELTA ATRÁS.
 *
 * Cuando un cliente pide una persona, el agente se calla en ese hilo y lo que
 * lo mantiene callado es una anomalía abierta. Ninguna pantalla podía cerrarla:
 * esa conversación se quedaba sin agente PARA SIEMPRE, también cuando el
 * cliente volvía días después a comprar. Y desde fuera no había forma de saber
 * por qué nadie contestaba.
 */
test("el panel dice por qué calla el agente, y se le puede devolver el hilo", async () => {
  encender(true);
  const id = hilo([
    { emisor: "cliente", content: "hola, quiero una camisa", hace: 600 },
    { emisor: "ia", content: "¿Qué talla necesita?", hace: 500 },
    { emisor: "cliente", content: "necesito que me atienda un asesor de verdad", hace: 5 },
  ]);

  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "pidio_humano");

  const callado = porQueCalla(orgId, canalId, id);
  assert.equal(callado.callado, true);
  assert.equal(callado.motivo, "pidio_humano");
  assert.equal(callado.reversible, true, "esto se tiene que poder deshacer");
  assert.ok(callado.explicacion?.includes("persona"), "y explicarse con palabras del negocio");

  // La vuelta atrás: el hilo es otra vez del agente.
  assert.equal(D.devolverALaIa(orgId, id), 1);
  assert.equal(porQueCalla(orgId, canalId, id).callado, false);

  /*
   * Y atiende de verdad al siguiente mensaje —llega hasta el modelo, que en las
   * pruebas no existe—. El mensaje nuevo importa: la guarda mira lo ÚLTIMO que
   * escribió el cliente, así que sobre la petición de antes se volvería a
   * callar, y eso está bien. Lo que no puede es seguir callado cuando el
   * cliente vuelve hablando de la compra.
   */
  D.insertMessage(orgId, {
    conversationId: id, whapiMessageId: `vuelve-${id}`, emisor: "cliente",
    tipo: "texto", content: "listo, me llamaron. la 42 entonces", createdAt: D.ahora(),
  });

  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "fallo_modelo");

  encender(false);
});

/** Con el número en modo vigilar, el hilo lo dice sin rodeos. */
test("en modo vigilar el hilo explica que aquí contesta la otra IA", () => {
  encender(false);
  const id = hilo([{ emisor: "cliente", content: "hola", hace: 10 }]);

  const estado = porQueCalla(orgId, canalId, id);
  assert.equal(estado.motivo, "contesta_otra_ia");
  assert.equal(estado.reversible, false);
});

/**
 * CONTESTAR AL INSTANTE ES LO QUE MÁS DELATA A UN BOT.
 *
 * Pero el retardo es un mínimo desde que escribió el cliente, no un recargo
 * encima de lo que ya se tardó: si pensar la respuesta costó seis segundos, ya
 * no hay nada que esperar. Sumarlos convertiría un modelo lento en un cliente
 * mirando la pantalla.
 */
test("el retardo es un mínimo, no una suma", () => {
  // Recién llegado: espera los cuatro segundos enteros.
  assert.equal(esperaDeCortesia(4, 0), 4);
  // El modelo tardó dos: solo faltan dos.
  assert.equal(esperaDeCortesia(4, 2), 2);
  // Tardó más que el retardo: se contesta ya.
  assert.equal(esperaDeCortesia(4, 9), 0);
  // Apagado, como estaba antes.
  assert.equal(esperaDeCortesia(0, 0), 0);
  assert.equal(esperaDeCortesia(null, 0), 0);
  // Y un número absurdo en el panel no deja un socket dormido diez minutos.
  assert.equal(esperaDeCortesia(9999, 0), 120);
});

/**
 * QUIÉN ATIENDE, HILO A HILO.
 *
 * Antes solo se podía decidir por número: el agente encendido para todos los
 * clientes o apagado para todos. En una bandeja real hay clientes que el agente
 * lleva hasta el cierre y clientes que un vendedor prefiere atender a mano.
 */
test("una conversación se puede poner en manos de una persona, y devolverla", async () => {
  encender(true);
  const id = hilo([
    { emisor: "cliente", content: "hola, quiero la camisa azul", hace: 300 },
    { emisor: "ia", content: "¿Qué talla necesita?", hace: 200 },
    { emisor: "cliente", content: "la M", hace: 5 },
  ]);

  // Con el interruptor en la IA, atiende: llega hasta el modelo, que aquí no existe.
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "fallo_modelo");

  D.ponerAtiende(orgId, id, "humano");

  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "atiende_humano");

  const callado = porQueCalla(orgId, canalId, id);
  assert.equal(callado.motivo, "atiende_humano");
  assert.equal(callado.reversible, true);

  // Y solo calla en ESTE hilo: el número sigue contestando a los demás.
  const otro = hilo([{ emisor: "cliente", content: "¿tienen la 42?", hace: 5 }]);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, otro)), "fallo_modelo");

  // La vuelta: el mismo botón que deshace un handoff.
  D.devolverALaIa(orgId, id);
  assert.equal(D.getConversation(orgId, id)?.atiende, "ia");
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "fallo_modelo");

  encender(false);
});

/** Cuando el cliente pide una persona, el interruptor del hilo lo refleja. */
test("pedir una persona deja el hilo marcado como atendido por un humano", async () => {
  encender(true);
  const id = hilo([{ emisor: "cliente", content: "quiero hablar con una persona", hace: 5 }]);

  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, id)), "pidio_humano");
  assert.equal(
    D.getConversation(orgId, id)?.atiende,
    "humano",
    "la pantalla del hilo tiene que enseñarlo con el mismo interruptor",
  );

  encender(false);
});

// ── Con qué nombre saluda ───────────────────────────────────────────────────

/**
 * EL CLIENTE YA SABE CON QUIÉN HABLA.
 *
 * Lleva el nombre del negocio delante desde antes de escribir: es lo que ve
 * arriba del chat, y en un anuncio el de la página que lo publicó. El agente
 * saludaba con el nombre de la CUENTA del panel —lo escribe quien la abre, y no
 * tiene por qué ser el de la tienda—, así que el cliente recibía «bienvenido a»
 * un nombre ajeno. Suena a conversación equivocada, que es lo contrario de lo
 * que un saludo tiene que hacer.
 */
test("saluda con el nombre del perfil de WhatsApp, no con el de la cuenta", () => {
  // Lo normal: manda el perfil del número por encima del nombre de la cuenta.
  assert.equal(
    nombreDelNegocio({ negocio: "" }, { negocio: "Tienda Rincon" }, { nombre: "Cuenta Nueva" }),
    "Tienda Rincon",
  );

  // Escrito a mano en el panel, manda sobre todo lo demás.
  assert.equal(
    nombreDelNegocio({ negocio: "Rincon Store" }, { negocio: "Tienda Rincon" }, { nombre: "Cuenta" }),
    "Rincon Store",
  );

  // Sin perfil todavía —un número recién creado— sigue valiendo la cuenta.
  assert.equal(nombreDelNegocio({ negocio: "" }, { negocio: null }, { nombre: "Cuenta" }), "Cuenta");
  assert.equal(nombreDelNegocio({ negocio: "" }, null, null), "el negocio");

  // Y con ese nombre se le dice al modelo cómo saludar.
  const prompt = armarSistema("Tienda Rincon", D.obtenerAgente(orgId), [], null);
  assert.ok(prompt.includes("Hola, bienvenido a Tienda Rincon"));
});

// ── Memoria, envío y entrega ────────────────────────────────────────────────

/**
 * PREGUNTAR DOS VECES LO MISMO ES DECIRLE AL CLIENTE QUE NO LE ESCUCHAS.
 *
 * Y no basta con recordar la pregunta: hay que recordar LO QUE CONTESTÓ. Un
 * dato que el cliente ya mandó —su talla, su dirección, su nombre— es suyo para
 * el resto de la conversación, y volver a pedírselo «para confirmar» es la
 * forma más rápida de que se canse a un paso del cierre.
 *
 * Todo esto sale del propio hilo, sin gastar una llamada: lo escribieron los
 * dos, cada uno lo suyo.
 */
test("el agente recuerda lo que preguntó y lo que el cliente le contestó", () => {
  const mensajes = hiloFalso([
    { emisor: "cliente", content: "hola, quiero los mocasines" },
    { emisor: "ia", content: "Están disponibles. ¿Qué talla necesitas?" },
    { emisor: "cliente", content: "la 42" },
    { emisor: "ia", content: "Listo. ¿En qué color lo prefieres?" },
    { emisor: "cliente", content: "chocolate" },
    { emisor: "ia", content: "Perfecto. ¿A qué dirección te lo enviamos?" },
  ]);

  assert.deepEqual(loYaPreguntado(mensajes), [
    { pregunta: "¿Qué talla necesitas?", respuesta: "la 42" },
    { pregunta: "¿En qué color lo prefieres?", respuesta: "chocolate" },
    // La última se quedó sin contestar, y eso también hay que saberlo.
    { pregunta: "¿A qué dirección te lo enviamos?", respuesta: null },
  ]);

  // La misma pregunta dos veces sale una sola vez, con o sin tildes, y se queda
  // con la respuesta más reciente.
  const repetida = loYaPreguntado(
    hiloFalso([
      { emisor: "cliente", content: "hola" },
      { emisor: "ia", content: "¿Qué talla necesitas?" },
      { emisor: "cliente", content: "?" },
      { emisor: "ia", content: "Que talla necesitas?" },
      { emisor: "cliente", content: "la 42" },
    ]),
  );
  assert.equal(repetida.length, 1);
  assert.equal(repetida[0]?.respuesta, "la 42");

  // Lo que pregunta el CLIENTE no cuenta: son las preguntas del agente.
  assert.deepEqual(
    loYaPreguntado(hiloFalso([{ emisor: "cliente", content: "¿cuánto cuesta el envío?" }])),
    [],
  );
});

/** Un día de entrega prometido que no se cumple es una devolución. */
test("el prompt prohíbe prometer un día de entrega", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId), [], null);

  assert.ok(prompt.includes("NO PROMETAS UN DÍA NI UNA HORA DE ENTREGA"));
  assert.ok(prompt.includes("SE DESPACHA dentro de 24 a 48 horas"));
});

/**
 * CÓMO SE VE UN MENSAJE, que es la mitad de la venta.
 *
 * Un párrafo de tres renglones pegados se lee a bot; la respuesta arriba, un
 * hueco, y la pregunta debajo se lee a tienda que se toma en serio. Y no se
 * pregunta una variante que el artículo no tiene: hay negocios cuyos productos
 * no llevan talla ni color, y preguntarlas delata al instante que no sabes lo
 * que estás vendiendo.
 */
test("el prompt pide mensajes limpios y no inventa variantes", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId), [], null);

  assert.ok(prompt.includes("ESCRIBE LIMPIO Y CON AIRE"));
  assert.ok(prompt.includes("UNA SOLA IDEA POR MENSAJE"), "un dato por pregunta");
  assert.ok(prompt.includes("Trato de USTED"), "y de usted, aunque el país tutee");
  assert.ok(
    prompt.includes("nada de listas, asteriscos"),
    "un mensaje normal se escribe plano; el formato es solo para la orden",
  );
  assert.ok(
    prompt.includes("¿necesita algo más?"),
    "y cuando está cerrada, se cierra: esa pregunta la vuelve a abrir",
  );
  assert.ok(prompt.includes("PREGUNTA SOLO LO QUE ESTE PEDIDO NECESITA"));
  assert.ok(prompt.includes("no preguntes la talla"), "si el artículo no la lleva");

  // Y el ejemplo del saludo no da por hecho que existan las tallas.
  assert.ok(!prompt.includes("¿Qué talla necesita?"));
});

/**
 * EL COSTO DE ENVÍO NO SE INVENTA, SE BUSCA.
 *
 * Es el error más fácil: al agente le falta una línea para cerrar y escribe una
 * cifra. Si se pasa, pierde la venta; si se queda corto, el negocio paga la
 * diferencia en cada pedido de esa zona. La provincia del pin del mapa es la
 * que decide cuál de las dos tarifas le toca.
 */
test("el envío sale de la provincia del mapa, y sin tarifas no se inventa", async () => {
  const { obtenerPais } = await import("../src/lib/paises");
  const { bloqueDeEnvio, zonaDeEnvio } = await import("../src/lib/envio");
  const rd = obtenerPais("do")!;

  // El Gran Santo Domingo y Santiago son del mensajero; el resto, interior.
  assert.equal(zonaDeEnvio(rd, "Santo Domingo Este"), "cerca");
  assert.equal(zonaDeEnvio(rd, "Distrito Nacional"), "cerca");
  // Santiago cobra como interior: la tarifa de estos negocios es capital contra
  // interior, y meterlo en la de capital cobraría de menos cada pedido del Cibao.
  assert.equal(zonaDeEnvio(rd, "Santiago"), "lejos");
  assert.equal(zonaDeEnvio(rd, "La Vega"), "lejos");
  assert.equal(zonaDeEnvio(rd, "Puerto Plata"), "lejos");
  // Lo que no se reconoce no se adivina: ahí se pregunta.
  assert.equal(zonaDeEnvio(rd, "por el parque"), null);
  assert.equal(zonaDeEnvio(rd, null), null);

  const tarifas = { envio_cerca: 200, envio_lejos: 350 };

  // Con el pin en el interior, el importe que le toca a ESE cliente.
  const lejos = bloqueDeEnvio(rd, tarifas, "Provincia La Vega");
  assert.ok(lejos.includes("RD$350"), "el del interior");
  assert.ok(lejos.includes("A ESTE CLIENTE"), "dicho para este cliente, no las dos tarifas");

  const cerca = bloqueDeEnvio(rd, tarifas, "Santo Domingo Norte");
  assert.ok(cerca.includes("A ESTE CLIENTE le corresponde RD$200"));

  // Sin pin, las dos tarifas delante desde el primer mensaje.
  const sinPin = bloqueDeEnvio(rd, tarifas, null);
  assert.ok(sinPin.includes("RD$200") && sinPin.includes("RD$350"));
  assert.ok(!sinPin.includes("A ESTE CLIENTE"));

  // Y sin tarifas cargadas: prohibido decir un costo.
  const sinTarifas = bloqueDeEnvio(rd, { envio_cerca: null, envio_lejos: null }, "Santiago");
  assert.ok(sinTarifas.includes("NO TE LO INVENTES"));
  // Nombra la moneda del país —para que reconozca un monto ajeno— pero no
  // suelta ni un importe: eso es justo lo que no puede inventarse.
  assert.match(sinTarifas, /peso dominicano/);
  assert.doesNotMatch(sinTarifas, /RD\\$\\d/, "no puede salir ni una cifra");
});

/** Y el bloque llega al prompt con la cifra de este cliente. */
test("las tarifas cargadas entran en el prompt del agente", () => {
  D.actualizarAgente(orgId, { pais: "do", envio_cerca: 200, envio_lejos: 350 }, canalId);
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null);

  assert.ok(prompt.includes("COSTO DE ENVÍO"));
  assert.ok(prompt.includes("RD$200") && prompt.includes("RD$350"));

  D.actualizarAgente(orgId, { envio_cerca: null, envio_lejos: null }, canalId);
  const sin = armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null);
  assert.ok(sin.includes("NO TE LO INVENTES"));
});

/**
 * EL GUION DE OTRO PAÍS, QUE NO SE VE SOLO.
 *
 * Un número dominicano con el guion de la tienda de Panamá aplicado contesta,
 * vende y cierra igual de bien —y en cada pedido cotiza el envío en US$5.00,
 * que es el envío de Panamá—. Nadie lo nota hasta que un cliente lo repite en
 * voz alta, y para entonces lleva semanas cobrando mal.
 *
 * La moneda es lo que lo delata, porque es lo que no se puede falsificar.
 */
test("un guion escrito en otra moneda se detecta", () => {
  // El caso real: la plantilla de Panamá en un número que vende en pesos.
  assert.equal(monedaAjena("El envío son US$5.00 siempre, en todo el país.", "DOP"), "dólares");
  assert.equal(monedaAjena("Costo de envío: USD 5", "DOP"), "dólares");
  assert.equal(monedaAjena("El envío son 5 dólares", "DOP"), "dólares");

  // Un guion dominicano en un número dominicano no molesta a nadie.
  assert.equal(monedaAjena("Envío RD$250 en Santo Domingo y RD$290 al interior.", "DOP"), null);

  // En Panamá el dólar es de casa: allí no es un guion ajeno.
  assert.equal(monedaAjena("El envío son US$5.00 siempre.", "PAB"), null);
  // Pero los colones sí lo serían.
  assert.equal(monedaAjena("El envío son ₡2.500", "PAB"), "colones");

  // Y no salta con palabras que solo TERMINAN en esas letras.
  assert.equal(monedaAjena("El estatus del pedido y el bus de la Duarte", "DOP"), null);
});

/** Y el panel del número lo dice, que es donde se mira antes de encender. */
test("el panel avisa de que ese número lleva el guion de otro país", () => {
  D.actualizarAgente(orgId, { pais: "do", instrucciones: "El envío son US$5.00 siempre." }, canalId);

  const revision = revisarAgente(orgId, canalId);
  const aviso = revision.avisos.find((a) => a.includes("dólares"));

  assert.ok(aviso, "tiene que avisar de que el guion habla de otra moneda");
  assert.ok(aviso.includes("COSTO DE ENVÍO"), "y señalar lo que más caro sale");

  // Con el guion de su país, ni una palabra.
  D.actualizarAgente(orgId, { instrucciones: "Envío RD$250 en Santo Domingo." }, canalId);
  assert.equal(
    revisarAgente(orgId, canalId).avisos.some((a) => a.includes("dólares")),
    false,
  );

  D.actualizarAgente(orgId, { instrucciones: "" }, canalId);
});

/**
 * AL MARCAR EL PAÍS, TODO SE RIGE POR ESE PAÍS.
 *
 * Un guion se copia de un número a otro y se queda. El de la tienda de Panamá
 * dentro de un número dominicano trae dólares, corregimientos y un envío de
 * US$5.00, y el agente lo lee como si fuera la verdad de esta tienda: sigue
 * vendiendo y cerrando igual de bien mientras cotiza el envío de otro país.
 *
 * No se le borra el guion al dueño —casi todo lo que dice sigue siendo suyo—:
 * se le quita el dinero y la geografía de otro sitio, y eso va DESPUÉS de las
 * instrucciones, que es lo que más pesa.
 */
test("marcado el país, el guion de otro país deja de mandar en lo suyo", () => {
  D.actualizarAgente(
    orgId,
    {
      pais: "do",
      instrucciones: "El envío son US$5.00 siempre. Pregunta el corregimiento.",
      envio_cerca: 250,
      envio_lejos: 290,
    },
    canalId,
  );

  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null);

  // El país del número manda, y se dice después del guion.
  assert.ok(prompt.includes("ESTE NÚMERO VENDE EN REPÚBLICA DOMINICANA"));
  assert.ok(
    prompt.indexOf("ESTE NÚMERO VENDE EN") > prompt.indexOf("Instrucciones del negocio"),
    "va detrás de las instrucciones: lo último que se lee es lo que más pesa",
  );
  assert.ok(prompt.includes("peso dominicano"), "y con la moneda de aquí");

  // El envío que cotiza es el cargado, no el del guion ajeno.
  assert.ok(prompt.includes("RD$250") && prompt.includes("RD$290"));
  assert.ok(prompt.includes("mandan sobre cualquier otro monto"));

  // Sin país marcado no se inventa ninguna regla de país.
  D.actualizarAgente(orgId, { pais: "" }, canalId);
  assert.ok(!armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null).includes("ESTE NÚMERO VENDE EN"));

  D.actualizarAgente(orgId, { pais: "do", instrucciones: "", envio_cerca: null, envio_lejos: null }, canalId);
});

/**
 * NO SE CIERRA UN PEDIDO CON UN DATO A MEDIAS, Y LOS DATOS NO SON LOS MISMOS.
 *
 * En República Dominicana un paquete se despacha con el sector y la provincia;
 * en Panamá hace falta el corregimiento; en Costa Rica no hay calle que pedir
 * —van las señas— y además el dinero entra ANTES de que salga el paquete.
 * Cerrar sin uno de esos datos es un paquete que vuelve, y el que vuelve se
 * paga dos veces.
 *
 * Va en el prompt del sistema y no en el guion, así que vale también para el
 * número que nunca aplicó una plantilla.
 */
test("el cierre exige los datos que pide cada país", () => {
  D.actualizarAgente(orgId, { pais: "do", instrucciones: "" }, canalId);
  const rd = armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null);

  assert.ok(rd.includes("SIN ESTOS DATOS NO SE LEVANTA LA ORDEN"));
  assert.ok(rd.includes("EL SECTOR y LA PROVINCIA"), "en RD sitúa el sector");
  assert.ok(!rd.includes("CORREGIMIENTO"), "el corregimiento es de Panamá");

  D.actualizarAgente(orgId, { pais: "cr" }, canalId);
  const cr = armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null);
  assert.ok(cr.includes("CANTÓN"), "en Costa Rica el cantón y el distrito");
  assert.ok(cr.includes("aquí no hay calle y número que pedir"));
  assert.ok(cr.includes("se cobra ANTES de enviar"), "y el dinero va por delante");

  D.actualizarAgente(orgId, { pais: "pa" }, canalId);
  const pa = armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null);
  assert.ok(pa.includes("CORREGIMIENTO"), "en Panamá sitúa el corregimiento");

  // Sin país no se inventa una lista de requisitos.
  D.actualizarAgente(orgId, { pais: "" }, canalId);
  assert.ok(!armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], null).includes("SIN ESTOS DATOS"));

  D.actualizarAgente(orgId, { pais: "do" }, canalId);
});

/**
 * CADA PAÍS, SU AGENTE, Y NADA DEL VECINO.
 *
 * Tres números de la misma cuenta son tres vendedores distintos: cada uno con
 * su moneda, su forma de dar una dirección, su forma de cobrar y su envío. Lo
 * que no puede pasar es que se mezclen —que el tico hable de pesos, que el
 * dominicano pregunte por un corregimiento— porque el cliente lo nota en el
 * primer mensaje: sabe que quien le escribe no está donde dice estar.
 *
 * Esto lo comprueba en el prompt entero, que es lo que de verdad lee el modelo:
 * el país, el guion, el envío y las reglas de cierre juntos.
 */
test("el prompt de un país no lleva nada de los otros dos", async () => {
  const { PLANTILLAS } = await import("../src/lib/plantillas");

  /** Lo que delata a otro país: su dinero y su geografía. */
  const ajeno: Record<string, RegExp[]> = {
    do: [/₡/, /colones/i, /SINPE/i, /corregimiento/i, /US\$/, /Yappy/i],
    cr: [/RD\$/, /pesos dominicanos/i, /corregimiento/i, /Caribe Express/i, /US\$/, /Yappy/i],
    pa: [/₡/, /colones/i, /SINPE/i, /RD\$/, /Caribe Express/i, /Vimenca/i],
  };

  /** Y lo que tiene que estar, porque es lo suyo. */
  const propio: Record<string, RegExp[]> = {
    do: [/RD\$/, /sector/i, /Caribe Express/i],
    cr: [/₡|colon/i, /cant[óo]n/i, /SINPE/i],
    pa: [/corregimiento/i],
  };

  for (const p of PLANTILLAS) {
    D.actualizarAgente(
      orgId,
      {
        pais: p.pais,
        instrucciones: p.instrucciones,
        envio_cerca: 100,
        envio_lejos: 200,
      },
      canalId,
    );

    const prompt = armarSistema(
      "Tienda",
      D.obtenerAgente(orgId, canalId),
      [],
      { origen: "anuncio", producto_anuncio: "Set de sábanas", descripcion_anuncio: "Un set" },
    );

    for (const marca of ajeno[p.pais]!) {
      assert.doesNotMatch(prompt, marca, `${p.pais}: se le coló ${marca} de otro país`);
    }
    for (const marca of propio[p.pais]!) {
      assert.match(prompt, marca, `${p.pais}: le falta lo suyo (${marca})`);
    }
  }

  D.actualizarAgente(orgId, { pais: "do", instrucciones: "", envio_cerca: null, envio_lejos: null }, canalId);
});

/** Y la apertura sale del anuncio: qué vio y qué trae, en una línea. */
test("el primer mensaje de venta sale de la descripción del anuncio", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId, canalId), [], {
    origen: "anuncio",
    producto_anuncio: "Set de sábanas 2 plazas",
    descripcion_anuncio: "Incluye sábana, ajustable y 2 fundas.",
  });

  assert.ok(prompt.includes("TU PRIMER MENSAJE DE VENTA SALE DE LA DESCRIPCIÓN DEL ANUNCIO"));
  assert.ok(prompt.includes("Ni una línea más"), "sin listas de características");
  assert.ok(prompt.includes("Incluye sábana, ajustable y 2 fundas"), "y con lo que el anuncio dice");
});
