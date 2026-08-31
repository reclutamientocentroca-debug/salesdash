/**
 * El canal de Meta: firma, traducción del evento y las reglas que no se pueden
 * perder.
 *
 * No llama a la red ni a Meta. Todo lo que se prueba aquí es lo que decide el
 * comportamiento: si un evento es auténtico, de quién es cada mensaje, si el
 * anuncio sobrevive al primer evento y si el agente puede cotizar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import "./entorno";

import * as D from "../src/lib/db";
import { firmaValida, respuestaDeVerificacion } from "../src/lib/meta/firma";
import { destinosDelEvento, normalizarEvento } from "../src/lib/meta/normalize";
import { anuncioParaPrompt, resolverAnuncio } from "../src/lib/meta/contexto-anuncio";
import { ANUNCIO_SIN_DESCRIBIR } from "../src/lib/anuncio";
import { cifrar, secretoAleatorio } from "../src/lib/auth";

const SECRETO = "un-secreto-de-app-de-prueba";
const PAGINA = "102938475601234";
const IG = "178901234567890";
const CLIENTE = "7124556677889900";

function firmar(cuerpo: string, secreto = SECRETO): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// La firma: lo único que separa un mensaje real de uno inventado
// ─────────────────────────────────────────────────────────────────────────────

test("la firma cuadra sobre el cuerpo crudo y falla si se toca un byte", () => {
  const cuerpo = JSON.stringify({ object: "page", entry: [{ id: PAGINA }] });

  assert.equal(firmaValida(cuerpo, firmar(cuerpo), SECRETO), true);

  // Un byte distinto en el cuerpo invalida la firma.
  assert.equal(firmaValida(cuerpo + " ", firmar(cuerpo), SECRETO), false);

  // Otro secreto, aunque el cuerpo sea el mismo.
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, "otro-secreto"), SECRETO), false);
});

test("reserializar el JSON rompe la firma: por eso se firma el crudo", () => {
  /*
   * Esta prueba fija el error más caro de la integración. Meta manda el cuerpo
   * con SUS espacios y SU orden de claves; si la ruta hiciera `JSON.parse` y
   * volviera a serializar para firmar, saldría otro texto y la firma no
   * cuadraría nunca aunque el secreto fuera correcto.
   */
  const crudo = '{"object":"page",  "entry":[{"id":"1"}]}';
  const reserializado = JSON.stringify(JSON.parse(crudo));

  assert.notEqual(crudo, reserializado, "el ejemplo tiene que diferir de verdad");
  assert.equal(firmaValida(crudo, firmar(crudo), SECRETO), true);
  assert.equal(firmaValida(reserializado, firmar(crudo), SECRETO), false);
});

test("sin cabecera, con formato raro o sin secreto, no pasa nada", () => {
  const cuerpo = "{}";
  assert.equal(firmaValida(cuerpo, null, SECRETO), false);
  assert.equal(firmaValida(cuerpo, "sha1=abc", SECRETO), false);
  assert.equal(firmaValida(cuerpo, firmar(cuerpo), ""), false);
  assert.equal(firmaValida(cuerpo, "sha256=", SECRETO), false);
});

