import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { analizarConversacion } from "../src/lib/analyzer";
import { esResumenDePedido, fechaDelCierre, registrarCierre, telefonoDelResumen } from "../src/lib/cierre";
import { calcularMetricas } from "../src/lib/metrics";
import { leerResumen } from "../src/lib/supervisor";
import { fechaISOEn, rangoAEpochs } from "../src/lib/rango";
import { diasQueCambiaron, informeDeRecalculo, recalcularVentas } from "../src/lib/recalculo";

// Nada de red: el analista sin clave no llama a ningún modelo.
delete process.env.OPENROUTER_API_KEY;

/**
 * LA VENTA CUENTA EL DÍA EN QUE SE CERRÓ, NO EL DÍA DE LA FACTURA.
 *
 * La dueña (2026-09-11): «una venta que se cerró ayer y se facturó hoy aparece
 * en el resumen de hoy. Debe aparecer en el de ayer». Automatizada: el día del
 * resumen de la IA. Asistida: sin resumen, el día de la primera factura. La
 * factura de una venta que ya existe no crea otra: la marca como facturada.
 */

const { orgId } = D.crearOrgConDueno({
  negocio: "Fecha de cierre",
  color: "#12876a",
  nombre: "Dueña",
  email: "fecha-cierre@prueba.com",
  passwordHash: "hash",
});

