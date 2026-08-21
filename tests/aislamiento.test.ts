import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";

/**
 * El requisito innegociable: dos organizaciones con datos, y ninguna consulta
 * de la primera devuelve nada de la segunda.
 *
 * Si esta prueba falla, un cliente está viendo los datos de otro.
 */

function montar(nombre: string, correo: string) {
  const { orgId } = D.crearOrgConDueno({
    negocio: nombre,
    color: "#12876a",
    nombre: "Dueño",
    email: correo,
    passwordHash: "hash",
  });

  const canalId = D.crearCanal(orgId, {
    nombre: `Canal de ${nombre}`,
    phone: `1809${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
    tokenCifrado: "cifrado",
    webhookSecret: `secreto-${nombre}`,
    whapiChannelId: null,
    estado: "conectado",
  });

  const { conversacion } = D.getOrCreateConversation(orgId, canalId, `1809555${nombre.length}000`, {
    nombre: `Cliente de ${nombre}`,
    cuando: 1_700_000_000,
  });

  D.insertMessage(orgId, {
    conversationId: conversacion.id,
    whapiMessageId: `${nombre}-msg-1`,
    emisor: "cliente",
    tipo: "texto",
    content: `secreto comercial de ${nombre}`,
    createdAt: 1_700_000_000,
  });

  D.sellarCierre(orgId, conversacion.id, {
    cerradoPor: "ia",
    senal: "resumen_ia",
    fechaCierre: 1_700_000_100,
  });
  D.actualizarConversacion(orgId, conversacion.id, {
    total: 1000,
    envio: 200,
    producto_vendido: `producto de ${nombre}`,
  });

  const productoId = D.crearProducto(orgId, { nombre: `catálogo de ${nombre}`, variantes: null, precio: 10 });
  D.crearAnomalia(orgId, {
    conversationId: conversacion.id,
    tipo: "cierre_incompleto",
    severidad: "alta",
    detalle: nombre,
  });
  D.registrarAiSent(orgId, `${nombre}-msg-1`);

  return { orgId, canalId, conversacionId: conversacion.id, productoId };
}

const A = montar("AlfaTienda", "a@alfa.com");
const B = montar("BetaTienda", "b@beta.com");
const RANGO = { desde: 0, hasta: 9_999_999_999 };

test("A no ve las conversaciones ni los mensajes de B", () => {
  assert.equal(D.getConversation(A.orgId, B.conversacionId), undefined);
  assert.equal(D.listarConversaciones(A.orgId).length, 1);
  assert.equal(D.listarConversaciones(A.orgId)[0]!.id, A.conversacionId);

  // Ni siquiera pidiendo los mensajes de una conversación ajena por su id.
  assert.deepEqual(D.listarMensajes(A.orgId, B.conversacionId), []);
  assert.deepEqual(D.ultimosMensajes(A.orgId, B.conversacionId, 20), []);
});

test("A no ve los canales, el catálogo ni las anomalías de B", () => {
  assert.equal(D.obtenerCanal(A.orgId, B.canalId), undefined);
  assert.equal(D.contarCanales(A.orgId), 1);

  const catalogo = D.listarCatalogo(A.orgId);
  assert.equal(catalogo.length, 1);
  assert.match(catalogo[0]!.nombre, /AlfaTienda/);

  const anomalias = D.listarAnomalias(A.orgId);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0]!.detalle, "AlfaTienda");
});

test("A no puede escribir en los datos de B", () => {
  D.actualizarConversacion(A.orgId, B.conversacionId, { total: 999_999 });
  assert.equal(D.getConversation(B.orgId, B.conversacionId)!.total, 1000);

  D.actualizarCanal(A.orgId, B.canalId, { nombre: "secuestrado" });
  assert.match(D.obtenerCanal(B.orgId, B.canalId)!.nombre, /BetaTienda/);

  D.eliminarProducto(A.orgId, B.productoId);
  assert.equal(D.listarCatalogo(B.orgId).length, 1);

  D.resolverRevision(A.orgId, B.conversacionId, "humano");
  assert.equal(D.getConversation(B.orgId, B.conversacionId)!.cerrado_por, "ia");
});

test("las métricas de A solo cuentan lo de A", () => {
  assert.equal(D.totalLeads(A.orgId, RANGO), 1);
  assert.equal(D.conteoPorEstado(A.orgId, RANGO).ia, 1);
  assert.equal(D.resumenVentas(A.orgId, RANGO).suma, 1000);

  const canales = D.metricasPorCanal(A.orgId, RANGO);
  assert.equal(canales.length, 1);
  assert.match(canales[0]!.nombre, /AlfaTienda/);

  const ranking = D.ventasParaRanking(A.orgId, RANGO);
  assert.equal(ranking.length, 1);
  assert.match(ranking[0]!.producto_vendido, /AlfaTienda/);
});

test("la atribución por message_id no cruza organizaciones", () => {
  // El id existe, pero pertenece a B.
  assert.equal(D.esDeIa(A.orgId, "BetaTienda-msg-1"), false);
  assert.equal(D.esDeIa(B.orgId, "BetaTienda-msg-1"), true);
  assert.equal(D.corregirEmisorAIa(A.orgId, "BetaTienda-msg-1"), null);
});

test("el webhook exige el secreto del propio canal", () => {
  assert.equal(D.canalPorWebhook(B.canalId, "secreto-AlfaTienda"), undefined);
  assert.equal(D.canalPorWebhook(B.canalId, "secreto-BetaTienda")?.org_id, B.orgId);
});

test("ninguna función de lectura de db.ts omite el orgId", async () => {
  // Barrido del propio archivo: toda función exportada que reciba datos de
  // negocio tiene que empezar por orgId. Las excepciones están enumeradas.
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync("src/lib/db.ts", "utf8");

  const EXCEPCIONES = new Set([
    // Identidad: corren antes de que exista una sesión.
    "crearOrgConDueno", "buscarUsuarioPorEmail", "obtenerUsuario",
    "marcarVerificado", "forzarReverificacion", "crearVerificacion",
    "verificacionVigente", "sumarIntento", "invalidarVerificacion",
    "contarVerificacionesDesde",
    // El webhook deduce la organización desde el canal.
    "canalPorWebhook",
  ]);

  const infractoras: string[] = [];
  const patron = /export function (\w+)\(\s*([^,)]*)/g;

  for (const [, nombre, primerParam] of fuente.matchAll(patron)) {
    if (EXCEPCIONES.has(nombre!)) continue;
    if (!primerParam!.trim().startsWith("orgId")) infractoras.push(nombre!);
  }

  assert.deepEqual(infractoras, [], `Estas funciones no reciben orgId primero: ${infractoras.join(", ")}`);
});
