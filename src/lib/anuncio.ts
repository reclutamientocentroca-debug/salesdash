/**
 * SalesDash — el anuncio que trajo al cliente.
 *
 * Dos cosas viven aquí y las dos son la MISMA idea vista de dos formas:
 *
 *   1. QUÉ CUENTA COMO LEAD DE ANUNCIO. Un lead es quien llega por un anuncio,
 *      no todo el que escribe: es la cifra por la que se paga publicidad. La
 *      condición en SQL es `deAnuncio()` en `db.ts` y esta es la misma en
 *      JavaScript. Si una cambia, la otra tiene que cambiar con ella o el panel
 *      enseñaría una pastilla que el conteo no ve.
 *
 *   2. CÓMO SE LE CUENTA A LA IA. El anuncio no es un adorno del panel: es lo
 *      que el cliente vino buscando. Sin él, el agente le pregunta «¿de qué
 *      producto hablas?» a alguien que acaba de pinchar una foto de ese
 *      producto, y el analista no sabe atribuirle la venta a nada.
 */

import { articuloDeLaDescripcion, precioDeLaDescripcion } from "./apertura";
import { reColores } from "@/agents/base-comportamiento";
import { leerImporte } from "./moneda";

/**
 * Lo que queda escrito cuando la imagen de un anuncio no se pudo mirar.
 *
 * Es una marca, no una descripción: existe para que el intento no se repita en
 * cada mensaje que entra —ver `describirAnunciosPendientes`— y por eso nadie
 * puede confundirla con algo que contarle al modelo. Quien la lea, la descarta.
 */
export const ANUNCIO_SIN_DESCRIBIR = "[anuncio sin describir]";

/** Una descripción de anuncio que de verdad dice algo, o null. */
export function descripcionUtil(texto: string | null | undefined): string | null {
  const limpio = texto?.trim();
  return limpio && limpio !== ANUNCIO_SIN_DESCRIBIR ? limpio : null;
}

/** Lo mínimo para saber si un hilo lo trajo un anuncio. */
export interface DatosAnuncio {
  origen: string | null;
  producto_anuncio: string | null;
  descripcion_anuncio?: string | null;
}

/**
 * EL ANUNCIO VIGENTE: el último por el que escribió el cliente.
 *
 * La conversación guarda el PRIMER anuncio para siempre —es el lead que la
 * publicidad pagó— y aparte el más reciente. Al agente le importa el de ahora:
 * un cliente que vuelve por otro anuncio pregunta por otro artículo y otro
 * precio, y venderle el de la primera vez es venderle otra cosa.
 */
export function anuncioVigente(
  c: DatosAnuncio & { anuncio_actual_producto?: string | null; anuncio_actual_descripcion?: string | null },
): DatosAnuncio {
  const producto = c.anuncio_actual_producto?.trim() || c.producto_anuncio;
  const descripcion = c.anuncio_actual_descripcion?.trim() || c.descripcion_anuncio;
  return {
    origen: c.origen ?? (producto || descripcion ? "anuncio" : null),
    producto_anuncio: producto ?? null,
    descripcion_anuncio: descripcion ?? null,
  };
}

/**
 * ¿ESTO ES UN ANUNCIO, O UN ENLACE CON VISTA PREVIA?
 *
 * WhatsApp usa el mismo `externalAdReply` para dos cosas: el clic en un
 * anuncio de Meta y la vista previa de CUALQUIER enlace que alguien pegue en
 * el chat. El caso real (Costa Rica, 2026-09-05): el vendedor le mandó al
 * cliente un enlace de una camisa, esa vista previa entró como «el anuncio por
 * el que escribe ahora», y el agente pasó a venderle la camisa a un cliente
 * que había llegado por una faja.
 *
 * Un anuncio de verdad viene marcado: `sourceType: "ad"`, el identificador
 * del anuncio, el `ctwaClid` del clic, o la atribución. Y nunca lo manda uno
 * mismo: lo que sale de nuestro número es un enlace, no un lead.
 *
 * Y NUNCA VIENE CITANDO NI REENVIANDO. El caso de la dueña (Costa Rica,
 * 2026-09-10): al cliente se le había mandado una campaña de unas botas, él
 * llegó después por el anuncio de un combo de cepillo y plancha, y al
 * responder —citando aquel mensaje nuestro— su respuesta trajo pegada la ficha
 * de las botas. Eso entró como «el anuncio por el que escribe ahora» y el
 * agente abrió el chat vendiéndole «Bota MR · ₡42.750 · ¿qué número calza?» a
 * quien venía por un cepillo de ₡15.500.
 *
 * Un clic en un anuncio ABRE la conversación: llega solo, sin nada citado
 * detrás. Lo que viene colgado de un mensaje que ya estaba en el chat es el
 * contexto de ESE mensaje, no un lead nuevo.
 */
