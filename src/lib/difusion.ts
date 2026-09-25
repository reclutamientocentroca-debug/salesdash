/**
 * SalesDash — el motor de Difusiones: crea campañas y las manda solo,
 * repartidas en el tiempo, sin arriesgar el número.
 *
 * ═══ POR QUÉ NO HAY SETTIMEOUT LARGOS ═══
 *
 * El proyecto corre en UN SOLO proceso, sin Redis ni cola externa (ver
 * `src/instrumentation.ts`). Un `setTimeout` de minutos en memoria se pierde
 * en cualquier reinicio o redespliegue a medio camino, y una campaña que
 * pierde su cola deja de mandar sin que nadie lo note. En vez de eso, el
 * reloj llama a `tickDifusiones()` cada poco tiempo y cada vuelta manda COMO
 * MUCHO un puñado de mensajes por campaña: el espaciado lo da la cadencia
 * del propio reloj, y todo el estado —quién falta, a quién le tocó ya— vive
 * en `difusion_destinatarios`, no en memoria. Un redespliegue a medio envío
 * simplemente retoma en la siguiente vuelta.
 *
 * ═══ EL TOPE DIARIO ES DEL NÚMERO, NO DE LA CAMPAÑA ═══
 *
 * Varias campañas pueden compartir un canal, y a WhatsApp no le importa de
 * cuál campaña viene un mensaje: le importa cuántos manda ESTE número hoy.
 * `enviosHoyDelCanal` cuenta las de TODAS las campañas del canal.
 */
import {
  actualizarEstadoCampana,
  cambiarMensajesPorDia,
  campanasActivasParaElReloj,
  clientesDeListaCsv,
  congelarDestinatarios,
  crearCampanaDifusion,
  enviosHoyDelCanal,
  estaExcluido,
  listarCatalogo,
  marcarDestinatarioEnProgreso,
  marcarDestinatarioExcluido,
  marcarEnvio,
  obtenerAgente,
  obtenerCampana,
  obtenerCanal,
  obtenerListaDifusion,
  obtenerOrg,
  pendientesDeCampana,
  quedanPendientes,
  resolverListaAutomatica,
  resumenDestinatarios,
  ultimosIntentos,
  MODELO_ANALISIS,
  MODELO_RESPALDO,
  type CampanaDifusion,
  type DestinatarioDifusion,
  type EstadoCampana,
} from "@/lib/db";
import { calcularReparto } from "@/lib/difusion-calculo";
import { completar } from "@/lib/ia";
import { leer as leerArchivo } from "@/lib/media";
import { obtenerPais } from "@/lib/paises";
import { diaDeLaSemanaEn, husoDelServidor, husoValido } from "@/lib/rango";

/**
 * NO CONFIGURABLE POR LA DUEÑA: solo se puede pedir MENOS. Un número personal
 * de WhatsApp Business no verificado que manda cientos de mensajes al día a
 * desconocidos arriesga el bloqueo; esta cifra es una estimación prudente, no
 * un límite oficial de WhatsApp — se ajusta con la experiencia real.
 */
export const TOPE_DURO_DIARIO_QR = 250;

/** Cuántos manda, como mucho, UNA campaña en UNA vuelta del reloj. El espaciado real lo da la cadencia del reloj. */
const ENVIOS_POR_VUELTA = 2;

/** De los últimos intentos de una campaña, a partir de qué proporción de fallos se pausa sola. */
const UMBRAL_AUTOPAUSA = 0.3;
const MUESTRA_AUTOPAUSA = 20;

const AVISO_SALIR = "Responda SALIR si no desea recibir más mensajes.";

// ─────────────────────────────────────────────────────────────────────────────
// Crear campaña
// ─────────────────────────────────────────────────────────────────────────────

