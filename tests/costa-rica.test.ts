import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as D from "../src/lib/db";
import { armarSistema, generarRespuesta } from "../src/lib/agent";
import { agenteDePais } from "../src/agents";
import { respuestaMinima } from "../src/lib/apertura";
import { revisarConReglas, type ContextoRevision } from "../src/lib/revisor";
import { bloqueDelPais } from "../src/agents";

/**
 * COSTA RICA VA SOLA. ESTE ARCHIVO ES EL CANDADO.
 *
 * La dueña (2026-09-08): «que las instrucciones y la forma de responder se
 * queden como están, pero separada; como está respondiendo está bien».
 *
 * Costa Rica no vive en un solo archivo: su guion sí es suyo, pero la apertura,
 * el revisor y la ficha los comparte con República Dominicana y Panamá. Mover
 * todo eso a un módulo aparte es un refactor grande, y un refactor grande es
 * justo la forma más fácil de cambiarle sin querer la manera de responder.
 *
 * Así que en vez de moverla, se CONGELA: aquí queda grabado, palabra por
 * palabra, lo que Costa Rica dice hoy —su prompt entero, sus respuestas
 * mecánicas y lo que su revisor para—. Cualquier cambio que la mueva, venga del
 * archivo que venga, rompe estas pruebas y hay que mirarlo a la cara.
 *
 * SI EL CAMBIO ES A PROPÓSITO —porque la dueña pidió algo para Costa Rica—, se
 * vuelve a grabar con:
 *
 *     FIJAR_CR=1 npm test
 *
 * y se revisa el diff del archivo de `tests/fijado/` en el commit. Lo que no
 * puede pasar es que se mueva sola, de rebote, arreglando otro país.
 */

/** Vuelve a grabar los fijados en vez de compararlos. Solo a propósito. */
const REGRABAR = process.env.FIJAR_CR === "1";

function fijado(nombre: string, actual: string): void {
  const ruta = join(__dirname, "fijado", nombre);

  if (REGRABAR || !existsSync(ruta)) {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, actual);
    if (!REGRABAR) console.log(`[costa-rica] grabado por primera vez: ${nombre}`);
    return;
  }

  const guardado = readFileSync(ruta, "utf8");
  if (guardado === actual) return;

  // El primer renglón que baila, que es lo que se quiere ver.
  const a = guardado.split("\n");
  const b = actual.split("\n");
  const i = a.findIndex((l, n) => l !== b[n]);

  assert.fail(
    `COSTA RICA CAMBIÓ y va sola: ${nombre}\n` +
      `Primera línea distinta (${i + 1}):\n` +
      `  antes: ${JSON.stringify(a[i] ?? "(no estaba)")}\n` +
      `  ahora: ${JSON.stringify(b[i] ?? "(ya no está)")}\n` +
      "Si es a propósito, vuelve a grabarlo con FIJAR_CR=1 npm test y revisa el diff.",
  );
}

/** La cuenta tica de las pruebas: siempre igual, para que el fijado no baile. */
function canalTico() {
  const org = D.crearOrgConDueno({
    negocio: "Tienda Tica", color: "#111111", nombre: "Dueña",
    email: `cr-fijado-${Date.now()}-${Math.random().toString(36).slice(2)}@local`,
    passwordHash: "x",
  });
  const canal = D.crearCanal(org.orgId, {
    nombre: "Costa Rica", phone: `506${Math.random().toString().slice(2, 10)}`,
    tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado",
  });
  D.actualizarAgente(org.orgId, { pais: "cr", nombre: "Mildred", negocio: "Tienda Tica" }, canal);
  return { orgId: org.orgId, canal };
}

const ANUNCIO = {
  origen: "anuncio" as const,
  producto_anuncio: "Camisa de lino",
  descripcion_anuncio: "Camisa de lino manga larga — ₡25.000. Tallas S, M, L y XL.",
};

