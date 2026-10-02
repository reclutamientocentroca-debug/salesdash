import { test } from "node:test";
import assert from "node:assert/strict";
import { clientePideNumero, normalizarNumeroContacto, textoDeComentario, textoDelNumero } from "../src/lib/numero-contacto";

test("pide el número del negocio", () => {
  for (const t of [
    "Me da el número?", "dame su numero por favor", "cuál es el número de ustedes", "tienen whatsapp?",
    "me pasa un teléfono para llamar", "su número de contacto", "Pásame el whatsapp", "necesito un celular para escribirles",
  ]) assert.equal(clientePideNumero(t), true, t);
});

test("no confunde tallas, cuentas ni el teléfono del propio cliente", () => {
  for (const t of [
    "calzo número 38", "que número de zapato tiene", "el número de cuenta para pagar", "mi número es 8888 7777",
    "mi whatsapp es 506 8888 7777", "88887777", "quiero la talla M", "cuánto cuesta", "número de pedido?",
  ]) assert.equal(clientePideNumero(t), false, t);
});

test("limpia lo que escribe el dueño", () => {
  assert.equal(normalizarNumeroContacto("+506 8888-7777"), "+50688887777");
  assert.equal(normalizarNumeroContacto("123"), null);
  assert.equal(normalizarNumeroContacto(""), null);
  assert.match(textoDelNumero("+50688887777"), /\+506 8888 7777/);
});

/**
 * UN COMENTARIO PÚBLICO SOLO INVITA AL WHATSAPP (la dueña, RD, 2026-10-02,
 * con capturas): no vende, no da precio ni talla, delante de cualquiera que
 * lea la publicación. Y si pregunta dónde está ubicada, esa sí tiene su
 * propia frase fija, dicha tal cual la pidió la dueña.
 */
test("bajo un comentario solo se invita al número, nunca se vende", () => {
  const texto = textoDeComentario("+18095551234", false);
  assert.equal(texto, "Disponible. Para mayor información, WhatsApp +1 809 555 1234.");
  assert.doesNotMatch(texto, /talla|color|direcci[oó]n|precio|RD\$/i);

  const ubicacion = textoDeComentario("+18095551234", true);
  assert.equal(
    ubicacion,
    "Somos tienda virtual, trabajamos con envío a todo el país y paga al momento de recibir. Para mayor información, WhatsApp +1 809 555 1234.",
  );
});
