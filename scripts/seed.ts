/**
 * Siembra una organización de ejemplo con datos realistas, para poder ver el
 * panel entero antes de conectar un solo número.
 *
 *   npm run seed
 *
 * Todo lo que genera es local: no llama a Whapi ni a ningún modelo. Las
 * conversaciones quedan ya clasificadas por las mismas funciones que usa el
 * analista, así que la invariante de conteo se cumple igual que en producción.
 */
import "./env-loader";
import argon2 from "argon2";
import {
  actualizarConversacion,
  ahora,
  buscarUsuarioPorEmail,
  crearAnomalia,
  crearCanal,
  crearOrgConDueno,
  crearProducto,
  actualizarAgente,
  conteoPorEstado,
  getOrCreateConversation,
  insertMessage,
  marcarRevision,
  registrarAiSent,
  sellarCierre,
  totalLeads,
  type Emisor,
} from "../src/lib/db";
import { cifrar, secretoAleatorio } from "../src/lib/auth";

const CORREO = "demo@salesdash.app";
const CLAVE = "demo1234";
const DIA = 86_400;

const NOMBRES = [
  "María Pérez", "Luis Ramírez", "Carmen Díaz", "José Peña", "Ana Fernández",
  "Rafael Núñez", "Yolanda Cruz", "Pedro Almonte", "Rosa Jiménez", "Miguel Santos",
  "Laura Vargas", "Elena Reyes", "Juan Batista", "Sofía Mejía", "Carlos Herrera",
  "Patricia Gómez", "Andrés Polanco", "Isabel Rosario", "Víctor Guzmán", "Daniela Ortiz",
];

const PRODUCTOS = [
  { nombre: "Camisa manga larga", variantes: "S, M, L, XL · blanco, azul, negro", precio: 1850 },
  { nombre: "Pantalón de vestir", variantes: "30 a 38 · gris, negro", precio: 2400 },
  { nombre: "Vestido casual", variantes: "S, M, L · floral, liso", precio: 2900 },
  { nombre: "Zapatos de cuero", variantes: "38 a 44 · marrón, negro", precio: 4200 },
  { nombre: "Cartera de mano", variantes: "beige, negro", precio: 3100 },
];

/** Aleatoriedad reproducible: el seed siempre genera el mismo panel. */
let semilla = 20260820;
function azar(): number {
  semilla = (semilla * 1103515245 + 12345) % 2147483648;
  return semilla / 2147483648;
}
const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
const elegir = <T>(xs: T[]): T => xs[Math.floor(azar() * xs.length)]!;

