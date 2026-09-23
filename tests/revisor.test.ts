import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenteDePais, bloqueDelPais } from "../src/agents";
import { clienteEscribioSuNombre } from "../src/lib/agent";
import { respuestaMinima, resumenMecanico } from "../src/lib/apertura";
import { fichaDelPedido } from "../src/lib/memoria";
import { correccionParaElAgente, revisarBorrador, revisarConReglas, transferenciaPermitida, type ContextoRevision } from "../src/lib/revisor";

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
const crDatos = agenteDePais("cr")!;
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
  // Un país al que todavía no le pusieron forma de pago (Panamá la tiene desde el 2026-09-04).
  const sinPago = { ...pa, datos: { ...pa.datos, pago: null }, bloqueDelPais: bloqueDelPais({ ...pa.datos, pago: null }, null, "Tienda") };
  assert.ok(revisarConReglas("Paga contra entrega al recibir.", sinPago).some((x) => x.includes("forma de pago")));
  // Donde sí está configurada, se puede decir.
  assert.deepEqual(revisarConReglas("Paga contra entrega al recibir.", rd), []);
  assert.deepEqual(revisarConReglas("Puede pagar por Yappy, transferencia o en efectivo al recibir.", pa), [], "en Panamá ya se sabe cómo se paga");
});

