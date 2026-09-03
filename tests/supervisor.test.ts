import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { registrarCierre } from "../src/lib/cierre";
import {
  analizarPendientes,
  fallasDelResumen,
  leerResumen,
  revisarCierres,
  supervisarCuenta,
  TIPO_RESUMEN_DUDOSO,
} from "../src/lib/supervisor";

/**
 * EL SUPERVISOR NO SE CREE UN RESUMEN SOLO PORQUE LLEVE EL MARCADOR.
 *
 * El caso real: un bot mandando el mismo pedido —mismo nombre, mismo
 * celular— a todos los clientes sin terminar la conversación. Cada uno
 * entraba al dashboard como una venta. Estas pruebas no tocan la red: la
 * revisión de cierres es mecánica, y el análisis con modelo se comprueba
 * apagado.
 */

// Sin clave del modelo: el supervisor tiene que hacer todo lo demás igual.
delete process.env.OPENROUTER_API_KEY;

const { orgId } = D.crearOrgConDueno({
  negocio: "Rincon",
  color: "#12876a",
  nombre: "Dueña",
  email: `supervisor-${Date.now()}@prueba.local`,
  passwordHash: "x",
});

const canalId = D.crearCanal(orgId, {
  nombre: "RD", phone: "18095550100", tokenCifrado: "x",
  webhookSecret: "s", whapiChannelId: null, estado: "conectado",
});
D.actualizarAgente(orgId, { pais: "do", nombre: "Mildred" }, canalId);

/** Hora de las ventas de prueba: dentro de la ventana que mira el supervisor. */
let t = D.ahora() - 6 * 3600;
let n = 0;

function pedido(campos: Partial<Record<"nombre" | "cel" | "direccion" | "total", string>> = {}): string {
  return [
    "Resumen:",
    "",
    `Nombre: ${campos.nombre ?? "Cliente Distinto " + ++n}`,
    `Cel: ${campos.cel ?? "80955500" + String(n).padStart(2, "0")}`,
    "Producto: Mocasines",
    "Cantidad: 1",
    `Dirección: ${campos.direccion ?? "Calle 1 #2, Los Prados, Santo Domingo"}`,
    "Costo de envío: RD$250",
    `Total a pagar: ${campos.total ?? "RD$2,750"}`,
  ].join("\n");
}

/** Un hilo con su resumen de la IA, sellado como lo sella la ingesta. */
function venta(telefono: string, resumen: string, opciones: { sellar?: boolean } = {}): number {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, telefono, { cuando: t });
  D.insertMessage(orgId, {
    conversationId: conversacion.id, whapiMessageId: `sup-${++n}-c`, emisor: "cliente",
    tipo: "texto", content: "hola", createdAt: t,
  });
  D.insertMessage(orgId, {
    conversationId: conversacion.id, whapiMessageId: `sup-${n}-ia`, emisor: "ia",
    tipo: "texto", content: resumen, createdAt: t + 60,
  });
  if (opciones.sellar !== false) {
    registrarCierre(orgId, conversacion.id, { emisor: "ia", content: resumen, cuando: t + 60 });
  }
  t += 600;
  return conversacion.id;
}

const estado = (id: number) => D.getConversation(orgId, id)!.cerrado_por;

// ── Leer un resumen ─────────────────────────────────────────────────────────

test("lee las cuatro líneas que hacen un pedido, con las etiquetas de cada guion", () => {
  const rd = leerResumen(pedido({ nombre: "Ana Pérez", cel: "809-555-1234", total: "RD$2,750" }));
  assert.equal(rd.nombre, "Ana Pérez");
  assert.equal(rd.cel, "809-555-1234");
  assert.match(rd.direccion!, /Los Prados/);
  assert.equal(rd.total, "RD$2,750");

  // El tico escribe otras etiquetas, con adorno y con negritas de WhatsApp.
  const cr = leerResumen(
    "Perfecto.\n\n*Resumen de su pedido:*\n\n👤 Nombre completo: Marcela Jiménez\n📱 Celular: 8888-1234\n" +
      "📍 Dirección, cantón y provincia: 200 m norte de la iglesia, San Rafael, Heredia\n" +
      "Forma de pago: SINPE\nTotal a pagar: ₡28.500",
  );
  assert.equal(cr.nombre, "Marcela Jiménez");
  assert.equal(cr.cel, "8888-1234");
  assert.match(cr.direccion!, /Heredia/);
  assert.equal(cr.total, "₡28.500");

  // Sin marcador se lee igual: el hueco se juzga después.
  assert.equal(leerResumen("Hola, ¿qué talla?").nombre, null);
});

