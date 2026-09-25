import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/lib/db";
import { combinarVariantes, extraerDeHtml, formatearVariantes, urlSegura } from "../src/lib/importar-producto";

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

/**
 * VARIOS LINKS, UN SOLO PRODUCTO.
 *
 * En Roplis, a veces cada color de un mismo artículo es una ficha separada
 * (un link distinto), no botones dentro de una sola página. El catálogo
 * necesita verlos como un único producto con todos sus colores.
 */
test("combina los colores de varios links sin repetirlos", () => {
  const combinado = combinarVariantes([
    { tallas: [], colores: [{ color: "Azul", tallas: ["S", "M"] }] },
    { tallas: [], colores: [{ color: "Negro", tallas: ["M", "L"] }] },
  ]);

  assert.deepEqual(
    combinado.colores.sort((a, b) => a.color.localeCompare(b.color)),
    [
      { color: "Azul", tallas: ["S", "M"] },
      { color: "Negro", tallas: ["M", "L"] },
    ],
  );
});

/**
 * LA MEMORIA: un link ya importado no se vuelve a tocar.
 *
 * Es lo que mira `resolverAnuncio` (contexto-anuncio.ts) antes de salir a
 * Roplis cuando llega un lead por un anuncio, para no repetir el proceso.
 */
test("un producto solo tiene links pendientes cuando de verdad hay uno sin importar", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "PruebaLinks", color: "#123456", nombre: "Dueña",
    email: `links-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const productoId = D.crearProducto(orgId, { nombre: "Poloshirt", variantes: null, precio: 2490 });

  assert.equal(D.productoConLinksPendientes(orgId, productoId), false, "sin ningún link, no hay nada pendiente");

  const linkId = D.agregarLinkProducto(orgId, productoId, "https://do.roplis.com/producto-de-prueba");
  assert.equal(D.productoConLinksPendientes(orgId, productoId), true, "recién agregado, está pendiente");

  D.marcarLinkImportado(orgId, linkId, {
    datos: JSON.stringify({ tallas: [], colores: [] }),
    fotoUrl: null,
    descripcion: null,
    error: null,
  });
  assert.equal(D.productoConLinksPendientes(orgId, productoId), false, "ya importado, deja de estar pendiente");
});

test("el mismo color repetido en dos links junta sus tallas sin duplicar", () => {
  const combinado = combinarVariantes([
    { tallas: [], colores: [{ color: "Azul", tallas: ["S", "M"] }] },
    { tallas: [], colores: [{ color: "Azul", tallas: ["M", "L"] }] },
  ]);

  assert.equal(combinado.colores.length, 1);
  assert.deepEqual(combinado.colores[0]!.tallas.sort(), ["L", "M", "S"]);
});

/**
 * BORRAR UN PRODUCTO NO PUEDE QUEDARSE A MEDIAS por una clave foránea.
 *
 * La dueña (2026-09-24): «quiero quitar algunas y no me deja». Un producto
 * con un link guardado —o con un anuncio de Meta vinculado— chocaba con
 * `FOREIGN KEY constraint failed` al borrarlo, y el botón «Quitar» del panel
 * se quedaba sin efecto, sin decir por qué.
 */
test("un producto con link y con anuncio vinculado se puede quitar sin romper nada", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "PruebaBorrado", color: "#123456", nombre: "Dueña",
    email: `borrado-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const productoId = D.crearProducto(orgId, { nombre: "Chacabana", variantes: null, precio: 1790 });
  D.agregarLinkProducto(orgId, productoId, "https://do.roplis.com/1577/chacabana-manga-larga-do");

  D.registrarAnuncioVisto(orgId, "ad-1", "Chacabana en oferta");
  D.vincularAnuncioAProducto(orgId, "ad-1", productoId);

  assert.doesNotThrow(() => D.eliminarProducto(orgId, productoId));
  assert.equal(D.productoPorId(orgId, productoId), undefined, "el producto ya no está");

  const anuncio = D.anuncioMetaPorAdId(orgId, "ad-1");
  assert.equal(anuncio?.producto_id ?? null, null, "el anuncio se desvincula, no se borra");
});