function canal(nombre: string, phone: string): number {
  const id = D.crearCanal(orgId, {
    nombre, phone, tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  D.obtenerAgente(orgId, id);
  return id;
}

const rd = canal("RINCON DCM", "18091110000");
const otro = canal("RINCON 2", "18092220000");
const huso = D.husoDeLaCuenta(orgId);

// El mediodía de hoy y de ayer, en la hora de Santo Domingo.
const hoy = rangoAEpochs("hoy", huso);
const ayer = rangoAEpochs("ayer", huso);
const mediodia = (r: { desde: number }) => r.desde + 12 * 3600;
const AYER = mediodia(ayer);
const HOY = Math.min(mediodia(hoy), Math.floor(Date.now() / 1000) - 60);

let n = 1;
function hilo(canalId: number, telefono: string, cuando: number): number {
  return D.getOrCreateConversation(orgId, canalId, telefono, { cuando }).conversacion.id;
}

function mensaje(conv: number, emisor: D.Emisor, cuando: number, content: string): number {
  return D.insertMessage(orgId, {
    conversationId: conv, whapiMessageId: `fc-${n++}`, emisor, tipo: "texto", content, createdAt: cuando,
  })!;
}

function foto(conv: number, cuando: number, categoria: D.CategoriaImagen | null): number {
  const id = D.insertMessage(orgId, {
    conversationId: conv, whapiMessageId: `fc-${n++}`, emisor: "humano", tipo: "imagen", content: "[imagen]", createdAt: cuando,
  })!;
  if (categoria) D.guardarDescripcionImagen(orgId, id, { descripcion: `una ${categoria}`, categoria });
  return id;
}

const RESUMEN = (tel: string) =>
  `📋 RESUMEN DEL PEDIDO\nNombre: Ana Pérez\nTelefono: ${tel}\nDireccion: Calle 1, Los Prados\nProducto: Polo\nCantidad: 1\nEnvio: RD$250\nTOTAL A PAGAR: RD$1,650\nForma de pago: contra entrega\n✅ PEDIDO REGISTRADO`;

const metricasDe = (r: { desde: number; hasta: number; clave?: string }) => calcularMetricas(orgId, { ...r, huso });

// ── En caliente ──────────────────────────────────────────────────────────────

test("resumen ayer y factura hoy: la venta es de ayer, y la factura de hoy va aparte y marcada", () => {
  const antesHoy = metricasDe(hoy);
  const antesAyer = metricasDe(ayer);

  const conv = hilo(rd, "18095551234", AYER - 3600);
  mensaje(conv, "cliente", AYER - 3600, "quiero el polo");
  const resumen = RESUMEN("8095551234");
  mensaje(conv, "ia", AYER, resumen);
  assert.equal(registrarCierre(orgId, conv, { emisor: "ia", content: resumen, cuando: AYER }), true);

  // Hoy el representante manda la factura. Dos fotos de la misma.
  foto(conv, HOY - 30, "factura");
  assert.equal(D.marcarFacturada(orgId, conv, HOY - 30), true, "la primera foto marca la factura");
  foto(conv, HOY, "factura");
  assert.equal(D.marcarFacturada(orgId, conv, HOY), false, "otra foto de la misma factura no cuenta otra vez");

  const c = D.getConversation(orgId, conv)!;
  assert.equal(c.cerrado_por, "ia");
  assert.equal(c.fecha_cierre, AYER, "la venta se queda en el día del resumen");
  assert.equal(c.facturada_at, HOY - 30);

  const deHoy = metricasDe(hoy);
  const deAyer = metricasDe(ayer);
  assert.equal(deAyer.cierres_ia, antesAyer.cierres_ia + 1, "cuenta ayer");
  assert.equal(deHoy.cierres_ia + deHoy.cierres_humano, antesHoy.cierres_ia + antesHoy.cierres_humano, "y hoy no");
  assert.equal(deHoy.facturas_enviadas, antesHoy.facturas_enviadas + 1, "la factura sí es de hoy");
  assert.equal(deHoy.facturas_de_antes, antesHoy.facturas_de_antes + 1, "marcada como de una venta de días anteriores");
});

test("«✅ PEDIDO REGISTRADO» es el resumen de la IA aunque falte el título", () => {
  const marcador = "Resumen:";
  assert.equal(esResumenDePedido("Nombre: Ana\nTOTAL A PAGAR: RD$1,650\n✅ PEDIDO REGISTRADO", marcador), true);
  assert.equal(esResumenDePedido("*PEDIDO REGISTRADO*", marcador), true);
  assert.equal(esResumenDePedido("Su pedido registrado sale mañana", marcador), false, "a mitad de frase no cierra");
  assert.equal(esResumenDePedido("Ya quedó registrado su pedido", marcador), false);

  // Y el supervisor lo lee entero, desde la primera línea: sin el título, antes
  // se saltaba «Nombre:» y mandaba a revisión una venta buena.
  const leido = leerResumen("Nombre: Ana Pérez\nTelefono: 8095551234\nTOTAL A PAGAR: RD$1,650\n✅ PEDIDO REGISTRADO", marcador);
  assert.equal(leido.nombre, "Ana Pérez");
  assert.equal(leido.cel, "8095551234");

  const conv = hilo(rd, "18095550001", AYER);
  const texto = "Nombre: Luis\nDireccion: Santiago\nTOTAL A PAGAR: RD$990\n✅ PEDIDO REGISTRADO";
  mensaje(conv, "ia", AYER + 60, texto);
  assert.equal(registrarCierre(orgId, conv, { emisor: "ia", content: texto, cuando: AYER + 60 }), true);
  assert.equal(D.getConversation(orgId, conv)?.cerrado_por, "ia");
});

test("sin resumen, la venta es asistida el día de la PRIMERA factura", async () => {
  const conv = hilo(rd, "18095550002", AYER);
  mensaje(conv, "cliente", AYER, "mándame la cuenta");
  foto(conv, AYER + 600, "factura");
  foto(conv, HOY, "factura");
  mensaje(conv, "humano", HOY + 5, "gracias");

  await analizarConversacion(orgId, conv);
  const c = D.getConversation(orgId, conv)!;
  assert.equal(c.cerrado_por, "humano");
  assert.equal(c.senal_de_cierre, "imagen_factura");
  assert.equal(c.fecha_cierre, AYER + 600, "la primera factura, no la última ni el último mensaje");
  assert.equal(c.facturada_at, AYER + 600);
  assert.equal(fechaDelCierre(D.listarMensajes(orgId, conv), "Resumen:", "humano"), AYER + 600);
});

test("la factura que cae en otro hilo del mismo cliente no es otra venta: confirma la de la IA", async () => {
  // La IA cerró ayer en un número; la factura llega hoy por el otro.
  const ia = hilo(rd, "18095557777", AYER - 600);
  const resumen = RESUMEN("809-555-7777");
  mensaje(ia, "ia", AYER, resumen);
  registrarCierre(orgId, ia, { emisor: "ia", content: resumen, cuando: AYER });

  const factura = hilo(otro, "18095557777", HOY - 120);
  foto(factura, HOY - 60, "factura");

  const antes = metricasDe(hoy);
  await analizarConversacion(orgId, factura);

  const f = D.getConversation(orgId, factura)!;
  assert.equal(f.fecha_cierre, null, "no se crea una venta nueva");
  assert.notEqual(f.cerrado_por, "humano");
  assert.match(f.justificacion ?? "", new RegExp(`#${ia}`));

  const v = D.getConversation(orgId, ia)!;
  assert.equal(v.cerrado_por, "ia");
  assert.equal(v.fecha_cierre, AYER, "la venta sigue en su día");
  assert.equal(v.facturada_at, HOY - 60, "y queda facturada");

  const despues = metricasDe(hoy);
  assert.equal(despues.cierres_humano, antes.cierres_humano, "hoy no aparece ninguna asistida");
  assert.equal(telefonoDelResumen(resumen), "95557777");
});

test("al juntar los dos hilos de un cliente, manda el resumen de ayer y no la factura de hoy", () => {
  const lid = "99887766554433";
  const tel = "18095553333";
  const delLid = hilo(rd, lid, AYER - 600);
  const resumen = RESUMEN(tel);
  mensaje(delLid, "ia", AYER, resumen);
  registrarCierre(orgId, delLid, { emisor: "ia", content: resumen, cuando: AYER });

  const delTel = hilo(rd, tel, HOY - 300);
  foto(delTel, HOY - 200, "factura");
  D.sellarCierre(orgId, delTel, { cerradoPor: "humano", senal: "imagen_factura", fechaCierre: HOY - 200, facturadaAt: HOY - 200 });

  const unido = D.unificarConversacion(orgId, rd, lid, tel)!;
  const c = D.getConversation(orgId, unido)!;
  assert.equal(c.cerrado_por, "ia");
  assert.equal(c.senal_de_cierre, "resumen_ia");
  assert.equal(c.fecha_cierre, AYER);
  assert.equal(c.facturada_at, HOY - 200);
});

// ── El histórico ─────────────────────────────────────────────────────────────

test("el recálculo pone el histórico en el día del cierre, quita duplicados y guarda el antes y el después", () => {
  const diaAyer = fechaISOEn(huso, AYER);
  const diaHoy = fechaISOEn(huso, HOY);

  // H1: resumen solo con «PEDIDO REGISTRADO» ayer; la factura de hoy la selló como asistida de hoy.
  const h1 = hilo(rd, "18095554001", AYER - 600);
  mensaje(h1, "ia", AYER, "Nombre: Rosa\nTOTAL A PAGAR: RD$1,650\n✅ PEDIDO REGISTRADO");
  foto(h1, HOY - 50, "factura");
  D.reescribirCierre(orgId, h1, { cerradoPor: "humano", senal: "imagen_factura", fechaCierre: HOY - 50, facturadaAt: null });

  // H2: cierre del modelo sellado con la hora del último mensaje, una foto de hoy.
  const h2 = hilo(rd, "18095554002", AYER - 600);
  mensaje(h2, "ia", AYER + 30, "Listo, se lo enviamos mañana");
  foto(h2, HOY - 40, "foto_producto");
  D.reescribirCierre(orgId, h2, { cerradoPor: "ia", senal: "sin_senal", fechaCierre: HOY - 40, facturadaAt: null });

  // D1: la IA cerró ayer en un número, y la factura del otro número se contó como otra venta hoy.
  const a1 = hilo(rd, "18095554003", AYER - 600);
  mensaje(a1, "ia", AYER + 60, RESUMEN("8095554003"));
  D.reescribirCierre(orgId, a1, { cerradoPor: "ia", senal: "resumen_ia", fechaCierre: AYER + 60, facturadaAt: null });
  const d1 = hilo(otro, "18095554003", HOY - 30);
  foto(d1, HOY - 30, "factura");
  D.reescribirCierre(orgId, d1, { cerradoPor: "humano", senal: "imagen_factura", fechaCierre: HOY - 30, facturadaAt: null });

  // A2: una asistida de verdad, en su día. No se toca.
  const a2 = hilo(rd, "18095554004", HOY - 900);
  foto(a2, HOY - 20, "factura");
  D.reescribirCierre(orgId, a2, { cerradoPor: "humano", senal: "imagen_factura", fechaCierre: HOY - 20, facturadaAt: HOY - 20 });

  const informe = recalcularVentas(orgId)!;
  assert.ok(informe, "se hace la primera vez");

  const c1 = D.getConversation(orgId, h1)!;
  assert.equal(c1.cerrado_por, "ia", "tenía resumen: es automatizada");
  assert.equal(c1.fecha_cierre, AYER, "del día del resumen");
  assert.equal(c1.facturada_at, HOY - 50, "y la foto es su factura");

  assert.equal(D.getConversation(orgId, h2)!.fecha_cierre, AYER + 30, "el último texto nuestro, no la foto de hoy");

  assert.equal(D.getConversation(orgId, d1)!.fecha_cierre, null, "el duplicado deja de contar");
  assert.equal(D.getConversation(orgId, a1)!.facturada_at, HOY - 30, "y la venta de la IA queda facturada");

  const c4 = D.getConversation(orgId, a2)!;
  assert.equal(c4.cerrado_por, "humano");
  assert.equal(c4.fecha_cierre, HOY - 20, "la asistida de verdad no se mueve");

  // El antes y el después, por día: hoy pierde H1, H2 y D1; ayer gana H1 y H2.
  const dias = diasQueCambiaron(informe);
  const hoyCambio = dias.find((d) => d.dia === diaHoy)!;
  const ayerCambio = dias.find((d) => d.dia === diaAyer)!;
  assert.equal(hoyCambio.antes.ia + hoyCambio.antes.humano - (hoyCambio.despues.ia + hoyCambio.despues.humano), 3);
  assert.equal(ayerCambio.despues.ia - ayerCambio.antes.ia, 2);
  assert.equal(informe.resumen.duplicados, 1);
  assert.equal(informe.resumen.a_automatizada, 1);
  assert.ok(informe.cambios.some((c) => c.id === d1 && c.despues === null));

  // Queda guardado para la página, y no se repite.
  assert.equal(informeDeRecalculo(orgId)?.resumen.duplicados, 1);
  assert.equal(recalcularVentas(orgId), null, "una sola vez por cuenta");

  // Y el panel cuenta como el informe.
  assert.equal(metricasDe(hoy).cierres_ia + metricasDe(hoy).cierres_humano, hoyCambio.despues.ia + hoyCambio.despues.humano);
});
