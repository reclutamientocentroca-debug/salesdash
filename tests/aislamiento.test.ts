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
  // 1000 de pedido con 200 de envío: lo facturado son 800. El envío se cobra y
  // se paga, no se factura.
  assert.equal(D.resumenVentas(A.orgId, RANGO).facturado, 800);

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

test("solo el agente puede enviar mensajes a un cliente", async () => {
  // El transporte (`wa.ts`) tiene que exportar `enviarTexto` para que el agente
  // lo use. Lo que impide que cualquiera envíe es que NADIE MÁS lo importe.
  // Antes esto se garantizaba con una función privada; al pasar el envío al
  // módulo del socket, la garantía se sostiene con este barrido.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  const archivos: string[] = [];
  (function recorrer(dir: string) {
    for (const e of readdirSync(dir)) {
      const ruta = join(dir, e);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.tsx?$/.test(e)) archivos.push(ruta);
    }
  })("src");

  const culpables = archivos.filter((f) => {
    if (f.endsWith(join("lib", "agent.ts")) || f.endsWith(join("lib", "wa.ts"))) return false;
    // El transporte de Meta se rige por la MISMA regla: solo agent.ts envia.
    // Sin esta rama, el canal nuevo abria una segunda puerta y la garantia
    // dejaba de valer justo donde se acababa de ampliar el producto.
    if (f.endsWith(join("meta", "send.ts"))) return false;
    const fuente = readFileSync(f, "utf8");
    // Cualquier forma de traerse la función de envío desde el transporte.
    const deMeta = /meta\/send/;
    return /enviarTexto[^\n]*from\s+["'][^"']*wa["']/.test(fuente) ||
      /from\s+["'][^"']*wa["'][^\n]*enviarTexto/.test(fuente) ||
      // El envio de Meta entra por import dinamico dentro de agent.ts, asi que
      // basta con que ningun OTRO archivo nombre ese modulo.
      deMeta.test(fuente);
  });

  assert.deepEqual(
    culpables,
    [],
    `Estos archivos importan la función de envío y no deberían: ${culpables.join(", ")}`,
  );
});

test("ninguna función de lectura de db.ts omite el orgId", async () => {
  // Barrido del propio archivo: toda función exportada que reciba datos de
  // negocio tiene que empezar por orgId. Las excepciones están enumeradas.
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync("src/lib/db.ts", "utf8");

  const EXCEPCIONES = new Set([
    // Identidad: corren antes de que exista una sesión.
    "crearOrgConDueno", "buscarUsuarioPorEmail", "obtenerUsuario",
    // Plataforma: el superadmin es, por definición, de ninguna organización.
    // Solo se concede desde la consola (`npm run superadmin`).
    "marcarSuperadmin",
    // El webhook deduce la organización desde el canal.
    "canalPorWebhook",
    // El socket de WhatsApp tampoco tiene sesión: deduce la organización desde
    // el canal, y la reconexión al arrancar solo devuelve identificadores.
    "obtenerCanalSinOrg", "canalesParaReconectar",
    // Misma clase: el barrido de cierres del arranque no tiene sesión de la que
    // deducir la organización. Devuelve identificadores y nada más, y cada uno
    // vuelve como `orgId` de las funciones normales.
    "orgsParaBarrerCierres",
    // Y el barrido de seguimientos, por lo mismo: corre en un reloj, sin
    // sesión, y solo pregunta en qué cuentas hay un agente contestando.
    "orgsConAgente",

    // El supervisor tampoco viene de una sesion: empieza por saber que cuentas

    // tienen algun numero, y desde ahi todo vuelve a ir con orgId.

    "orgsConCanales",
    // Ruta del disco, no una consulta.
    "rutaDatos",
    // El webhook de Meta no trae sesion: la cuenta se DEDUCE de la pagina o de
    // la cuenta de Instagram, que es lo unico que manda Meta. Misma clase que
    // canalPorWebhook, y a partir de ahi todo vuelve a ir con orgId.
    "canalMetaPorDestino",
    // Registra el evento ANTES de saber de quien es: un webhook de una pagina
    // que nadie conecto tambien se guarda, y es justo el que hace falta mirar
    // cuando alguien dice que conecto la pagina y no le llega nada. El orgId va
    // dentro del objeto y puede ser null a proposito.
    "registrarEventoMeta",
    // Por definicion no pertenecen a ninguna cuenta: son los eventos sin dueno.
    // Solo los mira el superadmin.
    "eventosMetaHuerfanos",
  ]);

  const infractoras: string[] = [];
  const patron = /export function (\w+)\(\s*([^,)]*)/g;

  for (const [, nombre, primerParam] of fuente.matchAll(patron)) {
    if (EXCEPCIONES.has(nombre!)) continue;
    if (!primerParam!.trim().startsWith("orgId")) infractoras.push(nombre!);
  }

  assert.deepEqual(infractoras, [], `Estas funciones no reciben orgId primero: ${infractoras.join(", ")}`);
});
