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
import { obtenerOrg, obtenerUsuario, type Org, type Usuario } from "./db";

export interface Contexto {
  userId: number;
  orgId: number;
  superadmin: boolean;
  usuario: Usuario;
  org: Org;
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

  return {
    userId: usuario.id,
    orgId: usuario.org_id,
    superadmin: usuario.superadmin === 1,
    usuario,
    org,
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

/** Convierte una clave de rango en el par de epochs que esperan las consultas. */
export function rangoAEpochs(clave: string): { desde: number; hasta: number } {
  const ahora = new Date();
  const inicioDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const seg = (d: Date) => Math.floor(d.getTime() / 1000);
  const finDelDia = (d: Date) => seg(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));

  switch (clave) {
    case "hoy":
      return { desde: seg(inicioDeHoy), hasta: finDelDia(inicioDeHoy) };
    case "ayer": {
      const ayer = new Date(inicioDeHoy);
      ayer.setDate(ayer.getDate() - 1);
      return { desde: seg(ayer), hasta: finDelDia(ayer) };
    }
    case "7d":
    case "30d": {
      const dias = clave === "7d" ? 6 : 29;
      const desde = new Date(inicioDeHoy);
      desde.setDate(desde.getDate() - dias);
      return { desde: seg(desde), hasta: finDelDia(inicioDeHoy) };
    }
    case "mes": {
      const desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      return { desde: seg(desde), hasta: finDelDia(inicioDeHoy) };
    }
    case "mes_pasado": {
      const desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
      return { desde: seg(desde), hasta: finDelDia(hasta) };
    }
    case "todo":
      return { desde: 0, hasta: finDelDia(inicioDeHoy) };
    default:
      return rangoAEpochs("7d");
  }
}

/**
 * Lee `desde`/`hasta`/`rango` de la query. Si vienen fechas explícitas se
 * respetan; si no, se resuelve por clave de rango.
 */
export function rangoDesdeQuery(params: URLSearchParams): { desde: number; hasta: number } {
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  if (desde && hasta) {
    const d = Number(desde);
    const h = Number(hasta);
    if (Number.isFinite(d) && Number.isFinite(h) && d <= h) return { desde: d, hasta: h };
  }
  return rangoAEpochs(params.get("rango") ?? "7d");
}
