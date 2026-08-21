import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { contarCanales, crearCanal, listarCanales } from "@/lib/db";
import { cifrar, descifrar, enmascarar, secretoAleatorio } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";
import { crearCanalWhapi, ErrorWhapi, mensajeDeError, validarToken } from "@/lib/whapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CANALES = 20;

/** Nunca se devuelve el token en claro en un listado. */
function aVista(c: ReturnType<typeof listarCanales>[number]) {
  return {
    id: c.id,
    nombre: c.nombre,
    phone: c.phone.startsWith("pendiente:") ? null : c.phone,
    estado: c.estado,
    agente_activo: c.agente_activo === 1,
    activo: c.activo === 1,
    ultimo_evento_at: c.ultimo_evento_at,
    created_at: c.created_at,
    token_enmascarado: enmascarar(descifrarSeguro(c.token_cifrado)),
  };
}

function descifrarSeguro(blob: string): string {
  try {
    return descifrar(blob);
  } catch {
    // SESSION_SECRET cambió: el token ya no se puede leer. No se revienta la
    // vista por eso; el canal aparece y el usuario puede reconectarlo.
    return "";
  }
}

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  return NextResponse.json({ canales: listarCanales(s.ctx.orgId).map(aVista) });
}

/**
 * Dos caminos, mismo final: una fila en `canales` con su token cifrado y su
 * webhook apuntado al panel.
 *
 *  - `{ nombre }`          → crea el canal en Whapi y devuelve su id para que
 *                            la pantalla del QR empiece a sondear. Es el
 *                            camino principal.
 *  - `{ nombre, token }`   → el usuario trae un canal ya creado en Whapi.
 */
const Entrada = z.object({
  nombre: z.string().trim().min(2, "Ponle un nombre al número").max(60),
  token: z.string().trim().min(16).max(200).optional(),
});

export async function POST(req: NextRequest) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  if (contarCanales(orgId) >= MAX_CANALES) {
    return NextResponse.json(
      { error: `Llegaste al máximo de ${MAX_CANALES} números conectados.` },
      { status: 400 },
    );
  }

  const cuerpo = await req.json().catch(() => null);
  const datos = Entrada.safeParse(cuerpo);
  if (!datos.success) {
    return NextResponse.json(
      { error: datos.error.issues[0]?.message ?? "Revisa los datos" },
      { status: 400 },
    );
  }

  const { nombre, token } = datos.data;
  const webhookSecret = secretoAleatorio();

  try {
    // ── Camino secundario: token pegado a mano ──────────────────────────────
    if (token) {
      const salud = await validarToken(token);

      const id = crearCanal(orgId, {
        nombre,
        // Si todavía no está vinculado, el teléfono llega al conectarse.
        phone: salud.phone ?? `pendiente:${webhookSecret.slice(0, 10)}`,
        tokenCifrado: cifrar(token),
        webhookSecret,
        whapiChannelId: null,
        estado: salud.estado,
      });

      return NextResponse.json({ id, estado: salud.estado, phone: salud.phone });
    }

    // ── Camino principal: crear el canal y mostrar el QR ────────────────────
    const canal = await crearCanalWhapi(`SalesDash · ${nombre}`);

    const id = crearCanal(orgId, {
      nombre,
      phone: `pendiente:${webhookSecret.slice(0, 10)}`,
      tokenCifrado: cifrar(canal.token),
      webhookSecret,
      whapiChannelId: canal.id,
      estado: "iniciando",
    });

    return NextResponse.json({ id, estado: "iniciando" });
  } catch (e) {
    if (e instanceof ErrorWhapi) {
      return NextResponse.json({ error: mensajeDeError(e) }, { status: 502 });
    }
    // UNIQUE(org_id, phone): ese número ya está conectado en esta cuenta.
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Ese número ya está conectado en esta cuenta." },
        { status: 409 },
      );
    }
    console.error("No se pudo crear el canal:", e);
    return NextResponse.json({ error: "No pudimos conectar el número. Intenta de nuevo." }, { status: 500 });
  }
}
