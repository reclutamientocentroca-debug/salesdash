import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais, bloqueDelPais } from "../src/agents";
import { correccionParaElAgente, revisarBorrador, revisarConReglas, type ContextoRevision } from "../src/lib/revisor";

/**
 * EL REVISOR PARA LO QUE CUESTA DINERO, y no lo demás.
 *
 * Sin red: aquí se prueban las reglas mecánicas, que son las que paran lo más
 * caro, y que sin clave del modelo el revisor no deja mudo al negocio.
 */
delete process.env.OPENROUTER_API_KEY;

function contexto(pais: string): ContextoRevision {
  const datos = agenteDePais(pais)!;
  return {
    datos,
    nombresDeLaCasa: [datos.nombreAgente ?? "", datos.tienda].filter(Boolean),
    catalogo: "Catálogo:\n- Mocasines de cuero — 2500",
    anuncio: null,
    bloqueDelPais: bloqueDelPais(datos, null, "Tienda"),
  };
}

const rd = contexto("do");
const cr = contexto("cr");
const pa = contexto("pa");

test("una respuesta normal, con el envío del país, pasa sin objeción", () => {
  assert.deepEqual(revisarConReglas("Los mocasines están en RD$2,500. El envío a Santiago es RD$290.\n\n¿Qué talla necesita?", rd), []);
  assert.deepEqual(revisarConReglas("Diay, el envío son ₡3.500 a todo el país.\n\n¿A qué cantón se lo enviamos?", cr), []);
  assert.deepEqual(revisarConReglas("El envío es US$5.00 a todo el país.\n\n¿A qué corregimiento se lo enviamos?", pa), []);
});

test("la moneda de otro país no sale", () => {
  const f = revisarConReglas("El envío son US$5.00 en todo el país.", rd);
  assert.ok(f.some((x) => x.includes("dólares")), "dólares en un chat dominicano");
  assert.ok(revisarConReglas("Son ₡25.000 más el envío.", pa).some((x) => x.includes("colones")));
  // En Panamá el dólar es de casa, y Colón es una provincia, no una moneda.
  assert.deepEqual(revisarConReglas("Son US$2,500.00.", pa), []);
  assert.deepEqual(revisarConReglas("¿Se lo enviamos a Colón? El envío es US$5.00.", pa), []);
});

test("un costo de envío que no es ninguno de los del país no sale", () => {
  const f = revisarConReglas("El envío a Santiago le sale en RD$350.", rd);
  assert.ok(f.some((x) => x.includes("RD$350") && x.includes("RD$250") && x.includes("RD$290")));

  // El total con el envío dentro no es una tarifa: no se confunde.
  assert.deepEqual(revisarConReglas("El total con envío queda en RD$2,750.", rd), []);
});

test("sin forma de pago configurada, no se promete ninguna", () => {
  assert.ok(revisarConReglas("Paga contra entrega al recibir.", pa).some((x) => x.includes("forma de pago")));
  // Donde sí está configurada, se puede decir.
  assert.deepEqual(revisarConReglas("Paga contra entrega al recibir.", rd), []);
});

test("descuentos, envío gratis, días de entrega y reservas no salen", () => {
  assert.ok(revisarConReglas("Le hago un descuento si lleva dos.", rd).some((x) => x.includes("descuento")));
  assert.ok(revisarConReglas("Por hoy el envío gratis.", rd).some((x) => x.includes("envío gratis")));
  assert.ok(revisarConReglas("Le llega mañana sin falta.", rd).some((x) => x.includes("día de entrega")));
  assert.ok(revisarConReglas("Se lo aparto hasta el viernes.", rd).some((x) => x.includes("reserva")));
  // Decir que se despacha en 24 a 48 horas no es prometer un día.
  assert.deepEqual(revisarConReglas("Se despacha dentro de 24 a 48 horas.", rd), []);
});

