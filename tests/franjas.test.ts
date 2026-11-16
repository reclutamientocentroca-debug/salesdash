import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { franjasDelPais, franjasPorDia } from "../src/lib/metrics";
import { FRANJAS_HORARIAS, franjaDeMinuto } from "../src/lib/rango";

/**
 * EL CASO: la dueña (2026-11-16) pidió medir cuántos clientes escriben en
 * cada franja del día, en Costa Rica y Panamá, y poder descargar los leads
 * de una franja concreta.
 */

// ── Los límites de cada franja, minuto a minuto ─────────────────────────────

test("las cinco franjas cubren el día entero, sin huecos ni solapes", () => {
  assert.equal(franjaDeMinuto(0).clave, "madrugada");
  assert.equal(franjaDeMinuto(8 * 60).clave, "madrugada", "las 8:00 en punto son de la madrugada");
  assert.equal(franjaDeMinuto(8 * 60 + 1).clave, "manana", "las 8:01 ya son de la mañana");
  assert.equal(franjaDeMinuto(10 * 60).clave, "manana");
  assert.equal(franjaDeMinuto(10 * 60 + 1).clave, "mediodia");
  assert.equal(franjaDeMinuto(17 * 60).clave, "mediodia", "las 5:00 p. m. en punto");
  assert.equal(franjaDeMinuto(17 * 60 + 1).clave, "tarde");
  assert.equal(franjaDeMinuto(19 * 60).clave, "tarde", "las 7:00 p. m. en punto");
  assert.equal(franjaDeMinuto(19 * 60 + 1).clave, "noche");
  assert.equal(franjaDeMinuto(23 * 60 + 59).clave, "noche", "las 11:59 p. m.");

  // Ninguna franja se queda sin su minuto: las cinco van seguidas.
  for (let m = 0; m < 24 * 60; m++) franjaDeMinuto(m);
  assert.equal(FRANJAS_HORARIAS.length, 5);
});

// ── Con clientes de verdad, en la hora de su país ───────────────────────────

const { orgId } = D.crearOrgConDueno({
  negocio: "Franjas", color: "#123456", nombre: "Dueña",
  email: "franjas@prueba.com", passwordHash: "hash",
});

function canal(nombre: string, phone: string): number {
  const id = D.crearCanal(orgId, {
    nombre, phone, tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  D.obtenerAgente(orgId, id); // nace con el país del prefijo del número
  return id;
}

const cr = canal("TELLERIA", "50688881111");
const pa = canal("Panamá", "50761112222");

let n = 1;
function conversacion(canalId: number, cuando: number): number {
  const { conversacion } = D.getOrCreateConversation(orgId, canalId, `${canalId}000${n++}`, { cuando });
  return conversacion.id;
}

// Costa Rica es UTC-6: las 03:00, 09:00, 14:00, 18:00 y 22:00 de allá, el
// 10 de noviembre de 2026, caen una en cada franja.
const u = (h: number, d = 10) => Math.floor(Date.UTC(2026, 10, d, h, 0, 0) / 1000);
conversacion(cr, u(9)); // 03:00 CR -> madrugada
conversacion(cr, u(15)); // 09:00 CR -> mañana
conversacion(cr, u(20)); // 14:00 CR -> mediodía
conversacion(cr, u(0, 11)); // 18:00 CR (10 nov) = 00:00 UTC del 11 -> tarde
conversacion(cr, u(4, 11)); // 22:00 CR (10 nov) = 04:00 UTC del 11 -> noche

// Un cliente de Panamá a la misma hora UTC no debe sumarle nada a Costa Rica.
conversacion(pa, u(15));

const rango = { desde: u(0) - 3600, hasta: u(12, 11) };

test("cada franja de Costa Rica cuenta exactamente a quien escribió ahí, sin mezclar a Panamá", () => {
  const franjas = franjasDelPais(orgId, rango, "cr");
  assert.deepEqual(
    franjas.map((f) => f.cantidad),
    [1, 1, 1, 1, 1],
    "una franja, un cliente",
  );
  assert.equal(
    franjas.reduce((a, f) => a + f.cantidad, 0),
    5,
    "los cinco de Costa Rica, y ninguno de Panamá",
  );

  const dePanama = franjasDelPais(orgId, rango, "pa");
  assert.equal(dePanama.reduce((a, f) => a + f.cantidad, 0), 1, "a Panamá solo le toca el suyo");
});

test("un país sin ningún cliente en el periodo enseña las cinco franjas en cero, no una lista vacía", () => {
  const vacio = franjasDelPais(orgId, { desde: 0, hasta: 1 }, "cr");
  assert.equal(vacio.length, 5);
  assert.ok(vacio.every((f) => f.cantidad === 0));
});

test("el registro día por día no se salta ningún día del periodo, aunque esté en cero", () => {
  const dias = franjasPorDia(orgId, rango, "cr");
  const fechas = dias.map((d) => d.fecha);
  // Las 18:00 y las 22:00 de Costa Rica el 10 de noviembre son, en UTC, ya el
  // 11 — pero el día que cuenta es el de SU hora, no el del servidor.
  assert.ok(fechas.includes("2026-11-09"), "el día de antes, sin ningún cliente, también sale");
  assert.ok(fechas.includes("2026-11-10"));
  assert.ok(fechas.includes("2026-11-11"), "el día de después, también sin nadie, también sale");

  const dia9 = dias.find((d) => d.fecha === "2026-11-09")!;
  assert.equal(dia9.total, 0);
  const dia11 = dias.find((d) => d.fecha === "2026-11-11")!;
  assert.equal(dia11.total, 0);

  // Las cinco franjas del 10 de noviembre de Costa Rica, cada una con su cliente.
  const dia10 = dias.find((d) => d.fecha === "2026-11-10")!;
  assert.equal(dia10.porFranja.madrugada, 1);
  assert.equal(dia10.porFranja.manana, 1);
  assert.equal(dia10.porFranja.mediodia, 1);
  assert.equal(dia10.porFranja.tarde, 1);
  assert.equal(dia10.porFranja.noche, 1);
  assert.equal(dia10.total, 5);

  const total = dias.reduce((a, d) => a + d.total, 0);
  assert.equal(total, 5, "los cinco clientes de Costa Rica, todos en el mismo día suyo");
});