export function esAnuncioDeMeta(
  ctx:
    | {
        // `title` y `body` no deciden nada aquí —son el producto y la promesa,
        // y los lee quien guarda la conversación—, pero vienen en el mismo
        // objeto y sin ellos no se puede escribir una ficha de verdad.
        externalAdReply?: { sourceType?: string | null; sourceId?: string | null; ctwaClid?: string | null; showAdAttribution?: boolean | null; sourceUrl?: string | null; title?: string | null; body?: string | null } | null;
        quotedMessage?: unknown;
        stanzaId?: string | null;
        isForwarded?: boolean | null;
      }
    | null
    | undefined,
  deMi: boolean,
): boolean {
  const a = ctx?.externalAdReply;
  if (!a || deMi) return false;
  if (ctx?.quotedMessage || ctx?.stanzaId || ctx?.isForwarded) return false;
  return (
    a.sourceType === "ad" ||
    !!a.ctwaClid ||
    !!a.sourceId ||
    a.showAdAttribution === true ||
    /\bfb\.me\b|facebook\.com\/ads|\bl\.instagram\.com\b/i.test(a.sourceUrl ?? "")
  );
}

/**
 * LO QUE VENDE EL ANUNCIO, LEÍDO UNA VEZ Y GUARDADO.
 *
 * El caso de la dueña (2026-09-11): el cliente llega por un anuncio de
 * «poloches», el agente reconoce el artículo y no tiene el precio, así que le
 * dice que un representante se lo confirma. Eso es un lead pagado que se cae en
 * la primera respuesta.
 *
 * El anuncio trae el precio escrito —lo escribió el propio negocio— y hasta
 * ahora se leía al vuelo en cada respuesta, del texto que hubiera en la
 * conversación. Si ese texto no llegaba, o lo pisaba otro, no había precio en
 * ninguna parte. Aquí se lee UNA vez, en cuanto entra el lead, y se guarda: en
 * la conversación de ese cliente y en el catálogo de lo anunciado, que sirve
 * para el que escriba mañana sin pinchar nada.
 *
 * No inventa: si el anuncio no trae precio, `precio` sale null y el agente
 * sigue sin poder cotizar —eso sí es motivo de transferir—.
 */
export interface ProductoAnunciado {
  /** Cómo se llama, en corto: lo que se le dice al cliente y va en el resumen. */
  nombre: string;
  /** El precio de una unidad, en números. Null si el anuncio no lo escribe. */
  precio: number | null;
  /** El de por mayor, si el anuncio lo trae al lado. */
  precioMayor: number | null;
  /** Las tallas que nombra el anuncio, tal cual. */
  tallas: string | null;
  /** Los colores que nombra el anuncio, separados por coma. */
  colores: string | null;
  /** El texto entero del anuncio, que es lo que se le prometió al cliente. */
  descripcion: string | null;
}

/** Cómo suena el precio por mayor en un anuncio dominicano. */
const AL_POR_MAYOR = /\b(al por mayor|por mayor|mayorista|mayoreo|docena|revendedor)\b/i;

/** «Tallas de la S a la XXL», «Talla: 30 a 42», «S M L XL». */
const TALLAS_ESCRITAS =
  /\btallas?\s*:?\s*((?:de\s+la\s+)?[\dsmlx]+(?:\s*(?:a\s+la|a|-|\/|,|y)\s*[\dsmlx]+)+)/i;

/**
 * LEE EL ANUNCIO Y SACA EL PRODUCTO. Null si no se puede nombrar el artículo:
 * sin nombre no hay nada que guardar ni que buscar después.
 */
