/**
 * SalesDash — el supervisor.
 *
 * ═══ MANTIENE EL DASHBOARD AL DÍA SIN QUE NADIE PULSE NADA ═══
 *
 * Hasta ahora el dashboard dependía de que alguien entrara y pulsara
 * «Analizar»: una venta cerrada a las diez de la mañana se contaba —el sellado
 * es mecánico— pero facturaba cero hasta ese clic, porque el producto y el
 * total los saca el analista. Y nada miraba si el resumen que selló la venta
 * era de verdad: un bot que manda el mismo pedido, con el mismo nombre, a
 * todos los clientes entraba al dashboard como una venta por cliente.
 *
 * El supervisor corre cada pocos minutos, para todas las cuentas, y hace
 * cuatro cosas, en este orden:
 *
 *   1. SELLA lo que quedó sin sellar (ver `cierre.ts`). No llama al modelo.
 *   2. REVISA LOS CIERRES RECIENTES, sin modelo: lee el resumen que cerró cada
 *      venta y comprueba que sea un pedido de verdad. Un resumen con un dato en
 *      blanco, con «por confirmar» en el total, con el nombre de la propia
 *      vendedora, o con EL MISMO nombre o celular que otros dos chats de
 *      clientes distintos no es una venta: es el bot rellenando huecos. Esa
 *      venta pasa a REVISIÓN —deja de contar— con una anomalía que dice por
 *      qué, y una persona la confirma o la descarta desde la bandeja.
 *   3. ANALIZA lo pendiente, con presupuesto: primero las ventas selladas que
 *      todavía facturan cero, después las conversaciones que se quedaron
 *      quietas. Pocas por vuelta, para que el gasto en modelo sea previsible.
 *   4. BARRE las anomalías de canal (sin responder, canal mudo, canal bajo).
 *
 * ═══ SOLO LECTURA HACIA EL CLIENTE ═══
 * Esto no contesta a nadie. No importa `agent.ts` ni la función de envío, y la
 * prueba que barre `src/` lo garantiza. Un supervisor que escribe a clientes ya
 * no es un supervisor.
 *
 * Lo que decide es REVERSIBLE: pasar una venta a revisión no la borra —la
 * fecha de cierre se conserva— y `resolverRevision` la devuelve a su sitio con
 * una firma humana. Lo que nunca hace es sellar una venta que no estaba, ni
 * tocar una corrección manual.
 */
import { agenteDePais, type DatosPais } from "@/agents";
import { pareceDireccion, pareceNombreDePersona } from "./memoria";
import { analizarConversacion } from "./analyzer";
import { barrerAnomalias } from "./anomalies";
import { contieneMarcador, MARCADOR_POR_DEFECTO, sellarCierresPendientes } from "./cierre";
import {
  ahora,
  asentadasSinAnalizar,
  cierresRecientesPorResumen,
  crearAnomalia,
  dudarDelCierre,
  hayAnomaliaAbierta,
  obtenerAgente,
  obtenerOrg,
  orgsConCanales,
  primerResumenDe,
  selladasSinAnalizar,
  type Conversacion,
} from "./db";

const UN_DIA = 24 * 60 * 60;

/** Cuántos chats de clientes distintos con el mismo dato hacen sospechar. */
export const REPETIDOS_SOSPECHOSOS = 3;

/** Ventana en la que se comparan los resúmenes entre sí. */
const VENTANA_REPETIDOS = 3 * UN_DIA;

/** Una conversación abierta se analiza cuando lleva este rato sin moverse. */
const QUIETUD = 30 * 60;

/** Y solo si se movió en las últimas 48 horas: lo viejo lo barre «Analizar». */
const VENTANA_ANALISIS = 2 * UN_DIA;

/** Análisis con modelo por cuenta y por vuelta. Es el tope de gasto. */
export const ANALISIS_POR_VUELTA = 8;

/** El tipo de anomalía con el que se marca un cierre que no se cree. */
export const TIPO_RESUMEN_DUDOSO = "resumen_dudoso";

