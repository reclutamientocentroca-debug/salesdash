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
  anunciosConDescripcionSospechosa,
  anunciosPorDescribir,
  conteoMotivosPerdida,
  conteoPorEstado,
  conversacionesPorAnalizar,
  crearAnomalia,
  getConversation,
  guardarDescripcionAnuncio,
  fotosPorMirarTrasElCierre,
  listarMensajes,
  marcarFacturada,
  marcarRevision,
  MODELO_ANALISIS,
  MODELO_VISION,
  obtenerOrg,
  reencolarDescripcionAnuncio,
  sellarCierre,
  totalLeads,
  abiertasSinMotivo,
  type CategoriaImagen,
  type Conversacion,
  type Mensaje,
  type Rango,
} from "./db";
import { ANUNCIO_SIN_DESCRIBIR, anuncioParaModelo } from "./anuncio";
// El resumen lo reconoce `cierre.ts`, que es quien sella al entrar el mensaje.
// Aquí se usa la MISMA función: dos formas de leerlo darían dos verdades.
import { confirmarVentaConFactura, esResumenDePedido } from "./cierre";
import { completar, completarJson, ErrorIA, type Mensaje as MensajeIA } from "./ia";
import { comoDataUrl } from "./media";
import { describirImagen, transcribirAudio } from "./percepcion";
import { nombraUnArticulo } from "./apertura";
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
 * La señal que cierra el hilo, y de qué lado cae.
 *
 * SOLO HAY DOS SEÑALES, y cada una tiene dueño fijo:
 *
 *   - EL RESUMEN DE PEDIDO → AUTOMATIZADA. Da igual quién lo mandara: nuestro
 *     agente, el bot propio del dueño en un número que solo vigilamos, o el
 *     móvil de un vendedor que copia el formato. Desde que se manda el resumen,
 *     el pedido lo cerró la máquina.
 *   - LA FOTO DE LA FACTURA, y solo si en TODO el hilo no hubo resumen →
 *     ASISTIDA. Ahí no hay resumen que cerrara el pedido: lo cerró una persona
 *     mandando el papeleo desde su móvil.
 *
 * De ahí sale la regla que manda sobre todo lo demás: EL RESUMEN MANDA SOBRE LA
 * FACTURA. Si en algún punto del hilo aparece el resumen, la venta es
 * automatizada aunque la factura llegue antes o después. Es la única excepción
 * al orden cronológico y tiene razón de negocio: el resumen es el momento en que
 * el cliente dice que sí y queda cerrado el pedido; la factura es papeleo
 * alrededor de esa misma venta.
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
   * TODO resumen es de la IA, y no se mira el emisor. Desde fuera, el resumen
   * que escribe un bot ajeno y el que escribe una persona son el mismo mensaje;
   * suponer por el emisor era justo lo que le acreditaba al equipo las ventas
   * que cerró una máquina. Que una persona metiera mano en el hilo se lee en la
   * pastilla de intervención, que es un dato aparte: quién cerró y si alguien
   * ayudó son dos preguntas distintas. Gemelo de `duenoDelCierre` en `cierre.ts`.
   */
  const texto: Senal[] = [];

  for (const m of mensajes) {
    if (texto.length && m.created_at > texto[0]!.cuando) break;

    const saliente = m.emisor === "ia" || m.emisor === "humano";
    if (!saliente || !esResumenDePedido(m.content, marcador)) continue;

    texto.push({ quien: "ia", senal: "resumen_ia", cuando: m.created_at, mensajeId: m.id });
  }

  if (texto.length) return { senales: texto, imagenSinDescribir: false };

  /*
   * ── Pase 2: la factura. Solo si en TODO el hilo no hubo resumen. ────────
   *
   * Vale cualquier imagen SALIENTE, no solo las marcadas como de un vendedor.
   * En un número en modo vigilar todo lo que sale se guarda como de la IA
   * —porque desde fuera no hay forma de distinguirlo—, y con el filtro puesto
   * en `emisor === "humano"` la foto de la factura de esos números no cerraba
   * nada: el hilo se quedaba abierto para siempre. Ningún bot manda fotos de
   * facturas; la manda una persona, y por eso esta señal es asistida venga
   * marcada como venga.
   */
  const senales: Senal[] = [];
  let imagenSinDescribir = false;

  for (const m of mensajes) {
    if (senales.length && m.created_at > senales[0]!.cuando) break;
    if (m.emisor === "cliente" || m.tipo !== "imagen") continue;

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
 * En los anuncios de Facebook e Instagram, el precio, los colores y las tallas
 * van escritos ENCIMA de la foto muchísimas veces, no en el texto. El cliente
 * llega diciendo «quiero la del anuncio» y el agente, que solo veía el título,
 * no sabía de qué hablaba ni cuánto cuesta.
 *
 * Y LA TALLA Y EL COLOR SE DICEN AUNQUE NO LOS HAYA. Con esta descripción
 * delante, el agente decide si le pregunta al cliente la talla y el color o si
 * es un artículo que no los lleva —una licuadora, un perfume— y no hay nada que
 * preguntar. Callarlos porque no se ven deja las dos cosas con la misma cara, y
 * lo que sale de ahí es preguntarle la talla a quien compra una plancha.
 *
 * Se describe UNA vez por anuncio y la descripción sirve para todos los leads
 * que traiga —que pueden ser cientos—, así que esto es una llamada al modelo
 * por creatividad publicada, no por cliente.
 *
 * Es texto plano y no JSON a propósito: lo que sale de aquí va tal cual al
 * prompt del agente, y una estructura no aportaría nada que el modelo no lea
 * igual de bien en una frase.
 */
export function promptAnuncio(a: { titulo: string | null; texto: string | null }): string {
  /*
   * EL ARTÍCULO SE LE DICE, NO SE LE PREGUNTA. Sin esto, la visión miraba una
   * prenda extendida sobre una cama y escribía que el anuncio era de ropa de
   * cama; esa frase iba al prompt del agente, y el agente le decía al cliente
   * que vendía algo que la tienda no vende. El texto del anuncio lo escribió
   * el negocio y es el que dice qué artículo es; la imagen solo aporta lo que
   * va escrito encima.
   */
  const dicho = [a.texto?.trim(), a.titulo?.trim()].filter(Boolean);
  /*
   * SOLO SE ANCLA A UN NOMBRE QUE DE VERDAD NOMBRE UN ARTÍCULO.
   *
   * La captura de la dueña (Costa Rica, 2026-09-23): un anuncio sin post
   * detrás traía como título «Anuncio en estados» —así organizó el negocio
   * la campaña en Meta, no el nombre del producto— y la visión, obligada a
   * repetirlo, contestó «Anuncio en estados. Solo se ve en negro...» en vez
   * de mirar la foto. Un texto que no nombra ropa, calzado ni nada
   * reconocible no es el nombre de un producto: ahí es mejor dejar que la
   * visión mire la imagen y diga lo que ve, que forzarla a repetir una
   * etiqueta interna de la campaña. Ver `nombraUnArticulo`.
   */
  const nombraArticulo = dicho.length > 0 && nombraUnArticulo(dicho[0]!);
  const articulo = nombraArticulo
    ? `EL ANUNCIO ES DE ESTE ARTÍCULO, según lo escribió la tienda: «${dicho[0]}». Ese es el producto y así se llama: NO lo cambies por otro por lo que creas ver. El fondo, el mueble o la tela sobre la que está puesto no son el producto.\n\n`
    : "";

  return `Esta es la imagen de un anuncio de una tienda. Descríbela para un vendedor que va a atender al cliente que la pinchó.

${articulo}En dos o tres frases, y solo con lo que SE VE:
- Qué producto es${nombraArticulo ? ", repitiendo el nombre que la tienda le dio arriba" : " — mirando la imagen: lo que la tienda escribió ahí no nombra ningún producto, así que no lo repitas ni lo menciones"}.
- Qué colores aparecen. Si solo hay uno, dilo: "solo se ve en negro". Si no hay colores a elegir, dilo también.
- Qué TALLAS o medidas se leen, copiadas tal cual: "S, M, L, XL", "de la 36 a la 42". Si no se lee ninguna, dilo: "no se ve ninguna talla".
- CUALQUIER precio, cifra u oferta escrita en la imagen, copiada tal cual.

La talla y el color SE DICEN SIEMPRE, aunque sea para decir que no los hay: quien lea esto decide con ello si se los pregunta al cliente, y callarlos es lo que le hace preguntar una talla que ese artículo no tiene. Del resto, lo que no se vea no lo menciones. No inventes nada, no adornes y no saludes.`;
}



export async function describirAnunciosPendientes(
  orgId: number,
  limite = 3,
  /**
   * Cuánto se espera a cada imagen. El analista puede permitirse el minuto
   * entero; la ingesta, que tiene un cliente esperando respuesta, no.
   */
  timeoutMs?: number,
): Promise<number> {
  /*
   * REENCOLA LOS QUE SE DESCRIBIERON MAL, ANTES DE MIRAR LOS PENDIENTES.
   * Ver `anunciosConDescripcionSospechosa`: solo los que de verdad tienen un
   * título sin nombre de producto vuelven a la cola. Barato —un SELECT
   * acotado— y corre en el mismo sitio que ya se llama por cada lead nuevo.
   */
  for (const a of anunciosConDescripcionSospechosa(orgId, limite)) {
    if (!nombraUnArticulo(a.titulo)) reencolarDescripcionAnuncio(orgId, a.ad_id);
  }

  const pendientes = anunciosPorDescribir(orgId, limite);
  if (pendientes.length === 0) return 0;

  const org = obtenerOrg(orgId);
  const modeloVision = org?.modelo_vision ?? MODELO_VISION;
  let hechas = 0;

  for (const a of pendientes) {
    const imagen = comoDataUrl(orgId, a.imagen);
    if (!imagen) {
      // Sin archivo no hay nada que mirar, ni ahora ni nunca: se marca o
      // volveria a salir en esta misma consulta con el proximo mensaje.
      guardarDescripcionAnuncio(orgId, a.ad_id, ANUNCIO_SIN_DESCRIBIR);
      continue;
    }

    try {
      const r = await completar({
        orgId,
        proposito: "vision",
        modelo: modeloVision,
        mensajes: [
          {
            role: "user",
            content: [
              { type: "text", text: promptAnuncio(a) },
              { type: "image_url", image_url: { url: imagen } },
            ],
          },
        ] as MensajeIA[],
        maxTokens: 300,
        temperatura: 0,
        timeoutMs,
      });

      const texto = r.texto.trim();
      guardarDescripcionAnuncio(orgId, a.ad_id, texto || ANUNCIO_SIN_DESCRIBIR);
      if (texto) hechas++;
    } catch (e) {
      /*
       * SE MARCA COMO INTENTADO, Y ESTO NO ES OPCIONAL.
       *
       * Dejar la descripción en NULL parecía inofensivo —«ya se reintentará con
       * el próximo lead»— y era una bomba: esta consulta devuelve el MISMO
       * anuncio fallido una y otra vez, y la llamada corre antes de que el
       * agente conteste. Con la visión caída, cada mensaje de cada cliente de
       * la cuenta se quedaba esperando el minuto entero de esta llamada, y el
       * agente parecía muerto cuando lo que estaba era haciendo cola.
       *
       * Sin descripción el agente sigue teniendo el título y el texto del
       * anuncio: peor, pero contesta. Y contestar es lo que importa.
       */
      console.error(`[anuncio] no se pudo describir la imagen del anuncio ${a.ad_id}`, e);
      guardarDescripcionAnuncio(orgId, a.ad_id, ANUNCIO_SIN_DESCRIBIR);
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
{"estado":"cerrada_ia|cerrada_humano|abierta|revision","senal_de_cierre":"resumen_ia|imagen_factura|ninguna","justificacion":"una línea explicando qué señal usaste","resumen_pedido":"producto, cantidad, talla, total, envío","producto_vendido":"nombre normalizado","total":null,"envio":null,"datos_faltantes":[],"cliente_sin_respuesta":false,"motivo_perdida":"precio|falta de foto|costo de envío|sin respuesta|duda no resuelta|no aplica"}

Reglas:
- El mensaje de cierre de la IA lleva el marcador "${marcador}", y valen sus variantes: con palabras en medio ("${marcador.replace(/:\s*$/, "")} de su pedido:") o como título de una línea, sin dos puntos ("${marcador.replace(/:\s*$/, "").toUpperCase()} DEL PEDIDO"). Las tres son la misma señal.
- SOLO HAY DOS SEÑALES DE CIERRE, y cada una tiene su lado fijo:
  · El resumen de pedido → "cerrada_ia", señal "resumen_ia". SIEMPRE, sin mirar quién lo mandó: da igual que lo escriba la IA o un vendedor desde su móvil. Desde que se manda el resumen, el pedido lo cerró la máquina.
  · La foto de una factura o un comprobante de pago → "cerrada_humano", señal "imagen_factura". SOLO si en todo el hilo no hubo resumen.
- El resumen de pedido MANDA sobre la factura: si en algún punto del hilo aparece el resumen, la venta es "cerrada_ia" aunque la foto de factura llegue antes o después.
- Un "sí, te lo mando", un "confirmado" o cualquier otro texto sin el marcador NO cierra nada. Sin resumen y sin factura, la conversación está abierta.
- Entre dos señales del mismo tipo gana la PRIMERA, en orden.
- SI EL HILO TRAE VARIOS RESÚMENES DE PEDIDO, los datos del pedido —"resumen_pedido", "producto_vendido", "total", "envio"— salen del ÚLTIMO. Ese es el pedido que el cliente va a pagar; los de antes quedaron viejos en cuanto se añadió un artículo o se ajustó el envío. Quién cerró la venta y cuándo ya está decidido y no lo decides tú: aquí solo sacas el pedido bueno.
- "total" y "envio" son números, sin símbolo de moneda. Si no aparecen, null.
- No rellenes "total" ni "envio" a ojo. Si el resumen los deja en blanco, con un guion o con un "por confirmar", van null: una cifra inventada entra en la contabilidad del negocio como si fuera real.
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
- Usa "revision" SOLO cuando sí hay indicios de que el pedido se cerró (se habla de pago, de entrega, de una factura) pero no puedes ver ni el resumen ni la foto que lo cerraría. Es un caso raro: si dudas entre "abierta" y "revision", elige "abierta".`
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
      /*
       * No hay empate posible: las señales salen de UN solo pase, y cada pase
       * tiene un dueño fijo —el resumen es siempre automatizado, la factura
       * siempre asistida—. Aquí se comprobaba si dos señales del mismo segundo
       * caían de lados distintos y se mandaba el hilo a revisión; con el dueño
       * atado a la señal eso ya no puede ocurrir, y lo que hacía era mandar a
       * revisión ventas perfectamente atribuidas.
       */
      estado = senales[0]!.quien;
      senal = senales[0]!.senal;
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

  const porFactura = senal === "imagen_factura" || senal === "imagen_comprobante";

  if (!yaSellada && estado === "humano" && porFactura && senales[0]) {
    /*
     * ¿Es la factura de una venta que la IA ya cerró en otro hilo del mismo
     * cliente? Entonces no es una venta nueva: esa venta queda facturada, en
     * su día, y este hilo no se cuenta. Ver `ventaQueConfirmaLaFactura`.
     */
    const venta = confirmarVentaConFactura(orgId, conv, senales[0].cuando);
    if (venta) {
      actualizarConversacion(orgId, conversationId, {
        justificacion: `Es la factura de la venta que la IA cerró en el chat #${venta.id}: esa venta queda facturada y no se cuenta dos veces.`,
      });
      estado = "abierta";
      senal = null;
    }
  }

  if (estado === "ia" || estado === "humano") {
    /*
     * LA FECHA ES LA DE LA SEÑAL QUE CIERRA: el resumen, o la primera factura.
     *
     * Cuando el cierre lo decidió el modelo leyendo el hilo —sin resumen ni
     * factura reconocibles—, se toma el último mensaje DE TEXTO que mandamos, y
     * no el último mensaje del hilo. Antes era el último del hilo, que en una
     * venta de ayer suele ser la foto de la factura de hoy: la venta caía hoy.
     *
     * La regla maestra vive en el UPDATE: si otro proceso selló primero, este
     * no reclasifica nada.
     */
    const ultimoTexto = [...completos].reverse().find((m) => m.emisor !== "cliente" && m.tipo === "texto");
    const cuando = senales[0]?.cuando ?? ultimoTexto?.created_at ?? conv.last_message_at ?? ahora();
    sellarCierre(orgId, conversationId, {
      cerradoPor: estado,
      senal: senal ?? "sin_senal",
      fechaCierre: cuando,
      facturadaAt: porFactura ? cuando : null,
    });
  } else if (estado === "revision") {
    marcarRevision(orgId, conversationId, justificacion ?? "Necesita una revisión humana.");
  }

  // Anomalías sobre el estado ya guardado.
  const actualizada = getConversation(orgId, conversationId);
  if (actualizada) revisarConversacion(orgId, actualizada, mensajes);

  return { conversationId, estado, senal, justificacion, sellada: false };
}

