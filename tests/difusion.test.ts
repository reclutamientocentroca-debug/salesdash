import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { ingerir, type MensajeEntrante } from "../src/lib/ingesta";
import { detectarOptOut } from "../src/lib/opt-out";
import { calcularReparto } from "../src/lib/difusion-calculo";
import { difusionParaModelo, llegoPorDifusion } from "../src/lib/difusion-contexto";
import { parsearCsv } from "../src/lib/difusion-csv";

// ─────────────────────────────────────────────────────────────────────────────
// «SALIR»
// ─────────────────────────────────────────────────────────────────────────────

test("«SALIR» a secas, o con una despedida corta, se detecta", () => {
  assert.equal(detectarOptOut("Salir"), true);
  assert.equal(detectarOptOut("salir"), true);
  assert.equal(detectarOptOut("SALIR"), true);
  assert.equal(detectarOptOut("stop"), true);
  assert.equal(detectarOptOut("No más gracias"), true);
  assert.equal(detectarOptOut("Ya no me escriban más"), true);
});

test("una frase larga que solo MENCIONA «salir» o «no más» no cuenta: no es un opt-out por accidente", () => {
  assert.equal(detectarOptOut("Ya no quiero nada más, gracias, con la camisa basta"), false);
  assert.equal(detectarOptOut("¿A qué hora sale el mensajero?"), false);
  assert.equal(detectarOptOut("Hola, quiero saber el precio"), false);
  assert.equal(detectarOptOut(""), false);
  assert.equal(detectarOptOut(null), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// El reparto
// ─────────────────────────────────────────────────────────────────────────────

test("el reparto cuenta solo los días de la semana elegidos", () => {
  // 50 clientes, 10 al día, todos los días de la semana: 5 días.
  const todos = calcularReparto(50, 10, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(todos.diasNecesarios, 5);

  // 20 clientes, 10 al día, un solo día de la semana permitido: como mínimo 2 semanas hábiles.
  const unSoloDia = calcularReparto(20, 10, [1]);
  assert.ok(unSoloDia.diasNecesarios >= 8, "con un solo día permitido por semana, hacen falta más de 7 días");
});

test("sin nadie pendiente, el reparto no pide ningún día", () => {
  assert.equal(calcularReparto(0, 10, [1, 2, 3]).diasNecesarios, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// El contexto para el modelo
// ─────────────────────────────────────────────────────────────────────────────

test("sin campaña, no hay contexto de difusión que darle al modelo", () => {
  assert.equal(llegoPorDifusion({ campana_id: null, producto_difusion: null, precio_difusion: null }), false);
  assert.equal(difusionParaModelo({ campana_id: null, producto_difusion: null, precio_difusion: null }), null);
});

test("con campaña, el precio que se le da al modelo es EXACTAMENTE el guardado, no se inventa", () => {
  const texto = difusionParaModelo(
    { campana_id: 9, producto_difusion: "Combo 2 en 1", precio_difusion: 1690 },
    "RD$",
  );
  assert.match(texto!, /Combo 2 en 1/);
  assert.match(texto!, /RD\$1690/);
  assert.match(texto!, /no lo inventes|no lo cambies/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// El CSV de clientes
// ─────────────────────────────────────────────────────────────────────────────

test("el CSV se lee con o sin cabecera, en cualquier orden de columnas", () => {
  const conCabecera = parsearCsv("nombre,telefono\nJuan Pérez,18095551234\nMaría,8095555678");
  assert.deepEqual(conCabecera, [
    { telefono: "18095551234", nombre: "Juan Pérez" },
    { telefono: "8095555678", nombre: "María" },
  ]);

  // El teléfono primero, sin cabecera, con punto y coma.
  const sinCabecera = parsearCsv("18095551234;Juan Pérez\n8095555678;María");
  assert.deepEqual(sinCabecera, [
    { telefono: "18095551234", nombre: "Juan Pérez" },
    { telefono: "8095555678", nombre: "María" },
  ]);
});

test("una fila sin nada que parezca teléfono se descarta, no se inventa nada", () => {
  const clientes = parsearCsv("nombre,telefono\nSin Teléfono,\nCon Teléfono,18095551234");
  assert.equal(clientes.length, 1);
  assert.equal(clientes[0]!.telefono, "18095551234");
});

// ─────────────────────────────────────────────────────────────────────────────
// Listas: nombre real, nunca el del perfil de WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

test("una lista automática saca el nombre del resumen del pedido, nunca del perfil de WhatsApp", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "PruebaDifusion", color: "#123456", nombre: "Dueña",
    email: `difusion-nombre-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalId = D.crearCanal(orgId, {
    nombre: "RD", phone: "18095551000", tokenCifrado: "x", webhookSecret: "x", whapiChannelId: null,
  });

  // Compró: tiene un resumen de pedido con su nombre real dentro.
  const conCompra = D.getOrCreateConversation(orgId, canalId, "18095552001", {
    nombre: "PerfilDeWhatsAppQueNoEsSuNombre",
  }).conversacion;
  D.actualizarConversacion(orgId, conCompra.id, {
    resumen_pedido: "Resumen:\nNombre: Maria Perez\nDireccion: Calle 1\nProducto: Camisa\nTOTAL A PAGAR: RD$1500",
  });
  D.reescribirCierre(orgId, conCompra.id, {
    cerradoPor: "ia", senal: "resumen_ia", fechaCierre: D.ahora(), facturadaAt: null,
  });

  // Escribió, pero nunca compró: no hay resumen de pedido con su nombre.
  D.getOrCreateConversation(orgId, canalId, "18095552002", {
    nombre: "OtroPerfilDeWhatsApp",
  });

  const lista = D.resolverListaAutomatica(orgId, { canalId });
  assert.equal(lista.length, 2);

  const sinCompra = lista.find((l) => l.telefono === "18095552002");
  assert.equal(sinCompra?.nombre, null, "sin resumen de pedido, no hay nombre real: no se usa el del perfil");
});

// ─────────────────────────────────────────────────────────────────────────────
// Congelar destinatarios: dedupe, excluidos, sin duplicar entre campañas
// ─────────────────────────────────────────────────────────────────────────────

function crearCuentaConCanal(sufijo: string) {
  const { orgId } = D.crearOrgConDueno({
    negocio: "PruebaDifusion", color: "#123456", nombre: "Dueña",
    email: `difusion-${sufijo}-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalId = D.crearCanal(orgId, {
    nombre: "RD", phone: "18095559000", tokenCifrado: "x", webhookSecret: "x", whapiChannelId: null,
  });
  return { orgId, canalId };
}

test("congelar destinatarios descarta a quien ya dijo «SALIR» y no duplica por teléfono repetido", () => {
  const { orgId, canalId } = crearCuentaConCanal("congelar");
  D.registrarExclusion(orgId, "18095551111", "salir");

  const listaId = D.crearListaDifusion(orgId, { nombre: "Lista CSV", tipo: "csv" });
  const campanaId = D.crearCampanaDifusion(orgId, {
    canalId, listaId, nombre: "Campaña", modo: "qr", mensajeBase: "Hola",
    mensajesPorDia: 10, diasSemana: [1, 2, 3, 4, 5], horaDesde: "09:00", horaHasta: "18:00",
  });

  const n = D.congelarDestinatarios(orgId, campanaId, canalId, [
    { telefono: "18095551111", nombre: "Excluido" }, // pidió salir: fuera
    { telefono: "18095552222", nombre: "Juan" },
    { telefono: "+1 (809) 555-2222", nombre: "Juan otra vez, mismo número con formato distinto" },
  ]);

  assert.equal(n, 1, "el excluido no entra, y el número repetido con otro formato no duplica");
});

test("una campaña no manda dos veces al mismo cliente, aunque se congele otra vez", () => {
  const { orgId, canalId } = crearCuentaConCanal("no-duplica");
  const lista = D.crearListaDifusion(orgId, { nombre: "Lista", tipo: "csv" });
  const campanaId = D.crearCampanaDifusion(orgId, {
    canalId, listaId: lista, nombre: "Campaña", modo: "qr", mensajeBase: "Hola",
    mensajesPorDia: 10, diasSemana: [1, 2, 3, 4, 5], horaDesde: "09:00", horaHasta: "18:00",
  });

  const primera = D.congelarDestinatarios(orgId, campanaId, canalId, [{ telefono: "18095553333", nombre: "Ana" }]);
  const segunda = D.congelarDestinatarios(orgId, campanaId, canalId, [{ telefono: "18095553333", nombre: "Ana" }]);

  assert.equal(primera, 1);
  assert.equal(segunda, 0, "congelar dos veces la misma campaña no duplica al mismo destinatario");
});

// ─────────────────────────────────────────────────────────────────────────────
// El enganche con la venta: de qué campaña vino, sin inventar precio
// ─────────────────────────────────────────────────────────────────────────────

test("cuando el cliente responde por primera vez a una difusión, la conversación nace con su producto y su precio", () => {
  const { orgId, canalId } = crearCuentaConCanal("enganche");
  const canal = D.obtenerCanal(orgId, canalId)!;

  const lista = D.crearListaDifusion(orgId, { nombre: "Lista", tipo: "csv" });
  const campanaId = D.crearCampanaDifusion(orgId, {
    canalId, listaId: lista, nombre: "Combo", modo: "qr", mensajeBase: "Hola {nombre}, el {producto} está disponible.",
    productoNombre: "Combo 2 en 1", productoPrecio: 1690,
    mensajesPorDia: 10, diasSemana: [1, 2, 3, 4, 5], horaDesde: "09:00", horaHasta: "18:00",
  });
  D.congelarDestinatarios(orgId, campanaId, canalId, [{ telefono: "18095554444", nombre: null }]);

  const [destinatario] = D.pendientesDeCampana(orgId, campanaId, 1);
  D.marcarEnvio(orgId, destinatario!.id, {
    ok: true, whapiMessageId: "wa-msg-difusion-1", variacionUsada: null,
    mensajeEnviado: "Hola, el Combo 2 en 1 está disponible.\n\nResponda SALIR si no desea recibir más mensajes.",
  });

  const mensajes: MensajeEntrante[] = [
    {
      id: "wa-msg-respuesta-1", deMi: false, chatId: "18095554444@s.whatsapp.net", tipo: "texto",
      content: "Hola, sí me interesa", mediaUrl: null, cuando: D.ahora(), nombre: "PerfilDeWhatsApp",
      deAnuncio: false, productoAnuncio: null, descripcionAnuncio: null,
    },
  ];

  return ingerir(canal, mensajes, { dentroDePeticion: false }).then(() => {
    const conv = D.getOrCreateConversation(orgId, canalId, "18095554444").conversacion;
    assert.equal(conv.origen, "difusion");
    assert.equal(conv.campana_id, campanaId);
    assert.equal(conv.producto_difusion, "Combo 2 en 1");
    assert.equal(conv.precio_difusion, 1690);

    // El primer mensaje de la difusión quedó sembrado en el hilo, retroactivo.
    const hilo = D.listarMensajes(orgId, conv.id);
    assert.equal(hilo.length, 2, "el mensaje de la difusión y la respuesta del cliente, los dos en el hilo");
    assert.equal(hilo[0]!.whapi_message_id, "wa-msg-difusion-1");
    assert.equal(hilo[0]!.emisor, "ia");
    assert.match(hilo[0]!.content, /Combo 2 en 1/);
    assert.equal(hilo[1]!.emisor, "cliente");
  });
});

test("un cliente que ya tenía conversación de antes no se le adjudica una campaña nueva de rebote", () => {
  const { orgId, canalId } = crearCuentaConCanal("no-retroactivo");
  const canal = D.obtenerCanal(orgId, canalId)!;

  // Ya escribió antes de que existiera ninguna campaña.
  D.getOrCreateConversation(orgId, canalId, "18095555555", { nombre: null });

  const lista = D.crearListaDifusion(orgId, { nombre: "Lista", tipo: "csv" });
  const campanaId = D.crearCampanaDifusion(orgId, {
    canalId, listaId: lista, nombre: "Campaña", modo: "qr", mensajeBase: "Hola",
    productoNombre: "Algo", productoPrecio: 100,
    mensajesPorDia: 10, diasSemana: [1, 2, 3, 4, 5], horaDesde: "09:00", horaHasta: "18:00",
  });
  D.congelarDestinatarios(orgId, campanaId, canalId, [{ telefono: "18095555555", nombre: null }]);
  const [destinatario] = D.pendientesDeCampana(orgId, campanaId, 1);
  D.marcarEnvio(orgId, destinatario!.id, {
    ok: true, whapiMessageId: "wa-msg-2", variacionUsada: null, mensajeEnviado: "Hola",
  });

  return ingerir(
    canal,
    [{
      id: "wa-msg-resp-2", deMi: false, chatId: "18095555555@s.whatsapp.net", tipo: "texto",
      content: "Ok", mediaUrl: null, cuando: D.ahora(), nombre: null,
      deAnuncio: false, productoAnuncio: null, descripcionAnuncio: null,
    }],
    { dentroDePeticion: false },
  ).then(() => {
    const conv = D.getOrCreateConversation(orgId, canalId, "18095555555").conversacion;
    assert.equal(conv.campana_id, null, "el hilo ya existía: no se le inventa de dónde vino");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// «SALIR» dentro de una conversación real, vía ingerir()
// ─────────────────────────────────────────────────────────────────────────────

test("«SALIR» dentro de la ingesta excluye al cliente de futuras campañas, tenga o no conversación", () => {
  const { orgId, canalId } = crearCuentaConCanal("salir-ingesta");
  const canal = D.obtenerCanal(orgId, canalId)!;

  return ingerir(
    canal,
    [{
      id: "wa-msg-salir-1", deMi: false, chatId: "18095556666@s.whatsapp.net", tipo: "texto",
      content: "SALIR", mediaUrl: null, cuando: D.ahora(), nombre: null,
      deAnuncio: false, productoAnuncio: null, descripcionAnuncio: null,
    }],
    { dentroDePeticion: false },
  ).then(() => {
    assert.equal(D.estaExcluido(orgId, "18095556666"), true);
    assert.equal(D.estaExcluido(orgId, "18095557777"), false);
  });
});
