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
 *   3. Reglas mecánicas: primero el resumen de pedido, que manda sobre la factura
 *   4. Visión solo si en todo el hilo no hubo resumen — describir cuesta dinero
 *   5. Lo que quede, al modelo de texto
 *   6. Lo que el modelo tampoco resuelva, a revisión
 *   7. Verificar la invariante de conteo
 */
import {
  ahora,
  actualizarConversacion,
  anunciosPorDescribir,
  conteoMotivosPerdida,
  conteoPorEstado,
  conversacionesPorAnalizar,
  crearAnomalia,
  getConversation,
  guardarDescripcionAnuncio,
  listarMensajes,
  marcarRevision,
  MODELO_ANALISIS,
  MODELO_VISION,
  obtenerOrg,
  sellarCierre,
  totalLeads,
  abiertasSinMotivo,
  type CategoriaImagen,
  type Conversacion,
  type Mensaje,
  type Rango,
} from "./db";
import { anuncioParaModelo } from "./anuncio";
// El marcador lo reconoce `cierre.ts`, que es quien sella al entrar el mensaje.
// Aquí se usa la MISMA función: dos formas de leerlo darían dos verdades.
import { contieneMarcador } from "./cierre";
import { completar, completarJson, ErrorIA, type Mensaje as MensajeIA } from "./ia";
import { comoDataUrl } from "./media";
import { describirImagen, transcribirAudio } from "./percepcion";
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


interface Senal {
  quien: "ia" | "humano";
  senal: string;
  cuando: number;
  mensajeId: number;
}

const CIERRA_LA_IMAGEN = (c: CategoriaImagen | null) =>
  c === "factura" || c === "comprobante_pago";

/**
 * La señal que cierra el hilo.
 *
 * EL RESUMEN DE PEDIDO MANDA SOBRE LA FACTURA. Si en algún punto de la
 * conversación aparece el resumen —el mensaje con el marcador—, la venta es de
 * quien lo escribió, aunque una factura le llegue antes o después. La factura
 * sola no reasigna una venta que ya cerró un resumen.
 *
 * Es la única excepción al orden cronológico, y tiene razón de negocio: el
 * resumen es el momento en que el cliente dice que sí y queda cerrado el
 * pedido; la factura que un vendedor manda después —o incluso antes, mientras
 * se despacha— es papeleo alrededor de esa misma venta. Sin esta regla, un
 * vendedor que adelanta la factura le quitaba a la IA una venta que la IA
 * cerró.
 *
 * Se busca en dos pases y ese orden ahorra dinero: el resumen es texto y leerlo
 * no cuesta nada, mientras que reconocer una factura pide visión. Si hay
 * resumen en el hilo, no se describe ni una imagen.
 *
 * Dentro de cada pase sigue mandando el orden, y las señales que comparten
 * segundo se recogen todas para detectar el empate, que va a revisión.
 */