test("la verificación de alta devuelve el challenge solo con el token bueno", () => {
  const p = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": "el-token-bueno",
    "hub.challenge": "1158201444",
  });

  assert.equal(respuestaDeVerificacion(p, "el-token-bueno"), "1158201444");
  assert.equal(respuestaDeVerificacion(p, "otro"), null);
  assert.equal(respuestaDeVerificacion(p, ""), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// La traducción del evento
// ─────────────────────────────────────────────────────────────────────────────

const eventoMensaje = (extra: Record<string, unknown> = {}) => ({
  object: "page",
  entry: [
    {
      id: PAGINA,
      messaging: [
        {
          sender: { id: CLIENTE },
          recipient: { id: PAGINA },
          timestamp: 1_756_200_000_000,
          message: { mid: "m_abc123", text: "hola, ¿cuánto cuesta?" },
          ...extra,
        },
      ],
    },
  ],
});

test("un mensaje entrante sale con su id, su cliente y en segundos", () => {
  const [m] = normalizarEvento(eventoMensaje(), PAGINA);

  assert.ok(m);
  assert.equal(m.id, "m_abc123");
  assert.equal(m.deMi, false);
  assert.equal(m.chatId, CLIENTE);
  assert.equal(m.content, "hola, ¿cuánto cuesta?");
  assert.equal(m.superficie, "messenger");

  // Meta manda milisegundos y la base guarda segundos. Sin dividir, el hilo se
  // archivaría en el año 57000 y no aparecería en ningún rango del panel.
  assert.equal(m.cuando, 1_756_200_000);
});

test("el eco del vendedor es nuestro y conserva el MISMO id", () => {
  /*
   * LA IDEMPOTENCIA DEL HILO.
   *
   * Cuando el vendedor responde desde la bandeja, Meta manda además un
   * message_echoes con el mismo `mid`. Ese id va al campo UNIQUE de `messages`,
   * así que la segunda inserción no hace nada. Si el eco trajera otro id, cada
   * respuesta saldría dos veces en el hilo.
   */
  const evento = {
    object: "page",
    entry: [
      {
        id: PAGINA,
        messaging: [
          {
            sender: { id: PAGINA },
            recipient: { id: CLIENTE },
            timestamp: 1_756_200_001_000,
            message: { mid: "m_abc123", text: "cuesta 1850", is_echo: true },
          },
        ],
      },
    ],
  };

  const [m] = normalizarEvento(evento, PAGINA);

  assert.ok(m);
  assert.equal(m.deMi, true, "el eco es nuestro, no del cliente");
  assert.equal(m.chatId, CLIENTE, "el cliente sigue siendo el otro lado");
  assert.equal(m.id, "m_abc123", "el id no cambia: es lo que evita el duplicado");
});

test("un mensaje sin id de Meta no se guarda", () => {
  // Sin `mid` no hay idempotencia posible: es preferible perder un mensaje a
  // duplicar el hilo cada vez que Meta reintente.
  const evento = eventoMensaje();
  delete (evento.entry[0].messaging[0].message as Record<string, unknown>).mid;
  assert.equal(normalizarEvento(evento, PAGINA).length, 0);
});

test("el referral del anuncio se saca del primer evento", () => {
  const [m] = normalizarEvento(
    eventoMensaje({
      referral: { ad_id: "23851234567890", source: "ADS", ad_title: "Camisa manga larga" },
    }),
    PAGINA,
  );

  assert.ok(m);
  assert.equal(m.deAnuncio, true);
  assert.equal(m.metaAdId, "23851234567890");
  assert.equal(m.productoAnuncio, "Camisa manga larga");
});

test("un mensaje directo de Instagram se distingue del de Messenger", () => {
  const evento = { ...eventoMensaje(), object: "instagram" };
  const [m] = normalizarEvento(evento, PAGINA);

  assert.ok(m);
  assert.equal(m.superficie, "instagram");
});

test("un comentario entra como conversación, con su id para responderlo", () => {
  const evento = {
    object: "page",
    entry: [
      {
        id: PAGINA,
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: "c_998877",
              post_id: "p_112233",
              created_time: 1_756_200_500,
              from: { id: CLIENTE, name: "María Pérez" },
              message: "¿hacen envíos?",
            },
          },
        ],
      },
    ],
  };

  const [m] = normalizarEvento(evento, PAGINA);

  assert.ok(m);
  assert.equal(m.superficie, "comentario");
  assert.equal(m.id, "c_998877");
  assert.equal(m.comentarioId, "c_998877");
  assert.equal(m.nombre, "María Pérez");
  assert.equal(m.deAnuncio, true, "un comentario bajo una publicación es un lead");
});

test("los comentarios editados y borrados no abren conversación", () => {
  for (const verb of ["edited", "remove"]) {
    const evento = {
      object: "page",
      entry: [
        {
          id: PAGINA,
          changes: [
            {
              field: "feed",
              value: {
                item: "comment", verb, comment_id: "c_1", post_id: "p_1",
                from: { id: CLIENTE }, message: "algo",
              },
            },
          ],
        },
      ],
    };
    assert.equal(normalizarEvento(evento, PAGINA).length, 0, verb);
  }
});

test("el destino sale de la página y también de la cuenta de Instagram", () => {
  assert.deepEqual(destinosDelEvento(eventoMensaje()), [PAGINA]);

  const deIg = {
    object: "instagram",
    entry: [
      {
        id: IG,
        messaging: [
          {
            sender: { id: CLIENTE }, recipient: { id: IG },
            timestamp: 1, message: { mid: "m_ig", text: "hola" },
          },
        ],
      },
    ],
  };
  assert.deepEqual(destinosDelEvento(deIg), [IG]);
});

// ─────────────────────────────────────────────────────────────────────────────
// La regla del precio y el aislamiento
// ─────────────────────────────────────────────────────────────────────────────

