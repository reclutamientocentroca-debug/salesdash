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
const pa = agenteDePais("pa")!;
const saludo = "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.";

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
  assert.equal(primeraPregunta("ZAPATOS DCM ESTILO RD$1,990", rd), "¿Qué talla le interesa?", "en RD la talla se pide como talla, también en calzado");
  assert.equal(primeraPregunta("ZAPATOS DE CUERO ₡25.000", cr), "¿Qué número calza?");
  assert.equal(primeraPregunta("COMBO 2 EN 1 cepillo secador + plancha RD$1,690", rd), "Indique su dirección exacta de entrega.", "sin talla, la cantidad no se pregunta: a dónde se lo enviamos");
  assert.equal(primeraPregunta("Plancha alisadora ₡18.000", cr), "Indique su dirección exacta de entrega.");
  assert.equal(primeraPregunta("Cepillo secador US$35", pa), "¿A qué corregimiento se lo enviamos?");
  assert.equal(primeraPregunta("Camisa de lino ₡25.000", cr), "¿Qué talla le interesa?");
});

test("la apertura segura lleva saludo, artículo, precio y pregunta, y nada inventado", () => {
  const texto = aperturaSegura(
    rd,
    { producto_anuncio: "Rincondcm", descripcion_anuncio: "🔥 ¡COMPRA SEGURO! 🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora." },
    saludo,
  )!;
  assert.ok(texto.startsWith(`${saludo}\n🖤 Combo 2 En 1 🖤\nRD$1,690\n`), "el formato del documento: saludo, producto, precio y pregunta");
  assert.ok(texto.endsWith("Indique su dirección exacta de entrega."), "la cantidad no se pregunta nunca");
  assert.equal(/cu[aá]nt/i.test(texto), false);
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
  assert.equal(respuestaMinima(rd, { ...vacia, talla: "la M" }, camisa), "Indique su dirección exacta de entrega.");
  assert.equal(respuestaMinima(rd, vacia, combo), "Indique su dirección exacta de entrega.", "un combo no lleva talla: a dónde se lo enviamos, sin preguntar cuántos");
  assert.equal(
    respuestaMinima(rd, { ...vacia, cantidad: "1", direccion: "Los Alcarrizos, calle 3" }, combo),
    "Perfecto, hasta Gran Santo Domingo el envío le sale en RD$250.\n¿Me facilita su número de teléfono para el pedido?",
    "con la dirección, el envío y el teléfono en el mismo mensaje",
  );
  assert.equal(respuestaMinima(rd, { ...vacia, cantidad: "1", direccion: "Los Alcarrizos, calle 3", celular: "8095551234" }, combo), "¿A nombre de quién sale el pedido?", "después del teléfono, el nombre");
  assert.match(respuestaMinima(rd, { ...vacia, cantidad: "1", direccion: "Los Alcarrizos, calle 3", nombre: "Ana Pérez", celular: "8095551234" }, combo), /^Le confirmo: .*¿Se lo despacho hoy mismo\?$/s);
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
  assert.ok(contesta.endsWith("¿Qué talla le interesa?"));

  // Lo último que mandó el agente fue esa misma pregunta: se pregunta de otra forma.
  const otra = respuestaMinima(rd, vacia, zapatos, { ultimoDelCliente: "Yo vivo en pekín", ultimoDelAgente: "¿Qué talla le interesa?" });
  assert.notEqual(otra, "¿Qué talla le interesa?");
  assert.ok(otra.includes("¿Cuál talla le interesa?"), otra);
  assert.ok(!otra.includes("apart"), "la empresa no aparta nada");

  // Con la talla ya en la ficha, el siguiente paso es la provincia.
  assert.equal(respuestaMinima(rd, { ...vacia, talla: "39" }, zapatos, { ultimoDelAgente: "¿Qué número calza?" }), "Indique su dirección exacta de entrega.");

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
  const ficha = { talla: null, color: null, direccion: "Calle 3 #12, Los Mina, Santo Domingo Este", nombre: "Ana Pérez", celular: "8095551234", cantidad: "1" };

  // En cuanto da la dirección: «Perfecto, hasta <zona>…», con su envío y el teléfono en el mismo mensaje.
  const perfecto = respuestaMinima(rd, { ...ficha, nombre: null, celular: null }, combo, { ultimoDelCliente: "Calle 3 #12, Los Mina, Santo Domingo Este", ultimoDelAgente: "Indique su dirección exacta de entrega." });
  assert.equal(perfecto, "Perfecto, hasta Gran Santo Domingo el envío le sale en RD$250.\n¿Me facilita su número de teléfono para el pedido?");
  const interior = respuestaMinima(rd, { ...ficha, direccion: "Estoy en Santiago", nombre: null, celular: null }, combo, { ultimoDelCliente: "Estoy en Santiago", ultimoDelAgente: "Indique su dirección exacta de entrega." });
  assert.ok(interior.startsWith("Perfecto, hasta Santiago el envío le sale en RD$290."), interior);

  // Con todos los datos: «Le confirmo: …», con el total y la pregunta de si se lo enviamos hoy.
  const pregunta = respuestaMinima(rd, ficha, combo, { ultimoDelCliente: "Ana Pérez", ultimoDelAgente: "¿A nombre de quién sale el pedido?" });
  assert.equal(
    pregunta,
    "Le confirmo: Combo 2 En 1, a nombre de Ana Pérez, entrega en Calle 3 #12, Los Mina, Santo Domingo Este.\n" +
      "Son RD$1,690 más RD$250 de envío, total RD$1,940, y se paga al recibir.\n¿Se lo despacho hoy mismo?",
  );

  // Y con el «okey» del cliente, el resumen con el formato de la dueña.
  const resumen = respuestaMinima(rd, ficha, combo, { ultimoDelCliente: "Okey lo espero gracias", ultimoDelAgente: pregunta, telefonoDelChat: "18095550000" });
  assert.ok(contieneMarcador(resumen, "Resumen:"), "lleva la cabecera que registra la venta");
  assert.equal(
    resumen,
    "📋 RESUMEN DEL PEDIDO\nNombre: Ana Pérez\nTelefono: 8095551234\nDireccion: Calle 3 #12, Los Mina, Santo Domingo Este\nProducto: Combo 2 En 1\nCantidad: 1\nEnvio: RD$250\nTOTAL A PAGAR: RD$1,940\nForma de pago: contra entrega\n✅ PEDIDO REGISTRADO\nPermítame un momento, le transfiero con un representante.",
    "el resumen, línea por línea, como lo escribió la dueña",
  );

  // Dos unidades al interior, con talla: se multiplica, y la zona es la provincia.
  const dos = resumenMecanico(rd, { ...ficha, talla: "42", cantidad: "2 pares", direccion: "Calle 1, Santiago" }, { descripcion_anuncio: "👞 ZAPATOS DCM ESTILO 💰 RD$1,990" }, { telefonoDelChat: "18095551234" })!;
  assert.ok(dos.includes("Talla: 42"));
  assert.ok(dos.includes("Cantidad: 2"));
  assert.ok(dos.includes("Envio: RD$290"));
  assert.ok(dos.includes("TOTAL A PAGAR: RD$4,270"), "3,980 + 290");
  assert.ok(!dos.includes("Zona:"), "sin línea de zona: el resumen es el del documento");

  // Sin precio en la descripción no se inventa un resumen.
  assert.equal(resumenMecanico(rd, ficha, { descripcion_anuncio: "Combo de cepillo y plancha, escríbenos" }, {}), null);
  // Y en Costa Rica, con la forma del guion de la dueña (2026-09-05) y su moneda.
  const tico = resumenMecanico(cr, { ...ficha, direccion: "Heredia centro, 100 norte de la iglesia" }, { descripcion_anuncio: "FAJA REVERSIBLE PARA HOMBRE ₡9.000" }, { telefonoDelChat: "50688881111" })!;
  assert.ok(tico.startsWith("📋 RESUMEN DEL PEDIDO\nNombre: "), tico);
  assert.ok(contieneMarcador(tico, "Resumen:"), "el título cuenta la venta");
  assert.ok(tico.includes("Telefono: 8095551234"), "el que dio el cliente, no el del chat");
  assert.ok(tico.includes("Envio: ₡3.500"));
  assert.ok(tico.includes("TOTAL A PAGAR: ₡12.500"));
  assert.ok(tico.includes("Forma de pago: contra entrega"), "Heredia va a domicilio");
  assert.ok(tico.endsWith("✅ PEDIDO REGISTRADO\nLe conecto con un representante para finalizar. Aguarde un momento."), "con la frase de cierre de Costa Rica");

  // Al interior, por correo y por adelantado.
  const ticoInterior = resumenMecanico(cr, { ...ficha, direccion: "Liberia, Guanacaste" }, { descripcion_anuncio: "FAJA REVERSIBLE PARA HOMBRE ₡9.000" }, { telefonoDelChat: "50688881111" })!;
  assert.ok(ticoInterior.includes("Forma de pago: SINPE o transferencia por adelantado"));
});

