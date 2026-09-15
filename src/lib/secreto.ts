/**
 * SalesDash — SESSION_SECRET: si está y si sirve.
 *
 * Vive en su propio archivo, sin una sola dependencia, y eso es a propósito.
 * Lo pregunta `/api/salud`, que es el health check del despliegue: si desde
 * ahí se importara `auth.ts` entraría con él argon2, un módulo nativo, y un
 * argon2 mal compilado tumbaría la única pantalla que sirve para averiguar
 * por qué no funciona nada — y con ella el contenedor, que la plataforma
 * reiniciaría en bucle.
 *
 * El valor no sale nunca de aquí. `auth.ts` es quien lo usa.
 */

/** Cómo generar uno. Se dice en todos los sitios donde se echa en falta. */
export const COMO_GENERARLO =
  "Genera uno con: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"";

/** Lo que exige `hkdfSync` para derivar claves con holgura suficiente. */
const MINIMO = 32;

/**
 * ¿SE PUEDEN FIRMAR SESIONES? Devuelve qué le pasa al secreto, o null si está bien.
 *
 * Preguntar es distinto de reventar, y hace falta poder preguntar en tres
 * sitios: en `/api/salud`, para que un despliegue mal configurado se vea desde
 * fuera; en el login, para no responder un 500 mudo a quien sí sabe su
 * contraseña; y en el registro, ANTES de crear una cuenta que después no se va
 * a poder abrir.
 *
 * Nunca devuelve el valor ni parte de él: solo su longitud, que es justo lo
 * que hay que corregir.
 */
export function problemaDelSecreto(): string | null {
  const s = process.env.SESSION_SECRET;
  if (!s) return "falta SESSION_SECRET en el servidor";
  if (s.length < MINIMO) {
    return `SESSION_SECRET tiene ${s.length} caracteres y necesita al menos ${MINIMO}`;
  }
  return null;
}
