/**
 * SalesDash — consola de plataforma.
 *
 * ═══ EL ÚNICO MÓDULO QUE CRUZA ORGANIZACIONES ═══
 *
 * Todas las excepciones a la regla del `org_id` viven aquí, en un solo archivo
 * que se puede auditar de una sentada. `db.ts` se mantiene intacto: ninguna de
 * sus funciones de negocio existe sin `orgId`.
 *
 * Cada función empieza verificando `superadmin = 1`. No basta con que la ruta
 * lo compruebe: si mañana alguien llama a una de estas desde otro sitio, la
 * comprobación sigue estando.
 *
 * LO QUE ESTE MÓDULO NO PUEDE DEVOLVER, Y NO DEVUELVE:
 *   - el contenido de ninguna conversación
 *   - nombres o teléfonos de los clientes finales
 *   - tokens de Whapi en claro
 *
 * Las métricas son agregados. Los datos personales de los clientes de tus
 * clientes no se exponen en esta consola.
 */
// `deAnuncio` es la MISMA condición que usa el panel del cliente: aquí abajo,
// «lead» tiene que significar exactamente lo que significa allí.
import { ahora, db, deAnuncio, facturado, type SoporteAcceso } from "./db";
import type { Contexto } from "./tenant";

/** Puerta de entrada. Si esto falla, no se ejecuta nada más. */
function exigirSuperadmin(ctx: Contexto): void {
  if (!ctx.superadmin) {
    throw new Error("Esta consulta cruza organizaciones y exige rol de plataforma");
  }
}

const UN_DIA = 86_400;

// ─────────────────────────────────────────────────────────────────────────────
// Resumen de la plataforma
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumenPlataforma {
  cuentas: number;
  cuentas_activas_7d: number;
  cuentas_suspendidas: number;
  numeros_conectados: number;
  agentes_activos: number;
  /** Toda conversación abierta. Es el trabajo que ha procesado la plataforma. */
  leads: number;
  /** De ellas, las que trajo un anuncio: los leads por los que se paga. */
  leads_anuncio: number;
  cierres_ia: number;
  cierres_humano: number;
  ventas_totales: number;
}

