import { NextResponse, type NextRequest } from "next/server";
import { existsSync, accessSync, readFileSync, statSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/salud — diagnóstico del despliegue.
 *
 * Existe porque los tres fallos que más caro salen no dan ningún error: la
 * aplicación arranca preciosa y no funciona.
 *
 *   1. APP_URL mal puesta  → el webhook apunta a ninguna parte y el panel
 *                            se queda vacío para siempre
 *   2. NODE_ENV distinto de production → la cookie de sesión pierde Secure
 *   3. El volumen sin montar → todo funciona hasta el siguiente
 *                              redespliegue, que borra todas las cuentas
 *
 * Solo devuelve booleanos y rutas: ninguna clave, ningún dato de negocio,
 * ningún conteo. Es público a propósito, para poder comprobarlo desde fuera
 * antes de tener cuenta.
 *
 * SIEMPRE responde 200 mientras la aplicación esté viva, aunque haya avisos.
 * Sirve tal cual como health check del despliegue. Con `?estricto=1` devuelve
 * 503 si hay algún aviso — eso es para monitorización, NO para el health check
 * del panel: si el orquestador ve 503 da el contenedor por muerto y lo
 * reinicia en bucle; el proxy se queda sin nadie a quien enviar las peticiones
 * y el sitio entero pasa a responder 500. Que falte SMTP no es motivo para
 * tirar la aplicación abajo.
 */
export function GET(req: NextRequest) {
  const estricto = req.nextUrl.searchParams.get("estricto") === "1";
  const appUrl = process.env.APP_URL ?? "";
  const hostPeticion = req.headers.get("host") ?? "";

  let hostConfigurado = "";
  try {
    hostConfigurado = appUrl ? new URL(appUrl).host : "";
  } catch {
    hostConfigurado = "(APP_URL no es una URL válida)";
  }

  // Misma resolución que usa db.ts.
  const rutaDb = process.env.SALESDASH_DB
    ? resolve(process.env.SALESDASH_DB)
    : resolve(process.cwd(), "data", "salesdash.db");

  const carpeta = dirname(rutaDb);
  let escribible = false;
  try {
    accessSync(carpeta, constants.W_OK);
    escribible = true;
  } catch {
    escribible = false;
  }

  const existe = existsSync(rutaDb);

  /*
   * La base va en modo WAL, así que lo recién escrito NO está en el archivo
   * principal: vive en el `-wal` hasta que se consolida. Mirar solo el primero
   * hace creer que la base está vacía cuando no lo está — un diagnóstico que
   * manda a buscar el problema al sitio equivocado.
   */
  const kb = (ruta: string) => (existsSync(ruta) ? Math.round(statSync(ruta).size / 1024) : 0);
  const tamanoKb = kb(rutaDb);
  const walKb = kb(`${rutaDb}-wal`);

  const montado = esPuntoDeMontaje(carpeta);

  const entorno = process.env.NODE_ENV ?? "desconocido";
  const httpsConfigurado = appUrl.startsWith("https://");
  const coincideHost = !!hostConfigurado && hostConfigurado === hostPeticion;

  const avisos: string[] = [];

  if (!appUrl) {
    avisos.push("APP_URL está vacía: el webhook no se puede construir y no llegará ningún mensaje.");
  } else if (!httpsConfigurado) {
    avisos.push("APP_URL no usa https: Whapi no entregará los webhooks.");
  } else if (!coincideHost) {
    avisos.push(
      `APP_URL apunta a "${hostConfigurado}" pero esta petición llegó a "${hostPeticion}". ` +
        "Los webhooks se registrarían en el dominio equivocado.",
    );
  }

  if (entorno !== "production") {
    avisos.push(
      `NODE_ENV es "${entorno}": la cookie de sesión no lleva el atributo Secure. Ponlo en production.`,
    );
  }

  if (!escribible) {
    avisos.push(`No se puede escribir en ${carpeta}: la aplicación no podrá guardar nada.`);
  }

  // El aviso más importante de todos: sin volumen la aplicación funciona
  // perfectamente, y el siguiente redespliegue se lleva todas las cuentas.
  if (montado === false) {
    // Si hay un volumen en otra ruta, decirlo ahorra la parte difícil: el
    // problema no es que falte, es que está en el sitio equivocado.
    const otros = (montajesDeDatos() ?? []).filter((m) => m !== carpeta);

    /*
     * El caso que de verdad pasa: el volumen está montado en la ruta correcta
     * pero con un espacio de más al escribirla en el panel. `/app/data ` y
     * `/app/data` son dos carpetas distintas para el sistema, así que todo
     * funciona, no da ningún error, y los datos se borran igual en cada
     * despliegue. En mountinfo un espacio aparece como \040, o sea que a
     * simple vista tampoco se ve.
     */
    const casiIgual = otros.filter((m) => m !== carpeta && m.trim() === carpeta.trim());

    if (casiIgual.length) {
      avisos.push(
        `Hay un volumen montado en "${casiIgual[0]}" pero la aplicación escribe en "${carpeta}": ` +
          "se diferencian solo en un espacio, así que son carpetas distintas y el volumen queda sin usar. " +
          "Corrige la ruta del montaje en el panel quitando el espacio sobrante.",
      );
    } else {
      avisos.push(
        `${carpeta} NO es un volumen montado: los datos viven dentro del contenedor y ` +
          "se borrarán en el próximo redespliegue." +
          (otros.length
            ? ` Sí hay un volumen en ${otros.join(", ")}: móntalo en ${carpeta}, o apunta la variable SALESDASH_DB a esa ruta.`
            : " Monta un volumen ahí."),
      );
    }
  }

  if (!process.env.OPENROUTER_API_KEY) {
    avisos.push("Falta OPENROUTER_API_KEY: no se puede analizar ni responder.");
  }

  const correo = revisarCorreo();
  avisos.push(...correo.avisos);

  return NextResponse.json(
    {
      ok: avisos.length === 0,
      entorno,
      app_url: appUrl || null,
      host_de_la_peticion: hostPeticion,
      app_url_coincide: coincideHost,
      base_de_datos: {
        ruta: rutaDb,
        carpeta_escribible: escribible,
        existe,
        tamano_kb: tamanoKb,
        // Lo escrito y todavía sin consolidar. Con la base recién creada, casi
        // todo está aquí y el archivo principal se queda en 4 KB.
        wal_kb: walKb,
        total_kb: tamanoKb + walKb,
        volumen_montado: montado,
        // Si volumen_montado es false, aquí se ve dónde SÍ hay volúmenes.
        montajes_detectados: montajesDeDatos(),
      },
      configurado: {
        openrouter: !!process.env.OPENROUTER_API_KEY,
        correo: correo.utilizable,
        correo_destinatarios: correo.destinatarios,
        whapi_partner: !!process.env.WHAPI_PARTNER_TOKEN,
      },
      avisos,
    },
    // Ver la nota de arriba: 200 salvo que se pida `?estricto=1` a propósito.
    { status: estricto && avisos.length > 0 ? 503 : 200 },
  );
}

/**
 * ¿La carpeta es un punto de montaje? Es la única forma de distinguir un
 * volumen de verdad de una carpeta corriente dentro del contenedor: las dos
 * son escribibles, pero una sobrevive al redespliegue y la otra no.
 *
 * Devuelve null donde no se puede saber (fuera de Linux), para no dar un
 * aviso falso en desarrollo.
 */
function puntosDeMontaje(): string[] | null {
  try {
    if (!existsSync("/proc/self/mountinfo")) return null;

    return readFileSync("/proc/self/mountinfo", "utf8")
      .split("\n")
      // El quinto campo de cada línea es el punto de montaje.
      .map((l) => l.split(" ")[4] ?? "")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function esPuntoDeMontaje(carpeta: string): boolean | null {
  const montajes = puntosDeMontaje();
  if (montajes === null) return null;

  // Barras al estilo POSIX y sin la final, que es como aparecen en mountinfo.
  const normalizada = carpeta.replace(/\\/g, "/").replace(/\/+$/, "");
  return montajes.includes(normalizada);
}

/**
 * Los montajes que ha puesto alguien a propósito, sin el ruido del sistema.
 *
 * "No está montado en /app/data" no dice dónde SÍ está. Esta lista convierte
 * un callejón sin salida en un dato accionable: si aparece /data, el volumen
 * existe y solo está en la ruta equivocada.
 */
function montajesDeDatos(): string[] | null {
  const montajes = puntosDeMontaje();
  if (montajes === null) return null;

  const RUIDO = /^\/(proc|sys|dev|run|etc\/(hosts|hostname|resolv\.conf)|usr|lib|bin|sbin|var\/lib\/docker)/;

  return [...new Set(montajes.filter((m) => m !== "/" && !RUIDO.test(m)))];
}

/**
 * Revisa el correo saliente.
 *
 * No basta con mirar si las variables existen: los dos fallos reales que se
 * dan al configurar esto pasan la comprobación de "existe" y aun así no
 * entregan nada.
 *
 *   1. La clave quedó con el valor de ejemplo del README sin sustituir.
 *   2. El remitente es el de pruebas del proveedor, que solo entrega a la
 *      dirección de la propia cuenta y a ninguna otra.
 *
 * Decir "correo: true" en cualquiera de esos casos es peor que no decir nada:
 * manda a buscar el fallo dentro de la aplicación, donde no está.
 */
function revisarCorreo(): {
  utilizable: boolean;
  destinatarios: "cualquiera" | "solo_la_cuenta_del_proveedor" | "ninguno";
  avisos: string[];
} {
  const host = process.env.SMTP_HOST ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const from = process.env.MAIL_FROM ?? "";
  const avisos: string[] = [];

  if (!host || !pass) {
    avisos.push(
      "Falta la configuración SMTP: las solicitudes de acceso de soporte no avisarán al dueño de la cuenta.",
    );
    return { utilizable: false, destinatarios: "ninguno", avisos };
  }

  // Valores de ejemplo pegados tal cual. Es un error frecuente y silencioso:
  // el envío falla con un 535 idéntico al de una clave equivocada.
  const ESPECIMENES = ["re_...", "sk-or-...", "cambiar", "changeme", "xxx", "..."];
  if (ESPECIMENES.includes(pass.trim()) || pass.trim().endsWith("...")) {
    avisos.push(
      `SMTP_PASS tiene el valor de ejemplo "${pass}" en vez de una clave real: ` +
        "ningún correo va a salir. Sustitúyelo por la clave de tu proveedor.",
    );
    return { utilizable: false, destinatarios: "ninguno", avisos };
  }

  /*
   * Gmail solo deja enviar como la cuenta con la que te autenticas. Si
   * MAIL_FROM lleva otra dirección, Gmail la reescribe por la suya o rechaza
   * el envío — y el usuario ve un fallo que no dice nada de esto.
   */
  const usuario = (process.env.SMTP_USER ?? "").trim().toLowerCase();
  const direccionRemitente = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

  if (host.toLowerCase().includes("gmail.com") && usuario && direccionRemitente !== usuario) {
    avisos.push(
      `Con Gmail, MAIL_FROM tiene que ser la misma dirección con la que te autenticas ` +
        `(${usuario}), y ahora es "${direccionRemitente}". Gmail la reescribe o rechaza el envío.`,
    );
    return { utilizable: false, destinatarios: "ninguno", avisos };
  }

  // Remitentes de prueba de los proveedores: entregan solo a la dirección
  // dueña de la cuenta, así que sirven para comprobar el despliegue y no para
  // escribir a usuarios de verdad.
  const DE_PRUEBA = ["resend.dev", "sandbox.mgsend.net", "example.com"];
  const dominioRemitente = from.match(/@([^\s>]+)/)?.[1]?.toLowerCase() ?? "";

  if (DE_PRUEBA.some((d) => dominioRemitente.endsWith(d))) {
    avisos.push(
      `MAIL_FROM usa el remitente de pruebas "${dominioRemitente}", que solo entrega a la ` +
        "dirección de tu propia cuenta del proveedor. A cualquier otro correo no llegará nada. " +
        "Verifica un dominio propio, o usa un proveedor que permita enviar sin dominio.",
    );
    return { utilizable: true, destinatarios: "solo_la_cuenta_del_proveedor", avisos };
  }

  return { utilizable: true, destinatarios: "cualquiera", avisos };
}
