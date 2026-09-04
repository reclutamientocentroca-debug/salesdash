import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { registrarCierre } from "../src/lib/cierre";
import { calcularMetricas } from "../src/lib/metrics";
import { formatearImporte, leerImporte, monedaDelPais, montosDelResumen } from "../src/lib/moneda";
import { fechaISOEn, periodoEnHuso, rangoAEpochs } from "../src/lib/rango";

/**
 * EL CASO REAL: «Panamá lleva 2 ventas cerradas el día de hoy, República
 * Dominicana lleva 4 y Costa Rica lleva 2, y eso no está en el dashboard».
 *
 * Tres cosas lo escondían: las ventas se contaban por el día en que el
 * cliente escribió y no por el día en que se cerraron; «hoy» era el hoy del
 * servidor (UTC) y no el de cada país; y el dinero sumaba pesos, colones y
 * dólares en una sola cifra sin moneda.
 */

// ── «Hoy» es hoy en el país, no en el servidor ───────────────────────────────

test("a las once de la noche en Santo Domingo sigue siendo hoy", () => {
  // 2026-09-04 03:00 UTC = 2026-09-03 23:00 en Santo Domingo (UTC-4).
  const instante = Date.UTC(2026, 8, 4, 3, 0, 0);
  const rd = rangoAEpochs("hoy", "America/Santo_Domingo", instante);
  assert.equal(rd.desde, Date.UTC(2026, 8, 3, 4, 0, 0) / 1000, "el día empieza a las 00:00 de allá");
  assert.equal(rd.hasta, Date.UTC(2026, 8, 4, 4, 0, 0) / 1000 - 1, "y termina a las 23:59:59 de allá");
  assert.equal(rd.clave, "hoy");
  assert.ok(rd.desde <= instante / 1000 && instante / 1000 <= rd.hasta, "el instante cae dentro de su propio hoy");

  // En UTC ese mismo instante ya era el día 4: por eso el panel perdía la noche.
  const utc = rangoAEpochs("hoy", "UTC", instante);
  assert.equal(utc.desde, Date.UTC(2026, 8, 4) / 1000);

  // Costa Rica va una hora más atrás que Santo Domingo (UTC-6 frente a UTC-4).
  const cr = rangoAEpochs("hoy", "America/Costa_Rica", instante);
  assert.equal(cr.desde, Date.UTC(2026, 8, 3, 6, 0, 0) / 1000);
  const pa = rangoAEpochs("hoy", "America/Panama", instante);
  assert.equal(pa.desde, Date.UTC(2026, 8, 3, 5, 0, 0) / 1000);

  assert.equal(fechaISOEn("America/Santo_Domingo", instante / 1000), "2026-09-03");
  assert.equal(fechaISOEn("UTC", instante / 1000), "2026-09-04");
});

test("los demás rangos también se cuentan en la hora del país", () => {
  const instante = Date.UTC(2026, 8, 4, 3, 0, 0); // 3 de septiembre, de noche, en RD
  const huso = "America/Santo_Domingo";
  const dia = (d: number, h = 0) => Date.UTC(2026, 8, d, 4 + h) / 1000;

  const ayer = rangoAEpochs("ayer", huso, instante);
  assert.equal(ayer.desde, dia(2));
  assert.equal(ayer.hasta, dia(3) - 1);

  const semana = rangoAEpochs("7d", huso, instante);
  assert.equal(semana.desde, dia(3 - 6), "seis días atrás, y hoy son siete");
  assert.equal(semana.hasta, dia(4) - 1);

  const mes = rangoAEpochs("mes", huso, instante);
  assert.equal(mes.desde, dia(1));

  const mesPasado = rangoAEpochs("mes_pasado", huso, instante);
  assert.equal(mesPasado.desde, Date.UTC(2026, 7, 1, 4) / 1000, "el 1 de agosto a las 00:00 de allá");
  assert.equal(mesPasado.hasta, dia(1) - 1, "hasta el último segundo de agosto");

  const todo = rangoAEpochs("todo", huso, instante);
  assert.equal(todo.desde, 0);
  assert.equal(todo.hasta, dia(4) - 1);

  // Un huso que no existe no rompe el panel: cae al del servidor.
  const raro = rangoAEpochs("hoy", "Marte/Olympus", instante);
  assert.ok(raro.desde > 0 && raro.hasta > raro.desde);

  // El mismo periodo, vuelto a contar en otro país. Sin clave, no se toca.
  const enCR = periodoEnHuso(semana, "America/Costa_Rica", instante);
  assert.equal(enCR.desde, semana.desde + 2 * 3600, "dos horas más tarde en UTC: San José va dos horas atrás");
  const exacto = { desde: 100, hasta: 200 };
  assert.deepEqual(periodoEnHuso(exacto, "America/Costa_Rica", instante), exacto);
});