test("un resumen con huecos, con el nombre de la casa o sin cifra no es un pedido", () => {
  assert.deepEqual(fallasDelResumen(leerResumen(pedido({ nombre: "Ana Pérez" })), ["Orlanda", "RINCON DCM"]), []);

  const conHuecos = fallasDelResumen(leerResumen(pedido({ total: "por confirmar", direccion: "(indicar)" })));
  assert.ok(conHuecos.some((f) => f.includes("total")), "el total en blanco");
  assert.ok(conHuecos.some((f) => f.includes("dirección")), "y la dirección con paréntesis");

  const deLaCasa = fallasDelResumen(leerResumen(pedido({ nombre: "Orlanda" })), ["Orlanda", "RINCON DCM"]);
  assert.ok(deLaCasa.some((f) => f.includes("nombre de la casa")), "el pedido no puede ir a nombre de la vendedora");

  const sinCel = fallasDelResumen(leerResumen(pedido({ cel: "el mismo de este chat" })));
  assert.ok(sinCel.some((f) => f.includes("celular")), "una nota no es un número al que llamar");

  const compartida = fallasDelResumen(leerResumen(pedido({ direccion: "ubicación compartida" })));
  assert.ok(compartida.some((f) => f.includes("ubicación compartida")));
});

// ── Revisar los cierres ─────────────────────────────────────────────────────

test("el mismo nombre en tres chats de clientes distintos manda las tres ventas a revisión", () => {
  const a = venta("18291110001", pedido({ nombre: "Juan Pérez" }));
  const b = venta("18291110002", pedido({ nombre: "juan perez" }));
  const buena = venta("18291110003", pedido({ nombre: "Rosa Almonte" }));

  // Con dos todavía no: dos hermanos pueden dar el mismo nombre.
  let r = revisarCierres(orgId);
  assert.equal(r.dudosas, 0);
  assert.equal(estado(a), "ia");

  const c = venta("18291110004", pedido({ nombre: "JUAN PÉREZ" }));
  r = revisarCierres(orgId);

  assert.equal(r.dudosas, 3, "las tres del mismo nombre");
  for (const id of [a, b, c]) {
    assert.equal(estado(id), "revision", `la ${id} deja de contar como venta`);
    const conv = D.getConversation(orgId, id)!;
    assert.ok(conv.fecha_cierre !== null, "la fecha de cierre se conserva");
    assert.match(conv.justificacion!, /Juan Pérez|juan perez|JUAN PÉREZ/i);
    assert.ok(D.hayAnomaliaAbierta(orgId, id, TIPO_RESUMEN_DUDOSO), "con su anomalía");
  }
  assert.equal(estado(buena), "ia", "la venta de verdad sigue contando");

  // Y a la segunda vuelta no hay nada nuevo que dudar.
  assert.equal(revisarCierres(orgId).dudosas, 0);
});

test("el mismo celular en tres chats distintos también, aunque los nombres cambien", () => {
  const ids = ["18291120001", "18291120002", "18291120003"].map((tel, i) =>
    venta(tel, pedido({ nombre: `Persona ${i}`, cel: "(809) 461-4076" })),
  );
  revisarCierres(orgId);
  for (const id of ids) assert.equal(estado(id), "revision", "el número de la tienda no es el de tres clientes");
});

test("un resumen incompleto o a nombre de la vendedora se duda solo, sin repetirse", () => {
  const sinTotal = venta("18291130001", pedido({ nombre: "Pedro Gómez", total: "por confirmar" }));
  const orlanda = venta("18291130002", pedido({ nombre: "Orlanda" }));
  const completa = venta("18291130003", pedido({ nombre: "Luisa Mena" }));

  revisarCierres(orgId);

  assert.equal(estado(sinTotal), "revision");
  assert.match(D.getConversation(orgId, sinTotal)!.justificacion!, /total/);
  assert.equal(estado(orlanda), "revision");
  assert.match(D.getConversation(orgId, orlanda)!.justificacion!, /nombre de la casa/);
  assert.equal(estado(completa), "ia");
});

test("una corrección manual no se toca, y el conteo sigue cuadrando", () => {
  const id = venta("18291140001", pedido({ nombre: "Orlanda" }));
  revisarCierres(orgId);
  assert.equal(estado(id), "revision");

  // Alguien la mira y la confirma: es una venta, y firmada.
  D.resolverRevision(orgId, id, "ia");
  assert.equal(estado(id), "ia");
  assert.equal(D.getConversation(orgId, id)!.senal_de_cierre, "correccion_manual");

  revisarCierres(orgId);
  assert.equal(estado(id), "ia", "lo que firmó una persona no se vuelve a dudar");

  const rango = { desde: D.ahora() - 7 * 24 * 3600, hasta: D.ahora() + 1 };
  const e = D.conteoPorEstado(orgId, rango);
  assert.equal(D.totalLeads(orgId, rango), e.ia + e.humano + e.abierta + e.revision, "la invariante");
});

// ── La vuelta entera ────────────────────────────────────────────────────────

test("sin modelo, el supervisor sella, revisa y barre igual, y no analiza nada", async () => {
  // Un resumen que entró sin sellarse (una importación a mitad de lote).
  const sinSellar = venta("18291150001", pedido({ nombre: "Carmen Díaz" }), { sellar: false });
  assert.equal(D.getConversation(orgId, sinSellar)!.fecha_cierre, null);

  const r = await supervisarCuenta(orgId);

  assert.ok(r.selladas >= 1, "la venta sin sellar se cuenta");
  assert.equal(estado(sinSellar), "ia");
  assert.equal(r.analizadas, 0, "sin clave no se llama a ningún modelo");
  assert.equal(r.modelo_caido, true, "y se dice");

  assert.deepEqual(await analizarPendientes(orgId), { analizadas: 0, modeloCaido: true });
});
