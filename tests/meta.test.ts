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
 * CON EL ANUNCIO DELANTE SE VENDE, AUNQUE NO ESTÉ VINCULADO AL CATÁLOGO.
 *
 * Antes aquí se soltaba el lead —«que le atienda alguien del equipo»— para que
 * el agente no se inventara un precio. El efecto era el contrario del buscado:
 * en un negocio que vive de anuncios y no mantiene el catálogo vinculado, eso
 * era TODOS los leads.
 *
 * El anuncio lo escribió y lo pagó el propio negocio. Su precio no es una
 * invención del modelo: es el precio del dueño, y es el que vio el cliente
 * antes de escribir. Vender con eso respeta la regla de «no inventes precios»,
 * porque el precio no sale del modelo.
 */
test("un anuncio sin vincular ya no suelta el lead: vende con lo que el anuncio dice", () => {
  const { orgId } = cuentaConPagina("SinPermiso");

  D.registrarAnuncioVisto(orgId, "ad_suelto", "Nevera", { texto: "Nevera 12 pies a 19,900" });
  D.guardarDescripcionAnuncio(orgId, "ad_suelto", "Una nevera con «19,900» escrito grande");

  const prompt = anuncioParaPrompt(resolverAnuncio(orgId, "ad_suelto", "Nevera"));

  assert.ok(prompt.includes("19,900"), "el agente sabe de qué le hablan y a cuánto");
  assert.ok(prompt.includes("con eso vendes"), "y puede cotizarlo");
  assert.equal(prompt.includes("no sigas vendiendo"), false, "ya no suelta el lead");
  // Lo que sigue en pie: lo que no está en ningún sitio no se promete.
  assert.ok(prompt.includes("no te lo inventes"));
});

/**
 * Pero de un anuncio del que no se guardó NADA no se puede vender: ahí no hay
 * precio de nadie, y sacarse uno sí sería inventarlo. Se pregunta.
 */
