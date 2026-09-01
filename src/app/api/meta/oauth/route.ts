/**
 * El botón de «Entrar con Facebook», por dentro.
 *
 * Dos llamadas, y en este orden:
 *
 *   POST  — llega el código de la ventana de Meta. Se cambia por un token, se
 *           preguntan las páginas que administra esa persona y se devuelve la
 *           LISTA, sin tokens.
 *   PUT   — llega la página elegida. El token se saca de la memoria corta del
 *           servidor, nunca del cuerpo de la petición.
 *
 * Que el PUT no acepte un token es la decisión de seguridad de todo el módulo:
 * si lo aceptara, cualquiera podría conectar la página de otro mandando un
 * token suyo, y el `orgId` de la sesión no serviría de nada.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { listarPaginasMeta } from "@/lib/db";
import { conectarPagina } from "@/lib/meta/conectar";
import type { PaginaDisponible } from "@/lib/meta/login";
import {
  intercambiarCodigo,
  olvidarPaginas,
  paginaRecordada,
  paginasDelUsuario,
  recordarPaginas,
} from "@/lib/meta/login";
import { sesionApi } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Entrada = z.object({
  /* El camino normal: la ventana devuelve un código. */
  code: z.string().trim().min(10).optional(),
  /*
   * El camino de respaldo. Sin una configuración de Business Login, el SDK
   * devuelve directamente un token de usuario en vez de un código. Vale igual
   * para preguntar las páginas, y así el botón funciona aunque falte
   * META_LOGIN_CONFIG_ID.
   */
  token: z.string().trim().min(20).optional(),
});

const Elegida = z.object({
  pageId: z.string().trim().regex(/^\d{5,}$/, "El identificador de la página son solo dígitos"),
});

export async function POST(req: Request) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cuerpo = Entrada.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success || (!cuerpo.data.code && !cuerpo.data.token)) {
    return NextResponse.json({ error: "La ventana de Facebook no devolvió nada útil." }, { status: 400 });
  }

  let disponibles: PaginaDisponible[];
  try {
    const token = cuerpo.data.code
      ? await intercambiarCodigo(cuerpo.data.code)
      : (cuerpo.data.token as string);

    disponibles = await paginasDelUsuario(token);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meta no respondió" },
      { status: 400 },
    );
  }

  if (disponibles.length === 0) {
    return NextResponse.json(
      {
        error:
          "Esa cuenta de Facebook no administra ninguna página, o no le diste acceso a ninguna " +
          "en la ventana. Vuelve a pulsar el botón y marca la página.",
      },
      { status: 400 },
    );
  }

  recordarPaginas(orgId, disponibles);

  // Ya conectadas: se enseñan igual, apagadas, para que quede claro que están
  // y no parezca que la ventana se dejó una.
  const yaEstan = new Set(listarPaginasMeta(orgId).map((c) => c.phone));

  return NextResponse.json({
    paginas: disponibles.map((p) => ({
      pageId: p.pageId,
      nombre: p.nombre,
      tieneInstagram: p.igUserId !== null,
      conectada: yaEstan.has(p.pageId),
    })),
  });
}

export async function PUT(req: Request) {
  const s = await sesionApi();
  if (!s.ok) return s.respuesta;
  const { orgId } = s.ctx;

  const cuerpo = Elegida.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json(
      { error: cuerpo.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const pagina = paginaRecordada(orgId, cuerpo.data.pageId);
  if (!pagina) {
    return NextResponse.json(
      { error: "La sesión con Facebook caducó. Vuelve a pulsar «Entrar con Facebook»." },
      { status: 410 },
    );
  }

  const r = await conectarPagina(orgId, pagina.pageId, pagina.token);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.estado });

  // El token ya está guardado y cifrado en su canal: en memoria no pinta nada.
  olvidarPaginas(orgId);

  return NextResponse.json(r);
}
