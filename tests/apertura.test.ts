import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais } from "../src/agents";
import { aperturaSegura, articuloDeLaDescripcion, clienteAplazaCompra, llevaColor, mensajeSinProducto, precioDeLaDescripcion, preguntaDelCliente, primeraPregunta, respuestaDirecta, respuestaMinima, resumenMecanico, tallasDisponibles } from "../src/lib/apertura";
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

  /*
   * EL CASO REAL: al cliente le llegó «🖤 ORDENA, RECIBE Y LUEGO PAGA!! Luce un
   * estilo exclusivo con zapatos de… 🖤» como nombre del artículo. Cuando
   * delante del producto solo hay reclamo, el nombre empieza donde el anuncio
   * dice QUÉ vende.
   */
  const eslogan = "Compra seguro! ORDENA, RECIBE Y LUEGO PAGA!! Luce un estilo exclusivo con zapatos de acabado premium, diseñados para hombres que valoran la elegancia y la calidad. 💰 Precio: RD$2,500 ✅ Acabado de lujo";
  assert.equal(articuloDeLaDescripcion(eslogan, "RD$"), "Zapatos de acabado premium");
  assert.equal(precioDeLaDescripcion(eslogan, "RD$"), "RD$2,500");
  // Pero un adjetivo delante del producto sí es parte del nombre.
  assert.equal(articuloDeLaDescripcion("Elegantes zapatos de cuero RD$2,500", "RD$"), "Elegantes zapatos de cuero");

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

/**
 * EL CASO REAL (2026-09-07): «Tiene otro combo de mas alto precio que sea de
 * más calidad» → «Combo 2 En 1 está en RD$1,690. Indique su dirección exacta
 * de entrega.». Le contestamos el precio de lo que ya tenía delante, y encima
 * le pedimos la dirección de un pedido que no ha aceptado. Pedir OTRO artículo
 * es de los casos en los que el guion manda pasar el chat a un representante.
 */
test("pedir otro artículo no es preguntar el precio de este: pasa a un representante", () => {
  const combo = { descripcion_anuncio: "COMBO 2 EN 1 cepillo secador + plancha RD$1,690" };
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const pide = "Tiene otro combo de mas alto precio que sea de más calidad";

  assert.equal(preguntaDelCliente(pide), "otro_articulo");
  assert.equal(preguntaDelCliente("¿Tienen otro modelo?"), "otro_articulo");
  assert.equal(preguntaDelCliente("tienen algo mas barato?"), "otro_articulo");
  assert.equal(
    respuestaMinima(rd, vacia, combo, { ultimoDelCliente: pide }),
    "Permítame un momento, le transfiero con un representante.",
    "y sin pedirle detrás la dirección de un pedido que no ha aceptado",
  );

  // Otra talla, otro color o el precio por docena son de ESTE artículo: la venta sigue.
  assert.equal(preguntaDelCliente("¿Tienen otro color?"), null);
  assert.equal(preguntaDelCliente("¿hay otra talla?"), "tallas");
  assert.equal(preguntaDelCliente("¿me sale más barato si llevo 3?"), null);
  assert.equal(preguntaDelCliente("cuanto cuesta?"), "precio");
  assert.equal(respuestaMinima(rd, vacia, combo, { ultimoDelCliente: "¿Tienen otro color?" }), "Indique su dirección exacta de entrega.");
});

test("«para cuando» es una pregunta del cliente, no el color de su pedido", () => {
  assert.equal(preguntaDelCliente("Para cuando"), "tiempo");
  assert.equal(preguntaDelCliente("pa cuando lo tengo"), "tiempo");
  assert.equal(respuestaDirecta(rd, "Para cuando", null), "Entre 24 y 48 horas.");
});