export interface DatosNuevaCampana {
  canalId: number; listaId: number; nombre: string; modo: "qr" | "oficial"; mensajeBase: string;
  variaciones?: string[] | null; imagenClave?: string | null;
  /** Con esto, el nombre y el precio SIEMPRE salen del catálogo: nunca de lo que escriba el formulario. */
  productoCatalogoId?: number | null;
  /** Sin producto de catálogo, el nombre y precio los escribe la dueña a mano. */
  productoNombre?: string | null; productoPrecio?: number | null;
  mensajesPorDia: number; diasSemana: number[]; horaDesde: string; horaHasta: string;
  pausaMinSeg?: number; pausaMaxSeg?: number;
  costoEstimadoPorMensaje?: number; costoMoneda?: string; creadoPor?: number | null;
}

export class ErrorDifusion extends Error {}

/**
 * Crea la campaña Y congela sus destinatarios en el momento: lo que entra o
 * sale de la lista DESPUÉS ya no cambia esta campaña —es la garantía de «no
 * se manda dos veces», y también la de que la fecha estimada de fin no se
 * mueve sola—.
 */
export function crearCampana(orgId: number, datos: DatosNuevaCampana): { id: number; destinatarios: number } {
  const canal = obtenerCanal(orgId, datos.canalId);
  if (!canal) throw new ErrorDifusion("Ese canal no existe.");
  if (datos.modo === "qr" && canal.tipo !== "whatsapp") {
    throw new ErrorDifusion("El modo QR solo se puede usar con un canal de WhatsApp.");
  }

  const lista = obtenerListaDifusion(orgId, datos.listaId);
  if (!lista) throw new ErrorDifusion("Esa lista no existe.");

  if (!datos.diasSemana.length) throw new ErrorDifusion("Elige al menos un día de la semana.");
  if (datos.mensajesPorDia < 1) throw new ErrorDifusion("La cantidad por día tiene que ser al menos 1.");
  if (!datos.mensajeBase.trim()) throw new ErrorDifusion("Escribe el mensaje de la campaña.");

  /*
   * EL PRECIO NUNCA SE INVENTA. Con un producto del catálogo, su nombre y su
   * precio de AHORA MISMO mandan sobre cualquier cosa que trajera el
   * formulario: es la misma disciplina que ya tiene el resto del producto
   * —el precio sale de un solo sitio canónico, nunca de lo que alguien
   * escribió aparte—.
   */
  let productoNombre = datos.productoNombre?.trim() || null;
  let productoPrecio = datos.productoPrecio ?? null;
  if (datos.productoCatalogoId) {
    const producto = listarCatalogo(orgId).find((p) => p.id === datos.productoCatalogoId);
    if (!producto) throw new ErrorDifusion("Ese producto del catálogo ya no existe.");
    productoNombre = producto.nombre;
    productoPrecio = producto.precio;
  }

  const id = crearCampanaDifusion(orgId, {
    canalId: datos.canalId, listaId: datos.listaId, nombre: datos.nombre.trim(),
    modo: datos.modo, mensajeBase: datos.mensajeBase.trim(),
    variaciones: datos.variaciones?.length ? datos.variaciones : null,
    imagenClave: datos.imagenClave ?? null,
    productoCatalogoId: datos.productoCatalogoId ?? null, productoNombre, productoPrecio,
    mensajesPorDia: datos.mensajesPorDia, diasSemana: datos.diasSemana,
    horaDesde: datos.horaDesde, horaHasta: datos.horaHasta,
    pausaMinSeg: datos.pausaMinSeg, pausaMaxSeg: datos.pausaMaxSeg,
    costoEstimadoPorMensaje: datos.costoEstimadoPorMensaje, costoMoneda: datos.costoMoneda,
    creadoPor: datos.creadoPor ?? null,
  });

  const clientes =
    lista.tipo === "csv"
      ? clientesDeListaCsv(orgId, lista.id)
      : resolverListaAutomatica(orgId, lista.filtros ? (JSON.parse(lista.filtros) as Record<string, unknown>) : {});

  const destinatarios = congelarDestinatarios(orgId, id, datos.canalId, clientes);
  return { id, destinatarios };
}

