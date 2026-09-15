import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { problemaDelSecreto } from "../src/lib/secreto";

/**
 * EL CASO DE LA DUEÑA (2026-09-15): la pantalla de registro dijo «no hay
 * conexión con el servidor, revisa tu internet e intenta de nuevo». El internet
 * estaba bien. Lo que pasaba es que el servidor respondía 500 SIN CUERPO —le
 * faltaba SESSION_SECRET y la firma de la cookie reventaba—, leer ese JSON que
 * no llegaba reventaba dentro del mismo `try` que la petición, y el formulario
 * daba el mismo mensaje que si el cable estuviera desenchufado.
 *
 * Peor todavía: la cuenta se creaba ANTES de firmar la sesión, así que quedaba
 * hecha y sin dueña dentro. Al reintentar salía «ese correo ya tiene una
 * cuenta» y entrar tampoco funcionaba, porque el login firma con ese mismo
 * secreto. Tres mensajes distintos, los tres apuntando al sitio equivocado.
 *
 * Esto cubre la pieza que lo permite saber antes de romper nada.
 */

/** Cambia SESSION_SECRET solo mientras corre `f`, y lo deja como estaba. */
function con(valor: string | undefined, f: () => void) {
  const antes = process.env.SESSION_SECRET;
  if (valor === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = valor;
  try {
    f();
  } finally {
    if (antes === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = antes;
  }
}

test("con un secreto en condiciones no hay nada que decir", () => {
  con("x".repeat(32), () => assert.equal(problemaDelSecreto(), null));
  con("clave-de-pruebas-suficientemente-larga-1234567890", () =>
    assert.equal(problemaDelSecreto(), null),
  );
});

test("sin SESSION_SECRET se dice cuál falta, con su nombre", () => {
  con(undefined, () => {
    const problema = problemaDelSecreto();
    assert.ok(problema, "faltando el secreto tiene que haber problema");
    assert.match(problema, /SESSION_SECRET/, "el nombre de la variable es la mitad del arreglo");
  });

  // Vacía es lo mismo que ausente: en los paneles de despliegue se deja así.
  con("", () => assert.ok(problemaDelSecreto()));
});

test("demasiado corto también es estar roto, y se dice cuánto le falta", () => {
  con("corto", () => {
    const problema = problemaDelSecreto();
    assert.ok(problema);
    assert.match(problema, /5 caracteres/, "decir la longitud ahorra contar a mano");
    assert.match(problema, /32/, "y el mínimo, que es lo que hay que alcanzar");
  });

  // Justo por debajo del mínimo: el borde es lo que se equivoca en la práctica.
  con("x".repeat(31), () => assert.ok(problemaDelSecreto(), "31 no llega"));
});

/**
 * El mensaje viaja a /api/salud, que es público a propósito, y al navegador de
 * quien intenta entrar. No puede llevar ni un trozo del secreto.
 */
test("el problema nunca enseña el secreto", () => {
  const valor = "secreto-que-no-puede-salir-de-aqui-jamas";
  con(valor.slice(0, 20), () => {
    const problema = problemaDelSecreto() ?? "";
    assert.equal(problema.includes("secreto-que"), false, "ni un trozo del valor");
    assert.equal(problema.includes(valor.slice(0, 8)), false);
  });
});