/**
 * EL ORDEN DE COSTA RICA, según el guion de la dueña (2026-09-05): con la
 * dirección se dice cómo llega, el envío y cuándo se paga, y en el mismo
 * mensaje se pide el teléfono; después el nombre; y el cierre pregunta «¿Se
 * lo despacho hoy mismo?».
 */
test("en Costa Rica el envío y el teléfono van juntos tras la dirección, y el cierre despacha", () => {
  const faja = { descripcion_anuncio: "FAJA REVERSIBLE PARA HOMBRE ₡9.000" };
  const base = { talla: "34", color: null, direccion: null, nombre: null, celular: null, cantidad: null };

  const pideDireccion = respuestaMinima(cr, base, faja, {});
  assert.equal(pideDireccion, "Indique su dirección exacta de entrega.");

  const conDireccion = { ...base, direccion: "Escazú centro, 200 sur de la iglesia" };
  const logistica = respuestaMinima(cr, conDireccion, faja, { ultimoDelCliente: conDireccion.direccion });
  assert.ok(logistica.startsWith("Perfecto, hasta Zona de entrega a domicilio se lo llevamos a domicilio. El envío es ₡3.500 y paga al recibir."), logistica);
  assert.ok(logistica.endsWith("¿Me facilita su número de teléfono para el pedido?"));

  const alInterior = respuestaMinima(cr, { ...base, direccion: "Liberia, Guanacaste" }, faja, {});
  assert.ok(alInterior.includes("va por correo y lo retira en la sucursal más cercana"), alInterior);
  assert.ok(alInterior.includes("el pago va por adelantado, por SINPE o transferencia"));

  const conTelefono = { ...conDireccion, celular: "88881111" };
  assert.equal(respuestaMinima(cr, conTelefono, faja, {}), "¿A nombre de quién sale el pedido?");

  const completo = { ...conTelefono, nombre: "Cliente" };
  const confirmacion = respuestaMinima(cr, completo, faja, {});
  assert.ok(confirmacion.startsWith("Le confirmo: Faja Reversible Para Hombre, talla 34, a nombre de Cliente, entrega en Escazú centro"), confirmacion);
  assert.ok(confirmacion.includes("Son ₡9.000 más ₡3.500 de envío, total ₡12.500, se paga al recibir."));
  assert.ok(confirmacion.endsWith("¿Se lo despacho hoy mismo?"));

  // Y cuando dice que sí, el resumen sale en ese mismo mensaje.
  const resumen = respuestaMinima(cr, completo, faja, { ultimoDelAgente: confirmacion, ultimoDelCliente: "Sí" });
  assert.ok(resumen.startsWith("📋 RESUMEN DEL PEDIDO"), resumen);
});

