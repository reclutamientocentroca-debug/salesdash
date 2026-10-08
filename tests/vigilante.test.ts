import "./entorno";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import * as D from "../src/lib/db";
import { textoDeDocx } from "../src/lib/docx";
import {
  configDelCanal,
  GUIA_RD_DEFECTO,
  leerVeredicto,
  mensajesParaLaVigilante,
  PROMPT_DEFECTO,
  REGLAS_FIJAS_DEFECTO,
  revisarRespuesta,
  vigilarEnvio,
  type ContextoVigilante,
} from "../src/lib/vigilante";

const ORIGINAL = "La unidad está en RD$1,400. ¿Qué talla utiliza? ¿Y qué color? ¿Dónde vive?";
const CORREGIDA = "La unidad está en RD$1,400. ¿Qué talla utiliza?";

const ctx: ContextoVigilante = {
  conversacion: [{ quien: "CLIENTE", texto: "¿Cuánto cuesta?" }],
  producto: "Zapatos BROX. RD$1,400",
  pais: "ENVÍO: RD$250",
  guia: "guía",
  reglas: "regla",
  prompt: "prompt",
};

const json = (o: unknown) => JSON.stringify(o);

// ── Lectura del JSON ─────────────────────────────────────────────────────────

test("leerVeredicto: aprobada devuelve la original sin tocar", () => {
  const v = leerVeredicto(json({ veredicto: "APROBADA", motivos: ["x"], respuesta_final: "otra cosa" }), ORIGINAL);
  assert.deepEqual(v, { veredicto: "APROBADA", motivos: [], respuestaFinal: ORIGINAL });
});

test("leerVeredicto: corregida válida, con vallas de código y mayúsculas distintas", () => {
  const v = leerVeredicto("```json\n" + json({ veredicto: "corregida", motivos: ["varias preguntas"], respuesta_final: CORREGIDA }) + "\n```", ORIGINAL);
  assert.equal(v?.veredicto, "CORREGIDA");
  assert.equal(v?.respuestaFinal, CORREGIDA);
  assert.deepEqual(v?.motivos, ["varias preguntas"]);
});

test("leerVeredicto: lo ilegible o incompleto es null", () => {
  assert.equal(leerVeredicto("no soy json", ORIGINAL), null);
  assert.equal(leerVeredicto(json({ veredicto: "QUIZÁ" }), ORIGINAL), null);
  assert.equal(leerVeredicto(json({ veredicto: "CORREGIDA", motivos: [] }), ORIGINAL), null, "corregida sin respuesta_final");
  assert.equal(leerVeredicto(json({ veredicto: "CORREGIDA", respuesta_final: "   " }), ORIGINAL), null);
  assert.equal(leerVeredicto(json([1, 2]), ORIGINAL), null);
});

test("leerVeredicto: «corregida» con el mismo texto es una aprobación", () => {
  const v = leerVeredicto(json({ veredicto: "CORREGIDA", motivos: ["x"], respuesta_final: ORIGINAL }), ORIGINAL);
  assert.equal(v?.veredicto, "APROBADA");
});

test("el prompt lleva la guía, las reglas, el país, el producto y el formato", () => {
  const [sistema, usuario] = mensajesParaLaVigilante(ctx, ORIGINAL);
  for (const t of ["prompt", "regla", "guía", "ENVÍO: RD$250", "Zapatos BROX", "FORMATO DE SALIDA"]) {
    assert.ok(sistema!.content.includes(t), `falta «${t}»`);
  }
  assert.ok(usuario!.content.includes("CLIENTE: ¿Cuánto cuesta?"));
  assert.ok(usuario!.content.includes(ORIGINAL));
});

// ── Revisión y fallo seguro ──────────────────────────────────────────────────

test("revisarRespuesta: aprobada y corregida", async () => {
  const ok = await revisarRespuesta(ctx, ORIGINAL, { llamar: async () => json({ veredicto: "APROBADA", motivos: [], respuesta_final: ORIGINAL }) });
  assert.equal(ok.veredicto, "APROBADA");
  assert.equal(ok.respuestaFinal, ORIGINAL);

  const mal = await revisarRespuesta(ctx, ORIGINAL, {
    llamar: async () => json({ veredicto: "CORREGIDA", motivos: ["varias preguntas"], respuesta_final: CORREGIDA }),
  });
  assert.equal(mal.veredicto, "CORREGIDA");
  assert.equal(mal.respuestaFinal, CORREGIDA);
});

