/**
 * SalesDash — «SALIR» de una difusión.
 *
 * Puro y sin base: `ingesta.ts` lo llama con lo que escribió el cliente y
 * decide si excluirlo (ver `registrarExclusion` en `db.ts`). Separado en su
 * propio archivo para poder probarlo a solas, sin montar una conversación.
 */

/**
 * SOLO CUENTA CUANDO ES TODO EL MENSAJE, a secas o con una despedida corta
 * alrededor («salir», «no más gracias», «stop»). No busca la palabra dentro
 * de una frase más larga: «ya no quiero nada más, gracias» a mitad de un
 * pedido no es un «SALIR» de difusiones, es que no quiere más UNIDADES. Un
 * regex suelto ahí desuscribiría a medio mundo por accidente.
 */
const SALIDA_A_SECAS =
  /^(?:salir|stop|no\s*m[aá]s|basta|ya\s*no\s*(?:me\s*escrib[ae]n?|env[ií]en?)(?:\s*m[aá]s)?)[\s,.!¡]*(?:gracias|por\s*favor)?[\s,.!¡]*$/i;

export function detectarOptOut(texto: string | null | undefined): boolean {
  const t = (texto ?? "").trim();
  if (!t || t.length > 40) return false;
  return SALIDA_A_SECAS.test(t);
}
