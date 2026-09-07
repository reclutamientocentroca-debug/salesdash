import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais, bloqueDelPais } from "../src/agents";
import {
  avisoDeClienteQueVuelve,
  campoDeLaPregunta,
  clienteCompartioUbicacion,
  esAperturaDeSesion,
  esClienteQueVuelve,
  fichaDelPedido,
  fichaParaModelo,
  inicioDeSesion,
  preguntasRepetidas,
} from "../src/lib/memoria";
import { revisarConReglas, type ContextoRevision } from "../src/lib/revisor";
import { fallasDelResumen, leerResumen } from "../src/lib/supervisor";
import { esClaveDeSistema, esMensajeDeSistema } from "../src/lib/sistema";

/**
 * LA MEMORIA ES UNA PUERTA, NO UN CONSEJO. Y ES DE ESTA COMPRA.
 *
 * Lo que el cliente ya dijo se arma en una ficha sin modelo, va al final del
 * prompt y el revisor para cualquier respuesta que lo vuelva a preguntar. Y
 * solo cuenta la sesión actual: un cliente que vuelve días después empieza
 * otro pedido.
 */
const rd = agenteDePais("do")!;

const hilo = [
  { emisor: "cliente", content: "Hola, vi el anuncio de los mocasines" },
  { emisor: "ia", content: "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.\n\nLos mocasines están en RD$2,500.\n\n¿Qué talla necesita?" },
  { emisor: "cliente", content: "la 42" },
  { emisor: "ia", content: "Perfecto.\n\n¿En qué color, negro o marrón?" },
  { emisor: "cliente", content: "negro" },
  { emisor: "ia", content: "¿A qué dirección se lo enviamos, con el sector y la provincia?" },
  { emisor: "cliente", content: "Calle 3 #12, Los Alcarrizos, Santo Domingo Oeste" },
  { emisor: "ia", content: "El envío a Los Alcarrizos son RD$250.\n\n¿A nombre de quién se lo dejamos?" },
  { emisor: "cliente", content: "Yamil Peña" },
  { emisor: "ia", content: "¿A qué número le llama el mensajero, a este mismo?" },
  { emisor: "cliente", content: "sí, a este" },
];

test("cada pregunta del agente se clasifica por el dato que pide", () => {
  assert.equal(campoDeLaPregunta("¿Qué talla necesita?"), "talla");
  assert.equal(campoDeLaPregunta("¿En qué color lo quiere?"), "color");
  assert.equal(campoDeLaPregunta("¿A qué dirección se lo enviamos?"), "direccion");
  assert.equal(campoDeLaPregunta("¿A nombre de quién se lo dejamos?"), "nombre");
  assert.equal(campoDeLaPregunta("¿A qué número le llama el mensajero, a este mismo?"), "celular");
  assert.equal(campoDeLaPregunta("¿Cuántos lleva?"), "cantidad");
  assert.equal(campoDeLaPregunta("¿Le interesa?"), null);
  // El caso real: «¿Qué número calza?» pregunta la talla, y el «39» es la talla.
  assert.equal(campoDeLaPregunta("¿Qué número calza?"), "talla");
  assert.equal(campoDeLaPregunta("¿Qué número calzas?"), "talla");
  assert.equal(campoDeLaPregunta("¿Qué size necesita?"), "talla");
});

test("un «39» después de «¿qué número calza?» es el número que calza, y no se vuelve a preguntar", () => {
  const f = fichaDelPedido(
    [
      { emisor: "cliente", content: "Necesitas uno" },
      { emisor: "ia", content: "Claro que sí, le vendo los zapatos DCM ESTILO por RD$1,990.\n\n¿Qué número calza?" },
      { emisor: "cliente", content: "Donde tuta" },
      { emisor: "ia", content: "¿Qué número calza?" },
      { emisor: "cliente", content: "39" },
    ],
    rd,
  );
  assert.equal(f.talla, "39");
  assert.ok(preguntasRepetidas("Perfecto. ¿Qué número calza?", f).length > 0, "repetirlo es una falla");
  assert.deepEqual(preguntasRepetidas("¿En qué provincia se encuentra?", f), []);
});