test("un resumen con huecos, a nombre de la vendedora o con un envío ajeno no sale", () => {
  const pedido = (nombre: string, total: string, envio = "RD$250") =>
    `Resumen:\n\nNombre: ${nombre}\nCel: 8095551234\nProducto: Mocasines\nCantidad: 1\nDirección: Calle 1 #2, Los Prados, Santo Domingo\nCosto de envío: ${envio}\nTotal a pagar: ${total}`;

  assert.deepEqual(revisarConReglas(pedido("Ana Pérez", "RD$2,750"), rd), []);
  assert.ok(revisarConReglas(pedido("Ana Pérez", "por confirmar"), rd).some((x) => x.includes("total")));
  assert.ok(revisarConReglas(pedido("Orlanda", "RD$2,750"), rd).some((x) => x.includes("nombre de la casa")));
  assert.ok(revisarConReglas(pedido("Ana Pérez", "RD$2,850", "RD$350"), rd).some((x) => x.includes("RD$350")));
});

/**
 * EL PRECIO ES EL DE LA DESCRIPCIÓN, Y NO SE INVENTA.
 *
 * La dueña lo dijo con todas las letras: la IA tiene que sacar el producto y
 * el precio de la descripción y no inventar ninguno. Esto es lo que lo hace
 * mecánico: cada importe que escriba el agente tiene que explicarse con lo
 * que tenía delante —descripción, catálogo, envío—, y si no hay ningún precio
 * escrito en ningún sitio, no cotiza ninguno.
 */
