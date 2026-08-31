import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { armarSistema, revisarAgente } from "../src/lib/agent";
import { conLoVistoYOido, percibir } from "../src/lib/percepcion";
import { PAISES, bloqueDePais, obtenerPais, paisDeTelefono } from "../src/lib/paises";
import {
  enlaceDeMapa,
  textoDeUbicacion,
  ubicacionParaModelo,
  validarUbicacion,
} from "../src/lib/ubicacion";

/**
 * UN AGENTE POR CANAL, Y CADA UNO EN SU PAÍS.
 *
 * El mismo negocio atiende República Dominicana, Costa Rica y Panamá desde tres
 * números. Lo que se prueba aquí es que de verdad son tres vendedores y no tres
 * copias del mismo: que cada uno lleva su moneda y su forma de dar una
 * dirección al prompt, que lo que se le cambia a uno no se le cambia a los
 * otros, y que ninguno se queda sin el guion que ya estaba escrito.
 *
 * Ninguna de estas pruebas toca la red: todo son lecturas de la base y armado
 * de texto.
 */

const { orgId } = D.crearOrgConDueno({
  negocio: "Tres Países",
  color: "#12876a",
  nombre: "Dueño",
  email: "canales@prueba.com",
  passwordHash: "hash",
});

const canal = (nombre: string, phone: string) =>
  D.crearCanal(orgId, {
    nombre,
    phone,
    tokenCifrado: "x",
    webhookSecret: "s",
    whapiChannelId: null,
    estado: "conectado",
  });

const rd = canal("Santo Domingo", "18092220001");
const cr = canal("San José", "50622220002");
const pa = canal("Panamá", "50722220003");

// ── Cada canal tiene su agente ──────────────────────────────────────────────

/**
 * El guion de venta es lo que más trabajo cuesta escribir de todo el panel.
 * Conectar el segundo número y encontrarse el cuadro vacío es la diferencia
 * entre encender un canal en un minuto y no encenderlo nunca.
 */
test("un agente nuevo nace copiado de la plantilla de la cuenta, no en blanco", () => {
  D.actualizarAgente(orgId, {
    nombre: "Bella",
    instrucciones: "No damos descuentos por debajo de 3 unidades.",
  });

  const suyo = D.obtenerAgente(orgId, rd);

  assert.equal(suyo.canal_id, rd);
  assert.equal(suyo.nombre, "Bella");
  assert.equal(
    suyo.instrucciones,
    "No damos descuentos por debajo de 3 unidades.",
    "el guion de la cuenta viaja al canal nuevo",
  );
});

test("lo que se le cambia a un canal no se le cambia a los demás", () => {
  D.actualizarAgente(orgId, { pais: "do", nombre: "Yaris" }, rd);
  D.actualizarAgente(orgId, { pais: "cr", nombre: "Marce" }, cr);
  D.actualizarAgente(orgId, { pais: "pa", nombre: "Lissy" }, pa);

  assert.equal(D.obtenerAgente(orgId, rd).pais, "do");
  assert.equal(D.obtenerAgente(orgId, cr).pais, "cr");
  assert.equal(D.obtenerAgente(orgId, pa).pais, "pa");

  assert.equal(D.obtenerAgente(orgId, rd).nombre, "Yaris");
  assert.equal(D.obtenerAgente(orgId, cr).nombre, "Marce");

  // Y la plantilla de la cuenta sigue como estaba: de ella nacen los que vengan.
  assert.equal(D.obtenerAgente(orgId).nombre, "Bella");
  assert.equal(D.obtenerAgente(orgId).pais, "");
});

test("al borrar un canal se va su agente, y la plantilla se queda", () => {
  const temporal = canal("De prueba", "50722229999");
  D.actualizarAgente(orgId, { nombre: "Efímera" }, temporal);
  assert.equal(D.listarAgentes(orgId).some((a) => a.canal_id === temporal), true);

  D.eliminarCanal(orgId, temporal);

  assert.equal(D.listarAgentes(orgId).some((a) => a.canal_id === temporal), false);
  assert.equal(D.obtenerAgente(orgId).nombre, "Bella", "la plantilla no se toca");
});

/**
 * Las dos averías silenciosas: un canal sin país y un canal sin nada que
 * vender. Las dos dejan al agente contestando —parece que funciona— y las dos
 * arruinan la conversación en cuanto el cliente pregunta un precio o da una
 * dirección. No apagan nada, así que son avisos y no impedimentos.
 */
