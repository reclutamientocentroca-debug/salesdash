import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais, precioPorCantidad } from "../src/agents";
import { fichaDelPedido } from "../src/lib/memoria";
import { aperturaSegura, articuloDeLaDescripcion, cantidadDicha, clienteAplazaCompra, clientePideOtraFamilia, clienteRenunciaALaCompra, familiasNombradas, llevaColor, llevaTalla, mensajeSinProducto, precioDeLaDescripcion, preguntaDelCliente, preguntaDeDireccion, primeraPregunta, respuestaDirecta, respuestaMinima, resumenMecanico, tallasDisponibles } from "../src/lib/apertura";
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
  assert.equal(primeraPregunta("COMBO 2 EN 1 cepillo secador + plancha RD$1,690", rd), "Indíquenos a qué dirección y provincia le enviamos.", "sin talla, la cantidad no se pregunta: a dónde se lo enviamos");
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
  // Y desde el 2026-09-10 no solo «no es otro artículo»: es una pregunta de
  // precio por cantidad, y se le contesta con el tramo que le toca.
  assert.equal(preguntaDelCliente("¿me sale más barato si llevo 3?"), "precio_cantidad");
  assert.equal(preguntaDelCliente("cuanto cuesta?"), "precio");
  assert.equal(respuestaMinima(rd, vacia, combo, { ultimoDelCliente: "¿Tienen otro color?" }), "Indíquenos a qué dirección y provincia le enviamos.");
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

  assert.equal(primeraPregunta("Faja reversible RD$1,500", rd), "Indíquenos a qué dirección y provincia le enviamos.");
  assert.equal(primeraPregunta("Correa de cuero RD$1,500", rd), "¿Qué talla le interesa?");
  assert.equal(primeraPregunta("Cinturón reversible ₡9.000", cr), "¿Qué talla le interesa?");
  assert.equal(primeraPregunta("Vestido de dama RD$1,500", rd), "Indíquenos a qué dirección y provincia le enviamos.");
  assert.equal(primeraPregunta("Combo cepillo secador y plancha RD$1,690", rd), "Indíquenos a qué dirección y provincia le enviamos.");
  assert.equal(llevaColor("Camisa de lino RD$1,500 en blanco, azul y negro"), true);
  assert.equal(llevaColor("Combo cepillo secador y plancha RD$1,690 en negro y rosa"), false);
  const camisa = { descripcion_anuncio: "Camisa de lino RD$1,500 en blanco, azul y negro" };
  const ficha = { talla: "M", color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  assert.equal(respuestaMinima(rd, ficha, camisa), "¿Qué color le interesa?");
});

/**
 * CON QUÉ PALABRAS SE PIDE LA DIRECCIÓN, PAÍS POR PAÍS.
 *
 * La dueña (2026-09-09), viendo el chat de un combo: «esa pregunta podría ser
 * indíquenos a qué dirección y provincia le enviamos». «Indique su dirección
 * exacta de entrega.» suena a formulario y no pide lo que de verdad hace falta
 * para cobrar el envío: la provincia. Costa Rica se queda con la suya.
 */
test("cada país pide la dirección con sus palabras", () => {
  assert.equal(preguntaDeDireccion(rd), "Indíquenos a qué dirección y provincia le enviamos.");
  assert.equal(preguntaDeDireccion(cr), "Indique su dirección exacta de entrega.");
  assert.equal(preguntaDeDireccion(pa), "¿A qué corregimiento se lo enviamos?");

  // Es la que sale en el paso de la dirección y al final de la apertura.
  const combo = { descripcion_anuncio: "COMBO 2 EN 1 cepillo secador + plancha RD$1,690" };
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  assert.equal(respuestaMinima(rd, vacia, combo, {}), preguntaDeDireccion(rd));
  assert.ok(
    aperturaSegura(rd, combo, saludo)!.endsWith(preguntaDeDireccion(rd)),
    "y la apertura termina en ella",
  );

  // Y lo que el cliente conteste debajo sigue siendo su dirección: la frase no
  // lleva «?», así que la ficha la reconoce por el imperativo.
  const hilo = [
    { emisor: "ia" as const, content: preguntaDeDireccion(rd) },
    { emisor: "cliente" as const, content: "Los Alcarrizos, calle 3" },
  ];
  assert.equal(fichaDelPedido(hilo, rd).direccion, "Los Alcarrizos, calle 3");
});