test("clasifica talla y color solo en las familias permitidas", () => {
  /*
   * Los polos llevan talla: lo dice la tabla de tallas de la propia tienda
   * («Camisas, t-shirts, polos y boxers: de la S a la XXL»). El caso real: a
   * un anuncio de «POLOS BRONX» no se le preguntaba la talla, y el «XXL» que
   * contestó el cliente no valía para nada.
   */
  const polos = "🖤 POLOS BRONX ORIGINALES 🖤 Moderno, Fresco y duradero RD$1,400";
  assert.equal(primeraPregunta(polos, rd), "¿Qué talla le interesa?");
  assert.equal(tallasDisponibles(polos, rd), "de la S a la XXL");
  assert.equal(primeraPregunta("Bóxers Bronx RD$900", rd), "¿Qué talla le interesa?");

  assert.equal(primeraPregunta("Faja reversible RD$1,500", rd), "Indique su dirección exacta de entrega.");
  assert.equal(primeraPregunta("Correa de cuero RD$1,500", rd), "¿Qué talla le interesa?");
  assert.equal(primeraPregunta("Cinturón reversible ₡9.000", cr), "¿Qué talla le interesa?");
  assert.equal(primeraPregunta("Vestido de dama RD$1,500", rd), "Indique su dirección exacta de entrega.");
  assert.equal(primeraPregunta("Combo cepillo secador y plancha RD$1,690", rd), "Indique su dirección exacta de entrega.");
  assert.equal(llevaColor("Camisa de lino RD$1,500 en blanco, azul y negro"), true);
  assert.equal(llevaColor("Combo cepillo secador y plancha RD$1,690 en negro y rosa"), false);
  const camisa = { descripcion_anuncio: "Camisa de lino RD$1,500 en blanco, azul y negro" };
  const ficha = { talla: "M", color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  assert.equal(respuestaMinima(rd, ficha, camisa), "¿Qué color le interesa?");
});

test("en Costa Rica una faja abre con dirección y no con talla", () => {
  const faja = { descripcion_anuncio: "FAJA REVERSIBLE PARA HOMBRE ₡9.000" };
  assert.equal(primeraPregunta(faja.descripcion_anuncio, cr), "Indique su dirección exacta de entrega.");
  const texto = aperturaSegura(cr, faja, "Hola! Bienvenido(a) a TELLERIA. Gracias por escribirnos.")!;
  assert.match(texto, /FAJA REVERSIBLE PARA HOMBRE/i);
  assert.ok(texto.endsWith("Indique su dirección exacta de entrega."));
  assert.equal(texto.includes("¿Qué talla"), false);
});

test("una compra aplazada no repite la pregunta del pedido", () => {
  const combo = { descripcion_anuncio: "Combo cepillo secador y plancha RD$1,690" };
  const ficha = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  assert.equal(clienteAplazaCompra("Ahora no querida"), true);
  assert.equal(clienteAplazaCompra("No tengo recursos en este momento"), true);
  assert.equal(
    respuestaMinima(rd, ficha, combo, { ultimoDelCliente: "Ahora no querida" }),
    "Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.",
  );
});

/**
 * «EL LUNES LE LLAMO» ES UN «AHORA NO» CON FECHA (RD, 2026-09-07).
 *
 * El caso real: se le pidió la dirección, contestó «El lunes le llamo» y el
 * agente siguió como si nada —«Perfecto, hasta esa fecha. ¿Me facilita su
 * número de teléfono para el pedido?»— y horas después le salió encima el
 * recordatorio de «se quedó en visto». Aquí casi nadie dice «no puedo ahora»:
 * dice cuándo vuelve.
 */
test("el cliente que dice cuándo vuelve se despide, no se le sigue pidiendo el pedido", () => {
  const combo = { descripcion_anuncio: "Combo cepillo secador y plancha RD$1,690" };
  const ficha = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

  for (const aplaza of [
    "El lunes le llamo", "el lunes le escribo", "Mañana le aviso", "Le escribo luego",
    "cuando cobre le escribo", "El viernes lo ordeno", "en la quincena hago el pedido",
    "Ya le aviso", "más adelante compro",
  ]) {
    assert.equal(clienteAplazaCompra(aplaza), true, `«${aplaza}» aplaza la compra`);
  }

  // Y lo que NO aplaza sigue siendo la venta de ahora: una pregunta por el
  // envío lleva las mismas palabras y no despide a nadie.
  for (const sigue of [
    "¿Me llega mañana?", "¿El lunes me lo traen?", "Mándemelo mañana",
    "Santiago, calle Duarte 45", "8095551234", "la 42 en negro",
  ]) {
    assert.equal(clienteAplazaCompra(sigue), false, `«${sigue}» no aplaza nada`);
  }

  assert.equal(
    respuestaMinima(rd, ficha, combo, {
      ultimoDelCliente: "El lunes le llamo",
      ultimoDelAgente: "Gracias. Indique su dirección exacta de entrega.",
    }),
    "Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.",
  );
});

test("la apertura segura lleva saludo, artículo, precio y pregunta, y nada inventado", () => {
  const texto = aperturaSegura(
    rd,
    { producto_anuncio: "Rincondcm", descripcion_anuncio: "🔥 ¡COMPRA SEGURO! 🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora." },
    saludo,
  )!;
  // La dueña (2026-09-07): sin corazones. Saludo, artículo, precio y pregunta.
  assert.ok(texto.startsWith(`${saludo}\nCombo 2 En 1\nRD$1,690\n`), "el formato del documento: saludo, producto, precio y pregunta");
  assert.equal(texto.includes("🖤"), false, "los corazones ya no van en el mensaje");
  assert.ok(texto.endsWith("Indique su dirección exacta de entrega."), "la cantidad no se pregunta nunca");
  assert.equal(/cu[aá]nt/i.test(texto), false);
  assert.equal(texto.includes("talla"), false, "un combo no lleva talla");
  assert.equal(texto.includes("Un momento"), false);

  // Sin descripción con precio, no hay apertura segura: toca transferir.
  assert.equal(aperturaSegura(rd, { producto_anuncio: "Rincondcm", descripcion_anuncio: "Escríbenos" }, saludo), null);
  assert.equal(aperturaSegura(rd, null, saludo), null);
});

test("sin producto en contexto, la respuesta mínima solo pregunta el artículo", () => {
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  assert.equal(
    respuestaMinima(rd, vacia, null),
    "Hola, le asiste Orlanda de RINCON DCM. ¿Cuál es el artículo de su interés?",
  );
});

test("cada agente pregunta primero por el artículo sin contexto de producto", () => {
  assert.equal(mensajeSinProducto(rd), "Hola, le asiste Orlanda de RINCON DCM. ¿Cuál es el artículo de su interés?");
  assert.equal(mensajeSinProducto(cr), "Hola, le asiste Mildred, un gusto. ¿Cuál es el artículo de su interés?");
  assert.equal(mensajeSinProducto(pa), "Hola, le asiste un asesor de ventas de la tienda. ¿Cuál es el artículo de su interés?");
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
  const cierreDirecto = respuestaMinima(rd, { ...vacia, cantidad: "1", direccion: "Los Alcarrizos, calle 3", nombre: "Ana Pérez", celular: "8095551234" }, combo);
  assert.ok(contieneMarcador(cierreDirecto, "Resumen:"));
  assert.equal(cierreDirecto.includes("¿Se lo despacho"), false);
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
  const faja = { descripcion_anuncio: "CORREA REVERSIBLE PARA HOMBRE, cuero de primera, ₡9.000" };
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

/** Con todos los datos, el resumen sale directamente y lleva la transferencia. */
test("con todos los datos sale directamente el resumen del pedido", () => {
  const combo = { descripcion_anuncio: "🔥 ¡COMPRA SEGURO! 🔥 ❤️ COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora.", producto_anuncio: "Combo 2 en 1" };
  const ficha = { talla: null, color: null, direccion: "Calle 3 #12, Los Mina, Santo Domingo Este", nombre: "Ana Pérez", celular: "8095551234", cantidad: "1" };

  // En cuanto da la dirección: «Perfecto, hasta <zona>…», con su envío y el teléfono en el mismo mensaje.
  const perfecto = respuestaMinima(rd, { ...ficha, nombre: null, celular: null }, combo, { ultimoDelCliente: "Calle 3 #12, Los Mina, Santo Domingo Este", ultimoDelAgente: "Indique su dirección exacta de entrega." });
  assert.equal(perfecto, "Perfecto, hasta Gran Santo Domingo el envío le sale en RD$250.\n¿Me facilita su número de teléfono para el pedido?");
  const interior = respuestaMinima(rd, { ...ficha, direccion: "Estoy en Santiago", nombre: null, celular: null }, combo, { ultimoDelCliente: "Estoy en Santiago", ultimoDelAgente: "Indique su dirección exacta de entrega." });
  assert.ok(interior.startsWith("Perfecto, hasta Santiago el envío le sale en RD$290."), interior);

  const resumen = respuestaMinima(rd, ficha, combo, { ultimoDelCliente: "Ana Pérez", ultimoDelAgente: "¿A nombre de quién sale el pedido?", telefonoDelChat: "18095550000" });
  assert.ok(contieneMarcador(resumen, "Resumen:"), "lleva la cabecera que registra la venta");
  assert.equal(resumen.includes("¿Se lo facturamos"), false);
  assert.equal(resumen.includes("¿Se lo despacho"), false);
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
  const base = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

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
  const resumen = respuestaMinima(cr, completo, faja, {});
  assert.ok(resumen.startsWith("📋 RESUMEN DEL PEDIDO"), resumen);
  assert.equal(resumen.includes("¿Se lo despacho"), false);
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

/** Panamá, artículo sin talla ni color: del precio al corregimiento, sin talla, color ni cantidad. */
test("en Panamá una mochila se vende sin preguntar talla, color ni cantidad", () => {
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const mochila = { producto_anuncio: "Tienda", descripcion_anuncio: "MOCHILA ANTIRROBO 45 LITROS US$35.00 · Impermeable · Puerto USB · Envío a domicilio en todo el país" };
  assert.equal(primeraPregunta(mochila.descripcion_anuncio, pa), "¿A qué corregimiento se lo enviamos?");
  assert.equal(respuestaMinima(pa, vacia, mochila), "¿A qué corregimiento se lo enviamos?");
  const texto = aperturaSegura(pa, mochila, "¡Hola! Bienvenido(a).")!;
  assert.equal(/talla|color|cu[aá]nt/i.test(texto), false, texto);
});