test("la ficha se arma sola con lo que el cliente contestó", () => {
  const f = fichaDelPedido(hilo, rd);
  assert.equal(f.talla, "la 42");
  assert.equal(f.color, "negro");
  assert.match(f.direccion!, /Los Alcarrizos/);
  assert.equal(f.nombre, "Yamil Peña");
  assert.equal(f.celular, "este mismo número");
  assert.equal(f.cantidad, null, "lo que no se dijo queda en blanco");

  // Un «ok» o una pregunta del cliente no es una contestación.
  const parcial = fichaDelPedido(
    [
      { emisor: "ia", content: "¿Qué talla necesita?" },
      { emisor: "cliente", content: "¿y cuánto es el envío?" },
    ],
    rd,
  );
  assert.equal(parcial.talla, null);

  // La dirección y el celular también se reconocen sueltos, sin pregunta delante.
  const suelto = fichaDelPedido(
    [
      { emisor: "cliente", content: "soy de Santiago, me lo manda a la calle del Sol 45" },
      { emisor: "cliente", content: "mi número es 809-555-1234" },
    ],
    rd,
  );
  assert.match(suelto.direccion!, /Santiago/);
  assert.equal(suelto.celular, "8095551234");

  // Y el cliente se puede corregir: manda lo último.
  const corregido = fichaDelPedido([...hilo, { emisor: "ia", content: "¿Cuántos lleva?" }, { emisor: "cliente", content: "mejor la 43, y dos pares" }], rd);
  assert.equal(corregido.cantidad, "mejor la 43, y dos pares");
});

/**
 * EL CASO REAL: «Nombre: Quiero más información sobre el negocio.»
 *
 * Un «¿a nombre de quién?» de otro día se emparejó con el primer mensaje de
 * hoy, y salió en un resumen. Una frase de llegada nunca es un nombre, ni una
 * dirección, ni una talla.
 */
test("una frase de llegada no contesta a ningún dato", () => {
  for (const frase of ["Quiero más información sobre el negocio.", "Hola, quiero información", "precio?", "Buenas, me interesa", "Hola"]) {
    const f = fichaDelPedido(
      [
        { emisor: "ia", content: "¿A nombre de quién se lo dejamos?" },
        { emisor: "cliente", content: frase },
      ],
      rd,
    );
    assert.equal(f.nombre, null, `«${frase}» no es un nombre`);
  }

  // Un nombre son de una a cuatro palabras de letras.
  const largo = fichaDelPedido(
    [
      { emisor: "ia", content: "¿A nombre de quién se lo dejamos?" },
      { emisor: "cliente", content: "a nombre de mi esposo que es el que va a estar en la casa" },
    ],
    rd,
  );
  assert.equal(largo.nombre, null);

  // Y el supervisor y el revisor tampoco se creen una frase como nombre.
  const resumen = leerResumen("Resumen:\n\nNombre: Quiero más información sobre el negocio.\nCel: 8094353930\nProducto: Camisa\nCantidad: 1\nDirección: calle Duarte #70, Brisas del Este, Santo Domingo Este\nCosto de envío: RD$250\nTotal a pagar: RD$1,750");
  assert.ok(fallasDelResumen(resumen).some((f) => f.includes("frase")));
});

/**
 * EL CLIENTE QUE VUELVE. Tres días después, por otro anuncio, es otro pedido:
 * la ficha empieza de cero, se saluda otra vez y no se da por hecho nada.
 */
