import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { atenderConversacion, dentroDeHorario, pideHumano } from "../src/lib/agent";
import type { Resultado } from "../src/lib/agent";

/** Estrecha la unión: si el agente respondió, la prueba debe fallar aquí. */
function motivoDe(r: Resultado): string {
  assert.equal(r.atendida, false, "el agente no debía haber respondido");
  return r.atendida === false ? r.motivo : "";
}

/**
 * Salvaguardas del agente vendedor.
 *
 * Todas las condiciones de silencio se evalúan ANTES de llamar al modelo, así
 * que estas pruebas no tocan la red. Si alguna dejara pasar el control hasta
 * la generación, fallaría por falta de OPENROUTER_API_KEY: eso también sería
 * una señal correcta de que la salvaguarda no funcionó.
 */

const { orgId } = D.crearOrgConDueno({
  negocio: "Agente",
  color: "#12876a",
  nombre: "Dueño",
  email: "agente@prueba.com",
  passwordHash: "hash",
});

const canalId = D.crearCanal(orgId, {
  nombre: "Ventas",
  phone: "18092220000",
  tokenCifrado: "x",
  webhookSecret: "s",
  whapiChannelId: null,
  estado: "conectado",
});

let telefono = 18_090_000_000;
function hilo(mensajes: { emisor: D.Emisor; content: string; hace: number }[]) {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, String(++telefono), {
    cuando: D.ahora() - 86_400,
  });

  for (const [i, m] of mensajes.entries()) {
    D.insertMessage(orgId, {
      conversationId: conversacion.id,
      whapiMessageId: `${conversacion.id}-${i}`,
      emisor: m.emisor,
      tipo: "texto",
      content: m.content,
      createdAt: D.ahora() - m.hace,
    });
  }
  return conversacion.id;
}

const encender = (v: boolean) => D.actualizarCanal(orgId, canalId, { agente_activo: v ? 1 : 0 });

// ── Funciones puras ─────────────────────────────────────────────────────────

test("detecta que el cliente pide una persona", () => {
  assert.equal(pideHumano("quiero hablar con una persona por favor"), true);
  assert.equal(pideHumano("me pasas con UN ASESOR?"), true);
  assert.equal(pideHumano("eres un bot?"), true);
  assert.equal(pideHumano("quiero dos camisas talla M"), false);
});

test("el horario nocturno cruza la medianoche", () => {
  const a = (h: number, m = 0) => new Date(2026, 0, 15, h, m);

  // Horario normal 09:00–18:00
  assert.equal(dentroDeHorario("09:00", "18:00", a(12)), true);
  assert.equal(dentroDeHorario("09:00", "18:00", a(20)), false);
  assert.equal(dentroDeHorario("09:00", "18:00", a(3)), false);

  // Nocturno 20:00–02:00: la medianoche no puede dejar al agente mudo.
  assert.equal(dentroDeHorario("20:00", "02:00", a(23)), true);
  assert.equal(dentroDeHorario("20:00", "02:00", a(1)), true);
  assert.equal(dentroDeHorario("20:00", "02:00", a(12)), false);

  // Sin horario configurado, siempre dentro.
  assert.equal(dentroDeHorario(null, null, a(4)), true);
});

// ── Condiciones de silencio ─────────────────────────────────────────────────

test("con el agente apagado no hace nada", async () => {
  encender(false);
  const id = hilo([{ emisor: "cliente", content: "hola", hace: 10 }]);

  const r = await atenderConversacion(orgId, canalId, id);
  assert.deepEqual(r, { atendida: false, motivo: "agente_apagado" });
});

test("nunca responde a un mensaje que no escribió el cliente", async () => {
  encender(true);

  const deIa = hilo([
    { emisor: "cliente", content: "hola", hace: 200 },
    { emisor: "ia", content: "¡Hola! ¿En qué te ayudo?", hace: 100 },
  ]);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, deIa)), "ultimo_no_es_cliente");

  const deHumano = hilo([
    { emisor: "cliente", content: "hola", hace: 200 },
    { emisor: "humano", content: "ya te atiendo", hace: 100 },
  ]);
  assert.equal(motivoDe(await atenderConversacion(orgId, canalId, deHumano)), "ultimo_no_es_cliente");
});

