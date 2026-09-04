import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais } from "../src/agents";
import { aperturaSegura, articuloDeLaDescripcion, precioDeLaDescripcion, preguntaDelCliente, primeraPregunta, respuestaDirecta, respuestaMinima } from "../src/lib/apertura";

/**
 * EL PRIMER MENSAJE VENDE DE LA DESCRIPCIÓN, SIN MODELO.
 *
 * Cuando el revisor para la apertura dos veces, al cliente no le llega «un
 * momento, por favor»: le llega el artículo y el precio tal cual están en la
 * descripción del anuncio, y la primera pregunta del orden de venta.
 */
const rd = agenteDePais("do")!;
const cr = agenteDePais("cr")!;
const saludo = "Hola, le asiste Orlanda de RINCON DCM";

test("el precio y el artículo salen tal cual de la descripción", () => {
  const combo = "🔥 ¡COMPRA SEGURO! 🔥 ❤️ COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora. Seca rápido y ahorra tiempo.";
  assert.equal(precioDeLaDescripcion(combo, "RD$"), "RD$1,690");
  assert.equal(articuloDeLaDescripcion(combo, "RD$"), "Combo 2 En 1");

  const camisas = "🔥 camisas de Lino para caballeros a RD$1,500 🔥 A 1,290 al comprar 3 👕";
  assert.equal(precioDeLaDescripcion(camisas, "RD$"), "RD$1,500");
  assert.equal(articuloDeLaDescripcion(camisas, "RD$"), "camisas de Lino para caballeros");

  const zapatos = "👞 ZAPATOS DCM ESTILO Elegancia que deja huella. Un diseño clásico. 💰 RD$1,990 ✔️ Diseño elegante";
  assert.equal(precioDeLaDescripcion(zapatos, "RD$"), "RD$1,990");
  assert.equal(articuloDeLaDescripcion(zapatos, "RD$"), "ZAPATOS DCM ESTILO Elegancia que deja huella", "tal cual lo escribió el negocio");

  // Sin precio escrito no hay nada seguro que cotizar.
  assert.equal(precioDeLaDescripcion("Camisas de lino, consulte precio", "RD$"), null);
});

test("la primera pregunta es la del orden de venta según el artículo", () => {
  assert.equal(primeraPregunta("camisas de lino para caballeros a RD$1,500", rd), "¿Qué talla le interesa?");
  assert.equal(primeraPregunta("ZAPATOS DCM ESTILO RD$1,990", rd), "¿Qué número calza?");
  assert.equal(primeraPregunta("COMBO 2 EN 1 cepillo secador + plancha RD$1,690", rd), "Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?");
  assert.equal(primeraPregunta("Camisa de lino ₡25.000", cr), "¿Qué talla le interesa?");
});

test("la apertura segura lleva saludo, artículo, precio y pregunta, y nada inventado", () => {
  const texto = aperturaSegura(
    rd,
    { producto_anuncio: "Rincondcm", descripcion_anuncio: "🔥 ¡COMPRA SEGURO! 🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora." },
    saludo,
  )!;
  assert.ok(texto.startsWith(`${saludo}\n\n`), "el saludo, aparte");
  assert.ok(texto.includes("Combo 2 En 1 está disponible, en RD$1,690."));
  assert.ok(texto.endsWith("¿En qué provincia se encuentra?"));
  assert.equal(texto.includes("talla"), false, "un combo no lleva talla");
  assert.equal(texto.includes("Un momento"), false);

  // Sin descripción con precio, no hay apertura segura: toca transferir.
  assert.equal(aperturaSegura(rd, { producto_anuncio: "Rincondcm", descripcion_anuncio: "Escríbenos" }, saludo), null);
  assert.equal(aperturaSegura(rd, null, saludo), null);
});

/**
 * A MITAD DE VENTA, SI EL REVISOR PARA DOS VECES, NO SE TRANSFIERE: se manda
 * la siguiente pregunta del orden de venta según lo que ya se sabe.
 */