test("revisarRespuesta: si tarda más del tope, sale la original", async () => {
  const t0 = Date.now();
  const r = await revisarRespuesta(ctx, ORIGINAL, { timeoutMs: 80, llamar: () => new Promise<string>(() => {}) });
  assert.equal(r.veredicto, "FALLO");
  assert.equal(r.respuestaFinal, ORIGINAL);
  assert.match(r.error ?? "", /tardó/);
  assert.ok(Date.now() - t0 < 2000);
});

test("revisarRespuesta: error del proveedor o JSON ilegible → original", async () => {
  const a = await revisarRespuesta(ctx, ORIGINAL, { llamar: async () => { throw new Error("503"); } });
  assert.equal(a.veredicto, "FALLO");
  assert.equal(a.respuestaFinal, ORIGINAL);

  const b = await revisarRespuesta(ctx, ORIGINAL, { llamar: async () => "claro, aquí tiene: la respuesta mejor" });
  assert.equal(b.veredicto, "FALLO");
  assert.equal(b.respuestaFinal, ORIGINAL);
});

test("revisarRespuesta: sin FreeLLMAPI configurado falla seguro (y no llama a OpenRouter)", async () => {
  delete process.env.FREELLMAPI_BASE_URL;
  delete process.env.FREELLMAPI_API_KEY;
  const r = await revisarRespuesta(ctx, ORIGINAL);
  assert.equal(r.veredicto, "FALLO");
  assert.match(r.error ?? "", /FreeLLMAPI/);
  assert.equal(r.respuestaFinal, ORIGINAL);
});

test("revisarRespuesta: una corrección con «anuncio», o que rompe las reglas, no sale", async () => {
  const conAnuncio = await revisarRespuesta(ctx, ORIGINAL, {
    llamar: async () => json({ veredicto: "CORREGIDA", motivos: ["x"], respuesta_final: "Según el anuncio cuesta RD$1,400. ¿Qué talla?" }),
  });
  assert.equal(conAnuncio.veredicto, "FALLO");
  assert.equal(conAnuncio.respuestaFinal, ORIGINAL);

  const precioInventado = await revisarRespuesta(ctx, ORIGINAL, {
    llamar: async () => json({ veredicto: "CORREGIDA", motivos: ["x"], respuesta_final: "Cuesta RD$900. ¿Qué talla?" }),
    validarCorregida: (t) => (t.includes("RD$900") ? ["precio inventado"] : []),
  });
  assert.equal(precioInventado.veredicto, "FALLO");
  assert.equal(precioInventado.respuestaFinal, ORIGINAL);
});

// ── En el punto de envío, con base de datos ──────────────────────────────────

function cuenta(nombre: string) {
  const { orgId } = D.crearOrgConDueno({ negocio: nombre, color: "#111111", nombre, email: `vig-${nombre}-${Date.now()}@p.local`, passwordHash: "x" });
  const canalId = D.crearCanal(orgId, { nombre: `Canal ${nombre}`, phone: `1809${Math.floor(Math.random() * 1e7)}`, tokenCifrado: "x", webhookSecret: "s", whapiChannelId: null, estado: "conectado" });
  return { orgId, canalId };
}

function entrada(orgId: number, canalId: number) {
  return { orgId, canalId, conversationId: 1, pais: "do", historial: [], ultimoDelCliente: "¿Cuánto cuesta?", respuesta: ORIGINAL, bloqueDelPais: "ENVÍO", producto: "RD$1,400" };
}

const corrige = async () => json({ veredicto: "CORREGIDA", motivos: ["Varias preguntas.", "Repite el precio"], respuesta_final: CORREGIDA });

test("apagada (de fábrica): no toca nada ni registra", async () => {
  const { orgId, canalId } = cuenta("apagada");
  let llamadas = 0;
  const r = await vigilarEnvio(entrada(orgId, canalId), { llamar: async () => { llamadas++; return corrige(); } });
  assert.equal(r, null);
  assert.equal(llamadas, 0);
});

