/**
 * SalesDash — el informe de un número, para llevárselo.
 *
 * Desconectar un número borra sus conversaciones y sus métricas, y no se puede
 * deshacer. Eso está bien —los datos de un WhatsApp que ya no es tuyo no tienen
 * por qué quedarse aquí—, pero hasta ahora la única manera de irse era perderlo
 * todo: cuánto vendió ese número, qué anuncios le traían gente, qué cerró la IA
 * y qué se habló con cada cliente.
 *
 * Este módulo escribe eso en un archivo que el dueño se queda: un HTML de una
 * sola pieza, sin nada que cargar de fuera, que se abre en cualquier navegador
 * y se imprime a PDF. Ni base de datos que restaurar, ni programa que instalar,
 * ni servidor que siga en pie dentro de dos años.
 *
 * Va con TODO el histórico del número, no con el rango que el panel tenga
 * puesto: es una copia de seguridad, y una copia a medias no sirve de nada.
 *
 * Aquí no hay SQL ni reglas de negocio nuevas: las cifras son las que calcula
 * `metrics.ts` —las mismas que el panel— y los hilos salen de `db.ts`. Si el
 * informe dijera algo distinto de la pantalla, uno de los dos estaría mintiendo.
 */
import {
  getConversation,
  listarConversaciones,
  listarMensajes,
  obtenerOrg,
  type Canal,
  type Conversacion,
  type Mensaje,
} from "./db";
import { calcularMetricas, formatearDuracion, type Metricas } from "./metrics";

/** Todo el histórico. La copia de seguridad de medio año no es una copia. */
const TODO = { desde: 0, hasta: 9_999_999_999 };

/** Tope de hilos transcritos. Ver `LIMITE_HILOS` más abajo. */
const LIMITE_CONVERSACIONES = 5_000;

const ESTADOS: Record<string, string> = {
  ia: "La cerró la IA",
  humano: "La cerró el equipo",
  abierta: "Sin cerrar",
  revision: "En revisión",
};

const SENALES: Record<string, string> = {
  resumen_ia: "resumen de la IA con el marcador de cierre",
  resumen_tras_intervencion: "resumen de la IA, pero un vendedor había escrito antes",
  imagen_factura: "el vendedor mandó la factura",
  imagen_comprobante: "el vendedor mandó un comprobante de pago",
  confirmacion_texto: "confirmación por texto de un vendedor",
  correccion_manual: "lo corrigió una persona desde la bandeja de revisión",
};

const QUIEN: Record<Mensaje["emisor"], string> = {
  cliente: "Cliente",
  ia: "IA",
  humano: "Vendedor",
};