test("el panel avisa del canal sin país y del que no tiene de dónde cotizar", () => {
  /*
   * Un número del que NO se puede deducir el país, que desde que el prefijo lo
   * rellena solo es la única forma de quedarse sin él: un +34 no es ninguno de
   * los tres países que este panel sabe atender.
   */
  const suelto = canal("Sin configurar", "34600222888");
  D.actualizarCanal(orgId, suelto, { agente_activo: 1, contesta_ia: 0 });
  assert.equal(D.obtenerAgente(orgId, suelto).pais, "", "de este número no se deduce nada");

  const antes = revisarAgente(orgId, suelto);
  assert.ok(antes.avisos.some((a) => a.includes("no tiene país")));
  assert.ok(antes.avisos.some((a) => a.includes("no tiene de dónde sacar precios")));

  D.actualizarAgente(orgId, { pais: "pa", conocimiento: "Camisas — B/. 25" }, suelto);

  const despues = revisarAgente(orgId, suelto);
  assert.equal(despues.avisos.some((a) => a.includes("no tiene país")), false);
  assert.equal(despues.avisos.some((a) => a.includes("sacar precios")), false);

  D.eliminarCanal(orgId, suelto);
});

// ── El país sale del propio número ──────────────────────────────────────────

/**
 * El teléfono del canal YA DICE en qué país vende. Preguntárselo al dueño es
 * hacerle escribir un dato que tenemos delante, y es justo el campo que se
 * queda sin rellenar —con el agente hablando en neutro— porque nadie ve que
 * falta.
 */
test("el país se deduce del prefijo del número", () => {
  assert.equal(paisDeTelefono("18095551234")?.codigo, "do");
  assert.equal(paisDeTelefono("18295551234")?.codigo, "do");
  assert.equal(paisDeTelefono("18495551234")?.codigo, "do");
  assert.equal(paisDeTelefono("50688881234")?.codigo, "cr");
  assert.equal(paisDeTelefono("50761231234")?.codigo, "pa");

  // Se acepta escrito como lo escribe una persona.
  assert.equal(paisDeTelefono("+507 6123-1234")?.codigo, "pa");
});

/**
 * Y no adivina. Un +1 puede ser dominicano, de Miami o de media docena de
 * islas más, y lo que lo distingue es el código de área. Un número de Miami
 * metido como dominicano haría que el agente cotizara en pesos a quien paga en
 * dólares: peor que no saber de dónde es.
 */
test("ante la duda no inventa país", () => {
  assert.equal(paisDeTelefono("13055551234"), null, "Miami no es Santo Domingo");
  assert.equal(paisDeTelefono("14155551234"), null, "ni San Francisco");
  assert.equal(paisDeTelefono("34600111222"), null, "un +34 no es ninguno de los tres");
  assert.equal(paisDeTelefono("pendiente:abc123"), null, "un canal sin vincular no tiene prefijo");
  assert.equal(paisDeTelefono(""), null);
  assert.equal(paisDeTelefono(null), null);
});

test("un canal nuevo estrena el país de su número, sin que nadie lo elija", () => {
  const tico = canal("Nuevo tico", "50688887777");
  assert.equal(D.obtenerAgente(orgId, tico).pais, "cr");

  const panameno = canal("Nuevo panameño", "50761117777");
  assert.equal(D.obtenerAgente(orgId, panameno).pais, "pa");

  // Uno del que no se puede saber se queda sin país, y el panel lo avisa.
  const raro = canal("番号", "34600111222");
  assert.equal(D.obtenerAgente(orgId, raro).pais, "");

  D.eliminarCanal(orgId, tico);
  D.eliminarCanal(orgId, panameno);
  D.eliminarCanal(orgId, raro);
});

/**
 * Lo que NO puede hacer: pisar una decisión de una persona. Alguien puede tener
 * un número dominicano atendiendo a clientes de Miami, y eso no lo deshace un
 * prefijo.
 */