test("la ficha solo mira la sesión actual: el cliente que vuelve empieza otra compra, con sus datos de siempre", () => {
  const ayer = 1_700_000_000;
  const hoy = ayer + 3 * 24 * 3600;
  const conFechas = hilo.map((m, i) => ({ ...m, created_at: ayer + i * 60 }));
  const vuelve = [
    ...conFechas,
    { emisor: "ia", content: "Resumen:\n\nNombre: Yamil Peña\n...", created_at: ayer + 20 * 60 },
    { emisor: "cliente", content: "Quiero más información sobre el negocio.", created_at: hoy },
  ];

  assert.equal(inicioDeSesion(vuelve), vuelve.length - 1, "la sesión empieza en el mensaje de hoy");
  assert.equal(esClienteQueVuelve(vuelve), true);
  assert.equal(esClienteQueVuelve(conFechas), false, "sin silencio largo, es la misma compra");

  const f = fichaDelPedido(vuelve, rd);
  // Lo de la compra empieza de cero; lo de la persona —nombre, celular, dirección— se hereda (la dueña, 2026-09-05).
  assert.deepEqual(f, {
    talla: null, color: null, cantidad: null,
    direccion: "Calle 3 #12, Los Alcarrizos, Santo Domingo Oeste", nombre: "Yamil Peña", celular: "este mismo número",
  });
  assert.ok(fichaParaModelo(f).includes("- Talla: (falta)"), "la talla de hoy se pregunta");
  assert.ok(fichaParaModelo(f).includes("Nombre con el que recibe: Yamil Peña"), "y el nombre no se vuelve a pedir");
  // Y el «Quiero más información» de hoy nunca es un nombre.
  assert.notEqual(f.nombre, "Quiero más información sobre el negocio.");

  const aviso = avisoDeClienteQueVuelve(vuelve);
  assert.ok(aviso.includes("VUELVE A ESCRIBIR"));
  assert.ok(aviso.includes("salúdalo otra vez"));
  assert.ok(aviso.includes("no le llegó ninguna ubicación hoy"));
  assert.equal(avisoDeClienteQueVuelve(conFechas), "");

  // Sin fechas no hay forma de partir el hilo: se toma entero, como antes.
  assert.equal(fichaDelPedido(hilo, rd).nombre, "Yamil Peña");
});

test("una contestación que llega horas después no contesta a esa pregunta", () => {
  const t0 = 1_700_000_000;
  const f = fichaDelPedido(
    [
      { emisor: "ia", content: "¿A nombre de quién se lo dejamos?", created_at: t0 },
      { emisor: "cliente", content: "Rosa Almonte", created_at: t0 + 8 * 3600 },
    ],
    rd,
  );
  assert.equal(f.nombre, null);
});

test("la ficha le dice al modelo lo que tiene y lo que le falta", () => {
  const texto = fichaParaModelo(fichaDelPedido(hilo.slice(0, 5), rd));
  assert.ok(texto.includes("FICHA DEL PEDIDO"));
  assert.ok(texto.includes("Talla: la 42"));
  assert.ok(texto.includes("Color: negro"));
  assert.ok(texto.includes("Dirección: (falta)"));
  assert.ok(texto.includes("NO lo vuelvas a preguntar"));
  assert.equal(fichaParaModelo(fichaDelPedido([], rd)), "", "sin nada sabido no hay ficha");
});

test("el revisor para la respuesta que vuelve a preguntar lo que ya está en la ficha", () => {
  const ficha = fichaDelPedido(hilo, rd);
  assert.ok(preguntasRepetidas("Perfecto. ¿Qué talla necesita?", ficha).some((f) => f.includes("talla")));
  assert.ok(preguntasRepetidas("¿A qué dirección se lo enviamos?", ficha).some((f) => f.includes("dirección")));
  assert.ok(preguntasRepetidas("¿Me comparte su ubicación?", ficha).some((f) => f.includes("dirección")), "pedir la ubicación es volver a pedir la dirección");
  assert.ok(preguntasRepetidas("¿En qué zona se encuentra?", ficha).some((f) => f.includes("dirección")));
  assert.ok(preguntasRepetidas("¿A nombre de quién se lo dejamos?", ficha).some((f) => f.includes("nombre")));
  // Mencionar el dato sin preguntarlo no es repetir.
  assert.deepEqual(preguntasRepetidas("Listo: mocasines talla 42 en negro para Yamil. ¿Me confirma para levantar el pedido?", ficha), []);
  // Y lo que falta sí se puede preguntar.
  assert.deepEqual(preguntasRepetidas("¿Cuántos lleva?", ficha), []);

  const ctx: ContextoRevision = {
    datos: rd,
    nombresDeLaCasa: ["Orlanda", "RINCON DCM"],
    catalogo: "Catálogo:\n- Mocasines — 2500",
    anuncio: null,
    bloqueDelPais: bloqueDelPais(rd, null, "Tienda"),
    ficha,
  };
  const fallas = revisarConReglas("Con gusto. ¿En qué color lo quiere?", ctx);
  assert.ok(fallas.some((f) => f.includes("color")), "el revisor la rechaza por regla, sin modelo");
  assert.deepEqual(revisarConReglas("Con gusto. ¿Me confirma para levantar el pedido?", ctx), []);
});

