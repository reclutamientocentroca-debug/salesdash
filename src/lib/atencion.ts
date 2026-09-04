/**
 * SalesDash — «Necesita tu atención»: lo que no puede esperar a mañana.
 *
 * Es la lista que el dueño mira antes que ninguna cifra: un número caído, los
 * chats de Messenger sin primera respuesta, los anuncios que la IA contesta a
 * ciegas y los cierres esperando su visto bueno. Cada fila dice qué pasa,
 * dónde, desde cuándo, qué cuesta y qué botón lo arregla.
 *
 * Es una función pura: recibe lo que ya está en la base y devuelve filas. Así
 * se prueba sin panel y el panel no decide nada por su cuenta.
 */

export type TonoAtencion = "rojo" | "ambar" | "azul" | "morado";

export interface FilaAtencion {
  clave: string;
  etiqueta: string;
  tono: TonoAtencion;
  que: string;
  donde: string;
  /** Epoch en segundos, o null cuando no hay un «desde» que decir. */
  desde: number | null;
  impacto: string;
  accion: { texto: string; href: string };
}

export interface EntradaAtencion {
  canales: {
    nombre: string;
    phone: string;
    tipo: string;
    estado: string;
    activo: number;
    ultimo_evento_at: number | null;
  }[];
  /** Chats de Messenger donde lo último lo escribió el cliente. */
  sinResponder: number;
  /** Los nombres de las páginas conectadas, para decir dónde. */
  paginas: string[];
  /** Anuncios de Meta sin producto del catálogo. */
  sinVincular: number;
  /** Cierres en la bandeja de revisión. */
  enRevision: number;
  /** Anomalías abiertas de severidad alta, con su tipo. */
  anomalias: { tipo: string; created_at: number }[];
  /** Cuántas filas como mucho. */
  maximo?: number;
}

/** Cómo se cuenta cada anomalía alta cuando se agrupa por tipo. */
const ANOMALIAS: Record<string, { que: (n: number) => string; impacto: string }> = {
  agente_en_bucle: { que: (n) => `La IA se está repitiendo en ${n} chat${n === 1 ? "" : "s"}`, impacto: "El cliente recibe lo mismo dos veces" },
  ia_repetitiva: { que: (n) => `La IA se está repitiendo en ${n} chat${n === 1 ? "" : "s"}`, impacto: "El cliente recibe lo mismo dos veces" },
  envio_fallido: { que: (n) => `${n} mensaje${n === 1 ? "" : "s"} no se pudo${n === 1 ? "" : "ieron"} enviar`, impacto: "El cliente se quedó sin respuesta" },
  pidio_humano: { que: (n) => `${n} cliente${n === 1 ? "" : "s"} pidi${n === 1 ? "ó" : "eron"} hablar con una persona`, impacto: "Esperan a alguien del equipo" },
  handoff_agente: { que: (n) => `${n} chat${n === 1 ? "" : "s"} pasado${n === 1 ? "" : "s"} al equipo por la IA`, impacto: "Esperan a alguien del equipo" },
  respuesta_rechazada: { que: (n) => `${n} respuesta${n === 1 ? "" : "s"} frenada${n === 1 ? "" : "s"} por el revisor`, impacto: "La IA no supo qué decir" },
  cierre_incompleto: { que: (n) => `${n} venta${n === 1 ? "" : "s"} sin producto o sin monto`, impacto: "Facturan cero en el panel" },
  canal_mudo: { que: (n) => `${n} número${n === 1 ? "" : "s"} sin recibir nada en horas`, impacto: "Puede haber caído sin avisar" },
  canal_bajo: { que: (n) => `${n} número${n === 1 ? "" : "s"} recibiendo menos de lo normal`, impacto: "Menos gente escribiendo" },
  agente_sin_modelo: { que: () => "La IA no tiene modelo configurado", impacto: "No contesta a nadie" },
  atribucion_perdida: { que: (n) => `${n} mensaje${n === 1 ? "" : "s"} sin saber de qué chat`, impacto: "Se pierden del conteo" },
  producto_distinto: { que: (n) => `${n} venta${n === 1 ? "" : "s"} con un producto distinto al anunciado`, impacto: "Revisa qué se vendió" },
  resumen_dudoso: { que: (n) => `${n} resumen${n === 1 ? "" : "es"} de pedido con datos dudosos`, impacto: "Esas ventas esperan en revisión" },
  sin_responder: { que: (n) => `${n} chat${n === 1 ? "" : "s"} de WhatsApp sin respuesta`, impacto: "Clientes esperando" },
};

