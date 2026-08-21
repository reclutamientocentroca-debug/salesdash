import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { calcularMetricas } from "../src/lib/metrics";

/**
 * La invariante del procedimiento diario:
 *
 *   leads = cerradas_ia + cerradas_humano + abiertas + revision
 *
 * Si no cuadra, hay conversaciones perdiéndose y el reporte es falso.
 */

const RANGO = { desde: 0, hasta: 9_999_999_999 };

const { orgId } = D.crearOrgConDueno({
  negocio: "Conteo",
  color: "#12876a",
  nombre: "Dueño",
  email: "conteo@prueba.com",
  passwordHash: "hash",
});

const canalId = D.crearCanal(orgId, {
  nombre: "Ventas",
  phone: "18091110000",
  tokenCifrado: "x",
  webhookSecret: "s",
  whapiChannelId: null,
  estado: "conectado",
});

let siguiente = 1;
function nuevaConversacion(t = 1_700_000_000) {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, `1809000${siguiente++}`, {
    cuando: t,
  });
  return conversacion.id;
}

// 3 cerradas por la IA, 2 por humanos, 4 abiertas, 2 en revisión = 11 leads.
const cerradasIa = [0, 1, 2].map(() => nuevaConversacion());
const cerradasHumano = [0, 1].map(() => nuevaConversacion());
const abiertas = [0, 1, 2, 3].map(() => nuevaConversacion());
const enRevision = [0, 1].map(() => nuevaConversacion());

for (const id of cerradasIa) {
  D.sellarCierre(orgId, id, { cerradoPor: "ia", senal: "resumen_ia", fechaCierre: 1_700_000_600 });
  D.actualizarConversacion(orgId, id, { total: 1000, envio: 200, producto_vendido: "Camisa" });
}
for (const id of cerradasHumano) {
  D.sellarCierre(orgId, id, { cerradoPor: "humano", senal: "imagen_factura", fechaCierre: 1_700_001_200 });
  D.actualizarConversacion(orgId, id, { total: 2000, envio: 200, producto_vendido: "camisa " });
}
for (const id of enRevision) {
  D.marcarRevision(orgId, id, "empate de horas");
}

test("leads = ia + humano + abiertas + revision", () => {
  const e = D.conteoPorEstado(orgId, RANGO);
  assert.equal(D.totalLeads(orgId, RANGO), 11);
  assert.equal(e.ia + e.humano + e.abierta + e.revision, 11);
  assert.deepEqual(e, { ia: 3, humano: 2, abierta: 4, revision: 2 });
});

test("calcularMetricas expone la invariante y no la esconde", () => {
  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.cuadra, true);
  assert.equal(m.leads, m.cierres_ia + m.cierres_humano + m.sin_cerrar + m.revision);
  assert.equal(m.revision, 2);
});

test("la invariante aguanta después de resolver una revisión", () => {
  D.resolverRevision(orgId, enRevision[0]!, "humano");

  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.cuadra, true);
  assert.equal(m.leads, 11);
  assert.equal(m.cierres_humano, 3);
  assert.equal(m.revision, 1);
});

test("el ranking agrupa productos aunque el modelo los escriba distinto", () => {
  // "Camisa" y "camisa " son el mismo producto: 5 unidades, no dos filas.
  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.top_productos.length, 1);
  assert.equal(m.top_productos[0]!.producto, "Camisa");
  assert.equal(m.top_productos[0]!.unidades, 5);
});

test("los tiempos promedio excluyen las conversaciones abiertas", () => {
  const m = calcularMetricas(orgId, RANGO);
  // Las cerradas por la IA tardaron 600 s; las abiertas no cuentan.
  assert.equal(m.tiempo_promedio_ia, 600);
  assert.notEqual(m.tiempo_promedio_humano, null);
});

test("una conversación nueva entra como lead y sigue cuadrando", () => {
  nuevaConversacion();
  const m = calcularMetricas(orgId, RANGO);
  assert.equal(m.leads, 12);
  assert.equal(m.sin_cerrar, 5);
  assert.equal(m.cuadra, true);
});