/**
 * LAS VARIACIONES, para que la dueña las apruebe ANTES de guardar nada. Si el
 * modelo falla o devuelve menos de las pedidas, se completa con el mensaje
 * base repetido: nunca se le entrega a quien llama menos variaciones de las
 * que pidió, y nunca se inventa un mensaje distinto de lo que ella escribió.
 */
export async function generarVariaciones(
  orgId: number, mensajeBase: string, cantidad = 5,
): Promise<string[]> {
  const limpio = mensajeBase.trim();
  if (!limpio) return [];

  const org = obtenerOrg(orgId);
  try {
    const r = await completar({
      orgId,
      proposito: "analisis",
      modelo: org?.modelo_analisis || MODELO_ANALISIS,
      respaldo: MODELO_RESPALDO,
      mensajes: [
        {
          role: "system",
          content:
            `Eres quien escribe los mensajes de WhatsApp de una tienda. Te doy UN mensaje. Escribe ${cantidad} ` +
            "variaciones del MISMO mensaje: mismo significado, mismo producto, el mismo precio si lo menciona " +
            "—nunca lo cambies ni inventes uno—, mismo tono cercano de vendedor, pero con palabras distintas " +
            "entre sí, como si las escribiera una persona distinta cada vez. No inventes ninguna oferta, ningún " +
            "plazo ni ninguna condición que el mensaje no tenga. No agregues nada sobre darse de baja: eso se " +
            "pone aparte. Responde SOLO con las variaciones, una por línea, sin numerarlas ni ponerles guiones.",
        },
        { role: "user", content: limpio },
      ],
      maxTokens: 900,
      temperatura: 0.9,
      timeoutMs: 20_000,
    });

    const variaciones = r.texto
      .split("\n")
      .map((l) => l.replace(/^[\s\-•\d.)]+/, "").trim())
      .filter(Boolean)
      .slice(0, cantidad);

    while (variaciones.length < cantidad) variaciones.push(limpio);
    return variaciones;
  } catch (e) {
    console.error("[difusion] no se pudieron generar variaciones, se usa el mensaje base", e);
    return Array.from({ length: cantidad }, () => limpio);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pausar, reanudar, cambiar cantidad
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS_QUE_SE_PUEDEN_PAUSAR: EstadoCampana[] = ["activa"];
const ESTADOS_QUE_SE_PUEDEN_REANUDAR: EstadoCampana[] = ["pausada", "auto_pausada", "borrador"];

export function iniciarCampana(orgId: number, campanaId: number): void {
  const campana = obtenerCampana(orgId, campanaId);
  if (!campana) throw new ErrorDifusion("Esa campaña no existe.");
  if (campana.modo === "oficial") {
    throw new ErrorDifusion("El modo oficial todavía no envía: solo queda la estructura lista.");
  }
  actualizarEstadoCampana(orgId, campanaId, "activa");
}

export function pausarCampana(orgId: number, campanaId: number): void {
  const campana = obtenerCampana(orgId, campanaId);
  if (!campana) throw new ErrorDifusion("Esa campaña no existe.");
  if (!ESTADOS_QUE_SE_PUEDEN_PAUSAR.includes(campana.estado)) {
    throw new ErrorDifusion("Esta campaña no se puede pausar en su estado actual.");
  }
  actualizarEstadoCampana(orgId, campanaId, "pausada");
}

export function reanudarCampana(orgId: number, campanaId: number): void {
  const campana = obtenerCampana(orgId, campanaId);
  if (!campana) throw new ErrorDifusion("Esa campaña no existe.");
  if (!ESTADOS_QUE_SE_PUEDEN_REANUDAR.includes(campana.estado)) {
    throw new ErrorDifusion("Esta campaña no se puede reanudar en su estado actual.");
  }
  actualizarEstadoCampana(orgId, campanaId, "activa", null);
}

export function cambiarCantidadDiaria(orgId: number, campanaId: number, nueva: number): void {
  if (nueva < 1) throw new ErrorDifusion("La cantidad diaria tiene que ser al menos 1.");
  cambiarMensajesPorDia(orgId, campanaId, nueva);
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado, para el panel de seguimiento
// ─────────────────────────────────────────────────────────────────────────────

export function estadoDeCampana(orgId: number, campanaId: number): {
  campana: CampanaDifusion;
  pendientes: number; en_progreso: number; enviados: number; entregados: number; fallos: number; excluidos: number;
  dias_estimados_restantes: number; fecha_estimada_fin: string;
} | null {
  const campana = obtenerCampana(orgId, campanaId);
  if (!campana) return null;
  const dest = resumenDestinatarios(orgId, campanaId);
  const reparto = calcularReparto(dest.pendientes, campana.mensajes_por_dia, campana.dias_semana.split(",").map(Number));
  return { campana, ...dest, dias_estimados_restantes: reparto.diasNecesarios, fecha_estimada_fin: reparto.fechaEstimadaFin };
}

// ─────────────────────────────────────────────────────────────────────────────
// El reloj — ver `src/instrumentation.ts`
// ─────────────────────────────────────────────────────────────────────────────

/** El texto exacto que le llega a este destinatario: su variación, con {nombre}/{producto} resueltos. */
function renderizarMensaje(campana: CampanaDifusion, destinatario: DestinatarioDifusion): { texto: string; variacionUsada: number | null } {
  const variaciones: string[] = campana.variaciones ? (JSON.parse(campana.variaciones) as string[]) : [campana.mensaje_base];
  const idx = variaciones.length ? destinatario.orden % variaciones.length : 0;
  const plantilla = variaciones[idx] ?? campana.mensaje_base;

  /*
   * SIN NOMBRE REAL, SALUDO SIN NOMBRE. `destinatario.nombre` nunca es el
   * nombre del perfil de WhatsApp —ver `nombreRealDelResumen`/la lista CSV
   * que lo escribió la dueña a mano—, así que si no hay, no se inventa.
   */
  let texto = destinatario.nombre
    ? plantilla.replace(/\{nombre\}/gi, destinatario.nombre)
    : plantilla.replace(/,?\s*\{nombre\}/gi, "").replace(/\{nombre\}\s*,?/gi, "");
  texto = texto.replace(/\{producto\}/gi, campana.producto_nombre ?? "");
  texto = texto.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  if (!/\bsalir\b/i.test(texto)) texto = `${texto}\n\n${AVISO_SALIR}`;

  return { texto, variacionUsada: campana.variaciones ? idx : null };
}

/** ¿Le toca AHORA, en su propia hora? */
function leTocaAhora(campana: CampanaDifusion, destinatario: DestinatarioDifusion, husoDelCanal: string): boolean {
  const huso = husoValido(destinatario.pais ? obtenerPais(destinatario.pais)?.husoHorario : null)
    ? obtenerPais(destinatario.pais!)!.husoHorario
    : husoDelCanal;

  const diasPermitidos = campana.dias_semana.split(",").map(Number);
  if (!diasPermitidos.includes(diaDeLaSemanaEn(huso))) return false;

  const [dh = 0, dm = 0] = campana.hora_desde.split(":").map(Number);
  const [hh = 23, hm = 59] = campana.hora_hasta.split(":").map(Number);
  const ahoraMin = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: huso, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date())
      .filter((p) => p.type === "hour" || p.type === "minute")
      .map((p) => p.value)
      .join(""),
  );
  const desde = dh * 60 + dm;
  const hasta = hh * 60 + hm;
  return desde <= hasta ? ahoraMin >= desde && ahoraMin <= hasta : ahoraMin >= desde || ahoraMin <= hasta;
}

