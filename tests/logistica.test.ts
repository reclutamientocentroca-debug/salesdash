import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { agenteDePais, bloqueDelPais, lugarEscritoPorElCliente, zonaDelCliente } from "../src/agents";
import { armarSistema } from "../src/lib/agent";

/**
 * EL ENVÍO SE DICE EN CUANTO EL CLIENTE ESCRIBE SU ZONA.
 *
 * RD$250 en el Gran Santo Domingo, RD$290 al interior. El cliente casi nunca
 * manda el pin: escribe «Los Alcarrizos» o «soy de Santiago», y con eso el
 * agente tiene que saber cuál de las dos tarifas le toca sin preguntar la
 * provincia otra vez.
 */

const rd = agenteDePais("do")!;

test("la zona dominicana se reconoce por lo que escribe la gente", () => {
  // Ciudad: por sector, por municipio o por la provincia.
  for (const texto of [
    "Vivo en Los Alcarrizos, calle 3 casa 12",
    "Villa Mella, al lado del colmado",
    "Calle Duarte #45, Los Prados",
    "Santo Domingo Este, Alma Rosa II",
    "Distrito Nacional, Gazcue",
    "en la capital",
  ]) {
    const z = zonaDelCliente(rd, texto);
    assert.ok(z && z !== "resto" && z.costo === 250, `«${texto}» es ciudad: RD$250`);
  }

  // Interior: por ciudad o por provincia.
  for (const texto of ["soy de Santiago", "Puerto Plata, Sosúa", "La Vega, Jarabacoa", "Higüey", "Baní", "del interior"]) {
    assert.equal(zonaDelCliente(rd, texto), "resto", `«${texto}» es interior: RD$290`);
  }

  // Lo que no se reconoce no se adivina.
  assert.equal(zonaDelCliente(rd, "la 42 en negro"), null);
  assert.equal(zonaDelCliente(rd, ""), null);
});

test("se toma el mensaje más reciente del cliente que nombre una zona", () => {
  const hilo = [
    { emisor: "cliente", content: "hola, vi el anuncio" },
    { emisor: "ia", content: "Con gusto. ¿Qué talla?" },
    { emisor: "cliente", content: "la 42, soy de Santiago" },
    { emisor: "ia", content: "¿A qué dirección?" },
    { emisor: "cliente", content: "mejor mándelo a Los Alcarrizos, donde mi mamá" },
  ];
  assert.match(lugarEscritoPorElCliente(rd, hilo)!, /Alcarrizos/);
  assert.equal(lugarEscritoPorElCliente(rd, hilo.slice(0, 2)), null);
  // Lo que escribe la IA no cuenta como dirección del cliente.
  assert.equal(lugarEscritoPorElCliente(rd, [{ emisor: "ia", content: "¿Es en Santiago?" }]), null);
  assert.equal(lugarEscritoPorElCliente(null, hilo), null);
});

test("el bloque del país le dice al agente la tarifa de ESTE cliente", () => {
  const ciudad = bloqueDelPais(rd, "Los Alcarrizos, calle 3", "Tienda");
  assert.ok(ciudad.includes("A ESTE CLIENTE le corresponde RD$250"), "ciudad");
  assert.ok(ciudad.includes("Gran Santo Domingo"));

  const interior = bloqueDelPais(rd, "soy de Santiago", "Tienda");
  assert.ok(interior.includes("A ESTE CLIENTE le corresponde RD$290"), "interior");

  const nada = bloqueDelPais(rd, null, "Tienda");
  assert.equal(nada.includes("A ESTE CLIENTE"), false, "sin zona no se adivina");
  assert.ok(nada.includes("RD$250") && nada.includes("RD$290"), "pero las dos tarifas siempre están");

  const raro = bloqueDelPais(rd, "por la casa de mi tía", "Tienda");
  assert.ok(raro.includes("no se puede deducir la zona"), "y lo que no se reconoce se pregunta");
});

