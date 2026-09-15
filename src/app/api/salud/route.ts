import { NextResponse, type NextRequest } from "next/server";
import { existsSync, accessSync, readFileSync, statSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
// De `secreto.ts` y no de `auth.ts`: esto es el health check del despliegue
// y no puede arrastrar argon2, un módulo nativo que al fallar lo tumbaría.
import { problemaDelSecreto } from "@/lib/secreto";

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

  /*
   * EL AVISO QUE FALTABA, y es el más grave de todos.
   *
   * Sin SESSION_SECRET no hay cookie que firmar: ni se entra ni se puede
   * crear una cuenta. La aplicación arranca, las pantallas se ven, y cada
   * intento muere en un 500. Esto respondía «ok: true» mientras tanto, o sea
   * que el único sitio que sirve para diagnosticar desde fuera decía que todo
   * estaba bien. Se comprueba, nunca se lee el valor.
   */
  const secretoRoto = problemaDelSecreto();
  if (secretoRoto) {
    avisos.push(
      `Sesiones rotas: ${secretoRoto}. Nadie puede entrar ni registrarse — cada intento ` +
        "responde con un error del servidor. Ponla en el entorno y vuelve a desplegar.",
    );
  }

  if (!process.env.OPENROUTER_API_KEY) {
    avisos.push("Falta OPENROUTER_API_KEY: no se puede analizar ni responder.");
  }

  const meta = revisarMeta();
  avisos.push(...meta.avisos);

  const correo = revisarCorreo();
  avisos.push(...correo.avisos);

  return NextResponse.json(
    {
      ok: avisos.length === 0,
      // Qué versión corre: para saber si el despliegue tomó lo último.
      version: {
        commit: process.env.SALESDASH_COMMIT ?? "desconocido",
        construido: process.env.SALESDASH_CONSTRUIDO ?? null,
      },
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
        // Sin esto no entra nadie: va el primero a propósito.
        sesiones: !secretoRoto,
        openrouter: !!process.env.OPENROUTER_API_KEY,
        correo: correo.utilizable,
        correo_destinatarios: correo.destinatarios,
        whapi_partner: !!process.env.WHAPI_PARTNER_TOKEN,
      },
      meta: meta.estado,
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
 * Revisa el canal de Meta (Messenger, directos de Instagram y comentarios).
 *
 * Los dos primeros fallan EN SILENCIO y de la peor manera posible: la página se
 * ve «conectada» en el panel, Meta se ve configurado en su panel, y no llega ni
 * un mensaje. Ninguno da un error en ninguna pantalla.
 *
 *   META_APP_SECRET — es con lo que se comprueba la firma. Sin él, cada evento
 *     que manda Meta entra, se guarda con `firma_ok = 0` y se DESCARTA. El
 *     webhook responde 200 a todo —tiene que hacerlo, si no Meta lo desactiva—
 *     así que desde fuera se ve idéntico a que todo funcione.
 *   META_VERIFY_TOKEN — sin él, el panel de Meta ni siquiera deja dar de alta
 *     la URL del webhook. Es el primer eslabón de la integración.
 *
 * `META_APP_ID` es de otra clase: sin él la pantalla se queda sin el botón de
 * «Continuar con Facebook» y solo se puede conectar pegando un token a mano. Se
 * dice, pero el canal existente sigue recibiendo.
 *
 * Los valores no se leen NUNCA: solo si están puestos.
 */
function revisarMeta(): {
  estado: { secreto: boolean; verify_token: boolean; app_id: boolean; version: string };
  avisos: string[];
} {
  const puesta = (clave: string) => (process.env[clave] ?? "").trim() !== "";
  const avisos: string[] = [];

  const secreto = puesta("META_APP_SECRET");
  const verify = puesta("META_VERIFY_TOKEN");
  const appId = puesta("META_APP_ID");

  if (!secreto) {
    avisos.push(
      "Falta META_APP_SECRET: los eventos de Meta llegan y se descartan todos por firma " +
        "inválida. Las páginas se ven conectadas y no entra ni un mensaje.",
    );
  }

  if (!verify) {
    avisos.push(
      "Falta META_VERIFY_TOKEN: el panel de Meta no deja dar de alta la URL del webhook.",
    );
  }

  if (!appId && (secreto || verify)) {
    avisos.push(
      "Falta META_APP_ID: la pantalla de Messenger se queda sin el botón de «Continuar con " +
        "Facebook» y solo se puede conectar una página pegando su token a mano.",
    );
  }

  return {
    estado: {
      secreto, verify_token: verify, app_id: appId,
      version: process.env.META_GRAPH_VERSION || "v23.0",
    },
    avisos,
  };
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