test("la ubicación compartida solo cuenta si llegó en esta sesión", () => {
  const t0 = 1_700_000_000;
  const conPin = [
    { emisor: "cliente", content: "[ubicación] Brisas del Este", created_at: t0 },
    { emisor: "cliente", content: "hola otra vez", created_at: t0 + 3 * 24 * 3600 },
  ];
  assert.equal(clienteCompartioUbicacion(conPin), false, "el pin es de otro día");
  assert.equal(clienteCompartioUbicacion(conPin.slice(0, 1)), true);
});

/** Un «[protocolMessage]» es un aviso interno de WhatsApp, no un mensaje del cliente. */
test("los avisos internos de WhatsApp no son mensajes del cliente", () => {
  assert.equal(esClaveDeSistema("protocolMessage"), true);
  assert.equal(esClaveDeSistema("reactionMessage"), true);
  assert.equal(esClaveDeSistema("conversation"), false);
  assert.equal(esMensajeDeSistema("[protocolMessage]"), true);
  assert.equal(esMensajeDeSistema("[imagen]"), false, "una imagen sí es del cliente");
  assert.equal(esMensajeDeSistema("hola"), false);
});

/** «¿Envían a Las Matas de Farfán?» pregunta por el envío; no es la dirección del cliente. */
test("una pregunta con un lugar dentro no se toma como la dirección", () => {
  const f = fichaDelPedido([{ emisor: "cliente", content: "Envían a las matas de Farfán ?" }], rd);
  assert.equal(f.direccion, null);
  const dada = fichaDelPedido([{ emisor: "cliente", content: "Estoy en Las Matas de Farfán, calle Duarte 12" }], rd);
  assert.match(dada.direccion!, /Farfán/);
});

/**
 * EL CASO REAL (la dueña, 2026-09-05): el cliente escribió «829-812-7158» a
 * «¿Me facilita su número de teléfono para el pedido?», y al día siguiente el
 * agente se lo volvió a pedir. La pregunta se reconoce como la del celular, el
 * número queda en la ficha, repetirla es una falla, y el celular se hereda de
 * la sesión anterior.
 */
test("el teléfono que el cliente dio no se vuelve a pedir, ni al día siguiente", () => {
  assert.equal(campoDeLaPregunta("¿Me facilita su número de teléfono para el pedido?"), "celular");
  assert.equal(campoDeLaPregunta("¿Me da su celular?"), "celular");

  const ayer = 1_700_000_000;
  const hoy = ayer + 20 * 3600; // veinte horas después: otra sesión
  const hilo = [
    { emisor: "cliente", content: "Me lo traen hasta aquí?", created_at: ayer },
    { emisor: "ia", content: "Sí, le enviamos a domicilio en todo el país. ¿Me facilita su número de teléfono para el pedido?", created_at: ayer + 60 },
    { emisor: "cliente", content: "829-812-7158", created_at: ayer + 120 },
    { emisor: "ia", content: "¿A nombre de quién sale el pedido?", created_at: ayer + 180 },
    { emisor: "cliente", content: "Jorgelina Taveras", created_at: ayer + 240 },
    { emisor: "cliente", content: "Me enviará ?", created_at: hoy },
  ];
  const f = fichaDelPedido(hilo, rd);
  assert.equal(f.celular, "8298127158", "el celular de ayer sigue siendo el suyo");
  assert.equal(f.nombre, "Jorgelina Taveras", "y el nombre también");
  assert.ok(preguntasRepetidas("Perfecto. ¿Me facilita su número de teléfono para el pedido?", f).length > 0, "volver a pedirlo es una falla");

  // Lo de la compra —talla, color, cantidad— sí empieza de cero en la sesión nueva.
  const conTalla = fichaDelPedido([
    { emisor: "ia", content: "¿Qué talla le interesa?", created_at: ayer },
    { emisor: "cliente", content: "M", created_at: ayer + 60 },
    { emisor: "cliente", content: "hola, otra cosa", created_at: hoy },
  ], rd);
  assert.equal(conTalla.talla, null);
});

