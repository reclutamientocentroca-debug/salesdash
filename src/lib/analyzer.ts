/**
 * SalesDash — IA analista.
 *
 * ═══ SOLO LECTURA ═══
 * Este módulo mira, cuenta, verifica y reporta. NO contesta. No importa
 * `agent.ts`, ni la función de envío, ni nada que hable con un cliente. Si
 * algún día aparece aquí un import de envío, está mal el diseño, no el import.
 *
 * Orden de ejecución, y este orden importa:
 *   1. Barrer los hilos con actividad; los ya sellados no se reevalúan
 *   2. Ordenar los mensajes por created_at ascendente
 *   3. Reglas mecánicas hasta la PRIMERA señal de cierre, y detenerse
 *   4. Visión solo para imágenes de hilos sin cierre asignado
 *   5. Lo que quede, al modelo de texto
 *   6. Lo que el modelo tampoco resuelva, a revisión
 *   7. Verificar la invariante de conteo
 */
import {
  ahora,
  actualizarConversacion,
  conteoMotivosPerdida,
  conteoPorEstado,
  conversacionesPorAnalizar,
  crearAnomalia,
  getConversation,
  guardarDescripcionImagen,
  listarMensajes,
  marcarRevision,
  obtenerOrg,
  sellarCierre,
  totalLeads,
  abiertasSinMotivo,
  type CategoriaImagen,
  type Conversacion,
  type Mensaje,
  type Rango,
} from "./db";
import { completarJson, ErrorIA, type Mensaje as MensajeIA } from "./ia";
import { revisarConversacion } from "./anomalies";

/** Tope de mensajes que se le pasan al modelo, para no dispararse en tokens. */
const MAX_MENSAJES_PROMPT = 60;

export type Estado = "ia" | "humano" | "abierta" | "revision";