test("el prefijo nunca pisa un país elegido a mano", () => {
  const suyo = canal("Con dueño", "18095557777");
  assert.equal(D.obtenerAgente(orgId, suyo).pais, "do", "de entrada, el del prefijo");

  D.actualizarAgente(orgId, { pais: "pa" }, suyo);

  // Aunque se vuelva a pedir —al vincular, o en el arranque siguiente—.
  assert.equal(D.ponerPaisPorTelefono(orgId, suyo), null, "no cambió nada");
  assert.equal(D.obtenerAgente(orgId, suyo).pais, "pa", "manda lo que eligió la persona");

  D.eliminarCanal(orgId, suyo);
});

// ── El país entra en el prompt ──────────────────────────────────────────────

/**
 * Un agente que le dice «son 1.500 pesos» a un tico, o que le pide «la calle y
 * el número» a alguien de San José, se delata en el primer mensaje. El cliente
 * no piensa que el bot está mal configurado: piensa que la tienda no es de aquí.
 */
test("cada canal lleva al modelo la moneda y las direcciones de SU país", () => {
  const promptRd = armarSistema("Tienda", D.obtenerAgente(orgId, rd), [], null);
  const promptCr = armarSistema("Tienda", D.obtenerAgente(orgId, cr), [], null);
  const promptPa = armarSistema("Tienda", D.obtenerAgente(orgId, pa), [], null);

  assert.ok(promptRd.includes("RD$"), "el dominicano cobra en pesos");
  assert.ok(promptRd.includes("República Dominicana"));
  assert.equal(promptRd.includes("SINPE"), false, "y no sabe nada de SINPE");

  assert.ok(promptCr.includes("₡"), "el tico cobra en colones");
  assert.ok(promptCr.includes("SINPE Móvil"), "que es como se paga en Costa Rica");
  assert.ok(
    promptCr.includes("EN COSTA RICA NO HAY CALLE Y NÚMERO"),
    "es la diferencia que más se nota al pedir una dirección",
  );

  assert.ok(promptPa.includes("B/."), "el panameño cobra en balboas");
  assert.ok(promptPa.includes("Yappy"), "que es como se paga en Panamá");
  assert.equal(promptPa.includes("₡"), false, "y no mezcla la moneda del vecino");
});

test("sin país, el prompt es el de siempre y no inventa ninguno", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId), [], null);

  assert.equal(prompt.includes("DÓNDE VENDES"), false);
  for (const p of PAISES) assert.equal(prompt.includes(p.moneda.simbolo), false);
});

/**
 * Lo del país es CONTEXTO, no permiso. Sin esta última línea, un modelo al que
 * se le acaba de contar cómo se paga y cuánto tarda un envío en ese país
 * empieza a prometer plazos y formas de pago que el negocio no ofrece.
 */
test("saber cómo se paga en el país no autoriza a prometerlo", () => {
  const bloque = bloqueDePais(obtenerPais("pa")!);

  assert.ok(bloque.includes("no para prometerle nada"));
  assert.ok(bloque.includes("los del catálogo"));
});

// ── Vender sin catálogo ─────────────────────────────────────────────────────

/**
 * La mayoría de estas tiendas vende diez artículos y no los va a cargar uno a
 * uno en una tabla: los escribe en cuatro líneas. Eso lo escribió el dueño, así
 * que vale tanto como el catálogo — y la regla de no inventar precios sigue en
 * pie, porque lo que no está en ninguno de los dos no se promete.
 */
test("un canal sin catálogo vende con lo que el dueño escribió a mano", () => {
  D.actualizarAgente(
    orgId,
    { conocimiento: "Camisas lino talla S a XL — RD$1,850\nEnvío al interior RD$300" },
    rd,
  );

  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId, rd), [], null);

  assert.ok(prompt.includes("Camisas lino talla S a XL"));
  assert.ok(prompt.includes("RD$1,850"));
  assert.ok(prompt.includes("LO QUE VENDES"));
  assert.equal(
    prompt.includes("(sin catálogo cargado)"),
    false,
    "tiene de dónde cotizar: decirle que no hay catálogo lo dejaría mudo",
  );
  assert.ok(
    prompt.includes("No inventes precios"),
    "vender sin catálogo es vender con otra fuente, no vender a ciegas",
  );
});

test("sin catálogo y sin nada escrito, sigue diciendo que no hay de dónde sacar precios", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId, pa), [], null);
  assert.ok(prompt.includes("(sin catálogo cargado)"));
});

// ── El mapa ─────────────────────────────────────────────────────────────────