test("la respuesta mínima es la siguiente pregunta del pedido, nunca una transferencia", () => {
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const camisa = { descripcion_anuncio: "camisas de lino para caballeros a RD$1,500" };
  const combo = { descripcion_anuncio: "COMBO 2 EN 1 cepillo secador + plancha RD$1,690" };

  assert.equal(respuestaMinima(rd, vacia, camisa), "¿Qué talla le interesa?");
  assert.equal(respuestaMinima(rd, { ...vacia, talla: "la M" }, camisa), "Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?");
  assert.equal(respuestaMinima(rd, vacia, combo), "Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?");
  assert.equal(respuestaMinima(rd, { ...vacia, direccion: "Los Alcarrizos, calle 3" }, combo), "¿A nombre de quién sale el pedido?");
  assert.match(respuestaMinima(rd, { ...vacia, direccion: "Los Alcarrizos, calle 3", nombre: "Ana Pérez" }, combo), /resumen de su pedido/);
  for (const f of [vacia, { ...vacia, direccion: "x", nombre: "y" }]) {
    assert.equal(respuestaMinima(rd, f, combo).includes("representante"), false);
  }
});

/**
 * EL CASO REAL: «Donde tuta» → «¿Qué número calza?»; «39» → «¿Qué número
 * calza?»; y otra vez. La respuesta mínima contesta lo que preguntó el
 * cliente y nunca manda dos veces seguidas la misma pregunta.
 */
test("la respuesta mínima contesta la pregunta del cliente y no se repite", () => {
  const zapatos = { descripcion_anuncio: "👞 ZAPATOS DCM ESTILO Elegancia que deja huella. 💰 RD$1,990 ✔️ Diseño elegante" };
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

  assert.equal(preguntaDelCliente("Donde tuta"), "ubicacion");
  assert.equal(preguntaDelCliente("¿Dónde están ubicados?"), "ubicacion");
  assert.equal(preguntaDelCliente("¿Cuánto es el envío?"), "envio");
  assert.equal(preguntaDelCliente("¿Cómo se paga?"), "pago");
  assert.equal(preguntaDelCliente("¿Cuánto cuesta?"), "precio");
  assert.equal(preguntaDelCliente("39"), null);
  assert.equal(preguntaDelCliente("Yo vivo en pekín"), null);

  // Preguntó dónde están: se le dice, y se sigue con la talla.
  const contesta = respuestaMinima(rd, vacia, zapatos, { ultimoDelCliente: "Donde tuta", ultimoDelAgente: "Claro que sí. ¿En qué provincia se encuentra?" });
  assert.ok(contesta.startsWith("Somos tienda virtual"), contesta);
  assert.ok(contesta.endsWith("¿Qué número calza?"));

  // Lo último que mandó el agente fue esa misma pregunta: se pregunta de otra forma.
  const otra = respuestaMinima(rd, vacia, zapatos, { ultimoDelCliente: "Yo vivo en pekín", ultimoDelAgente: "¿Qué número calza?" });
  assert.notEqual(otra, "¿Qué número calza?");
  assert.ok(otra.includes("número que calza"), otra);

  // Con la talla ya en la ficha, el siguiente paso es la provincia.
  assert.equal(respuestaMinima(rd, { ...vacia, talla: "39" }, zapatos, { ultimoDelAgente: "¿Qué número calza?" }), "Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?");

  // El envío se contesta con la tarifa del cliente si se sabe dónde está, y con las dos si no.
  assert.equal(respuestaDirecta(rd, "¿cuánto es el envío?", zapatos, "Santiago"), "El envío a su zona le sale en RD$290.");
  assert.match(respuestaDirecta(rd, "¿hacen envíos?", zapatos, null)!, /RD\$250 en .+ y RD\$290 al resto del país/);
  assert.match(respuestaDirecta(rd, "¿cómo se paga?", zapatos, null)!, /contra entrega/);
  assert.equal(respuestaDirecta(rd, "¿cuánto cuesta?", zapatos, null), "ZAPATOS DCM ESTILO Elegancia que deja huella está en RD$1,990.");
  assert.equal(respuestaDirecta(cr, "¿dónde están?", zapatos, null), cr.ubicacion.tiendaFisica);
});