/**
 * «¿DÓNDE SON HECHOS?» SE CONTESTA CON LO QUE DICE EL ANUNCIO.
 *
 * La dueña (2026-09-10): «debe de saber de qué material, ya que en el anuncio
 * lo dice: son originales». Quien pregunta esto está comprobando que no le van
 * a vender una copia —es de las últimas preguntas antes del sí— y se quedaba
 * sin respuesta.
 */
test("a «de qué son» se le contesta con el material y el «original» del anuncio", () => {
  const polos = { descripcion_anuncio: "🔥 POLOS BRONX ORIGINALES 🔥 Moderno, Fresco y duradero RD$1,400 C/U" };
  const correa = { descripcion_anuncio: "CORREA REVERSIBLE cuero de primera RD$1,500" };
  const camisas = { descripcion_anuncio: "CAMISAS DE LINO ORIGINALES RD$1,800" };
  const mochila = { descripcion_anuncio: "MOCHILA ANTIRROBO 45 LITROS RD$2,000" };

  for (const q of ["Donde son hechos", "¿de qué material son?", "¿son originales?", "¿de qué están hechos?"]) {
    assert.equal(preguntaDelCliente(q), "producto", q);
  }
  // Pedir OTRO de mejor calidad no es esto: eso es pedir otro artículo.
  assert.equal(preguntaDelCliente("¿tiene otro de mejor calidad?"), "otro_articulo");

  // Se contesta con lo que hay escrito, en singular o en plural según el artículo.
  assert.equal(respuestaDirecta(rd, "Donde son hechos", polos, null), "Son originales.");
  assert.equal(respuestaDirecta(rd, "¿de qué material son?", correa, null), "Es de cuero.");
  assert.equal(respuestaDirecta(rd, "¿de qué material son?", camisas, null), "Son originales, de lino.");

  // Y lo que el anuncio no dice, no se inventa: ahí no hay respuesta mecánica.
  assert.equal(respuestaDirecta(rd, "¿de qué material son?", mochila, null), null);

  // Va delante del paso que tocaba, como cualquier pregunta del cliente.
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  assert.equal(
    respuestaMinima(rd, vacia, polos, { ultimoDelCliente: "Donde son hechos" }),
    "Son originales.\n\n¿Qué talla le interesa?",
  );

  // Y «yo le aviso» es «ya le aviso»: el que se despide no recibe formulario.
  assert.equal(clienteAplazaCompra("Yo le aviso"), true);
  assert.equal(clienteAplazaCompra("yo le llevo la talla"), false);
});

/**
 * AL POR MAYOR SE VENDE COMO UN PROFESIONAL: SE CONTESTA LO QUE PREGUNTA Y SE
 * LE ENSEÑA EL ESCALÓN DE ARRIBA.
 *
 * La captura de la dueña (Messenger, 2026-09-10): «¿Cuál es el precio de una
 * docena?» → «Indíquenos a qué dirección y provincia le enviamos.». Y su regla,
 * en dos frases: «debe responder lo que el cliente pregunta o dice» y «debe
 * vender como profesional de ventas al por mayor».
 */
