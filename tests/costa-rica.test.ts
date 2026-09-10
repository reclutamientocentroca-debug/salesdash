import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as D from "../src/lib/db";
import { armarSistema, generarRespuesta } from "../src/lib/agent";
import { agenteDePais } from "../src/agents";
import { respuestaMinima } from "../src/lib/apertura";
import { revisarConReglas, type ContextoRevision } from "../src/lib/revisor";
import { bloqueDelPais } from "../src/agents";

/**
 * COSTA RICA VA SOLA. ESTE ARCHIVO ES EL CANDADO.
 *
 * La dueña (2026-09-08): «que las instrucciones y la forma de responder se
 * queden como están, pero separada; como está respondiendo está bien».
 *
 * Costa Rica no vive en un solo archivo: su guion sí es suyo, pero la apertura,
 * el revisor y la ficha los comparte con República Dominicana y Panamá. Mover
 * todo eso a un módulo aparte es un refactor grande, y un refactor grande es
 * justo la forma más fácil de cambiarle sin querer la manera de responder.
 *
 * Así que en vez de moverla, se CONGELA: aquí queda grabado, palabra por
 * palabra, lo que Costa Rica dice hoy —su prompt entero, sus respuestas
 * mecánicas y lo que su revisor para—. Cualquier cambio que la mueva, venga del
 * archivo que venga, rompe estas pruebas y hay que mirarlo a la cara.
 *
 * SI EL CAMBIO ES A PROPÓSITO —porque la dueña pidió algo para Costa Rica—, se
 * vuelve a grabar con:
 *
 *     FIJAR_CR=1 npm test
 *
 * y se revisa el diff del archivo de `tests/fijado/` en el commit. Lo que no
 * puede pasar es que se mueva sola, de rebote, arreglando otro país.
 */

/** Vuelve a grabar los fijados en vez de compararlos. Solo a propósito. */
const REGRABAR = process.env.FIJAR_CR === "1";

function fijado(nombre: string, actual: string): void {
  const ruta = join(__dirname, "fijado", nombre);

  if (REGRABAR || !existsSync(ruta)) {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, actual);
    if (!REGRABAR) console.log(`[costa-rica] grabado por primera vez: ${nombre}`);
    return;
  }

  const guardado = readFileSync(ruta, "utf8");
  if (guardado === actual) return;

  // El primer renglón que baila, que es lo que se quiere ver.
  const a = guardado.split("\n");
  const b = actual.split("\n");
  const i = a.findIndex((l, n) => l !== b[n]);

  assert.fail(
    `COSTA RICA CAMBIÓ y va sola: ${nombre}\n` +
      `Primera línea distinta (${i + 1}):\n` +
      `  antes: ${JSON.stringify(a[i] ?? "(no estaba)")}\n` +
      `  ahora: ${JSON.stringify(b[i] ?? "(ya no está)")}\n` +
      "Si es a propósito, vuelve a grabarlo con FIJAR_CR=1 npm test y revisa el diff.",
  );
}

