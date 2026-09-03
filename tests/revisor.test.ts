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
  assert.deepEqual(revisarConReglas("Diay, el envío son ₡3.500 a todo el país.\n\n¿A qué cantón te lo mando?", cr), []);
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
  // En Costa Rica se tutea: ahí no es falla.
  assert.deepEqual(revisarConReglas("¿Quieres que te lo mande hoy mismo?", cr), []);
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