function cuentaConPagina(nombre: string) {
  const { orgId } = D.crearOrgConDueno({
    negocio: nombre,
    color: "#12876a",
    nombre: "Dueña",
    email: `${nombre}-${Date.now()}-${Math.random()}@prueba.local`,
    passwordHash: "x",
  });

  const canalId = D.crearPaginaMeta(orgId, {
    pageId: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    nombre: `Página de ${nombre}`,
    tokenCifrado: cifrar("EAAG-token-de-prueba"),
    webhookSecret: secretoAleatorio(),
    igUserId: null,
  });

  return { orgId, canalId };
}

test("un anuncio sin producto NO deja cotizar, y queda para vincular", () => {
  const { orgId } = cuentaConPagina("SinVincular");

  const c = resolverAnuncio(orgId, "ad_sin_vincular", "Camisa del anuncio");

  assert.equal(c.puedeCotizar, false);
  assert.equal(c.motivo, "sin_vincular");

  /*
   * Y queda registrado. El ad_id llega SOLO en el primer evento del hilo: si no
   * se guardara en ese instante, el dueño tendría que adivinar el
   * identificador de un anuncio que ya pasó para poder vincularlo.
   */
  const lista = D.listarAnunciosMeta(orgId);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]!.ad_id, "ad_sin_vincular");
  assert.equal(lista[0]!.producto_id, null);
});

test("vinculado a un producto con precio, sí cotiza y el precio es el del catálogo", () => {
  const { orgId } = cuentaConPagina("Vinculado");
  const productoId = D.crearProducto(orgId, {
    nombre: "Camisa manga larga", variantes: "S, M, L", precio: 1850,
  });

  resolverAnuncio(orgId, "ad_bueno", null);
  D.vincularAnuncioAProducto(orgId, "ad_bueno", productoId);

  const c = resolverAnuncio(orgId, "ad_bueno", null);

  assert.equal(c.puedeCotizar, true);
  assert.equal(c.motivo, "vinculado");
  assert.equal(c.producto?.precio, 1850, "el precio sale del catálogo, no del anuncio");
});

test("un producto sin precio tampoco deja cotizar", () => {
  // El caso traicionero: el producto está bien vinculado y el agente creería
  // que puede hablar de dinero. No hay dinero que decir.
  const { orgId } = cuentaConPagina("SinPrecio");
  const productoId = D.crearProducto(orgId, { nombre: "Vestido", variantes: null, precio: null });

  resolverAnuncio(orgId, "ad_sin_precio", null);
  D.vincularAnuncioAProducto(orgId, "ad_sin_precio", productoId);

  const c = resolverAnuncio(orgId, "ad_sin_precio", null);
  assert.equal(c.puedeCotizar, false);
  assert.equal(c.motivo, "sin_precio");
});

test("los anuncios de una cuenta no se ven desde otra", () => {
  const a = cuentaConPagina("MetaAlfa");
  const b = cuentaConPagina("MetaBeta");

  resolverAnuncio(a.orgId, "ad_de_alfa", "Solo de Alfa");

  assert.equal(D.listarAnunciosMeta(b.orgId).length, 0);
  assert.equal(D.anuncioMetaPorAdId(b.orgId, "ad_de_alfa"), undefined);
  assert.equal(D.anuncioMetaPorAdId(a.orgId, "ad_de_alfa")?.titulo, "Solo de Alfa");
});

test("la página se resuelve por su id y por el de su Instagram", () => {
  const { orgId } = cuentaConPagina("ConInstagram");
  const pageId = `77${Date.now()}`;
  const igId = `88${Date.now()}`;

  D.crearPaginaMeta(orgId, {
    pageId, nombre: "Tienda con IG",
    tokenCifrado: cifrar("t"), webhookSecret: secretoAleatorio(), igUserId: igId,
  });

  assert.equal(D.canalMetaPorDestino(pageId)?.org_id, orgId);
  assert.equal(D.canalMetaPorDestino(igId)?.org_id, orgId, "el DM de Instagram llega con el id de IG");
  assert.equal(D.canalMetaPorDestino("000000000"), undefined);
});

/**
 * LO QUE VIO EL CLIENTE EN EL ANUNCIO TIENE QUE LLEGARLE AL AGENTE.
 *
 * El texto del anuncio y lo que se lee en su imagen se guardaban desde hacía
 * tiempo y no los leía nadie: el agente sabía el TÍTULO y nada más. En la
 * publicidad de Facebook el precio, los colores y las tallas van escritos
 * ENCIMA de la foto la mitad de las veces, así que a un «quiero la del anuncio,
 * la azul» el agente contestaba preguntando de qué producto se trataba.
 */
