/**
 * El webhook de Meta: Messenger, mensajes directos de Instagram y comentarios.
 *
 * Es la única ruta de la aplicación que NO pasa por `tenant.ts`, y no puede: la
 * llama Meta, no un navegador con sesión. La cuenta se DEDUCE de la página, que
 * es lo único que Meta manda, y desde ahí todo vuelve a ir con `orgId`. Es la
 * misma excepción que ya tenía el webhook de WhatsApp y está declarada en la
 * cabecera de `db.ts`.
 *
 * Lo que sustituye a la sesión es la firma. Ver `firma.ts`.
 */
import { NextResponse } from "next/server";
import {
  actualizarCanal,
  canalMetaPorDestino,
  registrarAnuncioVisto,
  registrarEventoMeta,
} from "@/lib/db";
import { ingerir } from "@/lib/ingesta";
import { firmaValida, respuestaDeVerificacion } from "@/lib/meta/firma";
import { destinosDelEvento, normalizarEvento } from "@/lib/meta/normalize";

export const dynamic = "force-dynamic";
/* Node y no Edge: `ingerir` arrastra better-sqlite3. */
export const runtime = "nodejs";

/**
 * El alta. Meta llama una sola vez, al registrar la URL en su panel, y espera
 * que le devuelvas su `challenge` en texto plano.
 *
 * Si esto no responde bien, el panel de Meta NO deja guardar el webhook: es el
 * primer eslabón de toda la integración.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const challenge = respuestaDeVerificacion(params, process.env.META_VERIFY_TOKEN ?? "");

  if (challenge === null) {
    console.warn("[meta] verificación rechazada: el verify_token no coincide");
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(req: Request) {
  /*
   * EL CUERPO CRUDO, ANTES DE TOCARLO.
   *
   * La firma se calcula sobre estos bytes exactos. Si se leyera con
   * `req.json()` y luego se volviera a serializar para firmar, cambiarían
   * espacios y orden de claves y la firma NO cuadraría nunca, aunque el secreto
   * fuera correcto. Por eso `text()` va primero y el `JSON.parse` después.
   */
  const crudo = await req.text();
  const cabecera = req.headers.get("x-hub-signature-256");
  const secreto = process.env.META_APP_SECRET ?? "";

  const ok = firmaValida(crudo, cabecera, secreto);

  let cuerpo: unknown = null;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    cuerpo = null;
  }

  const objeto = typeof (cuerpo as { object?: unknown })?.object === "string"
    ? (cuerpo as { object: string }).object
    : "desconocido";

  if (!ok) {
    /*
     * Se registra el intento y se responde 200.
     *
     * El 200 no es descuido: ante un 4xx repetido Meta desactiva el webhook, y
     * entonces un atacante que mande basura firmada mal deja al negocio sin
     * recibir mensajes de verdad. Se acusa recibo, no se procesa nada, y queda
     * la fila con `firma_ok = 0` para poder mirarlo.
     */
    registrarEventoMeta({
      orgId: null, canalId: null, objeto, pageId: null,
      firmaOk: false, procesado: false, mensajes: 0,
      detalle: secreto ? "Firma inválida" : "META_APP_SECRET sin configurar",
      cuerpo: crudo,
    });
    console.warn("[meta] evento con firma inválida, descartado");
    return NextResponse.json({ ok: true });
  }

  /*
   * A partir de aquí el evento es auténtico. Se resuelve el canal por la página
   * o por la cuenta de Instagram: los DM de Instagram llegan con el id de la
   * cuenta de IG aunque los mande el webhook de la misma página.
   */
  const destinos = destinosDelEvento(cuerpo);
  let atendido = false;

  for (const destino of destinos) {
    const canal = canalMetaPorDestino(destino);

    if (!canal) {
      // Página que nadie conectó. Se guarda igual: es justo el evento que hace
      // falta mirar cuando alguien dice «conecté la página y no llega nada».
      registrarEventoMeta({
        orgId: null, canalId: null, objeto, pageId: destino,
        firmaOk: true, procesado: false, mensajes: 0,
        detalle: "No hay ninguna página conectada con ese identificador",
        cuerpo: crudo,
      });
      continue;
    }

    atendido = true;
    const descartes: string[] = [];
    const mensajes = normalizarEvento(cuerpo, destino, descartes);

    /*
     * EL ANUNCIO SE APUNTA EN CUANTO SE VE, pase lo que pase después.
     *
     * El ad_id viaja SOLO en el primer evento del hilo. Antes esto ocurria
     * dentro del agente, y en una pagina que solo mira —el modo por defecto—
     * el agente no corre: el anuncio se perdia y la lista de «anuncios por
     * vincular» se quedaba siempre vacia. Entonces, el dia que el dueño
     * encendia el agente, no habia nada vinculado y no podia cotizar nada.
     *
     * Va aqui, en la entrada, porque «hemos visto este anuncio» es un hecho
     * del canal y no una necesidad del agente.
     */
    for (const m of mensajes) {
      if (m.metaAdId) registrarAnuncioVisto(canal.org_id, m.metaAdId, m.productoAnuncio);
    }

    /*
     * `ingerir` es la MISMA función que atiende WhatsApp. Aquí está el sentido
     * de todo el módulo: traducir y entregar. Las cuatro invariantes —un lead
     * es quien llega, la atribución por id, la idempotencia y el sellado de la
     * venta— se heredan tal cual, y el agente responde por el mismo camino.
     */
    let procesados = 0;
    let detalle: string | null = null;

    try {
      const r = await ingerir(canal, mensajes, { dentroDePeticion: true });
      procesados = r.procesados;
      actualizarCanal(canal.org_id, canal.id, { ultimo_evento_at: Math.floor(Date.now() / 1000) });
    } catch (e) {
      detalle = e instanceof Error ? e.message : "error desconocido";
      console.error("[meta] fallo al ingerir el evento:", e);
    }

    registrarEventoMeta({
      orgId: canal.org_id, canalId: canal.id, objeto, pageId: destino,
      firmaOk: true, procesado: detalle === null, mensajes: procesados,
      detalle:
        detalle ??
        (descartes.length > 0
          ? descartes.join(" · ")
          : mensajes.length === 0
            ? "El evento no traía mensajes que guardar"
            : null),
      cuerpo: crudo,
    });
  }

  if (destinos.length === 0) {
    registrarEventoMeta({
      orgId: null, canalId: null, objeto, pageId: null,
      firmaOk: true, procesado: false, mensajes: 0,
      detalle: "El evento no traía ninguna página",
      cuerpo: crudo,
    });
  }

  /*
   * SIEMPRE 200, y rápido.
   *
   * Meta reintenta lo que no se acusa y desactiva el webhook si falla mucho. El
   * trabajo lento —llamar al modelo, analizar la venta— ya está fuera de esta
   * respuesta: lo encola `ingerir` con `after()`.
   */
  return NextResponse.json({ ok: true, atendido });
}