test("hacen falta los dos interruptores: el general y el del canal", async () => {
  const { orgId, canalId } = cuenta("dos");
  D.guardarVigilanteConfig(orgId, canalId, { activa: true });
  assert.equal(await vigilarEnvio(entrada(orgId, canalId), { llamar: corrige }), null, "solo el del canal no basta");

  D.guardarVigilanteConfig(orgId, 0, { activa: true });
  D.guardarVigilanteConfig(orgId, canalId, { activa: false });
  assert.equal(await vigilarEnvio(entrada(orgId, canalId), { llamar: corrige }), null, "solo el general no basta");
});

test("modo Corregir: sale la corregida y queda registrada", async () => {
  const { orgId, canalId } = cuenta("corregir");
  D.guardarVigilanteConfig(orgId, 0, { activa: true });
  D.guardarVigilanteConfig(orgId, canalId, { activa: true });

  const r = await vigilarEnvio(entrada(orgId, canalId), { llamar: corrige });
  assert.deepEqual(r, { texto: CORREGIDA, corregida: true });

  const [fila] = D.listarCorreccionesVigilante(orgId, {});
  assert.equal(fila!.respuesta_original, ORIGINAL);
  assert.equal(fila!.respuesta_final, CORREGIDA);
  assert.equal(fila!.enviada, "corregida");
  assert.equal(fila!.mensaje_cliente, "¿Cuánto cuesta?");
  assert.deepEqual(JSON.parse(fila!.motivos), ["Varias preguntas.", "Repite el precio"]);
});

test("modo Solo vigilar: registra pero sale la original", async () => {
  const { orgId, canalId } = cuenta("vigilar");
  D.guardarVigilanteConfig(orgId, 0, { activa: true });
  D.guardarVigilanteConfig(orgId, canalId, { activa: true, modo: "vigilar" });

  const r = await vigilarEnvio(entrada(orgId, canalId), { llamar: corrige });
  assert.deepEqual(r, { texto: ORIGINAL, corregida: false });
  const [fila] = D.listarCorreccionesVigilante(orgId, {});
  assert.equal(fila!.enviada, "original");
  assert.equal(fila!.respuesta_final, CORREGIDA);
});

test("fallo: sale la original y se anota; los contadores lo cuentan aparte", async () => {
  const { orgId, canalId } = cuenta("fallo");
  D.guardarVigilanteConfig(orgId, 0, { activa: true });
  D.guardarVigilanteConfig(orgId, canalId, { activa: true });

  const r = await vigilarEnvio(entrada(orgId, canalId), { llamar: async () => { throw new Error("caído"); } });
  assert.deepEqual(r, { texto: ORIGINAL, corregida: false });

  await vigilarEnvio(entrada(orgId, canalId), { llamar: async () => json({ veredicto: "APROBADA", motivos: [], respuesta_final: ORIGINAL }) });
  await vigilarEnvio(entrada(orgId, canalId), { llamar: corrige });
  await vigilarEnvio(entrada(orgId, canalId), { llamar: corrige });

  const c = D.contadoresVigilante(orgId, {});
  assert.equal(c.aprobadas, 1);
  assert.equal(c.corregidas, 2);
  assert.equal(c.fallos, 1);
  // «Varias preguntas.» y «varias preguntas» son el mismo motivo.
  assert.equal(c.motivos[0]!.cantidad, 2);
});

