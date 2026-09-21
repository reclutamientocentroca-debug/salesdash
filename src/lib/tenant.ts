/**
 * SalesDash — resolución del inquilino.
 *
 * Toda página bajo `(app)` y toda API salvo las de autenticación y el webhook
 * empiezan aquí. El `orgId` sale SIEMPRE de la cookie firmada: nunca del body,
 * nunca del query string. Si el cliente pudiera mandar el `orgId`, podría
 * mandar el de otro.
 *
 * Este módulo solo corre en el servidor. No lo importes desde un componente
 * de cliente: arrastra better-sqlite3.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  COOKIE_SESION,
  firmarSesion,
  opcionesCookie,
  verificarSesion,
  type Sesion,
} from "./auth";
import { canalesDeMiembro, husoDeLaCuenta, obtenerOrg, obtenerUsuario, type Org, type Usuario } from "./db";
import { rangoAEpochs as rangoEnHuso, type Periodo } from "./rango";

export interface Contexto {
  userId: number;
  orgId: number;
  superadmin: boolean;
  usuario: Usuario;
  org: Org;
  /**
   * EL REPARTO DE NÚMEROS Y PÁGINAS POR MIEMBRO.
   *
   * `null` es «sin restricción»: ve y atiende todos los canales de la cuenta,
   * que es lo que vale siempre para el dueño y para un miembro al que nadie le
   * asignó nada todavía —el reparto es algo que el dueño ENCIENDE marcando
   * canales, no un candado que aparece solo—. Con algo dentro, es la lista
   * exacta de `canal_id` que ese miembro puede ver y tocar: en cualquier
   * pantalla o ruta que enseñe conversaciones o canales, hay que pasar esto
   * como filtro, y en cualquier acción sobre UNA conversación o UN canal hay
   * que comprobar que su `canal_id` está aquí dentro. Ver `puedeAtenderCanal`.
   */
  canalesPermitidos: number[] | null;
}

/**
 * ¿PUEDE ESTE USUARIO TOCAR ESTE CANAL?
 *
 * La misma pregunta se repite en cada ruta que actúa sobre una conversación o
 * un canal concretos —no solo en las que listan—, así que vive en un solo
 * sitio: escribirla dos veces es la forma en que una de las dos copias se
 * queda desactualizada el día que cambia la regla.
 */
export function puedeAtenderCanal(ctx: Contexto, canalId: number): boolean {
  return ctx.canalesPermitidos === null || ctx.canalesPermitidos.includes(canalId);
}

/**
 * Devuelve el contexto de la sesión, o null si no hay.
 *
 * Revalida contra la base en cada petición, no solo la firma del token: así,
 * si a la cuenta se le fuerza reverificación o se le suspende, la sesión
 * abierta deja de servir de inmediato en vez de durar 30 días.
 */