// ── El dinero se lee y se escribe como en cada país ──────────────────────────

test("un importe escrito a mano se lee bien en las tres monedas", () => {
  assert.equal(leerImporte("RD$2,750"), 2750);
  assert.equal(leerImporte("RD$ 1,250.00"), 1250);
  assert.equal(leerImporte("₡23.500"), 23500);
  assert.equal(leerImporte("₡3.500"), 3500);
  assert.equal(leerImporte("US$5.00"), 5);
  assert.equal(leerImporte("US$45"), 45);
  assert.equal(leerImporte("1.234,50"), 1234.5);
  assert.equal(leerImporte("250 pesos"), 250);
  assert.equal(leerImporte("por confirmar"), null);
  assert.equal(leerImporte(""), null);
});

test("el total y el envío salen del propio resumen, sin modelo", () => {
  const rd = montosDelResumen(
    "Resumen de su pedido:\n\nNombre: Ana Pérez\nCel: 8095551234\nProducto: Mocasines\nCantidad: 1\n" +
      "Dirección: Calle 1 #2, Los Prados\nCosto de envío: RD$250\nTotal a pagar: RD$2,750\n\nSu pedido ha sido confirmado exitosamente.",
  );
  assert.deepEqual(rd, { total: 2750, envio: 250 });

  const cr = montosDelResumen("Resumen:\n- Producto: Mochila\n- Envío: ₡3.500\n- Total: ₡23.500");
  assert.deepEqual(cr, { total: 23500, envio: 3500 });

  const pa = montosDelResumen("Resumen:\nProducto: Tenis\nEnvío: US$5.00\nTotal a pagar: US$50.00");
  assert.deepEqual(pa, { total: 50, envio: 5 });

  // Sin total no se inventa nada.
  assert.deepEqual(montosDelResumen("Resumen:\nProducto: Tenis\nTotal: por confirmar"), { total: null, envio: null });
  assert.deepEqual(montosDelResumen("hola, ¿tienen talla 40?"), { total: null, envio: null });
});

test("cada país escribe su moneda como la escribe su gente", () => {
  assert.equal(formatearImporte(2750, monedaDelPais("do")), "RD$2,750");
  assert.equal(formatearImporte(23500, monedaDelPais("cr")), "₡23.500");
  assert.equal(formatearImporte(45, monedaDelPais("pa")), "US$45.00");
  assert.equal(formatearImporte(1234.5, monedaDelPais("do")), "RD$1,235", "los pesos van sin decimales");
  assert.equal(formatearImporte(1500, monedaDelPais("xx")), "1,500", "sin país, el número a secas");
  assert.equal(monedaDelPais("do").simbolo, "RD$");
  assert.equal(monedaDelPais(null).codigo, "");
});

// ── El panel: tres países, cada uno con sus ventas de hoy y su moneda ────────

const { orgId } = D.crearOrgConDueno({
  negocio: "Tres países",
  color: "#12876a",
  nombre: "Dueña",
  email: "dashboard@prueba.com",
  passwordHash: "hash",
});

