/**
 * SalesDash — acceso a datos.
 *
 * Este es el ÚNICO módulo con SQL de negocio. Ningún componente, ninguna ruta
 * de API escribe SQL: todo pasa por aquí. Si algún día hay que migrar a
 * Postgres, se reemplaza este archivo y la aplicación no se entera.
 *
 * REGLA INNEGOCIABLE DE AISLAMIENTO
 * Toda función que lea o escriba datos de negocio recibe `orgId` como primer
 * parámetro y lo aplica en un `WHERE org_id = ?`. No existe una función que
 * devuelva datos de más de una organización. Las consultas que cruzan
 * organizaciones viven, todas, en `admin-db.ts`.
 *
 * Las dos excepciones están marcadas con EXCEPCIÓN y justificadas en el sitio:
 * la capa de identidad (crear cuenta, buscar por correo) y la resolución del
 * canal en el webhook, que no recibe `org_id` sino que lo deduce.
 */
import Database from "better-sqlite3";
import type { Database as DB, Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Esquema
// ─────────────────────────────────────────────────────────────────────────────

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#12876a',
  meta_cobertura INTEGER NOT NULL DEFAULT 90,
  meta_efectividad INTEGER NOT NULL DEFAULT 80,
  marcador_cierre TEXT NOT NULL DEFAULT 'Resumen:',
  modelo_analisis TEXT NOT NULL DEFAULT 'meta-llama/llama-3.3-70b-instruct:free',
  modelo_vision TEXT NOT NULL DEFAULT 'openai/gpt-4o-mini',
  suspendida INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT CHECK(rol IN ('dueno','miembro')) NOT NULL DEFAULT 'dueno',
  superadmin INTEGER NOT NULL DEFAULT 0,
  /* El registro es directo: la cuenta nace utilizable. La columna se conserva
     porque la interfaz y la API la leen, y para no necesitar una migración si
     algún día vuelve a exigirse verificación por correo. */
  verificado INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS canales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  nombre TEXT NOT NULL,
  phone TEXT NOT NULL,
  token_cifrado TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  whapi_channel_id TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  ultimo_evento_at INTEGER,
  agente_activo INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(org_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_canales_org ON canales(org_id);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  canal_id INTEGER NOT NULL REFERENCES canales(id),
  cliente_phone TEXT NOT NULL,
  cliente_nombre TEXT,
  origen TEXT,
  producto_anuncio TEXT,
  intervencion_humana INTEGER NOT NULL DEFAULT 0,
  cerrado_por TEXT CHECK(cerrado_por IN ('ia','humano','abierta','revision')) NOT NULL DEFAULT 'abierta',
  senal_de_cierre TEXT,
  total REAL, envio REAL,
  producto_vendido TEXT, resumen_pedido TEXT,
  justificacion TEXT, datos_faltantes TEXT, motivo_perdida TEXT,
  analizada_at INTEGER,
  fecha_inicio INTEGER NOT NULL DEFAULT (unixepoch()),
  fecha_cierre INTEGER, last_message_at INTEGER,
  UNIQUE(canal_id, cliente_phone)
);
CREATE INDEX IF NOT EXISTS idx_conv_org_fecha ON conversations(org_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_conv_org_estado ON conversations(org_id, cerrado_por);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  whapi_message_id TEXT UNIQUE,
  emisor TEXT CHECK(emisor IN ('cliente','ia','humano')) NOT NULL,
  tipo TEXT CHECK(tipo IN ('texto','imagen','audio','documento','otro')) NOT NULL DEFAULT 'texto',
  descripcion_imagen TEXT,
  categoria_imagen TEXT CHECK(categoria_imagen IN ('factura','comprobante_pago','foto_producto','otro')),
  media_url TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_sent_ids (
  whapi_message_id TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  nombre TEXT NOT NULL DEFAULT 'Asistente',
  tono TEXT NOT NULL DEFAULT 'cercano',
  instrucciones TEXT NOT NULL DEFAULT '',
  modelo TEXT NOT NULL DEFAULT 'meta-llama/llama-3.3-70b-instruct:free',
  modelo_respaldo TEXT,
  pasar_a_humano INTEGER NOT NULL DEFAULT 1,
  silenciar_si_humano INTEGER NOT NULL DEFAULT 1,
  horario_activo INTEGER NOT NULL DEFAULT 0,
  horario_desde TEXT, horario_hasta TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(org_id)
);

CREATE TABLE IF NOT EXISTS catalogo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  nombre TEXT NOT NULL,
  variantes TEXT,
  precio REAL,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_catalogo_org ON catalogo(org_id);

/*
 * conversation_id es NULL en las anomalías de canal (webhook caído, canal por
 * debajo de su promedio), que no pertenecen a ninguna conversación. Dos de las
 * seis reglas obligatorias son de ese tipo.
 */
CREATE TABLE IF NOT EXISTS anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  conversation_id INTEGER REFERENCES conversations(id),
  canal_id INTEGER REFERENCES canales(id),
  tipo TEXT NOT NULL,
  severidad TEXT CHECK(severidad IN ('alta','media')) NOT NULL DEFAULT 'media',
  detalle TEXT, resuelta INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (conversation_id IS NOT NULL OR canal_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_anom_org ON anomalies(org_id, resuelta);

CREATE TABLE IF NOT EXISTS soporte_accesos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  motivo TEXT NOT NULL,
  estado TEXT CHECK(estado IN ('solicitado','aprobado','rechazado','expirado')) NOT NULL DEFAULT 'solicitado',
  solicitado_at INTEGER NOT NULL DEFAULT (unixepoch()),
  aprobado_at INTEGER,
  expira_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_soporte_org ON soporte_accesos(org_id, estado);

/* Consumo de modelos: alimenta el indicador del agente y la salud del admin. */
CREATE TABLE IF NOT EXISTS uso_modelo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  dia TEXT NOT NULL,
  modelo TEXT NOT NULL,
  proposito TEXT CHECK(proposito IN ('agente','analisis','vision')) NOT NULL,
  exitos INTEGER NOT NULL DEFAULT 0,
  fallos INTEGER NOT NULL DEFAULT 0,
  UNIQUE(org_id, dia, modelo, proposito)
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Conexión
// ─────────────────────────────────────────────────────────────────────────────

const RUTA_DB =
  process.env.SALESDASH_DB === ":memory:"
    ? ":memory:"
    : process.env.SALESDASH_DB
      ? resolve(process.env.SALESDASH_DB)
      : resolve(process.cwd(), "data", "salesdash.db");

/**
 * La carpeta donde vive todo lo que tiene que sobrevivir a un redespliegue: la
 * base de datos y, desde que se conecta por QR, las sesiones de WhatsApp.
 *
 * Con `:memory:` —las pruebas— no hay carpeta de base, así que se cae a `data/`
 * del proyecto para que nada intente escribir en la raíz del disco.
 */
export function rutaDatos(): string {
  return RUTA_DB === ":memory:" ? resolve(process.cwd(), "data") : dirname(RUTA_DB);
}

// En dev, Next recarga los módulos en caliente; sin esto se abrirían decenas
// de conexiones a la misma base.
const global_ = globalThis as unknown as { __salesdash_db?: DB };

function abrir(): DB {
  if (RUTA_DB !== ":memory:") mkdirSync(dirname(RUTA_DB), { recursive: true });

  const conexion = new Database(RUTA_DB);
  conexion.pragma("journal_mode = WAL");
  conexion.pragma("foreign_keys = ON");
  conexion.exec(DDL);
  migrar(conexion);
  return conexion;
}

/**
 * Migraciones. `CREATE TABLE IF NOT EXISTS` no toca las tablas que ya existen,
 * así que los cambios de forma sobre una base viva van aquí.
 */
function migrar(conexion: DB): void {
  const columnas = (tabla: string) =>
    (conexion.pragma(`table_info(${tabla})`) as { name: string }[]).map((c) => c.name);

  // anomalies: las anomalías de canal no tienen conversación.
  if (!columnas("anomalies").includes("canal_id")) {
    conexion.exec(`
      ALTER TABLE anomalies RENAME TO anomalies_viejo;

      CREATE TABLE anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL REFERENCES orgs(id),
        conversation_id INTEGER REFERENCES conversations(id),
        canal_id INTEGER REFERENCES canales(id),
        tipo TEXT NOT NULL,
        severidad TEXT CHECK(severidad IN ('alta','media')) NOT NULL DEFAULT 'media',
        detalle TEXT, resuelta INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CHECK (conversation_id IS NOT NULL OR canal_id IS NOT NULL)
      );

      INSERT INTO anomalies (id, org_id, conversation_id, tipo, severidad, detalle, resuelta, created_at)
        SELECT id, org_id, conversation_id, tipo, severidad, detalle, resuelta, created_at
          FROM anomalies_viejo;

      DROP TABLE anomalies_viejo;
      CREATE INDEX IF NOT EXISTS idx_anom_org ON anomalies(org_id, resuelta);
    `);
  }
}

export const db: DB = global_.__salesdash_db ?? (global_.__salesdash_db = abrir());

/** Prepara una sentencia una sola vez y la reutiliza. */
const cache = new Map<string, Statement>();
function s(sql: string): Statement {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

export const ahora = () => Math.floor(Date.now() / 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type Emisor = "cliente" | "ia" | "humano";
export type TipoMensaje = "texto" | "imagen" | "audio" | "documento" | "otro";
export type CategoriaImagen = "factura" | "comprobante_pago" | "foto_producto" | "otro";
/**
 * Los cinco estados del procedimiento diario. `lead_nuevo` no es una columna:
 * toda conversación es un lead desde que existe, y su estado de cierre es uno
 * de estos cuatro. De ahí la invariante:
 *   leads = cerradas_ia + cerradas_humano + abiertas + revision
 */
export type EstadoCierre = "ia" | "humano" | "abierta" | "revision";

export interface Org {
  id: number; nombre: string; color: string;
  meta_cobertura: number; meta_efectividad: number;
  marcador_cierre: string; modelo_analisis: string; modelo_vision: string;
  suspendida: number; created_at: number;
}

export interface Usuario {
  id: number; org_id: number; email: string; nombre: string;
  password_hash: string; rol: "dueno" | "miembro";
  superadmin: number; verificado: number; created_at: number;
}

export interface Canal {
  id: number; org_id: number; nombre: string; phone: string;
  token_cifrado: string; webhook_secret: string;
  whapi_channel_id: string | null; estado: string; ultimo_evento_at: number | null;
  agente_activo: number; activo: number; created_at: number;
}

export interface Conversacion {
  id: number; org_id: number; canal_id: number;
  cliente_phone: string; cliente_nombre: string | null;
  origen: string | null; producto_anuncio: string | null;
  intervencion_humana: number; cerrado_por: EstadoCierre;
  senal_de_cierre: string | null;
  total: number | null; envio: number | null;
  producto_vendido: string | null; resumen_pedido: string | null;
  justificacion: string | null; datos_faltantes: string | null;
  motivo_perdida: string | null; analizada_at: number | null;
  fecha_inicio: number; fecha_cierre: number | null; last_message_at: number | null;
}

export interface Mensaje {
  id: number; org_id: number; conversation_id: number;
  whapi_message_id: string | null; emisor: Emisor; tipo: TipoMensaje;
  descripcion_imagen: string | null; categoria_imagen: CategoriaImagen | null;
  media_url: string | null; content: string; created_at: number;
}

export interface Agente {
  id: number; org_id: number; nombre: string; tono: string;
  instrucciones: string; modelo: string; modelo_respaldo: string | null;
  pasar_a_humano: number; silenciar_si_humano: number;
  horario_activo: number; horario_desde: string | null; horario_hasta: string | null;
  updated_at: number;
}

export interface Producto {
  id: number; org_id: number; nombre: string;
  variantes: string | null; precio: number | null; activo: number;
}

export interface Anomalia {
  id: number; org_id: number;
  conversation_id: number | null; canal_id: number | null;
  tipo: string; severidad: "alta" | "media"; detalle: string | null;
  resuelta: number; created_at: number;
}

export interface SoporteAcceso {
  id: number; org_id: number; admin_user_id: number; motivo: string;
  estado: "solicitado" | "aprobado" | "rechazado" | "expirado";
  solicitado_at: number; aprobado_at: number | null; expira_at: number | null;
}

/** Construye `SET a = ?, b = ?` solo con las columnas permitidas y presentes. */
function armarSet(campos: Record<string, unknown>, permitidas: readonly string[]) {
  const claves = Object.keys(campos).filter(
    (k) => permitidas.includes(k) && campos[k] !== undefined,
  );
  return { sql: claves.map((k) => `${k} = ?`).join(", "), valores: claves.map((k) => campos[k]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad — orgs y usuarios
//
// EXCEPCIÓN a la regla del `orgId`: estas funciones son las que CREAN la
// organización o resuelven quién eres antes de que exista una sesión. No
// pueden recibir un `orgId` porque todavía no hay ninguno. Ninguna devuelve
// datos de negocio: solo la fila del usuario que se autentica.
// ─────────────────────────────────────────────────────────────────────────────

export function crearOrgConDueno(datos: {
  negocio: string; color: string;
  nombre: string; email: string; passwordHash: string;
}): { orgId: number; userId: number } {
  const tx = db.transaction((d: typeof datos) => {
    const org = s(`INSERT INTO orgs (nombre, color) VALUES (?, ?)`).run(d.negocio, d.color);
    const orgId = Number(org.lastInsertRowid);

    // `verificado = 1` de entrada: el registro es directo, sin código por
    // correo. La columna se conserva porque la interfaz y la API la leen, y
    // porque volver a exigir verificación algún día no debería costar una
    // migración.
    const user = s(
      `INSERT INTO users (org_id, email, nombre, password_hash, rol, verificado)
       VALUES (?, ?, ?, ?, 'dueno', 1)`,
    ).run(orgId, d.email.toLowerCase(), d.nombre, d.passwordHash);

    // Toda organización nace con su agente vendedor configurado y APAGADO.
    s(`INSERT INTO agentes (org_id) VALUES (?)`).run(orgId);

    return { orgId, userId: Number(user.lastInsertRowid) };
  });
  return tx(datos);
}

export function buscarUsuarioPorEmail(email: string): Usuario | undefined {
  return s(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as Usuario | undefined;
}

export function obtenerUsuario(userId: number): Usuario | undefined {
  return s(`SELECT * FROM users WHERE id = ?`).get(userId) as Usuario | undefined;
}

/**
 * Superadmin de la plataforma. No hay forma de concederlo desde la interfaz, y
 * es deliberado: el panel /admin ve todas las organizaciones, así que el
 * primer superadmin tiene que marcarse desde la consola con
 * `npm run superadmin`. Que no exista un botón es la salvaguarda.
 */
export function marcarSuperadmin(userId: number, valor: boolean): void {
  s(`UPDATE users SET superadmin = ? WHERE id = ?`).run(valor ? 1 : 0, userId);
}

// ── Organización (ya con sesión) ────────────────────────────────────────────

export function obtenerOrg(orgId: number): Org | undefined {
  return s(`SELECT * FROM orgs WHERE id = ?`).get(orgId) as Org | undefined;
}

const COLUMNAS_ORG = [
  "nombre", "color", "meta_cobertura", "meta_efectividad",
  "marcador_cierre", "modelo_analisis", "modelo_vision",
] as const;

export function actualizarOrg(orgId: number, campos: Partial<Org>): void {
  const { sql, valores } = armarSet(campos, COLUMNAS_ORG);
  if (!sql) return;
  s(`UPDATE orgs SET ${sql} WHERE id = ?`).run(...valores, orgId);
}

export function listarMiembros(orgId: number): Usuario[] {
  return s(
    `SELECT * FROM users WHERE org_id = ? ORDER BY created_at ASC`,
  ).all(orgId) as Usuario[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Canales
// ─────────────────────────────────────────────────────────────────────────────

export function listarCanales(orgId: number): Canal[] {
  return s(
    `SELECT * FROM canales WHERE org_id = ? ORDER BY created_at ASC`,
  ).all(orgId) as Canal[];
}

export function obtenerCanal(orgId: number, id: number): Canal | undefined {
  return s(`SELECT * FROM canales WHERE org_id = ? AND id = ?`).get(orgId, id) as Canal | undefined;
}

export function contarCanales(orgId: number): number {
  return (s(`SELECT COUNT(*) AS n FROM canales WHERE org_id = ?`).get(orgId) as { n: number }).n;
}

export function crearCanal(orgId: number, datos: {
  nombre: string; phone: string; tokenCifrado: string;
  webhookSecret: string; whapiChannelId: string | null; estado?: string;
}): number {
  const r = s(
    `INSERT INTO canales (org_id, nombre, phone, token_cifrado, webhook_secret, whapi_channel_id, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    orgId, datos.nombre, datos.phone, datos.tokenCifrado,
    datos.webhookSecret, datos.whapiChannelId, datos.estado ?? "pendiente",
  );
  return Number(r.lastInsertRowid);
}

const COLUMNAS_CANAL = [
  "nombre", "phone", "token_cifrado", "whapi_channel_id",
  "estado", "ultimo_evento_at", "agente_activo", "activo",
] as const;

export function actualizarCanal(orgId: number, id: number, campos: Partial<Canal>): void {
  const { sql, valores } = armarSet(campos, COLUMNAS_CANAL);
  if (!sql) return;
  s(`UPDATE canales SET ${sql} WHERE org_id = ? AND id = ?`).run(...valores, orgId, id);
}

export function eliminarCanal(orgId: number, id: number): void {
  const tx = db.transaction(() => {
    // Las conversaciones del canal se van con él; si no, quedan huérfanas
    // contando leads de un número que ya nadie tiene.
    s(`DELETE FROM messages WHERE org_id = ? AND conversation_id IN
         (SELECT id FROM conversations WHERE org_id = ? AND canal_id = ?)`).run(orgId, orgId, id);
    s(`DELETE FROM anomalies WHERE org_id = ? AND conversation_id IN
         (SELECT id FROM conversations WHERE org_id = ? AND canal_id = ?)`).run(orgId, orgId, id);
    s(`DELETE FROM conversations WHERE org_id = ? AND canal_id = ?`).run(orgId, id);
    s(`DELETE FROM canales WHERE org_id = ? AND id = ?`).run(orgId, id);
  });
  tx();
}

/**
 * EXCEPCIÓN justificada: el webhook no recibe `org_id` por parámetro — sería
 * regalarle a cualquiera la capacidad de escribir en la organización que
 * quisiera. Deduce la organización desde el canal, y solo si el secreto
 * coincide. La pareja (id, secreto) es la credencial.
 */
export function canalPorWebhook(canalId: number, secret: string): Canal | undefined {
  return s(
    `SELECT * FROM canales WHERE id = ? AND webhook_secret = ? AND activo = 1`,
  ).get(canalId, secret) as Canal | undefined;
}

/**
 * EXCEPCIÓN — el socket de WhatsApp no tiene sesión ni organización.
 *
 * Un mensaje entra por un socket que solo conoce su `canalId`; la organización
 * se deduce del canal, igual que hace el webhook. No se expone a ninguna ruta
 * de API: lo usa `wa.ts` y nadie más.
 */
export function obtenerCanalSinOrg(canalId: number): Canal | undefined {
  return s(`SELECT * FROM canales WHERE id = ?`).get(canalId) as Canal | undefined;
}

/**
 * EXCEPCIÓN — reconexión al arrancar.
 *
 * Al levantarse el servidor hay que reabrir la sesión de cada número conectado,
 * y en ese momento no existe ninguna sesión de usuario. Devuelve identificadores
 * y nada más: ni un dato de negocio, ni un nombre, ni un teléfono.
 */
export function canalesParaReconectar(): { id: number }[] {
  return s(`SELECT id FROM canales WHERE activo = 1 ORDER BY id`).all() as { id: number }[];
}

export function marcarActividadCanal(orgId: number, canalId: number, cuando: number): void {
  s(
    `UPDATE canales SET ultimo_evento_at = ? WHERE org_id = ? AND id = ?`,
  ).run(cuando, orgId, canalId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversaciones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la conversación del par (canal, teléfono) y la crea si no existe.
 * La creación es lo que cuenta un LEAD: pasa una sola vez por cliente y canal.
 */
export function getOrCreateConversation(
  orgId: number,
  canalId: number,
  clientePhone: string,
  datos: {
    nombre?: string | null; origen?: string | null;
    productoAnuncio?: string | null; cuando?: number;
  } = {},
): { conversacion: Conversacion; nueva: boolean } {
  const existente = s(
    `SELECT * FROM conversations WHERE org_id = ? AND canal_id = ? AND cliente_phone = ?`,
  ).get(orgId, canalId, clientePhone) as Conversacion | undefined;

  if (existente) {
    // El nombre puede llegar más tarde que el primer mensaje.
    if (datos.nombre && !existente.cliente_nombre) {
      s(`UPDATE conversations SET cliente_nombre = ? WHERE org_id = ? AND id = ?`)
        .run(datos.nombre, orgId, existente.id);
      existente.cliente_nombre = datos.nombre;
    }
    return { conversacion: existente, nueva: false };
  }

  const cuando = datos.cuando ?? ahora();
  const r = s(
    `INSERT INTO conversations
       (org_id, canal_id, cliente_phone, cliente_nombre, origen, producto_anuncio, fecha_inicio, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    orgId, canalId, clientePhone, datos.nombre ?? null,
    datos.origen ?? null, datos.productoAnuncio ?? null, cuando, cuando,
  );

  return {
    conversacion: s(`SELECT * FROM conversations WHERE org_id = ? AND id = ?`)
      .get(orgId, Number(r.lastInsertRowid)) as Conversacion,
    nueva: true,
  };
}

/** ¿Ya existe la conversación? Un saliente no debe abrir una nueva. */
export function existeConversacion(orgId: number, canalId: number, clientePhone: string): boolean {
  const fila = s(
    `SELECT 1 AS x FROM conversations WHERE org_id = ? AND canal_id = ? AND cliente_phone = ?`,
  ).get(orgId, canalId, clientePhone) as { x: number } | undefined;
  return !!fila;
}

export function getConversation(orgId: number, id: number): Conversacion | undefined {
  return s(`SELECT * FROM conversations WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as Conversacion | undefined;
}

export function listarConversaciones(orgId: number, filtros: {
  desde?: number; hasta?: number; canalId?: number;
  estado?: EstadoCierre; limite?: number; offset?: number;
} = {}): Conversacion[] {
  const cond: string[] = ["org_id = ?"];
  const val: unknown[] = [orgId];

  if (filtros.desde !== undefined) { cond.push("fecha_inicio >= ?"); val.push(filtros.desde); }
  if (filtros.hasta !== undefined) { cond.push("fecha_inicio <= ?"); val.push(filtros.hasta); }
  if (filtros.canalId !== undefined) { cond.push("canal_id = ?"); val.push(filtros.canalId); }
  if (filtros.estado !== undefined) { cond.push("cerrado_por = ?"); val.push(filtros.estado); }

  return s(
    `SELECT * FROM conversations WHERE ${cond.join(" AND ")}
      ORDER BY COALESCE(last_message_at, fecha_inicio) DESC
      LIMIT ? OFFSET ?`,
  ).all(...val, filtros.limite ?? 100, filtros.offset ?? 0) as Conversacion[];
}

const COLUMNAS_CONV = [
  "cliente_nombre", "origen", "producto_anuncio", "intervencion_humana",
  "senal_de_cierre", "total", "envio", "producto_vendido", "resumen_pedido",
  "justificacion", "datos_faltantes", "motivo_perdida", "analizada_at",
  "last_message_at",
] as const;

/** Actualiza campos de análisis. NO puede tocar `cerrado_por` ni `fecha_cierre`. */
export function actualizarConversacion(orgId: number, id: number, campos: Partial<Conversacion>): void {
  const { sql, valores } = armarSet(campos, COLUMNAS_CONV);
  if (!sql) return;
  s(`UPDATE conversations SET ${sql} WHERE org_id = ? AND id = ?`).run(...valores, orgId, id);
}

/**
 * REGLA MAESTRA — el primero que cierra se lleva la venta.
 *
 * Sella el cierre solo si la conversación no tenía uno. Una vez sellada, ni la
 * factura que manda el vendedor diez minutos después ni ninguna otra señal
 * posterior la reclasifican. La única forma de cambiarla es `resolverRevision`,
 * que es una corrección humana explícita.
 *
 * Devuelve true si este cierre fue el que quedó.
 */
export function sellarCierre(orgId: number, id: number, cierre: {
  cerradoPor: "ia" | "humano"; senal: string; fechaCierre: number;
}): boolean {
  const r = s(
    `UPDATE conversations
        SET cerrado_por = ?, senal_de_cierre = ?, fecha_cierre = ?
      WHERE org_id = ? AND id = ? AND fecha_cierre IS NULL`,
  ).run(cierre.cerradoPor, cierre.senal, cierre.fechaCierre, orgId, id);
  return r.changes > 0;
}

/** Manda la conversación a la bandeja de revisión. No es un cierre: no sella. */
export function marcarRevision(orgId: number, id: number, justificacion: string): void {
  s(
    `UPDATE conversations SET cerrado_por = 'revision', justificacion = ?
      WHERE org_id = ? AND id = ? AND fecha_cierre IS NULL`,
  ).run(justificacion, orgId, id);
}

/** Corrección manual desde la bandeja. Es lo único que rompe el sellado. */
export function resolverRevision(orgId: number, id: number, quien: "ia" | "humano"): void {
  s(
    `UPDATE conversations
        SET cerrado_por = ?, senal_de_cierre = 'correccion_manual',
            fecha_cierre = COALESCE(fecha_cierre, last_message_at, unixepoch())
      WHERE org_id = ? AND id = ?`,
  ).run(quien, orgId, id);
}

export function contarRevisiones(orgId: number): number {
  return (s(
    `SELECT COUNT(*) AS n FROM conversations WHERE org_id = ? AND cerrado_por = 'revision'`,
  ).get(orgId) as { n: number }).n;
}

/**
 * Recalcula `intervencion_humana` a partir de los mensajes reales del hilo.
 * Se llama cuando `/api/ai-sent` llega tarde y corrige un mensaje de humano a
 * IA: sin esto, un cierre de la IA se queda contado como humano para siempre.
 */
export function recalcularIntervencionHumana(orgId: number, conversationId: number): void {
  s(
    `UPDATE conversations
        SET intervencion_humana = (
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM messages
             WHERE org_id = ? AND conversation_id = ? AND emisor = 'humano'
          ) THEN 1 ELSE 0 END
        )
      WHERE org_id = ? AND id = ?`,
  ).run(orgId, conversationId, orgId, conversationId);
}

/** Hilos a barrer en el procedimiento diario: con novedades o todavía abiertos. */
export function conversacionesPorAnalizar(orgId: number, desde: number): Conversacion[] {
  return s(
    `SELECT * FROM conversations
      WHERE org_id = ?
        AND fecha_cierre IS NULL
        AND (analizada_at IS NULL OR last_message_at > analizada_at OR last_message_at >= ?)
      ORDER BY last_message_at ASC`,
  ).all(orgId, desde) as Conversacion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mensajes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserta un mensaje. IDEMPOTENTE: `whapi_message_id` es UNIQUE y el proveedor
 * reintenta los webhooks. Si ya existía, no hace nada y devuelve `null`.
 */
export function insertMessage(orgId: number, datos: {
  conversationId: number; whapiMessageId: string | null; emisor: Emisor;
  tipo: TipoMensaje; content: string; createdAt: number;
  mediaUrl?: string | null;
}): number | null {
  const tx = db.transaction(() => {
    const r = s(
      `INSERT INTO messages
         (org_id, conversation_id, whapi_message_id, emisor, tipo, content, media_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(whapi_message_id) DO NOTHING`,
    ).run(
      orgId, datos.conversationId, datos.whapiMessageId, datos.emisor,
      datos.tipo, datos.content, datos.mediaUrl ?? null, datos.createdAt,
    );

    if (r.changes === 0) return null;

    s(
      `UPDATE conversations
          SET last_message_at = MAX(COALESCE(last_message_at, 0), ?),
              intervencion_humana = CASE WHEN ? = 'humano' THEN 1 ELSE intervencion_humana END
        WHERE org_id = ? AND id = ?`,
    ).run(datos.createdAt, datos.emisor, orgId, datos.conversationId);

    return Number(r.lastInsertRowid);
  });
  return tx();
}

export function listarMensajes(orgId: number, conversationId: number): Mensaje[] {
  return s(
    `SELECT * FROM messages
      WHERE org_id = ? AND conversation_id = ?
      ORDER BY created_at ASC, id ASC`,
  ).all(orgId, conversationId) as Mensaje[];
}

export function ultimosMensajes(orgId: number, conversationId: number, n: number): Mensaje[] {
  const filas = s(
    `SELECT * FROM messages
      WHERE org_id = ? AND conversation_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(orgId, conversationId, n) as Mensaje[];
  return filas.reverse();
}

export function guardarDescripcionImagen(orgId: number, mensajeId: number, datos: {
  descripcion: string; categoria: CategoriaImagen | null;
}): void {
  s(
    `UPDATE messages SET descripcion_imagen = ?, categoria_imagen = ?
      WHERE org_id = ? AND id = ?`,
  ).run(datos.descripcion, datos.categoria, orgId, mensajeId);
}

/** ¿Escribió un humano desde `desde`? Silencia al agente vendedor. */
export function huboHumanoReciente(orgId: number, conversationId: number, desde: number): boolean {
  const fila = s(
    `SELECT 1 AS x FROM messages
      WHERE org_id = ? AND conversation_id = ? AND emisor = 'humano' AND created_at >= ?
      LIMIT 1`,
  ).get(orgId, conversationId, desde) as { x: number } | undefined;
  return !!fila;
}

/** Respuestas que el agente ya mandó en esta conversación desde `desde`. */
export function contarRespuestasIa(orgId: number, conversationId: number, desde: number): number {
  return (s(
    `SELECT COUNT(*) AS n FROM messages
      WHERE org_id = ? AND conversation_id = ? AND emisor = 'ia' AND created_at >= ?`,
  ).get(orgId, conversationId, desde) as { n: number }).n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atribución — ai_sent_ids
// ─────────────────────────────────────────────────────────────────────────────

export function registrarAiSent(orgId: number, whapiMessageId: string): void {
  s(
    `INSERT INTO ai_sent_ids (whapi_message_id, org_id) VALUES (?, ?)
     ON CONFLICT(whapi_message_id) DO NOTHING`,
  ).run(whapiMessageId, orgId);
}

export function esDeIa(orgId: number, whapiMessageId: string): boolean {
  const fila = s(
    `SELECT 1 AS x FROM ai_sent_ids WHERE org_id = ? AND whapi_message_id = ?`,
  ).get(orgId, whapiMessageId) as { x: number } | undefined;
  return !!fila;
}

/**
 * Carrera obligatoria: el webhook del saliente puede llegar ANTES que el aviso
 * de `/api/ai-sent`. En ese caso el mensaje quedó marcado como `humano`.
 * Cuando llega el aviso, esto lo corrige y devuelve la conversación afectada
 * para que quien llame recalcule `intervencion_humana`.
 */
export function corregirEmisorAIa(orgId: number, whapiMessageId: string): number | null {
  const msg = s(
    `SELECT id, conversation_id, emisor FROM messages
      WHERE org_id = ? AND whapi_message_id = ?`,
  ).get(orgId, whapiMessageId) as
    | { id: number; conversation_id: number; emisor: Emisor }
    | undefined;

  if (!msg || msg.emisor !== "humano") return null;

  s(`UPDATE messages SET emisor = 'ia' WHERE org_id = ? AND id = ?`).run(orgId, msg.id);
  return msg.conversation_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agente vendedor y catálogo
// ─────────────────────────────────────────────────────────────────────────────

export function obtenerAgente(orgId: number): Agente {
  let fila = s(`SELECT * FROM agentes WHERE org_id = ?`).get(orgId) as Agente | undefined;
  if (!fila) {
    s(`INSERT INTO agentes (org_id) VALUES (?)`).run(orgId);
    fila = s(`SELECT * FROM agentes WHERE org_id = ?`).get(orgId) as Agente;
  }
  return fila;
}

const COLUMNAS_AGENTE = [
  "nombre", "tono", "instrucciones", "modelo", "modelo_respaldo",
  "pasar_a_humano", "silenciar_si_humano", "horario_activo",
  "horario_desde", "horario_hasta",
] as const;

export function actualizarAgente(orgId: number, campos: Partial<Agente>): void {
  obtenerAgente(orgId);
  const { sql, valores } = armarSet(campos, COLUMNAS_AGENTE);
  if (!sql) return;
  s(`UPDATE agentes SET ${sql}, updated_at = unixepoch() WHERE org_id = ?`).run(...valores, orgId);
}

export function listarCatalogo(orgId: number, soloActivos = false): Producto[] {
  return s(
    `SELECT * FROM catalogo WHERE org_id = ? ${soloActivos ? "AND activo = 1" : ""}
      ORDER BY nombre ASC`,
  ).all(orgId) as Producto[];
}

export function crearProducto(orgId: number, datos: {
  nombre: string; variantes: string | null; precio: number | null;
}): number {
  const r = s(
    `INSERT INTO catalogo (org_id, nombre, variantes, precio) VALUES (?, ?, ?, ?)`,
  ).run(orgId, datos.nombre, datos.variantes, datos.precio);
  return Number(r.lastInsertRowid);
}

export function actualizarProducto(orgId: number, id: number, campos: Partial<Producto>): void {
  const { sql, valores } = armarSet(campos, ["nombre", "variantes", "precio", "activo"]);
  if (!sql) return;
  s(`UPDATE catalogo SET ${sql} WHERE org_id = ? AND id = ?`).run(...valores, orgId, id);
}

export function eliminarProducto(orgId: number, id: number): void {
  s(`DELETE FROM catalogo WHERE org_id = ? AND id = ?`).run(orgId, id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomalías
// ─────────────────────────────────────────────────────────────────────────────

export function crearAnomalia(orgId: number, datos: {
  conversationId?: number | null; canalId?: number | null;
  tipo: string; severidad: "alta" | "media"; detalle: string;
}): void {
  const conversationId = datos.conversationId ?? null;
  const canalId = datos.canalId ?? null;
  if (conversationId === null && canalId === null) return;

  // Una anomalía viva del mismo tipo por sujeto; si no, el panel se llena con
  // la misma alerta repetida cada vez que corre el analista.
  const existe = s(
    `SELECT 1 AS x FROM anomalies
      WHERE org_id = ? AND tipo = ? AND resuelta = 0
        AND conversation_id IS ? AND canal_id IS ?
      LIMIT 1`,
  ).get(orgId, datos.tipo, conversationId, canalId) as { x: number } | undefined;
  if (existe) return;

  s(
    `INSERT INTO anomalies (org_id, conversation_id, canal_id, tipo, severidad, detalle)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(orgId, conversationId, canalId, datos.tipo, datos.severidad, datos.detalle);
}

export function listarAnomalias(orgId: number, soloAbiertas = true): Anomalia[] {
  return s(
    `SELECT * FROM anomalies WHERE org_id = ? ${soloAbiertas ? "AND resuelta = 0" : ""}
      ORDER BY severidad ASC, created_at DESC LIMIT 200`,
  ).all(orgId) as Anomalia[];
}

/** ¿Hay una anomalía viva de este tipo en la conversación? */
export function hayAnomaliaAbierta(orgId: number, conversationId: number, tipo: string): boolean {
  const fila = s(
    `SELECT 1 AS x FROM anomalies
      WHERE org_id = ? AND conversation_id = ? AND tipo = ? AND resuelta = 0 LIMIT 1`,
  ).get(orgId, conversationId, tipo) as { x: number } | undefined;
  return !!fila;
}

export function resolverAnomalia(orgId: number, id: number): void {
  s(`UPDATE anomalies SET resuelta = 1 WHERE org_id = ? AND id = ?`).run(orgId, id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumo de modelos
// ─────────────────────────────────────────────────────────────────────────────

export function registrarUso(orgId: number, datos: {
  dia: string; modelo: string; proposito: "agente" | "analisis" | "vision"; ok: boolean;
}): void {
  s(
    `INSERT INTO uso_modelo (org_id, dia, modelo, proposito, exitos, fallos)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, dia, modelo, proposito) DO UPDATE SET
       exitos = exitos + excluded.exitos,
       fallos = fallos + excluded.fallos`,
  ).run(orgId, datos.dia, datos.modelo, datos.proposito, datos.ok ? 1 : 0, datos.ok ? 0 : 1);
}

export function usoDelDia(orgId: number, dia: string) {
  return s(
    `SELECT modelo, proposito, exitos, fallos FROM uso_modelo WHERE org_id = ? AND dia = ?`,
  ).all(orgId, dia) as { modelo: string; proposito: string; exitos: number; fallos: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Accesos de soporte — visibles para el dueño de la cuenta
// ─────────────────────────────────────────────────────────────────────────────

export function listarSoporteAccesos(orgId: number): SoporteAcceso[] {
  return s(
    `SELECT * FROM soporte_accesos WHERE org_id = ? ORDER BY solicitado_at DESC LIMIT 50`,
  ).all(orgId) as SoporteAcceso[];
}

export function responderSoporte(orgId: number, id: number, aprobado: boolean, expiraAt: number): void {
  s(
    `UPDATE soporte_accesos
        SET estado = ?, aprobado_at = ?, expira_at = ?
      WHERE org_id = ? AND id = ? AND estado = 'solicitado'`,
  ).run(
    aprobado ? "aprobado" : "rechazado",
    aprobado ? ahora() : null,
    aprobado ? expiraAt : null,
    orgId, id,
  );
}

export function soporteVigente(orgId: number, adminUserId: number): SoporteAcceso | undefined {
  return s(
    `SELECT * FROM soporte_accesos
      WHERE org_id = ? AND admin_user_id = ? AND estado = 'aprobado' AND expira_at > unixepoch()
      ORDER BY id DESC LIMIT 1`,
  ).get(orgId, adminUserId) as SoporteAcceso | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas de métricas
//
// Devuelven filas crudas; `metrics.ts` deriva porcentajes y normaliza nombres.
// Viven aquí para que el SQL no se disperse y la migración a Postgres siga
// siendo el reemplazo de un solo módulo.
// ─────────────────────────────────────────────────────────────────────────────

export interface Rango { desde: number; hasta: number; canalId?: number }

function filtroRango(orgId: number, r: Rango) {
  const cond = ["org_id = ?", "fecha_inicio >= ?", "fecha_inicio <= ?"];
  const val: unknown[] = [orgId, r.desde, r.hasta];
  if (r.canalId !== undefined) { cond.push("canal_id = ?"); val.push(r.canalId); }
  return { where: cond.join(" AND "), val };
}

/** Conteo por estado. La suma de estos cuatro DEBE ser el total de leads. */
export function conteoPorEstado(orgId: number, r: Rango): Record<EstadoCierre, number> {
  const { where, val } = filtroRango(orgId, r);
  const filas = s(
    `SELECT cerrado_por, COUNT(*) AS n FROM conversations WHERE ${where} GROUP BY cerrado_por`,
  ).all(...val) as { cerrado_por: EstadoCierre; n: number }[];

  const base: Record<EstadoCierre, number> = { ia: 0, humano: 0, abierta: 0, revision: 0 };
  for (const f of filas) base[f.cerrado_por] = f.n;
  return base;
}

export function totalLeads(orgId: number, r: Rango): number {
  const { where, val } = filtroRango(orgId, r);
  return (s(`SELECT COUNT(*) AS n FROM conversations WHERE ${where}`).get(...val) as { n: number }).n;
}

export function resumenVentas(orgId: number, r: Rango) {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT COALESCE(SUM(total), 0) AS suma, COUNT(total) AS con_monto
       FROM conversations
      WHERE ${where} AND cerrado_por IN ('ia','humano')`,
  ).get(...val) as { suma: number; con_monto: number };
}

export function leadsPorSuCuenta(orgId: number, r: Rango): number {
  const { where, val } = filtroRango(orgId, r);
  return (s(
    `SELECT COUNT(*) AS n FROM conversations
      WHERE ${where} AND (producto_anuncio IS NULL OR producto_anuncio = '')`,
  ).get(...val) as { n: number }).n;
}

/** Conversaciones donde un vendedor llegó a escribir. Denominador de la efectividad humana. */
export function conteoConIntervencionHumana(orgId: number, r: Rango): number {
  const { where, val } = filtroRango(orgId, r);
  return (s(
    `SELECT COUNT(*) AS n FROM conversations WHERE ${where} AND intervencion_humana = 1`,
  ).get(...val) as { n: number }).n;
}

/** Tiempo medio hasta el cierre, en segundos. Excluye conversaciones abiertas. */
export function tiemposDeCierre(orgId: number, r: Rango) {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT
       AVG(CASE WHEN cerrado_por = 'ia'     THEN fecha_cierre - fecha_inicio END) AS ia,
       AVG(CASE WHEN cerrado_por = 'humano' THEN fecha_cierre - fecha_inicio END) AS humano
     FROM conversations
     WHERE ${where} AND fecha_cierre IS NOT NULL`,
  ).get(...val) as { ia: number | null; humano: number | null };
}

/** Producto y monto de cada venta cerrada. La normalización va en metrics.ts. */
export function ventasParaRanking(orgId: number, r: Rango) {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT producto_vendido, total FROM conversations
      WHERE ${where} AND cerrado_por IN ('ia','humano') AND producto_vendido IS NOT NULL`,
  ).all(...val) as { producto_vendido: string; total: number | null }[];
}

export function metricasPorCanal(orgId: number, r: Rango) {
  const cond = ["c.org_id = ?", "c.fecha_inicio >= ?", "c.fecha_inicio <= ?"];
  const val: unknown[] = [orgId, r.desde, r.hasta];
  if (r.canalId !== undefined) { cond.push("c.canal_id = ?"); val.push(r.canalId); }

  return s(
    `SELECT ca.id AS canal_id, ca.nombre, ca.phone,
            COUNT(c.id) AS leads,
            SUM(CASE WHEN c.cerrado_por = 'ia'       THEN 1 ELSE 0 END) AS cierres_ia,
            SUM(CASE WHEN c.cerrado_por = 'humano'   THEN 1 ELSE 0 END) AS cierres_humano,
            SUM(CASE WHEN c.cerrado_por = 'revision' THEN 1 ELSE 0 END) AS revision,
            COALESCE(SUM(CASE WHEN c.cerrado_por IN ('ia','humano') THEN c.total END), 0) AS ventas
       FROM canales ca
       LEFT JOIN conversations c ON c.canal_id = ca.id AND ${cond.join(" AND ")}
      WHERE ca.org_id = ?
      GROUP BY ca.id
      ORDER BY leads DESC`,
  ).all(...val, orgId) as {
    canal_id: number; nombre: string; phone: string;
    leads: number; cierres_ia: number; cierres_humano: number;
    revision: number; ventas: number;
  }[];
}

export function serieDiaria(orgId: number, r: Rango) {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT date(fecha_inicio, 'unixepoch') AS dia,
            COUNT(*) AS leads,
            SUM(CASE WHEN cerrado_por = 'ia'     THEN 1 ELSE 0 END) AS cierres_ia,
            SUM(CASE WHEN cerrado_por = 'humano' THEN 1 ELSE 0 END) AS cierres_humano
       FROM conversations
      WHERE ${where}
      GROUP BY dia ORDER BY dia ASC`,
  ).all(...val) as { dia: string; leads: number; cierres_ia: number; cierres_humano: number }[];
}

/** Motivos de pérdida del segmento sin cerrar. Lo más valioso del panel. */
export function conteoMotivosPerdida(orgId: number, r: Rango) {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT COALESCE(motivo_perdida, 'sin clasificar') AS motivo, COUNT(*) AS n
       FROM conversations
      WHERE ${where} AND cerrado_por = 'abierta'
      GROUP BY motivo ORDER BY n DESC`,
  ).all(...val) as { motivo: string; n: number }[];
}

/** Muestra de hilos abiertos para que el analista deduzca por qué se cayeron. */
export function abiertasSinMotivo(orgId: number, r: Rango, limite: number): Conversacion[] {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT * FROM conversations
      WHERE ${where} AND cerrado_por = 'abierta' AND motivo_perdida IS NULL
      ORDER BY last_message_at DESC LIMIT ?`,
  ).all(...val, limite) as Conversacion[];
}

/** Alimenta la anomalía "canal por debajo de su promedio de 7 días". */
export function leadsPorCanalEnVentana(orgId: number, desde: number, hasta: number) {
  return s(
    `SELECT canal_id, COUNT(*) AS n FROM conversations
      WHERE org_id = ? AND fecha_inicio >= ? AND fecha_inicio < ?
      GROUP BY canal_id`,
  ).all(orgId, desde, hasta) as { canal_id: number; n: number }[];
}

/** Conversaciones sin actividad reciente donde el cliente escribió último. */
export function esperandoRespuesta(orgId: number, antesDe: number): Conversacion[] {
  return s(
    `SELECT c.* FROM conversations c
      WHERE c.org_id = ? AND c.fecha_cierre IS NULL AND c.last_message_at < ?
        AND (SELECT m.emisor FROM messages m
              WHERE m.org_id = c.org_id AND m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'cliente'
      ORDER BY c.last_message_at DESC LIMIT 100`,
  ).all(orgId, antesDe) as Conversacion[];
}
