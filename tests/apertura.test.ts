import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais } from "../src/agents";
import { aperturaSegura, articuloDeLaDescripcion, precioDeLaDescripcion, preguntaDelCliente, primeraPregunta, respuestaDirecta, respuestaMinima, resumenMecanico, tallasDisponibles } from "../src/lib/apertura";
import { contieneMarcador } from "../src/lib/cierre";

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
  assert.match(respuestaMinima(rd, { ...vacia, direccion: "Los Alcarrizos, calle 3", nombre: "Ana Pérez" }, combo), /¿Se lo facturamos y se lo enviamos\?/);
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

/** «¿Cuáles son los tamaños disponibles?» se contesta con las tallas de la tabla, antes de preguntar cuál. */
test("las tallas disponibles se contestan con la tabla de tallas", () => {
  const faja = { descripcion_anuncio: "FAJA REVERSIBLE PARA HOMBRE, cuero de primera, ₡9.000" };
  assert.equal(preguntaDelCliente("¿Cuáles son los tamaños disponibles?"), "tallas");
  assert.equal(preguntaDelCliente("¿qué tallas hay?"), "tallas");
  assert.equal(preguntaDelCliente("¿tienen la 42?"), null, "pedir una talla no es preguntar cuáles hay");
  assert.equal(tallasDisponibles(faja.descripcion_anuncio, cr), "de la 30 a la 42");
  assert.equal(tallasDisponibles("Camisas de lino RD$1,500", rd), "de la S a la XXL");
  assert.equal(tallasDisponibles("Plancha alisadora ₡12.000", cr), null, "una plancha no lleva talla");
  assert.equal(respuestaDirecta(cr, "¿Cuáles son los tamaños disponibles?", faja, null), "Las tallas disponibles son de la 30 a la 42.");

  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const r = respuestaMinima(cr, vacia, faja, { ultimoDelCliente: "¿Cuáles son los tamaños disponibles?", ultimoDelAgente: "Hola, le asiste Mildred de TELLERIA" });
  assert.ok(r.startsWith("Las tallas disponibles son de la 30 a la 42."), r);
  assert.ok(r.endsWith("¿Qué talla le interesa?"), "y después pregunta cuál, de usted");
});

/**
 * EL CIERRE SALE SÍ O SÍ. Con todos los datos se pregunta «¿Se lo facturamos
 * y se lo enviamos?», y cuando el cliente dice que sí, el resumen se manda en
 * ese mismo mensaje, armado con lo que él escribió: nunca más «ya le preparo
 * el resumen» sin resumen.
 */
test("con los datos se pide la confirmación, y con el sí sale el resumen armado con lo del cliente", () => {
  const combo = { descripcion_anuncio: "🔥 ¡COMPRA SEGURO! 🔥 ❤️ COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora.", producto_anuncio: "Combo 2 en 1" };
  const ficha = { talla: null, color: null, direccion: "Calle 3 #12, Los Mina, Santo Domingo Este", nombre: "Ana Pérez", celular: null, cantidad: null };

  const pregunta = respuestaMinima(rd, ficha, combo, { ultimoDelCliente: "Ana Pérez", ultimoDelAgente: "¿A nombre de quién sale el pedido?" });
  assert.equal(pregunta, "Ya tengo sus datos. ¿Se lo facturamos y se lo enviamos?");

  const resumen = respuestaMinima(rd, ficha, combo, { ultimoDelCliente: "Sí", ultimoDelAgente: pregunta, telefonoDelChat: "18095551234" });
  assert.ok(contieneMarcador(resumen, "Resumen:"), "lleva la cabecera que registra la venta");
  assert.ok(resumen.includes("Nombre: Ana Pérez"));
  assert.ok(resumen.includes("Teléfono: 18095551234"), "el teléfono del chat");
  assert.ok(resumen.includes("Dirección: Calle 3 #12, Los Mina, Santo Domingo Este"));
  assert.ok(resumen.includes("Producto: Combo 2 En 1"));
  assert.ok(resumen.includes("Costo de envío: RD$250"), "Santo Domingo Este es ciudad");
  assert.ok(resumen.includes("TOTAL A PAGAR: RD$1,940"), "1,690 + 250");
  assert.ok(resumen.includes("Su pedido ha sido confirmado exitosamente."));
  assert.ok(resumen.includes("Se lo enviamos dentro de 24 a 48 horas."));
  assert.ok(!resumen.includes("despach"));

  // Dos unidades al interior, con talla: se multiplica y va la variante.
  const dos = resumenMecanico(rd, { ...ficha, talla: "42", cantidad: "2 pares", direccion: "Calle 1, Santiago" }, { descripcion_anuncio: "👞 ZAPATOS DCM ESTILO 💰 RD$1,990" }, { telefonoDelChat: "18095551234" })!;
  assert.ok(dos.includes("Variante: 42"));
  assert.ok(dos.includes("Cantidad: 2"));
  assert.ok(dos.includes("Costo del producto: RD$3,980"));
  assert.ok(dos.includes("Costo de envío: RD$290"));
  assert.ok(dos.includes("TOTAL A PAGAR: RD$4,270"));

  // Sin precio en la descripción no se inventa un resumen.
  assert.equal(resumenMecanico(rd, ficha, { descripcion_anuncio: "Combo de cepillo y plancha, escríbenos" }, {}), null);
  // Y en Costa Rica, con su forma y su moneda.
  const tico = resumenMecanico(cr, { ...ficha, direccion: "Heredia centro, 100 norte de la iglesia" }, { descripcion_anuncio: "FAJA REVERSIBLE PARA HOMBRE ₡9.000" }, { telefonoDelChat: "50688881111" })!;
  assert.ok(tico.startsWith("Resumen de su pedido:"));
  assert.ok(tico.includes("Costo de envío: ₡3.500"));
  assert.ok(tico.includes("Total a pagar: ₡12.500"));
  assert.ok(tico.includes("Conectando con representante..."));
});