test("el prompt de Costa Rica es el que está grabado, palabra por palabra", () => {
  const { orgId, canal } = canalTico();
  const agente = D.obtenerAgente(orgId, canal);

  fijado("costa-rica-prompt.txt", armarSistema("Tienda Tica", agente, [], null));
  fijado("costa-rica-prompt-con-anuncio.txt", armarSistema("Tienda Tica", agente, [], ANUNCIO));
});

test("el bloque de país de Costa Rica es el que está grabado", () => {
  fijado("costa-rica-pais.txt", bloqueDelPais(agenteDePais("cr")!, null, "Tienda Tica"));
});

/**
 * Lo que Costa Rica contesta SIN modelo: la bienvenida sin anuncio, la apertura
 * desde un anuncio y la respuesta mínima cuando el revisor paró dos veces. Son
 * las tres frases que salen tal cual, sin que nadie las redacte.
 */
test("las respuestas mecánicas de Costa Rica son las que están grabadas", async () => {
  const { orgId, canal } = canalTico();
  D.crearProducto(orgId, { nombre: "Camisa de lino", variantes: "S, M, L", precio: 25000, canalId: canal });

  const hilo = (texto: string) => [{
    id: 1, org_id: orgId, conversation_id: 1, whapi_message_id: null,
    emisor: "cliente" as const, tipo: "texto" as const,
    descripcion_imagen: null, categoria_imagen: null, transcripcion: null,
    media_url: null, content: texto, created_at: D.ahora(),
  }];

  const sinAnuncio = await generarRespuesta(orgId, canal, hilo("Hola"));
  const conAnuncio = await generarRespuesta(orgId, canal, hilo("Hola, quiero info"), ANUNCIO);

  const d = agenteDePais("cr")!;
  const vacia = { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null };
  const minima = respuestaMinima(d, vacia, ANUNCIO, { ultimoDelCliente: "¿cuánto cuesta?" });
  const conTalla = respuestaMinima(d, { ...vacia, talla: "M" }, ANUNCIO, {});

  fijado(
    "costa-rica-respuestas.txt",
    [
      "── Bienvenida sin anuncio ──", sinAnuncio.texto,
      "", "── Apertura desde un anuncio ──", conAnuncio.texto,
      "", "── Respuesta mínima, sin nada en la ficha ──", String(minima),
      "", "── Respuesta mínima, con la talla dada ──", String(conTalla),
      "",
    ].join("\n"),
  );
});

/**
 * Y LO QUE SU REVISOR PARA. Las reglas mecánicas son compartidas: un arreglo
 * escrito para República Dominicana le llega a Costa Rica aunque su guion no se
 * toque. Aquí queda grabado qué para y qué deja pasar en un chat tico.
 */
test("el revisor de Costa Rica para lo que está grabado y nada más", () => {
  const d = agenteDePais("cr")!;
  const base: ContextoRevision = {
    datos: d,
    nombresDeLaCasa: [d.nombreAgente ?? "", d.tienda].filter(Boolean),
    catalogo: "Catálogo:\n- Camisa de lino (S, M, L) — 25000",
    anuncio: null,
    bloqueDelPais: bloqueDelPais(d, null, "Tienda Tica"),
    ficha: { talla: null, color: null, direccion: null, nombre: null, celular: null, cantidad: null },
  };

  const borradores = [
    "Diay, la camisa está en ₡25.000. ¿Qué talla le interesa?",
    "El envío son ₡3.500 a todo el país. ¿A qué cantón se lo enviamos?",
    "El envío le sale en ₡5.000.",
    "Son US$25.00 más el envío.",
    "Perfecto, ya tenemos su talla. ¿Qué color prefiere?",
    "¿Me comparte su ubicación por aquí?",
    "¿Cuántas unidades desea?",
    "Permítame un momento, le comunico con un representante.",
    "Con gusto le ayudo. ¿Me facilita su número de teléfono?",
  ];

  fijado(
    "costa-rica-revisor.txt",
    borradores
      .map((b) => {
        const fallas = revisarConReglas(b, base);
        return [`── ${b}`, ...(fallas.length ? fallas.map((f) => `   ✖ ${f}`) : ["   ✓ pasa"])].join("\n");
      })
      .join("\n") + "\n",
  );
});