export function resumenPlataforma(ctx: Contexto): ResumenPlataforma {
  exigirSuperadmin(ctx);
  const t = ahora();

  const uno = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;

  const cuentas = uno<{ n: number; suspendidas: number }>(
    `SELECT COUNT(*) AS n, SUM(suspendida) AS suspendidas FROM orgs`,
  );

  const activas = uno<{ n: number }>(
    `SELECT COUNT(DISTINCT org_id) AS n FROM conversations WHERE last_message_at >= ?`,
    t - 7 * UN_DIA,
  );

  const canales = uno<{ conectados: number; con_agente: number }>(
    `SELECT
       SUM(CASE WHEN estado = 'conectado' AND activo = 1 THEN 1 ELSE 0 END) AS conectados,
       SUM(CASE WHEN agente_activo = 1 AND activo = 1 THEN 1 ELSE 0 END) AS con_agente
     FROM canales`,
  );

  const conv = uno<{ leads: number; anuncio: number; ia: number; humano: number; ventas: number }>(
    `SELECT COUNT(*) AS leads,
            SUM(CASE WHEN ${deAnuncio()} THEN 1 ELSE 0 END) AS anuncio,
            SUM(CASE WHEN cerrado_por = 'ia' THEN 1 ELSE 0 END) AS ia,
            SUM(CASE WHEN cerrado_por = 'humano' THEN 1 ELSE 0 END) AS humano,
            COALESCE(SUM(CASE WHEN cerrado_por IN ('ia','humano') THEN ${facturado()} END), 0) AS ventas
       FROM conversations`,
  );

  return {
    cuentas: cuentas.n,
    cuentas_activas_7d: activas.n,
    cuentas_suspendidas: cuentas.suspendidas ?? 0,
    numeros_conectados: canales.conectados ?? 0,
    agentes_activos: canales.con_agente ?? 0,
    leads: conv.leads,
    leads_anuncio: conv.anuncio ?? 0,
    cierres_ia: conv.ia ?? 0,
    cierres_humano: conv.humano ?? 0,
    ventas_totales: Math.round((conv.ventas ?? 0) * 100) / 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Listado de organizaciones
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaOrg {
  id: number;
  nombre: string;
  correo_dueno: string;
  created_at: number;
  suspendida: boolean;
  numeros: number;
  numeros_conectados: number;
  leads_mes: number;
  leads_anuncio_mes: number;
  cierres_ia: number;
  cierres_humano: number;
  tasa_cierre: number;
  ultima_actividad: number | null;
  anomalias_altas: number;
  agente_activo: boolean;
}

export function listarOrgs(ctx: Contexto): FilaOrg[] {
  exigirSuperadmin(ctx);
  const desdeMes = ahora() - 30 * UN_DIA;

  const filas = db
    .prepare(
      `SELECT
         o.id, o.nombre, o.suspendida, o.created_at,
         (SELECT email FROM users u WHERE u.org_id = o.id AND u.rol = 'dueno'
           ORDER BY u.id ASC LIMIT 1) AS correo_dueno,
         (SELECT COUNT(*) FROM canales c WHERE c.org_id = o.id) AS numeros,
         (SELECT COUNT(*) FROM canales c WHERE c.org_id = o.id AND c.estado = 'conectado') AS conectados,
         (SELECT COUNT(*) FROM canales c WHERE c.org_id = o.id AND c.agente_activo = 1) AS con_agente,
         (SELECT COUNT(*) FROM conversations v WHERE v.org_id = o.id AND v.fecha_inicio >= ?) AS leads_mes,
         (SELECT COUNT(*) FROM conversations v WHERE v.org_id = o.id AND v.fecha_inicio >= ?
            AND ${deAnuncio("v.")}) AS leads_anuncio_mes,
         (SELECT COUNT(*) FROM conversations v WHERE v.org_id = o.id AND v.fecha_inicio >= ?
            AND v.cerrado_por = 'ia') AS cierres_ia,
         (SELECT COUNT(*) FROM conversations v WHERE v.org_id = o.id AND v.fecha_inicio >= ?
            AND v.cerrado_por = 'humano') AS cierres_humano,
         (SELECT MAX(last_message_at) FROM conversations v WHERE v.org_id = o.id) AS ultima_actividad,
         (SELECT COUNT(*) FROM anomalies a WHERE a.org_id = o.id AND a.resuelta = 0
            AND a.severidad = 'alta') AS anomalias_altas
       FROM orgs o
       ORDER BY o.created_at DESC`,
    )
    .all(desdeMes, desdeMes, desdeMes, desdeMes) as {
    id: number; nombre: string; suspendida: number; created_at: number;
    correo_dueno: string | null; numeros: number; conectados: number; con_agente: number;
    leads_mes: number; leads_anuncio_mes: number; cierres_ia: number; cierres_humano: number;
    ultima_actividad: number | null; anomalias_altas: number;
  }[];

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    correo_dueno: f.correo_dueno ?? "—",
    created_at: f.created_at,
    suspendida: f.suspendida === 1,
    numeros: f.numeros,
    numeros_conectados: f.conectados,
    leads_mes: f.leads_mes,
    leads_anuncio_mes: f.leads_anuncio_mes,
    cierres_ia: f.cierres_ia,
    cierres_humano: f.cierres_humano,
    tasa_cierre:
      f.leads_mes === 0
        ? 0
        : Math.round(((f.cierres_ia + f.cierres_humano) / f.leads_mes) * 1000) / 10,
    ultima_actividad: f.ultima_actividad,
    anomalias_altas: f.anomalias_altas,
    agente_activo: f.con_agente > 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ficha de una organización
// ─────────────────────────────────────────────────────────────────────────────

export interface FichaOrg {
  id: number;
  nombre: string;
  created_at: number;
  suspendida: boolean;
  modelo_analisis: string;
  modelo_vision: string;
  modelo_agente: string;
  modelo_respaldo: string | null;
  usuarios: { id: number; nombre: string; email: string; rol: string; verificado: boolean }[];
  /** Sin token, ni en claro ni cifrado: aquí no hace ninguna falta. */
  canales: {
    id: number; nombre: string; phone: string | null; estado: string;
    agente_activo: boolean; activo: boolean;
    ultimo_evento_at: number | null; webhook_vivo: boolean;
  }[];
  metricas: {
    leads: number; leads_anuncio: number; cierres_ia: number; cierres_humano: number;
    abiertas: number; revision: number; ventas: number;
  };
  anomalias: { tipo: string; severidad: string; n: number }[];
  consumo: { modelo: string; proposito: string; exitos: number; fallos: number }[];
  soporte: SoporteAcceso[];
}

export function fichaOrg(ctx: Contexto, orgId: number): FichaOrg | null {
  exigirSuperadmin(ctx);

  const org = db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(orgId) as
    | { id: number; nombre: string; created_at: number; suspendida: number;
        modelo_analisis: string; modelo_vision: string }
    | undefined;
  if (!org) return null;

  const agente = db.prepare(`SELECT modelo, modelo_respaldo FROM agentes WHERE org_id = ?`).get(orgId) as
    | { modelo: string; modelo_respaldo: string | null }
    | undefined;

  const usuarios = db
    .prepare(`SELECT id, nombre, email, rol, verificado FROM users WHERE org_id = ? ORDER BY id`)
    .all(orgId) as { id: number; nombre: string; email: string; rol: string; verificado: number }[];

  const canales = db
    .prepare(
      `SELECT id, nombre, phone, estado, agente_activo, activo, ultimo_evento_at
         FROM canales WHERE org_id = ? ORDER BY created_at`,
    )
    .all(orgId) as {
    id: number; nombre: string; phone: string; estado: string;
    agente_activo: number; activo: number; ultimo_evento_at: number | null;
  }[];

  const m = db
    .prepare(
      `SELECT COUNT(*) AS leads,
              SUM(CASE WHEN ${deAnuncio()} THEN 1 ELSE 0 END) AS anuncio,
              SUM(CASE WHEN cerrado_por = 'ia' THEN 1 ELSE 0 END) AS ia,
              SUM(CASE WHEN cerrado_por = 'humano' THEN 1 ELSE 0 END) AS humano,
              SUM(CASE WHEN cerrado_por = 'abierta' THEN 1 ELSE 0 END) AS abiertas,
              SUM(CASE WHEN cerrado_por = 'revision' THEN 1 ELSE 0 END) AS revision,
              COALESCE(SUM(CASE WHEN cerrado_por IN ('ia','humano') THEN ${facturado()} END), 0) AS ventas
         FROM conversations WHERE org_id = ?`,
    )
    .get(orgId) as {
    leads: number; anuncio: number; ia: number; humano: number;
    abiertas: number; revision: number; ventas: number;
  };

  const anomalias = db
    .prepare(
      `SELECT tipo, severidad, COUNT(*) AS n FROM anomalies
        WHERE org_id = ? AND resuelta = 0 GROUP BY tipo, severidad ORDER BY n DESC`,
    )
    .all(orgId) as { tipo: string; severidad: string; n: number }[];

  const consumo = db
    .prepare(
      `SELECT modelo, proposito, SUM(exitos) AS exitos, SUM(fallos) AS fallos
         FROM uso_modelo WHERE org_id = ? AND dia >= date('now', '-7 days')
        GROUP BY modelo, proposito ORDER BY exitos DESC`,
    )
    .all(orgId) as { modelo: string; proposito: string; exitos: number; fallos: number }[];

  const soporte = db
    .prepare(`SELECT * FROM soporte_accesos WHERE org_id = ? ORDER BY solicitado_at DESC LIMIT 20`)
    .all(orgId) as SoporteAcceso[];

  const t = ahora();

  return {
    id: org.id,
    nombre: org.nombre,
    created_at: org.created_at,
    suspendida: org.suspendida === 1,
    modelo_analisis: org.modelo_analisis,
    modelo_vision: org.modelo_vision,
    modelo_agente: agente?.modelo ?? "—",
    modelo_respaldo: agente?.modelo_respaldo ?? null,
    usuarios: usuarios.map((u) => ({ ...u, verificado: u.verificado === 1 })),
    canales: canales.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      phone: c.phone.startsWith("pendiente:") ? null : c.phone,
      estado: c.estado,
      agente_activo: c.agente_activo === 1,
      activo: c.activo === 1,
      ultimo_evento_at: c.ultimo_evento_at,
      // Sin eventos en 24 h con el canal conectado: el webhook está caído.
      webhook_vivo: c.estado !== "conectado" || (c.ultimo_evento_at ?? 0) > t - UN_DIA,
    })),
    metricas: {
      leads: m.leads,
      leads_anuncio: m.anuncio ?? 0,
      cierres_ia: m.ia ?? 0,
      cierres_humano: m.humano ?? 0,
      abiertas: m.abiertas ?? 0,
      revision: m.revision ?? 0,
      ventas: Math.round((m.ventas ?? 0) * 100) / 100,
    },
    anomalias,
    consumo,
    soporte,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Salud técnica
// ─────────────────────────────────────────────────────────────────────────────

export interface Salud {
  webhooks_caidos: { org_id: number; org: string; canal: string; ultimo_evento_at: number | null }[];
  anomalias_por_org: { org_id: number; org: string; altas: number; medias: number }[];
  fallos_de_modelo: { org_id: number; org: string; modelo: string; fallos: number }[];
}

export function saludTecnica(ctx: Contexto): Salud {
  exigirSuperadmin(ctx);
  const limite = ahora() - UN_DIA;

  return {
    webhooks_caidos: db
      .prepare(
        `SELECT c.org_id, o.nombre AS org, c.nombre AS canal, c.ultimo_evento_at
           FROM canales c JOIN orgs o ON o.id = c.org_id
          WHERE c.activo = 1 AND c.estado = 'conectado'
            AND (c.ultimo_evento_at IS NULL OR c.ultimo_evento_at < ?)
          ORDER BY c.ultimo_evento_at ASC NULLS FIRST`,
      )
      .all(limite) as Salud["webhooks_caidos"],

    anomalias_por_org: db
      .prepare(
        `SELECT a.org_id, o.nombre AS org,
                SUM(CASE WHEN a.severidad = 'alta' THEN 1 ELSE 0 END) AS altas,
                SUM(CASE WHEN a.severidad = 'media' THEN 1 ELSE 0 END) AS medias
           FROM anomalies a JOIN orgs o ON o.id = a.org_id
          WHERE a.resuelta = 0
          GROUP BY a.org_id HAVING altas + medias > 0
          ORDER BY altas DESC, medias DESC`,
      )
      .all() as Salud["anomalias_por_org"],

    fallos_de_modelo: db
      .prepare(
        `SELECT u.org_id, o.nombre AS org, u.modelo, SUM(u.fallos) AS fallos
           FROM uso_modelo u JOIN orgs o ON o.id = u.org_id
          WHERE u.dia >= date('now', '-7 days')
          GROUP BY u.org_id, u.modelo HAVING fallos > 0
          ORDER BY fallos DESC LIMIT 30`,
      )
      .all() as Salud["fallos_de_modelo"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Acciones
// ─────────────────────────────────────────────────────────────────────────────

export function suspenderOrg(ctx: Contexto, orgId: number, suspendida: boolean): void {
  exigirSuperadmin(ctx);
  db.prepare(`UPDATE orgs SET suspendida = ? WHERE id = ?`).run(suspendida ? 1 : 0, orgId);
}

/** Correo del dueño, para avisarle de una solicitud de soporte. */
export function correoDelDueno(ctx: Contexto, orgId: number): { email: string; nombre: string } | null {
  exigirSuperadmin(ctx);
  return (
    (db
      .prepare(
        `SELECT email, nombre FROM users WHERE org_id = ? AND rol = 'dueno' ORDER BY id LIMIT 1`,
      )
      .get(orgId) as { email: string; nombre: string } | undefined) ?? null
  );
}

/**
 * Solicita acceso a una cuenta. NO concede nada: crea la petición en estado
 * `solicitado`. Solo el dueño puede aprobarla, desde su propio panel.
 */
export function solicitarSoporte(ctx: Contexto, orgId: number, motivo: string): number {
  exigirSuperadmin(ctx);

  const r = db
    .prepare(`INSERT INTO soporte_accesos (org_id, admin_user_id, motivo) VALUES (?, ?, ?)`)
    .run(orgId, ctx.userId, motivo);

  return Number(r.lastInsertRowid);
}

/** Marca como expiradas las que ya pasaron de hora. */
export function expirarSoportes(ctx: Contexto): number {
  exigirSuperadmin(ctx);
  const r = db
    .prepare(
      `UPDATE soporte_accesos SET estado = 'expirado'
        WHERE estado = 'aprobado' AND expira_at IS NOT NULL AND expira_at <= unixepoch()`,
    )
    .run();
  return r.changes;
}

export function listarSoporte(ctx: Contexto): (SoporteAcceso & { org: string; admin: string })[] {
  exigirSuperadmin(ctx);
  return db
    .prepare(
      `SELECT s.*, o.nombre AS org, u.nombre AS admin
         FROM soporte_accesos s
         JOIN orgs o ON o.id = s.org_id
         JOIN users u ON u.id = s.admin_user_id
        ORDER BY s.solicitado_at DESC LIMIT 100`,
    )
    .all() as (SoporteAcceso & { org: string; admin: string })[];
}