export async function getSession(): Promise<Contexto | null> {
  const galleta = (await cookies()).get(COOKIE_SESION)?.value;
  if (!galleta) return null;

  const sesion = await verificarSesion(galleta);
  if (!sesion) return null;

  const usuario = obtenerUsuario(sesion.userId);
  if (!usuario || !usuario.verificado) return null;

  // El org_id del token tiene que seguir siendo el del usuario. Si no coincide,
  // el token es viejo o está manipulado: no se acepta.
  if (usuario.org_id !== sesion.orgId) return null;

  const org = obtenerOrg(usuario.org_id);
  if (!org || org.suspendida) return null;

  /*
   * El dueño nunca se restringe a sí mismo: el reparto es una correa que él le
   * pone al equipo, no una jaula en la que también entra. Y para un miembro,
   * sin ninguna fila en `equipo_canales` esto sale `[]`, que `canalesDeMiembro`
   * ya documenta como «todos» — por eso se guarda como `null` y no como el
   * array vacío, para que un `if (ctx.canalesPermitidos)` no se confunda con
   * «tiene cero canales».
   */
  const canalesPermitidos =
    usuario.rol === "dueno" ? null : (() => {
      const asignados = canalesDeMiembro(usuario.org_id, usuario.id);
      return asignados.length > 0 ? asignados : null;
    })();

  return {
    userId: usuario.id,
    orgId: usuario.org_id,
    superadmin: usuario.superadmin === 1,
    usuario,
    org,
    canalesPermitidos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Para páginas del servidor
// ─────────────────────────────────────────────────────────────────────────────

/** Sin sesión, a login. Úsala al principio de cada página bajo `(app)`. */
export async function requerirSesion(): Promise<Contexto> {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  return ctx;
}

/** La consola de plataforma. El rol no se puede obtener desde la interfaz. */
export async function requerirSuperadmin(): Promise<Contexto> {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  if (!ctx.superadmin) redirect("/dashboard");
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Para rutas de API
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoApi =
  | { ok: true; ctx: Contexto }
  | { ok: false; respuesta: NextResponse };

/**
 * Uso en una ruta:
 *   const s = await sesionApi();
 *   if (!s.ok) return s.respuesta;
 *   const { orgId } = s.ctx;
 */
export async function sesionApi(): Promise<ResultadoApi> {
  const ctx = await getSession();
  if (!ctx) {
    return {
      ok: false,
      respuesta: NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 }),
    };
  }
  return { ok: true, ctx };
}

export async function superadminApi(): Promise<ResultadoApi> {
  const s = await sesionApi();
  if (!s.ok) return s;
  if (!s.ctx.superadmin) {
    // 404 y no 403: quien no es superadmin no tiene por qué saber que la
    // consola de plataforma existe.
    return { ok: false, respuesta: NextResponse.json({ error: "No encontrado" }, { status: 404 }) };
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abrir y cerrar sesión
// ─────────────────────────────────────────────────────────────────────────────

export async function abrirSesion(s: Sesion): Promise<void> {
  const token = await firmarSesion(s);
  (await cookies()).set(COOKIE_SESION, token, opcionesCookie());
}

export async function cerrarSesion(): Promise<void> {
  (await cookies()).delete(COOKIE_SESION);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de rango de fechas, compartidas por métricas y listados
// ─────────────────────────────────────────────────────────────────────────────

export const RANGOS = [
  { clave: "hoy", etiqueta: "Hoy", dias: 0 },
  { clave: "ayer", etiqueta: "Ayer", dias: 1 },
  { clave: "7d", etiqueta: "Últimos 7 días", dias: 7 },
  { clave: "30d", etiqueta: "Últimos 30 días", dias: 30 },
  { clave: "mes", etiqueta: "Este mes", dias: -1 },
  { clave: "mes_pasado", etiqueta: "Mes pasado", dias: -2 },
  { clave: "todo", etiqueta: "Todo", dias: -3 },
] as const;

export type ClaveRango = (typeof RANGOS)[number]["clave"];

/**
 * Convierte una clave de rango en el par de epochs que esperan las consultas,
 * con los días contados en el huso que se le dé. Ver `rango.ts`: «hoy» es hoy
 * en Santo Domingo, no en el servidor.
 */
export function rangoAEpochs(clave: string, huso?: string): Periodo {
  return rangoEnHuso(clave, huso);
}

/**
 * Lee `desde`/`hasta`/`rango` de la query. Si vienen fechas explícitas se
 * respetan; si no, se resuelve por clave de rango.
 */
export function rangoDesdeQuery(params: URLSearchParams, huso?: string): Periodo {
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  if (desde && hasta) {
    const d = Number(desde);
    const h = Number(hasta);
    if (Number.isFinite(d) && Number.isFinite(h) && d <= h) return { desde: d, hasta: h };
  }
  return rangoAEpochs(params.get("rango") ?? "7d", huso);
}

/**
 * EL PERIODO DEL PANEL DE UNA CUENTA: leído de la URL y contado en la hora de
 * sus países. Es lo que tienen que usar las páginas y las APIs del panel; con
 * `rangoDesdeQuery` a secas, «hoy» sería el hoy del servidor.
 *
 * Lleva el huso dentro para que las consultas por número puedan volver a
 * contar el mismo periodo en la hora de cada país. Ver `metricasPorCanal`.
 */
export function rangoDeLaCuenta(orgId: number, params: URLSearchParams): Periodo & { huso: string } {
  const huso = husoDeLaCuenta(orgId);
  return { ...rangoDesdeQuery(params, huso), huso };
}