/**
 * LA CAPTURA DE LA DUEÑA (2026-09-05): «¡Hola! Quiero más información. Dónde
 * están ubicado» → sin saludo, y «¿A dónde se lo enviamos?» en vez de la talla.
 * La apertura saluda, contesta lo que preguntó en una línea y pregunta la talla.
 */
test("la apertura saluda, contesta lo que preguntó el cliente y pregunta la talla", () => {
  const zapatos = {
    producto_anuncio: "Rincondcm",
    descripcion_anuncio: "Compra seguro! ORDENA, RECIBE Y LUEGO PAGA!! Luce un estilo exclusivo con zapatos de acabado premium, diseñados para hombres que valoran la elegancia y la calidad. 💰 Precio: RD$2,500 ✅ Acabado de lujo",
  };
  const texto = aperturaSegura(rd, zapatos, "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.", "¡Hola! Quiero más información\nDónde están ubicado")!;
  const lineas = texto.split("\n");
  assert.equal(lineas[0], "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.");
  assert.equal(lineas[1], "Somos tienda virtual, le llevamos el pedido hasta su casa.", "la respuesta, en una línea, después del saludo");
  assert.ok(texto.includes("RD$2,500"));
  assert.ok(texto.endsWith("¿Qué talla le interesa?"), "y la pregunta que toca: la talla");

  // Sin pregunta del cliente, sin línea de más.
  const limpio = aperturaSegura(rd, zapatos, "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.", "¡Hola! Quiero más información")!;
  assert.ok(!limpio.includes("tienda virtual"));
  // Y preguntar el precio no añade nada: el precio ya va.
  const precio = aperturaSegura(rd, zapatos, "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.", "¿Cuánto cuestan?")!;
  assert.equal(precio.split("\n").length, 4);
});
