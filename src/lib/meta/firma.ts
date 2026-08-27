/**
 * La firma de los webhooks de Meta.
 *
 * Meta manda cada webhook con una cabecera `X-Hub-Signature-256` que es un
 * HMAC-SHA256 del cuerpo, con el secreto de la app como clave. Comprobarla es
 * lo ÚNICO que separa un mensaje de verdad de uno inventado: la URL del webhook
 * es pública —Meta la conoce, y cualquiera que la adivine puede llamarla—, así
 * que sin esta comprobación cualquiera puede crear conversaciones, clientes y
 * ventas en la cuenta de otro.
 *
 * Aquí no se decide nada de negocio. Solo se responde a una pregunta: ¿lo mandó
 * quien dice?
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * EL CUERPO TIENE QUE SER EL CRUDO.
 *
 * El error clásico no es la clave, es el cuerpo. Si se pasa por `JSON.parse` y
 * se vuelve a serializar, cambian los espacios y el orden de las claves: el
 * HMAC sale distinto y la firma no cuadra NUNCA, aunque el secreto sea
 * correcto. Por eso esta función recibe el texto tal como llegó y por eso la
 * ruta lo lee con `await req.text()` antes de tocarlo.
 */
export function firmaValida(cuerpoCrudo: string, cabecera: string | null, secreto: string): boolean {
  if (!cabecera || !secreto) return false;

  // Meta la manda como "sha256=<hex>". Cualquier otro formato no es suya.
  const [algoritmo, recibida] = cabecera.split("=");
  if (algoritmo !== "sha256" || !recibida) return false;

  const esperada = createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest("hex");

  /*
   * Comparación en tiempo constante.
   *
   * Un `===` de cadenas se para en el primer carácter distinto, y ese tiempo se
   * puede medir: repitiendo peticiones se adivina la firma byte a byte. Es un
   * ataque lento pero real, y evitarlo cuesta esta línea.
   *
   * `timingSafeEqual` revienta si los búferes miden distinto, así que la
   * longitud se compara antes —y esa comparación no filtra nada útil: la
   * longitud de un SHA-256 en hexadecimal es siempre la misma—.
   */
  const a = Buffer.from(recibida, "hex");
  const b = Buffer.from(esperada, "hex");
  if (a.length !== b.length || a.length === 0) return false;

  return timingSafeEqual(a, b);
}

/**
 * El apretón de manos de alta: Meta llama por GET y espera su `challenge`.
 *
 * Devuelve el texto que hay que responder, o null si no hay que responder nada.
 * El token no se compara en tiempo constante a propósito: no es un secreto que
 * proteja datos, es una contraseña de un solo uso para probar que la URL es
 * nuestra, y Meta la manda en el query string a la vista de todos.
 */
export function respuestaDeVerificacion(
  params: URLSearchParams,
  tokenEsperado: string,
): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (!tokenEsperado || params.get("hub.verify_token") !== tokenEsperado) return null;
  return params.get("hub.challenge");
}