export function leerProductoDelAnuncio(
  titulo: string | null | undefined,
  descripcion: string | null | undefined,
  simbolo: string,
): ProductoAnunciado | null {
  const texto = [titulo, descripcion].filter((t) => t?.trim()).join(" · ");
  if (!texto.trim()) return null;

  /*
   * EL NOMBRE SALE DE LA DESCRIPCIÓN, que es donde el anuncio dice qué vende.
   * El título es el de la campaña —«Rincondcm»— y sirve de respaldo cuando no
   * hay texto, no para pegarlo delante del artículo.
   */
  const nombre =
    articuloDeLaDescripcion(descripcion?.trim() ?? "", simbolo) ??
    articuloDeLaDescripcion(titulo?.trim() ?? "", simbolo) ??
    titulo?.trim() ??
    null;
  if (!nombre) return null;

  /*
   * LOS IMPORTES, EN ORDEN. El primero es el precio de una unidad —así lo
   * escribe la publicidad, «RD$1,400 c/u»— y el segundo, si el texto habla de
   * mayoreo, es el del por mayor: «RD$1,400 C/U RD$1,190 al por mayor».
   */
  const simboloEscapado = simbolo.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
  const importes = [...texto.matchAll(new RegExp(`${simboloEscapado}\\s?\\d[\\d.,]*`, "g"))]
    .map((m) => leerImporte(m[0]))
    .filter((n): n is number => n !== null);

  const precio = importes[0] ?? leerImporte(precioDeLaDescripcion(texto, simbolo) ?? "");
  const segundo = importes.find((n) => n !== precio && n < (precio ?? Infinity)) ?? null;
  const precioMayor = AL_POR_MAYOR.test(texto) ? segundo : null;

  const tallas = texto.match(TALLAS_ESCRITAS)?.[1]?.trim() ?? null;
  const colores = [...new Set([...texto.matchAll(reColores("gi"))].map((m) => m[0].toLowerCase()))];

  return {
    nombre,
    precio: precio ?? null,
    precioMayor,
    tallas,
    colores: colores.length ? colores.join(", ") : null,
    descripcion: descripcion?.trim() || null,
  };
}

/**
 * EL PRODUCTO, ESCRITO COMO UNA DESCRIPCIÓN DE ANUNCIO.
 *
 * Para que todo lo que ya sabe leer una descripción —la apertura, la respuesta
 * mecánica, el resumen, el revisor— siga funcionando igual sin enterarse de que
 * el precio ya no salió del texto del anuncio sino de lo guardado.
 */
export function textoDelProducto(p: ProductoAnunciado, simbolo: string): string {
  const partes = [p.nombre];
  if (p.precio !== null) partes.push(`${simbolo}${p.precio.toLocaleString("es-DO")}`);
  if (p.precioMayor !== null) partes.push(`${simbolo}${p.precioMayor.toLocaleString("es-DO")} al por mayor`);
  if (p.tallas) partes.push(`Tallas: ${p.tallas}`);
  if (p.colores) partes.push(`Colores: ${p.colores}`);
  return partes.join(" · ");
}

/**
 * Llegó por un anuncio.
 *
 * Se pregunta por el origen Y por el título porque Meta no siempre manda
 * `title` —hay creatividades sin titular— y porque las conversaciones guardadas
 * antes de que existiera la columna `origen` solo tienen el producto. Gemela de
 * `deAnuncio()` en `db.ts`.
 */
export function llegoPorAnuncio(c: DatosAnuncio): boolean {
  return c.origen === "anuncio" || !!c.producto_anuncio?.trim();
}

/**
 * El anuncio, escrito para que lo lea un modelo.
 *
 * Devuelve null cuando el cliente escribió por su cuenta: entonces no hay nada
 * que contar y meter un bloque vacío en el prompt solo gasta tokens y confunde.
 *
 * El título dice QUÉ producto lo trajo y el texto QUÉ se le prometió. Los dos
 * hacen falta: «Nevera 12 pies» no explica por qué el cliente escribe
 * preguntando por cuotas, y «0 % de interés a 6 meses» sí.
 */
