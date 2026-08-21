import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { _limpiarLimites, limitar, olvidarLimite } from "../src/lib/auth";

/**
 * El límite de intentos protege de quien prueba contraseñas a ciegas. Lo que no
 * puede hacer es castigar a quien acierta.
 *
 * Esto se detectó en producción sondeando el login: seis entradas CORRECTAS
 * seguidas y la séptima respondía «Demasiados intentos. Espera unos minutos»,
 * que además de bloquear era falso — no había ningún intento fallido.
 *
 * El síntoma para el usuario es peor de lo que parece: no puede entrar, cree
 * que su cuenta se perdió, y se crea otra. El registro tiene un límite distinto,
 * así que ese camino sí funciona y refuerza la idea equivocada.
 */

const CLAVE = "login-mail:alguien@ejemplo.invalid";
const MAXIMO = 6;
const VENTANA = 900;

test("los intentos fallidos se acumulan y acaban bloqueando", () => {
  _limpiarLimites();

  for (let i = 0; i < MAXIMO; i++) {
    assert.equal(limitar(CLAVE, MAXIMO, VENTANA).ok, true, `el intento ${i + 1} debería pasar`);
  }

  assert.equal(
    limitar(CLAVE, MAXIMO, VENTANA).ok,
    false,
    "pasado el máximo hay que bloquear: esto es lo que para un ataque",
  );
});

test("un acierto devuelve el cupo entero", () => {
  _limpiarLimites();

  // Cinco intentos gastados, uno de ellos el bueno.
  for (let i = 0; i < 5; i++) limitar(CLAVE, MAXIMO, VENTANA);
  olvidarLimite(CLAVE);

  // Tras acertar, se vuelve a empezar: nadie se queda fuera por usar su cuenta.
  for (let i = 0; i < MAXIMO; i++) {
    assert.equal(
      limitar(CLAVE, MAXIMO, VENTANA).ok,
      true,
      `tras un acierto, el intento ${i + 1} tiene que pasar`,
    );
  }
});

test("olvidar un correo no le devuelve el cupo a otro", () => {
  _limpiarLimites();

  const otro = "login-mail:otro@ejemplo.invalid";
  for (let i = 0; i < MAXIMO; i++) limitar(otro, MAXIMO, VENTANA);

  olvidarLimite(CLAVE);

  assert.equal(
    limitar(otro, MAXIMO, VENTANA).ok,
    false,
    "el bloqueo de una cuenta no se levanta porque otra acierte",
  );
});