test("lo que decía el anuncio —su texto y su imagen— llega al prompt", () => {
  const { orgId } = cuentaConPagina("LoQueVio");

  D.registrarAnuncioVisto(orgId, "ad_visto", "Camisa de lino", {
    texto: "Camisas de lino, envío a todo el país",
    imagen: null,
  });
  D.guardarDescripcionAnuncio(orgId, "ad_visto", "Se ven camisas azul y beige con «1,850» escrito encima");

  const prompt = anuncioParaPrompt(resolverAnuncio(orgId, "ad_visto", "Camisa de lino"));

  assert.ok(prompt.includes("LO QUE VIO EL CLIENTE") || prompt.includes("VIO EL CLIENTE"));
  assert.ok(prompt.includes("Camisas de lino, envío a todo el país"), "el texto del anuncio");
  assert.ok(prompt.includes("«1,850» escrito encima"), "y lo que se lee en su imagen");
});

/**
 * Pero saber lo que decía el anuncio NO es permiso para cotizarlo. Un precio
 * escrito sobre una imagen no es el catálogo: si no está vinculado, el agente
 * puede hablar del artículo y no puede ponerle precio.
 */
test("el precio escrito en el anuncio no autoriza a cotizar", () => {
  const { orgId } = cuentaConPagina("SinPermiso");

  D.registrarAnuncioVisto(orgId, "ad_suelto", "Nevera", { texto: "Nevera 12 pies a 19,900" });
  D.guardarDescripcionAnuncio(orgId, "ad_suelto", "Una nevera con «19,900» escrito grande");

  const prompt = anuncioParaPrompt(resolverAnuncio(orgId, "ad_suelto", "Nevera"));

  assert.ok(prompt.includes("19,900"), "el agente sabe de qué le hablan");
  assert.ok(
    prompt.includes("ni siquiera los que estén escritos ahí arriba"),
    "y tiene prohibido confirmarlo",
  );
  assert.ok(prompt.includes("no sigas vendiendo"));
});

/**
 * La marca de «no se pudo mirar» no es una descripción. Sin este filtro el
 * agente le contaría al cliente que en la foto del anuncio se ve
 * «[anuncio sin describir]».
 */
test("un anuncio que no se pudo mirar no ensucia el prompt", () => {
  const { orgId } = cuentaConPagina("SinMirar");

  D.registrarAnuncioVisto(orgId, "ad_ciego", "Algo", {});
  D.guardarDescripcionAnuncio(orgId, "ad_ciego", ANUNCIO_SIN_DESCRIBIR);

  const prompt = anuncioParaPrompt(resolverAnuncio(orgId, "ad_ciego", "Algo"));
  assert.equal(prompt.includes("sin describir"), false);
});

/**
 * LA AVERÍA QUE DEJÓ AL AGENTE MUDO, FIJADA AQUÍ PARA QUE NO VUELVA.
 *
 * `describirAnunciosPendientes` corre ANTES de que el agente conteste, con un
 * cliente esperando. Cuando fallaba dejaba la descripción en NULL «para
 * reintentarlo con el próximo lead», y esta consulta devolvía el MISMO anuncio
 * fallido una y otra vez: con la visión caída, cada mensaje de cada cliente de
 * la cuenta se quedaba esperando el minuto entero de esa llamada, tres veces
 * seguidas. El agente parecía muerto cuando lo que estaba era haciendo cola.
 *
 * La regla: un anuncio intentado NO vuelve a la cola, salga bien o salga mal.
 */
test("un anuncio ya intentado sale de la cola, aunque no se pudiera describir", async () => {
  const { orgId } = cuentaConPagina("Cola");

  D.registrarAnuncioVisto(orgId, "ad_cola", "Algo", { imagen: "local:999/no-existe.jpg" });
  assert.equal(D.anunciosPorDescribir(orgId).length, 1, "entra en la cola");

  const { describirAnunciosPendientes } = await import("../src/lib/analyzer");

  // El archivo no existe, así que no hay imagen que mirar: es el camino de
  // fallo, y no toca la red.
  await describirAnunciosPendientes(orgId, 1);

  assert.equal(
    D.anunciosPorDescribir(orgId).length,
    0,
    "y NO vuelve: si volviera, cada mensaje del cliente pagaría el intento otra vez",
  );

  // Y lo que quedó escrito no se le cuenta al modelo.
  const prompt = anuncioParaPrompt(resolverAnuncio(orgId, "ad_cola", "Algo"));
  assert.equal(prompt.includes("sin describir"), false);
});