test("una pregunta por el precio de varias se contesta, y se le enseña el tramo siguiente", () => {
  const polos = { descripcion_anuncio: "POLOS BRONX ORIGINALES RD$1,400 C/U RD$1,190 al por mayor" };
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

  // Como se pregunta aquí: con el pronombre en medio, o sin nombrar el precio.
  for (const q of ["¿Cuál es el precio de una docena?", "¿a cómo me salen 3?", "¿y si llevo 6?", "¿en cuánto me sale la docena?", "¿a cómo me los deja llevando 4?"]) {
    assert.equal(preguntaDelCliente(q), "precio_cantidad", q);
  }
  // Y lo que no pregunta por dinero, sigue sin preguntarlo.
  assert.equal(preguntaDelCliente("si llevo la M me sirve?"), null, "eso pregunta por la talla");
  assert.equal(preguntaDelCliente("Talla L"), null);

  // Tres van al tramo de 3 a 11, y se le enseña la docena, que es más barata.
  const tres = respuestaDirecta(rd, "¿a cómo me salen 3?", polos, null)!;
  assert.ok(tres.startsWith("Las 3 unidades le salen a RD$1,190 cada una: RD$3,570."), tres);
  assert.match(tres, /desde 12 le salen a RD\$990 cada una/);

  // Con la docena ya pedida no hay nada mejor que ofrecer: no se insiste.
  assert.equal(
    respuestaDirecta(rd, "¿Cuál es el precio de una docena?", polos, null),
    "Las 12 unidades le salen a RD$990 cada una: RD$11,880.",
  );

  /*
   * Y SE CONTESTA EN CUALQUIER PASO DEL PEDIDO. El paso del teléfono salía
   * derecho al costo del envío: la pregunta del cliente se quedaba sin
   * contestar justo cuando se le pide un dato personal.
   */
  const conDireccion = { ...vacia, talla: "L", color: "azul", direccion: "Los Alcarrizos" };
  const enElTelefono = respuestaMinima(rd, conDireccion, polos, { ultimoDelCliente: "¿Cuál es el precio de una docena?" });
  assert.ok(enElTelefono.startsWith("Las 12 unidades le salen a RD$990 cada una: RD$11,880."), enElTelefono);
  assert.match(enElTelefono, /el envío le sale en RD\$250/);
  assert.match(enElTelefono, /¿Me facilita su número de teléfono para el pedido\?$/);

  // Sin pregunta colgando, ese paso sigue siendo el de siempre.
  assert.ok(
    respuestaMinima(rd, conDireccion, polos, {}).startsWith("Perfecto, hasta Gran Santo Domingo el envío le sale en RD$250."),
  );
});

/**
 * EL PRECIO DE UN POLO DEPENDE DE CUÁNTOS LLEVE.
 *
 * La dueña (2026-09-09): «los polos, de 1 unidad a 2 cuestan 1,400; de 3 a 11
 * piezas, 1,190; por docena, 990 cada uno». Antes solo existía el precio del
 * anuncio: al que llevaba tres se le cobraban tres a RD$1,400, y al que
 * preguntaba por la docena se le pasaba a un representante.
 */
test("los polos dominicanos cambian de precio con la cantidad", () => {
  const polos = { descripcion_anuncio: "🖤 POLOS BRONX ORIGINALES 🖤 Moderno, Fresco y duradero RD$1,400" };

  assert.equal(precioPorCantidad(rd, polos.descripcion_anuncio, 1, 1400), 1400);
  assert.equal(precioPorCantidad(rd, polos.descripcion_anuncio, 2, 1400), 1400);
  assert.equal(precioPorCantidad(rd, polos.descripcion_anuncio, 3, 1400), 1190);
  assert.equal(precioPorCantidad(rd, polos.descripcion_anuncio, 11, 1400), 1190);
  assert.equal(precioPorCantidad(rd, polos.descripcion_anuncio, 12, 1400), 990, "la docena");
  assert.equal(precioPorCantidad(rd, polos.descripcion_anuncio, 24, 1400), 990);

  // El precio del anuncio manda: un polo anunciado a otro precio es otro polo,
  // y una camisa no es un polo.
  assert.equal(precioPorCantidad(rd, "POLOS X RD$1,500", 3, 1500), 1500);
  assert.equal(precioPorCantidad(rd, "Camisa de lino RD$1,400", 3, 1400), 1400);
  // Y en los otros países no hay lista: el precio escrito, siempre.
  assert.equal(precioPorCantidad(cr, "Polos ₡12.500", 12, 12500), 12500);

  // El resumen cobra el tramo que toca, con el envío una sola vez.
  const ficha = { talla: "L", color: "negro", direccion: "Los Alcarrizos, calle 3", nombre: "Ana Pérez", celular: "8095551234", cantidad: null };
  const total = (cantidad: string) =>
    resumenMecanico(rd, { ...ficha, cantidad }, polos, { telefonoDelChat: "8095551234" })!
      .split("\n")
      .find((l) => l.startsWith("TOTAL A PAGAR"));

  assert.equal(total("1"), "TOTAL A PAGAR: RD$1,650", "1400 + 250 de envío");
  assert.equal(total("3"), "TOTAL A PAGAR: RD$3,820", "tres a 1,190 + 250");
  assert.equal(total("12"), "TOTAL A PAGAR: RD$12,130", "la docena a 990 + 250");
});