/**
 * LA FACTURA DE UNA VENTA QUE YA ESTÁ CERRADA.
 *
 * La IA cerró la venta con su resumen y, horas o un día después, el equipo
 * manda la foto de la factura. Esa foto no crea otra venta ni la cambia de
 * día: solo la marca como facturada, y eso es lo que alimenta «facturas
 * enviadas hoy».
 *
 * Mira las fotos del equipo posteriores al cierre que nadie había mirado, en
 * orden, y PARA en la primera factura: las siguientes —otra foto de la misma
 * factura— ya no se pagan ni cuentan. Una venta que ya está facturada no entra.
 * Devuelve true si esta vuelta la marcó.
 */
export async function apuntarFactura(orgId: number, conversationId: number): Promise<boolean> {
  const conv = getConversation(orgId, conversationId);
  if (!conv || conv.fecha_cierre === null || conv.facturada_at !== null) return false;
  if (conv.cerrado_por !== "ia" && conv.cerrado_por !== "humano") return false;

  const modeloVision = obtenerOrg(orgId)?.modelo_vision ?? MODELO_VISION;
  for (const m of fotosPorMirarTrasElCierre(orgId, conversationId, conv.fecha_cierre)) {
    const categoria = await describirImagen(orgId, modeloVision, m);
    if (categoria === "factura" || categoria === "comprobante_pago") {
      return marcarFacturada(orgId, conversationId, m.created_at);
    }
  }
  return false;
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