export interface ResultadoAnalisis {
  conversationId: number;
  estado: Estado;
  senal: string | null;
  justificacion: string | null;
  /** true si la conversación ya estaba sellada y no se tocó. */
  sellada: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas mecánicas
// ─────────────────────────────────────────────────────────────────────────────

function contieneMarcador(texto: string, marcador: string): boolean {
  return texto.toLowerCase().includes(marcador.toLowerCase().trim());
}

interface Senal {
  quien: "ia" | "humano";
  senal: string;
  cuando: number;
  mensajeId: number;
}

const CIERRA_LA_IMAGEN = (c: CategoriaImagen | null) =>
  c === "factura" || c === "comprobante_pago";

/**
 * Recorre el hilo en orden y devuelve la PRIMERA señal de cierre.
 *
 * Sigue recogiendo señales que compartan ese mismo segundo para detectar el
 * empate de marcas de tiempo, que va a revisión. En cuanto aparece una señal
 * posterior, se detiene: lo que venga después no reclasifica nada.
 */
export async function buscarPrimeraSenal(
  marcador: string,
  mensajes: Mensaje[],
  describir: (m: Mensaje) => Promise<CategoriaImagen | null>,
): Promise<{ senales: Senal[]; imagenSinDescribir: boolean }> {
  const senales: Senal[] = [];
  let humanoAntes = false;
  let resumenIaAntes = false;
  let imagenSinDescribir = false;

  for (const m of mensajes) {
    // Ya hay una señal y este mensaje es posterior: se acabó la búsqueda.
    if (senales.length && m.created_at > senales[0]!.cuando) break;

    const saliente = m.emisor === "ia" || m.emisor === "humano";

    // ── Señal de texto con el marcador de cierre ──────────────────────────
    if (saliente && contieneMarcador(m.content, marcador)) {
      if (m.emisor === "ia" && !humanoAntes) {
        senales.push({ quien: "ia", senal: "resumen_ia", cuando: m.created_at, mensajeId: m.id });
      } else if (m.emisor === "ia") {
        // La IA mandó el resumen pero un vendedor ya había escrito antes:
        // por la regla de atribución, la venta es del humano.
        senales.push({
          quien: "humano",
          senal: "resumen_tras_intervencion",
          cuando: m.created_at,
          mensajeId: m.id,
        });
      } else {
        senales.push({
          quien: "humano",
          senal: "confirmacion_texto",
          cuando: m.created_at,
          mensajeId: m.id,
        });
      }
    }

    // ── Señal de imagen: la factura que manda el vendedor ─────────────────
    // Solo cuenta si la IA NO mandó resumen antes. Ese "antes" es literal.
    else if (m.emisor === "humano" && m.tipo === "imagen" && !resumenIaAntes) {
      const categoria = m.categoria_imagen ?? (await describir(m));

      if (categoria === null) {
        // No se pudo describir. Nunca se asume que era una factura.
        imagenSinDescribir = true;
      } else if (CIERRA_LA_IMAGEN(categoria)) {
        senales.push({
          quien: "humano",
          senal: categoria === "factura" ? "imagen_factura" : "imagen_comprobante",
          cuando: m.created_at,
          mensajeId: m.id,
        });
      }
      // `foto_producto` no cierra nada: el hilo sigue abierto.
    }

    // El estado se actualiza DESPUÉS de evaluar el mensaje: un mensaje no se
    // precede a sí mismo.
    if (m.emisor === "humano") humanoAntes = true;
    if (m.emisor === "ia" && contieneMarcador(m.content, marcador)) resumenIaAntes = true;
  }

  return { senales, imagenSinDescribir };
}

// ─────────────────────────────────────────────────────────────────────────────
// Visión
// ─────────────────────────────────────────────────────────────────────────────

interface DescripcionImagen {
  categoria?: string;
  descripcion?: string;
  monto_detectado?: number | null;
  productos_detectados?: string[];
}

const CATEGORIAS: CategoriaImagen[] = ["factura", "comprobante_pago", "foto_producto", "otro"];

const PROMPT_VISION = `Eres un analista de ventas. Mira la imagen y clasifícala.

Responde SOLO con este JSON, sin texto adicional y sin backticks:
{"categoria":"factura|comprobante_pago|foto_producto|otro","descripcion":"una línea de qué se ve","monto_detectado":null,"productos_detectados":[]}

Criterios:
- factura: una factura, recibo o nota de pedido emitida por el negocio
- comprobante_pago: captura de una transferencia, depósito o pago del cliente
- foto_producto: una foto del artículo, para que el cliente lo vea
- otro: cualquier otra cosa`;

/**
 * Describe una imagen y guarda el resultado. La descripción se genera UNA vez
 * y se guarda: no se vuelve a pedir nunca.
 *
 * El archivo no se descarga ni se almacena: se le pasa al modelo la URL
 * temporal de Whapi y se guarda solo la descripción.
 */
async function describirImagen(
  orgId: number,
  modeloVision: string,
  m: Mensaje,
): Promise<CategoriaImagen | null> {
  if (!m.media_url) {
    guardarDescripcionImagen(orgId, m.id, { descripcion: "[imagen sin describir]", categoria: null });
    return null;
  }

  try {
    const { datos } = await completarJson<DescripcionImagen>({
      orgId,
      proposito: "vision",
      modelo: modeloVision,
      mensajes: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT_VISION },
            { type: "image_url", image_url: { url: m.media_url } },
          ],
        },
      ] as MensajeIA[],
      maxTokens: 300,
      temperatura: 0,
    });

    const categoria = CATEGORIAS.includes(datos?.categoria as CategoriaImagen)
      ? (datos!.categoria as CategoriaImagen)
      : null;

    guardarDescripcionImagen(orgId, m.id, {
      descripcion: datos?.descripcion?.trim() || "[imagen sin describir]",
      categoria,
    });

    return categoria;
  } catch (e) {
    // Modelo caído o sin cuota: la imagen queda sin describir y el hilo va a
    // revisión. Nunca se asume que era una factura.
    console.error("Visión no disponible:", e instanceof ErrorIA ? e.message : e);
    guardarDescripcionImagen(orgId, m.id, { descripcion: "[imagen sin describir]", categoria: null });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modelo de texto
// ─────────────────────────────────────────────────────────────────────────────

export interface SalidaAnalista {
  estado?: string;
  senal_de_cierre?: string;
  justificacion?: string;
  resumen_pedido?: string;
  producto_vendido?: string;
  total?: number | null;
  envio?: number | null;
  datos_faltantes?: string[];
  cliente_sin_respuesta?: boolean;
  motivo_perdida?: string;
}

function transcribir(mensajes: Mensaje[]): string {
  const usados =
    mensajes.length <= MAX_MENSAJES_PROMPT ? mensajes : mensajes.slice(-MAX_MENSAJES_PROMPT);

  const lineas = usados.map((m) => {
    const quien = m.emisor === "cliente" ? "CLIENTE" : m.emisor === "ia" ? "IA" : "VENDEDOR";
    const hora = new Date(m.created_at * 1000).toISOString().slice(5, 16).replace("T", " ");
    const extra = m.descripcion_imagen
      ? ` (imagen: ${m.descripcion_imagen}${m.categoria_imagen ? `, tipo ${m.categoria_imagen}` : ""})`
      : "";
    return `[${hora}] ${quien}: ${m.content}${extra}`;
  });

  const aviso =
    mensajes.length > MAX_MENSAJES_PROMPT
      ? `(hilo recortado: se muestran los últimos ${MAX_MENSAJES_PROMPT} de ${mensajes.length} mensajes)\n`
      : "";

  return aviso + lineas.join("\n");
}

function promptAnalista(marcador: string, estadoMecanico: Estado | null): string {
  return `Eres un analista de ventas por WhatsApp. Lees una conversación y extraes los datos del pedido.

Responde SOLO con este JSON, sin texto adicional y sin backticks:
{"estado":"cerrada_ia|cerrada_humano|abierta|revision","senal_de_cierre":"resumen_ia|imagen_factura|confirmacion_texto|ninguna","justificacion":"una línea explicando qué señal usaste","resumen_pedido":"producto, cantidad, talla, total, envío","producto_vendido":"nombre normalizado","total":null,"envio":null,"datos_faltantes":[],"cliente_sin_respuesta":false,"motivo_perdida":"precio|falta de foto|costo de envío|sin respuesta|duda no resuelta|no aplica"}

Reglas:
- El mensaje de cierre de la IA contiene el marcador "${marcador}".
- La venta pertenece a quien produjo la PRIMERA señal de cierre. Lo posterior no cuenta.
- "total" y "envio" son números, sin símbolo de moneda. Si no aparecen, null.
- "datos_faltantes" lista lo que el pedido necesita y no está (talla, color, dirección…).
- "motivo_perdida" solo si la conversación no cerró; si cerró, "no aplica".
${
  estadoMecanico
    ? `- El estado YA está determinado como "${estadoMecanico}". Respétalo y limítate a extraer los datos del pedido.`
    : `- Si NO hay ninguna señal de cierre, el estado es "abierta". Que la conversación siga viva no es una duda: es una conversación abierta.
- Usa "revision" SOLO cuando sí hay indicios de que el pedido se cerró (se habla de pago, de entrega, de una factura) pero no puedes saber si lo cerró la IA o un vendedor. Es un caso raro: si dudas entre "abierta" y "revision", elige "abierta".`
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Análisis de una conversación
// ─────────────────────────────────────────────────────────────────────────────

export async function analizarConversacion(
  orgId: number,
  conversationId: number,
): Promise<ResultadoAnalisis> {
  const conv = getConversation(orgId, conversationId);
  if (!conv) throw new Error("La conversación no existe");

  // Sellada: no se reevalúa. Ni se describen sus imágenes, que es donde se
  // iba la mayor parte del gasto de visión.
  if (conv.fecha_cierre !== null) {
    return {
      conversationId,
      estado: conv.cerrado_por,
      senal: conv.senal_de_cierre,
      justificacion: conv.justificacion,
      sellada: true,
    };
  }

  const org = obtenerOrg(orgId);
  const marcador = org?.marcador_cierre ?? "Resumen:";
  const modeloTexto = org?.modelo_analisis ?? "meta-llama/llama-3.3-70b-instruct:free";
  const modeloVision = org?.modelo_vision ?? "openai/gpt-4o-mini";

  const mensajes = listarMensajes(orgId, conversationId);
  if (!mensajes.length) {
    actualizarConversacion(orgId, conversationId, { analizada_at: ahora() });
    return { conversationId, estado: "abierta", senal: null, justificacion: null, sellada: false };
  }

  // ── Paso 3 y 4: reglas mecánicas, con visión solo si hace falta ──────────
  const { senales, imagenSinDescribir } = await buscarPrimeraSenal(marcador, mensajes, (m) =>
    describirImagen(orgId, modeloVision, m),
  );

  let estado: Estado | null = null;
  let senal: string | null = null;
  let motivoRevision: string | null = null;

  if (senales.length) {
    const distintos = new Set(senales.map((s) => s.quien));
    if (distintos.size > 1) {
      // Empate de marcas de tiempo: dos señales en el mismo segundo y de
      // dueños distintos. No se adivina, va a revisión.
      estado = "revision";
      motivoRevision = "Dos señales de cierre con la misma hora: no se puede saber cuál fue primero.";
    } else {
      estado = senales[0]!.quien;
      senal = senales[0]!.senal;
    }
  } else if (imagenSinDescribir) {
    estado = "revision";
    motivoRevision = "Hay una imagen del vendedor que no se pudo describir.";
  }

  // ── Paso 5: el modelo de texto ──────────────────────────────────────────
  let salida: SalidaAnalista | null = null;
  let falloModelo = false;

  try {
    const r = await completarJson<SalidaAnalista>({
      orgId,
      proposito: "analisis",
      modelo: modeloTexto,
      mensajes: [
        { role: "system", content: promptAnalista(marcador, estado === "revision" ? null : estado) },
        { role: "user", content: transcribir(mensajes) },
      ],
      maxTokens: 600,
      temperatura: 0,
    });
    salida = r.datos;
  } catch (e) {
    falloModelo = true;
    console.error("El analista no pudo consultar el modelo:", e instanceof ErrorIA ? e.message : e);
  }

  // ── Paso 6: lo que no se resolvió, a revisión ───────────────────────────
  if (estado === null) {
    const delModelo = traducirEstado(salida?.estado);
    if (delModelo === null) {
      estado = "revision";
      motivoRevision = falloModelo
        ? "El modelo de análisis no respondió."
        : "El modelo no devolvió una clasificación utilizable.";
    } else {
      estado = delModelo;
      senal = salida?.senal_de_cierre && salida.senal_de_cierre !== "ninguna" ? salida.senal_de_cierre : null;
    }
  }

  // ── Guardado ────────────────────────────────────────────────────────────
  const justificacion = motivoRevision ?? salida?.justificacion?.trim() ?? null;

  actualizarConversacion(orgId, conversationId, {
    resumen_pedido: salida?.resumen_pedido?.trim() || undefined,
    producto_vendido: salida?.producto_vendido?.trim() || undefined,
    total: numeroODescartar(salida?.total),
    envio: numeroODescartar(salida?.envio),
    datos_faltantes: salida?.datos_faltantes?.length ? JSON.stringify(salida.datos_faltantes) : undefined,
    motivo_perdida:
      estado === "abierta" && salida?.motivo_perdida && salida.motivo_perdida !== "no aplica"
        ? salida.motivo_perdida
        : undefined,
    justificacion: justificacion ?? undefined,
    analizada_at: ahora(),
  });

  if (estado === "ia" || estado === "humano") {
    // La regla maestra vive en el UPDATE: si otro proceso selló primero, este
    // no reclasifica nada.
    const cuando = senales[0]?.cuando ?? conv.last_message_at ?? ahora();
    sellarCierre(orgId, conversationId, {
      cerradoPor: estado,
      senal: senal ?? "sin_senal",
      fechaCierre: cuando,
    });
  } else if (estado === "revision") {
    marcarRevision(orgId, conversationId, justificacion ?? "Necesita una revisión humana.");
  }

  // Anomalías sobre el estado ya guardado.
  const actualizada = getConversation(orgId, conversationId);
  if (actualizada) revisarConversacion(orgId, actualizada, mensajes);

  return { conversationId, estado, senal, justificacion, sellada: false };
}

function numeroODescartar(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function traducirEstado(bruto: string | undefined): Estado | null {
  switch ((bruto ?? "").trim().toLowerCase()) {
    case "cerrada_ia":
    case "ia":
      return "ia";
    case "cerrada_humano":
    case "humano":
      return "humano";
    case "abierta":
      return "abierta";
    case "revision":
    case "revisión":
      return "revision";
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Barrido diario
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumenBarrido {
  analizadas: number;
  por_estado: Record<Estado, number>;
  cuadra: boolean;
}

/**
 * Barre los hilos con actividad desde `desde` más los que sigan abiertos de
 * días anteriores. Los sellados no se tocan.
 *
 * Se ejecuta cuando alguien lo pide desde el panel, nunca solo sobre todo el
 * histórico.
 */
export async function analizarLote(
  orgId: number,
  desde: number,
  limite = 50,
): Promise<ResumenBarrido> {
  const pendientes = conversacionesPorAnalizar(orgId, desde).slice(0, limite);
  const por_estado: Record<Estado, number> = { ia: 0, humano: 0, abierta: 0, revision: 0 };

  for (const conv of pendientes) {
    try {
      const r = await analizarConversacion(orgId, conv.id);
      por_estado[r.estado]++;
    } catch (e) {
      console.error(`No se pudo analizar la conversación ${conv.id}:`, e);
      marcarRevision(orgId, conv.id, "El análisis falló. Revísala a mano.");
      por_estado.revision++;
    }
  }

  // ── Paso 7: la invariante ───────────────────────────────────────────────
  const rango: Rango = { desde, hasta: ahora() };
  const estados = conteoPorEstado(orgId, rango);
  const leads = totalLeads(orgId, rango);
  const cuadra = leads === estados.ia + estados.humano + estados.abierta + estados.revision;

  if (!cuadra) {
    // Si esto salta, hay conversaciones perdiéndose y el reporte es falso.
    console.error(
      `INVARIANTE ROTA en la organización ${orgId}: ` +
        `leads=${leads} pero ia+humano+abierta+revision=${
          estados.ia + estados.humano + estados.abierta + estados.revision
        }`,
    );
  }

  return { analizadas: pendientes.length, por_estado, cuadra };
}

// ─────────────────────────────────────────────────────────────────────────────
// Por qué se caen las que no cierran
// ─────────────────────────────────────────────────────────────────────────────

const PROMPT_PERDIDA = `Eres un analista de ventas por WhatsApp. Esta conversación no terminó en venta.

Responde SOLO con este JSON, sin texto adicional y sin backticks:
{"motivo_perdida":"precio|falta de foto|costo de envío|sin respuesta|duda no resuelta|no aplica","cliente_sin_respuesta":false,"justificacion":"una línea"}

Elige el motivo que mejor explique por qué no cerró. Si el cliente dejó de responder sin dar razón, usa "sin respuesta".`;

export interface Perdidas {
  analizadas: number;
  motivos: { motivo: string; n: number }[];
}

/**
 * El segmento sin cerrar suele ser el más grande y nadie sabe por qué se cae.
 * Se analiza una muestra, no todo: el objetivo es la proporción, no el censo.
 */
export async function analizarPerdidas(
  orgId: number,
  rango: Rango,
  muestra = 25,
): Promise<Perdidas> {
  const org = obtenerOrg(orgId);
  const modelo = org?.modelo_analisis ?? "meta-llama/llama-3.3-70b-instruct:free";

  const candidatas = abiertasSinMotivo(orgId, rango, muestra);
  let analizadas = 0;

  for (const conv of candidatas) {
    const mensajes = listarMensajes(orgId, conv.id);
    if (!mensajes.length) continue;

    try {
      const { datos } = await completarJson<SalidaAnalista>({
        orgId,
        proposito: "analisis",
        modelo,
        mensajes: [
          { role: "system", content: PROMPT_PERDIDA },
          { role: "user", content: transcribir(mensajes) },
        ],
        maxTokens: 250,
        temperatura: 0,
      });

      if (datos?.motivo_perdida) {
        actualizarConversacion(orgId, conv.id, {
          motivo_perdida: datos.motivo_perdida,
          analizada_at: ahora(),
        });
        analizadas++;
      }
    } catch (e) {
      console.error(`No se pudo analizar la pérdida de ${conv.id}:`, e instanceof ErrorIA ? e.message : e);
      // Sin cuota o sin conexión: se corta, no tiene sentido insistir 25 veces.
      break;
    }
  }

  return { analizadas, motivos: conteoMotivosPerdida(orgId, rango) };
}

/** Corrección manual desde la bandeja de revisión. */
export function anomaliaDeCorreccion(orgId: number, conversationId: number, quien: "ia" | "humano"): void {
  crearAnomalia(orgId, {
    conversationId,
    tipo: "correccion_manual",
    severidad: "media",
    detalle: `Una persona clasificó este cierre como ${quien === "ia" ? "de la IA" : "del vendedor"}.`,
  });
}
