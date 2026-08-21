import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buscarPrimeraSenal } from "../src/lib/analyzer";
import { contieneMarcador } from "../src/lib/cierre";
import type { CategoriaImagen, Mensaje } from "../src/lib/db";

/**
 * LA REGLA MAESTRA — el primero que cierra se lleva la venta.
 *
 * Estas pruebas no tocan la red: la descripción de imágenes entra por un
 * callback que aquí se sustituye.
 */

const MARCADOR = "Resumen:";
let contador = 0;

function m(parcial: Partial<Mensaje> & { emisor: Mensaje["emisor"]; created_at: number }): Mensaje {
  return {
    id: ++contador,
    org_id: 1,
    conversation_id: 1,
    whapi_message_id: `m${contador}`,
    tipo: "texto",
    descripcion_imagen: null,
    categoria_imagen: null,
    media_url: null,
    content: "",
    ...parcial,
  } as Mensaje;
}

/** Por defecto la visión no se llama; cada prueba decide qué devuelve. */
const nuncaSeLlama = async (): Promise<CategoriaImagen | null> => {
  throw new Error("No debería haberse pedido una descripción de imagen");
};

test("resumen de la IA y luego factura del vendedor: la venta es de la IA", async () => {
  const hilo = [
    m({ emisor: "cliente", created_at: 100, content: "hola" }),
    m({ emisor: "ia", created_at: 200, content: "Resumen: 1 camisa, total 1850, envío 200" }),
    // Diez minutos después el vendedor manda la factura. Es papeleo posterior.
    m({ emisor: "humano", created_at: 800, tipo: "imagen", categoria_imagen: "factura", content: "[imagen]" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales.length, 1);
  assert.equal(r.senales[0]!.quien, "ia");
  assert.equal(r.senales[0]!.senal, "resumen_ia");
});

test("factura del vendedor sin resumen previo: la venta es del vendedor", async () => {
  const hilo = [
    m({ emisor: "cliente", created_at: 100, content: "quiero dos" }),
    m({ emisor: "humano", created_at: 300, tipo: "imagen", categoria_imagen: "factura", content: "[imagen]" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales[0]!.quien, "humano");
  assert.equal(r.senales[0]!.senal, "imagen_factura");
});

test("si un vendedor escribió antes, el resumen de la IA no es cierre de IA", async () => {
  const hilo = [
    m({ emisor: "cliente", created_at: 100, content: "hola" }),
    m({ emisor: "humano", created_at: 150, content: "ya te atiendo" }),
    m({ emisor: "ia", created_at: 200, content: "Resumen: 1 camisa, total 1850" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales[0]!.quien, "humano");
  assert.equal(r.senales[0]!.senal, "resumen_tras_intervencion");
});

test("una foto de producto no cierra nada", async () => {
  const hilo = [
    m({ emisor: "cliente", created_at: 100, content: "¿tienes foto?" }),
    m({ emisor: "humano", created_at: 200, tipo: "imagen", categoria_imagen: "foto_producto", content: "[imagen]" }),
    m({ emisor: "cliente", created_at: 300, content: "lo pienso" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales.length, 0);
  assert.equal(r.imagenSinDescribir, false);
});

test("la imagen sin describir manda el hilo a revisión, nunca se asume factura", async () => {
  const hilo = [
    m({ emisor: "cliente", created_at: 100, content: "hola" }),
    m({ emisor: "humano", created_at: 200, tipo: "imagen", content: "[imagen]" }),
  ];

  // El modelo con visión falla: devuelve null.
  const r = await buscarPrimeraSenal(MARCADOR, hilo, async () => null);
  assert.equal(r.senales.length, 0);
  assert.equal(r.imagenSinDescribir, true);
});

test("dos señales en el mismo segundo y de dueños distintos: empate", async () => {
  const hilo = [
    m({ emisor: "ia", created_at: 500, content: "Resumen: 1 camisa" }),
    m({ emisor: "humano", created_at: 500, content: "Resumen: lo cerré yo" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales.length, 2);
  assert.equal(new Set(r.senales.map((s) => s.quien)).size, 2);
});

test("solo se pide descripción de las imágenes anteriores al cierre", async () => {
  let pedidas = 0;

  const hilo = [
    m({ emisor: "ia", created_at: 200, content: "Resumen: 1 camisa, total 1850" }),
    m({ emisor: "humano", created_at: 900, tipo: "imagen", content: "[imagen]" }),
    m({ emisor: "humano", created_at: 950, tipo: "imagen", content: "[imagen]" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, async () => {
    pedidas++;
    return "factura";
  });

  assert.equal(r.senales[0]!.quien, "ia");
  // Las dos facturas posteriores no se describen: ahí se iba el gasto.
  assert.equal(pedidas, 0);
});

test("el marcador de cierre es configurable por organización", async () => {
  const hilo = [m({ emisor: "ia", created_at: 100, content: "PEDIDO CONFIRMADO: 2 camisas" })];

  assert.equal((await buscarPrimeraSenal("Resumen:", hilo, nuncaSeLlama)).senales.length, 0);
  assert.equal((await buscarPrimeraSenal("pedido confirmado:", hilo, nuncaSeLlama)).senales.length, 1);
});

/**
 * EL MARCADOR ADMITE PALABRAS EN MEDIO.
 *
 * Con el marcador «Resumen:», una IA que escribe «Resumen de su pedido:» estaba
 * cerrando la venta y el panel no la contaba: la frase no contiene «Resumen:»
 * por ningún lado. Pasó en producción, con el pedido entero —producto, total y
 * dirección— escrito en el hilo y la conversación enseñada como abierta.
 */
test("«Resumen de su pedido:» cierra igual que «Resumen:»", () => {
  const real = [
    "Perfecto, Yazmín.",
    "",
    "Excelente, tenemos envío para su zona. Le llega en 48 a 72 horas.",
    "",
    "Resumen de su pedido:",
    "",
    "Producto: Cepillo Blower 2 en 1",
    "Costo del producto: USD 16",
    "TOTAL A PAGAR: USD 21",
  ].join("\n");

  assert.equal(contieneMarcador(real, MARCADOR), true, "el mensaje real de producción");
  assert.equal(contieneMarcador("Resumen: 1 camisa, total 1850", MARCADOR), true);
  assert.equal(contieneMarcador("RESUMEN DEL PEDIDO: 2 carteras", MARCADOR), true);
});

/**
 * Aflojar no puede ser abrir la mano: si cualquier mención de la palabra
 * cerrara la venta, el panel contaría ventas donde solo hubo una frase.
 */
test("hablar del resumen no cierra nada", () => {
  assert.equal(
    contieneMarcador("ahora le paso el resumen y le confirmo el total", MARCADOR),
    false,
    "sin los dos puntos no hay pedido, hay una promesa",
  );
  assert.equal(
    contieneMarcador("Resumen\n\nde su pedido: x", MARCADOR),
    false,
    "unos dos puntos dos párrafos más abajo son de otra frase",
  );
});

/**
 * Un marcador sin dos puntos se busca tal cual. Ahí la frase entera ES la
 * señal, y aflojarla la convertiría en cualquier cosa.
 */
test("el marcador sin dos puntos se sigue buscando literal", () => {
  assert.equal(contieneMarcador("Pedido confirmado, gracias", "Pedido confirmado"), true);
  assert.equal(contieneMarcador("Resumen de su pedido: x", "Pedido confirmado"), false);
});

/**
 * EL RESUMEN DE PEDIDO MANDA SOBRE LA FACTURA.
 *
 * Única excepción al orden cronológico. El resumen es el momento en que el
 * pedido queda cerrado —producto, total y envío—; la factura es papeleo
 * alrededor de esa misma venta, vaya delante o detrás. Sin esto, un vendedor
 * que adelanta la factura mientras la IA está cerrando le quitaba la venta a
 * la IA.
 */
test("la factura llega primero y el resumen después: la venta es de la IA", async () => {
  const hilo = [
    m({ emisor: "cliente", created_at: 100, content: "lo quiero" }),
    // El vendedor adelanta la factura mientras la IA sigue cerrando.
    m({ emisor: "humano", created_at: 200, tipo: "imagen", categoria_imagen: "factura", content: "[imagen]" }),
    m({ emisor: "ia", created_at: 400, content: "Resumen de su pedido: 1 cartera, TOTAL A PAGAR: USD 30" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales.length, 1);
  assert.equal(r.senales[0]!.quien, "ia", "la cerró el resumen, no la factura");
  assert.equal(r.senales[0]!.senal, "resumen_ia");
});

/**
 * Y el ahorro que trae la regla: si hay resumen en el hilo, no hace falta
 * describir ni una imagen. Describir cuesta una llamada de visión por foto.
 */
test("con resumen en el hilo no se paga la visión de ninguna imagen", async () => {
  const hilo = [
    m({ emisor: "humano", created_at: 100, tipo: "imagen", content: "[imagen]" }),
    m({ emisor: "ia", created_at: 300, content: "Resumen del pedido: 2 camisas" }),
    m({ emisor: "humano", created_at: 900, tipo: "imagen", content: "[imagen]" }),
  ];

  // `nuncaSeLlama` revienta si alguien pide describir una imagen.
  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales[0]!.senal, "resumen_ia");
  assert.equal(r.imagenSinDescribir, false);
});

/**
 * La excepción va en UN solo sentido. Sin resumen en el hilo, la factura cierra
 * y es del vendedor — que es como se cuenta el cierre del representante.
 */
test("sin resumen en todo el hilo, la factura cierra para el representante", async () => {
  const hilo = [
    m({ emisor: "cliente", created_at: 100, content: "mándamelo" }),
    m({ emisor: "humano", created_at: 200, content: "va en camino" }),
    m({ emisor: "humano", created_at: 300, tipo: "imagen", categoria_imagen: "factura", content: "[imagen]" }),
  ];

  const r = await buscarPrimeraSenal(MARCADOR, hilo, nuncaSeLlama);
  assert.equal(r.senales.length, 1);
  assert.equal(r.senales[0]!.quien, "humano");
  assert.equal(r.senales[0]!.senal, "imagen_factura");
});