export async function buscarPrimeraSenal(
  marcador: string,
  mensajes: Mensaje[],
  describir: (m: Mensaje) => Promise<CategoriaImagen | null>,
): Promise<{ senales: Senal[]; imagenSinDescribir: boolean }> {
  // ── Pase 1: el resumen de pedido. Es leer texto: ni un modelo. ──────────
  /*
   * De quién es el resumen lo decide QUIÉN LO ESCRIBIÓ, y nada más. Si lo
   * mandó la IA, la venta es de la IA, aunque un vendedor hubiera escrito
   * antes en el hilo. Que una persona metiera mano se ve en la pastilla de
   * intervención, que es un dato aparte: quién cerró y si alguien ayudó son
   * dos preguntas distintas. Gemelo de `duenoDelCierre` en `cierre.ts`.
   */
  const texto: Senal[] = [];

  for (const m of mensajes) {
    if (texto.length && m.created_at > texto[0]!.cuando) break;

    const saliente = m.emisor === "ia" || m.emisor === "humano";
    if (!saliente || !contieneMarcador(m.content, marcador)) continue;

    texto.push(
      m.emisor === "ia"
        ? { quien: "ia", senal: "resumen_ia", cuando: m.created_at, mensajeId: m.id }
        : { quien: "humano", senal: "confirmacion_texto", cuando: m.created_at, mensajeId: m.id },
    );
  }

  if (texto.length) return { senales: texto, imagenSinDescribir: false };

  // ── Pase 2: la factura. Solo si en TODO el hilo no hubo resumen. ────────
  const senales: Senal[] = [];
  let imagenSinDescribir = false;

  for (const m of mensajes) {
    if (senales.length && m.created_at > senales[0]!.cuando) break;
    if (m.emisor !== "humano" || m.tipo !== "imagen") continue;

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

  return { senales, imagenSinDescribir };
}

// ─────────────────────────────────────────────────────────────────────────────
// Visión
// ─────────────────────────────────────────────────────────────────────────────

/* La visión y el audio viven en `percepcion.ts`: los usan el analista, al
   cerrar la venta, y el agente vendedor, antes de contestarle al cliente. */

/**
 * LO QUE DICE LA IMAGEN DEL ANUNCIO.
 *
 * En los anuncios de Facebook e Instagram, el precio y los colores van escritos
 * ENCIMA de la foto muchísimas veces, no en el texto. El cliente llega diciendo
 * «quiero la del anuncio» y el agente, que solo veía el título, no sabía de qué
 * hablaba ni cuánto cuesta.
 *
 * Se describe UNA vez por anuncio y la descripción sirve para todos los leads
 * que traiga —que pueden ser cientos—, así que esto es una llamada al modelo
 * por creatividad publicada, no por cliente.
 *
 * Es texto plano y no JSON a propósito: lo que sale de aquí va tal cual al
 * prompt del agente, y una estructura no aportaría nada que el modelo no lea
 * igual de bien en una frase.
 */
const PROMPT_ANUNCIO = `Esta es la imagen de un anuncio de una tienda. Descríbela para un vendedor que va a atender al cliente que la pinchó.

En dos o tres frases, y solo con lo que SE VE:
- Qué producto es.
- Qué colores o modelos aparecen. Si solo hay uno, dilo: "solo se ve en negro".
- CUALQUIER precio, cifra u oferta escrita en la imagen, copiada tal cual.

Si algo no se ve, no lo menciones. No inventes nada, no adornes y no saludes.`;

export async function describirAnunciosPendientes(orgId: number, limite = 3): Promise<number> {
  const pendientes = anunciosPorDescribir(orgId, limite);
  if (pendientes.length === 0) return 0;

  const org = obtenerOrg(orgId);
  const modeloVision = org?.modelo_vision ?? MODELO_VISION;
  let hechas = 0;

  for (const a of pendientes) {
    const imagen = comoDataUrl(orgId, a.imagen);
    if (!imagen) continue;

    try {
      const r = await completar({
        orgId,
        proposito: "vision",
        modelo: modeloVision,
        mensajes: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT_ANUNCIO },
              { type: "image_url", image_url: { url: imagen } },
            ],
          },
        ] as MensajeIA[],
        maxTokens: 300,
        temperatura: 0,
      });

      const texto = r.texto.trim();
      if (texto) {
        guardarDescripcionAnuncio(orgId, a.ad_id, texto);
        hechas++;
      }
    } catch (e) {
      // Sin descripción, el agente sigue con el título y el texto del anuncio:
      // peor, pero no roto. Se reintenta en el siguiente lead de ese anuncio.
      console.error(`[anuncio] no se pudo describir la imagen del anuncio ${a.ad_id}`, e);
    }
  }

  return hechas;
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
    // Lo que no es texto llega al modelo COMO texto, o no llega: una imagen sin
    // describir y un audio sin transcribir son huecos en la conversación.
    const extra = m.descripcion_imagen
      ? ` (imagen: ${m.descripcion_imagen}${m.categoria_imagen ? `, tipo ${m.categoria_imagen}` : ""})`
      : m.transcripcion
        ? ` (audio: ${m.transcripcion})`
        : "";
    return `[${hora}] ${quien}: ${m.content}${extra}`;
  });

  const aviso =
    mensajes.length > MAX_MENSAJES_PROMPT
      ? `(hilo recortado: se muestran los últimos ${MAX_MENSAJES_PROMPT} de ${mensajes.length} mensajes)\n`
      : "";

  return aviso + lineas.join("\n");
}