/**
 * DE QUÉ NÚMERO ES, sin preguntar, cuando se puede saber solo.
 *
 * Roplis separa sus tiendas por país en el subdominio del link —el mismo
 * código de dos letras que ya usa `agentes.pais`—. La dueña (2026-09-24):
 * «quiero que la selección de número sea por IA a qué pertenezca».
 */
test("el producto se asigna al número del país del link, cuando hay un único número de ese país", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "PruebaPaises", color: "#123456", nombre: "Dueña",
    email: `paises-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalDo = D.crearCanal(orgId, {
    nombre: "RD", phone: "18095550001", tokenCifrado: "x", webhookSecret: "x", whapiChannelId: null,
  });
  D.actualizarAgente(orgId, { pais: "do" }, canalDo);
  const canalCr = D.crearCanal(orgId, {
    nombre: "CR", phone: "50685550002", tokenCifrado: "x", webhookSecret: "x", whapiChannelId: null,
  });
  D.actualizarAgente(orgId, { pais: "cr" }, canalCr);

  assert.equal(D.canalPorPaisDeLink(orgId, "https://do.roplis.com/1577/chacabana"), canalDo);
  assert.equal(D.canalPorPaisDeLink(orgId, "https://cr.roplis.com/algo"), canalCr);
  assert.equal(D.canalPorPaisDeLink(orgId, "https://pa.roplis.com/algo"), null, "ningún número de Panamá");
  assert.equal(D.canalPorPaisDeLink(orgId, "https://otra-tienda.com/algo"), null, "sin país en el link");

  const otroCanalDo = D.crearCanal(orgId, {
    nombre: "RD 2", phone: "18095550003", tokenCifrado: "x", webhookSecret: "x", whapiChannelId: null,
  });
  D.actualizarAgente(orgId, { pais: "do" }, otroCanalDo);
  assert.equal(
    D.canalPorPaisDeLink(orgId, "https://do.roplis.com/1577/chacabana"), null,
    "con dos números del mismo país no hay uno solo que adivinar",
  );
});

/**
 * EL LOOKUP NO CREA AGENTES DE PASO.
 *
 * `canalPorPaisDeLink` mira el país de cada canal con `obtenerAgente`, y esa
 * función, si el canal no tiene fila de agente todavía, la crea sola —copia
 * la plantilla y adivina el país por el prefijo del teléfono—. Un canal recién
 * conectado que nadie ha abierto en «Configurar agente» no debería nacer con
 * su país adivinado solo porque, en OTRO canal de la misma cuenta, alguien
 * importó un producto por link.
 */
test("canalPorPaisDeLink no crea el agente de un canal que todavía no tiene uno", () => {
  const { orgId } = D.crearOrgConDueno({
    negocio: "PruebaSinCrear", color: "#123456", nombre: "Dueña",
    email: `sin-crear-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalCr = D.crearCanal(orgId, {
    nombre: "CR", phone: "50685550002", tokenCifrado: "x", webhookSecret: "x", whapiChannelId: null,
  });
  D.actualizarAgente(orgId, { pais: "cr" }, canalCr);

  // Recién conectado, sin abrir «Configurar agente»: no tiene fila en `agentes`.
  const canalNuevo = D.crearCanal(orgId, {
    nombre: "RD nuevo", phone: "18095550099", tokenCifrado: "x", webhookSecret: "x", whapiChannelId: null,
  });

  D.canalPorPaisDeLink(orgId, "https://do.roplis.com/1577/chacabana");

  const yaTieneFila = D.listarAgentes(orgId).some((a) => a.canal_id === canalNuevo);
  assert.equal(yaTieneFila, false, "el lookup no debe crear la fila del agente de un canal sin configurar");
});
