import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { informeDeCierre } from "../src/lib/cierre-mes";
import { rangoAEpochs } from "../src/lib/rango";

delete process.env.OPENROUTER_API_KEY;

/**
 * EL CIERRE DE MES lee los mensajes para saber quién llevó cada hilo: la IA
 * sola, un vendedor que la interrumpió, o un vendedor desde el primer mensaje.
 */
const { orgId } = D.crearOrgConDueno({
  negocio: "Cierre de mes", color: "#12876a", nombre: "Dueña", email: "cierre-mes@prueba.com", passwordHash: "hash",
});
const canalId = D.crearCanal(orgId, {
  nombre: "RINCON DCM", phone: "18093330000", tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
});
D.obtenerAgente(orgId, canalId);

const huso = D.husoDeLaCuenta(orgId);
const hoy = rangoAEpochs("hoy", huso);
const T = Math.min(hoy.desde + 3600, Math.floor(Date.now() / 1000) - 600);
let n = 1;
function hilo(tel: string) {
  return D.getOrCreateConversation(orgId, canalId, tel, { cuando: T }).conversacion.id;
}
function msg(conv: number, emisor: D.Emisor, cuando: number) {
  D.insertMessage(orgId, { conversationId: conv, whapiMessageId: `cm-${n++}`, emisor, tipo: "texto", content: "hola", createdAt: cuando });
}

test("clasifica IA sola, interrumpida y vendedor primero, y el informe sale con sus secciones", () => {
  const sola = hilo("18091000001");
  msg(sola, "cliente", T); msg(sola, "ia", T + 10);

  const inter = hilo("18091000002");
  msg(inter, "cliente", T); msg(inter, "ia", T + 10); msg(inter, "humano", T + 20); msg(inter, "ia", T + 30);

  const primero = hilo("18091000003");
  msg(primero, "cliente", T); msg(primero, "humano", T + 10);

  const filas = D.interrupciones(orgId, { desde: hoy.desde, hasta: hoy.hasta });
  assert.equal(filas.length, 1);
  const f = filas[0]!;
  assert.equal(f.total, 3);
  assert.equal(f.ia_sola, 1);
  assert.equal(f.interrumpidas, 1);
  assert.equal(f.ia_retomo, 1);
  assert.equal(f.vendedor_primero, 1);

  const { nombre, html, depuracion } = informeDeCierre(orgId, { rango: { ...hoy, huso }, etiqueta: "Hoy" });
  assert.match(nombre, /^cierre-.*\.html$/);
  assert.ok(depuracion.intervenciones_corregidas >= 0);
  for (const s of ["Círculos de medición", "¿Los vendedores interrumpen a la IA?", "Plan para cumplir las metas", "Depuración hecha antes de descargar", "<svg"]) {
    assert.ok(html.includes(s), `falta: ${s}`);
  }
});