test("descuentos, envío gratis, días de entrega y reservas no salen", () => {
  assert.ok(revisarConReglas("Le hago un descuento si lleva dos.", rd).some((x) => x.includes("descuento")));
  assert.ok(revisarConReglas("Por hoy el envío gratis.", rd).some((x) => x.includes("envío gratis")));
  assert.ok(revisarConReglas("Le llega mañana sin falta.", rd).some((x) => x.includes("día de entrega")));
  assert.ok(revisarConReglas("Se lo aparto hasta el viernes.", rd).some((x) => x.includes("reserva")));
  // Decir que se envía en 24 a 48 horas no es prometer un día.
  assert.deepEqual(revisarConReglas("Se lo enviamos dentro de 24 a 48 horas.", rd), []);
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
 * «PURA VIDA» NO ES EL NOMBRE DE NADIE (Costa Rica, 2026-09-08).
 *
 * Aquí es hola, gracias y adiós, y hay cuentas de WhatsApp que se llaman así.
 * El agente acabó levantando pedidos «a nombre de Pura vida» y llamando así a
 * gente que nunca dijo cómo se llama.
 *
 * Y desde el 2026-09-08 la dueña la sacó de los mensajes: en Costa Rica no se
 * dice, punto. Son dos cosas distintas y las dos hacen falta —la frase está
 * prohibida entera, y donde va un nombre no va ninguna expresión del país—,
 * porque en los otros dos países no hay nada prohibido y el nombre se sigue
 * protegiendo igual.
 */
test("un saludo tico no se escribe donde va el nombre del cliente", () => {
  const tico = { ...cr, ultimoDelCliente: "Pura vida", textosDelCliente: ["Pura vida"] };

  for (const puesto of [
    "Perfecto, el pedido queda a nombre de Pura vida.",
    "Listo, señora Pura vida, ya le anoto la dirección.",
    "El pedido de Pura vida sale hoy.",
    "Con gusto, don Diay. ¿Me regala su dirección?",
  ]) {
    assert.ok(
      revisarConReglas(puesto, tico).some((f) => f.includes("saludo de aquí") || f.includes("no se dice nunca")),
      `«${puesto}» le pone al cliente un nombre que no es suyo`,
    );
  }

  // «Pura vida» no sale ni bien usada: la dueña la quitó de los mensajes.
  for (const prohibida of [
    "Gracias a usted. Pura vida.",
    "Pura vida, con mucho gusto. El envío es ₡3.500.",
    "pura vida!",
  ]) {
    assert.ok(
      revisarConReglas(prohibida, tico).some((f) => f.includes("no se dice nunca")),
      `«${prohibida}» ya no sale en Costa Rica`,
    );
  }

  // Y la cortesía tica que sí se usa sigue saliendo.
  for (const bien of ["Con mucho gusto. ¿Me regala su dirección exacta?", "Que tenga buen día."]) {
    assert.deepEqual(revisarConReglas(bien, tico), [], `«${bien}» es como se habla en Costa Rica`);
  }

  // Y un nombre de cuenta que es un saludo no se vuelve suyo porque él salude.
  assert.equal(clienteEscribioSuNombre("Pura Vida", [{ emisor: "cliente", content: "pura vida, buenas" }], crDatos), false);
  assert.equal(clienteEscribioSuNombre("Mildred Solís", [{ emisor: "cliente", content: "soy Mildred Solís" }], crDatos), true);
  assert.equal(clienteEscribioSuNombre("Mildred Solís", [{ emisor: "cliente", content: "buenas" }], crDatos), false);
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

/**
 * DOS COLORES SON DOS UNIDADES (la dueña, RD, 2026-09-07).
 *
 * El resumen que salió: «Talla: Rojo y azul XL», «Cantidad: 1» y el total con
 * el precio de un solo polo. El cliente pidió dos, y se cobró uno.
 */
test("un resumen dominicano con dos colores y una sola unidad no sale", () => {
  const pedido = (variante: string, cantidad: string, total: string) =>
    `Resumen:

Nombre: Manuel Peña
Telefono: 8098503819
Direccion: Pantoja, Santo Domingo
Producto: Polos Bronx Originales
${variante}
Cantidad: ${cantidad}
Envio: RD$250
TOTAL A PAGAR: ${total}`;
  const ctx = {
    ...rd,
    anuncio: "Anuncio: POLOS BRONX ORIGINALES a RD$1,400. Colores: rojo, azul, negro.",
    textosDelCliente: ["Rojo y azul XL", "Manuel Peña", "Pantoja, Santo Domingo", "8098503819"],
    telefonoDelChat: "18098503819",
  };

  // El caso real: dos colores cobrados como uno.
  const falla = revisarConReglas(pedido("Talla: Rojo y azul XL", "1", "RD$1,650"), ctx);
  assert.ok(falla.some((f) => f.includes("2 colores") && f.includes("Cantidad: 2")), falla.join(" | "));
  // También cuando los colores van en su línea.
  assert.ok(
    revisarConReglas(pedido("Color: rojo y azul\nTalla: XL", "1", "RD$1,650"), ctx).some((f) => f.includes("2 colores")),
  );

  // Con la cantidad y el total puestos, el mismo resumen sale.
  assert.deepEqual(revisarConReglas(pedido("Color: rojo y azul\nTalla: XL", "2", "RD$3,050"), ctx), []);
  // Y un color solo sigue siendo una unidad.
  assert.deepEqual(
    revisarConReglas(pedido("Color: rojo\nTalla: XL", "1", "RD$1,650"), { ...ctx, textosDelCliente: ["Rojo XL", "Manuel Peña", "Pantoja, Santo Domingo", "8098503819"] }),
    [],
  );
});

/**
 * NO SE LE CAMBIA EL ARTÍCULO AL CLIENTE DEL ANUNCIO (la dueña, 2026-09-08).
 *
 * El anuncio era una foto de unos jeans y el agente no tenía su precio, así que
 * en vez de transferir le ofreció otra cosa: «estamos ofreciendo los Polos
 * Bronx Originales». El cliente pidió tres pantalones dos veces y se fue.
 */
test("con un anuncio delante, ofrecerle otro artículo no sale", () => {
  const delAnuncio = {
    ...rd,
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: (el anuncio no traía título)\n" +
      "Este anuncio es SOLO una foto, y esto es lo que se ve en ella: Publicidad de pantalones jeans en diferentes colores",
    catalogo: "Catálogo:\n- Polos Bronx Originales — 1400",
  };

  for (const cambiaDeArticulo of [
    "Actualmente estamos ofreciendo los Polos Bronx Originales. ¿Le interesa alguno?",
    "Ahora mismo no tenemos disponible la opción de pantalones, pero le ofrezco los Polos Bronx Originales.",
  ]) {
    assert.ok(
      revisarConReglas(cambiaDeArticulo, delAnuncio).some((f) => f.includes("no se le cambia el artículo")),
      `«${cambiaDeArticulo}» no puede salir`,
    );
  }

  // Vender lo del anuncio sí sale, claro.
  assert.deepEqual(
    revisarConReglas("Los pantalones jeans están en RD$1,400. ¿Qué talla le interesa?", {
      ...delAnuncio,
      anuncio: `${delAnuncio.anuncio}\n- Precio: RD$1,400`,
    }),
    [],
  );

  // Y nombrar el otro artículo PARA TRANSFERIR es justo lo que se le pide.
  assert.deepEqual(
    revisarConReglas(
      "De los polos le da la información un representante. Permítame un momento, le transfiero con un representante. [HANDOFF]",
      delAnuncio,
    ),
    [],
  );

  // Sin anuncio en el chat, esta regla no se mete: manda el catálogo de siempre.
  assert.deepEqual(
    revisarConReglas("Los polos están en RD$1,400. ¿Qué talla le interesa?", {
      ...rd,
      catalogo: "Catálogo:\n- Polos Bronx Originales — 1400",
    }),
    [],
  );
});

/**
 * LA FOTO QUE MANDA EL CLIENTE Y NO SE SABE QUÉ ES (la dueña, 2026-09-08).
 *
 * Se transfiere —y quien atiende escribe en la casilla del hilo qué es y cuánto
 * vale—, así que esa transferencia tiene que pasar el revisor. La foto del
 * cliente ya cuenta como motivo; lo que aquí se fija es que siga contando,
 * porque de ella cuelga ahora la casilla.
 */
test("transferir por una foto del cliente tiene motivo, y un anuncio sin precio también", () => {
  const conAnuncio = {
    ...rd,
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Camisa de lino RD$1,400",
    catalogo: "Catálogo:\n- Camisa de lino — 1400",
  };
  const transfiere = "Eso se lo confirma un representante. Permítame un momento, le transfiero con un representante. [HANDOFF]";

  const otroArticulo = { ...conAnuncio, ultimoDelCliente: "(imagen que manda el cliente: unas botas de cuero marrón)" };
  assert.equal(transferenciaPermitida(transfiere, otroArticulo), true, "unas botas no son la camisa del anuncio");
  assert.deepEqual(revisarConReglas(transfiere, otroArticulo), []);

  /*
   * Y EL ANUNCIO QUE ES SOLO UNA FOTO, SIN PRECIO EN NINGÚN SITIO. Antes esta
   * transferencia se frenaba por «sin motivo»: el catálogo tenía precios —de
   * OTROS artículos— y eso contaba como que había precio.
   */
  const soloFoto = {
    ...rd,
    anuncio: "Este cliente llegó por un anuncio:\nEste anuncio es SOLO una foto, y esto es lo que se ve en ella: Publicidad de pantalones jeans en diferentes colores",
    catalogo: "Catálogo:\n- Polos Bronx Originales — 1400",
    ultimoDelCliente: "Me interesan tres pantalones de ahí",
  };
  assert.equal(transferenciaPermitida(transfiere, soloFoto), true, "de esos jeans no hay precio en ninguna parte");
  assert.deepEqual(revisarConReglas(transfiere, soloFoto), []);

  // Con el precio del anuncio delante, no: eso se vende, no se transfiere.
  const conPrecio = { ...soloFoto, anuncio: `${soloFoto.anuncio} RD$1,400` };
  assert.equal(transferenciaPermitida(transfiere, conPrecio), false);
});

/**
 * Y CUANDO EL EQUIPO YA DIJO QUÉ ES LA FOTO DEL CLIENTE, SE LE VENDE (2026-09-08).
 *
 * El cliente llegó por un anuncio de camisas y enseñó unas botas. Una persona
 * escribió en la casilla del hilo qué son y cuánto valen, y ese dato viaja con
 * el anuncio: a partir de ahí, venderle botas no es cambiarle el artículo, es
 * atender lo que pidió.
 */
test("con el artículo de su foto ya confirmado, vendérselo no lo para el revisor", () => {
  const soloElAnuncio = {
    ...rd,
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Camisa de lino\n- Lo que promete el anuncio: Camisa de lino manga larga. RD$1,400",
    catalogo: "Catálogo:\n- Camisa de lino — 1400\n- Botas de cuero — 3200",
  };

  // Sin que nadie haya confirmado nada, ofrecerle botas es cambiarle el artículo.
  assert.ok(
    revisarConReglas("Las botas de cuero están en RD$3,200.", soloElAnuncio)
      .some((f) => f.includes("no se le cambia el artículo")),
  );

  // Con la casilla ya escrita, el mismo mensaje sale.
  const conSuFoto = {
    ...soloElAnuncio,
    anuncio: `${soloElAnuncio.anuncio}\n\nEL CLIENTE TE ENSEÑÓ OTRO ARTÍCULO EN UNA FOTO, y el equipo ya te dijo cuál es y cuánto vale: Botas de cuero — 3200.`,
  };
  assert.deepEqual(revisarConReglas("Las botas de cuero están en RD$3,200. ¿Qué talla calza?", conSuFoto), []);
});

/**
 * LA FOTO QUE MANDA EL CLIENTE ES PUBLICIDAD DE LA MISMA TIENDA (2026-09-17).
 *
 * La dueña: un cliente mandó la foto de un anuncio propio —«Zapatos De
 * Caballero, DCM Estilo», RD$2,500 escrito encima— y el agente cotizó otra
 * cifra. Antes de este arreglo la foto del cliente NO era una fuente de
 * precios para el revisor —solo el catálogo y el anuncio lo eran—, así que un
 * precio leído ahí se paraba igual que uno inventado, aunque estuviera escrito
 * tal cual en la imagen. Ver `fotoDeProductoDelClienteEnSesion`.
 */
test("el precio que trae la foto del cliente no se para como inventado", () => {
  // Catálogo limpio a propósito: sin él, «2500» de los mocasines de `rd`
  // explicaría la cifra por casualidad y la prueba no probaría nada.
  const sinFoto = { ...rd, anuncio: null, catalogo: "Catálogo:\n(sin catálogo cargado)" };

  // Sin la foto delante, esa cifra no se explica con nada: se para.
  assert.ok(
    revisarConReglas("Zapatos De Caballero está en RD$2,500. ¿Qué talla le interesa?", sinFoto)
      .some((f) => f.includes("RD$2500")),
  );

  // Con la foto del cliente delante, en esta sesión, el mismo precio pasa.
  const conFotoDelCliente = {
    ...sinFoto,
    fotoDelCliente: "Producto: Zapatos De Caballero, DCM Estilo. Colores: marrón, gris, blanco/negro. Precio: RD$2,500.",
  };
  assert.deepEqual(
    revisarConReglas("Zapatos De Caballero está en RD$2,500. ¿Qué talla le interesa?", conFotoDelCliente),
    [],
  );

  // Pero no cualquier cifra: una que no está ni en la foto ni en el catálogo sigue inventada.
  assert.ok(
    revisarConReglas("Zapatos De Caballero está en RD$1,990. ¿Qué talla le interesa?", conFotoDelCliente)
      .some((f) => f.includes("RD$1990")),
  );
});

/**
 * EL PRECIO DEL CATÁLOGO SE PARA CUANDO EL ANUNCIO TRAE EL SUYO PROPIO
 * (la dueña, 2026-09-21).
 *
 * La captura de la dueña: un anuncio con su propio precio, $990, vinculado
 * en el catálogo a «Cepillo 5 en 1 Multifuncional» a RD$21,150, y el agente
 * abrió cotizando los RD$21,150 —el número del catálogo, no el que vio el
 * cliente en el anuncio—. La regla 6 (arriba) no lo paraba porque ese número
 * SÍ estaba escrito delante, en la línea del catálogo; hace falta decirle al
 * revisor, aparte, que ESE número en concreto no vale en este chat.
 */
test("el precio del catálogo se para cuando el anuncio vinculado trae el suyo propio", () => {
  const conAnuncioYCatalogo = {
    ...rd,
    anuncio:
      "Este cliente llegó por un anuncio:\n- Producto anunciado: Cepillo 5 en 1 Multifuncional\n" +
      "El precio es \"RD$990\".\n" +
      "El anuncio que trajo a este cliente corresponde a este producto del catálogo:\n" +
      "- Cepillo 5 en 1 Multifuncional — 21150",
    precioDelCatalogoQueNoAplica: 21150,
  };

  const fallas = revisarConReglas(
    "Cepillo 5 en 1 Multifuncional, en RD$21,150. Indíquenos su dirección.",
    conAnuncioYCatalogo,
  );
  assert.ok(
    fallas.some((f) => f.includes("RD$21150") && f.includes("el del anuncio, no el del catálogo")),
    fallas.join(" | "),
  );

  // Con el precio del anuncio, el mismo artículo sí sale.
  assert.deepEqual(
    revisarConReglas(
      "Cepillo 5 en 1 Multifuncional, en RD$990. Indíquenos su dirección.",
      conAnuncioYCatalogo,
    ),
    [],
  );

  // Sin anuncio con precio propio, el precio del catálogo es el bueno de siempre.
  assert.deepEqual(
    revisarConReglas(
      "Cepillo 5 en 1 Multifuncional, en RD$21,150. Indíquenos su dirección.",
      { ...conAnuncioYCatalogo, precioDelCatalogoQueNoAplica: null },
    ),
    [],
  );
});

/**
 * EL COSTO DEL ENVÍO NO ES EL PRECIO DEL ARTÍCULO (la dueña, 2026-09-08).
 *
 * Un anuncio de polos que era solo una foto, sin precio en ninguna parte, y la
 * IA contestando «El precio es RD$250 cada una»: la tarifa de la capital. Es la
 * cifra que tenía a mano.
 */
test("cotizar el artículo con la tarifa del envío no sale", () => {
  const sinPrecio = {
    ...rd,
    anuncio: "Este cliente llegó por un anuncio:\nEste anuncio es SOLO una foto, y esto es lo que se ve en ella: Se ven cinco camisetas de polo en diferentes colores. No hay precios visibles.",
    catalogo: "Catálogo:\n(sin catálogo cargado)",
  };

  for (const cobra of ["El precio es RD$250 cada una. ¿Qué color le interesa?", "Los polos están en RD$290."]) {
    assert.ok(
      revisarConReglas(cobra, sinPrecio).some((f) => f.includes("es la tarifa del ENVÍO")),
      `«${cobra}» no puede salir`,
    );
  }

  // Decir el ENVÍO con esa misma cifra es lo correcto, y sale.
  assert.deepEqual(
    revisarConReglas("Hasta Santo Domingo el envío le sale en RD$250.", sinPrecio),
    [],
  );

  // Y si el catálogo vende algo a esa cifra, ese precio es de verdad.
  assert.deepEqual(
    revisarConReglas("Los polos están en RD$250.", { ...sinPrecio, catalogo: "Catálogo:\n- Polo Brox — 250" }),
    [],
  );
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

  // Ropa: lleva talla Y color, aunque el anuncio no escriba ninguno de los dos.
  // «Las ropas llevan talla y color, los artículos no llevan talla ni color»
  // (la dueña, 2026-09-08). Los colores de una camisa están en la foto, no en
  // el texto del anuncio, y antes eso la dejaba sin paso de color.
  const camisa: ContextoRevision = {
    ...rd,
    catalogo: "Catálogo:\n(sin catálogo cargado)",
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Camisa de lino\n- Lo que promete el anuncio: Camisas de lino para caballeros a RD$1,500.",
  };
  assert.deepEqual(revisarConReglas("La camisa de lino está en RD$1,500.\n\n¿Qué talla necesita?", camisa), []);
  assert.deepEqual(revisarConReglas("¿En qué color la quiere?", camisa), []);

  // Calzado con numeración escrita: el número sí se pregunta.
  const zapatos: ContextoRevision = {
    ...rd,
    catalogo: "Catálogo:\n(sin catálogo cargado)",
    anuncio: "Este cliente llegó por un anuncio:\n- Producto anunciado: Zapatos DCM Estilo\n- Lo que promete el anuncio: Zapatos DCM Estilo RD$2,500. Disponibles en negro y marrón, del 39 al 45.",
  };
  assert.deepEqual(revisarConReglas("¿Qué número calza?", zapatos), []);
  assert.deepEqual(revisarConReglas("Los tenemos en negro y marrón. ¿Cuál le enviamos?", zapatos), []);

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
  assert.deepEqual(revisarConReglas("La tenemos en negro y gris. ¿Cuál te enviamos?", conColores), []);
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

/**
 * EL CASO DE LA DUEÑA (2026-09-07): el cliente mandó su dirección y la IA
 * contestó «Perfecto, Los Coquitos. ¿Me puede decir el número de casa o
 * apartamento y alguna seña para reconocer la puerta?». Con la dirección
 * delante ya se despacha, y para lo demás el mensajero llama al teléfono.
 */
test("con la dirección ya dada, no se pide el número de casa ni la seña de la puerta", () => {
  const conDireccion = {
    ...rd,
    ficha: { talla: null, color: null, direccion: "Los Coquitos, Santo Domingo Este", nombre: null, celular: null, cantidad: null },
  };
  const conPin = { ...rd, clienteCompartioUbicacion: true };

  for (const ctx of [conDireccion, conPin]) {
    assert.ok(
      revisarConReglas("Perfecto, Los Coquitos. ¿Me puede decir el número de casa o apartamento y alguna seña para reconocer la puerta?", ctx)
        .some((f) => f.includes("un dato más de la dirección")),
    );
    assert.ok(
      revisarConReglas("¿Tiene algún punto de referencia para llegar?", ctx)
        .some((f) => f.includes("un dato más de la dirección")),
    );
  }

  // Lo que sí toca: la zona, su envío y el dato que falta.
  assert.deepEqual(
    revisarConReglas("Perfecto, hasta Los Coquitos el envío le sale en RD$250.\n\n¿Me facilita su número de teléfono para el pedido?", conDireccion),
    [],
  );
  // Y el resumen con el apartamento que dio el cliente no es una repregunta.
  assert.deepEqual(
    revisarConReglas("Direccion: calle 3, apartamento 2B, Los Coquitos, Santo Domingo Este", conDireccion),
    [],
  );
  // Sin dirección todavía, preguntar por dónde vive sigue siendo el paso.
  assert.deepEqual(revisarConReglas("Indíquenos su dirección.", rd), []);
});

/**
 * EL CASO DE LA DUEÑA (RD, 2026-09-08): «¿Qué talla le interesa?» → «Poloche
 * que quiero» —que es el artículo, no una medida— y la IA contestó «Perfecto,
 * ya tenemos su talla. ¿En qué color le interesa?». La talla no llegó nunca y
 * el pedido siguió cojo hasta el final.
 */
test("un dato que el cliente no dio no se da por recibido", () => {
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const sinTalla = { ...rd, ficha: vacia, textosDelCliente: ["Poloche que quiero"], ultimoDelCliente: "Poloche que quiero" };

  const f = revisarConReglas("Perfecto, ya tenemos su talla. ¿En qué color le interesa? Disponemos de negro, blanco, azul y gris.", sinTalla);
  assert.ok(f.some((x) => x.includes("da por recibida la talla")), f.join(" | "));

  // Lo mismo con los otros datos del pedido.
  assert.ok(revisarConReglas("Listo, ya tengo su dirección.", sinTalla).some((x) => x.includes("da por recibida la dirección")));
  assert.ok(revisarConReglas("Su nombre queda anotado.", sinTalla).some((x) => x.includes("da por recibido el nombre")));

  // Lo que sí toca: contestarle y volver a pedirle la talla.
  assert.deepEqual(
    revisarConReglas("Claro que sí, tenemos los polos. ¿Qué talla le interesa?", sinTalla),
    [],
  );
  // Y con la talla dicha de verdad, confirmarla no es inventarla.
  const conTalla = { ...sinTalla, ficha: { ...vacia, talla: "XL" }, textosDelCliente: ["XL"], ultimoDelCliente: "XL" };
  assert.deepEqual(revisarConReglas("Perfecto, ya tenemos su talla XL. Indíquenos su dirección.", conTalla), []);
  // Aunque la ficha no lo haya emparejado, si el cliente la escribió, vale.
  assert.ok(
    !revisarConReglas("Perfecto, ya tenemos su talla. ¿Me facilita su número de teléfono?", { ...sinTalla, textosDelCliente: ["uso la 40"], ultimoDelCliente: "uso la 40" })
      .some((x) => x.includes("da por recibida la talla")),
  );
  // Ofrecer las tallas no es darlas por recibidas.
  assert.deepEqual(revisarConReglas("Para la talla tenemos S, M, L y XL. ¿Cuál prefiere?", sinTalla), []);
});

/**
 * LA CAPTURA DE LA DUEÑA (RD, RINCON DCM, 2026-09-23): el cliente preguntó
 * «¿Y dónde están ubicados?» —por la tienda, no dio ninguna dirección propia—
 * y la IA contestó «La dirección completa es: Calle Duarte #45, Los Prados,
 * Santo Domingo, Distrito Nacional. ¿Cómo desea que se le haga el pago al
 * recibir el pedido?». Esa dirección no la escribió el cliente en ningún
 * momento: no es una CONFIRMACIÓN de un dato ya dado —lo que ya pillaba la
 * regla de arriba— sino la AFIRMACIÓN de uno nuevo, inventado de la nada, y
 * encima seguía como si el pedido ya tuviera todos los datos.
 */
test("afirmar una dirección que el cliente no dio tampoco se da por recibida", () => {
  const vacia = { talla: "L", color: "negro", direccion: null, nombre: null, celular: null, cantidad: null };
  const sinDireccion = {
    ...rd,
    ficha: vacia,
    textosDelCliente: ["L", "negro", "Y dónde están ubicados?"],
    ultimoDelCliente: "Y dónde están ubicados?",
  };

  const f = revisarConReglas(
    "La dirección completa es: Calle Duarte #45, Los Prados, Santo Domingo, Distrito Nacional. ¿Cómo desea que se le haga el pago al recibir el pedido?",
    sinDireccion,
  );
  assert.ok(f.some((x) => x.includes("da por recibida la dirección")), f.join(" | "));

  // Lo que sí toca: decir que es tienda virtual y seguir con el pedido.
  assert.deepEqual(
    revisarConReglas("Somos tienda virtual, le llevamos el pedido hasta su casa. Indíquenos su dirección.", sinDireccion),
    [],
  );

  // Con la dirección que el cliente SÍ escribió, confirmarla no es inventarla.
  const conDireccion = {
    ...sinDireccion,
    ficha: { ...vacia, direccion: "Calle Duarte #45, Los Prados" },
    textosDelCliente: [...sinDireccion.textosDelCliente, "Calle Duarte #45, Los Prados"],
    ultimoDelCliente: "Calle Duarte #45, Los Prados",
  };
  assert.deepEqual(
    revisarConReglas("Perfecto, la dirección es Calle Duarte #45, Los Prados. ¿A nombre de quién se lo dejamos?", conDireccion)
      .filter((x) => x.includes("dirección")),
    [],
  );
});

/**
 * EL ENVÍO NO SE GENERALIZA (la dueña, RD, 2026-09-08).
 *
 * «¿Cuánto cuesta el envío?» → «El envío a todo el país es de RD$290.». En
 * República Dominicana hay DOS tarifas —RD$250 en el Gran Santo Domingo y
 * RD$290 al resto—, así que esa frase le cobra de más a media clientela y da
 * por buena una zona que nadie ha dicho. Primero se sabe a dónde va.
 */
test("con dos tarifas, el envío no se cotiza sin saber a dónde va", () => {
  const preguntaElEnvio = { ...rd, ultimoDelCliente: "¿Cuánto cuesta el envío?" };

  // El caso real, tal cual salió.
  assert.ok(
    revisarConReglas("El envío a todo el país es de RD$290.\n\n¿Me facilita su dirección exacta para el pedido?", preguntaElEnvio)
      .some((f) => f.includes("«a todo el país»")),
  );
  // Y una sola cifra, aunque no diga «todo el país».
  assert.ok(
    revisarConReglas("El envío le sale en RD$250.", preguntaElEnvio)
      .some((f) => f.includes("todavía no sabes a dónde va")),
  );

  // Lo que sí toca: decir que depende de la zona y preguntarla.
  assert.deepEqual(
    revisarConReglas("El envío depende de la zona. ¿A qué provincia o sector se lo enviamos?", preguntaElEnvio),
    [],
  );
  // Contarle las DOS con su zona al lado no es generalizar: informa.
  assert.deepEqual(
    revisarConReglas("El envío es RD$250 en el Gran Santo Domingo y RD$290 al resto del país. ¿A qué provincia se lo enviamos?", preguntaElEnvio),
    [],
  );
  // Con la zona ya sabida, su tarifa sale como siempre.
  assert.deepEqual(
    revisarConReglas("Perfecto, hasta Santiago el envío le sale en RD$290.", { ...preguntaElEnvio, lugarDelCliente: "Santiago" }),
    [],
  );
  // Y con la dirección dada, aunque su pueblo no esté en ninguna lista.
  assert.deepEqual(
    revisarConReglas("Perfecto, hasta Guayacánal el envío le sale en RD$290.", {
      ...preguntaElEnvio,
      ficha: { talla: null, color: null, direccion: "Guayacánal, Pueblo Viejo", nombre: null, celular: null, cantidad: null },
    }),
    [],
  );

  /*
   * Donde la tarifa es UNA para todo el país, decirlo así es lo correcto: esto
   * no puede tocar a Costa Rica ni a Panamá.
   */
  assert.deepEqual(revisarConReglas("El envío son ₡3.500 a todo el país.", { ...cr, ultimoDelCliente: "¿cuánto es el envío?" }), []);
  assert.deepEqual(revisarConReglas("El envío es US$5.00 a todo el país.", { ...pa, ultimoDelCliente: "¿cuánto es el envío?" }), []);
});

/**
 * EL CASO DE LA DUEÑA (RD, 2026-09-08): el cliente mandó su dirección en una
 * nota de voz, el agente se la confirmó con el envío y el total, y cuatro
 * mensajes después volvió a abrir el mismo paso —«Perfecto, hasta Guayacánal
 * el envío le sale en RD$290. ¿Me facilita su número de teléfono?»—. Quien ya
 * dio su dirección ve una conversación que no avanza.
 */
test("el costo del envío no se cotiza dos veces en la misma conversación", () => {
  const conDireccion = {
    ...rd,
    ficha: { talla: null, color: null, direccion: "Guayacánal, municipio Pueblo Viejo, calle Emilio Prud'Homme, casa 87", nombre: "Bellyra", celular: null, cantidad: null },
    lugarDelCliente: "Pueblo Viejo",
    textosDelAgente: ["Le confirmo: entrega en calle Emilio Prud'Homme, casa 87, Guayacánal. Son RD$1,690 más RD$290 de envío."],
  };

  assert.ok(
    revisarConReglas("Perfecto, hasta Guayacánal el envío le sale en RD$290. ¿Me facilita su número de teléfono para el pedido?", conDireccion)
      .some((f) => f.includes("vuelve a cotizarle el envío")),
  );

  // Lo que sí toca: pedir lo que falta, a secas.
  assert.deepEqual(revisarConReglas("¿Me facilita su número de teléfono para el pedido?", conDireccion), []);

  // La primera vez sí se dice, claro.
  assert.deepEqual(
    revisarConReglas("Perfecto, hasta Guayacánal el envío le sale en RD$290. ¿Me facilita su número de teléfono para el pedido?", { ...conDireccion, textosDelAgente: [] }),
    [],
  );

  // Y si el cliente cambia de zona, la tarifa nueva se le dice.
  assert.deepEqual(
    revisarConReglas("Perfecto, hasta Los Alcarrizos el envío le sale en RD$250. ¿Me facilita su número de teléfono para el pedido?", { ...conDireccion, ficha: { ...conDireccion.ficha, direccion: "Los Alcarrizos" }, lugarDelCliente: "Los Alcarrizos" }),
    [],
  );
});

/**
 * EL CASO REAL: «en un momento será transferido a un representante» a todo el
 * mundo. Solo con el resumen, por una foto, por mayoreo o si pide persona.
 */
test("una transferencia sin motivo no sale; con motivo, sí", () => {
  const frase = "Permítame un momento, le transfiero con un representante.";

  const preguntaNormal = { ...rd, ultimoDelCliente: "¿Cuánto es el envío a Santiago?" };
  assert.ok(revisarConReglas(frase, preguntaNormal).some((f) => f.includes("sin motivo")));
  assert.ok(revisarConReglas("Le paso con un representante que le atiende eso.", preguntaNormal).some((f) => f.includes("sin motivo")));
  assert.ok(revisarConReglas("Un representante le confirma ese dato.", preguntaNormal).some((f) => f.includes("sin motivo")));

  // Con motivo: foto, mayoreo o persona.
  assert.deepEqual(revisarConReglas(frase, { ...rd, ultimoDelCliente: "¿Me manda una foto?" }), []);
  assert.deepEqual(revisarConReglas(frase, { ...rd, ultimoDelCliente: "¿Cuánto al por mayor si llevo 12?" }), []);
  assert.deepEqual(revisarConReglas(frase, { ...rd, ultimoDelCliente: "Quiero hablar con una persona" }), []);

  // Y con el resumen, siempre.
  const resumen = "Resumen de su pedido:\n\nNombre: Ana Pérez\nCel: 8095551234\nProducto: Mocasines\nCantidad: 1\nDirección: Calle 1 #2, Los Prados, Santo Domingo\nCosto de envío: RD$250\nTotal a pagar: RD$2,750\n\nSu pedido ha sido confirmado exitosamente.\n" + frase;
  const cierre = { ...rd, ultimoDelCliente: "sí, confirmo", textosDelCliente: ["Ana Pérez", "Calle 1 #2, Los Prados, Santo Domingo", "8095551234"], telefonoDelChat: "18095551234" };
  assert.deepEqual(revisarConReglas(resumen, cierre), []);
});

/**
 * Pedir una foto deja de ser motivo de transferencia en cuanto hay foto que
 * mandar: la respuesta es enseñarla, no pasarle el cliente a una persona.
 */
test("con la foto del anuncio guardada, pedirla ya no se transfiere", () => {
  const pideFoto = { ...rd, ultimoDelCliente: "¿me manda fotos?" };
  const frase = "Permítame un momento, le transfiero con un representante. [HANDOFF]";

  assert.equal(transferenciaPermitida(frase, pideFoto), true, "sin foto, se transfiere como siempre");
  assert.equal(transferenciaPermitida(frase, { ...pideFoto, conFoto: true }), false);

  // Y lo que sí sigue transfiriéndose con foto delante: el mayoreo y pedir persona.
  assert.equal(transferenciaPermitida(frase, { ...rd, ultimoDelCliente: "precio al por mayor?", conFoto: true }), true);
  assert.equal(transferenciaPermitida(frase, { ...rd, ultimoDelCliente: "quiero hablar con una persona", conFoto: true }), true);
});

/**
 * EL CASO DE LA DUEÑA (Costa Rica, 2026-09-08): el cliente escribió «Hlola» y
 * «Hola», nada más, y el agente contestó «¿Me confirma qué talla le interesa
 * del Polo Brox?». El polo lo eligió él, del catálogo. Mientras el cliente solo
 * salude, lo único que va es preguntarle qué artículo quiere.
 */
test("con el cliente solo saludando, no se le elige el artículo ni se le piden datos", () => {
  const soloSaludo = {
    ...cr,
    anuncio: null,
    catalogo: "Catálogo:\n- Polo Brox (S, M, L) — 12000",
    textosDelCliente: ["Hlola", "Hola"],
    ultimoDelCliente: "Hola",
    ficha: { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null },
  };

  assert.ok(
    revisarConReglas("¿Me confirma qué talla le interesa del Polo Brox?", soloSaludo)
      .some((f) => f.includes("todavía no sabes qué artículo quiere")),
  );
  // Y el primer mensaje de esa misma captura, que fue pedirle la dirección a un «Hlola».
  assert.ok(
    revisarConReglas("Indique su dirección exacta de entrega.", soloSaludo)
      .some((f) => f.includes("todavía no sabes qué artículo quiere")),
  );

  // Lo que sí toca: saludar y preguntar cuál es el artículo.
  assert.deepEqual(
    revisarConReglas("Hola, le asiste Mildred, un gusto. ¿Cuál es el artículo de su interés?", soloSaludo),
    [],
  );
  // Y enseñarle lo que hay, sin pedirle nada, también.
  assert.deepEqual(
    revisarConReglas("Hola, le asiste Mildred, un gusto. Tenemos el Polo Brox en ₡12.000. ¿Cuál artículo le interesa?", soloSaludo),
    [],
  );

  /*
   * Pero en cuanto el cliente dice qué quiere —aunque lo diga con una palabra
   * que esta casa no reconozca, como «poloche»—, la venta sigue: pararla por no
   * saber leerlo sería perderla por no conocer el idioma.
   */
  const yaDijo = { ...soloSaludo, textosDelCliente: ["Hola", "Poloche que quiero"], ultimoDelCliente: "Poloche que quiero" };
  assert.deepEqual(revisarConReglas("Claro que sí. ¿Qué talla le interesa?", yaDijo), []);
});

/**
 * EL CASO DE LA DUEÑA (República Dominicana, 2026-09-08): el cliente abrió con
 * «Buenas.k precio», el agente le contestó con el artículo pero sin cifra, le
 * sacó la talla, y cuando insistió —«Primero deme precio»— le respondió
 * «Indíquenos su dirección.». Dos veces preguntó lo mismo y las
 * dos se quedó sin respuesta. Nadie da su dirección antes de saber el precio.
 */
test("si el cliente pregunta el precio, se le dice antes de seguir", () => {
  const preguntaPrecio = {
    ...rd,
    catalogo: "Catálogo:\n- Mocasines de cuero — 2500",
    ultimoDelCliente: "Primero deme precio",
    ficha: { talla: "M", color: null, direccion: null, nombre: null, celular: null, cantidad: null },
  };

  assert.ok(
    revisarConReglas("Indíquenos su dirección.", preguntaPrecio)
      .some((f) => f.includes("preguntó el precio")),
  );

  // Lo que sí toca: el precio primero y detrás el paso que iba.
  assert.deepEqual(
    revisarConReglas("Están en RD$2,500. Indíquenos su dirección.", preguntaPrecio),
    [],
  );

  // Y sin ningún precio escrito en ninguna parte, no se inventa: se transfiere.
  const sinPrecio = { ...preguntaPrecio, catalogo: "Catálogo:\n(sin catálogo cargado)", anuncio: null };
  assert.ok(
    revisarConReglas("Indíquenos su dirección.", sinPrecio)
      .some((f) => f.includes("no hay ninguno escrito")),
  );
  assert.deepEqual(
    revisarConReglas("Permítame un momento, le transfiero con un representante.", sinPrecio),
    [],
  );
});

/**
 * AQUÍ NO SE RESERVA NADA, Y OFRECERLO ES PEOR QUE PROMETERLO.
 *
 * La dueña lo pilló en Costa Rica (2026-09-08): «¿Me confirma si desea que le
 * reserve una?». El guion lo prohíbe en los tres países, pero el freno miraba
 * seis frases sueltas —«se lo aparto», «lo reservo»…— y esa forma del verbo no
 * estaba. Y no era una promesa: era un OFRECIMIENTO, que es peor, porque el
 * cliente dice que sí y entonces ya hay algo que incumplir.
 */
test("reservar, apartar, guardar o separar no sale, se diga como se diga", () => {
  for (const frase of [
    "¿Me confirma si desea que le reserve una?",
    "¿Desea que le reservemos una?",
    "Se la reservo hasta mañana.",
    "Con gusto se lo aparto.",
    "¿Quiere que se la guarde?",
    "Le puedo apartar una.",
    "Puedo reservarle una.",
    "Se la aparto para la quincena.",
    "Su pedido queda reservado.",
    "Se lo dejo separado.",
  ]) {
    assert.ok(
      revisarConReglas(frase, cr).some((f) => f.includes("reserva mercancía")),
      `«${frase}» no puede salir`,
    );
  }

  // Y lo que se le parece pero no lo es sigue pasando: parar una respuesta
  // buena también cuesta la venta.
  for (const frase of [
    "Le llega entre 24 y 48 horas.",
    "Guarde el comprobante, por favor.",
    "Le hacemos envío y paga al recibir.",
    "Le anoto la talla M.",
  ]) {
    assert.ok(
      !revisarConReglas(frase, cr).some((f) => f.includes("reserva mercancía")),
      `«${frase}» sí puede salir`,
    );
  }
});

/**
 * LOS PRECIOS POR CANTIDAD SON PRECIOS ESCRITOS, Y NO SE TRANSFIERE POR ELLOS.
 *
 * La dueña (2026-09-09): los polos van a RD$1,400 de una o dos, RD$1,190 de
 * tres a once y RD$990 por docena. Esas dos últimas cifras no están en el
 * anuncio, así que el revisor las habría parado como precio inventado; y a
 * quien preguntaba por la docena se le pasaba a un representante en vez de
 * venderle doce polos.
 */
test("el precio por cantidad de los polos se cotiza y no se transfiere", () => {
  const polos = {
    ...rd,
    catalogo: "Catálogo:\n- Polos Bronx — 1400",
    anuncio: "🖤 POLOS BRONX ORIGINALES 🖤 RD$1,400",
    ultimoDelCliente: "¿a cómo la docena?",
  };

  // Cada borrador contesta a lo que preguntó el cliente: el precio de tres no
  // contesta por la docena, y desde el 10 de septiembre eso lo para una regla.
  assert.deepEqual(
    revisarConReglas("Llevando 3 le salen a RD$1,190 cada uno.", { ...polos, ultimoDelCliente: "¿a cómo salen 3 polos?" }),
    [],
  );
  assert.deepEqual(revisarConReglas("La docena le sale a RD$990 cada uno, RD$11,880 en total.", polos), []);
  assert.ok(
    revisarConReglas("Se los dejo a RD$1,050 cada uno.", polos).some((f) => f.includes("no está escrito")),
    "y un precio que no es de la lista sigue siendo inventado",
  );

  /*
   * Y LA CAPTURA DE LA DUEÑA (2026-09-10): «¿a cómo sale las 12?» contestado
   * con «RD$1,400», que es lo que cuesta uno. La regla de contestar el precio
   * la daba por buena —lleva una cifra escrita, y la lleva—, así que hace falta
   * esta: si preguntó por doce, la cifra que vale es la de doce.
   */
  const porDoce = { ...polos, ultimoDelCliente: "BUENO DIA ESTAM MUY BONITO ACOMO SALE LAS  12" };
  const conElDeUno = revisarConReglas("POLOS BRONX ORIGINALES RD$1,400 ¿Qué talla le interesa?", porDoce);
  assert.ok(
    conElDeUno.some((f) => f.includes("preguntó por 12 unidades") && f.includes("RD$990")),
    `el precio de una no contesta por doce: ${JSON.stringify(conElDeUno)}`,
  );
  assert.deepEqual(
    revisarConReglas("Las 12 le salen a RD$990 cada una: RD$11,880. ¿Qué talla le interesa?", porDoce),
    [],
    "y con la cifra del tramo, pasa",
  );

  const transfiere = "Permítame un momento, le paso con un representante. [HANDOFF]";
  assert.equal(transferenciaPermitida(transfiere, polos), false, "la docena se cotiza, no se pasa a nadie");

  // Sin lista de precios para ese artículo, el mayoreo se transfiere como siempre.
  const combo = { ...polos, catalogo: "Catálogo:\n- Combo 2 en 1 — 1690", anuncio: "Combo 2 en 1 RD$1,690" };
  assert.equal(transferenciaPermitida(transfiere, combo), true);
});

/**
 * A JIMANÍ NO SE LE PROMETE MENSAJERO NI PAGO AL RECIBIR.
 *
 * La dueña (2026-09-10): en la provincia Independencia el pedido va por la
 * guagua, se retira en la parada y se transfiere antes de enviarlo. Prometerle
 * lo de siempre es un paquete que sale sin cobrar o un cliente esperando en su
 * casa a alguien que no va a ir.
 */
test("en la provincia Independencia el revisor para el domicilio y el pago al recibir", () => {
  const enJimani = {
    ...rd,
    anuncio: "COMBO 2 EN 1 RD$1,690",
    ficha: { talla: null, color: null, direccion: "Calle Duarte #12, Jimaní", nombre: null, celular: null, cantidad: null },
    ultimoDelCliente: "Calle Duarte #12, Jimaní",
  };

  const fallas = revisarConReglas(
    "Perfecto, hasta Jimaní se lo llevamos a domicilio y paga al recibir. ¿Me facilita su número de teléfono?",
    enJimani,
  );
  assert.ok(fallas.some((f) => f.includes("promete entrega a domicilio")), "allá no entra el mensajero");
  assert.ok(fallas.some((f) => f.includes("paga al recibir")), "y no se cobra al entregar");

  // Y lo que sí toca, pasa.
  assert.deepEqual(
    revisarConReglas(
      "Perfecto, hasta la provincia Independencia el envío le sale en RD$290. Allá el pedido va por la guagua y usted lo retira en la parada, y el pago es por transferencia antes de enviarlo.\n¿Me facilita su número de teléfono para el pedido?",
      enJimani,
    ),
    [],
  );

  // En la capital sigue mandando lo de siempre: a domicilio y contra entrega.
  const enLaCapital = { ...enJimani, ficha: { ...enJimani.ficha, direccion: "Los Mina, Santo Domingo Este" }, ultimoDelCliente: "Los Mina" };
  assert.deepEqual(
    revisarConReglas("Perfecto, hasta Gran Santo Domingo el envío le sale en RD$250 y paga al recibir.\n¿Me facilita su número de teléfono para el pedido?", enLaCapital),
    [],
  );
});

/**
 * SI EL EQUIPO LE DEVUELVE EL HILO, NO SE TRANSFIERE.
 *
 * La dueña (2026-09-10): «no respondió, y cuando le transferí para que responda,
 * transfirió a un representante; esto no lo puede hacer». Pulsar «Contesta la
 * IA» ES una persona diciendo que aquí contesta el agente. Devolver otra
 * transferencia deja al cliente esperando y al equipo dando vueltas con el
 * mismo hilo.
 */
test("con el hilo devuelto por el equipo, la transferencia no pasa", () => {
  const transfiere = "Permítame un momento, le transfiero con un representante. [HANDOFF]";
  const pideOtro = {
    ...rd,
    anuncio: "POLO BRONX RD$1,400",
    ultimoDelCliente: "¿tiene otro modelo de más calidad?",
    conFoto: true,
  };

  // Sin devolver el hilo, pedir otro artículo sí es motivo: lo manda el guion.
  assert.equal(transferenciaPermitida(transfiere, pideOtro), true);

  // Devuelto, no hay motivo que valga: contesta él.
  const devuelto = { ...pideOtro, retomado: true };
  assert.equal(transferenciaPermitida(transfiere, devuelto), false);
  assert.ok(
    revisarConReglas(transfiere, devuelto).some((f) => f.includes("sin motivo")),
    "y el revisor para el borrador que se escapa",
  );
  // Tampoco por una foto que no tiene, ni porque pida hablar con alguien: eso
  // último ya lo decidió la persona que le devolvió el chat.
  assert.equal(transferenciaPermitida(transfiere, { ...devuelto, conFoto: false, ultimoDelCliente: "mándeme fotos" }), false);

  // El resumen sí pasa: cerrar el pedido y pasarlo es el final bueno.
  assert.equal(
    transferenciaPermitida("Resumen de su pedido:\nTOTAL A PAGAR: RD$1,650\n[HANDOFF]", devuelto),
    true,
  );

  // Y la respuesta de respaldo tampoco se despide: sigue el pedido.
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  assert.equal(
    respuestaMinima(rd.datos, vacia, { descripcion_anuncio: "POLO BRONX RD$1,400" }, {
      ultimoDelCliente: "¿tiene otro modelo de más calidad?",
      retomado: true,
    }),
    "¿Qué talla le interesa?",
  );
});

/** Y el revisor no deja pasar la respuesta que se la salta. */
test("preguntar de qué es el artículo se contesta con el anuncio, o el revisor para", () => {
  const conAnuncio = {
    ...rd,
    anuncio: "POLOS BRONX ORIGINALES Moderno, Fresco y duradero RD$1,400",
    ultimoDelCliente: "Donde son hechos",
  };

  assert.ok(
    revisarConReglas("¿Qué talla le interesa?", conAnuncio).some((f) => f.includes("de qué es el artículo")),
    "no se le puede contestar con el siguiente paso a secas",
  );
  assert.deepEqual(
    revisarConReglas("Son originales, de la marca Bronx.\n¿Qué talla le interesa?", conAnuncio),
    [],
  );

  // Lo que el anuncio no dice no se para: no se inventa un material.
  const sinDato = { ...conAnuncio, anuncio: "MOCHILA ANTIRROBO 45 LITROS RD$2,000" };
  assert.equal(
    revisarConReglas("Eso se lo confirmo con el equipo. Indíquenos su dirección.", sinDato)
      .some((f) => f.includes("de qué es el artículo")),
    false,
  );
});

/**
 * MEDIA DOCENA ES SEIS, Y A RD$1,190 CADA UNA.
 *
 * La dueña (2026-09-11): «me le está dando al cliente media docena al precio de
 * uno; media docena es a 1,190 cada una, verifica qué se está filtrando». La
 * pregunta se contestaba bien; lo que se filtraba era el pedido: la cantidad
 * que el cliente decía no llegaba a la ficha —solo se apuntaba si se
 * preguntaba, y no se pregunta nunca—, y el resumen salía con una unidad a
 * precio de una. Y si el modelo escribía las seis a RD$1,400, el revisor lo
 * daba por bueno porque esa cuenta «se explica» con cifras conocidas.
 */
test("la media docena llega al pedido y se cobra al precio de seis", () => {
  const polos = "POLOS BRONX ORIGINALES RD$1,400 C/U RD$1,190 al por mayor";

  // 1. La ficha se queda con las que dijo él, aunque nadie se lo preguntara.
  const ficha = fichaDelPedido(
    [
      { emisor: "ia", content: "POLOS BRONX ORIGINALES\nRD$1,400\n¿Qué talla le interesa?", created_at: 1_760_000_000 },
      { emisor: "cliente", content: "quiero media docena, talla L", created_at: 1_760_000_060 },
    ],
    rd.datos,
  );
  assert.equal(ficha.cantidad, "6");

  // 2. El resumen de la casa cobra las seis a RD$1,190.
  const mecanico = resumenMecanico(
    rd.datos,
    { ...ficha, color: "azul", direccion: "Los Alcarrizos", nombre: "Ana Pérez", celular: "8095551234" },
    { descripcion_anuncio: polos },
    { telefonoDelChat: "8095551234" },
  )!;
  assert.ok(mecanico.includes("Cantidad: 6"), mecanico);
  assert.ok(mecanico.includes("TOTAL A PAGAR: RD$7,390"), "6 × 1,190 + 250 de envío");

  // 3. Y el revisor para el resumen del modelo que se equivoca en cualquiera de las dos.
  const ctx = {
    ...rd,
    anuncio: polos,
    marcador: "Resumen:",
    textosDelCliente: ["quiero media docena, talla L", "azul", "Los Alcarrizos", "Ana Pérez", "8095551234"],
    ultimoDelCliente: "Ana Pérez",
    telefonoDelChat: "8095551234",
  };
  const resumen = (cantidad: number, total: string) =>
    `📋 RESUMEN DEL PEDIDO\nNombre: Ana Pérez\nTelefono: 8095551234\nDireccion: Los Alcarrizos\n` +
    `Producto: Polos Bronx Originales\nTalla: L\nColor: azul\nCantidad: ${cantidad}\nEnvio: RD$250\n` +
    `TOTAL A PAGAR: ${total}\nForma de pago: contra entrega\n✅ PEDIDO REGISTRADO`;

  assert.ok(
    revisarConReglas(resumen(1, "RD$1,650"), ctx).some((f) => f.includes("pidió 6 unidades")),
    "una unidad a quien pidió seis",
  );
  assert.ok(
    revisarConReglas(resumen(6, "RD$8,650"), ctx).some((f) => f.includes("no el precio de una")),
    "las seis a precio de una",
  );
  assert.equal(
    revisarConReglas(resumen(6, "RD$7,390"), ctx).some((f) => /unidades|precio de una/.test(f)),
    false,
    "y las seis a RD$1,190 pasan",
  );
});

test("Costa Rica transfiere un artículo desconocido sin anuncio", () => {
  const ctx = { ...cr, anuncio: null, catalogo: "Catálogo:\n- Camisa de lino — ₡15.000", ultimoDelCliente: "Quiero una nevera" };
  assert.equal(
    transferenciaPermitida("Permítame un momento, le transfiero con un representante. [HANDOFF]", ctx),
    true,
  );
});

/**
 * PERO NO POR EL NOMBRE QUE LE DÉ EL CLIENTE.
 *
 * La dueña (2026-09-09): «en Costa Rica, desde que le hablen de faja,
 * transfiere; la faja es cinturón, correa, este es el lenguaje que se utiliza
 * aquí, debe vender de forma normal». El catálogo dice «correa», el cliente
 * dice «faja», y esa palabra costaba la venta entera.
 */
test("en Costa Rica «faja» es la correa del catálogo: no se transfiere por eso", () => {
  const transfiere = "Permítame un momento, le transfiero con un representante. [HANDOFF]";
  const catalogo = "Catálogo:\n- Correa reversible para hombre — ₡9.000\n- Cepillo secador — ₡12.500";
  const conFaja = { ...cr, anuncio: null, catalogo, ultimoDelCliente: "Buenas, me interesa la faja" };

  assert.equal(transferenciaPermitida(transfiere, conFaja), false, "eso es la correa, y se vende");
  assert.ok(
    revisarConReglas(transfiere, conFaja).some((f) => f.includes("sin motivo")),
    "y el revisor para el borrador que la pasa a una persona",
  );

  // Lo que de verdad no se vende sigue pasando a una persona.
  assert.equal(
    transferenciaPermitida(transfiere, { ...conFaja, ultimoDelCliente: "¿tienen refrigeradoras?" }),
    true,
  );

  // Y preguntar la talla de una faja tica es lo correcto: es un cinturón.
  const anuncioFaja = { ...cr, anuncio: "FAJA REVERSIBLE PARA HOMBRE ₡9.000", esApertura: true };
  assert.deepEqual(
    revisarConReglas("Hola, le asiste Mildred de TELLERIA\nFAJA REVERSIBLE PARA HOMBRE\n₡9.000\n¿Qué talla le interesa?", anuncioFaja),
    [],
  );
});

/** El saludo va una sola vez: fuera de la apertura, presentarse otra vez no sale. */
test("presentarse otra vez a mitad de conversación no sale", () => {
  const enMedio = { ...cr, esApertura: false };
  assert.ok(revisarConReglas("Hola, le asiste Mildred de TELLERIA\n\n¿A qué dirección se lo enviamos?", enMedio).some((f) => f.includes("saludar")));
  assert.ok(revisarConReglas("Gracias, le asiste TELLERIA. ¿Me regala su nombre?", enMedio).some((f) => f.includes("saludar")));
  assert.deepEqual(revisarConReglas("Con mucho gusto. ¿Me regala su dirección?", enMedio), []);
  // En la apertura, el saludo va.
  assert.deepEqual(revisarConReglas("Hola, le asiste Mildred de TELLERIA\n\n¿Qué talla le interesa?", { ...cr, esApertura: true }), []);
});

/**
 * EL CASO REAL: «¿Qué número calza?» tres veces seguidas, y un «¿dónde
 * están?» del cliente sin contestar. El revisor para las dos cosas.
 */
test("el mismo mensaje dos veces seguidas no sale, y una pregunta del cliente se contesta", () => {
  const repite = { ...rd, ultimoDelAgente: "¿Qué número calza?", ultimoDelCliente: "Yo vivo en pekín" };
  assert.ok(revisarConReglas("¿Qué número calza?", repite).some((f) => f.includes("exactamente lo mismo")));
  assert.ok(revisarConReglas("¿qué número calza?", repite).some((f) => f.includes("exactamente lo mismo")), "sin importar mayúsculas");
  assert.deepEqual(revisarConReglas("Solo enviamos dentro del país. ¿En qué provincia se encuentra?", repite), []);

  const pregunta = { ...rd, ultimoDelCliente: "Donde tuta", ultimoDelAgente: "Claro que sí. ¿En qué provincia se encuentra?" };
  assert.ok(revisarConReglas("¿Qué número calza?", pregunta).some((f) => f.includes("dónde están")));
  assert.deepEqual(revisarConReglas("Somos tienda virtual y enviamos a todo el país. ¿Qué número calza?", pregunta), []);

  const envio = { ...rd, ultimoDelCliente: "¿Cuánto es el envío?", ultimoDelAgente: "¿Qué número calza?" };
  assert.ok(revisarConReglas("¿A nombre de quién sale el pedido?", envio).some((f) => f.includes("envío")));
  assert.deepEqual(revisarConReglas("El envío es RD$250 en el Gran Santo Domingo y RD$290 al interior. ¿Qué número calza?", envio), []);
});

/**
 * EL CASO REAL en Costa Rica: «¿Maestro, me regala su talla para la faja?».
 * Al cliente no se le llama maestro, jefe ni amigo: trato de empresa. Y a
 * «¿cuáles son los tamaños disponibles?» se contesta con las tallas.
 */
test("un apodo al cliente no sale, y una pregunta por las tallas se contesta con las tallas", () => {
  assert.ok(revisarConReglas("¿Maestro, me regala su talla para la faja reversible para hombre?", cr).some((f) => f.includes("«Maestro»")));
  assert.ok(revisarConReglas("Hola, amigo. ¿Qué talla necesita?", cr).some((f) => f.includes("«amigo»")));
  assert.ok(revisarConReglas("Con mucho gusto, jefe.", rd).some((f) => f.includes("«jefe»")), "en ningún país");
  assert.deepEqual(revisarConReglas("Con mucho gusto, don Chema. ¿Me regala su talla?", cr), [], "por su nombre sí");
  assert.deepEqual(revisarConReglas("Le atiende el maestro sastre de la tienda.", cr), [], "una palabra que no es un apodo al cliente no cuenta");

  const tallas = { ...cr, ultimoDelCliente: "¿Cuáles son los tamaños disponibles?", ultimoDelAgente: "Hola, le asiste Mildred de TELLERIA" };
  assert.ok(revisarConReglas("La faja es de excelente calidad. ¿Qué talla necesita?", tallas).some((f) => f.includes("tallas disponibles")));
  assert.deepEqual(revisarConReglas("Las tallas disponibles son de la 30 a la 42. ¿Cuál le interesa?", tallas), []);
  assert.deepEqual(revisarConReglas("La tenemos en S, M, L y XL. ¿Cuál le interesa?", tallas), []);
});

/**
 * EL CASO REAL: «el envío a Santo Domingo Este son RD$290». Santo Domingo Este
 * es Gran Santo Domingo y va a RD$250, diga lo que diga el hilo: la zona que
 * nombra la propia frase manda.
 */
test("la tarifa de la zona que nombra el propio texto manda", () => {
  assert.ok(revisarConReglas("El envío a Santo Domingo Este le sale en RD$290.", rd).some((f) => f.includes("RD$250")));
  assert.ok(revisarConReglas("El envío a Sto Dgo Este es de RD$290.", rd).some((f) => f.includes("RD$250")));
  assert.ok(revisarConReglas("A Santiago el envío son RD$250.", rd).some((f) => f.includes("RD$290")));
  assert.deepEqual(revisarConReglas("El envío a Santo Domingo Este le sale en RD$250.", rd), []);
  assert.deepEqual(revisarConReglas("El envío a Santiago son RD$290.", rd), []);
});

/**
 * «EL LUNES LE LLAMO» Y EL AGENTE SIGUIÓ PIDIENDO DATOS (RD, 2026-09-07).
 *
 * La captura: se le pidió la dirección, el cliente contestó «El lunes le
 * llamo» y le llegó «Perfecto, hasta esa fecha. ¿Me facilita su número de
 * teléfono para el pedido?». Insistirle a alguien que ya se despidió es lo
 * que hace que el lunes no escriba.
 */
/**
 * Y AL QUE DICE QUE NO, TAMPOCO. Y sin celebrárselo.
 *
 * La captura (Costa Rica, 2026-09-09): «No voy a continuar con la compra,
 * gracias» → «Con mucho gusto. ¿Me regala su nombre completo para el pedido?».
 */
test("al cliente que dice que no se le deja ir, y no se le contesta «con mucho gusto»", () => {
  const dijoQueNo = {
    ...cr,
    anuncio: "CINTURÓN REVERSIBLE PARA HOMBRE ₡9.000",
    ultimoDelCliente: "No voy a continuar con la compra, gracias",
    ultimoDelAgente: "¿Me confirma qué talla necesita del cinturón reversible para poder finalizar su pedido?",
  };

  const fallas = revisarConReglas("Con mucho gusto. ¿Me regala su nombre completo para el pedido?", dijoQueNo);
  assert.ok(fallas.some((f) => f.includes("NO sigue con la compra")), "no se le siguen pidiendo datos");
  assert.ok(fallas.some((f) => f.includes("celebrando un «no»")), "y no se le celebra la retirada");

  // El resumen tampoco: un pedido que él acaba de rechazar no se levanta.
  assert.ok(
    revisarConReglas("📋 RESUMEN DEL PEDIDO\nNombre: Ana\nTOTAL A PAGAR: ₡12.500", dijoQueNo)
      .some((f) => f.includes("no ha aceptado")),
  );

  // Y la despedida sí sale.
  assert.deepEqual(
    revisarConReglas("Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.", dijoQueNo),
    [],
  );
});

test("al cliente que dice cuándo vuelve no se le siguen pidiendo datos del pedido", () => {
  const aplaza = {
    ...rd,
    anuncio: "Anuncio: 🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora.",
    ultimoDelCliente: "El lunes le llamo",
  };
  for (const insiste of [
    "Perfecto, hasta esa fecha. ¿Me facilita su número de teléfono para el pedido?",
    "¿A qué número le llama el mensajero, a este mismo?",
    "Indíquenos su dirección.",
    "Claro que sí. ¿A nombre de quién sale el pedido?",
  ]) {
    assert.ok(
      revisarConReglas(insiste, aplaza).some((f) => f.includes("vuelve más adelante")),
      `«${insiste}» a alguien que dijo que llama el lunes no sale`,
    );
  }

  // Ni el resumen: un pedido que no aceptó no se levanta.
  assert.ok(
    revisarConReglas(
      "Resumen:\n\nNombre: Juan Pérez\nCel: 8095551234\nProducto: Combo 2 en 1\nDirección: Villa Mella, calle 8\nTotal a pagar: RD$1,940",
      aplaza,
    ).some((f) => f.includes("vuelve más adelante")),
  );

  // Despedirse sí sale, y la venta normal no se toca.
  assert.deepEqual(
    revisarConReglas("Entiendo, no hay problema. Cuando esté listo para ordenar, escríbanos y con gusto le atendemos.", aplaza),
    [],
  );
  assert.deepEqual(
    revisarConReglas("Indíquenos su dirección.", { ...aplaza, ultimoDelCliente: "Quiero el combo" }),
    [],
    "al que sigue comprando se le pide lo que falta",
  );
});

/**
 * EL CASO REAL en República Dominicana: talla y color a un cepillo, a un
 * blower y a una plancha. No llevan ni lo uno ni lo otro: se pasa a la
 * provincia.
 */
test("a un cepillo, un blower o una plancha no se les pregunta talla ni color, se pregunte como se pregunte", () => {
  const combo = {
    ...rd,
    anuncio: "Anuncio: 🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora. Seca rápido y ahorra tiempo.",
    ultimoDelCliente: "Quiero más información",
  };
  for (const pregunta of [
    "¿Qué talla necesita?",
    "¿Me indica su talla, por favor?",
    "¿Qué número calza?",
    "¿En qué talla lo quiere?",
    "¿De qué color lo prefiere?",
    "¿Qué color le gustaría?",
  ]) {
    const fallas = revisarConReglas(`Claro que sí. ${pregunta}`, combo);
    assert.ok(fallas.some((f) => f.includes("talla") || f.includes("color")), `«${pregunta}» a un combo de cepillo y plancha no sale`);
  }
  assert.deepEqual(
    revisarConReglas("El combo de cepillo secador y plancha alisadora está en RD$1,690. Le hacemos envío y paga al recibir. ¿En qué provincia se encuentra?", combo),
    [],
    "sin talla ni color se pasa a la provincia",
  );

  /*
   * Y LA FOTO NO LO CONVIERTE EN ELEGIBLE. Desde que el color se pregunta con
   * la foto delante —para la ropa y el calzado, cuyos colores están en la
   * imagen y no en el texto—, ese permiso se le colaba también al combo: salía
   * precioso en la foto y el agente le preguntaba el color. La dueña lo avisó
   * (2026-09-08). Lo que se vende fijo se vende fijo, se vea como se vea.
   */
  for (const anuncio of [
    "Anuncio: COMBO 2 EN 1 — RD$1,690. Cepillo secador + plancha alisadora.",
    "Anuncio: ABEJÓN recargable — RD$950.",
    "Anuncio: Plancha alisadora profesional — RD$1,400.",
  ]) {
    const conFoto = { ...combo, anuncio, conFoto: true };
    assert.ok(
      revisarConReglas("¿Qué color le interesa?", conFoto).some((f) => f.includes("pregunta el color")),
      `${anuncio} no lleva color ni con la foto delante`,
    );
    assert.ok(
      revisarConReglas("¿Qué talla le interesa?", conFoto).some((f) => f.includes("talla")),
      `${anuncio} tampoco lleva talla`,
    );
  }

  // A lo que SÍ se elige —zapato, camisa, pantalón— la foto sí le abre el color.
  for (const anuncio of [
    "Anuncio: Zapatos de cuero, size 39 al 45 — RD$2,500.",
    "Anuncio: Camisa manga larga — RD$1,100.",
    "Anuncio: Pantalón cargo — RD$1,290.",
  ]) {
    const conFoto = { ...combo, anuncio, conFoto: true };
    assert.ok(
      !revisarConReglas("¿Qué color le interesa?", conFoto).some((f) => f.includes("pregunta el color")),
      `${anuncio} sí elige color viendo la foto`,
    );
  }

  const blower = { ...rd, anuncio: "Anuncio: BLOWER PROFESIONAL 2000W, RD$2,500. Secado rápido.", ultimoDelCliente: "Hola" };
  assert.ok(revisarConReglas("¿Qué talla le interesa?", blower).some((f) => f.includes("talla")));
});

/**
 * «¿SE LO DESPACHO HOY MISMO?» ES EL CIERRE que la dueña escribió en sus
 * guiones de Costa Rica y de República Dominicana (2026-09-05): la palabra
 * «despachar» ya no se para en ningún país.
 */
test("«despachar» pasa: es el cierre de los guiones de la dueña", () => {
  assert.deepEqual(revisarConReglas("¿Se lo despacho hoy mismo?", cr), []);
  assert.deepEqual(revisarConReglas("¿Se lo despacho hoy mismo?", contexto("do")), []);
  assert.deepEqual(revisarConReglas("¿Se lo despachamos hoy mismo?", contexto("pa")), []);
});

/**
 * LA CAPTURA DE LA DUEÑA (2026-09-05): «El combo 2 en 1 incluye un cepillo
 * secador y una plancha alisadora, en negro y rosa. […] ¿Qué talla le
 * interesa?». Talla a un combo, colores que la descripción no dice, y un
 * primer mensaje que no es el del documento. Las tres se paran.
 */
test("un combo no lleva talla aunque el catálogo hable de tallas, y un color que no está escrito no se nombra", () => {
  const combo = {
    ...rd,
    catalogo: "Catálogo:\n- Camisas lino talla S a XL — 1,850\n- Mocasines de cuero — 2500",
    anuncio: "Anuncio: 🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora. Seca rápido y ahorra tiempo.",
    esApertura: true,
    ultimoDelCliente: "¡Hola! Quiero más información",
  };
  const captura =
    "Hola, perfecto. El combo 2 en 1 incluye un cepillo secador y una plancha alisadora, en negro y rosa. Tiene control de temperatura, seca rápido, alisa, da brillo, aporta volumen y movimiento, y es ideal para un acabado profesional en casa. El precio es RD$1,690. ¿Qué talla le interesa?";
  const fallas = revisarConReglas(captura, combo);
  assert.ok(fallas.some((f) => f.includes("talla")), "talla a un combo, aunque el catálogo tenga camisas con talla");
  assert.ok(fallas.some((f) => f.includes("«negro», «rosa»")), "colores que la descripción no dice");
  assert.ok(fallas.some((f) => f.includes("empieza con «Hola! Bienvenido(a) a RINCON DCM")), "el primer mensaje no es el del documento");

  // El primer mensaje del documento pasa limpio.
  const bueno = "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.\n🖤 COMBO 2 EN 1 🖤\nRD$1,690\nIndíquenos su dirección.";
  assert.deepEqual(revisarConReglas(bueno, combo), []);
  // Y preguntar cuántas unidades es una falla (la dueña, 2026-09-05): se asume una.
  const conCantidad = "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.\n🖤 COMBO 2 EN 1 🖤\nRD$1,690\n¿Cuántas unidades desea?";
  assert.ok(revisarConReglas(conCantidad, combo).some((f) => f.includes("pregunta la cantidad")));

  // Un color que sí está en la descripción se puede nombrar.
  const conColores = { ...rd, anuncio: "Anuncio: Camisa de lino RD$1,850, en blanco, azul y negro.", esApertura: false };
  assert.deepEqual(revisarConReglas("La tenemos en blanco, azul y negro. ¿Cuál le interesa?", conColores), []);
  assert.ok(revisarConReglas("La tenemos en rojo. ¿Le interesa?", conColores).some((f) => f.includes("«rojo»")));
});

/**
 * LA CAPTURA DE LA DUEÑA (2026-09-05): «Le confirmo: Camisa Bronx Original,
 * RD$1,400 cada uno. ¿A qué provincia se lo enviamos?» como primer mensaje a
 * un «Precio». Sin saludo, sin talla y con un «Le confirmo» sin datos.
 */
test("a una camisa se le pregunta la talla antes que la provincia, y «Le confirmo» espera a tener los datos", () => {
  const camisa = {
    ...rd,
    anuncio: "Anuncio: 🔥 CAMISA BRONX ORIGINAL 🔥 Moderna, fresca y duradera 👕 RD$1,400 C/U RD$1,190 al por mayor 📦 ENVÍO A TODO EL PAÍS y PAGA AL MOMENTO DE RECIBIR",
    ficha: { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null },
    esApertura: true,
    ultimoDelCliente: "Precio",
  };
  const fallas = revisarConReglas("Le confirmo: Camisa Bronx Original, RD$1,400 cada uno.\n¿A qué provincia se lo enviamos?", camisa);
  assert.ok(fallas.some((f) => f.includes("antes de la talla")), "la talla va antes que la provincia");
  assert.ok(fallas.some((f) => f.includes("«Le confirmo» sin tener")), "la confirmación espera a los datos");
  assert.ok(fallas.some((f) => f.includes("empieza con «Hola! Bienvenido(a)")), "y el primer mensaje saluda");

  const bien = "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.\n🖤 CAMISA BRONX ORIGINAL 🖤\nRD$1,400\n¿Qué talla le interesa?";
  assert.deepEqual(revisarConReglas(bien, camisa), []);

  // Con la talla ya dada, pedir la dirección es lo que toca.
  const conTalla = { ...camisa, esApertura: false, ficha: { ...camisa.ficha, talla: "M" }, ultimoDelCliente: "M" };
  assert.deepEqual(revisarConReglas("Indíquenos su dirección.", conTalla), []);
  // Y el «Le confirmo» con todo, también.
  const completo = { ...conTalla, ficha: { ...conTalla.ficha, direccion: "Calle 3, Los Mina, Santo Domingo Este", nombre: "Pedro Sabater" }, textosDelCliente: ["M", "Calle 3, Los Mina, Santo Domingo Este", "Pedro Sabater"], ultimoDelCliente: "Pedro Sabater" };
  assert.deepEqual(revisarConReglas("Le confirmo: Camisa Bronx Original, talla M, a nombre de Pedro Sabater, entrega en Calle 3, Los Mina, Santo Domingo Este.\nSon RD$1,400 más RD$250 de envío, total RD$1,650, y se paga al recibir.\n¿Se lo despacho hoy mismo?", completo), []);
});

/**
 * EL PEDIDO QUE SE REGISTRÓ Y NO ERA EL DEL CLIENTE (2026-09-07). El resumen
 * salió entero, con «Direccion: Si yo.le escomprado», «Color: Para cuando» y
 * «Producto: ORDENA, RECIBE Y LUEGO PAGA!!», y ni el revisor ni el supervisor
 * le pusieron una pega.
 */
test("un resumen con una frase por dirección, un color que no es color y el reclamo por producto no sale", () => {
  const zapatos = {
    ...rd,
    anuncio: "Anuncio: Compra seguro! ORDENA, RECIBE Y LUEGO PAGA!! Luce un estilo exclusivo con zapatos de acabado premium. Precio: RD$2,500",
    textosDelCliente: ["39", "Para cuando", "Si yo.le escomprado", "Cecilio Tavare", "8295193109"],
    telefonoDelChat: "8295193109",
    ficha: { talla: "39", color: null, direccion: null, nombre: "Cecilio Tavare", celular: "8295193109", cantidad: null },
  };
  const resumen = (cambios: Record<string, string> = {}) => {
    const l = {
      Direccion: "Si yo.le escomprado",
      Producto: "ORDENA, RECIBE Y LUEGO PAGA!!",
      Talla: "39",
      Color: "Para cuando",
      ...cambios,
    };
    return `📋 RESUMEN DEL PEDIDO\nNombre: Cecilio Tavare\nTelefono: 8295193109\nDireccion: ${l.Direccion}\nProducto: ${l.Producto}\nTalla: ${l.Talla}\nColor: ${l.Color}\nCantidad: 1\nEnvio: RD$290\nTOTAL A PAGAR: RD$2,790\nForma de pago: contra entrega\n✅ PEDIDO REGISTRADO`;
  };

  const fallas = revisarConReglas(resumen(), zapatos);
  assert.ok(fallas.some((f) => f.includes("no es una dirección")), "«Si yo.le escomprado» no es una casa");
  assert.ok(fallas.some((f) => f.includes("como color y eso no es un color")), "«Para cuando» no es un color");
  assert.ok(fallas.some((f) => f.includes("no dice qué se vende")), "el producto no puede ser el reclamo del anuncio");

  // Y una talla que el cliente nunca dijo tampoco pasa.
  assert.ok(
    revisarConReglas(resumen({ Talla: "32" }), zapatos).some((f) => f.includes("no la escribió")),
    "una talla inventada no entra en el pedido",
  );

  // El mismo pedido, bien —y sin línea de color, que este artículo no lo lleva—: sale sin una pega.
  const direccion = "Calle 5 #12, Villa Progreso, Higüey";
  const bueno = { ...zapatos, textosDelCliente: [...zapatos.textosDelCliente, direccion] };
  const pedidoBueno = `📋 RESUMEN DEL PEDIDO\nNombre: Cecilio Tavare\nTelefono: 8295193109\nDireccion: ${direccion}\nProducto: Zapatos de acabado premium\nTalla: 39\nCantidad: 1\nEnvio: RD$290\nTOTAL A PAGAR: RD$2,790\nForma de pago: contra entrega\n✅ PEDIDO REGISTRADO`;
  assert.deepEqual(revisarConReglas(pedidoBueno, bueno), []);
});

/**
 * «Perfecto, le añado un pantalón polo color negro talla 32. ¿Desea algo más?»
 * en un hilo abierto por un anuncio de zapatos: un artículo que no existe,
 * metido a mitad del pedido, y la pregunta que vuelve a abrir la venta.
 */
test("no se añade al pedido un artículo de otra familia, ni se pregunta si desea algo más", () => {
  const zapatos = { ...rd, anuncio: "Anuncio: zapatos de acabado premium RD$2,500" };
  const fallas = revisarConReglas("Perfecto, le añado un pantalón polo talla 32. ¿Desea algo más?", zapatos);
  assert.ok(fallas.some((f) => f.includes("al pedido")), "el pedido no cambia de artículo a mitad");
  assert.ok(fallas.some((f) => f.includes("algo más")), "esa pregunta vuelve a abrir la venta");

  // Cambiar de artículo cuando el cliente lo pide sigue estando permitido.
  assert.deepEqual(revisarConReglas("Los zapatos están en RD$2,500. ¿Qué talla le interesa?", zapatos), []);
});

/**
 * EL CASO REAL DE REPÚBLICA DOMINICANA: un anuncio de POLOS, el cliente
 * contesta «XXL» y le vuelve a llegar el saludo entero, palabra por palabra,
 * con la misma pregunta de la talla debajo.
 */
test("a unos polos se les pregunta la talla, y el saludo no sale por segunda vez", () => {
  const polos = {
    ...rd,
    anuncio: "Anuncio: 🖤 POLOS BRONX ORIGINALES 🖤 Moderno, Fresco y duradero RD$1,400",
    ficha: { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null },
    esApertura: true,
    ultimoDelCliente: "Hola, quiero información",
  };
  const apertura = "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.\n🖤 POLOS BRONX ORIGINALES 🖤\nRD$1,400\n¿Qué talla le interesa?";
  assert.deepEqual(revisarConReglas(apertura, polos), [], "un polo lleva talla, como dice la tabla de la tienda");

  // Y con el «XXL» contestado, esa misma apertura ya no sale: ni la pregunta ni el saludo.
  const conTalla = {
    ...polos,
    esApertura: false,
    ficha: { ...polos.ficha, talla: "XXL" },
    ultimoDelCliente: "XXL",
    ultimoDelAgente: apertura,
    textosDelCliente: ["Hola, quiero información", "XXL"],
  };
  const fallas = revisarConReglas(apertura, conTalla);
  assert.ok(fallas.some((f) => f.includes("vuelve a preguntar talla")), "la talla ya la dio");
  assert.ok(fallas.some((f) => f.includes("exactamente lo mismo")), "y el mensaje es el mismo de antes");
  assert.ok(fallas.some((f) => f.includes("vuelve a saludar")), "el saludo va una sola vez");
  assert.deepEqual(revisarConReglas("Indíquenos su dirección.", conTalla), []);

  /*
   * Y con una FOTO en medio tampoco. El segundo caso real: el agente mandó la
   * imagen del anuncio, el cliente contestó los colores que quería y le llegó
   * otra vez la bienvenida entera. Con la foto de por medio, el saludo ya no
   * es lo último que mandó el agente, pero sigue estando dicho.
   */
  const trasLaFoto = { ...conTalla, ultimoDelCliente: "Azul claro y oscuro", ultimoDelAgente: "[imagen]" };
  assert.ok(
    revisarConReglas(apertura, trasLaFoto).some((f) => f.includes("vuelve a saludar")),
    "el saludo no vuelve aunque en medio haya ido una foto",
  );
});

/**
 * EL CASO REAL (2026-09-05): «El envío tarda entre 24 y 48 horas. ¿Me facilita
 * su número de teléfono?» sin tener la dirección, y «Sí, el lunes le llega».
 */
test("en RD el teléfono no se pide antes de la dirección, y un día de entrega no se promete", () => {
  const sinDireccion = { ...rd, ficha: { talla: "42", color: null, direccion: null, nombre: null, celular: null, cantidad: null }, ultimoDelCliente: "Cuando vendría llegando?" };
  assert.ok(revisarConReglas("El envío tarda entre 24 y 48 horas. ¿Me facilita su número de teléfono para el pedido?", sinDireccion).some((f) => f.includes("antes de la dirección")));
  assert.deepEqual(revisarConReglas("Entre 24 y 48 horas. Indíquenos su dirección.", sinDireccion), []);

  const conDireccion = { ...sinDireccion, ficha: { ...sinDireccion.ficha, direccion: "Las Matas de Farfán, junta central electoral" }, ultimoDelCliente: "Las Matas de Farfán, junta central electoral" };
  assert.deepEqual(revisarConReglas("Perfecto, hasta Las Matas de Farfán el envío le sale en RD$290.\n¿Me facilita su número de teléfono para el pedido?", conDireccion), []);

  assert.ok(revisarConReglas("Sí, el lunes le llega, entre 24 y 48 horas.", rd).some((f) => f.includes("día de entrega")));
  assert.ok(revisarConReglas("Le llega el lunes sin falta.", rd).some((f) => f.includes("día de entrega")));
  assert.deepEqual(revisarConReglas("Entre 24 y 48 horas.", rd), []);
});

/**
 * LA CAPTURA DE LA DUEÑA (2026-09-05): «¿Cuántas unidades desea?» de primer
 * mensaje a un combo. La cantidad no se pregunta nunca, en ningún país: se
 * asume una unidad salvo que el cliente diga otra.
 */
test("la cantidad no se pregunta en ningún país, salvo que el cliente hable de mayoreo sin un número", () => {
  for (const pais of [rd, cr, pa]) {
    const ctx = { ...pais, esApertura: false, ultimoDelCliente: "Me interesa" };
    assert.ok(revisarConReglas("¿Cuántas unidades desea?", ctx).some((f) => f.includes("pregunta la cantidad")), pais.datos.codigo);
    assert.ok(revisarConReglas("Perfecto. ¿Cuántos va a llevar?", ctx).some((f) => f.includes("pregunta la cantidad")), pais.datos.codigo);
    assert.ok(revisarConReglas("¿Qué cantidad necesita?", ctx).some((f) => f.includes("pregunta la cantidad")), pais.datos.codigo);
  }
  // Con mayoreo sin número, sí hay que saber cuántas para cotizar.
  const mayoreo = { ...rd, esApertura: false, ultimoDelCliente: "Quiero precio al por mayor" };
  assert.deepEqual(revisarConReglas("De 3 unidades en adelante le sale en RD$1,190 cada uno. ¿Cuántas unidades desea?", mayoreo).filter((f) => f.includes("cantidad")), []);
});

/**
 * EL TELÉFONO VA CON EL COSTO DE ENVÍO, Y EL COSTO NO SE SABE SIN LA DIRECCIÓN.
 *
 * Es regla fija de los dos guiones de la dueña, el dominicano y el tico:
 * «Nunca pides el teléfono sin haber dicho antes el costo de envío». En Costa
 * Rica pesa igual o más, porque el cantón no decide el precio del envío pero sí
 * decide cómo llega el paquete y cuándo se paga: pedir el teléfono antes es
 * quedarse sin poder decirle ninguna de las dos cosas.
 */
test("en Costa Rica el teléfono no se pide antes de la dirección", () => {
  const sinDireccion = {
    ...cr,
    ficha: { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null },
  };
  const fallas = revisarConReglas("¿Me facilita su número de teléfono para el pedido?", sinDireccion);
  assert.ok(fallas.some((f) => f.includes("pide el teléfono antes de la dirección")));

  // Con la dirección delante, el teléfono se pide junto al costo del envío.
  const conDireccion = {
    ...cr,
    ficha: { ...sinDireccion.ficha, direccion: "Alajuela, 200 metros norte de la iglesia" },
    lugarDelCliente: "Alajuela",
  };
  assert.deepEqual(
    revisarConReglas(
      "Perfecto, hasta Alajuela se lo llevamos a domicilio. El envío es ₡3.500 y paga al recibir.\n¿Me facilita su número de teléfono para el pedido?",
      conDireccion,
    ),
    [],
  );
});

/**
 * CON TODOS LOS DATOS SALE EL RESUMEN, NO UNA PREGUNTA MÁS.
 *
 * La dueña, 2026-09-08: «que no pregunte si se lo despachamos, que envíe su
 * resumen, transfiera a un representante y deje de responder». El cliente que
 * ya dio dirección, teléfono y nombre ya dijo que sí; el «¿se lo despacho hoy
 * mismo?» solo añadía un mensaje más en el que la venta se podía caer.
 */
test("con el pedido completo, pedir una confirmación de más no sale", () => {
  const completa = {
    ...cr,
    // El catálogo de este contexto vende mocasines, así que la talla es dato de cierre.
    ficha: {
      talla: "42",
      color: null,
      direccion: "Alajuela, 200 metros norte de la iglesia",
      nombre: "María Jiménez",
      celular: "88888888",
      cantidad: null,
    },
    lugarDelCliente: "Alajuela",
  };

  for (const borrador of [
    "Le confirmo: cepillo secador a nombre de María Jiménez. ¿Se lo despacho hoy mismo?",
    "Ya tengo sus datos. ¿Procedo con el pedido?",
    "¿Le confirmo el pedido entonces?",
  ]) {
    assert.ok(
      revisarConReglas(borrador, completa).some((f) => f.includes("confirmación de más")),
      `debería pararse: «${borrador}»`,
    );
  }

  // El resumen sí sale, con su marcador y su transferencia pegada.
  const resumen =
    "📋 RESUMEN DEL PEDIDO\nNombre: María Jiménez\nTelefono: 88888888\n" +
    "Direccion: Alajuela, 200 metros norte de la iglesia\nProducto: Cepillo secador\nCantidad: 1\n" +
    "Envio: ₡3.500\nTOTAL A PAGAR: ₡16.000\nForma de pago: contra entrega\n✅ PEDIDO REGISTRADO\n" +
    "Le conecto con un representante para finalizar. Aguarde un momento.\n[HANDOFF]";
  assert.ok(!revisarConReglas(resumen, completa).some((f) => f.includes("confirmación de más")));

  // Y mientras falte un dato, esta regla no es la que manda: lo que toca es
  // preguntar lo que falta, y de eso se ocupan las demás.
  for (const incompleta of [
    { ...completa, ficha: { ...completa.ficha, nombre: null } },
    { ...completa, ficha: { ...completa.ficha, celular: null } },
    { ...completa, ficha: { ...completa.ficha, talla: null } },
  ]) {
    assert.ok(!revisarConReglas("¿Se lo despacho hoy mismo?", incompleta).some((f) => f.includes("confirmación de más")));
  }
});