function canal(nombre: string, phone: string): number {
  const id = D.crearCanal(orgId, {
    nombre, phone, tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  // El agente nace con el país del prefijo del número: de ahí salen la hora y la moneda.
  D.obtenerAgente(orgId, id);
  return id;
}

const rd = canal("RINCON DCM", "18091110000");
const cr = canal("TELLERIA", "50688881111");
const pa = canal("Panamá", "50761112222");

const ahora = Math.floor(Date.now() / 1000);
const anteayer = ahora - 2 * 86_400;

let n = 1;
function conversacion(canalId: number, cuando: number): number {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, `${canalId}000${n++}`, { cuando });
  return conversacion.id;
}

function cerrada(canalId: number, quien: "ia" | "humano", total: number, envio: number, cuando = ahora) {
  const id = conversacion(canalId, anteayer);
  D.sellarCierre(orgId, id, { cerradoPor: quien, senal: quien === "ia" ? "resumen_ia" : "imagen_factura", fechaCierre: cuando });
  D.actualizarConversacion(orgId, id, { total, envio, producto_vendido: "Artículo" });
  return id;
}

// República Dominicana: 4 cerradas hoy (clientes que escribieron anteayer) y una de anteayer.
cerrada(rd, "ia", 2750, 250);
cerrada(rd, "ia", 2750, 250);
cerrada(rd, "humano", 3300, 300);
cerrada(rd, "humano", 3300, 300);
cerrada(rd, "ia", 2750, 250, anteayer + 600);
// Costa Rica: 2 cerradas hoy.
cerrada(cr, "ia", 23500, 3500);
cerrada(cr, "ia", 23500, 3500);
// Panamá: 2 cerradas hoy, y un cliente que escribió hoy y sigue abierto.
cerrada(pa, "ia", 50, 5);
cerrada(pa, "humano", 50, 5);
conversacion(pa, ahora - 60);

test("las ventas de hoy son las que se cerraron hoy, aunque el cliente escribiera antes", () => {
  const huso = D.husoDeLaCuenta(orgId);
  const m = calcularMetricas(orgId, { ...rangoAEpochs("hoy", huso), huso });

  const fila = (id: number) => m.por_canal.find((c) => c.canal_id === id)!;
  assert.equal(fila(rd).cierres_ia + fila(rd).cierres_humano, 4, "República Dominicana lleva 4");
  assert.equal(fila(cr).cierres_ia + fila(cr).cierres_humano, 2, "Costa Rica lleva 2");
  assert.equal(fila(pa).cierres_ia + fila(pa).cierres_humano, 2, "Panamá lleva 2");
  assert.equal(m.cierres_ia + m.cierres_humano, 8, "y la cuenta entera suma las tres");
  assert.equal(m.cierres_ia, 5);
  assert.equal(m.cierres_humano, 3);

  // Los leads de hoy son otra cosa: solo el que escribió hoy.
  assert.equal(fila(rd).leads, 0, "hoy no escribió nadie nuevo por RD, y aun así vendió cuatro");
  assert.equal(fila(pa).leads, 1);
  assert.equal(m.leads, 1);
  assert.equal(m.cuadra, true, "la invariante por llegada sigue cuadrando");

  // Cada número factura en su moneda, con su símbolo.
  assert.equal(fila(rd).moneda.simbolo, "RD$");
  assert.equal(fila(rd).ventas, 2 * 2500 + 2 * 3000, "RD$: el pedido sin el envío");
  assert.equal(fila(cr).moneda.simbolo, "₡");
  assert.equal(fila(cr).ventas, 2 * 20000);
  assert.equal(fila(pa).moneda.simbolo, "US$");
  assert.equal(fila(pa).ventas, 2 * 45);

  // Y con tres monedas no hay una cifra única: hay tres.
  assert.equal(m.una_moneda, null);
  assert.equal(m.facturado_por_moneda.length, 3);
  const enPesos = m.facturado_por_moneda.find((f) => f.moneda.codigo === "DOP")!;
  assert.equal(enPesos.facturado, 11000);
  assert.equal(enPesos.facturado_ia, 5000);
  assert.equal(enPesos.facturado_humano, 6000);
  assert.equal(enPesos.envios, 1100);
  assert.equal(enPesos.cierres, 4);
  assert.equal(enPesos.promedio, 2750);
  assert.equal(m.facturado_por_moneda[0].moneda.codigo, "DOP", "la que más vendió, primero");
  assert.equal(m.facturado_por_canal.find((c) => c.canal_id === cr)!.moneda.simbolo, "₡");
});

test("«todo» cuenta también la venta de anteayer, y un solo número cuenta solo lo suyo", () => {
  const huso = D.husoDeLaCuenta(orgId);
  const todo = calcularMetricas(orgId, { ...rangoAEpochs("todo", huso), huso });
  assert.equal(todo.cierres_ia + todo.cierres_humano, 9);
  assert.equal(todo.leads, 10);
  assert.equal(todo.cuadra, true);

  const soloRD = calcularMetricas(orgId, { ...rangoAEpochs("todo", huso), huso, canalId: rd });
  assert.equal(soloRD.cierres_ia + soloRD.cierres_humano, 5);
  assert.equal(soloRD.por_canal.length, 1);
  assert.equal(soloRD.una_moneda?.simbolo, "RD$", "un solo número vende en una sola moneda");
  assert.equal(soloRD.facturado, 5 * 2500 + 0 + 2 * 3000 - 5000, "en pesos: 3 × 2500 + 2 × 3000");
});

test("la cuenta vive en la hora del país que más números tiene, y cada número en la suya", () => {
  assert.equal(D.husoDeLaCuenta(orgId), "America/Santo_Domingo", "empate a uno: el primero que se conectó");
  const m = calcularMetricas(orgId, { desde: 0, hasta: 9_999_999_999 });
  assert.equal(m.por_canal.find((c) => c.canal_id === cr)!.pais, "cr");
  assert.equal(m.por_canal.find((c) => c.canal_id === pa)!.pais, "pa");
});

test("la serie diaria pone los cierres en el día en que se cerraron", () => {
  const huso = D.husoDeLaCuenta(orgId);
  const serie = D.serieDiaria(orgId, { ...rangoAEpochs("todo", huso), huso });
  const hoy = fechaISOEn(huso, ahora);
  const puntoDeHoy = serie.find((p) => p.dia === hoy)!;
  assert.ok(puntoDeHoy, "hoy tiene punto");
  assert.equal(puntoDeHoy.cierres_ia + puntoDeHoy.cierres_humano, 8, "las ocho de hoy, no las del día en que escribieron");
  assert.equal(puntoDeHoy.leads, 1);
  const puntoDeAnteayer = serie.find((p) => p.dia === fechaISOEn(huso, anteayer))!;
  assert.equal(puntoDeAnteayer.leads, 9);
  assert.equal(puntoDeAnteayer.cierres_ia, 1);
});

// ── El dinero entra en cuanto se cierra, sin esperar al analista ─────────────

test("al sellar por resumen, el total y el envío ya están en la venta", () => {
  const id = conversacion(rd, ahora - 300);
  const resumen =
    "Resumen de su pedido:\n\nNombre: Ana Pérez\nCel: 8095551234\nProducto: Mocasines\nCantidad: 1\n" +
    "Dirección: Calle 1 #2, Los Prados\nCosto de envío: RD$250\nTotal a pagar: RD$2,750\n\nSu pedido ha sido confirmado exitosamente.";
  assert.equal(registrarCierre(orgId, id, { emisor: "ia", content: resumen, cuando: ahora - 100 }), true);

  const conv = D.getConversation(orgId, id)!;
  assert.equal(conv.cerrado_por, "ia");
  assert.equal(conv.total, 2750);
  assert.equal(conv.envio, 250);

  // Lo que ya tenía un monto no se pisa: manda el analista o la corrección humana.
  const otra = conversacion(rd, ahora - 300);
  D.actualizarConversacion(orgId, otra, { total: 9999 });
  registrarCierre(orgId, otra, { emisor: "ia", content: resumen, cuando: ahora - 50 });
  const conv2 = D.getConversation(orgId, otra)!;
  assert.equal(conv2.total, 9999, "el total que había, se queda");
  assert.equal(conv2.envio, 250, "el envío, que faltaba, entra");
});
