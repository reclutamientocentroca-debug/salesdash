import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { contarCanales, crearCanal, listarCanales } from "@/lib/db";
import { secretoAleatorio } from "@/lib/auth";
import { sesionApi } from "@/lib/tenant";
import { conectar } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CANALES = 20;

function aVista(c: ReturnType<typeof listarCanales>[number]) {
  return {
    id: c.id,
    nombre: c.nombre,
    phone: c.phone.startsWith("pendiente:") ? null : c.phone,
    estado: c.estado,
    agente_activo: c.agente_activo === 1,
    contesta_ia: c.contesta_ia === 1,
    activo: c.activo === 1,
    ultimo_evento_at: c.ultimo_evento_at,
    created_at: c.created_at,
  };
}

export async function GET() {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;

  return NextResponse.json({ canales: listarCanales(s.ctx.orgId).map(aVista) });
}

/**
 * Un solo camino: se crea la fila y se abre la sesión de WhatsApp, que emite el
 * QR en cuanto está lista.
 *
 * Antes había dos —crear el canal en el proveedor, o pegar un token ya
 * existente— porque el proveedor era quien sostenía la sesión. Al conectar por
 * QR no hay token que pegar: la credencial es la vinculación del teléfono, y
 * vive en el disco de este servidor.
 */
const Entrada = z.object({
  nombre: z.string().trim().min(2, "Ponle un nombre al número").max(60),
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

  // Se conserva aunque ya no haya webhook: es la credencial con la que una
  // automatización externa avisa a /api/ai-sent de que un mensaje lo mandó
  // la IA. Sin ella, esos envíos se contarían como humanos.
  const webhookSecret = secretoAleatorio();

  let id: number;
  try {
    id = crearCanal(orgId, {
      nombre: datos.data.nombre,
      // El número real se conoce al escanear el QR, y hasta entonces hace falta
      // un valor distinto por canal: la columna es UNIQUE(org_id, phone).
      phone: `pendiente:${webhookSecret.slice(0, 10)}`,
      tokenCifrado: "",
      webhookSecret,
      whapiChannelId: null,
      estado: "iniciando",
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Ese número ya está conectado en esta cuenta." },
        { status: 409 },
      );
    }
    console.error("No se pudo crear el canal:", e);
    return NextResponse.json(
      { error: "No pudimos preparar el número. Intenta de nuevo." },
      { status: 500 },
    );
  }

  // Abrir el socket puede tardar un segundo largo; el QR se recoge sondeando,
  // así que aquí no se espera a que aparezca.
  void conectar(id);

  return NextResponse.json({ id, estado: "iniciando" });
}