// ─────────────────────────────────────────────────────────────────────────────
// Leer un resumen de pedido
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumenLeido {
  nombre: string | null;
  cel: string | null;
  direccion: string | null;
  total: string | null;
  /** Qué se vende. El caso real: «ORDENA, RECIBE Y LUEGO PAGA!!» en esa línea. */
  producto: string | null;
  talla: string | null;
  color: string | null;
  /** Cuántas unidades dice el resumen. Con dos colores tiene que decir dos. */
  cantidad: string | null;
}

/** Sin tildes, en minúsculas y con un solo espacio. Para comparar, no para enseñar. */
export function llano(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Las cuatro líneas que hacen que un resumen sea un pedido: a quién, a qué
 * número, a dónde y por cuánto. Se leen a partir de la línea del marcador y se
 * admiten las formas en que las escriben los guiones —«Cel», «Celular»,
 * «Teléfono»; «Dirección y provincia»; «Total a pagar»—.
 *
 * Devuelve null en cada campo que no aparezca. No decide nada: eso es de
 * `fallasDelResumen`.
 */
export function leerResumen(texto: string, marcador: string = MARCADOR_POR_DEFECTO): ResumenLeido {
  const lineas = texto.split(/\r?\n/);
  const raiz = llano(marcador.replace(/[:\s]+$/, ""));

  // Desde la línea del marcador; si no se encuentra, desde el principio.
  let inicio = lineas.findIndex((l) => llano(l).startsWith(raiz) || llano(l).includes(`${raiz} `));
  if (inicio < 0) inicio = 0;

  const salida: ResumenLeido = { nombre: null, cel: null, direccion: null, total: null, producto: null, talla: null, color: null, cantidad: null };

  const campo = (linea: string, etiqueta: RegExp): string | null => {
    const m = linea.match(etiqueta);
    return m ? (m[1] ?? "").trim() : null;
  };

  for (const cruda of lineas.slice(inicio + 1)) {
    const l = cruda.replace(/^[\s*\-•📋👤📱📍💰]+/u, "").trim();
    if (!l) continue;
    const plano = llano(l);

    if (salida.nombre === null && /^nombre\b/.test(plano)) {
      salida.nombre = campo(l, /^[^:]*:\s*(.*)$/);
    } else if (salida.cel === null && /^(cel|celular|tel|telefono|numero|whatsapp)\b/.test(plano)) {
      salida.cel = campo(l, /^[^:]*:\s*(.*)$/);
    } else if (salida.direccion === null && /^direccion\b/.test(plano)) {
      salida.direccion = campo(l, /^[^:]*:\s*(.*)$/);
    } else if (salida.total === null && /^total\b/.test(plano)) {
      salida.total = campo(l, /^[^:]*:\s*(.*)$/);
    } else if (salida.producto === null && /^(producto|art[ií]culo)\b/.test(plano)) {
      salida.producto = campo(l, /^[^:]*:\s*(.*)$/);
    } else if (salida.talla === null && /^(talla|n[uú]mero)\b/.test(plano)) {
      salida.talla = campo(l, /^[^:]*:\s*(.*)$/);
    } else if (salida.color === null && /^color\b/.test(plano)) {
      salida.color = campo(l, /^[^:]*:\s*(.*)$/);
    } else if (salida.cantidad === null && /^cantidad\b/.test(plano)) {
      salida.cantidad = campo(l, /^[^:]*:\s*(.*)$/);
    }
  }

  return salida;
}

/** Lo que un modelo escribe cuando no tiene el dato. */
const HUECO =
  /por confirmar|a coordinar|a confirmar|pendiente|\bindicar\b|por definir|no (?:lo )?(?:indic|especific|proporcion)|sin (?:dato|especificar)|^\s*[-–—_.?]*\s*$|^\s*\(.*\)\s*$|^\s*<.*>\s*$|^\s*n\/?a\s*$|^\s*xx+/i;

function esHueco(valor: string | null): boolean {
  if (valor === null) return true;
  const v = valor.trim();
  return v.length === 0 || HUECO.test(v);
}

/**
 * Por qué este resumen no es un pedido. Vacío = no hay nada que objetar.
 *
 * `nombresDeLaCasa` son los que NUNCA pueden ser el del cliente: el de la
 * vendedora y el de la tienda. Un pedido a nombre de «Orlanda» es el modelo
 * copiando su propio ejemplo, y es exactamente el fallo que hace que media
 * bandeja salga a nombre de la misma desconocida.
 */
export function fallasDelResumen(
  r: ResumenLeido,
  nombresDeLaCasa: string[] = [],
  /** El país, si se sabe: con él, un sector conocido ya es una dirección. */
  datos: DatosPais | null = null,
): string[] {
  const fallas: string[] = [];

  if (esHueco(r.nombre)) fallas.push("no dice a nombre de quién va");
  else if (nombresDeLaCasa.some((n) => n && llano(n) === llano(r.nombre!))) {
    fallas.push(`va a nombre de «${r.nombre}», que es el nombre de la casa, no el de un cliente`);
  } else if (/\bcliente\b/i.test(r.nombre!) && llano(r.nombre!).split(" ").length <= 3) {
    fallas.push(`el nombre es «${r.nombre}», que no es un nombre`);
  } else if (!pareceNombreDePersona(r.nombre!, datos)) {
    // Una frase suya, un sitio, un color o el propio artículo no son la
    // persona que recibe el paquete. El caso real: «Nombre: Quiero más
    // información sobre el negocio.».
    fallas.push(`el nombre es «${r.nombre}», que no es el nombre de una persona`);
  }

  if (esHueco(r.cel) || (r.cel!.replace(/\D/g, "").length < 7)) {
    fallas.push("no lleva un celular al que llamar");
  }

  if (esHueco(r.direccion)) fallas.push("no lleva dirección");
  else if (/ubicaci[oó]n compartida/i.test(r.direccion!)) {
    fallas.push("en la dirección dice «ubicación compartida» en vez de la dirección");
  } else if (!pareceDireccion(r.direccion!, datos)) {
    // El caso real: «Direccion: Si yo.le escomprado». Eso no es una casa.
    fallas.push(`en la dirección dice «${r.direccion}», que no es una dirección`);
  }

  if (esHueco(r.total) || !/\d/.test(r.total!)) fallas.push("el total no es una cifra");

  return fallas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Revisar los cierres
// ─────────────────────────────────────────────────────────────────────────────

export interface RevisionDeCierres {
  revisadas: number;
  dudosas: number;
}

interface CierreLeido {
  conv: Conversacion;
  resumen: ResumenLeido;
  nombreLlano: string | null;
  celDigitos: string | null;
}

/** Los nombres que en este canal nunca son de un cliente. */
function nombresDeLaCasa(orgId: number, canalId: number): { nombres: string[]; datos: DatosPais | null } {
  const agente = obtenerAgente(orgId, canalId);
  const datos = agenteDePais(agente.pais);
  return {
    nombres: [agente.nombre, agente.negocio, datos?.nombreAgente ?? "", datos?.tienda ?? ""].filter(Boolean),
    datos: datos ?? null,
  };
}

/**
 * Lee los cierres por resumen de los últimos días y manda a revisión los que
 * no se cree. Sin modelo: todo es mecánico y explicable.
 *
 * Se leen TAMBIÉN los que ya están en revisión, porque son los que sirven
 * para contar repetidos: si los dos primeros chats con «Nombre: Fulana» ya
 * salieron de la cuenta, el tercero tiene que seguir viéndolos para caer.
 */
export function revisarCierres(orgId: number, t: number = ahora()): RevisionDeCierres {
  const marcador = obtenerOrg(orgId)?.marcador_cierre ?? MARCADOR_POR_DEFECTO;
  const salida: RevisionDeCierres = { revisadas: 0, dudosas: 0 };

  const leidos: CierreLeido[] = [];
  for (const conv of cierresRecientesPorResumen(orgId, t - VENTANA_REPETIDOS)) {
    const texto = primerResumenDe(orgId, conv.id, (c) => contieneMarcador(c, marcador));
    if (texto === null) continue;

    const resumen = leerResumen(texto, marcador);
    const celDigitos = resumen.cel?.replace(/\D/g, "") ?? "";
    leidos.push({
      conv,
      resumen,
      nombreLlano: esHueco(resumen.nombre) ? null : llano(resumen.nombre!),
      celDigitos: celDigitos.length >= 7 ? celDigitos : null,
    });
  }

  /*
   * Cuántos clientes DISTINTOS del mismo canal dieron el mismo nombre o el
   * mismo celular. Distintos por teléfono del chat: el mismo cliente que
   * cierra dos pedidos no es un repetido, es un cliente que vuelve.
   */
  const porNombre = new Map<string, Set<string>>();
  const porCel = new Map<string, Set<string>>();
  for (const l of leidos) {
    if (l.nombreLlano) {
      const k = `${l.conv.canal_id}|${l.nombreLlano}`;
      (porNombre.get(k) ?? porNombre.set(k, new Set()).get(k)!).add(l.conv.cliente_phone);
    }
    if (l.celDigitos) {
      const k = `${l.conv.canal_id}|${l.celDigitos}`;
      (porCel.get(k) ?? porCel.set(k, new Set()).get(k)!).add(l.conv.cliente_phone);
    }
  }

  const casa = new Map<number, { nombres: string[]; datos: DatosPais | null }>();

  for (const l of leidos) {
    // Solo se juzgan las que todavía cuentan como venta de la IA.
    if (l.conv.cerrado_por !== "ia") continue;
    salida.revisadas++;

    if (!casa.has(l.conv.canal_id)) casa.set(l.conv.canal_id, nombresDeLaCasa(orgId, l.conv.canal_id));
    const suya = casa.get(l.conv.canal_id)!;
    const fallas = fallasDelResumen(l.resumen, suya.nombres, suya.datos);

    if (l.nombreLlano) {
      const n = porNombre.get(`${l.conv.canal_id}|${l.nombreLlano}`)?.size ?? 0;
      if (n >= REPETIDOS_SOSPECHOSOS) {
        fallas.push(`va a nombre de «${l.resumen.nombre}», el mismo que otros ${n - 1} chats de clientes distintos`);
      }
    }
    if (l.celDigitos) {
      const n = porCel.get(`${l.conv.canal_id}|${l.celDigitos}`)?.size ?? 0;
      if (n >= REPETIDOS_SOSPECHOSOS) {
        fallas.push(`lleva el celular ${l.resumen.cel}, el mismo que otros ${n - 1} chats de clientes distintos`);
      }
    }

    if (fallas.length === 0) continue;

    const motivo = `El resumen que cerró esta venta no es un pedido de verdad: ${fallas.join("; ")}. Pasó a revisión para que alguien lo confirme.`;

    if (dudarDelCierre(orgId, l.conv.id, motivo)) {
      salida.dudosas++;
      if (!hayAnomaliaAbierta(orgId, l.conv.id, TIPO_RESUMEN_DUDOSO)) {
        crearAnomalia(orgId, {
          conversationId: l.conv.id,
          tipo: TIPO_RESUMEN_DUDOSO,
          severidad: "alta",
          detalle: motivo,
        });
      }
    }
  }

  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analizar lo pendiente, con presupuesto
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que el analista escribe cuando el modelo no contestó. Ver `analyzer.ts`. */
const MODELO_CAIDO = /modelo de an[aá]lisis no respondi[oó]/i;

/**
 * Primero las ventas que facturan cero, después lo que se quedó quieto. Si el
 * modelo no contesta se para la vuelta: insistir con el modelo caído solo
 * gasta y llena la bandeja de revisión.
 */
export async function analizarPendientes(
  orgId: number,
  limite: number = ANALISIS_POR_VUELTA,
  t: number = ahora(),
): Promise<{ analizadas: number; modeloCaido: boolean }> {
  if (!process.env.OPENROUTER_API_KEY) return { analizadas: 0, modeloCaido: true };

  const cola: Conversacion[] = [
    ...selladasSinAnalizar(orgId, limite),
    ...asentadasSinAnalizar(orgId, t - VENTANA_ANALISIS, t - QUIETUD, limite),
  ].slice(0, limite);

  let analizadas = 0;
  for (const conv of cola) {
    try {
      const r = await analizarConversacion(orgId, conv.id);
      if (r.justificacion && MODELO_CAIDO.test(r.justificacion)) {
        return { analizadas, modeloCaido: true };
      }
      analizadas++;
    } catch (e) {
      console.error(`[supervisor] no se pudo analizar la conversación ${conv.id}`, e);
      return { analizadas, modeloCaido: true };
    }
  }

  return { analizadas, modeloCaido: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// La vuelta entera
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumenSupervisor {
  cuentas: number;
  selladas: number;
  revisadas: number;
  dudosas: number;
  analizadas: number;
  sin_responder: number;
  canales_mudos: number;
  canales_bajos: number;
  /** Cuentas cuya vuelta falló. Las demás siguieron. */
  errores: number;
  /** Alguna cuenta se quedó sin modelo a mitad de análisis. */
  modelo_caido: boolean;
  /** Cuándo empezó y cuánto tardó, en segundos y milisegundos. */
  cuando: number;
  duracion_ms: number;
}

const vacio = (cuando: number): ResumenSupervisor => ({
  cuentas: 0, selladas: 0, revisadas: 0, dudosas: 0, analizadas: 0,
  sin_responder: 0, canales_mudos: 0, canales_bajos: 0,
  errores: 0, modelo_caido: false, cuando, duracion_ms: 0,
});

/** Una cuenta, de principio a fin. */
export async function supervisarCuenta(
  orgId: number,
  opciones: { analisis?: number } = {},
): Promise<Omit<ResumenSupervisor, "cuentas" | "errores" | "cuando" | "duracion_ms">> {
  const selladas = sellarCierresPendientes(orgId);
  const revision = revisarCierres(orgId);
  const analisis = await analizarPendientes(orgId, opciones.analisis ?? ANALISIS_POR_VUELTA);
  const anomalias = barrerAnomalias(orgId);

  return {
    selladas,
    revisadas: revision.revisadas,
    dudosas: revision.dudosas,
    analizadas: analisis.analizadas,
    modelo_caido: analisis.modeloCaido,
    sin_responder: anomalias.sin_responder,
    canales_mudos: anomalias.canales_mudos,
    canales_bajos: anomalias.canales_bajos,
  };
}

/** Cuándo pasó por última vez y qué hizo. Para el panel y para el registro. */
let ultima: ResumenSupervisor | null = null;
let enCurso = false;

export function ultimaPasada(): ResumenSupervisor | null {
  return ultima;
}

/**
 * Todas las cuentas con algún número. Una que falle no se lleva a las demás.
 *
 * Si la vuelta anterior todavía no terminó —un análisis lento— esta se salta:
 * dos supervisores a la vez analizarían las mismas conversaciones dos veces.
 */
export async function supervisar(opciones: { analisis?: number } = {}): Promise<ResumenSupervisor | null> {
  if (enCurso) return null;
  enCurso = true;

  const inicio = Date.now();
  const total = vacio(ahora());

  try {
    for (const orgId of orgsConCanales()) {
      total.cuentas++;
      try {
        const r = await supervisarCuenta(orgId, opciones);
        total.selladas += r.selladas;
        total.revisadas += r.revisadas;
        total.dudosas += r.dudosas;
        total.analizadas += r.analizadas;
        total.sin_responder += r.sin_responder;
        total.canales_mudos += r.canales_mudos;
        total.canales_bajos += r.canales_bajos;
        total.modelo_caido = total.modelo_caido || r.modelo_caido;
      } catch (e) {
        total.errores++;
        console.error(`[supervisor] falló la vuelta de la cuenta ${orgId}`, e);
      }
    }
  } finally {
    enCurso = false;
  }

  total.duracion_ms = Date.now() - inicio;
  ultima = total;

  if (total.selladas || total.dudosas || total.analizadas || total.errores) {
    console.log(
      `[supervisor] ${total.cuentas} cuenta(s): ${total.selladas} sellada(s), ` +
        `${total.dudosas} cierre(s) a revisión de ${total.revisadas} revisados, ` +
        `${total.analizadas} analizada(s)` +
        (total.modelo_caido ? ", el modelo de análisis no responde" : "") +
        (total.errores ? `, ${total.errores} cuenta(s) con error` : "") +
        ` · ${total.duracion_ms} ms`,
    );
  }

  return total;
}
