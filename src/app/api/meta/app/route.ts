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
import { revisarApp, revisarSuscripcionApp, urlDelWebhook } from "@/lib/meta/app";
import { urlDeVuelta } from "@/app/api/meta/oauth/entrar/route";
import { hayInstagramConectado } from "@/lib/db";
import { superadminApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;

  const app = await revisarApp();

  /*
   * A QUÉ AVISOS ESTÁ SUSCRITA LA APP, que es lo que contesta «los mensajes
   * entran y los comentarios no». Ver `revisarSuscripcionApp`: la suscripción
   * de la página —lo que comprueba el botón «Comprobar» de cada página— es solo
   * la mitad, y la otra mitad no se veía desde ninguna pantalla.
   *
   * Repara, como repara la de la página: la app de Facebook es de la
   * plataforma, así que nadie más puede arreglarlo.
   */
  /*
   * E INSTAGRAM, SI HAY ALGUNA CUENTA CONECTADA. Es otro objeto de la app con
   * su propia suscripción: sin ella no entra ni un directo de Instagram —ni los
   * de un anuncio— y la IA no tiene nada que contestar.
   */
  const webhook = await revisarSuscripcionApp(true, { instagram: hayInstagramConectado() });

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

  /*
   * EL WEBHOOK VA ANTES QUE LO DEMÁS CUANDO ESTÁ ROTO.
   *
   * Sin él no llega ni un evento, o llegan a medias. Una lista que empiece por
   * «publica una política de privacidad» mientras los comentarios se pierden
   * manda a arreglar lo que no está roto.
   */
  const antesDelWebhook = pendientes.length;

  if (webhook.leida && !webhook.callbackNuestra && webhook.callbackUrl) {
    pendientes.unshift(
      `Apuntar el webhook de la app a este servidor: entrega en ${webhook.callbackUrl} ` +
        `y tendría que ser ${webhook.callbackEsperada}. Va en tu app → Webhooks → Página.`,
    );
  } else if (webhook.faltan.length > 0) {
    pendientes.unshift(
      `Suscribir la app a ${webhook.faltan.join(", ")} en tu app → Webhooks → Página. ` +
        (webhook.error ? `Meta dijo: ${webhook.error}` : "") +
        (webhook.faltan.includes("feed")
          ? " Sin «feed» no llega ni un comentario, aunque los mensajes entren bien."
          : ""),
    );
  } else if (!webhook.leida && webhook.error) {
    pendientes.unshift(`Comprobar el webhook de la app: ${webhook.error}`);
  }

  /*
   * INSTAGRAM, JUSTO DETRÁS DE MESSENGER: lo mismo, en su propio objeto. Va en
   * segundo lugar si Messenger también tiene algo roto, y el primero si no.
   */
  const ig = webhook.instagram;
  let deInstagram: string | null = null;
  if (ig && ig.leida && !ig.callbackNuestra && ig.callbackUrl) {
    deInstagram =
      `Apuntar el webhook de Instagram a este servidor: entrega en ${ig.callbackUrl} ` +
      `y tendría que ser ${ig.callbackEsperada}. Va en tu app → Webhooks → Instagram.`;
  } else if (ig && ig.faltan.length > 0) {
    deInstagram =
      `Suscribir la app a ${ig.faltan.join(", ")} en tu app → Webhooks → Instagram. ` +
      "Sin «messages» no llega ningún directo de Instagram, tampoco los de un anuncio." +
      (ig.error ? ` Meta dijo: ${ig.error}` : "");
  } else if (ig && !ig.leida && ig.error) {
    deInstagram = `Comprobar el webhook de Instagram: ${ig.error}`;
  }
  if (deInstagram) {
    pendientes.splice(pendientes.length > antesDelWebhook ? 1 : 0, 0, deInstagram);
  }

  return NextResponse.json({
    ...app,
    webhook,
    urlDelWebhook: urlDelWebhook(),
    /*
     * La dirección de vuelta, que hay que dar de alta LETRA POR LETRA en la app
     * de Meta. Si no coincide, Facebook corta con «URL bloqueada» y el cliente
     * ve una pantalla de error de Facebook sin nada que pueda hacer.
     */
    urlDeVuelta: urlDeVuelta(),
    pendientes,
  });
}
