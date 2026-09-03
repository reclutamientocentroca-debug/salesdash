/**
 * El agente de un país, contra el modelo de verdad.
 *
 * Es el chat de prueba del panel, pero de varios turnos y con todo lo que sí
 * tiene una conversación real: el anuncio por el que llegó el cliente, su
 * teléfono, las tarifas de envío cargadas y las respuestas partidas en los
 * globos que de verdad le llegan al WhatsApp.
 *
 * Sirve para lo que ninguna prueba de contrato puede: LEER cómo contesta. Que
 * el saludo salga aparte, que no pregunte una talla que ese artículo no tiene,
 * que el envío sea el de la provincia del cliente y que la orden salga con su
 * forma no se comprueba con un assert, se comprueba leyéndolo.
 *
 *   npm run probar-agente            (República Dominicana)
 *   npm run probar-agente -- cr      (Costa Rica)
 *   npm run probar-agente -- pa      (Panamá)
 *
 * Y con un modelo distinto al que tiene puesto la cuenta, para comparar sin
 * tocar nada:
 *
 *   npm run probar-agente -- cr openai/gpt-4o
 *
 * Eso es lo que contesta la pregunta que de verdad importa cuando una
 * conversación sale mal: ¿es el guion o es el modelo?
 *
 * Gasta llamadas al modelo de verdad, así que no entra en `npm test`.
 */
import "../scripts/env-loader";
import {
  actualizarAgente,
  ahora,
  crearCanal,
  crearOrgConDueno,
  obtenerAgente,
  type Mensaje,
} from "../src/lib/db";
import { generarRespuesta, partirEnMensajes } from "../src/lib/agent";

/** Qué le escribe el cliente, en orden, en cada país. */
const GUIONES: Record<string, { anuncio: string; precio: string; describe: string; dice: string[] }> = {
  do: {
    anuncio: "Mocasines de cuero",
    precio: "RD$2,500",
    describe: "Mocasines de cuero genuino, suela antideslizante. Tallas de la 39 a la 45.",
    dice: [
      "Hola, vi el anuncio de los mocasines, ¿cuánto es?",
      "???",
      "¿y el envío? soy de Santiago",
      "la 9 americana",
      "calle Mella #12, Villa Olga",
      "Yazmin Pérez",
      "sí, confirmo",
    ],
  },
  /*
   * El tico compra una camisa: lleva talla POR LETRA y color, así que se ve el
   * camino entero —talla, color, dirección, número, nombre, resumen— y se ve si
   * pide la talla como la pide el anuncio.
   */
  cr: {
    anuncio: "Camisa de lino manga larga",
    precio: "₡25.000",
    describe: "Camisa de lino manga larga. Tallas S, M, L y XL. Colores blanco, celeste y beige.",
    dice: [
      "Hola, vi el anuncio de la camisa, ¿cuánto vale?",
      "la M",
      "celeste",
      "Heredia, San Rafael, 200 metros norte de la iglesia",
      "sí, a este mismo",
      "Marcela Jiménez",
      "sí, confirmo",
    ],
  },
  pa: {
    anuncio: "Mocasines de cuero",
    precio: "US$30",
    describe: "Mocasines de cuero genuino, suela antideslizante. Tallas de la 39 a la 45.",
    dice: [
      "Hola, vi el anuncio de los mocasines, ¿cuánto es?",
      "talla 42, color chocolate",
      "Juan Díaz, calle 12, casa 8, Ciudad de Panamá",
      "Ana Gómez",
      "sí, confirmo",
    ],
  },
};

const raya = (t: string) => console.log(`\n${"─".repeat(70)}\n${t}\n`);

function mensaje(emisor: "cliente" | "ia", content: string, i: number): Mensaje {
  return {
    id: i, org_id: 0, conversation_id: 0, whapi_message_id: null,
    emisor, tipo: "texto", descripcion_imagen: null, categoria_imagen: null,
    transcripcion: null, media_url: null, content, created_at: ahora() + i,
  };
}

async function main() {
  const pais = (process.argv[2] ?? "do").toLowerCase();
  const modeloPedido = process.argv[3]?.trim() || null;
  const guion = GUIONES[pais];

  if (!guion) {
    console.error(`No hay guion de prueba para «${pais}». Usa do, cr o pa.`);
    process.exit(1);
  }

  const { orgId } = crearOrgConDueno({
    negocio: "Cuenta de prueba",
    color: "#12876a",
    nombre: "Dueño",
    email: `probar-agente-${Date.now()}@local`,
    passwordHash: "x",
  });

  const canalId = crearCanal(orgId, {
    nombre: "Ventas",
    phone: `1809${Date.now().toString().slice(-7)}`,
    tokenCifrado: "",
    webhookSecret: "s",
    whapiChannelId: null,
    estado: "conectado",
  });

  // Las tarifas, en la moneda de cada país.
  const tarifas = pais === "cr" ? { cerca: 2500, lejos: 3500 } : pais === "pa" ? { cerca: 5, lejos: 5 } : { cerca: 250, lejos: 290 };

  // Quien atiende y de parte de quién, para el país cuyo archivo no lo fija
  // (Panamá): los otros dos lo traen escrito en src/agents/paises.
  const quien = { nombre: "Ana", negocio: "Tienda Rincón" };

  actualizarAgente(
    orgId,
    {
      pais,
      nombre: quien.nombre,
      negocio: quien.negocio,
      // El guion vive en src/agents: aquí no se pega ninguno.
      instrucciones: "",
      envio_cerca: tarifas.cerca,
      envio_lejos: tarifas.lejos,
      ...(modeloPedido ? { modelo: modeloPedido } : {}),
      conocimiento: `${guion.anuncio}: ${guion.precio}. ${guion.describe}`,
    },
    canalId,
  );

  const a = obtenerAgente(orgId, canalId);
  console.log(
    `${a.nombre} de ${a.negocio} · país ${a.pais} · envío ${tarifas.cerca}/${tarifas.lejos} · modelo ${a.modelo}`,
  );

  const anuncio = {
    origen: "anuncio",
    producto_anuncio: guion.anuncio,
    descripcion_anuncio: `${guion.describe} ${guion.precio}.`,
  };

  const cliente = { telefono: "18095551234", nombre: "Yazmin" };

  const hilo: Mensaje[] = [];
  let i = 0;
  let modelo = "";

  for (const dice of guion.dice) {
    hilo.push(mensaje("cliente", dice, i++));
    raya(`CLIENTE:  ${dice}`);

    const r = await generarRespuesta(orgId, canalId, hilo, anuncio, null, cliente);
    modelo = r.modelo;

    // Los globos que de verdad salen: el saludo solo se parte en la apertura.
    const globos = partirEnMensajes(r.texto, {
      saludoAparte: hilo.every((m) => m.emisor === "cliente"),
    });

    for (const [n, g] of globos.entries()) {
      console.log(`AGENTE  [${n + 1}/${globos.length}]`);
      console.log(g.split("\n").map((l) => `   ${l}`).join("\n"));
      console.log();
    }

    hilo.push(mensaje("ia", r.texto, i++));
  }

  console.log(`\nContestó ${modelo}.`);
}

main().catch((e) => {
  console.error("FALLÓ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
