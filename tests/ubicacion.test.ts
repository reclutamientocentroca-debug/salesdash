import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARCA_UBICACION,
  enlaceDeMapa,
  esUbicacion,
  textoDeUbicacion,
  textoSinMarca,
} from "../src/lib/ubicacion";

/**
 * La ubicación que manda el cliente ES la dirección de entrega. Antes entraba
 * al hilo como «[locationMessage]»: un agujero justo donde está el dato que
 * necesita quien despacha el pedido.
 */

test("la ubicación se guarda con su sitio y su dirección legibles", () => {
  assert.equal(
    textoDeUbicacion({ nombre: "Casa", direccion: "Calle Duarte, Panamá" }),
    `${MARCA_UBICACION} Casa · Calle Duarte, Panamá`,
  );

  // Sin nada que decir, la marca sola: el hilo tiene que enseñar que mandó una
  // ubicación aunque WhatsApp no mande ni nombre ni dirección.
  assert.equal(textoDeUbicacion({}), MARCA_UBICACION);

  // El nombre a veces ES la dirección: no se repite.
  assert.equal(
    textoDeUbicacion({ nombre: "Calle Duarte", direccion: "Calle Duarte" }),
    `${MARCA_UBICACION} Calle Duarte`,
  );

  assert.equal(textoDeUbicacion({ nombre: "Casa", enVivo: true }).includes("en vivo"), true);
});

test("el enlace al mapa sale de las coordenadas, y solo si sirven", () => {
  assert.equal(enlaceDeMapa(8.9824, -79.5199), "https://www.google.com/maps?q=8.9824,-79.5199");

  // (0,0) está en el Atlántico: es lo que queda cuando el mensaje vino sin
  // coordenadas. Un enlace a mitad del océano es peor que ninguno, porque el
  // que despacha se fía de él.
  assert.equal(enlaceDeMapa(0, 0), null);
  assert.equal(enlaceDeMapa(91, 10), null, "fuera del planeta");
  assert.equal(enlaceDeMapa(10, 181), null);
  assert.equal(enlaceDeMapa(null, undefined), null);
  assert.equal(enlaceDeMapa("8.98", "-79.5"), null, "texto no son coordenadas");
});

test("el hilo reconoce una ubicación y la enseña sin la marca", () => {
  const texto = textoDeUbicacion({ nombre: "Casa", direccion: "Calle Duarte" });

  assert.equal(esUbicacion(texto), true);
  assert.equal(esUbicacion("[imagen]"), false);
  assert.equal(esUbicacion("hola, te mando la ubicación"), false, "hablar de ella no es mandarla");
  assert.equal(esUbicacion(null), false);

  assert.equal(textoSinMarca(texto), "Casa · Calle Duarte");
  assert.equal(
    textoSinMarca(MARCA_UBICACION),
    "Ubicación enviada por el cliente",
    "sin datos, algo que leer igual",
  );
});
