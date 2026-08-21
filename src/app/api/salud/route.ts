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
 */
export function GET(req: NextRequest) {
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
  const tamanoKb = existe ? Math.round(statSync(rutaDb).size / 1024) : 0;
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
    avisos.push(
      `${carpeta} NO es un volumen montado: los datos viven dentro del contenedor y ` +
        "se borrarán en el próximo redespliegue. Monta un volumen ahí.",
    );
  }

  if (!process.env.OPENROUTER_API_KEY) {
    avisos.push("Falta OPENROUTER_API_KEY: no se puede analizar ni responder.");
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_PASS) {
    avisos.push(
      "Falta la configuración SMTP: nadie podrá verificar su correo y por tanto nadie podrá entrar.",
    );
  }

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
        volumen_montado: montado,
      },
      configurado: {
        openrouter: !!process.env.OPENROUTER_API_KEY,
        correo: !!(process.env.SMTP_HOST && process.env.SMTP_PASS),
        whapi_partner: !!process.env.WHAPI_PARTNER_TOKEN,
      },
      avisos,
    },
    // 503 si algo está mal: así un chequeo automático lo nota sin leer el JSON.
    { status: avisos.length === 0 ? 200 : 503 },
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
function esPuntoDeMontaje(carpeta: string): boolean | null {
  try {
    if (!existsSync("/proc/self/mountinfo")) return null;

    const lineas = readFileSync("/proc/self/mountinfo", "utf8").split("\n");

    // Barras al estilo POSIX y sin la final, que es como aparecen en mountinfo.
    const normalizada = carpeta.replace(/\\/g, "/").replace(/\/+$/, "");

    return lineas.some((l) => {
      // El quinto campo de cada línea es el punto de montaje.
      const destino = l.split(" ")[4];
      return destino === normalizada;
    });
  } catch {
    return null;
  }
}
