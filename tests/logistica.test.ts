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

  const prompt = armarSistema("Tienda", agente, [], null, "Resumen:", null, null, false, "Villa Mella, calle 8");
  assert.ok(prompt.includes("A ESTE CLIENTE le corresponde RD$250"));

  // Lo que la dueña pidió, y que es de la base: vender como una persona, no
  // inventar precio, resumen al final y transferir.
  assert.ok(prompt.includes("CÓMO SUENA UNA PERSONA"));
  assert.ok(prompt.includes("No inventes precios"));
  assert.ok(prompt.includes("UN ARTÍCULO DEL QUE NO SABES NADA SE PASA A UN REPRESENTANTE"));
  assert.ok(prompt.includes("EL RESUMEN SE MANDA UNA VEZ, Y CUANDO YA NO FALTA NADA"));
  assert.ok(prompt.includes("Conectando con representante..."));
  assert.ok(prompt.includes("[HANDOFF]"));
  assert.ok(prompt.includes("APENAS el cliente te diga su zona o su provincia"));

  // El orden que pidió la dueña, por pasos: saludo, talla y color, a dónde
  // (con el envío confirmado), teléfono, nombre, confirmación, resumen y pase
  // al asesor humano. Es el guion propio de RD (src/agents/paises/rd-guion.ts).
  const ritmo = prompt.slice(prompt.indexOf("ASÍ VENDES — EL GUION DE ESTE NÚMERO"));
  const pos = (s: string) => {
    const i = ritmo.indexOf(s);
    assert.ok(i >= 0, `falta en el guion: ${s}`);
    return i;
  };
  assert.ok(pos("PASO 1 — EL SALUDO") < pos("PASO 2 — LA TALLA Y EL COLOR"));
  assert.ok(pos("PASO 2 — LA TALLA Y EL COLOR") < pos("PASO 3 — A DÓNDE SE LO ENVIAMOS"));
  assert.ok(pos("PASO 3 — A DÓNDE SE LO ENVIAMOS") < pos("PASO 4 — EL NÚMERO DE TELÉFONO"));
  assert.ok(pos("PASO 4 — EL NÚMERO DE TELÉFONO") < pos("PASO 5 — EL NOMBRE"));
  assert.ok(pos("PASO 5 — EL NOMBRE") < pos("PASO 6 — LA CONFIRMACIÓN"));
  assert.ok(pos("PASO 6 — LA CONFIRMACIÓN") < pos("PASO 7 — EL RESUMEN DEL PEDIDO Y EL PASE AL ASESOR HUMANO"));
  assert.ok(ritmo.includes("Primero lo suyo y después lo tuyo"), "contesta lo que el cliente pregunta y luego sigue");
  assert.ok(ritmo.includes("No se lo vuelvas a preguntar"));
  assert.ok(ritmo.includes("LA DIRECCIÓN NUNCA ES LA PRIMERA PREGUNTA"));
  assert.ok(ritmo.includes("NUNCA antes de la talla y el color"));
  assert.ok(ritmo.includes("LOS COLORES SON LOS QUE MUESTRA LA FOTO DEL ANUNCIO"));
  assert.ok(ritmo.includes("Gran Santo Domingo, la ciudad, RD$250; el resto del país, las provincias, RD$290"));
  assert.ok(ritmo.includes("NO VUELVES A RESPONDER EN ESE CHAT"), "después del resumen, el chat es del asesor");
  assert.ok(ritmo.includes("si quiere más de una se las vendes"));

  // El precio del artículo del anuncio es el de la descripción del anuncio.
  const conAnuncio = armarSistema("Tienda", agente, [], {
    origen: "anuncio",
    producto_anuncio: "Mocasines de cuero",
    descripcion_anuncio: "Mocasines de cuero genuino a RD$2,500",
  }, "Resumen:", null, null, false, null);
  assert.ok(conAnuncio.includes("EL PRECIO DEL ARTÍCULO DEL ANUNCIO ES EL DE LA DESCRIPCIÓN DEL ANUNCIO"));
  assert.ok(conAnuncio.includes("NO LO INVENTES: dile que un representante le pasa el precio"));
  assert.ok(conAnuncio.includes("SI QUIERE MÁS DE UNA UNIDAD, SE LAS VENDES"));
});
