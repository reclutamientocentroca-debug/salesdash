import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { extraerDeHtml, formatearVariantes, urlSegura } from "../src/lib/importar-producto";

/**
 * DE LA PÁGINA DEL PRODUCTO A «VARIANTES».
 *
 * La dueña pega el link de su propia tienda y espera ver, en el mismo campo
 * de siempre, cada color con SUS tallas —no una lista plana que mezcle todo—.
 */
test("un color por línea, con solo sus tallas", () => {
  const texto = formatearVariantes({
    tallas: [],
    colores: [
      { color: "negro", tallas: ["S", "M", "L"] },
      { color: "azul", tallas: ["M", "L", "XL"] },
    ],
  });

  assert.equal(texto, "Negro: S, M, L · Azul: M, L, XL");
});

test("sin colores, se usan las tallas generales", () => {
  const texto = formatearVariantes({ tallas: ["S", "M", "L"], colores: [] });
  assert.equal(texto, "Tallas: S, M, L");
});

test("un color sin tallas propias se enseña solo, sin inventarle ninguna", () => {
  const texto = formatearVariantes({ tallas: [], colores: [{ color: "rojo", tallas: [] }] });
  assert.equal(texto, "Rojo");
});

test("sin nada que decir, no hay texto que pisar lo que ya había", () => {
  assert.equal(formatearVariantes({ tallas: [], colores: [] }), null);
});

/**
 * LO QUE SE LEE DE LA PÁGINA, SIN SALIR A EJECUTAR SU JAVASCRIPT.
 */
test("saca el título, la descripción y la imagen de las etiquetas og:", () => {
  const html = `<!doctype html><html><head>
    <title>Página genérica</title>
    <meta property="og:title" content="Camisa de lino blanca">
    <meta property="og:description" content="Disponible en blanco y azul. Tallas S a XL.">
    <meta property="og:image" content="/img/camisa.jpg">
  </head><body>
    <nav>Inicio · Tienda · Contacto</nav>
    <script>console.log("ruido")</script>
    <main><p>Camisa 100% lino, corte regular.</p></main>
  </body></html>`;

  const r = extraerDeHtml(html);
  assert.equal(r.titulo, "Camisa de lino blanca");
  assert.equal(r.imagenUrl, "/img/camisa.jpg");
  assert.ok(r.texto.includes("Disponible en blanco y azul"));
  assert.ok(r.texto.includes("Camisa 100% lino"));
  assert.ok(!r.texto.includes("Inicio · Tienda · Contacto"), "el menú de navegación no aporta nada");
  assert.ok(!r.texto.includes("ruido"), "el script no es texto de la página");
});

test("sin etiquetas og:, se apoya en <title> y el texto visible", () => {
  const html = `<html><head><title>Pantalón cargo &mdash; Tienda</title></head>
    <body><p>Tallas 30 a 38. Colores: negro y beige.</p></body></html>`;

  const r = extraerDeHtml(html);
  assert.ok(r.titulo?.startsWith("Pantalón cargo"));
  assert.equal(r.imagenUrl, null);
  assert.ok(r.texto.includes("Tallas 30 a 38"));
});

/**
 * EL LINK LO PONE LA DUEÑA, PERO EL SERVIDOR NO SE PUEDE MANDAR A SU PROPIA
 * RED SOLO PORQUE ALGUIEN ESCRIBIÓ ESA URL.
 */
test("un link que no es http/https se rechaza", async () => {
  assert.equal(await urlSegura("ftp://tienda.com/producto"), false);
  assert.equal(await urlSegura("javascript:alert(1)"), false);
  assert.equal(await urlSegura("no es una url"), false);
});

test("localhost y las IPs privadas no se abren", async () => {
  assert.equal(await urlSegura("http://localhost:3000/producto"), false);
  assert.equal(await urlSegura("http://127.0.0.1/producto"), false);
  assert.equal(await urlSegura("http://192.168.1.10/producto"), false);
  assert.equal(await urlSegura("http://10.0.0.5/producto"), false);
});

test("un link con credenciales metidas en la URL se rechaza", async () => {
  assert.equal(await urlSegura("http://usuario:clave@tienda.com/producto"), false);
});