/**
 * «POLOCHE» ES EL POLO, EN BUEN DOMINICANO.
 *
 * La captura de la dueña (2026-09-10): «Yo escribí por los polocheres» y el
 * agente siguió con el calzado del anuncio —le mandó hasta la foto de unas
 * botas y le preguntó el color— porque esa palabra no la conocía nadie en esta
 * casa. Un poloche no es otra cosa en ningún país: es siempre un polo, con su
 * talla y su color.
 */
test("«poloche» es el polo, y quien lo pide no recibe la foto del calzado", () => {
  for (const dice of ["Yo escribí por los polocheres", "quiero un poloche", "el polocher blanco"]) {
    assert.deepEqual(familiasNombradas(dice).map((f) => f.familia), ["camisas y polos"], dice);
    assert.equal(llevaTalla(dice, rd), true, "lleva talla, como cualquier polo");
    assert.equal(llevaColor(dice, rd), true);
  }
  assert.equal(tallasDisponibles("POLOCHES BRONX RD$1,400", rd), "de la S a la XXL");
  assert.equal(primeraPregunta("POLOCHES BRONX RD$1,400", rd), "¿Qué talla le interesa?");

  /*
   * Y LA FOTO DEL ANUNCIO NO SALE SI ÉL VINO POR OTRA COSA: la foto es la del
   * anuncio, y enseñarle unas botas a quien pidió polos es decirle que no se le
   * ha leído.
   */
  const botas = "BOTA MR JONES cuero legítimo RD$3,500";
  assert.equal(clientePideOtraFamilia(["Yo escribí por los polocheres"], botas), true);
  assert.equal(clientePideOtraFamilia(["¿las botas vienen en negro?"], botas), false, "pregunta por lo del anuncio");
  assert.equal(clientePideOtraFamilia(["¿esas botas combinan con la camisa?"], botas), false, "nombra las dos: sigue en lo suyo");
  assert.equal(clientePideOtraFamilia(["hola, precio?"], botas), false, "no nombra ningún artículo");
  assert.equal(clientePideOtraFamilia(["quiero polos"], null), false, "sin anuncio no hay nada que contradecir");
});

/**
 * EN COSTA RICA UNA FAJA ES EL CINTURÓN, Y SE VENDE COMO TAL.
 *
 * La dueña (2026-09-09): «la faja es cinturón, correa; este es el lenguaje que
 * se utiliza en Costa Rica, debe vender de forma normal». Aquí la palabra
 * estaba en la lista de los que no llevan talla —que es la regla dominicana,
 * donde una faja es una faja— y el anuncio «FAJA REVERSIBLE PARA HOMBRE» se
 * vendía sin preguntar la medida: un cinturón de cuero despachado a ciegas.
 */