export function anuncioParaModelo(
  c: DatosAnuncio,
  /** El símbolo de la moneda del país: sin él no se puede recortar el nombre del artículo. */
  simbolo: string | null = null,
): string | null {
  if (!llegoPorAnuncio(c)) return null;

  const producto = c.producto_anuncio?.trim();
  const descripcion = c.descripcion_anuncio?.trim();

  const lineas = ["Este cliente llegó por un anuncio:"];
  lineas.push(`- Producto anunciado: ${producto || "(el anuncio no traía título)"}`);
  if (descripcion) lineas.push(`- Lo que promete el anuncio: ${descripcion}`);

  /*
   * CÓMO SE LLAMA, EN CORTO. Un anuncio abre con su reclamo —«¡COMPRA SEGURO!
   * ORDENA, RECIBE Y LUEGO PAGA!!»— y el modelo copiaba eso como el nombre del
   * artículo: al cliente le llegó un resumen con «Producto: ORDENA, RECIBE Y
   * LUEGO PAGA!!». Aquí se le da el nombre ya limpio, sacado de esa misma
   * descripción, para que sea el que escriba en el pedido.
   */
  const nombre = descripcion && simbolo ? articuloDeLaDescripcion(descripcion, simbolo) : null;
  if (nombre) {
    lineas.push(
      `- Se llama, en corto: ${nombre}. Ese es el nombre que usas al hablarle y el que va en la línea «Producto:» del resumen. ` +
        "Nunca pongas ahí el reclamo del anuncio («ORDENA», «COMPRA SEGURO», «PAGA AL RECIBIR»): eso no dice qué se vende.",
    );
  }

  /*
   * EL ARTÍCULO ES EL DE LA DESCRIPCIÓN, Y NO HAY OTRO.
   *
   * Se ha visto al agente decirle a un cliente que vendía un artículo que la
   * tienda no vende: lo sacó de una imagen mal leída, de un parecido o de lo
   * que suelen vender otras tiendas. La descripción la escribió el negocio y
   * es la única fuente de QUÉ se vende en este chat; lo demás solo añade
   * precio, colores o tallas. Se le dice aquí, pegado a la descripción, para
   * que el modelo lo lea junto al dato y no cinco pantallas más abajo.
   */
  lineas.push(
    descripcion
      ? "EL ARTÍCULO DE ESTE CHAT ES EL QUE NOMBRA ESA DESCRIPCIÓN, y se le llama exactamente como ahí se llama. " +
          "Está PROHIBIDO cambiarlo por otro artículo o ponerle otro nombre: ni por lo que una máquina haya leído en una imagen, " +
          "ni por lo que suene parecido, ni por lo que vendan otras tiendas. Si la descripción no nombra ningún artículo, vale el título; " +
          "y si ninguno de los dos lo nombra, pregúntale al cliente qué artículo vio, sin proponerle tú ninguno."
      : "EL ARTÍCULO DE ESTE CHAT ES EL DEL TÍTULO, con ese mismo nombre. Está PROHIBIDO cambiarlo por otro o ponerle otro nombre. " +
          "Si el título tampoco nombra ningún artículo, pregúntale al cliente qué artículo vio, sin proponerle tú ninguno.",
  );

  /*
   * Y EL PRECIO, IGUAL: el que está escrito en la descripción, tal cual, o
   * ninguno. Un precio inventado es una venta que el negocio no puede
   * sostener y que el cliente ya leyó. El revisor lo para de forma mecánica
   * —ver `revisor.ts`—, pero mejor que el agente ni lo escriba.
   */
  lineas.push(
    "Y EL PRECIO ES EL QUE ESTÁ ESCRITO EN ESA DESCRIPCIÓN, con la misma cifra: no lo redondees, no lo cambies, no le sumes ni le quites nada. " +
      "Si la descripción no trae ningún precio, mira si el catálogo o lo que escribió el negocio tienen ESE MISMO artículo con precio, y ese es el que vale. " +
      "Si no hay precio en ningún sitio, NO LO INVENTES ni lo deduzcas de otro artículo parecido: dile al cliente que un representante le pasa el precio y escribe \"[HANDOFF]\". " +
      "Una cifra que no está escrita arriba no existe.",
  );

  return lineas.join("\n");
}
