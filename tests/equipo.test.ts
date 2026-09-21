/**
 * El reparto de números y páginas por miembro del equipo.
 *
 * La dueña (2026-09-21): «déjame darle acceso a mi equipo por página y
 * whatsapp para que puedan transferir la atención a la IA». Dos piezas:
 *
 *   1. Meter a alguien del equipo DENTRO de la cuenta (`crearMiembro`), que no
 *      existía —todo el que se registraba abría su propia cuenta—.
 *   2. Repartirle canales (`equipo_canales` / `canalesDeMiembro` /
 *      `asignarCanalesAMiembro`), y que sin ninguno asignado siga viendo todo
 *      —el reparto es algo que el dueño ENCIENDE, no una jaula por defecto—.
 */
import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { puedeAtenderCanal, type Contexto } from "../src/lib/tenant";

function montar(nombre: string) {
  const { orgId, userId: duenoId } = D.crearOrgConDueno({
    negocio: nombre,
    color: "#12876a",
    nombre: "Dueña",
    email: `dueno-${nombre}-${Date.now()}@p.local`,
    passwordHash: "x",
  });
  const canalA = D.crearCanal(orgId, {
    nombre: "Número A", phone: `1809${Date.now()}`.slice(0, 14),
    tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  const canalB = D.crearCanal(orgId, {
    nombre: "Número B", phone: `1829${Date.now()}`.slice(0, 14),
    tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  return { orgId, duenoId, canalA, canalB };
}

test("crearMiembro mete a alguien en la MISMA cuenta, con rol miembro", () => {
  const { orgId } = montar("equipo-crear");
  const userId = D.crearMiembro(orgId, {
    nombre: "Vendedora", email: `vendedora-${Date.now()}@p.local`, passwordHash: "x",
  });

  const u = D.obtenerUsuario(userId);
  assert.equal(u?.org_id, orgId, "queda en la cuenta del dueño, no en una propia");
  assert.equal(u?.rol, "miembro");

  const miembros = D.listarMiembros(orgId);
  assert.ok(miembros.some((m) => m.id === userId));
});

test("eliminarMiembro solo saca miembros, y solo de su propia cuenta", () => {
  const { orgId, duenoId } = montar("equipo-eliminar");
  const otra = montar("equipo-eliminar-otra");
  const userId = D.crearMiembro(orgId, {
    nombre: "Vendedor", email: `vendedor-${Date.now()}@p.local`, passwordHash: "x",
  });

  // Ni con el id correcto desde otra cuenta.
  assert.equal(D.eliminarMiembro(otra.orgId, userId), false);
  assert.ok(D.obtenerUsuario(userId), "sigue vivo: lo intentó borrar quien no es su dueño");

  // Al dueño no se le puede sacar por aquí, aunque se sepa su id.
  assert.equal(D.eliminarMiembro(orgId, duenoId), false);
  assert.ok(D.obtenerUsuario(duenoId), "el dueño sigue en pie");

  // Desde su propia cuenta, sí.
  assert.equal(D.eliminarMiembro(orgId, userId), true);
  assert.equal(D.obtenerUsuario(userId), undefined);
});

test("sin ningún canal asignado, canalesDeMiembro sale vacío: el significado es «ve todos»", () => {
  const { orgId } = montar("equipo-sin-reparto");
  const userId = D.crearMiembro(orgId, { nombre: "M", email: `m-${Date.now()}@p.local`, passwordHash: "x" });

  assert.deepEqual(D.canalesDeMiembro(orgId, userId), []);
});

test("asignarCanalesAMiembro REEMPLAZA la lista, no la acumula", () => {
  const { orgId, canalA, canalB } = montar("equipo-reemplaza");
  const userId = D.crearMiembro(orgId, { nombre: "M", email: `m-${Date.now()}@p.local`, passwordHash: "x" });

  D.asignarCanalesAMiembro(orgId, userId, [canalA, canalB]);
  assert.deepEqual(D.canalesDeMiembro(orgId, userId).sort(), [canalA, canalB].sort());

  // Reasignar con uno solo quita el otro: no es un "añadir".
  D.asignarCanalesAMiembro(orgId, userId, [canalA]);
  assert.deepEqual(D.canalesDeMiembro(orgId, userId), [canalA]);

  // Y vaciar la lista devuelve al miembro a «ve todos».
  D.asignarCanalesAMiembro(orgId, userId, []);
  assert.deepEqual(D.canalesDeMiembro(orgId, userId), []);
});

test("listarCanales con restricción solo trae los marcados, de ESA cuenta", () => {
  const { orgId, canalA, canalB } = montar("equipo-listar-canales");

  assert.equal(listarNombres(orgId, null).length, 2, "sin restricción, los dos");
  assert.deepEqual(listarNombres(orgId, [canalA]), ["Número A"]);
  assert.deepEqual(listarNombres(orgId, []), [], "una lista vacía de verdad es «ninguno»");

  function listarNombres(org: number, restringirA: number[] | null) {
    return D.listarCanales(org, restringirA).map((c) => c.nombre);
  }
});

test("listarConversaciones con canalIds respeta el reparto por miembro", () => {
  const { orgId, canalA, canalB } = montar("equipo-listar-conversaciones");
  D.getOrCreateConversation(orgId, canalA, "18095550001", { cuando: D.ahora() });
  D.getOrCreateConversation(orgId, canalB, "18095550002", { cuando: D.ahora() });

  const todas = D.listarConversaciones(orgId, {});
  assert.equal(todas.length, 2);

  const soloA = D.listarConversaciones(orgId, { canalIds: [canalA] });
  assert.equal(soloA.length, 1);
  assert.equal(soloA[0]!.canal_id, canalA);

  assert.deepEqual(D.listarConversaciones(orgId, { canalIds: [] }), []);
});

test("listarAnomalias con restricción: la mayoría no tiene canal_id propio, sale de su conversación", () => {
  const { orgId, canalA, canalB } = montar("equipo-anomalias");
  const { conversacion: convA } = D.getOrCreateConversation(orgId, canalA, "18095550001", { cuando: D.ahora() });
  const { conversacion: convB } = D.getOrCreateConversation(orgId, canalB, "18095550002", { cuando: D.ahora() });

  // Como la crea de verdad `agent.ts`: con conversationId, SIN canalId propio.
  D.crearAnomalia(orgId, { conversationId: convA.id, tipo: "pidio_humano", severidad: "alta", detalle: "de A" });
  D.crearAnomalia(orgId, { conversationId: convB.id, tipo: "pidio_humano", severidad: "alta", detalle: "de B" });

  const todas = D.listarAnomalias(orgId, true, null);
  assert.equal(todas.length, 2, "sin restricción, las dos");

  const soloA = D.listarAnomalias(orgId, true, [canalA]);
  assert.equal(soloA.length, 1, "el JOIN con conversations resuelve el canal aunque canal_id venga vacío");
  assert.equal(soloA[0]!.detalle, "de A");

  assert.deepEqual(D.listarAnomalias(orgId, true, []), [], "una lista vacía de verdad es «ninguna»");
});

test("contarRevisiones con restricción cuenta solo lo de los canales asignados", () => {
  const { orgId, canalA, canalB } = montar("equipo-revisiones");
  const { conversacion: convA } = D.getOrCreateConversation(orgId, canalA, "18095550001", { cuando: D.ahora() });
  const { conversacion: convB } = D.getOrCreateConversation(orgId, canalB, "18095550002", { cuando: D.ahora() });
  D.marcarRevision(orgId, convA.id, "sin decidir A");
  D.marcarRevision(orgId, convB.id, "sin decidir B");

  assert.equal(D.contarRevisiones(orgId), 2);
  assert.equal(D.contarRevisiones(orgId, [canalA]), 1);
  assert.equal(D.contarRevisiones(orgId, []), 0);
});

test("puedeAtenderCanal: null es sin restricción, y una lista solo deja pasar lo que trae", () => {
  const sinRestriccion = { canalesPermitidos: null } as Contexto;
  assert.equal(puedeAtenderCanal(sinRestriccion, 999), true);

  const restringido = { canalesPermitidos: [5, 7] } as Contexto;
  assert.equal(puedeAtenderCanal(restringido, 5), true);
  assert.equal(puedeAtenderCanal(restringido, 6), false);
});