test("en Costa Rica una faja es la correa: se vende con su talla", () => {
  const faja = { descripcion_anuncio: "FAJA REVERSIBLE PARA HOMBRE ₡9.000" };
  assert.equal(primeraPregunta(faja.descripcion_anuncio, cr), "¿Qué talla le interesa?");
  assert.equal(tallasDisponibles(faja.descripcion_anuncio, cr), "de la 30 a la 42", "las de la correa");

  const texto = aperturaSegura(cr, faja, "Hola! Bienvenido(a) a TELLERIA. Gracias por escribirnos.")!;
  assert.match(texto, /FAJA REVERSIBLE PARA HOMBRE/i);
  assert.ok(texto.endsWith("¿Qué talla le interesa?"));

  // Y en República Dominicana una faja sigue siendo una faja: se vende fija.
  assert.equal(primeraPregunta("Faja reversible RD$1,500", rd), "Indíquenos a qué dirección y provincia le enviamos.");
  assert.equal(llevaTalla("Faja reversible RD$1,500", rd), false);
  assert.equal(llevaTalla("FAJA REVERSIBLE PARA HOMBRE ₡9.000", cr), true);
  assert.equal(llevaTalla("FAJA REVERSIBLE PARA HOMBRE ₡9.000"), false, "sin país, la clasificación de siempre");
});

/**
 * UN «NO» NO ES UN «AHORA NO».
 *
 * La captura de la dueña (Costa Rica, 2026-09-09): «¿Me confirma qué talla
 * necesita del cinturón reversible para poder finalizar su pedido?» → «No voy a
 * continuar con la compra, gracias» → «Con mucho gusto. ¿Me regala su nombre
 * completo para el pedido?». El cliente cerró la puerta y el agente le siguió
 * pasando el formulario.
 */
test("al que dice que no se le agradece y se le deja ir, no se le siguen pidiendo datos", () => {
  for (const dice of [
    "No voy a continuar con la compra, gracias",
    "Ya no lo quiero",
    "ya no me interesa",
    "Cancele el pedido por favor",
    "¿me lo puede cancelar?",
    "Mejor no",
    "no, gracias",
    "déjelo así",
  ]) {
    assert.equal(clienteRenunciaALaCompra(dice), true, `«${dice}» es un no`);
  }

  /*
   * Y NO SE PASA DE LISTO: elegir otro color, corregir la cantidad o preguntar
   * si se puede cancelar son de alguien que sigue comprando.
   */
  for (const sigue of [
    "no me interesa el negro, prefiero el azul",
    "mejor no me mande dos, mande uno",
    "¿se puede cancelar si no me queda?",
    "no tengo el dinero completo todavía",
    "el lunes le llamo",
    "no sé qué talla uso",
  ]) {
    assert.equal(clienteRenunciaALaCompra(sigue), false, `«${sigue}» no cierra nada`);
  }

  // Y lo que sale es la despedida, no el siguiente dato del pedido.
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const cinturon = { descripcion_anuncio: "CINTURÓN REVERSIBLE PARA HOMBRE ₡9.000" };
  assert.equal(
    respuestaMinima(cr, vacia, cinturon, { ultimoDelCliente: "No voy a continuar con la compra, gracias" }),
    "Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.",
  );
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
      ultimoDelAgente: "Gracias. Indíquenos a qué dirección y provincia le enviamos.",
    }),
    "Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.",
  );
});

/**
 * AL QUE MANDÓ SU UBICACIÓN NO SE LE PIDE LA DIRECCIÓN COMO SI NO HUBIERA
 * MANDADO NADA.
 *
 * Un pin del que ni el mapa ni WhatsApp sacaron una calle no deja dirección
 * escrita, así que la zona hay que preguntarla —el envío depende de ella—,
 * pero reconociendo lo que el cliente ya hizo. Repetirle «Indique su dirección
 * exacta de entrega.» —el caso real de República Dominicana— es decirle que su
 * ubicación no llegó.
 */