export function filasDeAtencion(e: EntradaAtencion): FilaAtencion[] {
  const filas: FilaAtencion[] = [];

  // Un número caído va primero: mientras tanto nadie recibe nada.
  for (const c of e.canales) {
    const real = c.tipo !== "meta" && c.activo === 1 && !c.phone.startsWith("pendiente:");
    if (!real || c.estado === "conectado") continue;
    filas.push({
      clave: `caido:${c.phone}`,
      etiqueta: "Número caído",
      tono: "rojo",
      que: `${c.nombre} perdió la sesión de WhatsApp`,
      donde: `+${c.phone}`,
      desde: c.ultimo_evento_at,
      impacto: "Lo que escriban no entra hasta reconectar",
      accion: { texto: "Reconectar", href: "/numeros" },
    });
  }

  if (e.sinResponder > 0) {
    const n = e.sinResponder;
    filas.push({
      clave: "sin_responder",
      etiqueta: "Sin responder",
      tono: "ambar",
      que: `${n} chat${n === 1 ? "" : "s"} de Messenger sin primera respuesta`,
      donde: e.paginas.length > 0 ? e.paginas.join(", ") : "Messenger",
      desde: null,
      impacto: "Clientes esperando",
      accion: { texto: "Abrir bandeja", href: "/canales/meta" },
    });
  }

  if (e.sinVincular > 0) {
    const n = e.sinVincular;
    const p = e.paginas.length;
    filas.push({
      clave: "anuncios",
      etiqueta: "Anuncios",
      tono: "azul",
      que: `${n} anuncio${n === 1 ? "" : "s"} sin vincular a un producto`,
      donde: p > 0 ? `${p} página${p === 1 ? "" : "s"} de Facebook` : "Facebook",
      desde: null,
      impacto: "La IA responde a ciegas",
      accion: { texto: "Vincular", href: "/canales/meta" },
    });
  }

  if (e.enRevision > 0) {
    const n = e.enRevision;
    filas.push({
      clave: "revision",
      etiqueta: "Revisión",
      tono: "morado",
      que: `${n} cierre${n === 1 ? "" : "s"} dudoso${n === 1 ? "" : "s"} esperando tu visto bueno`,
      donde: "Todos los números",
      desde: null,
      impacto: "Afecta el conteo de ventas",
      accion: { texto: "Revisar", href: "/revision" },
    });
  }

  // Las anomalías altas, agrupadas por tipo y con la más reciente como «desde».
  const porTipo = new Map<string, { n: number; desde: number }>();
  for (const a of e.anomalias) {
    const actual = porTipo.get(a.tipo) ?? { n: 0, desde: a.created_at };
    actual.n += 1;
    actual.desde = Math.max(actual.desde, a.created_at);
    porTipo.set(a.tipo, actual);
  }
  for (const [tipo, { n, desde }] of porTipo) {
    const texto = ANOMALIAS[tipo];
    filas.push({
      clave: `anomalia:${tipo}`,
      etiqueta: "Anomalía",
      tono: "rojo",
      que: texto ? texto.que(n) : `${n} anomalía${n === 1 ? "" : "s"} de tipo «${tipo.replace(/_/g, " ")}»`,
      donde: "Conversaciones",
      desde,
      impacto: texto ? texto.impacto : "Revísalo en las conversaciones",
      accion: { texto: "Ver", href: "/conversaciones" },
    });
  }

  return filas.slice(0, e.maximo ?? 6);
}