async function procesarCampana(orgId: number, campanaId: number): Promise<number> {
  const campana = obtenerCampana(orgId, campanaId);
  if (!campana || campana.estado !== "activa") return 0;
  // El modo oficial no envía nada todavía: solo la estructura, ver difusion-oficial.ts.
  if (campana.modo === "oficial") return 0;

  const canal = obtenerCanal(orgId, campana.canal_id);
  if (!canal || canal.estado !== "conectado") return 0;

  const husoDelCanal = obtenerPais(obtenerAgente(orgId, campana.canal_id).pais)?.husoHorario ?? husoDelServidor();

  const tope = Math.min(TOPE_DURO_DIARIO_QR, campana.mensajes_por_dia);
  const yaHoy = enviosHoyDelCanal(orgId, campana.canal_id, husoDelCanal);
  if (yaHoy >= tope) return 0;

  const cupo = Math.min(tope - yaHoy, ENVIOS_POR_VUELTA);
  const candidatos = pendientesDeCampana(orgId, campanaId, cupo * 3); // de sobra, por si algunos no tocan aún

  let enviados = 0;
  for (const d of candidatos) {
    if (enviados >= cupo) break;

    // Defensa en profundidad: pidió «SALIR» después de que la campaña ya lo tenía en cola.
    if (estaExcluido(orgId, d.telefono)) {
      marcarDestinatarioExcluido(orgId, d.id);
      continue;
    }
    if (!leTocaAhora(campana, d, husoDelCanal)) continue;

    marcarDestinatarioEnProgreso(orgId, d.id);
    const { texto, variacionUsada } = renderizarMensaje(campana, d);

    const imagen = campana.imagen_clave ? leerImagenDeCampana(orgId, campana.imagen_clave) : null;
    const { enviarMensajeDeDifusion } = await import("@/lib/agent");
    const r = await enviarMensajeDeDifusion(orgId, campana.canal_id, d.jid ?? d.telefono, texto, imagen);

    if (r.ok) {
      marcarEnvio(orgId, d.id, { ok: true, whapiMessageId: r.messageId, variacionUsada, mensajeEnviado: texto });
      enviados++;
    } else {
      marcarEnvio(orgId, d.id, { ok: false, error: r.error });
      console.error(`[difusion] fallo al mandar a la campaña ${campanaId}: ${r.error}`);
    }
  }

  /*
   * AUTO-PAUSA POR SEÑALES DE FALLO. Una aproximación, no una certeza: solo
   * ve errores de envío explícitos, y WhatsApp puede limitar la entrega en
   * silencio. Es la mejor señal disponible en modo QR.
   */
  const ultimos = ultimosIntentos(orgId, campanaId, MUESTRA_AUTOPAUSA);
  if (ultimos.length >= 5) {
    const fallos = ultimos.filter((u) => u.estado === "fallo").length;
    if (fallos / ultimos.length >= UMBRAL_AUTOPAUSA) {
      actualizarEstadoCampana(
        orgId, campanaId, "auto_pausada",
        `${fallos} de los últimos ${ultimos.length} envíos fallaron: se pausó sola para no arriesgar el número.`,
      );
      return enviados;
    }
  }

  if (!quedanPendientes(orgId, campanaId)) actualizarEstadoCampana(orgId, campanaId, "terminada");

  return enviados;
}

/** La imagen de la campaña, en bytes, o null si no se pudo leer. Nunca tira el envío por esto: se manda solo el texto. */
function leerImagenDeCampana(orgId: number, clave: string): { datos: Buffer } | null {
  try {
    const archivo = leerArchivo(orgId, clave);
    return archivo ? { datos: archivo.datos } : null;
  } catch (e) {
    console.error(`[difusion] no se pudo leer la imagen ${clave}`, e);
    return null;
  }
}

let enCurso = false;

/**
 * Una vuelta del reloj de difusiones. Se salta si la anterior sigue en curso
 * —mismo patrón que `supervisar()`—: dos vueltas a la vez mandarían el doble.
 */
export async function tickDifusiones(): Promise<{ enviados: number }> {
  if (enCurso) return { enviados: 0 };
  enCurso = true;
  let enviados = 0;

  try {
    for (const { org_id, id } of campanasActivasParaElReloj()) {
      try {
        enviados += await procesarCampana(org_id, id);
      } catch (e) {
        console.error(`[difusion] falló la campaña ${id} de la cuenta ${org_id}`, e);
      }
    }
  } finally {
    enCurso = false;
  }

  return { enviados };
}