test("cada cuenta ve solo lo suyo, y los filtros por canal y fecha funcionan", async () => {
  const a = cuenta("aislaA");
  const b = cuenta("aislaB");
  for (const x of [a, b]) {
    D.guardarVigilanteConfig(x.orgId, 0, { activa: true });
    D.guardarVigilanteConfig(x.orgId, x.canalId, { activa: true });
    await vigilarEnvio(entrada(x.orgId, x.canalId), { llamar: corrige });
  }
  assert.equal(D.listarCorreccionesVigilante(a.orgId, {}).length, 1);
  assert.equal(D.contadoresVigilante(a.orgId, {}).corregidas, 1);
  // Un canal de otra cuenta filtrado desde esta no devuelve nada.
  assert.equal(D.listarCorreccionesVigilante(a.orgId, { canalId: b.canalId }).length, 0);
  // Un miembro sin ese canal no ve sus filas.
  assert.equal(D.listarCorreccionesVigilante(a.orgId, { canalesPermitidos: [b.canalId] }).length, 0);
  assert.equal(D.listarCorreccionesVigilante(a.orgId, { canalesPermitidos: [] }).length, 0);
  assert.equal(D.listarCorreccionesVigilante(a.orgId, { canalesPermitidos: [a.canalId] }).length, 1);

  const ahora = D.ahora();
  assert.equal(D.listarCorreccionesVigilante(a.orgId, { desde: ahora - 60, hasta: ahora + 60 }).length, 1);
  assert.equal(D.listarCorreccionesVigilante(a.orgId, { desde: ahora + 3600 }).length, 0);
  assert.equal(D.listarCorreccionesVigilante(a.orgId, { hasta: ahora - 3600 }).length, 0);

  // La configuración tampoco se cuela entre cuentas.
  assert.equal(D.obtenerVigilanteConfig(b.orgId, a.canalId), null);
});

test("textos de fábrica: RD trae su guía, y lo guardado manda sobre ellos", () => {
  const { orgId, canalId } = cuenta("fabrica");
  const f = configDelCanal(orgId, canalId, "do");
  assert.equal(f.guia, GUIA_RD_DEFECTO);
  assert.equal(f.reglas, REGLAS_FIJAS_DEFECTO);
  assert.equal(f.prompt, PROMPT_DEFECTO);
  assert.equal(f.modo, "corregir");
  assert.equal(configDelCanal(orgId, canalId, "cr").guia, "");

  D.guardarVigilanteConfig(orgId, canalId, { guia: "la mía", reglas: "" });
  const g = configDelCanal(orgId, canalId, "do");
  assert.equal(g.guia, "la mía");
  assert.equal(g.reglas, "", "borrar las reglas es una decisión, no vuelve la de fábrica");
  D.guardarVigilanteConfig(orgId, canalId, { guia: null });
  assert.equal(configDelCanal(orgId, canalId, "do").guia, GUIA_RD_DEFECTO, "null = volver a la de fábrica");
});

// ── .docx ────────────────────────────────────────────────────────────────────

function zip(entradas: { nombre: string; datos: Buffer; deflate: boolean }[]): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre);
    const datos = e.deflate ? deflateRawSync(e.datos) : e.datos;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, datos);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(e.datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);

    desplazamiento += 30 + nombre.length + datos.length;
  }

  const dirCentral = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dirCentral.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, dirCentral, fin]);
}

const XML = `<?xml version="1.0"?><w:document><w:body>
<w:p><w:r><w:t>Etapas de cierre:</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">1. Saludar </w:t></w:r><w:r><w:t>rápido &amp; con amabilidad.</w:t></w:r></w:p>
<w:p><w:r><w:t>Precio:</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>RD$1,400</w:t></w:r></w:p>
<w:p><w:pPr/></w:p><w:p><w:r><w:instrText>CAMPO</w:instrText></w:r><w:r><w:t>«¿Cuánto cuesta?» → ok</w:t></w:r></w:p>
</w:body></w:document>`;

for (const deflate of [false, true]) {
  test(`docx: extrae el texto (${deflate ? "comprimido" : "almacenado"})`, () => {
    const archivo = zip([
      { nombre: "[Content_Types].xml", datos: Buffer.from("<x/>"), deflate },
      { nombre: "word/document.xml", datos: Buffer.from(XML), deflate },
    ]);
    assert.equal(
      textoDeDocx(archivo),
      "Etapas de cierre:\n1. Saludar rápido & con amabilidad.\nPrecio:\tRD$1,400\n\n«¿Cuánto cuesta?» → ok",
    );
  });
}

test("docx: lo que no es un docx da un error claro", () => {
  assert.throws(() => textoDeDocx(Buffer.from("esto no es un zip")), /no es un \.docx/);
  assert.throws(() => textoDeDocx(zip([{ nombre: "otra.xml", datos: Buffer.from("<x/>"), deflate: false }])), /no tiene texto/);
});
