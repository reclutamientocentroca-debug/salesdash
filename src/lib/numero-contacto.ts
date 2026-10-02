/**
 * El número de contacto de una página de Meta.
 *
 * En Messenger, Instagram y los comentarios no hay un teléfono: el cliente
 * escribe a una PÁGINA. Cuando pide «el número», lo que quiere es el WhatsApp
 * del negocio que atiende esa página, y cada página tiene el suyo. Se guarda en
 * `canales.numero_contacto` y aquí viven las dos decisiones que lo rodean:
 * cómo se limpia lo que escribe el dueño, y cuándo un mensaje del cliente es
 * de verdad una petición de ese número.
 *
 * La detección es mecánica a propósito. «Número» en una tienda de ropa es
 * también la talla del zapato, el número de cuenta para pagar y el teléfono
 * que el propio cliente da para el pedido: confundirlos manda un teléfono a
 * quien preguntaba por su talla. Ante la duda NO se dispara, y contesta el
 * agente como siempre.
 */

/** «+506 8888-8888» → «+50688888888». Null si no parece un teléfono. */
export function normalizarNumeroContacto(crudo: string | null | undefined): string | null {
  const t = (crudo ?? "").trim();
  if (!t) return null;
  const digitos = t.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  return `+${digitos}`;
}

/** «+50688888888» → «+506 8888 8888» solo para leerlo; el valor guardado no cambia. */
export function numeroLegible(numero: string): string {
  const d = numero.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("506")) return `+506 ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith("507")) return `+507 ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith("1")) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return numero;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * ¿El cliente está pidiendo el número del negocio?
 *
 * No si da el suyo (hay una cifra larga, o dice «mi número»), ni si «número»
 * es una talla, una cuenta, un pedido o una guía.
 */
export function clientePideNumero(texto: string): boolean {
  const t = sinTildes(texto);
  if (!t.trim()) return false;

  // Está dando su teléfono, no pidiendo el nuestro.
  if (/\d[\d\s().-]{6,}\d/.test(t)) return false;
  if (/\bmi (numero|telefono|whatsapp|wasap|celular|cel)\b/.test(t)) return false;

  // «Número» como talla, cuenta o referencia de un pedido.
  if (/numero (de )?(zapato|calzado|pie|tenis|bota|botin|talla|cuenta|pedido|guia|orden|factura|tarjeta|cedula|casa|apartamento|sinpe|referencia|envio)/.test(t)) return false;
  if (/que numero (calza|usa|gasta|maneja|es)/.test(t)) return false;
  if (/\bnumero \d{1,2}\b/.test(t)) return false;

  // «Teléfono», «WhatsApp», «celular», «llamar»: casi sin ambigüedad.
  const medio = /\b(telefono|tel|celular|cel|whatsapp|wasap|wsap|wsp|watsap|llamar|llamarles|llamarlos|llamada)\b/.test(t);
  const pide = /\b(dame|deme|me das|me da|me puede|me pasa|pasame|pasen|pase|facilita|facilite|mand[ae]|manden|envia|envie|comparte|comparta|regala|regale|brinda|brinde|cual|cuales|tienen|tiene|hay|su|sus|tu|de ustedes|del negocio|de la tienda|de la pagina|necesito|quiero|ocupo)\b/.test(t);
  if (medio && pide) return true;

  // «Número» a secas, pedido con un verbo o un posesivo del negocio.
  if (/\bnumero\b/.test(t) && /\b(dame|deme|me das|me da|me pasa|pasame|facilita|facilite|mand[ae]|envia|comparte|regala|brinda|cual es (el|su|tu)|su numero|tu numero|el numero de ustedes|numero de ustedes|numero del negocio|numero de la tienda|numero de contacto)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Lo que se le manda al cliente. Una línea, sin vender nada más. */
export function textoDelNumero(numero: string): string {
  return `Con gusto 😊 Nuestro número es ${numeroLegible(numero)}. También puede seguir escribiéndome por aquí.`;
}

/**
 * LO ÚNICO QUE SE CONTESTA BAJO UN COMENTARIO PÚBLICO (la dueña, RD,
 * 2026-10-02, con capturas: la IA le preguntaba la talla y le pedía la
 * dirección colgada de un comentario, delante de cualquiera que pasara por la
 * publicación).
 *
 * Un comentario lo lee cualquiera que pase por la publicación, no solo quien
 * preguntó: el precio, la talla, el color o pedirle la dirección ahí es
 * exhibirlo en público, y es terreno de la competencia para copiar precios y
 * ofertas. Sea lo que sea lo que pregunte, la única respuesta es invitarlo a
 * escribir por WhatsApp — ahí sí se vende —, salvo que pregunte dónde está
 * ubicada la tienda: esa sola pregunta sí tiene su propia respuesta fija,
 * dicha tal cual la pidió la dueña.
 */
export function textoDeComentario(numero: string, esPreguntaDeUbicacion: boolean): string {
  if (esPreguntaDeUbicacion) {
    return (
      `Somos tienda virtual, trabajamos con envío a todo el país y paga al momento de recibir. ` +
      `Para mayor información, WhatsApp ${numeroLegible(numero)}.`
    );
  }
  return `Disponible. Para mayor información, WhatsApp ${numeroLegible(numero)}.`;
}