test("si un vendedor escribió hace poco, el agente se calla", async () => {
  encender(true);
  const id = hilo([
    { emisor: "cliente", content: "precio?", hace: 3600 },
    { emisor: "humano", content: "son 1850", hace: 1800 }, // hace media hora
    { emisor: "cliente", content: "ok, lo quiero", hace: 60 },
  ]);

  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "vendedor_reciente");
});

test("pasadas las dos horas, el vendedor ya no lo silencia", async () => {
  encender(true);
  const id = hilo([
    { emisor: "humano", content: "son 1850", hace: 3 * 60 * 60 }, // hace tres horas
    { emisor: "cliente", content: "sigo interesado", hace: 60 },
  ]);

  // Ya no hay silencio: el control llega hasta el modelo, que sin clave falla.
  const r = await atenderConversacion(orgId, canalId, id);
  assert.notEqual(motivoDe(r), "vendedor_reciente");
});

test("si el cliente pide una persona, se calla y deja constancia", async () => {
  encender(true);
  const id = hilo([{ emisor: "cliente", content: "quiero hablar con una persona", hace: 30 }]);

  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "pidio_humano");

  const anomalias = D.listarAnomalias(orgId).filter((a) => a.conversation_id === id);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0]!.tipo, "pidio_humano");
  assert.equal(anomalias[0]!.severidad, "alta");
});

test("una vez que pidió una persona, sigue callado aunque escriba otra cosa", async () => {
  encender(true);
  const id = hilo([{ emisor: "cliente", content: "me pasas con un asesor", hace: 300 }]);
  await atenderConversacion(orgId, canalId, id);

  D.insertMessage(orgId, {
    conversationId: id,
    whapiMessageId: `${id}-luego`,
    emisor: "cliente",
    tipo: "texto",
    content: "bueno, ¿cuánto cuesta la camisa?",
    createdAt: D.ahora() - 10,
  });

  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "pidio_humano");
  // Y no se duplica la anomalía.
  assert.equal(D.listarAnomalias(orgId).filter((a) => a.conversation_id === id).length, 1);
});

test("fuera del horario configurado no responde", async () => {
  encender(true);
  const ahoraH = new Date().getHours();
  // Una franja de una hora que con seguridad no incluye este momento.
  const lejos = (ahoraH + 5) % 24;
  const dos = (lejos + 1) % 24;
  const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;

  D.actualizarAgente(orgId, { horario_activo: 1, horario_desde: hh(lejos), horario_hasta: hh(dos) });

  const id = hilo([{ emisor: "cliente", content: "hola", hace: 10 }]);
  const r = await atenderConversacion(orgId, canalId, id);
  assert.equal(motivoDe(r), "fuera_de_horario");

  D.actualizarAgente(orgId, { horario_activo: 0 });
});

test("se detiene tras ocho respuestas en una hora, para no inundar al cliente", async () => {
  encender(true);
  const mensajes: { emisor: D.Emisor; content: string; hace: number }[] = [];

  for (let i = 0; i < 8; i++) {
    mensajes.push({ emisor: "cliente", content: `pregunta ${i}`, hace: 2000 - i * 100 });
    mensajes.push({ emisor: "ia", content: `respuesta ${i}`, hace: 1990 - i * 100 });
  }
  mensajes.push({ emisor: "cliente", content: "una más", hace: 5 });

  const id = hilo(mensajes);
  const r = await atenderConversacion(orgId, canalId, id);

  assert.equal(motivoDe(r), "limite_por_hora");
  const anomalia = D.listarAnomalias(orgId).find(
    (a) => a.conversation_id === id && a.tipo === "agente_en_bucle",
  );
  assert.ok(anomalia, "debe quedar registrado que el agente se detuvo");
});

test("ninguna de estas rutas envió un mensaje", () => {
  // Si algo se hubiera enviado, existiría un mensaje de la IA registrado
  // después de que empezaron las pruebas. Solo están los que insertamos.
  const todos = D.listarConversaciones(orgId).flatMap((c) => D.listarMensajes(orgId, c.id));
  const inventados = todos.filter((m) => m.whapi_message_id?.startsWith("wamid"));
  assert.deepEqual(inventados, []);
});