test("un precio que no está en la descripción ni en el catálogo no sale", () => {
  // El del catálogo, con cantidad y con envío, pasa.
  assert.deepEqual(revisarConReglas("Los mocasines están en RD$2,500.", rd), []);
  assert.deepEqual(revisarConReglas("Dos pares son RD$5,000. Con el envío, el total queda en RD$5,250.", rd), []);
  // Y una cifra con decimales al final de la frase se lee bien: cinco, no quinientos.
  assert.deepEqual(revisarConReglas("El envío es US$5.00.", pa), []);

  // Uno inventado, o redondeado, no.
  const inventado = revisarConReglas("Los mocasines están en RD$2,300.", rd);
  assert.ok(inventado.some((x) => x.includes("RD$2300") && x.includes("no se inventa")));
  assert.ok(revisarConReglas("Le quedan en RD$2,000 cada uno.", rd).some((x) => x.includes("RD$2000")));

  // El de la descripción del anuncio vale, escrito como lo escriba el dueño.
  const conAnuncio: ContextoRevision = {
    ...rd,
    catalogo: "Catálogo:\n(sin catálogo cargado)",
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Camisa de lino\n- Lo que promete el anuncio: Camisa de lino manga larga a 1,850 pesos, en varios colores.",
  };
  assert.deepEqual(revisarConReglas("La camisa de lino es de excelente calidad, en RD$1,850.\n\n¿Qué talla necesita?", conAnuncio), []);
  assert.deepEqual(revisarConReglas("Con el envío a Santiago queda en RD$2,140.", conAnuncio), []);
  assert.ok(revisarConReglas("La camisa está en RD$1,900.", conAnuncio).some((x) => x.includes("RD$1900")));

  // Sin ningún precio escrito en ningún sitio, no se cotiza ninguno.
  const sinPrecio: ContextoRevision = { ...conAnuncio, anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Camisa de lino" };
  const f = revisarConReglas("La camisa está en RD$1,850.", sinPrecio);
  assert.ok(f.some((x) => x.includes("no hay ningún precio") && x.includes("[HANDOFF]")));
  // Pero el envío del país sí se puede decir.
  assert.deepEqual(revisarConReglas("El envío a Santiago es RD$290.", sinPrecio), []);
});

test("sin clave del modelo, el revisor aprueba lo que las reglas aprueban y no se cae", async () => {
  const bien = await revisarBorrador(1, null, [], "Los mocasines están en RD$2,500.\n\n¿Qué talla necesita?", rd);
  assert.equal(bien.aprobado, true);

  const mal = await revisarBorrador(1, null, [], "Le hago un descuento y el envío gratis.", rd);
  assert.equal(mal.aprobado, false);
  assert.equal(mal.por, "reglas");

  const correccion = correccionParaElAgente(mal);
  assert.ok(correccion.includes("descuento") && correccion.includes("envío gratis"));
  assert.ok(correccion.includes("no lo inventes"));
});

test("el nombre de la cuenta de WhatsApp no sale si el cliente no lo escribió", () => {
  const conCuenta = { ...rd, nombreDeCuenta: "Marisol Tienda", clienteEscribioSuNombre: false };
  assert.ok(
    revisarConReglas("Hola Marisol, con gusto. ¿Qué talla necesita?", conCuenta).some((f) => f.includes("Marisol")),
    "saludar con el nombre de la cuenta se para",
  );
  assert.deepEqual(revisarConReglas("Con gusto. ¿Qué talla necesita?", conCuenta), []);

  // Si el cliente lo escribió él, es su nombre y se puede usar.
  const loDijo = { ...conCuenta, clienteEscribioSuNombre: true };
  assert.deepEqual(revisarConReglas("Perfecto, Marisol. ¿Qué talla necesita?", loDijo), []);
});

/**
 * LOS FALLOS DE LA CAPTURA: tuteo en un país de usted, una ubicación que
 * nadie mandó hoy, un resumen con datos que el cliente no escribió, y el envío
 * de la zona equivocada.
 */
test("tutear donde se vende de usted no sale", () => {
  assert.ok(revisarConReglas("¿Quieres que te prepare el pedido?", rd).some((f) => f.includes("tutea")));
  assert.deepEqual(revisarConReglas("¿Me confirma para levantar el pedido?", rd), []);
  // «Dime a ver» es dominicano, no tuteo de venta.
  assert.deepEqual(revisarConReglas("Dime a ver, ¿qué talla necesita?", rd), []);
  // Costa Rica también vende de usted: tutear ahí también se para.
  assert.ok(revisarConReglas("¿Quieres que te lo mande hoy mismo?", cr).some((f) => f.includes("tutea")));
  assert.deepEqual(revisarConReglas("¿Qué número calza? Le enviamos a todo el país.", cr), []);
});

test("una ubicación que el cliente no compartió en esta sesión no se da por recibida", () => {
  const sinPin = { ...rd, clienteCompartioUbicacion: false };
  assert.ok(revisarConReglas("Perfecto, ya me llegó su ubicación en Brisas del Este.", sinPin).some((f) => f.includes("ubicación")));
  const conPin = { ...rd, clienteCompartioUbicacion: true };
  assert.deepEqual(revisarConReglas("Perfecto, ya me llegó su ubicación en Brisas del Este. El envío es RD$250.", conPin), []);
});

test("el envío tiene que ser el de la zona del cliente", () => {
  const enSDE = { ...rd, lugarDelCliente: "calle Duarte #70, Brisas del Este, Santo Domingo Este" };
  assert.ok(revisarConReglas("El envío a su zona es RD$290.", enSDE).some((f) => f.includes("RD$250")));
  assert.deepEqual(revisarConReglas("El envío a su zona es RD$250.", enSDE), []);

  const resumen = (envio: string) =>
    `Resumen:

Nombre: Yamil Peña
Cel: 8094353930
Producto: Camisa de lino
Cantidad: 1
Dirección: calle Duarte #70, Brisas del Este, Santo Domingo Este
Costo de envío: ${envio}
Total a pagar: RD$2,750`;
  const ctx = { ...rd, textosDelCliente: ["Yamil Peña", "calle Duarte #70, Brisas del Este, Santo Domingo Este", "sí, a este"], telefonoDelChat: "18094353930" };
  assert.ok(revisarConReglas(resumen("RD$290"), ctx).some((f) => f.includes("le toca RD$250")));
  assert.deepEqual(revisarConReglas(resumen("RD$250"), ctx), []);
});

test("el resumen solo lleva lo que el cliente escribió en esta conversación", () => {
  const pedido = (nombre: string, cel: string) =>
    `Resumen:

Nombre: ${nombre}
Cel: ${cel}
Producto: Camisa de lino
Cantidad: 1
Dirección: calle Duarte #70, Brisas del Este, Santo Domingo Este
Costo de envío: RD$250
Total a pagar: RD$2,750`;
  const ctx = { ...rd, textosDelCliente: ["la M", "Yamil Peña", "calle Duarte #70, Brisas del Este, Santo Domingo Este"], telefonoDelChat: "18094353930" };

  assert.deepEqual(revisarConReglas(pedido("Yamil Peña", "8094353930"), ctx), [], "todo lo escribió él, y el celular es el del chat");
  assert.ok(revisarConReglas(pedido("Quiero más información sobre el negocio.", "8094353930"), ctx).some((f) => f.includes("no escribió ese nombre") || f.includes("frase")));
  assert.ok(revisarConReglas(pedido("Rosa Almonte", "8094353930"), ctx).some((f) => f.includes("no escribió ese nombre")));
  assert.ok(revisarConReglas(pedido("Yamil Peña", "8295550000"), ctx).some((f) => f.includes("celular")));

  const otraDireccion = { ...ctx, textosDelCliente: ["la M", "Yamil Peña"] };
  assert.ok(revisarConReglas(pedido("Yamil Peña", "8094353930"), otraDireccion).some((f) => f.includes("dirección del resumen")));
});

/** El caso de Costa Rica: ofrecía sábanas que nadie vende. Ni de un ejemplo ni de «La Sabana». */
test("un artículo que no está en el anuncio ni en el catálogo no se ofrece", () => {
  assert.ok(revisarConReglas("Tenemos el set de sábanas en microfibra. ¿Qué medida necesita?", cr).some((f) => f.includes("sábanas") || f.includes("sabanas")));
  assert.ok(revisarConReglas("¿Le interesa una sábana también?", rd).some((f) => f.includes("sabana")));
  // Nombrar el barrio no es ofrecer un producto: «La Sabana» va sin tilde y como lugar.
  assert.deepEqual(revisarConReglas("¿Se lo enviamos a La Sabana? El envío es ₡3.500.", cr), []);
  // Y si la tienda sí los vende, se pueden ofrecer.
  const conSabanas = { ...cr, catalogo: "Catálogo:\n- Set de sábanas — 12500" };
  assert.deepEqual(revisarConReglas("El set de sábanas está en ₡12.500.", conSabanas), []);
});

/**
 * EL CASO DEL COMBO: «¿Qué talla necesita?» a un cepillo secador con plancha.
 * Si las fuentes no dicen que el artículo lleve tallas o colores, la pregunta
 * no sale. Ropa y calzado sí llevan talla aunque el anuncio no la escriba.
 */
test("una talla, un número o un color a un artículo que no los lleva no se pregunta", () => {
  const combo: ContextoRevision = {
    ...rd,
    catalogo: "Catálogo:\n(sin catálogo cargado)",
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Rincondcm\n- Lo que promete el anuncio: COMBO 2 EN 1 — SOLO RD$1,690. Cepillo secador + plancha alisadora. Seca rápido y ahorra tiempo. Control de temperatura.",
  };
  assert.ok(revisarConReglas("El combo 2 en 1 está en RD$1,690.\n\n¿Qué talla necesita?", combo).some((f) => f.includes("talla")));
  assert.ok(revisarConReglas("¿En qué color lo quiere?", combo).some((f) => f.includes("color")));
  assert.deepEqual(revisarConReglas("El combo 2 en 1 está en RD$1,690.\n\nLe hacemos envío y paga al recibir. ¿En qué provincia se encuentra?", combo), []);

  // Ropa: lleva talla aunque el anuncio no la escriba; el color solo si el anuncio lo dice.
  const camisa: ContextoRevision = {
    ...rd,
    catalogo: "Catálogo:\n(sin catálogo cargado)",
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Camisa de lino\n- Lo que promete el anuncio: Camisas de lino para caballeros a RD$1,500.",
  };
  assert.deepEqual(revisarConReglas("La camisa de lino está en RD$1,500.\n\n¿Qué talla necesita?", camisa), []);
  assert.ok(revisarConReglas("¿En qué color la quiere?", camisa).some((f) => f.includes("color")));

  // Calzado con numeración escrita: el número sí se pregunta.
  const zapatos: ContextoRevision = {
    ...rd,
    catalogo: "Catálogo:\n(sin catálogo cargado)",
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Zapatos DCM Estilo\n- Lo que promete el anuncio: Zapatos DCM Estilo RD$2,500. Disponibles en negro y marrón, del 39 al 45.",
  };
  assert.deepEqual(revisarConReglas("¿Qué número calza?", zapatos), []);
  assert.deepEqual(revisarConReglas("Los tenemos en negro y marrón. ¿Cuál le despachamos?", zapatos), []);

  // Y la pregunta del teléfono no es una pregunta de talla.
  assert.deepEqual(revisarConReglas("¿A qué número le llama el mensajero, a este mismo?", combo), []);
});

/** El caso de Costa Rica: una mochila no lleva talla, ni aunque diga «45 litros». */
test("una mochila o un accesorio no lleva talla, ni aunque el anuncio traiga números", () => {
  const mochila: ContextoRevision = {
    ...cr,
    catalogo: "Catálogo:\n(sin catálogo cargado)",
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Mochila\n- Lo que promete el anuncio: Mochila ejecutiva de 45 litros, 40 cm de alto, impermeable, a ₡18.500.",
  };
  assert.ok(revisarConReglas("La mochila ejecutiva está en ₡18.500.\n\n¿Qué talla necesitas?", mochila).some((f) => f.includes("talla")));
  assert.ok(revisarConReglas("¿De qué color la quieres?", mochila).some((f) => f.includes("color")), "sin colores en el anuncio, no se pregunta");
  assert.deepEqual(revisarConReglas("La mochila ejecutiva está en ₡18.500.\n\nLe enviamos a todo el país. ¿En qué cantón se encuentra?", mochila), []);

  // Con los colores escritos en el anuncio, el color sí se pregunta; la talla sigue sin ir.
  const conColores = { ...mochila, anuncio: mochila.anuncio + " Disponible en negro y gris." };
  assert.deepEqual(revisarConReglas("La tenemos en negro y gris. ¿Cuál te despachamos?", conColores), []);
  assert.ok(revisarConReglas("¿Qué talla necesitas?", conColores).some((f) => f.includes("talla")));

  // Y un reloj o una cartera, igual.
  const reloj = { ...mochila, anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Reloj\n- Lo que promete el anuncio: Reloj deportivo 44 mm a ₡22.000." };
  assert.ok(revisarConReglas("¿Qué talla necesitas?", reloj).some((f) => f.includes("talla")));
});

/** La ubicación no se pide por el mapa ni se insiste: el cliente puede decir dónde está. */
test("pedir la ubicación por el mapa, o insistir con ella, no sale", () => {
  assert.ok(revisarConReglas("¿Me comparte su ubicación por aquí?", rd).some((f) => f.includes("ubicación")));
  assert.ok(revisarConReglas("Por favor envíeme su ubicación actual.", rd).some((f) => f.includes("ubicación")));

  const yaDijo = { ...rd, ficha: { talla: null, color: null, direccion: "Los Alcarrizos, calle 3", nombre: null, celular: null, cantidad: null } };
  assert.ok(revisarConReglas("¿Me confirma su dirección?", yaDijo).some((f) => f.includes("ya dijo dónde está")));
  // Preguntar en qué provincia está, la primera vez, sí se puede.
  assert.deepEqual(revisarConReglas("Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?", rd), []);
  // Y decirle que ya le llegó su ubicación cuando sí la mandó, también.
  assert.deepEqual(revisarConReglas("Perfecto, ya me llegó su ubicación. El envío es RD$250.", { ...rd, clienteCompartioUbicacion: true }), []);
});
