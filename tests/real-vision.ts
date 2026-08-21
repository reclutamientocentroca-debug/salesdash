/**
 * Verificación real del modelo con visión.
 *
 * Es la pieza que decide si un cierre humano existe o no. Si clasifica mal,
 * o se inventan ventas (toda foto contaría como factura) o se pierden.
 *
 * Se usan imágenes públicas de Wikimedia: una factura de verdad y una foto de
 * ropa. La factura tiene que cerrar; la camisa NO.
 */
import "../scripts/env-loader";
import {
  actualizarOrg,
  ahora,
  crearCanal,
  crearOrgConDueno,
  getConversation,
  getOrCreateConversation,
  insertMessage,
  listarMensajes,
  registrarAiSent,
} from "../src/lib/db";
import { analizarConversacion } from "../src/lib/analyzer";
import { cifrar } from "../src/lib/auth";

const MODELO = "openai/gpt-4o-mini";

const FACTURA =
  "https://upload.wikimedia.org/wikipedia/commons/d/d2/Invoice_of_a_traditional_restaurant_in_downtown_Kanazawa.jpg";
const CAMISA =
  "https://upload.wikimedia.org/wikipedia/commons/3/3d/Dress_Shirt_Fitting_on_dummy_Front.JPG";

const linea = (t: string) => console.log(`\n${"─".repeat(72)}\n${t}\n`);

const correo = `vision-${Date.now()}@prueba.local`;
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

let n = 0;
const CORRIDA = Date.now().toString(36); // ids únicos por ejecución
function hiloConImagen(urlImagen: string, textoAntes: string) {
  const t0 = ahora() - 3600;
  const { conversacion } = getOrCreateConversation(orgId, canalId, `18096${++n}00000`, {
    nombre: "Luis Ramírez",
    cuando: t0,
  });

  insertMessage(orgId, {
    conversationId: conversacion.id,
    whapiMessageId: `vis-${CORRIDA}-${n}-1`,
    emisor: "cliente",
    tipo: "texto",
    content: textoAntes,
    createdAt: t0,
  });

  // Imagen SALIENTE de un humano, en un hilo sin resumen previo de la IA:
  // es exactamente el caso que la visión tiene que decidir.
  insertMessage(orgId, {
    conversationId: conversacion.id,
    whapiMessageId: `vis-${CORRIDA}-${n}-2`,
    emisor: "humano",
    tipo: "imagen",
    content: "[imagen]",
    createdAt: t0 + 600,
    mediaUrl: urlImagen,
  });

  return conversacion.id;
}

async function main() {
  linea("A · IMAGEN DE FACTURA — tiene que cerrar como venta del vendedor");

  const a = hiloConImagen(FACTURA, "¿Me confirmas el pedido?");
  const ra = await analizarConversacion(orgId, a);
  const ma = listarMensajes(orgId, a).find((m) => m.tipo === "imagen")!;

  console.log("  categoría detectada:", ma.categoria_imagen);
  console.log("  descripción:        ", ma.descripcion_imagen);
  console.log("  estado:             ", ra.estado, "· señal:", ra.senal);
  console.log("  →", ra.estado === "humano" ? "✓ cierre humano detectado" : "no cerró");

  linea("B · FOTO DE PRODUCTO — NO puede cerrar nada");

  const b = hiloConImagen(CAMISA, "¿Tienes fotos de la camisa?");
  const rb = await analizarConversacion(orgId, b);
  const mb = listarMensajes(orgId, b).find((m) => m.tipo === "imagen")!;
  const cb = getConversation(orgId, b)!;

  console.log("  categoría detectada:", mb.categoria_imagen);
  console.log("  descripción:        ", mb.descripcion_imagen);
  console.log("  estado:             ", rb.estado);
  console.log(
    "  →",
    rb.estado === "humano"
      ? "✗ FALLO: una foto de producto se contó como venta"
      : "✓ no cerró — el hilo sigue vivo",
  );
  if (cb.motivo_perdida) console.log("  motivo:             ", cb.motivo_perdida);

  linea("C · LA DESCRIPCIÓN SE GUARDA, NO SE VUELVE A PEDIR");

  const antes = Date.now();
  await analizarConversacion(orgId, b);
  console.log(`  segundo análisis del hilo abierto: ${Date.now() - antes} ms`);
  console.log("  categoría sigue:", listarMensajes(orgId, b).find((m) => m.tipo === "imagen")!.categoria_imagen);
  console.log("  (la imagen ya no se describe: se lee de messages.descripcion_imagen)");
}

main().catch((e) => {
  console.error("\nFalló:", e);
  process.exit(1);
});
