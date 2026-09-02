/**
 * El estado de la app de Facebook, para quien administra la plataforma.
 *
 * Es de la PLATAFORMA y no de una cuenta: la app de Meta es una sola y la
 * comparten todos los clientes. Por eso es de superadmin, como el resto del
 * diagnóstico técnico, y por eso no lleva `orgId` por ningún lado.
 *
 * Sale a la red, así que va en un botón y no en el pintado de la página: abrir
 * Messenger no puede costar dos llamadas a Meta cada vez.
 */
import { NextResponse } from "next/server";
import { revisarApp } from "@/lib/meta/app";
import { urlDeVuelta } from "@/app/api/meta/oauth/entrar/route";
import { superadminApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;

  const app = await revisarApp();

  /*
   * LO QUE LE FALTA PARA QUE CONECTE UN CLIENTE, EN ORDEN.
   *
   * No es una lista de comprobaciones bonita: es el orden real en que Meta las
   * exige. Saltarse una deja las siguientes sin sentido —pedir revisión sin
   * política de privacidad no se puede ni intentar— y quien lo lea necesita
   * saber por dónde empezar, no las siete cosas a la vez.
   */
  const pendientes: string[] = [];

  if (!app.credenciales) {
    pendientes.push(
      app.configuradas
        ? "Revisar META_APP_ID y META_APP_SECRET: están puestos, pero Meta no los reconoce " +
          "como una app suya. Cópialos otra vez de tu app (Configuración → Básica)."
        : "Poner META_APP_ID y META_APP_SECRET en el servidor con los de tu app de Facebook.",
    );
  } else {
    if (!app.politicaUrl) {
      pendientes.push(
        "Publicar una política de privacidad y ponerla en la app (Configuración → Básica). " +
          "Meta no deja ni pedir la revisión sin ella.",
      );
    }
    if (!app.terminosUrl) {
      pendientes.push(
        "Añadir los términos del servicio en esa misma pantalla de la app.",
      );
    }
  }

  return NextResponse.json({
    ...app,
    /*
     * La dirección de vuelta, que hay que dar de alta LETRA POR LETRA en la app
     * de Meta. Si no coincide, Facebook corta con «URL bloqueada» y el cliente
     * ve una pantalla de error de Facebook sin nada que pueda hacer.
     */
    urlDeVuelta: urlDeVuelta(),
    pendientes,
  });
}