/**
 * Escapar NO es opcional.
 *
 * Todo lo que va dentro lo escribió un cliente por WhatsApp o lo sacó un
 * modelo de ese chat: un «<script>» en el nombre de alguien no puede volverse
 * ejecutable porque el dueño abra su propio informe.
 */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fecha(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString("es-DO", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function dinero(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Nombre de archivo sin tildes, espacios ni nada que un sistema de ficheros discuta. */
export function nombreDeArchivo(canal: Canal, hoy: Date): string {
  const limpio = canal.nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "numero";

  return `informe-${limpio}-${hoy.toISOString().slice(0, 10)}.html`;
}

function fila(etiqueta: string, valor: string, destacado = false): string {
  return `<tr><th>${esc(etiqueta)}</th><td class="${destacado ? "fuerte" : ""}">${esc(valor)}</td></tr>`;
}

function tablaResumen(m: Metricas, metaCobertura: number, metaEfectividad: number): string {
  return `
    <table class="datos">
      ${fila("Conversaciones en total", String(m.leads), true)}
      ${fila("Leads por anuncio", `${m.leads_anuncio} (${m.tasa_cierre_anuncio}% cerrados)`, true)}
      ${fila("Escribieron por su cuenta", String(m.escribieron_por_su_cuenta))}
      ${fila("La cerró la IA", `${m.cierres_ia} · ${m.tasa_cierre_ia}% de las conversaciones`)}
      ${fila("La cerró el equipo", String(m.cierres_humano))}
      ${fila("Sin cerrar", String(m.sin_cerrar))}
      ${fila("En revisión", String(m.revision))}
      ${fila("Facturado sin envío", dinero(m.facturado), true)}
      ${fila("De eso, lo cerró la IA", dinero(m.facturado_ia))}
      ${fila("De eso, lo cerró el equipo", dinero(m.facturado_humano))}
      ${fila("Envíos cobrados, fuera de la facturación", dinero(m.envios_cobrados))}
      ${fila("Promedio por pedido", dinero(m.valor_promedio_venta))}
      ${fila("Cobertura de la IA", `${m.cobertura_ia.valor}% (meta ${metaCobertura}%)`)}
      ${fila("Efectividad del equipo", `${m.efectividad_humana.valor}% (meta ${metaEfectividad}%)`)}
      ${fila("La IA tarda en cerrar", formatearDuracion(m.tiempo_promedio_ia))}
      ${fila("El equipo tarda en cerrar", formatearDuracion(m.tiempo_promedio_humano))}
      ${fila("Los números cuadran", m.cuadra ? "Sí" : "NO — falta alguna conversación por clasificar")}
    </table>`;
}

function tablaProductos(m: Metricas): string {
  if (m.productos_anuncio.length === 0) {
    return `<p class="vacio">Por este número no llegó nadie desde un anuncio.</p>`;
  }

  const filas = m.productos_anuncio
    .map(
      (p) => `<tr>
        <td>${esc(p.producto)}</td>
        <td class="tenue">${esc(p.descripcion ?? "—")}</td>
        <td class="num">${p.leads}</td>
        <td class="num">${p.cerrados}</td>
        <td class="num">${p.leads === 0 ? 0 : Math.round((p.cerrados / p.leads) * 100)}%</td>
      </tr>`,
    )
    .join("");

  return `<table class="rejilla">
    <thead><tr>
      <th>Producto anunciado</th><th>Lo que prometía el anuncio</th>
      <th class="num">Leads</th><th class="num">Cerrados</th><th class="num">Tasa</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

function tablaDias(m: Metricas): string {
  const conAlgo = m.serie_diaria.filter((d) => d.leads > 0);
  if (conAlgo.length === 0) return `<p class="vacio">Sin actividad registrada.</p>`;

  const filas = conAlgo
    .map(
      (d) => `<tr>
        <td class="num">${esc(d.dia)}</td>
        <td class="num">${d.leads}</td>
        <td class="num">${d.leads_anuncio}</td>
        <td class="num">${d.cierres_ia}</td>
        <td class="num">${d.cierres_humano}</td>
      </tr>`,
    )
    .join("");

  return `<table class="rejilla">
    <thead><tr>
      <th class="num">Día</th><th class="num">Conversaciones</th><th class="num">Por anuncio</th>
      <th class="num">Cerró la IA</th><th class="num">Cerró el equipo</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

function tablaConversaciones(convs: Conversacion[]): string {
  if (convs.length === 0) return `<p class="vacio">Este número no llegó a tener conversaciones.</p>`;

  const filas = convs
    .map(
      (c) => `<tr>
        <td>
          <a href="#hilo-${c.id}">${esc(c.cliente_nombre ?? "Sin nombre")}</a>
          <div class="tenue num">+${esc(c.cliente_phone)}</div>
        </td>
        <td>${esc(ESTADOS[c.cerrado_por] ?? c.cerrado_por)}</td>
        <td class="tenue">${esc(c.senal_de_cierre ? SENALES[c.senal_de_cierre] ?? c.senal_de_cierre : "—")}</td>
        <td>${esc(c.producto_anuncio ?? (c.origen === "anuncio" ? "Anuncio sin título" : "—"))}</td>
        <td>${esc(c.producto_vendido ?? "—")}</td>
        <td class="num">${dinero(c.total)}</td>
        <td class="num">${dinero(c.envio)}</td>
        <td class="tenue">${esc(c.motivo_perdida ?? "—")}</td>
        <td class="num tenue">${esc(fecha(c.fecha_inicio))}</td>
        <td class="num tenue">${esc(fecha(c.fecha_cierre))}</td>
      </tr>`,
    )
    .join("");

  return `<table class="rejilla">
    <thead><tr>
      <th>Cliente</th><th>Estado</th><th>Señal de cierre</th><th>Llegó por</th>
      <th>Producto vendido</th><th class="num">Total</th><th class="num">Envío</th>
      <th>Por qué no cerró</th><th class="num">Primer mensaje</th><th class="num">Cierre</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

function hilo(c: Conversacion, mensajes: Mensaje[]): string {
  const burbujas = mensajes
    .map((m) => {
      /*
       * La transcripción y la descripción van DENTRO del hilo, no en una nota
       * al pie: en el panel se pueden pinchar, pero aquí no hay audio que
       * reproducir ni foto que abrir. Si no se escriben, el hilo exportado
       * tiene agujeros justo donde a veces se cierra media venta.
       */
      const extra = m.transcripcion
        ? `<div class="extra">Nota de voz: ${esc(m.transcripcion)}</div>`
        : m.descripcion_imagen
          ? `<div class="extra">Imagen: ${esc(m.descripcion_imagen)}</div>`
          : "";

      return `<div class="msg ${m.emisor}">
        <div class="quien">${esc(QUIEN[m.emisor])} · <span class="tenue">${esc(fecha(m.created_at))}</span></div>
        <div class="texto">${esc(m.content)}</div>
        ${extra}
      </div>`;
    })
    .join("");

  const anuncio = c.producto_anuncio || c.origen === "anuncio"
    ? `<p class="anuncio"><strong>Llegó por un anuncio${c.producto_anuncio ? `: ${esc(c.producto_anuncio)}` : ""}</strong>
       ${c.descripcion_anuncio ? `<br><span class="tenue">${esc(c.descripcion_anuncio)}</span>` : ""}</p>`
    : "";

  return `<section class="hilo" id="hilo-${c.id}">
    <h3>${esc(c.cliente_nombre ?? "Sin nombre")} <span class="tenue num">+${esc(c.cliente_phone)}</span></h3>
    <p class="tenue">${esc(ESTADOS[c.cerrado_por] ?? c.cerrado_por)}
      ${c.total !== null ? ` · total ${esc(dinero(c.total))}` : ""}
      ${c.intervencion_humana === 1 ? " · intervino un vendedor" : ""}</p>
    ${anuncio}
    ${c.resumen_pedido ? `<p class="pedido"><strong>Pedido:</strong> ${esc(c.resumen_pedido)}</p>` : ""}
    ${burbujas || `<p class="vacio">Sin mensajes guardados.</p>`}
  </section>`;
}

const ESTILO = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         color: #0f1a17; background: #f7f9f8; }
  main { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; padding-top: 18px; border-top: 1px solid #e8edeb; }
  h3 { font-size: 14px; margin: 0 0 2px; }
  p { margin: 0 0 8px; }
  .tenue { color: #5a6b65; font-size: 12.5px; }
  .num { font-variant-numeric: tabular-nums; }
  .fuerte { font-weight: 700; }
  .cabecera { background: #fff; border: 1px solid #e8edeb; border-radius: 10px; padding: 18px; }
  .aviso { margin-top: 12px; padding: 10px 12px; border-radius: 8px;
           background: #fdf3e2; color: #7a4f06; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  .datos th { text-align: left; font-weight: 400; color: #5a6b65; padding: 7px 10px;
              border-bottom: 1px solid #eef2f0; width: 55%; }
  .datos td { padding: 7px 10px; border-bottom: 1px solid #eef2f0; text-align: right;
              font-variant-numeric: tabular-nums; }
  .rejilla { border: 1px solid #e8edeb; border-radius: 8px; overflow: hidden; font-size: 12.5px; }
  .rejilla th { text-align: left; background: #f1f5f3; padding: 8px 10px; font-size: 11px;
                text-transform: uppercase; letter-spacing: .04em; color: #5a6b65; }
  .rejilla td { padding: 8px 10px; border-top: 1px solid #eef2f0; vertical-align: top; }
  .rejilla td.num, .rejilla th.num { text-align: right; }
  a { color: #12876a; }
  .vacio { color: #8b9a94; font-style: italic; }
  .hilo { background: #fff; border: 1px solid #e8edeb; border-radius: 10px;
          padding: 14px 16px; margin-bottom: 12px; break-inside: avoid; }
  .anuncio, .pedido { font-size: 12.5px; background: #f1f5f3; border-radius: 6px; padding: 8px 10px; }
  .msg { margin: 8px 0; padding: 8px 10px; border-radius: 8px; max-width: 78%; }
  .msg.cliente { background: #f1f5f3; }
  .msg.ia { background: #e7f4f0; margin-left: auto; }
  .msg.humano { background: #eceffd; margin-left: auto; }
  .quien { font-size: 11px; color: #5a6b65; margin-bottom: 2px; }
  .texto { white-space: pre-wrap; word-break: break-word; }
  .extra { margin-top: 4px; font-size: 12px; color: #5a6b65; font-style: italic; }
  @media print {
    body { background: #fff; padding: 0; }
    .hilo, .cabecera, .rejilla { border-color: #ccc; }
  }
`;

/**
 * El informe entero de un número, en un archivo.
 *
 * `LIMITE_HILOS` no es un capricho: transcribir cien mil mensajes en una sola
 * página deja un archivo que ningún navegador abre, y un informe que no se
 * puede abrir no es una copia de seguridad. Cuando se recorta, el documento lo
 * DICE en su cabecera y en su sitio — un informe que se calla lo que le falta
 * es peor que no tenerlo, porque se confía en él.
 */
export function informeDeCanal(
  orgId: number,
  canal: Canal,
  opciones: { hilos?: number; ahora?: Date } = {},
): { nombre: string; html: string } {
  const limiteHilos = opciones.hilos ?? 400;
  const hoy = opciones.ahora ?? new Date();

  const org = obtenerOrg(orgId);
  const m = calcularMetricas(orgId, { ...TODO, canalId: canal.id });

  const conversaciones = listarConversaciones(orgId, {
    ...TODO,
    canalId: canal.id,
    limite: LIMITE_CONVERSACIONES,
  });

  const transcritas = conversaciones.slice(0, limiteHilos);
  const recortados = conversaciones.length - transcritas.length;

  const hilos = transcritas
    .map((c) => {
      // Se relee: `listarConversaciones` trae la fila, y el hilo necesita sus
      // mensajes. Una consulta por conversación es de sobra para un documento
      // que se genera una vez en la vida de un número.
      const conv = getConversation(orgId, c.id) ?? c;
      return hilo(conv, listarMensajes(orgId, c.id));
    })
    .join("");

  const telefono = canal.phone.startsWith("pendiente:") ? "sin vincular" : `+${canal.phone}`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de ${esc(canal.nombre)} · ${esc(hoy.toISOString().slice(0, 10))}</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
  <div class="cabecera">
    <h1>${esc(canal.nombre)}</h1>
    <p class="tenue num">${esc(telefono)} · ${esc(org?.nombre ?? "")}</p>
    <p class="tenue">Informe generado el ${esc(fecha(Math.floor(hoy.getTime() / 1000)))}
      Recoge TODO el histórico de este número:
      ${conversaciones.length} ${conversaciones.length === 1 ? "conversación" : "conversaciones"},
      con sus cifras, sus anuncios y sus hilos.</p>
    <div class="aviso">
      Guarda este archivo: si desconectas el número, sus conversaciones y sus métricas se borran del
      panel y no se pueden recuperar. Este documento se abre en cualquier navegador, sin internet, y
      se imprime a PDF desde el propio navegador.
      ${recortados > 0
        ? `<br><br><strong>Se transcriben los ${transcritas.length} hilos más recientes.</strong>
           Los otros ${recortados} salen en la tabla de conversaciones con todos sus datos, pero sin
           sus mensajes: un archivo con todo no habría abierto.`
        : ""}
    </div>
  </div>

  <h2>Lo que hizo este número</h2>
  ${tablaResumen(m, m.cobertura_ia.meta, m.efectividad_humana.meta)}

  <h2>Productos que trajeron leads</h2>
  ${tablaProductos(m)}

  <h2>Día a día</h2>
  ${tablaDias(m)}

  <h2>Conversaciones</h2>
  ${tablaConversaciones(conversaciones)}

  <h2>Los hilos, uno a uno</h2>
  ${hilos || `<p class="vacio">No hay hilos que transcribir.</p>`}
</main>
</body>
</html>`;

  return { nombre: nombreDeArchivo(canal, hoy), html };
}