test("de un anuncio vacío no se inventa nada: se pregunta qué vio", () => {
  const { orgId } = cuentaConPagina("Vacio");

  const prompt = anuncioParaPrompt(resolverAnuncio(orgId, "ad_mudo", null));

  assert.ok(prompt.includes("qué artículo vio"));
  assert.equal(prompt.includes("con eso vendes"), false);
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

// ── Entrar con Facebook ─────────────────────────────────────────────────────

/**
 * LA MEMORIA CORTA ENTRE ELEGIR Y CONECTAR ES UNA FRONTERA DE CUENTAS.
 *
 * El PUT que conecta una página NO acepta un token: lo saca de esta memoria,
 * buscándolo por el `orgId` de la sesión. Eso es lo que impide que alguien
 * conecte la página de otro mandando un token suyo. Si la memoria se leyera sin
 * mirar la cuenta, esa garantía se cae entera y el `orgId` de la sesión no
 * serviría de nada.
 */
test("las páginas recordadas de una cuenta no se ven desde otra", async () => {
  const { olvidarPaginas, paginaRecordada, recordarPaginas } = await import("../src/lib/meta/login");

  const pagina = {
    pageId: "555000111222333",
    nombre: "Tienda de A",
    igUserId: null,
    token: "token-de-pagina-de-A",
  };

  recordarPaginas(1, [pagina]);

  // La suya, con su token, para que `conectarPagina` pueda usarlo.
  assert.equal(paginaRecordada(1, pagina.pageId)?.token, "token-de-pagina-de-A");

  // La de otra cuenta: nada. Ni sabiendo el identificador de la página.
  assert.equal(paginaRecordada(2, pagina.pageId), null);

  // Una página que esa cuenta no eligió tampoco sale.
  assert.equal(paginaRecordada(1, "999888777666555"), null);

  // Y en cuanto se conecta, el token deja de estar en memoria: un token que no
  // hace falta guardar es un token que no se puede filtrar.
  olvidarPaginas(1);
  assert.equal(paginaRecordada(1, pagina.pageId), null);
});

/**
 * Sin las claves de la app en el servidor no se sale a la red: se dice qué
 * falta. Ese es justo el fallo que deja al dueño mirando una ventana que se
 * cierra sola sin explicar nada.
 */
test("sin META_APP_ID o META_APP_SECRET no se intenta hablar con Meta", async () => {
  const { intercambiarCodigo } = await import("../src/lib/meta/login");

  const antesId = process.env.META_APP_ID;
  const antesSecreto = process.env.META_APP_SECRET;
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;

  await assert.rejects(
    () => intercambiarCodigo("un-codigo-cualquiera-de-la-ventana"),
    /META_APP_ID o META_APP_SECRET/,
  );

  if (antesId !== undefined) process.env.META_APP_ID = antesId;
  if (antesSecreto !== undefined) process.env.META_APP_SECRET = antesSecreto;
});

/**
 * La lista entera de páginas recordadas, que es lo que pide el panel al volver
 * de Facebook. La caducidad importa: un token de página no puede quedarse en la
 * memoria del servidor esperando a que alguien vuelva mañana.
 */
test("las páginas recordadas se devuelven a su cuenta y se olvidan al usarse", async () => {
  const { olvidarPaginas, paginasRecordadas, recordarPaginas } = await import(
    "../src/lib/meta/login"
  );

  assert.deepEqual(paginasRecordadas(77), [], "una cuenta sin nada recordado no recuerda nada");

  recordarPaginas(77, [
    { pageId: "111222333444555", nombre: "Una página", igUserId: null, token: "t1" },
    { pageId: "555444333222111", nombre: "Otra", igUserId: "999", token: "t2" },
  ]);

  assert.equal(paginasRecordadas(77).length, 2);
  assert.deepEqual(paginasRecordadas(78), [], "y no se ven desde otra cuenta");

  olvidarPaginas(77);
  assert.deepEqual(paginasRecordadas(77), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// «Está conectada y no me llega nada»
//
// El peor estado de toda la integración: la página se ve conectada en el panel,
// Meta se ve configurado en el suyo, y no entra un mensaje. Casi siempre es la
// suscripción, que se hace al conectar y puede fallar sin dejar rastro visible.
// `revisarPagina` es lo que lo detecta Y lo repara.
// ─────────────────────────────────────────────────────────────────────────────

/** Contesta a la Graph API con un guion, y apunta a qué rutas se llamó. */
function fingirGraph(guion: (url: string, metodo: string) => { ok: boolean; datos: unknown }) {
  const llamadas: string[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (entrada: unknown, opciones?: { method?: string }) => {
    const url = String(entrada);
    const metodo = opciones?.method ?? "GET";
    llamadas.push(`${metodo} ${url.split("?")[0]!.replace(/^.*\/v[\d.]+\//, "")}`);

    const r = guion(url, metodo);
    return { ok: r.ok, status: r.ok ? 200 : 400, json: async () => r.datos } as Response;
  }) as typeof fetch;

  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

test("una página suscrita a todo pasa la revisión sin tocar nada", async () => {
  const { revisarPagina } = await import("../src/lib/meta/paginas");
  const { orgId, canalId } = cuentaConPagina("Suscrita");
  const canal = D.obtenerCanal(orgId, canalId)!;

  const graph = fingirGraph((url) => {
    if (url.includes("/subscribed_apps")) {
      return {
        ok: true,
        datos: {
          data: [
            {
              subscribed_fields: [
                "messages", "messaging_postbacks", "message_echoes",
                "messaging_referrals", "feed",
              ],
            },
          ],
        },
      };
    }
    return { ok: true, datos: { name: "Página de prueba" } };
  });

  try {
    const r = await revisarPagina(canal);

    assert.equal(r.tokenVale, true);
    assert.equal(r.suscrita, true);
    assert.deepEqual(r.faltan, []);
    assert.equal(r.reparada, false, "no hacía falta reparar nada");
    assert.equal(r.error, null);

    // Lo importante: NO se llamó al POST que suscribe. Volver a suscribir una
    // página que ya lo está es ruido contra Meta en cada comprobación.
    assert.equal(
      graph.llamadas.some((l) => l.startsWith("POST")),
      false,
      "no se toca la suscripción de una página que ya recibe",
    );
  } finally {
    graph.restaurar();
  }
});

/**
 * EL CASO POR EL QUE EXISTE TODO ESTO.
 *
 * La suscripción falló el día que se conectó —le faltaba un permiso al acceso—,
 * el aviso se enseñó una vez y se cerró, y desde entonces la página está en la
 * lista igual que las que funcionan. Comprobar no puede limitarse a decirlo: el
 * dueño no puede suscribir la página desde Meta, porque la app no es suya.
 */
test("una página sin suscribir se repara durante la revisión", async () => {
  const { revisarPagina } = await import("../src/lib/meta/paginas");
  const { orgId, canalId } = cuentaConPagina("SinSuscribir");
  const canal = D.obtenerCanal(orgId, canalId)!;

  let suscrita = false;

  const graph = fingirGraph((url, metodo) => {
    if (url.includes("/subscribed_apps")) {
      if (metodo === "POST") {
        suscrita = true;
        return { ok: true, datos: { success: true } };
      }
      return {
        ok: true,
        datos: suscrita
          ? {
              data: [
                {
                  subscribed_fields: [
                    "messages", "messaging_postbacks", "message_echoes",
                    "messaging_referrals", "feed",
                  ],
                },
              ],
            }
          : { data: [] },
      };
    }
    return { ok: true, datos: { name: "Página de prueba" } };
  });

  try {
    const r = await revisarPagina(canal);

    assert.equal(r.reparada, true);
    assert.equal(r.suscrita, true);
    assert.deepEqual(r.faltan, [], "y se comprueba DESPUÉS de reparar, no se da por hecho");
    assert.equal(r.error, null);
  } finally {
    graph.restaurar();
  }
});

test("con el token caducado se devuelve el texto de Meta y no se suscribe nada", async () => {
  const { revisarPagina } = await import("../src/lib/meta/paginas");
  const { orgId, canalId } = cuentaConPagina("TokenMuerto");
  const canal = D.obtenerCanal(orgId, canalId)!;

  const graph = fingirGraph(() => ({
    ok: false,
    datos: { error: { message: "Error validating access token: Session has expired", code: 190 } },
  }));

  try {
    const r = await revisarPagina(canal);

    assert.equal(r.tokenVale, false);
    assert.equal(r.suscrita, false);
    assert.match(r.error ?? "", /Session has expired/, "el error de Meta se propaga con su texto");

    // Con el token muerto, insistir con la suscripción solo cambia un error
    // claro por otro que apunta al sitio equivocado.
    assert.equal(graph.llamadas.some((l) => l.startsWith("POST")), false);
  } finally {
    graph.restaurar();
  }
});

/**
 * EL ERROR DE META NO PUEDE LLEVAR EL TOKEN DENTRO.
 *
 * Meta contesta «Malformed access token EAAG…» con la credencial escrita en el
 * texto. Ese texto se propaga a propósito hasta el panel —es lo que distingue
 * un token caducado de un permiso que falta— y acabaría pintado en pantalla y
 * en la captura que el dueño manda para pedir ayuda.
 */
test("el token nunca viaja dentro del mensaje de error de Meta", async () => {
  const { revisarPagina } = await import("../src/lib/meta/paginas");

  const TOKEN = "EAAGsecretodepaginaqueNOpuedesalir";
  const { orgId } = D.crearOrgConDueno({
    negocio: "ConToken", color: "#000", nombre: "Dueña",
    email: `token-${Date.now()}@prueba.local`, passwordHash: "x",
  });
  const canalId = D.crearPaginaMeta(orgId, {
    pageId: `66${Date.now()}`, nombre: "Con token",
    tokenCifrado: cifrar(TOKEN), webhookSecret: secretoAleatorio(), igUserId: null,
  });
  const canal = D.obtenerCanal(orgId, canalId)!;

  const graph = fingirGraph(() => ({
    ok: false,
    datos: { error: { message: `Malformed access token ${TOKEN}`, code: 190 } },
  }));

  try {
    const r = await revisarPagina(canal);

    assert.equal(r.tokenVale, false);
    assert.equal(
      (r.error ?? "").includes(TOKEN),
      false,
      `el token salió en el mensaje: ${r.error}`,
    );
    assert.match(r.error ?? "", /Malformed access token/, "pero el motivo de Meta sí se conserva");
  } finally {
    graph.restaurar();
  }
});