/** La cuenta tica de las pruebas: siempre igual, para que el fijado no baile. */
function canalTico() {
  const org = D.crearOrgConDueno({
    negocio: "Tienda Tica", color: "#111111", nombre: "Dueña",
    email: `cr-fijado-${Date.now()}-${Math.random().toString(36).slice(2)}@local`,
    passwordHash: "x",
  });
  const canal = D.crearCanal(org.orgId, {
    nombre: "Costa Rica", phone: `506${Math.random().toString().slice(2, 10)}`,
    tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  D.actualizarAgente(org.orgId, { pais: "cr", nombre: "Mildred", negocio: "Tienda Tica" }, canal);
  return { orgId: org.orgId, canal };
}

const ANUNCIO = {
  origen: "anuncio" as const,
  producto_anuncio: "Camisa de lino",
  descripcion_anuncio: "Camisa de lino manga larga — ₡25.000. Tallas S, M, L y XL.",
};

test("el prompt de Costa Rica es el que está grabado, palabra por palabra", () => {
  const { orgId, canal } = canalTico();
  const agente = D.obtenerAgente(orgId, canal);

  fijado("costa-rica-prompt.txt", armarSistema("Tienda Tica", agente, [], null));
  fijado("costa-rica-prompt-con-anuncio.txt", armarSistema("Tienda Tica", agente, [], ANUNCIO));
});

test("el bloque de país de Costa Rica es el que está grabado", () => {
  fijado("costa-rica-pais.txt", bloqueDelPais(agenteDePais("cr")!, null, "Tienda Tica"));
});

/**
 * Lo que Costa Rica contesta SIN modelo: la bienvenida sin anuncio, la apertura
 * desde un anuncio y la respuesta mínima cuando el revisor paró dos veces. Son
 * las tres frases que salen tal cual, sin que nadie las redacte.
 */
test("las respuestas mecánicas de Costa Rica son las que están grabadas", async () => {
  const { orgId, canal } = canalTico();
  D.crearProducto(orgId, { nombre: "Camisa de lino", variantes: "S, M, L", precio: 25000, canalId: canal });

  const hilo = (texto: string) => [{
    id: 1, org_id: orgId, conversation_id: 1, whapi_message_id: null,
    emisor: "cliente" as const, tipo: "texto" as const,
    descripcion_imagen: null, categoria_imagen: null, transcripcion: null,
    media_url: null, content: texto, created_at: D.ahora(),
  }];

  const sinAnuncio = await generarRespuesta(orgId, canal, hilo("Hola"));
  const conAnuncio = await generarRespuesta(orgId, canal, hilo("Hola, quiero info"), ANUNCIO);

  const d = agenteDePais("cr")!;
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const minima = respuestaMinima(d, vacia, ANUNCIO, { ultimoDelCliente: "¿cuánto cuesta?" });
  const conTalla = respuestaMinima(d, { ...vacia, talla: "M" }, ANUNCIO, {});
  // Y el paso del teléfono, que es donde se pide el número. Sin esto el fijado
  // no cubría cómo lo pide, y una frase compartida podía cambiarlo sin ruido.
  const conDireccion = respuestaMinima(
    d,
    // Con la talla Y el color dados: la ropa lleva los dos, así que sin el
    // color el paso siguiente sería ese y no el teléfono.
    { ...vacia, talla: "M", color: "negro", direccion: "Escazú, San José", nombre: "Ana" },
    ANUNCIO,
    { lugar: "Escazú" },
  );

  fijado(
    "costa-rica-respuestas.txt",
    [
      "── Bienvenida sin anuncio ──", sinAnuncio.texto,
      "", "── Apertura desde un anuncio ──", conAnuncio.texto,
      "", "── Respuesta mínima, sin nada en la ficha ──", String(minima),
      "", "── Respuesta mínima, con la talla dada ──", String(conTalla),
      "", "── Respuesta mínima, con la dirección dada (toca el teléfono) ──", String(conDireccion),
      "",
    ].join("\n"),
  );
});

/**
 * Y LO QUE SU REVISOR PARA. Las reglas mecánicas son compartidas: un arreglo
 * escrito para República Dominicana le llega a Costa Rica aunque su guion no se
 * toque. Aquí queda grabado qué para y qué deja pasar en un chat tico.
 */
test("el revisor de Costa Rica para lo que está grabado y nada más", () => {
  const d = agenteDePais("cr")!;
  const base: ContextoRevision = {
    datos: d,
    nombresDeLaCasa: [d.nombreAgente ?? "", d.tienda].filter(Boolean),
    catalogo: "Catálogo:\n- Camisa de lino (S, M, L) — 25000",
    anuncio: null,
    bloqueDelPais: bloqueDelPais(d, null, "Tienda Tica"),
    ficha: { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null },
  };

  const borradores = [
    "Diay, la camisa está en ₡25.000. ¿Qué talla le interesa?",
    "El envío son ₡3.500 a todo el país. ¿A qué cantón se lo enviamos?",
    "El envío le sale en ₡5.000.",
    "Son US$25.00 más el envío.",
    "Perfecto, ya tenemos su talla. ¿Qué color prefiere?",
    "¿Me comparte su ubicación por aquí?",
    "¿Cuántas unidades desea?",
    "Permítame un momento, le comunico con un representante.",
    "Con gusto le ayudo. ¿Me facilita su número de teléfono?",
  ];

  fijado(
    "costa-rica-revisor.txt",
    borradores
      .map((b) => {
        const fallas = revisarConReglas(b, base);
        return [`── ${b}`, ...(fallas.length ? fallas.map((f) => `   ✖ ${f}`) : ["   ✓ pasa"])].join("\n");
      })
      .join("\n") + "\n",
  );
});

/**
 * PREGUNTAR POR LA TIENDA ENTERA NO ES ELEGIR UN ARTÍCULO.
 *
 * El caso de la dueña (Costa Rica, 2026-09-08): «¿Cuál es el precio de la
 * ropa?» y la respuesta fue «Indique su dirección exacta de entrega.». «La
 * ropa» no es un artículo —esta tienda vende veinte— y sin artículo no hay
 * dirección que pedir: lo que toca es saludar y preguntarle cuál le interesa.
 */
test("a una pregunta por «la ropa», Costa Rica saluda y pregunta el artículo", () => {
  const d = agenteDePais("cr")!;
  const porLaRopa: ContextoRevision = {
    datos: d,
    nombresDeLaCasa: [d.nombreAgente ?? "", d.tienda].filter(Boolean),
    catalogo: "Catálogo:\n- Camisa de lino (S, M, L) — 25000\n- Polo Brox — 12000",
    anuncio: null,
    bloqueDelPais: bloqueDelPais(d, null, "Tienda Tica"),
    ficha: { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null },
    textosDelCliente: ["¿Cuál es el precio de la ropa?"],
    ultimoDelCliente: "¿Cuál es el precio de la ropa?",
  };

  // Lo que salió y no puede volver a salir.
  assert.ok(
    revisarConReglas("Indique su dirección exacta de entrega.", porLaRopa)
      .some((f) => f.includes("todavía no sabes qué artículo quiere")),
  );

  // Y lo que sí toca: saludar y preguntarle cuál. Esto lo paraba la regla del
  // precio por no llevar cifra, y es justo la respuesta correcta.
  assert.deepEqual(
    revisarConReglas("Hola, le asiste Mildred, un gusto. ¿Cuál es el artículo de su interés?", porLaRopa),
    [],
  );
  assert.deepEqual(
    revisarConReglas(
      "Hola, le asiste Mildred, un gusto. Tenemos camisa de lino y Polo Brox. ¿Cuál artículo le interesa?",
      porLaRopa,
    ),
    [],
  );

  /*
   * Pero si el cliente SÍ dijo qué quiere, aunque la casa no conozca esa
   * palabra, no se le para nada por esto: «poloche» es el polo, como se dice
   * allá, y perder la venta por no conocer el idioma sería peor.
   */
  const conArticulo = {
    ...porLaRopa,
    textosDelCliente: ["Quiero el poloche"],
    ultimoDelCliente: "Quiero el poloche",
  };
  assert.equal(
    revisarConReglas("¿Qué talla le interesa?", conArticulo)
      .some((f) => f.includes("todavía no sabes qué artículo quiere")),
    false,
  );
});

/**
 * AL DEVOLVERLE EL HILO, CONTESTA EL ÚLTIMO MENSAJE DEL CLIENTE.
 *
 * La dueña (Costa Rica, 2026-09-09): «al transferirle a la IA quiero que
 * responda el mensaje del cliente, el último que envió». No pasaba: se pulsaba
 * «Contesta la IA» y el chat se quedaba mudo. El hilo que se le daba al modelo
 * seguía terminando en el «le transfiero con un representante» del propio
 * agente, y esa conversación no se puede contestar —termina en el turno del
 * asistente—: se paraba antes de llamar al modelo y quedaba una anomalía
 * diciendo que el modelo no respondió, que era mentira.
 *
 * Lo que esta prueba fija es lo que ve el modelo: el hilo cortado en el
 * mensaje del cliente que quedó colgando, el aviso de que el chat se lo han
 * devuelto, y lo que la casa ya le escribió después de ese mensaje —para que
 * no lo repita—.
 */
test("al devolverle el hilo, el modelo lo recibe terminando en el mensaje del cliente", async () => {
  const { orgId, canal } = canalTico();
  const { atenderConversacion } = await import("../src/lib/agent");
  D.actualizarCanal(orgId, canal, { agente_activo: 1, contesta_ia: 0 });

  const { conversacion } = D.getOrCreateConversation(orgId, canal, "50688887777", {
    cuando: D.ahora() - 3_600,
  });
  const escribir = (emisor: D.Emisor, content: string, hace: number, i: number) =>
    D.insertMessage(orgId, {
      conversationId: conversacion.id,
      whapiMessageId: `retomado-${i}`,
      emisor, tipo: "texto", content, createdAt: D.ahora() - hace,
    });

  escribir("cliente", "Buenas, ¿cuánto vale el polo?", 600, 1);
  escribir("ia", "Le cuesta ₡12.000. ¿Qué talla usa?", 560, 2);
  escribir("cliente", "¿Me lo pueden mandar a Puntarenas?", 300, 3);
  escribir("ia", "Permítame un momento, le transfiero con un representante.", 290, 4);
  escribir("humano", "Buenas, en un momento le confirmo el envío.", 120, 5);

  D.devolverALaIa(orgId, conversacion.id);

  // El modelo no existe en las pruebas: se le pone uno de mentira para leer,
  // palabra por palabra, lo que se le habría mandado.
  const fetchOriginal = globalThis.fetch;
  const claveOriginal = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "clave-de-pruebas";
  /** Lo que se le pidió al modelo, en orden: la del agente es la primera. */
  const peticiones: { role: string; content: string }[][] = [];

  globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
    peticiones.push(JSON.parse(String(init?.body)).messages);
    return new Response(
      JSON.stringify({
        id: "x", model: "de-mentira",
        choices: [{ message: { role: "assistant", content: "Sí, hasta Puntarenas va por correo." } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    // Sin socket de WhatsApp el envío falla: lo que se comprueba es lo que se
    // le pidió al modelo, no que el mensaje saliera.
    await atenderConversacion(orgId, canal, conversacion.id).catch(() => {});
  } finally {
    globalThis.fetch = fetchOriginal;
    if (claveOriginal === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = claveOriginal;
  }

  const turnos = peticiones[0] ?? [];
  assert.ok(turnos.length > 0, "no se llegó a llamar al modelo: el hilo devuelto se paró antes");

  const ultimo = turnos[turnos.length - 1];
  assert.equal(ultimo.role, "user", "la conversación tiene que terminar en el cliente");
  assert.equal(
    ultimo.content,
    "¿Me lo pueden mandar a Puntarenas?",
    "lo que se contesta es el último mensaje del cliente",
  );

  /*
   * Y LA DESPEDIDA QUE YA NO VALE NO ESTÁ EN EL HILO. En el guion sí sigue
   * —es la frase con la que se transfiere cuando toca—, pero como turno del
   * agente se fue: leerse a sí mismo despidiéndose es lo que le hacía
   * repetirlo o callarse.
   */
  assert.equal(
    turnos.slice(1).some((m) => m.content.includes("le transfiero con un representante")),
    false,
    "la despedida que ya no vale sigue en el hilo del modelo",
  );

  const sistema = turnos[0].content;
  assert.equal(turnos[0].role, "system");
  assert.match(sistema, /EL EQUIPO TE HA DEVUELTO ESTE CHAT/);
  assert.match(
    sistema,
    /Buenas, en un momento le confirmo el envío\./,
    "el modelo tiene que saber lo que el equipo ya le escribió para no repetirlo",
  );
});
