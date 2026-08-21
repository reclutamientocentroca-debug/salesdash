import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Whapi reemplaza el array de webhooks entero en cada PATCH. La lógica que
 * decide qué conservar es la que evita dos desastres:
 *   - borrarle a alguien el webhook de su automatización en producción
 *   - dejar para siempre una entrada muerta apuntando a un APP_URL viejo
 */

/** Misma regla que usa apuntarWebhook para reconocer los suyos. */
function esNuestro(u: string): boolean {
  try {
    return /^\/api\/webhook\/\d+$/.test(new URL(u).pathname);
  } catch {
    return false;
  }
}

const conservar = (existentes: string[]) => existentes.filter((u) => !esNuestro(u));

test("conserva el webhook de una automatización ajena", () => {
  const make = "https://hook.eu1.make.com/abc123xyz";
  assert.deepEqual(conservar([make]), [make], "el webhook de Make no se puede tocar");
});

test("descarta una entrada nuestra aunque apunte a otro dominio", () => {
  // El caso real: el canal se conectó con APP_URL en localhost.
  const muerta = "http://localhost:3000/api/webhook/1?s=viejo";
  assert.deepEqual(conservar([muerta]), [], "la entrada muerta debe irse");
});

test("con Make y una entrada nuestra vieja, sobrevive solo Make", () => {
  const make = "https://hook.eu1.make.com/abc123xyz";
  const nuestraVieja = "https://dominio-anterior.test/api/webhook/3?s=x";

  assert.deepEqual(conservar([make, nuestraVieja]), [make]);
});

test("una url ilegible se conserva: ante la duda, no se borra lo ajeno", () => {
  assert.deepEqual(conservar(["no-es-una-url"]), ["no-es-una-url"]);
});