test("el prompt del agente lleva la tarifa del cliente cuando la escribió, y el resumen y la transferencia siempre", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "Rincon", color: "#12876a", nombre: "Dueña",
    email: `logistica-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalId = D.crearCanal(orgId, {
    nombre: "RD", phone: "18095550200", tokenCifrado: "x",
    webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  D.actualizarAgente(orgId, { pais: "do" }, canalId);
  const agente = D.obtenerAgente(orgId, canalId);

  const prompt = armarSistema("Tienda", agente, [], null, "Resumen:", { telefono: "18095551234", nombre: null }, null, false, "Villa Mella, calle 8");
  assert.ok(prompt.includes("A ESTE CLIENTE le corresponde RD$250"));

  // Lo que la dueña pidió, y que es de la base: vender como una persona, no
  // inventar precio, resumen al final y transferir.
  assert.ok(prompt.includes("CÓMO SUENA UNA PERSONA"));
  assert.ok(prompt.includes("No inventes precios"));
  assert.ok(prompt.includes("UN ARTÍCULO DEL QUE NO SABES NADA NO SE VENDE NI SE COTIZA, Y TAMPOCO SE TRANSFIERE"));
  assert.ok(prompt.includes("EL RESUMEN SE MANDA UNA VEZ, Y CUANDO YA NO FALTA NADA"));
  assert.ok(prompt.includes("En un momento será transferido a un representante que le continuará atendiendo."));
  assert.ok(prompt.includes("[HANDOFF]"));
  assert.ok(prompt.includes("Cuando el cliente indique su provincia o ubicación, identifica correctamente el costo de envío"));

  // El guion de la dueña, aplicado tal cual (src/agents/paises/rd-guion.ts):
  // saludo, producto con precio, variante, provincia con su envío, dirección,
  // nombre, verificación y resumen, con la transferencia pegada.
  const ritmo = prompt.slice(prompt.indexOf("ASÍ VENDES — EL GUION DE ESTE NÚMERO"));
  const pos = (s: string) => {
    const i = ritmo.indexOf(s);
    assert.ok(i >= 0, `falta en el guion: ${s}`);
    return i;
  };
  assert.ok(pos("PASO 1 — Saluda") < pos("PASO 2 — Presenta brevemente el producto"));
  assert.ok(pos("PASO 2 — Presenta brevemente el producto") < pos("PASO 3 — Identifica qué información necesita"));
  assert.ok(pos("PASO 3 — Identifica qué información necesita") < pos("PASO 4 — Solicita la provincia"));
  assert.ok(pos("PASO 4 — Solicita la provincia") < pos("PASO 5 — Solicita la información necesaria para la entrega"));
  assert.ok(pos("PASO 5 — Solicita la información necesaria para la entrega") < pos("PASO 6 — Solicita el nombre completo"));
  assert.ok(pos("PASO 6 — Solicita el nombre completo") < pos("PASO 8 — Genera el resumen del pedido"));
  assert.ok(ritmo.includes("LA DIRECCIÓN NUNCA ES LA PRIMERA PREGUNTA"));
  assert.ok(ritmo.includes("Nunca le preguntes nuevamente algo que ya te dijo"));
  assert.ok(ritmo.includes("Si el cliente pregunta algo, se lo contestas primero"));
  assert.ok(ritmo.includes("Santo Domingo (el Gran Santo Domingo): RD$250. Provincias: RD$290."));
  assert.ok(ritmo.includes("Nunca pidas el número de teléfono"), "el sistema ya lo tiene");
  assert.ok(ritmo.includes("Teléfono: <el número de este WhatsApp"));
  assert.ok(ritmo.includes("Su pedido ha sido confirmado exitosamente."));
  assert.ok(ritmo.includes("En un momento será transferido a un representante que le continuará atendiendo."));
  assert.ok(ritmo.includes("[HANDOFF]"));
  assert.ok(ritmo.includes("NO VUELVES A RESPONDER EN ESE CHAT"), "después del resumen, el chat es del asesor");
  assert.ok(ritmo.includes("Siempre asume una unidad"));
  assert.ok(ritmo.includes("Nunca uses S, M o L para calzado"));
  assert.ok(ritmo.includes("Transferir es el último recurso"));
  // Y el bloque del cliente ya no pide el celular en RD.
  assert.ok(prompt.includes("EL TELÉFONO NO SE PREGUNTA"));
  assert.equal(prompt.includes("PREGÚNTALE A QUÉ NÚMERO LLAMA EL MENSAJERO"), false);

  // El precio del artículo del anuncio es el de la descripción del anuncio.
  const conAnuncio = armarSistema("Tienda", agente, [], {
    origen: "anuncio",
    producto_anuncio: "Mocasines de cuero",
    descripcion_anuncio: "Mocasines de cuero genuino a RD$2,500",
  }, "Resumen:", null, null, false, null);
  assert.ok(conAnuncio.includes("CLIENTE QUE LLEGA DESDE UN ANUNCIO"));
  assert.ok(conAnuncio.includes("El precio debe buscarse en este orden"));
  assert.ok(conAnuncio.includes("Si el precio no aparece en ninguno de esos lugares, no inventes"));
  assert.ok(conAnuncio.includes("SI QUIERE MÁS DE UNA UNIDAD, SE LAS VENDES"));
});

/**
 * EL CASO REAL: el cliente escribió «Independencia» —una provincia del sur— y
 * el agente no supo el envío, así que en vez de cerrar la venta se atascó. Una
 * provincia o un municipio escritos a secas se reconocen, aunque en la lista
 * vayan como «Independencia (Jimaní, Duvergé)».
 */
test("una provincia escrita a secas se sitúa por el mapa y se tarifa como interior", () => {
  assert.equal(zonaDelCliente(rd, "Independencia"), "resto", "Independencia es interior: RD$290");
  assert.equal(zonaDelCliente(rd, "Jimaní"), "resto");
  assert.equal(zonaDelCliente(rd, "soy de Duvergé"), "resto");
  assert.equal(zonaDelCliente(rd, "Calle independencia #3, Boca de cachón"), "resto");
  // Un sector del mapa de la capital va con la tarifa de la ciudad.
  const ciudad = zonaDelCliente(rd, "vivo en Villa Duarte");
  assert.ok(ciudad !== null && ciudad !== "resto", "Villa Duarte es Santo Domingo Este: RD$250");
  assert.equal(zonaDelCliente(rd, "la 42 en negro"), null, "lo que no es un lugar sigue sin ser un lugar");

  // Y en Costa Rica, un cantón que va entre paréntesis en la lista.
  const cr = agenteDePais("cr")!;
  assert.equal(zonaDelCliente(cr, "Liberia"), "resto");
  assert.equal(zonaDelCliente(cr, "Nicoya"), "resto");

  // Con eso, el bloque del país le dice al agente la tarifa de este cliente.
  const bloque = bloqueDelPais(rd, "Independencia", "RINCON DCM");
  assert.ok(bloque.includes("A ESTE CLIENTE"), "el agente recibe la tarifa que le toca");
  assert.ok(bloque.includes("290"), "y es la del interior");
});

/**
 * COSTA RICA, según la dueña (2026-09-04): San José, Heredia, Alajuela y
 * Alajuelita van a domicilio y se paga al recibir, como el cliente prefiera:
 * efectivo, transferencia o SINPE Móvil. Fuera de esa zona, por correo y pago
 * previo.
 */
test("en Costa Rica San José, Heredia, Alajuela y Alajuelita van a domicilio y se paga como el cliente quiera", () => {
  const cr = agenteDePais("cr")!;
  for (const lugar of ["San José", "san jose", "Chepe", "Heredia", "Alajuela", "Alajuelita", "Pavas", "Desamparados"]) {
    const z = zonaDelCliente(cr, lugar);
    assert.ok(z !== null && z !== "resto" && z.modalidad === "entrega a domicilio", `«${lugar}» va a domicilio`);
  }
  assert.equal(zonaDelCliente(cr, "Liberia"), "resto", "Guanacaste va por correo");

  const domicilio = cr.envio.zonas[0]!;
  assert.match(domicilio.pago!, /efectivo/);
  assert.match(domicilio.pago!, /SINPE/);
  assert.match(domicilio.pago!, /paga al recibir/);
  assert.match(cr.pago!, /COMO EL CLIENTE PREFIERA/);
  assert.match(cr.pagoAlCliente!, /efectivo, por transferencia o por SINPE/);

  // Y el agente lo lee así en su bloque de país.
  const bloque = bloqueDelPais(cr, "Heredia", "TELLERIA");
  assert.ok(bloque.includes("entrega a domicilio"));
  assert.ok(bloque.includes("efectivo"), "el efectivo es una de las tres formas");
});

/**
 * PANAMÁ, según la dueña (2026-09-04): sin impuesto —el total es el producto
 * más el envío—, a domicilio en todo el país, y se paga por transferencia,
 * Yappy, efectivo o link de pago, como el cliente prefiera.
 */
test("en Panamá no hay impuesto, el envío es a domicilio en todo el país y se paga como el cliente quiera", () => {
  const pa = agenteDePais("pa")!;
  assert.equal(pa.envio.restoDelPais.costo, 5);
  assert.match(pa.envio.restoDelPais.modalidad, /domicilio/);
  assert.match(pa.envio.cobertura, /SIN IMPUESTO/);
  for (const forma of ["transferencia", "Yappy", "efectivo", "link de pago"]) {
    assert.ok(pa.pago!.includes(forma), `el pago admite ${forma}`);
    assert.ok(pa.pagoAlCliente!.includes(forma), `y al cliente se le dice ${forma}`);
  }
  assert.match(pa.pago!, /NO SE LOS INVENTES/, "los datos de la cuenta los da el representante");

  const bloque = bloqueDelPais(pa, "Villa Lucre", "Tienda");
  assert.ok(bloque.includes("FORMA DE PAGO: COMO EL CLIENTE PREFIERA"));
  assert.ok(!bloque.includes("NO CONFIGURADA"), "ya no está pendiente");
  assert.ok(bloque.includes("US$5.00"));
});