test("la ficha nunca dice que falta la cantidad: es una unidad salvo que el cliente diga otra", () => {
  const texto = fichaParaModelo({ talla: "M", color: null, direccion: null, nombre: null, celular: null, cantidad: null });
  assert.ok(texto.includes("- Cantidad: 1 (no se pregunta"));
  assert.ok(!texto.includes("Cantidad: (falta)"));
  const dos = fichaParaModelo({ talla: "M", color: null, direccion: null, nombre: null, celular: null, cantidad: "2" });
  assert.ok(dos.includes("- Cantidad: 2"));
});

/**
 * LA CAPTURA DE COSTA RICA (2026-09-05): una persona del equipo preguntó
 * «¿Me confirma qué talla y color le interesa?», el cliente contestó «Soy
 * talla 34» / «De pantalón» al día siguiente, y el agente saludó y presentó
 * el producto TRES veces seguidas sin tomar la talla.
 */
test("la apertura es un momento de la sesión, no un estado: se saluda una vez y ya", () => {
  const ayer = 1_700_000_000;
  const hoy = ayer + 20 * 3600;
  const hilo = [
    { emisor: "cliente", content: "Hola, vi la faja", created_at: ayer },
    { emisor: "humano", content: "Hola", created_at: ayer + 60 },
    { emisor: "humano", content: "¿Me confirma qué talla y color le interesa para ese cinturón?", created_at: ayer + 90 },
    { emisor: "cliente", content: "Soy  talla 34", created_at: hoy },
    { emisor: "cliente", content: "De pantalón", created_at: hoy + 30 },
  ];
  assert.equal(esClienteQueVuelve(hilo), true);
  assert.equal(esAperturaDeSesion(hilo), true, "nadie de la casa ha contestado en esta sesión");
  assert.ok(avisoDeClienteQueVuelve(hilo).includes("salúdalo otra vez"));

  const contestado = [...hilo, { emisor: "ia", content: "Hola! Bienvenido(a) a TELLERIA. Gracias por escribirnos.\n🖤 FAJA REVERSIBLE 🖤\n₡9,000\nIndique su dirección exacta de entrega.", created_at: hoy + 60 }, { emisor: "cliente", content: "Me imagino que es la misma talla", created_at: hoy + 120 }];
  assert.equal(esAperturaDeSesion(contestado), false, "ya se le contestó: el saludo pasó");
  assert.ok(avisoDeClienteQueVuelve(contestado).includes("no vuelvas a saludar"));
  assert.ok(!avisoDeClienteQueVuelve(contestado).includes("salúdalo otra vez"));

  // Y una persona del equipo contestando también cierra la apertura.
  const conHumano = [
    { emisor: "cliente", content: "Precio", created_at: hoy },
    { emisor: "humano", content: "Buenas, ¿qué talla?", created_at: hoy + 10 },
    { emisor: "cliente", content: "M", created_at: hoy + 20 },
  ];
  assert.equal(esAperturaDeSesion(conHumano), false);
});

test("«Soy talla 34» se toma como la talla aunque la pregunta la hiciera una persona del equipo, o nadie", () => {
  const t = 1_700_000_000;
  const conPregunta = fichaDelPedido([
    { emisor: "humano", content: "¿Me confirma qué talla y color le interesa para ese cinturón?", created_at: t },
    { emisor: "cliente", content: "Soy  talla 34", created_at: t + 60 },
  ], rd);
  assert.equal(conPregunta.talla, "34");

  const sinPregunta = fichaDelPedido([
    { emisor: "cliente", content: "Hola, quiero la faja, uso la 36", created_at: t },
  ], rd);
  assert.equal(sinPregunta.talla, "36");
  assert.equal(fichaDelPedido([{ emisor: "cliente", content: "talla M por favor", created_at: t }], rd).talla, "M");
  // Una pregunta del cliente sobre tallas no es su talla.
  assert.equal(fichaDelPedido([{ emisor: "cliente", content: "¿Tienen talla 44?", created_at: t }], rd).talla, null);
  // Y el cliente que dio la talla no la vuelve a oír.
  assert.ok(preguntasRepetidas("¿Qué talla le interesa?", conPregunta).length > 0);
});
