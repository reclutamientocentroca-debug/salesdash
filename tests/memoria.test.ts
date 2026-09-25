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
const cr = agenteDePais("cr")!;

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

/**
 * EL DATO SE NOMBRA ANTES DE LA PREGUNTA, Y AQUÍ TAMBIÉN CUENTA.
 *
 * El caso real (RD): «Para enviárselo necesito su talla. ¿Cuál le interesa?»
 * — el cliente contestó «XXL», y dos turnos después, ya pidiendo una docena,
 * el agente le volvió a preguntar la talla. La pregunta que se aísla es solo
 * «¿Cuál le interesa?», que sola no nombra ningún dato: la palabra «talla»
 * está en la frase de ANTES, y se perdía.
 */
test("«Necesito su talla. ¿Cuál le interesa?» también guarda la talla, aunque la pregunta sola no la nombre", () => {
  const f = fichaDelPedido(
    [
      { emisor: "ia", content: "Para enviárselo necesito su talla. ¿Cuál le interesa?" },
      { emisor: "cliente", content: "XXL" },
      { emisor: "cliente", content: "Te voy a comprar 1 docena para probar y luego voy a comprar más y pantalones" },
    ],
    rd,
  );
  assert.equal(f.talla, "XXL");
  assert.equal(f.cantidad, "12");
  assert.ok(preguntasRepetidas("¿Qué talla le interesa?", f).some((x) => x.includes("talla")));
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

  /*
   * Lo que el cliente ADELANTA sin que se lo pregunten solo entra cuando lo
   * dice con todas las letras. Un «M» o un «negro» pelados, sin pregunta
   * delante, son cualquier cosa: en Costa Rica «casa verde» es una seña de la
   * dirección, no el color del artículo.
   */
  const espontaneo = fichaDelPedido(
    [
      { emisor: "cliente", content: "quiero talla M" },
      { emisor: "cliente", content: "200 metros norte de la iglesia, casa verde" },
    ],
    rd,
  );
  assert.equal(espontaneo.talla, "M");
  assert.equal(espontaneo.color, null, "el color de la casa no es el color del pedido");

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
  assert.ok(fallasDelResumen(resumen).some((f) => f.includes("no es el nombre de una persona")));
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

/**
 * EL QUE CONTESTA TARDE NO ES UN CLIENTE QUE VUELVE: ES EL QUE TERMINA DE
 * CONTESTAR. El caso real de República Dominicana: se le preguntó la talla,
 * escribió «XXL» al día siguiente y, como habían pasado más de doce horas, el
 * hilo empezó de cero: la talla se perdió y le llegó el saludo entero por
 * segunda vez, palabra por palabra.
 */
test("la contestación tardía a la pregunta pendiente sigue la venta, no la empieza de nuevo", () => {
  const t0 = 1_700_000_000;
  const hilo = [
    { emisor: "cliente", content: "Hola, quiero información", created_at: t0 },
    { emisor: "ia", content: "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.\n🖤 POLOS BRONX ORIGINALES 🖤\nRD$1,400\n¿Qué talla le interesa?", created_at: t0 + 60 },
    { emisor: "cliente", content: "XXL", created_at: t0 + 60 + 14 * 3600 },
  ];
  assert.equal(inicioDeSesion(hilo), 0, "contestar no abre otra sesión, por tarde que sea");
  assert.equal(esClienteQueVuelve(hilo), false, "y por eso no se le vuelve a saludar");
  assert.equal(fichaDelPedido(hilo, rd).talla, "XXL", "la talla que dio es suya");
  assert.equal(avisoDeClienteQueVuelve(hilo), "");

  // Lo mismo con el nombre: se lo pidieron y lo escribió, tarde pero lo escribió.
  const nombre = fichaDelPedido(
    [
      { emisor: "ia", content: "¿A nombre de quién se lo dejamos?", created_at: t0 },
      { emisor: "cliente", content: "Rosa Almonte", created_at: t0 + 8 * 3600 },
    ],
    rd,
  );
  assert.equal(nombre.nombre, "Rosa Almonte");

  // Pero una contestación con otras cosas en medio ya no contesta a eso.
  const enMedio = fichaDelPedido(
    [
      { emisor: "ia", content: "¿A nombre de quién se lo dejamos?", created_at: t0 },
      { emisor: "ia", content: "Seguimos por aquí cuando pueda.", created_at: t0 + 3 * 3600 },
      { emisor: "cliente", content: "Rosa Almonte", created_at: t0 + 8 * 3600 },
    ],
    rd,
  );
  assert.equal(enMedio.nombre, null);

  // Y el que vuelve de verdad —escribe otra cosa, no una contestación— sí abre otra compra.
  const vuelve = [
    ...hilo,
    { emisor: "ia", content: "Indíquenos su dirección.", created_at: t0 + 60 + 14 * 3600 + 60 },
    { emisor: "cliente", content: "Hola, quiero información de otro artículo", created_at: t0 + 4 * 24 * 3600 },
  ];
  assert.equal(esClienteQueVuelve(vuelve), true);
  assert.equal(fichaDelPedido(vuelve, rd).talla, null, "la talla es de la compra de aquel día");

  /*
   * Y LA APERTURA ES UNA POR SESIÓN. El segundo caso real: el cliente volvió,
   * se le saludó, se le mandó la foto del anuncio, contestó qué colores quería
   * y le llegó otra vez la bienvenida entera. «Vuelve el cliente» valía para
   * todo el día; lo que decide si se saluda es si el agente ya escribió hoy.
   */
  assert.equal(esAperturaDeSesion(vuelve), true, "el agente todavía no ha escrito hoy");
  const contestado = [
    ...vuelve,
    { emisor: "ia", content: "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.\n🖤 POLOS BRONX ORIGINALES 🖤\nRD$1,400\n¿Qué talla le interesa?", created_at: t0 + 4 * 24 * 3600 + 60 },
    { emisor: "ia", content: "[imagen]", created_at: t0 + 4 * 24 * 3600 + 200 },
    { emisor: "cliente", content: "Azul claro y oscuro", created_at: t0 + 4 * 24 * 3600 + 260 },
  ];
  assert.equal(esClienteQueVuelve(contestado), true, "sigue siendo la sesión de un cliente que volvió");
  assert.equal(esAperturaDeSesion(contestado), false, "pero la apertura ya está dada, aunque en medio fuera una foto");
  assert.ok(
    avisoDeClienteQueVuelve(contestado).includes("no vuelvas a saludar"),
    "y al modelo se le dice que no vuelva a saludar",
  );
});

/**
 * EL CASO REAL: se le preguntó la talla, el cliente mandó una nota de voz que
 * no se entendía y «[audio ininteligible]» se guardó COMO SU TALLA. El agente
 * leyó la ficha y le contestó «Perfecto, ya me llegó su talla. ¿Qué color
 * prefiere?». Lo que no se pudo leer es un hueco, no un dato.
 */
test("lo que el cliente no llegó a escribir no entra en la ficha", () => {
  const t0 = 1_700_000_000;
  for (const marcador of ["[audio ininteligible]", "[nota de voz]", "[imagen]", "[imagen sin describir]"]) {
    const f = fichaDelPedido(
      [
        { emisor: "ia", content: "¿Qué talla le interesa?", created_at: t0 },
        { emisor: "cliente", content: marcador, created_at: t0 + 60 },
      ],
      rd,
    );
    assert.equal(f.talla, null, `«${marcador}» no es una talla`);
  }

  // Y una nota de voz que sí se entendió vale como cualquier mensaje escrito.
  const oida = fichaDelPedido(
    [
      { emisor: "ia", content: "¿Qué talla le interesa?", created_at: t0 },
      { emisor: "cliente", content: "(nota de voz) XXL", created_at: t0 + 60 },
    ],
    rd,
  );
  assert.equal(oida.talla, "(nota de voz) XXL");
});

test("dos mensajes seguidos del cliente conservan la talla y no reabren la venta", () => {
  const t0 = 1_700_000_000;
  const mensajes = [
    { emisor: "cliente", content: "Hola", created_at: t0 },
    { emisor: "ia", content: "Hola! Bienvenido(a) a TELLERIA. ¿Qué talla le interesa?", created_at: t0 + 10 },
    { emisor: "cliente", content: "Soy talla 34", created_at: t0 + 20 },
    { emisor: "cliente", content: "De pantalón", created_at: t0 + 21 },
  ];
  const ficha = fichaDelPedido(mensajes, cr);
  assert.equal(ficha.talla, "34", "se guarda la talla, no la frase entera");
  assert.equal(esAperturaDeSesion(mensajes), false);
});

/**
 * EL PEDIDO QUE SE REGISTRÓ Y NO ERA EL DEL CLIENTE (2026-09-07):
 *
 *   Direccion: Si yo.le escomprado
 *   Color: Para cuando
 *
 * Las dos las escribió el cliente, pero ninguna contesta lo que se le
 * preguntó. Un dato del pedido tiene que ser dos cosas a la vez: dicho por él
 * Y parecerse a ese dato. Lo que no, se vuelve a preguntar.
 */
test("una frase suelta no es una dirección, ni un color, ni una talla", () => {
  const t0 = 1_700_000_000;
  const contesta = (pregunta: string, respuesta: string) =>
    fichaDelPedido(
      [
        { emisor: "ia", content: pregunta, created_at: t0 },
        { emisor: "cliente", content: respuesta, created_at: t0 + 60 },
      ],
      rd,
    );

  assert.equal(contesta("Indíquenos su dirección.", "Si yo.le escomprado").direccion, null);
  assert.equal(contesta("¿Qué color le interesa?", "Para cuando").color, null);
  assert.equal(contesta("¿Qué talla le interesa?", "Para cuando").talla, null);
  assert.equal(contesta("¿A nombre de quién sale el pedido?", "Si yo.le escomprado").nombre, null);

  // Y lo que sí es el dato, sigue entrando.
  assert.equal(contesta("Indíquenos su dirección.", "Calle Duarte #70, Brisas del Este").direccion, "Calle Duarte #70, Brisas del Este");
  assert.equal(contesta("Indíquenos su dirección.", "Los Alcarrizos").direccion, "Los Alcarrizos", "un sector del país es una dirección");
  assert.equal(contesta("¿Qué color le interesa?", "negro").color, "negro");
  assert.equal(contesta("¿Qué color le interesa?", "el chocolate").color, "el chocolate");
  assert.equal(contesta("¿Qué talla le interesa?", "la 42").talla, "la 42");
  assert.equal(contesta("¿Qué talla le interesa?", "XXL").talla, "XXL");
  assert.equal(contesta("¿A nombre de quién sale el pedido?", "Cecilio Tavare").nombre, "Cecilio Tavare");
});

/**
 * EL NOMBRE DEL PEDIDO ES EL DE UNA PERSONA, y lo da el cliente. No es
 * cualquier cosa que escriba mientras se lo preguntan: en esa línea va quien
 * recibe el paquete y firma. Se lee como lo leería una persona.
 */
test("el nombre del pedido es un nombre de persona, no lo que sea que el cliente escriba", () => {
  const nombre = (respuesta: string) =>
    fichaDelPedido(
      [
        { emisor: "ia", content: "¿A nombre de quién sale el pedido?" },
        { emisor: "cliente", content: respuesta },
      ],
      rd,
    ).nombre;

  // Nombres de aquí, con sus apellidos y sus partículas.
  assert.equal(nombre("Cecilio Tavare"), "Cecilio Tavare");
  assert.equal(nombre("Rosa Almonte"), "Rosa Almonte", "un color también es nombre de pila");
  assert.equal(nombre("María del Carmen Rodríguez"), "María del Carmen Rodríguez");
  assert.equal(nombre("Ana"), "Ana");
  assert.equal(nombre("me llamo Pedro Sabater"), "Pedro Sabater", "se guarda el nombre, no la frase");

  // Y lo que no es una persona, no entra: se vuelve a preguntar.
  for (const no of [
    "Si yo.le escomprado", "Para cuando", "Zapatos negros", "Los Alcarrizos", "Villa Mella",
    "mi casa", "a este mismo", "el de siempre", "señora", "mañana", "8295193109",
  ]) {
    assert.equal(nombre(no), null, `«${no}» no es el nombre de una persona`);
  }

  // Y el supervisor tampoco se lo cree en un resumen ya mandado.
  const conLugar = leerResumen("Resumen:\n\nNombre: Los Alcarrizos\nCel: 8094353930\nProducto: Camisa\nDirección: calle Duarte #70, Brisas del Este\nTotal a pagar: RD$1,750");
  assert.ok(fallasDelResumen(conLugar, [], rd).some((f) => f.includes("no es el nombre de una persona")));
});

/**
 * «PURA VIDA» NO ES UN NOMBRE (Costa Rica, 2026-09-07).
 *
 * El caso real: «¿A nombre de quién sale el pedido?» → «Pura vida», y el
 * pedido salió a nombre de Pura vida. Aquí eso es hola, gracias y adiós a la
 * vez, así que el cliente lo escribe en cualquier turno, también cuando le
 * preguntan cómo se llama. Y con ella «mae», «diay», «tuanis», «ocupo».
 *
 * La lista no se escribe aquí: son las expresiones que cada país ya trae en
 * su archivo, entre comillas, que es donde el dueño las edita.
 */
test("un saludo tico no es el nombre del cliente, y cada país descarta los suyos", () => {
  const nombre = (respuesta: string, d = cr) =>
    fichaDelPedido(
      [
        { emisor: "ia", content: "¿A nombre de quién sale el pedido?" },
        { emisor: "cliente", content: respuesta },
      ],
      d,
    ).nombre;

  for (const saludo of ["Pura vida", "pura vida", "Mae", "Diay", "Tuanis", "Ocupo", "Bendiciones", "Saludos", "Igualmente", "Correcto"]) {
    assert.equal(nombre(saludo), null, `«${saludo}» es cortesía tica, no la persona que recibe el paquete`);
  }

  // Las de cada país son las de SU archivo: en RD «a la orden» y «ahorita».
  for (const dominicana of ["A la orden", "Ahorita", "Chequea", "Dime"]) {
    assert.equal(nombre(dominicana, rd), null, `«${dominicana}» se dice en RD y no es un nombre`);
  }

  // Y los nombres ticos de verdad siguen entrando a la primera.
  for (const persona of ["Yorlenny Chacón", "Kimberly Vargas", "José Pablo Solís", "Ana"]) {
    assert.equal(nombre(persona), persona, `«${persona}» sí es una persona`);
  }

  // El supervisor tampoco se cree un resumen ya mandado a nombre de un saludo.
  const conSaludo = leerResumen(
    "Resumen:\n\nNombre: Pura vida\nCel: 71234567\nProducto: Combo 2 en 1\nDirección: Alajuela centro, 200 m norte de la iglesia\nTotal a pagar: ₡15.000",
  );
  assert.ok(
    fallasDelResumen(conSaludo, [], cr).some((f) => f.includes("no es el nombre de una persona")),
    "un pedido a nombre de «Pura vida» no se manda",
  );
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

/**
 * EL PIN DEL MAPA ES LA DIRECCIÓN, Y NO SE VUELVE A PEDIR.
 *
 * El caso real (RD): «¿Cuál sería su dirección exacta de entrega?» → el cliente
 * mandó su ubicación —Avenida Rómulo Betancourt, Renacimiento, Santo Domingo—
 * y el agente le contestó «Indíquenos su dirección.». Dos
 * agujeros a la vez: la ficha solo se quedaba con el pin cuando su texto
 * nombraba una zona del catálogo de envíos, y el freno de las preguntas
 * repetidas buscaba signos de interrogación —esa frase no lleva ninguno—.
 */
test("la ubicación que manda el cliente es su dirección, y no se le vuelve a pedir", () => {
  const pin = "[ubicación] Avenida Rómulo Betancourt, Renacimiento, Santo Domingo de Guzmán, Distrito Nacional";
  const conPin = [
    { emisor: "ia", content: "¡Quedan pocos POLOS BROTEX ORIGINALES en inventario! ¿Cuál sería su dirección exacta de entrega?" },
    { emisor: "cliente", content: pin },
  ];

  const ficha = fichaDelPedido(conPin, rd);
  assert.equal(
    ficha.direccion,
    "Avenida Rómulo Betancourt, Renacimiento, Santo Domingo de Guzmán, Distrito Nacional",
    "la dirección del pin, y sin la marca: la ficha la lee el modelo y la escribe en el resumen",
  );

  // La frase del guion no lleva signos de interrogación, y es la que salió.
  for (const repite of [
    "Indíquenos su dirección.",
    "Indique su dirección exacta de entrega.",
    "Indíqueme su dirección exacta de entrega.",
    "Por favor indique la dirección exacta de entrega",
    "Necesito su dirección exacta para el envío",
  ]) {
    assert.ok(
      preguntasRepetidas(repite, ficha).some((f) => f.includes("dirección")),
      `se para «${repite}»`,
    );
  }

  // Y decir la dirección no es pedirla: el resumen la escribe en cada venta.
  assert.deepEqual(
    preguntasRepetidas("Direccion: Avenida Rómulo Betancourt\nTOTAL A PAGAR: RD$1,940", ficha),
    [],
  );

  /*
   * Un pin sin nada legible —ni el mapa ni WhatsApp devolvieron calle— no deja
   * dirección escrita: no hay nada que escribir. Pero el cliente contestó, y
   * eso se sabe por otro camino.
   */
  const soloPin = [{ emisor: "cliente", content: "[ubicación]" }];
  assert.equal(fichaDelPedido(soloPin, rd).direccion, null);
  assert.equal(clienteCompartioUbicacion(soloPin), true);
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
 * DOS COLORES SON DOS UNIDADES (la dueña, RD, 2026-09-07). La ficha decía
 * «Cantidad: 1» delante de un cliente que había pedido «rojo y azul», y el
 * resumen salió con el precio de un solo polo.
 */
test("en República Dominicana la ficha cuenta una unidad por cada color que nombró el cliente", () => {
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

  const dos = fichaParaModelo({ ...vacia, talla: "XL", color: "rojo y azul" }, "do");
  assert.ok(dos.includes("- Cantidad: 2 (el cliente nombró 2 colores"), dos);
  assert.ok(dos.includes("el precio × 2 más el envío, que va una sola vez"));

  // El color se le cuela en la línea de la talla: «Talla: Rojo y azul XL».
  assert.ok(fichaParaModelo({ ...vacia, talla: "Rojo y azul XL" }, "do").includes("- Cantidad: 2"));

  // Un color solo —o el mismo con otra terminación— sigue siendo una unidad.
  assert.ok(fichaParaModelo({ ...vacia, talla: "XL", color: "rojo" }, "do").includes("- Cantidad: 1 (no se pregunta"));
  assert.ok(fichaParaModelo({ ...vacia, color: "negro, negra" }, "do").includes("- Cantidad: 1 (no se pregunta"));

  // Tres colores, tres unidades: ahí ya entra el por mayor.
  assert.ok(fichaParaModelo({ ...vacia, color: "rojo, azul y negro" }, "do").includes("- Cantidad: 3"));

  // Y lo que el cliente sí dijo como cantidad manda sobre los colores.
  assert.ok(fichaParaModelo({ ...vacia, color: "rojo y azul", cantidad: "4" }, "do").includes("- Cantidad: 4"));
});

/**
 * ═══ COSTA RICA TIENE MEMORIA (la dueña, 2026-09-08) ═══
 *
 * EL CASO REAL, y el que hacía que el agente tico preguntara siempre lo mismo:
 * media guía telefónica de Costa Rica es también el mapa del país. Jiménez,
 * Acosta, Mora, Alvarado, Flores, Osa, Corredores y Grecia son cantones, y la
 * ficha rechazaba «María Jiménez» como nombre porque «reconocía un lugar»
 * dentro. El cliente daba su nombre, la ficha lo tiraba, y el agente se lo
 * volvía a pedir —y al día siguiente empezaba de cero con el saludo entero—.
 *
 * Un apellido que además es un cantón no convierte a una persona en un lugar:
 * lo que no es un nombre es el texto que ES el lugar y nada más.
 */
test("un apellido que también es un cantón sigue siendo el nombre del cliente", () => {
  const nombre = (respuesta: string, d = cr) =>
    fichaDelPedido(
      [
        { emisor: "ia", content: "¿A nombre de quién sale el pedido?" },
        { emisor: "cliente", content: respuesta },
      ],
      d,
    ).nombre;

  // Costa Rica: todos estos apellidos son cantones o distritos del país.
  for (const persona of ["María Jiménez", "Carlos Acosta", "Ana Mora", "José Alvarado", "Laura Flores", "Steven Palmares"]) {
    assert.equal(nombre(persona), persona, `«${persona}» es una persona, no un cantón`);
  }
  // República Dominicana, lo mismo: Duarte y Santiago son apellidos de aquí.
  assert.equal(nombre("Juan Duarte", rd), "Juan Duarte");
  assert.equal(nombre("María Santiago", rd), "María Santiago");

  // Y el sitio a secas sigue sin ser una persona: eso se vuelve a preguntar.
  assert.equal(nombre("Villa Mella", rd), null);
  assert.equal(nombre("Los Alcarrizos", rd), null);
  assert.equal(nombre("Vázquez de Coronado"), null);
});

/**
 * EN COSTA RICA LA DIRECCIÓN LLEVA EL COLOR DE LA CASA DENTRO.
 *
 * Aquí no hay calle ni número: se dan señas desde un punto conocido, y una de
 * las señas de siempre es el color —«200 metros norte de la iglesia, casa
 * verde»—. La ficha guardaba esa dirección entera COMO EL COLOR del artículo,
 * y después «María Jiménez» pisaba la dirección porque Jiménez es un cantón.
 * Lo que contesta a una pregunta es de esa pregunta y de ninguna otra.
 */
test("en Costa Rica la dirección con señas no se lee como el color del pedido", () => {
  const t0 = 1_700_000_000;
  let n = 0;
  const m = (emisor: string, content: string) => ({ emisor, content, created_at: t0 + (n += 1) * 60 });

  const ficha = fichaDelPedido(
    [
      m("cliente", "Hola, quiero información"),
      m("ia", "Hola, le asiste Mildred, un gusto.\n🖤 Cepillo secador 🖤\n₡12.500\nIndique su dirección exacta de entrega."),
      m("cliente", "Vivo en Alajuela, 200 metros norte de la iglesia, casa verde"),
      m("ia", "Perfecto, hasta Alajuela se lo llevamos a domicilio. El envío es ₡3.500 y paga al recibir.\n¿Me facilita su número de teléfono para el pedido?"),
      m("cliente", "8888 8888"),
      m("ia", "¿A nombre de quién sale el pedido?"),
      m("cliente", "María Jiménez"),
    ],
    cr,
  );

  assert.equal(ficha.color, null, "«casa verde» es una seña de la dirección, no el color del artículo");
  assert.match(ficha.direccion!, /200 metros norte de la iglesia/, "la dirección es la que él escribió");
  assert.equal(ficha.nombre, "María Jiménez");
  assert.equal(ficha.celular, "88888888");

  // Con todo eso en la ficha, ninguno de esos datos se vuelve a preguntar.
  assert.ok(preguntasRepetidas("¿Qué color le interesa?", ficha).length === 0, "el color no se sabe: ese sí se pregunta");
  assert.ok(preguntasRepetidas("¿A nombre de quién sale el pedido?", ficha).some((f) => f.includes("nombre")));
  assert.ok(preguntasRepetidas("¿Cuál es su dirección exacta?", ficha).some((f) => f.includes("dirección")));
  assert.ok(preguntasRepetidas("¿Me facilita su número de teléfono para el pedido?", ficha).some((f) => f.includes("celular")));
});

/**
 * LAS SEÑAS DE AQUÍ SON UNA DIRECCIÓN. Sin la pulpería, el portón y los
 * «200 metros norte», una dirección tica no se reconocía como tal y se volvía
 * a pedir: en Costa Rica no hay calle y número que pedir.
 */
test("una dirección de Costa Rica dada por señas se guarda como dirección", () => {
  const direccion = (respuesta: string) =>
    fichaDelPedido(
      [
        { emisor: "ia", content: "Indique su dirección exacta de entrega." },
        { emisor: "cliente", content: respuesta },
      ],
      cr,
    ).direccion;

  for (const seña of [
    "De la pulpería La Esquina, 100 metros sur, portón verde",
    "Contiguo al EBAIS, casa de tapia blanca",
    "Diagonal a la cancha, tercera casa a mano derecha",
    "Frente al rótulo grande, dos cuadras al oeste",
  ]) {
    assert.equal(direccion(seña), seña, `«${seña}» es una dirección de aquí`);
  }
});