/**
 * El hilo, precedido por el anuncio que trajo al cliente.
 *
 * Sin esto el analista lee «quiero dos» y no tiene forma de saber dos de qué:
 * el producto se nombró en el anuncio, no en la conversación, y la venta se
 * quedaba sin nombre en el ranking.
 */
function conElAnuncio(conv: Conversacion, hilo: string): string {
  const anuncio = anuncioParaModelo(conv);
  return anuncio ? `${anuncio}\n\n${hilo}` : hilo;
}

function promptAnalista(
  marcador: string,
  estadoMecanico: Estado | null,
  conAnuncio: boolean,
): string {
  return `Eres un analista de ventas por WhatsApp. Lees una conversación y extraes los datos del pedido.

Responde SOLO con este JSON, sin texto adicional y sin backticks:
{"estado":"cerrada_ia|cerrada_humano|abierta|revision","senal_de_cierre":"resumen_ia|imagen_factura|confirmacion_texto|ninguna","justificacion":"una línea explicando qué señal usaste","resumen_pedido":"producto, cantidad, talla, total, envío","producto_vendido":"nombre normalizado","total":null,"envio":null,"datos_faltantes":[],"cliente_sin_respuesta":false,"motivo_perdida":"precio|falta de foto|costo de envío|sin respuesta|duda no resuelta|no aplica"}

Reglas:
- El mensaje de cierre de la IA lleva el marcador "${marcador}", y valen sus variantes: con palabras en medio ("${marcador.replace(/:\s*$/, "")} de su pedido:") o como título de una línea, sin dos puntos ("${marcador.replace(/:\s*$/, "").toUpperCase()} DEL PEDIDO"). Las tres son la misma señal.
- El resumen de pedido MANDA sobre la factura: si en algún punto del hilo aparece el resumen, la venta es de quien lo escribió, aunque la foto de factura llegue antes o después. La factura solo cierra si en todo el hilo no hubo resumen.
- Entre dos señales del mismo tipo gana la PRIMERA, en orden.
- "total" y "envio" son números, sin símbolo de moneda. Si no aparecen, null.
- "total" es TODO lo que el cliente va a pagar, con el envío dentro si lo hay. "envio" es la parte de ese total que es transporte. Si el cliente dice "2500 más 300 de envío", entonces total=2800 y envio=300.
- "datos_faltantes" lista lo que el pedido necesita y no está (talla, color, dirección…).
- Un mensaje que empieza por "[ubicación]" es el cliente mandando su ubicación por WhatsApp: ESO ES LA DIRECCIÓN DE ENTREGA. Si aparece, la dirección no falta, aunque nadie la haya escrito con letras.
- "motivo_perdida" solo si la conversación no cerró; si cerró, "no aplica".${conAnuncio ? `
- Arriba del hilo está el anuncio por el que escribió este cliente. Úsalo para "producto_vendido" cuando la venta cerró y en el hilo nadie llegó a nombrar el producto: es lo que el cliente vino a comprar.
- Que llegara por un anuncio NO cierra nada. Si no hay señal de cierre, la conversación está abierta igual.` : ""}
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

  /*
   * Sellada Y ya analizada: no se toca. Ni se describen sus imágenes, que es
   * donde se iba la mayor parte del gasto de visión.
   *
   * Sellada pero SIN analizar es otra cosa: es una venta que se cerró sola al
   * llegar el mensaje con el marcador. Quién cerró ya está decidido y no se
   * vuelve a tocar, pero el pedido —producto, total, envío— sigue sin sacar, y
   * es lo que hace falta para que la venta facture. Antes esta rama la
   * devolvía intacta y esas ventas se quedaban en cero para siempre.
   */
  if (conv.fecha_cierre !== null && conv.analizada_at !== null) {
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
  const modeloTexto = org?.modelo_analisis ?? MODELO_ANALISIS;
  const modeloVision = org?.modelo_vision ?? MODELO_VISION;
  const modeloAudio = org?.modelo_audio ?? "google/gemini-3.5-flash-lite";

  const mensajes = listarMensajes(orgId, conversationId);
  if (!mensajes.length) {
    actualizarConversacion(orgId, conversationId, { analizada_at: ahora() });
    return { conversationId, estado: "abierta", senal: null, justificacion: null, sellada: false };
  }

  /*
   * Las notas de voz se pasan a texto ANTES de mirar las reglas. Si se hiciera
   * después, el analista decidiría sobre una conversación con agujeros: un
   * «sí, mándamelo» dicho en un audio es un cierre, y sin transcribir es
   * invisible para todas las reglas que vienen a continuación.
   */
  await Promise.all(
    mensajes
      .filter((m) => m.tipo === "audio" && !m.transcripcion && m.media_url)
      .map((m) => transcribirAudio(orgId, modeloAudio, m)),
  );

  // Se releen: las transcripciones acaban de escribirse y la copia en memoria
  // es anterior a ellas.
  const conAudio = listarMensajes(orgId, conversationId);

  // ── Paso 3 y 4: reglas mecánicas, con visión solo si hace falta ──────────
  /*
   * Si la conversación ya venía sellada, este paso se salta ENTERO.
   *
   * Quién cerró está decidido desde que entró el mensaje con el marcador, y
   * volver a buscarlo no cambiaría nada —`sellarCierre` no reclasifica— pero sí
   * pagaría la visión de todas las imágenes del hilo. Aquí solo queda extraer
   * el pedido, y para eso basta el modelo de texto.
   */
  const yaSellada = conv.fecha_cierre !== null;

  let senales: Senal[] = [];
  let estado: Estado | null = yaSellada && conv.cerrado_por !== "revision" ? conv.cerrado_por : null;
  let senal: string | null = yaSellada ? conv.senal_de_cierre : null;
  let motivoRevision: string | null = null;

  if (!yaSellada) {
    const mecanicas = await buscarPrimeraSenal(marcador, conAudio, (m) =>
      describirImagen(orgId, modeloVision, m),
    );
    senales = mecanicas.senales;

    if (senales.length) {
      const distintos = new Set(senales.map((x) => x.quien));
      if (distintos.size > 1) {
        // Empate de marcas de tiempo: dos señales en el mismo segundo y de
        // dueños distintos. No se adivina, va a revisión.
        estado = "revision";
        motivoRevision = "Dos señales de cierre con la misma hora: no se puede saber cuál fue primero.";
      } else {
        estado = senales[0]!.quien;
        senal = senales[0]!.senal;
      }
    } else if (mecanicas.imagenSinDescribir) {
      estado = "revision";
      motivoRevision = "Hay una imagen del vendedor que no se pudo describir.";
    }
  }

  // ── Paso 5: el modelo de texto ──────────────────────────────────────────
  /*
   * Se relee el hilo por última vez. Las transcripciones y las descripciones
   * de imagen se acaban de escribir en los pasos 3 y 4, y la copia `mensajes`
   * es anterior a todas: pasándole esa, el analista leería «[nota de voz]» y
   * «[imagen]» a secas, que son justo los huecos que esos dos pasos tapan.
   */
  const completos = listarMensajes(orgId, conversationId);

  let salida: SalidaAnalista | null = null;
  let falloModelo = false;

  try {
    const r = await completarJson<SalidaAnalista>({
      orgId,
      proposito: "analisis",
      modelo: modeloTexto,
      mensajes: [
        {
          role: "system",
          content: promptAnalista(
            marcador,
            estado === "revision" ? null : estado,
            anuncioParaModelo(conv) !== null,
          ),
        },
        { role: "user", content: conElAnuncio(conv, transcribir(completos)) },
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
  // Una conversación ya sellada nunca entra aquí: su estado no está en duda,
  // solo faltaba el pedido.
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
    /*
     * Si el modelo falló en una venta que ya estaba sellada, NO se marca como
     * analizada. El cierre está contado —eso no dependía del modelo—, pero el
     * pedido sigue sin extraer: darla por analizada la sacaría de la cola y esa
     * venta facturaría cero para siempre sin que nada lo señalara. Así el
     * siguiente barrido vuelve a intentarlo.
     */
    analizada_at: yaSellada && falloModelo ? undefined : ahora(),
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
  const modelo = org?.modelo_analisis ?? MODELO_ANALISIS;

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
