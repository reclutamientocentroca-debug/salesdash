import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buscarPrimeraSenal } from "../src/lib/analyzer";
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
