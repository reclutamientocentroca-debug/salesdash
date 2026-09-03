import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais, bloqueDelPais } from "../src/agents";
import { campoDeLaPregunta, fichaDelPedido, fichaParaModelo, preguntasRepetidas } from "../src/lib/memoria";
import { revisarConReglas, type ContextoRevision } from "../src/lib/revisor";

/**
 * LA MEMORIA ES UNA PUERTA, NO UN CONSEJO.
 *
 * Lo que el cliente ya dijo se arma en una ficha sin modelo, va al final del
 * prompt y el revisor para cualquier respuesta que lo vuelva a preguntar.
 */
const rd = agenteDePais("do")!;

const hilo = [
  { emisor: "cliente", content: "Hola, vi el anuncio de los mocasines" },
  { emisor: "ia", content: "Hola, le asiste Orlanda de RINCON DCM\n\nLos mocasines están en RD$2,500.\n\n¿Qué talla necesita?" },
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