async function main() {
  if (buscarUsuarioPorEmail(CORREO)) {
    console.log(`Ya existe la cuenta de ejemplo (${CORREO}). Borra data/salesdash.db para rehacerla.`);
    return;
  }

  const { orgId, userId } = crearOrgConDueno({
    negocio: "Tienda Bella",
    color: "#12876a",
    nombre: "Ana Rodríguez",
    email: CORREO,
    passwordHash: await argon2.hash(CLAVE, { type: argon2.argon2id }),
  });

  actualizarAgente(orgId, {
    nombre: "Bella",
    tono: "cercano",
    instrucciones:
      "Los envíos a la capital cuestan 200 y llegan al día siguiente. Al interior, 350 en 2 o 3 días. " +
      "No damos descuentos por debajo de 3 unidades.",
  });

  for (const p of PRODUCTOS) {
    crearProducto(orgId, { nombre: p.nombre, variantes: p.variantes, precio: p.precio });
  }

  /*
   * Dos números en dos países, que es como se usa esto de verdad: la misma
   * tienda vendiendo en República Dominicana y en Panamá. Cada canal hereda de
   * la plantilla el guion escrito arriba y después se le pone SU país, que es lo
   * que le cambia la moneda, el trato y la forma de pedir una dirección.
   */
  const canales = [
    { nombre: "Ventas Santo Domingo", phone: "18095551000", pais: "do" },
    { nombre: "Ventas Panamá", phone: "50765551000", pais: "pa" },
  ].map((c) => {
    const id = crearCanal(orgId, {
      nombre: c.nombre,
      phone: c.phone,
      tokenCifrado: cifrar(`demo-token-${c.phone}`),
      webhookSecret: secretoAleatorio(),
      whapiChannelId: null,
      estado: "conectado",
    });

    actualizarAgente(orgId, { pais: c.pais }, id);
    return { ...c, id };
  });

  const t = ahora();
  let telefono = 18_095_558_000;
  let mensajeId = 0;

  const nuevoMensaje = (
    conversationId: number,
    emisor: Emisor,
    content: string,
    cuando: number,
    tipo: "texto" | "imagen" = "texto",
  ) => {
    const id = `demo-${++mensajeId}`;
    if (emisor === "ia") registrarAiSent(orgId, id);
    insertMessage(orgId, {
      conversationId,
      whapiMessageId: id,
      emisor,
      tipo,
      content,
      createdAt: cuando,
      mediaUrl: tipo === "imagen" ? "https://ejemplo.invalid/demo.jpg" : null,
    });
    return id;
  };

  let creadas = 0;

  // 30 días de conversaciones, con más volumen los días recientes.
  for (let dia = 29; dia >= 0; dia--) {
    const base = t - dia * DIA;
    const cuantas = entre(2, 7);

    for (let i = 0; i < cuantas; i++) {
      const canal = elegir(canales);
      const producto = elegir(PRODUCTOS);
      const deAnuncio = azar() < 0.65;
      // Uno de cada ocho anuncios llega sin título: Meta no siempre manda
      // `title`, y en el panel de ejemplo tiene que verse esa fila —«Anuncio
      // sin título»— porque esos leads también los trajo la publicidad.
      const sinTitulo = deAnuncio && azar() < 0.125;
      const inicio = base + entre(8, 19) * 3600 + entre(0, 59) * 60;

      const { conversacion } = getOrCreateConversation(orgId, canal.id, String(++telefono), {
        nombre: elegir(NOMBRES),
        cuando: inicio,
        origen: deAnuncio ? "anuncio" : null,
        productoAnuncio: deAnuncio && !sinTitulo ? producto.nombre : null,
        // Lo que promete el anuncio. Sin esto la columna del panel sale vacía
        // en los datos de ejemplo y parece que la función no funciona.
        descripcionAnuncio: deAnuncio
          ? `${producto.nombre} desde ${Math.round(producto.precio)} · envío a todo el país · consulta disponibilidad`
          : null,
      });
      const cid = conversacion.id;
      creadas++;

      nuevoMensaje(
        cid,
        "cliente",
        deAnuncio ? `Hola, vi el anuncio de ${producto.nombre.toLowerCase()}, ¿está disponible?` : "Buenas, ¿qué precios manejan?",
        inicio,
      );

      const suerte = azar();

      // ── 45 %: la cierra la IA ──────────────────────────────────────────
      if (suerte < 0.45) {
        nuevoMensaje(cid, "ia", `¡Hola! Sí, tenemos ${producto.nombre.toLowerCase()} en ${producto.precio}. ¿Qué talla buscas?`, inicio + 120);
        nuevoMensaje(cid, "cliente", "La M, ¿y el envío?", inicio + 400);
        const envio = elegir([200, 350]);
        const cierre = inicio + 600;
        nuevoMensaje(
          cid,
          "ia",
          `Resumen: 1 ${producto.nombre.toLowerCase()}, talla M, total ${producto.precio}, envío ${envio}.`,
          cierre,
        );

        // La factura del vendedor llega después. NO reclasifica: es papeleo.
        if (azar() < 0.4) nuevoMensaje(cid, "humano", "[imagen] Aquí tienes la factura", cierre + 900, "imagen");

        sellarCierre(orgId, cid, { cerradoPor: "ia", senal: "resumen_ia", fechaCierre: cierre });
        actualizarConversacion(orgId, cid, {
          total: producto.precio,
          envio,
          producto_vendido: producto.nombre,
          resumen_pedido: `1 ${producto.nombre.toLowerCase()}, talla M, total ${producto.precio}, envío ${envio}`,
          justificacion: "La IA mandó el resumen del pedido sin intervención humana previa.",
          analizada_at: cierre + 60,
        });
        continue;
      }

      // ── 20 %: la cierra un vendedor con la factura ─────────────────────
      if (suerte < 0.65) {
        nuevoMensaje(cid, "ia", "¡Hola! Claro, ahora te confirmo disponibilidad.", inicio + 90);
        nuevoMensaje(cid, "humano", `Buenas, te quedan en ${producto.precio}. ¿Te la aparto?`, inicio + 1800);
        nuevoMensaje(cid, "cliente", "Sí, por favor", inicio + 2100);
        const cierre = inicio + 2700;
        nuevoMensaje(cid, "humano", "[imagen] Factura del pedido", cierre, "imagen");

        const envio = 200;
        sellarCierre(orgId, cid, { cerradoPor: "humano", senal: "imagen_factura", fechaCierre: cierre });
        actualizarConversacion(orgId, cid, {
          total: producto.precio,
          envio,
          producto_vendido: producto.nombre,
          resumen_pedido: `1 ${producto.nombre.toLowerCase()}, total ${producto.precio}, envío ${envio}`,
          justificacion: "El vendedor mandó la factura y la IA no había mandado resumen antes.",
          analizada_at: cierre + 60,
          // Algunas cierran sin el costo de envío: eso es una anomalía real.
          ...(azar() < 0.15 ? { envio: undefined } : {}),
        });

        if (azar() < 0.15) {
          crearAnomalia(orgId, {
            conversationId: cid,
            tipo: "cierre_incompleto",
            severidad: "alta",
            detalle: "Se cerró la venta pero falta el costo de envío.",
          });
        }
        continue;
      }

      // ── 8 %: va a revisión ─────────────────────────────────────────────
      if (suerte < 0.73) {
        nuevoMensaje(cid, "ia", "¡Hola! ¿Qué talla buscas?", inicio + 100);
        nuevoMensaje(cid, "humano", "[imagen sin describir]", inicio + 900, "imagen");
        marcarRevision(orgId, cid, "Hay una imagen del vendedor que no se pudo describir.");
        actualizarConversacion(orgId, cid, { analizada_at: inicio + 1000 });
        continue;
      }

      // ── El resto: se queda abierta ─────────────────────────────────────
      nuevoMensaje(cid, "ia", `Hola, ${producto.nombre.toLowerCase()} cuesta ${producto.precio}. ¿Te interesa?`, inicio + 150);

      if (azar() < 0.5) {
        nuevoMensaje(cid, "cliente", elegir(["Está un poco caro", "¿Tienes fotos reales?", "¿Cuánto es el envío?"]), inicio + 600);
        actualizarConversacion(orgId, cid, {
          motivo_perdida: elegir(["precio", "falta de foto", "costo de envío"]),
          analizada_at: inicio + 700,
        });
      } else {
        actualizarConversacion(orgId, cid, { motivo_perdida: "sin respuesta", analizada_at: inicio + 700 });
      }
    }
  }

  // ── Verificación de la invariante, igual que en producción ──────────────
  const rango = { desde: 0, hasta: t + DIA };
  const e = conteoPorEstado(orgId, rango);
  const leads = totalLeads(orgId, rango);
  const cuadra = leads === e.ia + e.humano + e.abierta + e.revision;

  console.log(`
Cuenta de ejemplo lista.

  Entra en /login con:
    correo      ${CORREO}
    contraseña  ${CLAVE}

  ${creadas} conversaciones en 30 días, 2 números, ${PRODUCTOS.length} productos.

  leads             ${leads}
  cerró la IA       ${e.ia}
  cerró el equipo   ${e.humano}
  sin cerrar        ${e.abierta}
  en revisión       ${e.revision}
  invariante        ${cuadra ? "cuadra" : "NO CUADRA — hay conversaciones perdiéndose"}
`);

  if (!cuadra) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
