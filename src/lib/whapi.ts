/**
 * SalesDash — cliente de Whapi.
 *
 * IMPORTANTE: este módulo NO envía mensajes. No hay aquí ninguna función que
 * escriba a un cliente final, ni un envoltorio genérico de `fetch` que
 * permita hacerlo. El envío vive únicamente en `agent.ts`, que es el módulo
 * del agente vendedor. Así, un error en el analista no puede mandar un
 * mensaje aunque lo intente: no tiene por dónde.
 *
 * Endpoints usados (verificados contra la documentación de Whapi):
 *   GET    https://manager.whapi.cloud/projects          — proyectos del socio
 *   PUT    https://manager.whapi.cloud/channels          — crear canal
 *   DELETE https://manager.whapi.cloud/channels/{id}     — eliminar canal
 *   GET    https://gate.whapi.cloud/users/login          — QR en base64
 *   GET    https://gate.whapi.cloud/health               — estado del canal
 *   PATCH  https://gate.whapi.cloud/settings             — apuntar el webhook
 */

const GATE = "https://gate.whapi.cloud";
const MANAGER = "https://manager.whapi.cloud";
const ESPERA_MS = 20_000;

export class ErrorWhapi extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ErrorWhapi";
  }
}

function tokenDeSocio(): string {
  const t = process.env.WHAPI_PARTNER_TOKEN;
  if (!t) {
    throw new ErrorWhapi(
      "Falta WHAPI_PARTNER_TOKEN. Sin él, el panel no puede crear canales.",
      500,
    );
  }
  return t;
}

