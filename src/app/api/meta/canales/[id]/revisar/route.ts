/**
 * «Está conectada y no me llega nada»: la ruta que contesta esa pregunta.
 *
 * Conectar una página son dos cosas y solo una se ve: guardar su acceso, y
 * SUSCRIBIRLA a los eventos. La segunda puede fallar —le faltó un permiso al
 * acceso, se revocó después, alguien la quitó desde Meta— y cuando falla la
 * página queda exactamente igual de conectada en el panel y no recibe ni un
 * mensaje. El aviso del momento de conectar se enseñó una vez y se cerró.
 *
 * Esto no adivina: le pregunta a Meta, que es quien lo sabe, y si la respuesta
 * es que no está suscrita la suscribe en el acto. El dueño no puede hacerlo
 * desde el panel de Meta —la app no es suya—, así que un diagnóstico que no
 * repara lo deja igual de parado.
 *
 * No le escribe a ningún cliente: `revisarPagina` vive en `paginas.ts`, fuera
 * de `send.ts`, y la regla de que solo `agent.ts` envía sigue intacta.
 */
import { NextResponse, type NextRequest } from "next/server";
import { obtenerCanal } from "@/lib/db";
import { revisarPagina } from "@/lib/meta/paginas";
import { sesionApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * El mensaje de Meta, terminado en punto.
 *
 * Viene sin él —«Malformed access token»— y detrás va siempre una frase
 * nuestra: pegados quedan como una sola oración rota que no se entiende.
 */
const frase = (texto: string) => (/[.!?…]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`);

export async function POST(_req: NextRequest, { params }: Ctx) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const { id } = await params;

  // `obtenerCanal` ya filtra por orgId: una cuenta no puede revisar —ni
  // reparar— la página de otra ni sabiendo su identificador.
  const canal = obtenerCanal(orgId, Number(id));
  if (!canal || canal.tipo !== "meta") {
    return NextResponse.json({ error: "Esa página no está conectada aquí." }, { status: 404 });
  }

  /*
   * LO QUE FALTA EN EL SERVIDOR SE MIRA ANTES QUE LO DE META.
   *
   * Sin `META_APP_SECRET` los eventos SÍ llegan y se descartan aquí dentro, uno
   * por uno, por firma inválida. Desde Meta todo se ve perfecto, así que una
   * revisión que solo preguntara allí diría «todo bien» con el canal muerto.
   * Es el diagnóstico que más caro sale, y va primero.
   */
  if (!(process.env.META_APP_SECRET ?? "").trim()) {
    return NextResponse.json({
      ok: false,
      reparada: false,
      titulo: "Los mensajes llegan al panel, pero se están descartando.",
      detalle:
        "Al servidor le falta la clave con la que Meta firma cada aviso, así que no puede " +
        "comprobar que sean auténticos y los rechaza todos. No es algo que se arregle desde " +
        "aquí: avisa a soporte." +
        (s.ctx.superadmin ? " (Falta META_APP_SECRET.)" : ""),
      ultimoEventoAt: canal.ultimo_evento_at,
    });
  }

  const r = await revisarPagina(canal);

  if (!r.tokenVale) {
    return NextResponse.json({
      ok: false,
      reparada: false,
      /*
       * No es lo mismo que Meta rechace el acceso que que no se pueda leer el
       * que tenemos. Lo segundo pasa cuando cambió la clave del servidor y a
       * Meta no se le llegó a preguntar: decir «Facebook lo rechazó» manda a
       * revisar permisos en un sitio donde no hay nada que revisar.
       */
      titulo: r.tokenLegible
        ? "Facebook ya no acepta el acceso de esta página."
        : "El acceso guardado de esta página ya no se puede leer.",
      detalle:
        frase(r.error ?? "Meta no contestó.") +
        " Quita la página y vuelve a conectarla con «Continuar con Facebook».",
      ultimoEventoAt: canal.ultimo_evento_at,
    });
  }

  if (r.faltan.length > 0) {
    return NextResponse.json({
      ok: false,
      reparada: r.reparada,
      titulo: "La página no está recibiendo todos sus avisos de Facebook.",
      detalle:
        frase(r.error ?? "Facebook no dejó completar la suscripción.") +
        " Revisa que el acceso incluya pages_messaging y pages_manage_metadata, o vuelve a " +
        "conectar la página." +
        (s.ctx.superadmin ? ` (Faltan: ${r.faltan.join(", ")}.)` : ""),
      ultimoEventoAt: canal.ultimo_evento_at,
    });
  }

  /*
   * Suscrita y sin un solo evento en la vida. Es el caso que queda cuando todo
   * lo de arriba está bien, y casi siempre es lo mismo: la app sigue en modo
   * Desarrollo, donde el webhook SOLO dispara para quien tiene un rol en ella.
   * Se dice, porque si no la respuesta «todo correcto» y una bandeja vacía se
   * contradicen y no hay nada más que mirar.
   */
  if (canal.ultimo_evento_at === null) {
    return NextResponse.json({
      ok: true,
      reparada: r.reparada,
      titulo: r.reparada
        ? "Arreglado: la página ya está suscrita a los mensajes."
        : "La página está conectada y suscrita, pero todavía no ha llegado ningún mensaje.",
      detalle:
        "Escríbele a la página desde otra cuenta para probarlo. Si la app de Facebook sigue en " +
        "modo Desarrollo, solo llegan los mensajes de quien tenga un rol en ella.",
      ultimoEventoAt: null,
    });
  }

  return NextResponse.json({
    ok: true,
    reparada: r.reparada,
    titulo: r.reparada
      ? "Arreglado: la página no estaba suscrita y ya lo está."
      : "Todo correcto: la página está conectada y recibiendo.",
    detalle: null,
    ultimoEventoAt: canal.ultimo_evento_at,
  });
}