const pinDe = (lat: number, lng: number, texto = textoDeUbicacion({ nombre: "Mi casa" })) =>
  ({ texto, enlace: enlaceDeMapa(lat, lng) });

test("un pin dentro del país se sitúa por su zona y se confirma, no se repregunta", () => {
  // Un punto de Santiago de los Caballeros.
  const { texto, enlace } = pinDe(19.4517, -70.697);
  const v = validarUbicacion(texto, enlace, "do");

  assert.ok(v, "el pin es válido");
  assert.equal(v!.dentroDelPais, true);
  assert.equal(v!.zona?.nombre, "Santiago de los Caballeros");

  const bloque = ubicacionParaModelo(v!, "República Dominicana");
  assert.ok(bloque.includes("Santiago de los Caballeros"));
  assert.ok(bloque.includes("La zona es válida para entregar"));
  assert.ok(
    bloque.includes("NO es una dirección"),
    "el pin sitúa la zona; el mensajero sigue necesitando señas",
  );
});

/**
 * El caso por el que existe la validación: el cliente manda una ubicación vieja
 * del móvil, o el sitio donde estaba de viaje. Un agente que se fía del pin
 * despacha el pedido a la nada.
 */
test("un pin de otro país se avisa y NO se da por dirección de entrega", () => {
  // Ciudad de Panamá, en el canal de Costa Rica.
  const { texto, enlace } = pinDe(8.9824, -79.5199);
  const v = validarUbicacion(texto, enlace, "cr");

  assert.equal(v!.dentroDelPais, false);

  const bloque = ubicacionParaModelo(v!, "Costa Rica");
  assert.ok(bloque.includes("NO está en Costa Rica"));
  assert.ok(bloque.includes("No lo des por bueno"));
  assert.equal(
    bloque.includes("La zona es válida"),
    false,
    "no se puede decir que sirve y que no sirve a la vez",
  );
});

test("sin coordenadas utilizables no hay pin que validar", () => {
  const texto = textoDeUbicacion({ nombre: "Mi casa" });

  assert.equal(validarUbicacion(texto, null, "do"), null, "sin enlace");
  assert.equal(validarUbicacion(texto, "https://ejemplo.com/mapa", "do"), null, "enlace ajeno");
  assert.equal(
    validarUbicacion("hola, te mando la ubicación", enlaceDeMapa(18.48, -69.93), "do"),
    null,
    "hablar de la ubicación no es mandarla",
  );
});

test("el pin va al prompt solo cuando el cliente lo acaba de mandar", () => {
  const { texto, enlace } = pinDe(18.4861, -69.9312);
  const v = validarUbicacion(texto, enlace, "do")!;
  const agente = D.obtenerAgente(orgId, rd);

  const conPin = armarSistema("Tienda", agente, [], null, "Resumen:", null, v);
  const sinPin = armarSistema("Tienda", agente, [], null, "Resumen:", null, null);

  assert.ok(conPin.includes("SU UBICACIÓN EN EL MAPA"));
  assert.equal(sinPin.includes("SU UBICACIÓN EN EL MAPA"), false);
});

// ── Lo que el cliente manda sin escribirlo ──────────────────────────────────

/**
 * En el historial de un modelo de texto solo caben palabras. Un «[imagen]» a
 * secas es el agujero por el que el agente preguntaba «¿qué artículo te
 * interesa?» a quien acababa de enseñárselo en una foto.
 */
test("una foto y una nota de voz llegan al modelo como texto", () => {
  const base: D.Mensaje = {
    id: 1,
    org_id: orgId,
    conversation_id: 1,
    whapi_message_id: null,
    emisor: "cliente",
    tipo: "imagen",
    descripcion_imagen: null,
    categoria_imagen: null,
    transcripcion: null,
    media_url: "local:1/x.jpg",
    content: "[imagen]",
    created_at: D.ahora(),
  };

  const foto = conLoVistoYOido({
    ...base,
    descripcion_imagen: "Una camisa de lino blanca",
    categoria_imagen: "foto_producto",
    content: "[imagen] esta me gusta",
  });
  assert.ok(foto.includes("Una camisa de lino blanca"));
  assert.ok(foto.includes("esta me gusta"), "el pie de foto del cliente no se pierde");

  const comprobante = conLoVistoYOido({
    ...base,
    descripcion_imagen: "Transferencia por RD$1,850",
    categoria_imagen: "comprobante_pago",
  });
  assert.ok(comprobante.includes("comprobante de pago"));

  const audio = conLoVistoYOido({
    ...base,
    tipo: "audio",
    transcripcion: "quiero dos, talla M, para Los Prados",
    content: "[nota de voz]",
  });
  assert.equal(audio, "(nota de voz) quiero dos, talla M, para Los Prados");

  // Sin describir, se queda como estaba: el prompt le dice al agente que ahí
  // pida el dato por escrito en vez de inventárselo.
  assert.equal(conLoVistoYOido(base), "[imagen]");
});