async function pedir<T>(
  url: string,
  opciones: { metodo?: string; token: string; cuerpo?: unknown },
): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: opciones.metodo ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${opciones.token}`,
        ...(opciones.cuerpo ? { "content-type": "application/json" } : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: AbortSignal.timeout(ESPERA_MS),
      cache: "no-store",
    });
  } catch {
    throw new ErrorWhapi("No hubo respuesta de WhatsApp. Intenta de nuevo.", 504);
  }

  const texto = await respuesta.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    /* Respuesta no-JSON: se maneja abajo con el status. */
  }

  if (!respuesta.ok) {
    const detalle =
      (datos as { error?: { message?: string }; message?: string } | null)?.error?.message ??
      (datos as { message?: string } | null)?.message ??
      `HTTP ${respuesta.status}`;
    throw new ErrorWhapi(detalle, respuesta.status);
  }

  return datos as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canales (API de socio)
// ─────────────────────────────────────────────────────────────────────────────

interface RespuestaCanal {
  id: string;
  token: string;
  name?: string;
  status?: string;
}

let proyectoCache: string | null = null;

async function proyecto(): Promise<string> {
  const configurado = process.env.WHAPI_PARTNER_PROJECT_ID;
  if (configurado) return configurado;
  if (proyectoCache) return proyectoCache;

  const lista = await pedir<{ id: string }[] | { projects: { id: string }[] }>(
    `${MANAGER}/projects`,
    { token: tokenDeSocio() },
  );
  const proyectos = Array.isArray(lista) ? lista : lista.projects;
  const primero = proyectos?.[0]?.id;

  if (!primero) {
    throw new ErrorWhapi(
      "La cuenta de socio de Whapi no tiene proyectos. Crea uno en su panel.",
      502,
    );
  }
  return (proyectoCache = primero);
}

/**
 * Crea el canal y devuelve su id y su token.
 * Whapi avisa que la inicialización completa puede tardar hasta minuto y medio:
 * el QR no siempre está listo en el primer intento, y por eso la pantalla
 * sondea en vez de pedirlo una sola vez.
 */
export async function crearCanalWhapi(nombre: string): Promise<{ id: string; token: string }> {
  const canal = await pedir<RespuestaCanal>(`${MANAGER}/channels`, {
    metodo: "PUT",
    token: tokenDeSocio(),
    cuerpo: { name: nombre.slice(0, 60), projectId: await proyecto() },
  });

  if (!canal?.id || !canal?.token) {
    throw new ErrorWhapi("Whapi creó el canal pero no devolvió su token.", 502);
  }
  return { id: canal.id, token: canal.token };
}

export async function eliminarCanalWhapi(channelId: string): Promise<void> {
  await pedir(`${MANAGER}/channels/${encodeURIComponent(channelId)}`, {
    metodo: "DELETE",
    token: tokenDeSocio(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vinculación por QR
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoQr = "iniciando" | "esperando" | "escaneando" | "conectado" | "expirado" | "error";

export interface Qr {
  estado: EstadoQr;
  /** PNG en base64, listo para un <img src="data:image/png;base64,…">. */
  base64: string | null;
  /** Segundos que le quedan de vida al código. */
  expira: number | null;
}

/**
 * Pide el código QR. `wakeup=true` arranca el canal si estaba dormido.
 * Un 409 significa que el número ya está vinculado: no es un error.
 */
export async function obtenerQr(token: string): Promise<Qr> {
  try {
    const r = await pedir<{ status?: string; type?: string; base64?: string; expire?: number }>(
      `${GATE}/users/login?wakeup=true`,
      { token },
    );

    // status del reto: OK | WAITING | TIMEOUT | ERROR
    if (r.status === "TIMEOUT") return { estado: "expirado", base64: null, expira: 0 };
    if (r.status === "WAITING" || !r.base64) {
      return { estado: "iniciando", base64: null, expira: null };
    }
    return { estado: "esperando", base64: r.base64, expira: r.expire ?? null };
  } catch (e) {
    if (e instanceof ErrorWhapi) {
      if (e.status === 409) return { estado: "conectado", base64: null, expira: null };
      // 422: Whapi no pudo dibujar el QR. Se reintenta en el siguiente sondeo.
      if (e.status === 422) return { estado: "iniciando", base64: null, expira: null };
    }
    throw e;
  }
}

export interface Salud {
  estado: EstadoQr;
  /** Teléfono ya vinculado, normalizado a dígitos. Solo cuando está conectado. */
  phone: string | null;
  nombre: string | null;
  /** El texto crudo de Whapi, para diagnosticar en la consola de plataforma. */
  crudo: string;
}

/**
 * Estado del canal. `wakeup=false` para no despertarlo en cada sondeo.
 * status.text: NOT_INIT | INIT | LAUNCH | QR | AUTH | ERROR | SYNC_ERROR
 */
export async function estadoCanal(token: string, despertar = false): Promise<Salud> {
  const r = await pedir<{
    status?: { text?: string };
    user?: { id?: string; name?: string };
  }>(`${GATE}/health?wakeup=${despertar ? "true" : "false"}&channel_type=web`, { token });

  const texto = r.status?.text ?? "NOT_INIT";

  const estado: EstadoQr =
    texto === "AUTH"
      ? "conectado"
      : texto === "QR"
        ? "esperando"
        : texto === "INIT" || texto === "LAUNCH"
          ? "escaneando"
          : texto === "ERROR" || texto === "SYNC_ERROR"
            ? "error"
            : "iniciando";

  return {
    estado,
    phone: estado === "conectado" ? normalizarTelefono(r.user?.id ?? "") || null : null,
    nombre: r.user?.name ?? null,
    crudo: texto,
  };
}

/** Apunta el webhook del canal a este panel. Se llama al conectar. */
interface WebhookWhapi {
  url?: string;
  events?: unknown[];
  mode?: string;
}

/**
 * Apunta el webhook del canal a este panel CONSERVANDO los que ya hubiera.
 *
 * `PATCH /settings` reemplaza el array de webhooks entero. Mandar solo el
 * nuestro borraría en silencio los de quien ya tenga ese número trabajando
 * —una automatización en Make, por ejemplo— y su operación real dejaría de
 * recibir mensajes sin un solo aviso. Conectar un número para MEDIRLO no
 * puede romper lo que ese número ya hace.
 *
 * Así que primero se lee lo que hay, se quita solo una entrada anterior
 * nuestra (para no duplicarla al reconectar) y se añade la nueva.
 */
export async function apuntarWebhook(token: string, url: string): Promise<void> {
  const nuestro = {
    url,
    events: [{ type: "messages", method: "post" }],
    mode: "method",
  };

  let existentes: WebhookWhapi[] = [];
  try {
    const actual = await pedir<{ webhooks?: WebhookWhapi[] }>(`${GATE}/settings`, { token });
    existentes = actual?.webhooks ?? [];
  } catch (e) {
    // Si no se puede leer la configuración, se prefiere no tocarla: dejar el
    // canal mudo es reparable, borrarle los webhooks a alguien no.
    throw new ErrorWhapi(
      `No se pudo leer la configuración del canal, así que no se tocó: ${
        e instanceof Error ? e.message : "error desconocido"
      }`,
      502,
    );
  }

  /*
   * Se descartan las entradas anteriores de SalesDash, y se reconocen por la
   * RUTA, no por el dominio.
   *
   * Comparar la url completa no basta: si el canal se conectó cuando APP_URL
   * estaba mal —apuntando a localhost, el caso típico de un despliegue recién
   * hecho— esa entrada muerta tiene otro dominio, sobreviviría al filtro y se
   * quedaría ahí para siempre. El canal seguiría sin recibir nada y la lista
   * de webhooks acumularía basura con cada reconexión.
   *
   * La ruta /api/webhook/<id> es nuestra y de nadie más.
   */
  const esNuestro = (u: string) => {
    try {
      return /^\/api\/webhook\/\d+$/.test(new URL(u).pathname);
    } catch {
      return false;
    }
  };

  const deTerceros = existentes.filter((w) => w.url && !esNuestro(w.url));

  await pedir(`${GATE}/settings`, {
    metodo: "PATCH",
    token,
    cuerpo: { webhooks: [...deTerceros, nuestro] },
  });
}

/** Valida un token pegado a mano y devuelve a qué número pertenece. */
export async function validarToken(token: string): Promise<Salud> {
  return estadoCanal(token, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades del payload
// ─────────────────────────────────────────────────────────────────────────────

/** `18095550000@s.whatsapp.net` → `18095550000`. Solo dígitos. */
export function normalizarTelefono(bruto: string): string {
  return (bruto.split("@")[0] ?? "").replace(/\D/g, "");
}

/** Los grupos no se miden: no son conversaciones de venta uno a uno. */
export function esGrupo(chatId: string): boolean {
  return chatId.endsWith("@g.us");
}

/** Traduce los errores de Whapi a algo que el usuario pueda accionar. */
export function mensajeDeError(e: ErrorWhapi): string {
  if (e.status === 401 || e.status === 403) return "El token no es válido o ya no tiene acceso.";
  if (e.status === 404) return "Ese canal ya no existe en Whapi.";
  if (e.status === 429) return "Whapi está limitando las peticiones. Espera un minuto e intenta de nuevo.";
  if (e.status === 504) return "WhatsApp no respondió a tiempo. Intenta de nuevo.";
  return e.message;
}

export function armarUrlWebhook(canalId: number, secreto: string): string {
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/webhook/${canalId}?s=${encodeURIComponent(secreto)}`;
}
