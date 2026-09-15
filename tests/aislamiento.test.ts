import "./entorno";
import { test as prueba } from "node:test";
import assertBorrar from "node:assert/strict";
import * as DB from "../src/lib/db";

/**
 * BORRAR UNA CONVERSACIÓN se lleva sus mensajes y nada más: ni otro hilo de la
 * misma cuenta, ni —sobre todo— un hilo de otra cuenta con el mismo número.
 */
prueba("borrar una conversación se lleva lo suyo y no toca lo ajeno", () => {
  const a = DB.crearOrgConDueno({ negocio: "A", color: "#111111", nombre: "A", email: `borrar-a-${Date.now()}@p.local`, passwordHash: "x" });
  const b = DB.crearOrgConDueno({ negocio: "B", color: "#222222", nombre: "B", email: `borrar-b-${Date.now()}@p.local`, passwordHash: "x" });
  const canalA = DB.crearCanal(a.orgId, { nombre: "A", phone: "18090000001", tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado" });
  const canalB = DB.crearCanal(b.orgId, { nombre: "B", phone: "18090000002", tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado" });

  const { conversacion: hiloA } = DB.getOrCreateConversation(a.orgId, canalA, "18095550001", { cuando: DB.ahora() });
  const { conversacion: otroA } = DB.getOrCreateConversation(a.orgId, canalA, "18095550002", { cuando: DB.ahora() });
  const { conversacion: hiloB } = DB.getOrCreateConversation(b.orgId, canalB, "18095550001", { cuando: DB.ahora() });
  for (const [org, conv] of [[a.orgId, hiloA], [a.orgId, otroA], [b.orgId, hiloB]] as const) {
    DB.insertMessage(org, { conversationId: conv.id, whapiMessageId: `m-${conv.id}`, emisor: "cliente", tipo: "texto", content: "hola", createdAt: DB.ahora() });
  }

  assertBorrar.equal(DB.eliminarConversacion(a.orgId, hiloA.id), true);
  assertBorrar.ok(!DB.getConversation(a.orgId, hiloA.id), "el hilo ya no está");
  assertBorrar.equal(DB.listarMensajes(a.orgId, hiloA.id).length, 0, "ni sus mensajes");
  assertBorrar.equal(DB.listarMensajes(a.orgId, otroA.id).length, 1, "el otro hilo de la cuenta sigue");
  assertBorrar.equal(DB.listarMensajes(b.orgId, hiloB.id).length, 1, "y el de la otra cuenta también");

  // Desde otra cuenta no se borra, y se dice.
  assertBorrar.equal(DB.eliminarConversacion(a.orgId, hiloB.id), false);
  assertBorrar.ok(DB.getConversation(b.orgId, hiloB.id), "el hilo ajeno sigue intacto");
});
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

/**
 * Y DENTRO DE UNA CUENTA, CADA PAÍS CON LO SUYO.
 *
 * La fuga que la dueña olió (2026-09-08): una cuenta que vende en tres países
 * tiene tres monedas y tres listas de precios, y el precio se guarda sin moneda.
 * Con el catálogo colgado de la cuenta, el agente de Costa Rica leía el combo
 * dominicano de 1690 como suyo —1.690 colones— y se lo ofrecía al cliente tico.
 * Un producto es de un número, o es de todos, y eso lo dice `canal_id`.
 */
test("el catálogo de un país no lo lee el agente de otro", () => {
  const org = D.crearOrgConDueno({
    negocio: "Tres países", color: "#111111", nombre: "Dueña",
    email: `paises-${Date.now()}@p.local`, passwordHash: "x",
  });
  const canal = (nombre: string) =>
    D.crearCanal(org.orgId, {
      nombre, phone: `1809${Math.random().toString().slice(2, 9)}`,
      tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
    });

  const cr = canal("Costa Rica");
  const rd = canal("República Dominicana");

  D.crearProducto(org.orgId, { nombre: "Camisa de lino", variantes: "S, M, L", precio: 25000, canalId: cr });
  D.crearProducto(org.orgId, { nombre: "Combo 2 en 1", variantes: null, precio: 1690, canalId: rd });
  D.crearProducto(org.orgId, { nombre: "Bolsa de regalo", variantes: null, precio: 500 });

  const nombres = (canalId?: number) =>
    D.listarCatalogo(org.orgId, true, canalId).map((p) => p.nombre).sort();

  assert.deepEqual(nombres(cr), ["Bolsa de regalo", "Camisa de lino"], "lo suyo y lo de todos");
  assert.deepEqual(nombres(rd), ["Bolsa de regalo", "Combo 2 en 1"]);
  // Y la pantalla de Productos sí lo ve todo: es donde la dueña lo reparte.
  assert.deepEqual(nombres(), ["Bolsa de regalo", "Camisa de lino", "Combo 2 en 1"]);

  // Mover un producto de número lo saca del otro en el acto.
  const combo = D.listarCatalogo(org.orgId).find((p) => p.nombre === "Combo 2 en 1")!;
  D.actualizarProducto(org.orgId, combo.id, { canal_id: cr });
  assert.ok(nombres(cr).includes("Combo 2 en 1"));
  assert.ok(!nombres(rd).includes("Combo 2 en 1"));
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
    // El recálculo del histórico corre al arrancar, sin sesión: solo pregunta
    // qué cuentas tienen ventas, y desde ahí todo vuelve a ir con orgId.
    "orgsConVentas",
    // Ruta del disco, no una consulta.
    "rutaDatos",
    // El webhook de Meta no trae sesion: la cuenta se DEDUCE de la pagina o de
    // la cuenta de Instagram, que es lo unico que manda Meta. Misma clase que
    // canalPorWebhook, y a partir de ahi todo vuelve a ir con orgId.
    "canalMetaPorDestino",
    // La app de Meta es una sola para toda la plataforma: el diagnóstico de
    // superadmin solo pregunta si hay alguna cuenta de Instagram conectada,
    // para saber si la app tiene que suscribirse también a sus directos.
    "hayInstagramConectado",
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
