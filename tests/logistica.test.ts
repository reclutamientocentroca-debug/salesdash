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
  assert.ok(prompt.includes("TU TRABAJO ES VENDER, NO TRANSFERIR"));
  assert.ok(prompt.includes("El resumen va UNA SOLA VEZ"));
  assert.ok(prompt.includes("Permítame un momento, le transfiero con un representante."));
  assert.ok(prompt.includes("[HANDOFF]"));
  assert.ok(prompt.includes("identificas la zona, le informas el costo de envío"));

  // El guion de la dueña (2026-09-05), aplicado tal cual (src/agents/paises/rd-guion.ts):
  // primer mensaje con producto y precio, talla, color, dirección, envío y
  // teléfono en el mismo mensaje, nombre, confirmación y resumen con la
  // transferencia pegada.
  const ritmo = prompt.slice(prompt.indexOf("ASÍ VENDES — EL GUION DE ESTE NÚMERO"));
  const pos = (s: string) => {
    const i = ritmo.indexOf(s);
    assert.ok(i >= 0, `falta en el guion: ${s}`);
    return i;
  };
  assert.ok(pos("1. Primer mensaje") < pos("2. Talla"));
  assert.ok(pos("2. Talla") < pos("3. Color"));
  assert.ok(pos("3. Color") < pos("4. Dirección"));
  assert.ok(pos("4. Dirección") < pos("5. Costo de envío + teléfono"));
  assert.ok(pos("5. Costo de envío + teléfono") < pos("6. Nombre real"));
  /*
   * Y DEL NOMBRE SE PASA AL RESUMEN, sin un paso de confirmación en medio (la
   * dueña, 2026-09-08): el cliente que ya dio dirección, teléfono y nombre no
   * tiene que decir «sí» otra vez, y cada «¿se lo despacho hoy mismo?» era una
   * venta esperando una respuesta que muchas veces no llegaba.
   */
  assert.ok(pos("6. Nombre real") < pos("7. Resumen final"));
  assert.ok(ritmo.includes("Indique su dirección exacta de entrega."));
  assert.ok(ritmo.includes("Perfecto, hasta <zona> el envío le sale en RD$<250 o 290>."), "el envío y el teléfono en el mismo mensaje");
  assert.ok(ritmo.includes("¿Me facilita su número de teléfono para el pedido?"));
  assert.ok(ritmo.includes("Nunca tomas el nombre de ninguna fuente que no sea la boca del cliente"));
  assert.ok(ritmo.includes("San Antonio de Guerra): RD$250"), "las zonas de la ciudad, con sus nombres");
  assert.ok(ritmo.includes("EL PEDIDO NO SE CONFIRMA DOS VECES"), "el resumen no espera un «sí» de más");
  assert.ok(ritmo.includes("✅ PEDIDO REGISTRADO"), "el resumen cierra como lo escribió la dueña");
  assert.ok(ritmo.includes("Permítame un momento, le transfiero con un representante."));
  assert.ok(ritmo.includes("[HANDOFF]"));
  assert.ok(ritmo.includes("NO VUELVES A RESPONDER EN ESE CHAT"), "después del resumen, el chat es del asesor");
  assert.ok(ritmo.includes("NO SE RESERVAN PEDIDOS"));
  assert.ok(ritmo.includes("De 3 unidades en adelante"), "el precio por mayor, si la descripción lo trae");
  assert.ok(ritmo.includes("Cepillos, blowers, planchas y abejones: sin talla ni color"));
  assert.ok(ritmo.includes("Entre 24 y 48 horas."), "y a cuánto tarda se contesta");

  // Y el bloque del cliente pide el celular también en RD.
  assert.ok(prompt.includes("PREGÚNTALE A QUÉ NÚMERO LLAMA EL MENSAJERO"));
  assert.equal(prompt.includes("EL TELÉFONO NO SE PREGUNTA"), false);

  // El precio del artículo del anuncio es el de la descripción del anuncio.
  const conAnuncio = armarSistema("Tienda", agente, [], {
    origen: "anuncio",
    producto_anuncio: "Mocasines de cuero",
    descripcion_anuncio: "Mocasines de cuero genuino a RD$2,500",
  }, "Resumen:", null, null, false, null);
  assert.ok(conAnuncio.includes("EL CLIENTE LLEGA DESDE UN ANUNCIO"));
  assert.ok(conAnuncio.includes("El precio que te llega en la descripción del producto es el precio principal"));
  assert.ok(conAnuncio.includes("Nunca lo inventas ni lo cambias"));
  assert.ok(conAnuncio.includes("De 3 unidades en adelante"), "el precio por mayor, si la descripción lo trae");
});

