import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MARCA_ENLACE, llevaEnlace, textoConEnlace, tieneFicha, sinFichaDelAnuncio } from "../src/lib/enlace";
import { descripcionUtil, ANUNCIO_SIN_DESCRIBIR } from "../src/lib/anuncio";

/**
 * UN ENLACE PELADO NO LE DICE NADA A NADIE.
 *
 * El cliente comparte el artículo del catálogo o de Instagram en vez de
 * escribir su nombre —es la forma más común de decir «quiero este»— y al agente
 * le llegaba solo la URL. Contestaba lo único que se puede contestar sin saber
 * nada: «¿de qué producto me hablas?», a alguien que acababa de mandárselo.
 */

test("el enlace llega con el título y la descripción de la página", () => {
  const texto = textoConEnlace("mira, quiero esta", {
    titulo: "Camisa de lino blanca",
    descripcion: "Camisa 100% lino, tallas S a XL. RD$1,850",
    url: "https://tienda.do/p/8834",
  });

  assert.ok(texto.includes("mira, quiero esta"), "lo que escribió el cliente va primero y entero");
  assert.ok(texto.includes(MARCA_ENLACE));
  assert.ok(texto.includes("Camisa de lino blanca"));
  assert.ok(texto.includes("RD$1,850"), "el precio de la ficha llega al hilo");
  assert.ok(llevaEnlace(texto));
});

test("si solo mandó el enlace, la ficha es el mensaje", () => {
  const texto = textoConEnlace("https://tienda.do/p/8834", {
    titulo: "Pantalón cargo negro",
    descripcion: "Talla 30 a 38",
  });

  assert.ok(texto.includes("Pantalón cargo negro"));
  assert.ok(texto.startsWith("https://tienda.do/p/8834"), "la URL sigue siendo el mensaje");
});

test("un enlace sin ficha se queda como estaba", () => {
  // La URL ya está en el texto: repetirla no aporta y gasta prompt.
  assert.equal(textoConEnlace("https://x.com/algo", {}), "https://x.com/algo");
  assert.equal(textoConEnlace("https://x.com/algo", null), "https://x.com/algo");
  assert.equal(textoConEnlace("hola", { titulo: "   " }), "hola");
  assert.equal(tieneFicha({ titulo: null, descripcion: null }), false);
  assert.equal(llevaEnlace("hola qué tal"), false);
});

test("la descripción que solo repite el título no se enseña dos veces", () => {
  const texto = textoConEnlace("", { titulo: "Camisa de lino", descripcion: "Camisa de lino" });
  assert.equal(texto, `${MARCA_ENLACE} Camisa de lino`);
});

test("una ficha larguísima se recorta, no se cuela entera en el prompt", () => {
  const texto = textoConEnlace("", { titulo: "T", descripcion: "x".repeat(900) });
  assert.ok(texto.length < 400, `se fue a ${texto.length} caracteres`);
  assert.ok(texto.endsWith("…"));
});

/**
 * La marca del anuncio que no se pudo mirar NO es una descripción: existe solo
 * para que el intento no se repita en cada mensaje que entra. Quien la lea, la
 * descarta — si no, el agente le contaría al cliente que en la foto se ve
 * «[anuncio sin describir]».
 */
test("la marca de anuncio sin describir nunca se le cuenta al modelo", () => {
  assert.equal(descripcionUtil(ANUNCIO_SIN_DESCRIBIR), null);
  assert.equal(descripcionUtil("  "), null);
  assert.equal(descripcionUtil(null), null);
  assert.equal(descripcionUtil("Camisa azul con el precio 1850 escrito encima"),
    "Camisa azul con el precio 1850 escrito encima");
});

/**
 * EL ANUNCIO SE VE ARRIBA, NO DENTRO DEL MENSAJE. Un clic en un anuncio
 * dejaba pegada la ficha del anuncio dentro del «Hola» del cliente; el
 * anuncio ya está en la cabecera del hilo y verlo dos veces confunde.
 */
test("la ficha del anuncio de la conversación se quita del mensaje, y un enlace de verdad se queda", () => {
  const anuncio = {
    producto_anuncio: "Rincondcm",
    descripcion_anuncio: "👞 ZAPATOS DCM ESTILO Elegancia que deja huella. Un diseño clásico y sofisticado. RD$1,990",
  };
  const pegado =
    "Hola\n[enlace] Rincondcm · 👞 ZAPATOS DCM ESTILO Elegancia que deja huella. Un diseño clásico y sofisticado. RD$1,990";
  assert.equal(sinFichaDelAnuncio(pegado, anuncio), "Hola");
  // Solo la ficha, sin texto del cliente: queda vacío y el hilo lo dice.
  assert.equal(sinFichaDelAnuncio("[enlace] Rincondcm · 👞 ZAPATOS DCM ESTILO Elegancia que deja huella.", anuncio), "");
  // Un enlace que el cliente sí compartió, de otra cosa, se queda.
  const otro = "mira este\n[enlace] Mocasines de cuero · RD$2,500";
  assert.equal(sinFichaDelAnuncio(otro, anuncio), otro);
  // Sin anuncio en la conversación no se toca nada.
  assert.equal(sinFichaDelAnuncio(pegado, null), pegado);
});