test("el prompt le explica al agente qué hacer con fotos y audios", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId, rd), [], null);

  assert.ok(prompt.includes("LO QUE EL CLIENTE MANDA SIN ESCRIBIRLO"));
  assert.ok(
    prompt.includes("NUNCA des un pago por recibido"),
    "una captura de una transferencia no es dinero cobrado",
  );
});

// ── La nota de voz, de punta a punta ────────────────────────────────────────

/**
 * QUE UNA NOTA DE VOZ LLEGUE Y SE CONTESTE.
 *
 * Media venta se cierra hablando: el cliente dice en veinte segundos el
 * artículo, la talla y la dirección. Sin transcribir, al agente le llega
 * «[nota de voz]» y no puede hacer nada con eso.
 *
 * La transcripción de verdad necesita red y vive en `npm run verificar-audio`.
 * Lo que se fija aquí son las guardas que la rodean, que son las que dejan al
 * agente mudo o colgado cuando se rompen.
 */

test("con el interruptor de audios apagado no se toca la nota de voz", async () => {
  const canalId = canal("Sin oído", "50722227777");
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, "50711112222", {
    cuando: D.ahora(),
  });
  D.insertMessage(orgId, {
    conversationId: conversacion.id,
    whapiMessageId: "voz-1",
    emisor: "cliente",
    tipo: "audio",
    content: "[nota de voz]",
    mediaUrl: "local:1/inventado.ogg",
    createdAt: D.ahora(),
  });

  const antes = D.listarMensajes(orgId, conversacion.id);
  const despues = await percibir(orgId, antes, {
    ver: false,
    oir: false,
    modeloVision: "x",
    modeloAudio: "x",
  });

  assert.equal(despues[0]!.transcripcion, null, "no se intenta, así que no se gasta");
  assert.deepEqual(despues, antes, "el historial sale como entró");

  // Y el agente lo ve tal cual, que es cuando el prompt le manda pedirlo escrito.
  assert.equal(conLoVistoYOido(despues[0]!), "[nota de voz]");

  D.eliminarCanal(orgId, canalId);
});

test("una nota de voz sin archivo guardado no se intenta transcribir", async () => {
  const canalId = canal("Sin archivo", "50722226666");
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, "50711113333", {
    cuando: D.ahora(),
  });
  D.insertMessage(orgId, {
    conversationId: conversacion.id,
    whapiMessageId: "voz-2",
    emisor: "cliente",
    tipo: "audio",
    content: "[nota de voz]",
    // Sin `mediaUrl`: la descarga desde WhatsApp falló. Pasa, y no puede
    // costar una llamada al modelo ni un segundo de espera del cliente.
    createdAt: D.ahora(),
  });

  const antes = D.listarMensajes(orgId, conversacion.id);
  const despues = await percibir(orgId, antes, {
    ver: true,
    oir: true,
    modeloVision: "x",
    modeloAudio: "x",
  });

  assert.deepEqual(despues, antes);

  D.eliminarCanal(orgId, canalId);
});

/**
 * El prompt tiene que decirle qué hacer cuando NO se pudo oír. Sin esta línea
 * el agente se inventa que escuchó algo, o le suelta al cliente una excusa
 * técnica sobre audios que no le interesa a nadie.
 */
test("el prompt le dice qué hacer con un audio que no se pudo leer", () => {
  const prompt = armarSistema("Tienda", D.obtenerAgente(orgId, rd), [], null);

  assert.ok(prompt.includes("nota de voz"));
  assert.ok(prompt.includes("ya transcrita"), "una nota de voz transcrita es su mensaje");
  assert.ok(
    prompt.includes("no se pudo leer"),
    "y si no se pudo, que la pida por escrito en vez de inventar",
  );
});