/**
 * EL CEPILLO SECADOR NO LLEVA COLOR NI TALLA (la dueña, 2026-09-07).
 *
 * El guion venía escrito con la talla en el primer mensaje, en el paso 2, en
 * la tabla de tallas y en el ejemplo del mayoreo, y al lado un «sáltala si el
 * producto no la lleva». Lo que está escrito cuatro veces se acaba
 * preguntando: la dueña vio «¿Qué talla le interesa?» debajo del precio de un
 * combo de cepillo y plancha. Cuando el anuncio ya dice qué se vende, el paso
 * no se omite: no se escribe, y la numeración se cierra sobre él.
 */
test("con un cepillo secador el guion dominicano sale sin talla y sin color", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "RINCON DCM", color: "#12876a", nombre: "Dueña",
    email: `cepillo-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalId = D.crearCanal(orgId, {
    nombre: "RD", phone: "18095550300", tokenCifrado: "x",
    webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  D.actualizarAgente(orgId, { pais: "do" }, canalId);
  const agente = D.obtenerAgente(orgId, canalId);
  const delCombo = {
    origen: "anuncio",
    producto_anuncio: "Rincondcm",
    descripcion_anuncio: "🔥 COMBO 2 EN 1 — SOLO RD$1,690 ✨ Cepillo secador + plancha alisadora. Seca rápido.",
  };

  const combo = armarSistema("RINCON DCM", agente, [], delCombo, "Resumen:", null, null, false, null);
  // Ni una sola pregunta de talla o color escrita para copiar. Lo único que se
  // nombra son las líneas que las prohíben, y esas van en minúscula.
  for (const pregunta of ["¿Qué talla le interesa?", "¿Qué talla usa?", "¿Qué talla necesita?", "¿Qué color le interesa?"]) {
    assert.equal(combo.includes(pregunta), false, `«${pregunta}» no puede estar escrita en el guion de un cepillo`);
  }
  assert.ok(combo.includes("CLASIFICACIÓN DEL PRODUCTO, YA HECHA"), "la clasificación va hecha, no la rehace el modelo");
  assert.ok(combo.includes("NO LLEVA TALLA"));
  assert.ok(combo.includes("NO LLEVA COLOR"));
  assert.ok(combo.includes("Con este artículo vas de precio → dirección."));

  // El primer mensaje cierra con la dirección, y los pasos se renumeran.
  const flujo = combo.slice(combo.indexOf("1. Primer mensaje"));
  const pasos = [...flujo.matchAll(/^\d\. [^\n]+/gm)].map((m) => m[0]);
  assert.equal(pasos.some((p) => /Talla|Color/i.test(p)), false, `los pasos de talla y color no existen: ${pasos.join(" | ")}`);
  assert.deepEqual(
    pasos.slice(0, 5).map((p) => p.slice(0, p.indexOf(" ") + 1) + p.slice(p.indexOf(" ") + 1).split(/[ (,]/)[0]),
    ["1. Primer", "2. Dirección", "3. Costo", "4. Nombre", "5. Resumen"],
    "sin talla ni color la numeración se cierra: no queda un número saltado",
  );

  // Ni el resumen las lleva, ni la tabla de tallas se le pone delante.
  assert.equal(combo.includes("Talla: <talla>"), false, "el resumen no trae la línea de talla");
  assert.equal(combo.includes("Color: <color>"), false);
  assert.equal(combo.includes("Zapato: 39 a 45"), false, "una tabla de tallas delante es una invitación a preguntarla");
  assert.ok(combo.includes("se vende fijo, sin talla y sin color"));

  // Y con ropa, el guion sigue siendo el de siempre: talla, color y su tabla.
  const zapatos = armarSistema("RINCON DCM", agente, [], {
    origen: "anuncio",
    producto_anuncio: "Zapatos DCM",
    descripcion_anuncio: "Zapatos de cuero a RD$2,500, disponibles en negro y marrón.",
  }, "Resumen:", null, null, false, null);
  assert.ok(zapatos.includes("2. Talla"));
  assert.ok(zapatos.includes("3. Color"));
  assert.ok(zapatos.includes("Zapato: 39 a 45"));
  assert.ok(zapatos.includes("Talla: <talla>"), "y el resumen sí lleva su línea");
});

/**
 * DOS COLORES SON DOS UNIDADES (la dueña, RD, 2026-09-07).
 *
 * La captura: «Talla: Rojo y azul XL», «Cantidad: 1» y el total con el precio
 * de un solo polo. Quien contesta «rojo y azul» está pidiendo dos, y el precio
 * se suma dos veces. De tres en adelante entra el por mayor —el que traiga la
 * descripción—, y el por mayor NO se ofrece: solo aparece si el cliente pide
 * tres o más.
 */
test("en República Dominicana dos colores son dos unidades, y el por mayor no se ofrece", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "RINCON DCM", color: "#12876a", nombre: "Dueña",
    email: `colores-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalId = D.crearCanal(orgId, {
    nombre: "RD", phone: "18095550400", tokenCifrado: "x",
    webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  D.actualizarAgente(orgId, { pais: "do" }, canalId);
  const agente = D.obtenerAgente(orgId, canalId);
  const prompt = armarSistema("RINCON DCM", agente, [], {
    origen: "anuncio",
    producto_anuncio: "Polos Bronx",
    descripcion_anuncio: "POLOS BRONX ORIGINALES a RD$1,400. Colores: rojo, azul, negro. Por docena RD$1,100 cada uno.",
  }, "Resumen:", null, null, false, null);

  assert.ok(prompt.includes("DOS COLORES SON DOS UNIDADES, Y EL PRECIO SE SUMA"));
  assert.ok(prompt.includes("la cantidad es 2, y el precio de uno SE SUMA DOS VECES"));
  assert.ok(prompt.includes("El envío es uno solo: no se duplica."));
  assert.ok(prompt.includes("son DOS unidades. Le anotas los dos"), "en el paso del color, donde el cliente los dice");

  // El por mayor: de 3 en adelante, con el precio de la descripción, y nunca ofrecido.
  assert.ok(prompt.includes("EL POR MAYOR NO SE OFRECE NUNCA"));
  assert.ok(prompt.includes("por docena le sale mejor"), "ni siquiera se le insinúa");
  assert.ok(prompt.includes("De 3 unidades en adelante"));
  assert.ok(prompt.includes("el precio por mayor o por docena que traiga la descripción del producto"));
  assert.ok(prompt.includes("Por llevar dos no hay rebaja"), "dos no es mayoreo: es el precio de uno, dos veces");
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

/**
 * LA DUEÑA (2026-09-07): «la IA de Panamá, artículo no lleva talla ni color,
 * solo vende el artículo como los demás». Lo mismo que leen RD y CR.
 */
test("en Panamá un artículo sin talla ni color se vende tal cual, sin preguntar nada", () => {
  const pa = agenteDePais("pa")!;
  assert.ok(pa.tallas.sinTallaNiColor.includes("Planchas"));
  assert.ok(pa.tallas.sinTallaNiColor.includes("Mochilas"));
  assert.equal(pa.tallas.soloRopaYCalzado, true);
  const bloque = bloqueDelPais(pa, null, "Tienda");
  assert.ok(bloque.includes("NO llevan talla ni color, y no se preguntan: Cepillos, Blowers, Secadores, Planchas"));
  assert.ok(bloque.includes("Solo la ropa y el calzado llevan talla"));
});

/** Lo que el agente dominicano lee: los productos fijos, con sus nombres, no llevan talla ni color. */
test("el guion dominicano nombra los productos fijos y les prohíbe la talla y el color", () => {
  const rdDatos = agenteDePais("do")!;
  assert.ok(rdDatos.tallas.sinTallaNiColor.includes("Blowers"));
  assert.ok(rdDatos.tallas.sinTallaNiColor.includes("Planchas"));
  const bloque = bloqueDelPais(rdDatos, null, "RINCON DCM");
  assert.ok(bloque.includes("NO llevan talla ni color, y no se preguntan: Cepillos, Blowers, Secadores, Planchas"));
});