test("con la ubicación ya mandada, la respuesta mínima no vuelve a pedir la dirección", () => {
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const combo = { descripcion_anuncio: "COMBO 2 EN 1 cepillo secador + plancha RD$1,690" };

  assert.equal(
    respuestaMinima(rd, vacia, combo, { clienteCompartioUbicacion: true }),
    "Ya me llegó su ubicación, gracias. ¿En qué sector o provincia queda?",
  );
  assert.equal(
    respuestaMinima(cr, vacia, { descripcion_anuncio: "Cepillo secador ₡12.500" }, { clienteCompartioUbicacion: true }),
    "Ya me llegó su ubicación, gracias. ¿En qué cantón queda?",
  );

  // Sin pin, el paso de la dirección es el de siempre.
  assert.equal(respuestaMinima(rd, vacia, combo), "Indíquenos a qué dirección y provincia le enviamos.");

  // Y con la dirección ya en la ficha no se pregunta nada de esto: sigue el pedido.
  const conDireccion = { ...vacia, direccion: "Avenida Rómulo Betancourt, Distrito Nacional" };
  assert.equal(
    respuestaMinima(rd, conDireccion, combo, { clienteCompartioUbicacion: true }),
    "Perfecto, hasta Gran Santo Domingo el envío le sale en RD$250.\n¿Me facilita su número de teléfono para el pedido?",
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
  assert.ok(texto.endsWith("Indíquenos a qué dirección y provincia le enviamos."), "la cantidad no se pregunta nunca");
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
  // Después de la talla, el color: la ropa lleva los dos (la dueña, 2026-09-08).
  assert.equal(respuestaMinima(rd, { ...vacia, talla: "la M" }, camisa), "¿Qué color le interesa?");
  assert.equal(
    respuestaMinima(rd, { ...vacia, talla: "la M", color: "negro" }, camisa),
    "Indíquenos a qué dirección y provincia le enviamos.",
    "y con la talla y el color dados, a dónde se lo enviamos",
  );
  assert.equal(respuestaMinima(rd, vacia, combo), "Indíquenos a qué dirección y provincia le enviamos.", "un combo no lleva talla: a dónde se lo enviamos, sin preguntar cuántos");
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

  // Con la talla ya en la ficha, el siguiente paso es el color: el calzado
  // también se elige por él. Y con los dos dados, la dirección.
  assert.equal(respuestaMinima(rd, { ...vacia, talla: "39" }, zapatos, { ultimoDelAgente: "¿Qué número calza?" }), "¿Qué color le interesa?");
  assert.equal(
    respuestaMinima(rd, { ...vacia, talla: "39", color: "negro" }, zapatos, { ultimoDelAgente: "¿Qué color le interesa?" }),
    "Indíquenos a qué dirección y provincia le enviamos.",
  );

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
  const perfecto = respuestaMinima(rd, { ...ficha, nombre: null, celular: null }, combo, { ultimoDelCliente: "Calle 3 #12, Los Mina, Santo Domingo Este", ultimoDelAgente: "Indíquenos a qué dirección y provincia le enviamos." });
  assert.equal(perfecto, "Perfecto, hasta Gran Santo Domingo el envío le sale en RD$250.\n¿Me facilita su número de teléfono para el pedido?");
  const interior = respuestaMinima(rd, { ...ficha, direccion: "Estoy en Santiago", nombre: null, celular: null }, combo, { ultimoDelCliente: "Estoy en Santiago", ultimoDelAgente: "Indíquenos a qué dirección y provincia le enviamos." });
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
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };

  // La faja tica es la correa: se vende igual que ella, talla y color primero.
  assert.equal(respuestaMinima(cr, vacia, faja, {}), "¿Qué talla le interesa?");
  assert.equal(respuestaMinima(cr, { ...vacia, talla: "34" }, faja, {}), "¿Qué color le interesa?");

  const base = { ...vacia, talla: "34", color: "negro" };
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

/**
 * EL CASO DE LA DUEÑA (2026-09-10), con la captura delante.
 *
 * «BUENO DIA ESTAM MUY BONITO ACOMO SALE LAS 12» → «Hola! Bienvenido(a) a
 * RINCON DCM… POLOS BRONX ORIGINALES RD$1,400 ¿Qué talla le interesa?». Ella:
 * «debe de responder, no le salen a 1,400 si son 12». El cliente preguntó por
 * doce y se le contestó lo que cuesta uno, que es la respuesta a otra pregunta:
 * la lista de precios por cantidad existe desde el día anterior y este mensaje
 * —que lo escribe la apertura, sin modelo— no la miraba.
 */
test("preguntar por doce se contesta con el precio de doce, no con el de uno", () => {
  const polos = {
    producto_anuncio: "POLOS BRONX ORIGINALES",
    descripcion_anuncio: "POLOS BRONX ORIGINALES Moderno, Fresco y duradero RD$1,400",
  };
  const pide = "BUENO DIA ESTAM MUY BONITO ACOMO SALE LAS  12";

  assert.equal(preguntaDelCliente(pide), "precio_cantidad");
  assert.equal(cantidadDicha(pide), 12);

  const texto = aperturaSegura(rd, polos, saludo, pide)!;
  assert.ok(texto.includes("Las 12 unidades le salen a RD$990 cada una: RD$11,880."), texto);
  assert.ok(!texto.includes("RD$1,400"), "y la cifra de una unidad ya no sale, que es lo que contradecía");
  assert.ok(texto.endsWith("¿Qué talla le interesa?"), "la venta sigue por donde iba");

  // Los tramos de en medio cuentan igual, y la docena se pide por su nombre.
  assert.ok(aperturaSegura(rd, polos, saludo, "cuanto cuestan 3 polos")!.includes("RD$1,190 cada una: RD$3,570"));
  assert.ok(aperturaSegura(rd, polos, saludo, "a como sale la docena?")!.includes("RD$990 cada una: RD$11,880"));

  // Sin cantidad, el mensaje de siempre: el precio del anuncio, tal cual.
  const suelta = aperturaSegura(rd, polos, saludo, "hola, cuanto cuesta?")!;
  assert.ok(suelta.includes("RD$1,400") && !suelta.includes("RD$990"));
});

/**
 * Y NO TODO NÚMERO ES UNA CANTIDAD. En un chat de ventas un «12» es una talla,
 * una hora o el final de un teléfono muchas más veces que una docena de polos:
 * por eso solo se lee pegado a una pregunta de precio, y con las tallas y las
 * horas fuera. Un descuento cotizado de más es dinero de la tienda.
 */
test("una talla, una hora o un precio no se leen como la cantidad que lleva", () => {
  assert.equal(cantidadDicha("¿tienen talla 12?"), null);
  assert.equal(cantidadDicha("¿a qué hora? ¿a las 12 de la mañana?"), null);
  assert.equal(cantidadDicha("me interesa, cuesta 1,400?"), null);
  assert.equal(cantidadDicha("mi número es 8095551212"), null);
  assert.equal(cantidadDicha("hola, buenas"), null);
  assert.equal(cantidadDicha("quiero uno"), null, "uno es la de siempre y no cambia ningún precio");

  // Y una pregunta de precio a secas sigue siendo la de siempre.
  assert.equal(preguntaDelCliente("cuanto cuesta?"), "precio");
  assert.equal(preguntaDelCliente("a como sale?"), "precio");
  assert.equal(preguntaDelCliente("a como sale las 12?"), "precio_cantidad");
});

/**
 * SIN LISTA DE PRECIOS PARA ESE ARTÍCULO NO SE COTIZA NADA. Multiplicar el
 * precio del anuncio por doce sería inventarse un mayoreo que nadie autorizó:
 * el guion manda pasar eso a un representante, y la apertura se queda como
 * estaba en vez de adelantarse.
 */
test("un artículo sin lista de precios por cantidad no se cotiza por docenas", () => {
  const combo = {
    producto_anuncio: "Combo 2 En 1",
    descripcion_anuncio: "🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora.",
  };

  assert.equal(respuestaDirecta(rd, "a como salen 12?", combo), null);
  const texto = aperturaSegura(rd, combo, saludo, "a como salen 12?")!;
  assert.ok(texto.includes("RD$1,690"), texto);
  assert.ok(!/RD\$20/.test(texto), "y de ahí no sale ninguna cifra multiplicada");
});
