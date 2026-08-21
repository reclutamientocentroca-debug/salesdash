/**
 * Verificación contra OpenRouter de verdad. Lo que hasta ahora solo estaba
 * probado contra el contrato:
 *   1. El analista clasifica una conversación real y extrae el pedido
 *   2. La regla maestra se sostiene con la salida real del modelo
 *   3. El agente cae al modelo de respaldo cuando el principal falla
 *   4. Si ambos fallan, el agente NO responde
 */
import "../scripts/env-loader";
import {
  actualizarAgente,
  actualizarOrg,
  ahora,
  crearCanal,
  crearOrgConDueno,
  getConversation,
  getOrCreateConversation,
  insertMessage,
  listarMensajes,
  registrarAiSent,
  type Emisor,
} from "../src/lib/db";
import { analizarConversacion } from "../src/lib/analyzer";
import { generarRespuesta } from "../src/lib/agent";
import { ErrorIA } from "../src/lib/ia";
import { cifrar } from "../src/lib/auth";

const MODELO = "openai/gpt-4o-mini";
const linea = (t: string) => console.log(`\n${"─".repeat(72)}\n${t}\n`);

function montar() {
  const correo = `real-${Date.now()}@prueba.local`;
  const { orgId } = crearOrgConDueno({
    negocio: "Tienda Bella",
    color: "#12876a",
    nombre: "Ana",
    email: correo,
    passwordHash: "x",
  });

  actualizarOrg(orgId, { modelo_analisis: MODELO, modelo_vision: MODELO });

  const canalId = crearCanal(orgId, {
    nombre: "Ventas",
    phone: `1809${Date.now() % 10_000_000}`,
    tokenCifrado: cifrar("falso"),
    webhookSecret: "s",
    whapiChannelId: null,
    estado: "conectado",
  });

  return { orgId, canalId };
}

let n = 0;
function hilo(
  orgId: number,
  canalId: number,
  mensajes: { emisor: Emisor; content: string; min: number }[],
) {
  const t0 = ahora() - 7200;
  const { conversacion } = getOrCreateConversation(orgId, canalId, `18095${++n}00000`, {
    nombre: "María Pérez",
    cuando: t0,
    productoAnuncio: "Camisa manga larga",
  });

  for (const [i, m] of mensajes.entries()) {
    const id = `real-${n}-${i}`;
    if (m.emisor === "ia") registrarAiSent(orgId, id);
    insertMessage(orgId, {
      conversationId: conversacion.id,
      whapiMessageId: id,
      emisor: m.emisor,
      tipo: "texto",
      content: m.content,
      createdAt: t0 + m.min * 60,
    });
  }
  return conversacion.id;
}

async function main() {
  const { orgId, canalId } = montar();

  // ── 1. Cierre de la IA, con factura humana POSTERIOR ────────────────────
  linea("1 · REGLA MAESTRA con salida real del modelo");

  const a = hilo(orgId, canalId, [
    { emisor: "cliente", content: "Hola, vi el anuncio de la camisa manga larga. ¿Está disponible?", min: 0 },
    { emisor: "ia", content: "¡Hola María! Sí, la tenemos. Cuesta 1850. ¿Qué talla buscas?", min: 1 },
    { emisor: "cliente", content: "La M. ¿Cuánto es el envío a Santiago?", min: 3 },
    { emisor: "ia", content: "El envío a Santiago son 350 y llega en dos días.", min: 4 },
    { emisor: "cliente", content: "Perfecto, la quiero", min: 6 },
    { emisor: "ia", content: "Resumen: 1 camisa manga larga, talla M, total 1850, envío 350. ¡Gracias María!", min: 7 },
    // Diez minutos después el vendedor manda la factura: papeleo, no cierre.
    { emisor: "humano", content: "Te mando la factura del pedido", min: 17 },
  ]);

  const r1 = await analizarConversacion(orgId, a);
  const c1 = getConversation(orgId, a)!;

  console.log("  estado          ", r1.estado, r1.estado === "ia" ? "✓ la venta es de la IA" : "✗ FALLO");
  console.log("  señal           ", r1.senal);
  console.log("  producto        ", c1.producto_vendido);
  console.log("  total / envío   ", c1.total, "/", c1.envio);
  console.log("  resumen         ", c1.resumen_pedido);
  console.log("  justificación   ", c1.justificacion);

  // ── 2. Conversación sin señal: decide el modelo ─────────────────────────
  linea("2 · SIN SEÑAL MECÁNICA — clasifica el modelo y explica por qué se cayó");

  const b = hilo(orgId, canalId, [
    { emisor: "cliente", content: "Buenas, ¿cuánto está la camisa manga larga?", min: 0 },
    { emisor: "ia", content: "¡Hola! Está en 1850 más el envío. ¿Te la aparto?", min: 1 },
    { emisor: "cliente", content: "Uff, está cara. En otro lado la vi más barata", min: 4 },
    { emisor: "ia", content: "Te entiendo. Es algodón peinado y tenemos garantía de cambio.", min: 5 },
  ]);

  const r2 = await analizarConversacion(orgId, b);
  const c2 = getConversation(orgId, b)!;

  console.log("  estado          ", r2.estado, r2.estado === "abierta" ? "✓ sigue abierta" : "");
  console.log("  motivo de caída ", c2.motivo_perdida);
  console.log("  justificación   ", c2.justificacion);

  // ── 3. Sellado: no se reevalúa ──────────────────────────────────────────
  linea("3 · SELLADO — reanalizar una conversación cerrada no gasta nada");

  const antes = Date.now();
  const r3 = await analizarConversacion(orgId, a);
  console.log(`  sellada: ${r3.sellada} · estado sigue ${r3.estado} · tardó ${Date.now() - antes} ms`);
  console.log("  (sin llamada al modelo: por eso son milisegundos)");

  // ── 4. Respaldo del agente ──────────────────────────────────────────────
  linea("4 · RESPALDO DEL AGENTE — el principal falla, responde el segundo");

  actualizarAgente(orgId, {
    nombre: "Bella",
    modelo: "modelo/que-no-existe-a-proposito",
    modelo_respaldo: MODELO,
  });

  const mensajes = listarMensajes(orgId, b);
  const respuesta = await generarRespuesta(orgId, mensajes);

  console.log("  modelo que respondió:", respuesta.modelo);
  console.log("  fue el respaldo:     ", respuesta.fueRespaldo, respuesta.fueRespaldo ? "✓" : "✗ FALLO");
  console.log("  respuesta:           ", JSON.stringify(respuesta.texto));

  // ── 5. Sin respaldo válido: el agente NO inventa nada ────────────────────
  linea("5 · AMBOS FALLAN — el agente se calla, no le escribe un error al cliente");

  actualizarAgente(orgId, {
    modelo: "modelo/que-no-existe-a-proposito",
    modelo_respaldo: "tampoco/existe-este",
  });

  try {
    const mala = await generarRespuesta(orgId, mensajes);
    console.log("  ✗ FALLO: generó algo →", mala.texto);
  } catch (e) {
    console.log("  lanzó error en vez de inventar una respuesta ✓");
    console.log("  tipo:  ", e instanceof ErrorIA ? "ErrorIA" : (e as Error).constructor.name);
    console.log("  motivo:", (e as Error).message.slice(0, 90));
    console.log("  → atenderConversacion lo captura, se calla y crea una anomalía alta");
  }
}

main().catch((e) => {
  console.error("\nLa verificación falló:", e);
  process.exit(1);
});
