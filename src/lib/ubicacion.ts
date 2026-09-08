/**
 * SalesDash — la ubicación que manda el cliente.
 *
 * En una venta con entrega a domicilio, el pin del mapa ES la dirección. El
 * cliente escribe media conversación y al final manda su ubicación en vez de
 * teclear la calle, y hasta ahora eso entraba en el hilo como
 * «[locationMessage]»: un agujero justo donde está el dato que necesita quien
 * despacha el pedido, y una dirección que el analista no podía leer.
 *
 * Vive en su propio módulo, sin Baileys dentro, por dos razones: lo usan tres
 * sitios que no se conocen entre sí —el traductor del socket, la burbuja del
 * hilo y el informe— y así se puede probar sin levantar medio WhatsApp.
 */
import { ciudadMasCercana, dentroDelPais, obtenerPais } from "./paises";
import type { DireccionAproximada } from "./geocodificacion";

/**
 * Con qué empieza el texto de una ubicación en el hilo.
 *
 * Es una marca y no una columna nueva a propósito: el tipo de mensaje se
 * guarda con un CHECK en la tabla y añadirle un valor obliga a reescribirla
 * entera. La marca viaja dentro del texto, que es lo que ya leen el analista,
 * la vista previa de la bandeja y el informe, así que la ubicación aparece en
 * los tres sin tocar ninguno.
 */
export const MARCA_UBICACION = "[ubicación]";

export interface Ubicacion {
  latitud?: number | null;
  longitud?: number | null;
  nombre?: string | null;
  direccion?: string | null;
  /** WhatsApp también manda ubicación en vivo, que se va actualizando. */
  enVivo?: boolean;
}

/** Coordenadas de verdad: dentro del planeta y distintas del cero. */
function validas(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  /*
   * (0, 0) está en el Atlántico, frente a Ghana. Nadie pide un domicilio ahí:
   * cuando aparece es que el mensaje venía sin coordenadas y alguien las
   * rellenó con ceros. Un enlace a mitad del océano es peor que ninguno,
   * porque el que despacha se fía de él.
   */
  return !(lat === 0 && lng === 0);
}

/** El enlace al mapa, o null si las coordenadas no sirven. */
export function enlaceDeMapa(lat: unknown, lng: unknown): string | null {
  if (!validas(lat, lng)) return null;
  return `https://www.google.com/maps?q=${lat},${lng as number}`;
}

/**
 * El texto que se guarda en el hilo.
 *
 * Lleva el nombre del sitio y la dirección cuando WhatsApp los manda, porque
 * eso es lo que el analista necesita leer para saber si el pedido ya tiene
 * dirección o le falta. Las coordenadas NO van en el texto: no le dicen nada a
 * nadie y ensucian la vista previa de la bandeja; su sitio es el enlace.
 */
export function textoDeUbicacion(u: Ubicacion): string {
  const partes = [u.nombre?.trim(), u.direccion?.trim()].filter(
    (p): p is string => !!p && p.length > 0,
  );

  // El nombre a veces ES la dirección: repetirla dos veces no aporta.
  const unicas = partes.filter((p, i) => partes.indexOf(p) === i);

  const marca = u.enVivo ? `${MARCA_UBICACION} en vivo` : MARCA_UBICACION;
  return unicas.length ? `${marca} ${unicas.join(" · ")}` : marca;
}

/** ¿Este mensaje es una ubicación? */
export function esUbicacion(contenido: string | null | undefined): boolean {
  return !!contenido?.startsWith(MARCA_UBICACION);
}

/** Lo que se enseña de una ubicación, sin la marca. */
export function textoSinMarca(contenido: string): string {
  const sinMarca = contenido.slice(MARCA_UBICACION.length).replace(/^\s*en vivo/, "").trim();
  return sinMarca || "Ubicación enviada por el cliente";
}

// ─────────────────────────────────────────────────────────────────────────────
// Validar el pin — que la dirección de entrega exista de verdad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las coordenadas, recuperadas del enlace que se guardó.
 *
 * El pin entra por `enlaceDeMapa` y se guarda en `media_url` como una URL de
 * Google Maps; las coordenadas no tienen columna propia. Sacarlas de vuelta del
 * enlace evita una migración para un dato que ya está guardado, y como el
 * enlace lo escribe esta misma casa, el formato es conocido y estable.
 *
 * Se vuelve a validar lo que sale: la columna la puede haber escrito una
 * versión anterior, o un canal de Meta con otro formato de enlace.
 */
export function coordenadasDeEnlace(url: string | null | undefined): { lat: number; lng: number } | null {
  if (!url) return null;

  const m = /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
  if (!m) return null;

  const lat = Number(m[1]);
  const lng = Number(m[2]);

  return validas(lat, lng) ? { lat, lng } : null;
}

/**
 * QUÉ SE LE DICE AL AGENTE CUANDO EL CLIENTE MANDA SU UBICACIÓN.
 *
 * Un pin no es una dirección hasta que alguien lo mira. Los tres casos que
 * importan, y los tres pasan de verdad:
 *
 *   1. El pin está donde tiene que estar. Entonces el agente puede CONFIRMAR la
 *      zona —«perfecto, por Santiago»— en vez de volver a pedir la dirección
 *      entera, que es lo que hacía y lo que hace que el cliente se canse.
 *   2. El pin cae en otro país. Casi siempre es un cliente que mandó una
 *      ubicación vieja o el sitio donde estaba de viaje, no donde quiere el
 *      pedido. Hay que preguntarlo, no despachar ahí.
 *   3. Las coordenadas no sirven. Ahí no hay pin: el mensaje se queda como está
 *      y el agente pide la dirección escrita, como toda la vida.
 *
 * El pin NUNCA sustituye a la dirección escrita: sitúa la zona y nada más. Un
 * mensajero no entrega en unas coordenadas, entrega en una casa con señas, y en
 * Costa Rica la dirección ES la referencia. Por eso el bloque siempre acaba
 * pidiendo las señas.
 */
export interface UbicacionValidada {
  lat: number;
  lng: number;
  enlace: string;
  /** El país del canal reconoce el punto como suyo. Null si no hay país puesto. */
  dentroDelPais: boolean | null;
  /** La ciudad conocida más cercana, cuando hay país con el que compararla. */
  zona: { nombre: string; km: number } | null;
  /** Lo que el cliente escribió con el pin, si escribió algo. */
  descripcion: string | null;
  /**
   * PROVINCIA, DISTRITO, BARRIO Y CALLE del punto, sacadas de las coordenadas.
   *
   * Es lo que convierte «me mandó un pin» en «va a Juan Díaz, Provincia de
   * Panamá». Null cuando no se pudo averiguar —o cuando no se pidió—, y ahí
   * todo sigue funcionando como antes: se sitúa por la ciudad más cercana.
   */
  direccion?: DireccionAproximada | null;
}

export function validarUbicacion(
  contenido: string,
  mediaUrl: string | null,
  /** El código del país del canal. Sin él solo se comprueba que el pin sirva. */
  codigoPais: string | null,
): UbicacionValidada | null {
  if (!esUbicacion(contenido)) return null;

  const punto = coordenadasDeEnlace(mediaUrl);
  if (!punto) return null;

  const pais = obtenerPais(codigoPais);
  const descripcion = textoSinMarca(contenido);

  return {
    ...punto,
    enlace: enlaceDeMapa(punto.lat, punto.lng)!,
    dentroDelPais: pais ? dentroDelPais(pais, punto.lat, punto.lng) : null,
    zona: pais ? ciudadMasCercana(pais, punto.lat, punto.lng) : null,
    descripcion: descripcion === "Ubicación enviada por el cliente" ? null : descripcion,
  };
}

/** El bloque que se le añade al prompt del agente. Lo lee un modelo. */
export function ubicacionParaModelo(u: UbicacionValidada, nombrePais: string | null): string {
  const lineas = ["EL CLIENTE ACABA DE MANDAR SU UBICACIÓN EN EL MAPA."];

  if (u.descripcion) lineas.push(`Lo que trae el pin: ${u.descripcion}`);

  if (u.dentroDelPais === false && nombrePais) {
    /*
     * Fuera del país. Es el caso en el que un agente que se fía del pin manda
     * el pedido a la nada: casi siempre es una ubicación vieja del móvil, o el
     * sitio donde el cliente estaba de viaje.
     */
    lineas.push(
      `AVISO: ese punto NO está en ${nombrePais}, que es donde vendes. No lo des por bueno ` +
        "ni lo uses como dirección de entrega. Pregúntale con naturalidad si es ahí donde quiere " +
        "recibir el pedido, y si no, pídele la dirección de entrega.",
    );
    return lineas.join("\n");
  }

  /*
   * LA DIRECCIÓN DE VERDAD, si se pudo sacar de las coordenadas. Es lo que
   * convierte «me mandó un pin» en «va a Juan Díaz, Provincia de Panamá», y lo
   * que permite pedir SOLO lo que falta en vez de la dirección entera.
   */
  const d = u.direccion;

  if (d) {
    lineas.push(`Dónde cae ese punto: ${d.texto}.`);

    const detalle = [
      d.provincia && `provincia o estado: ${d.provincia}`,
      d.distrito && `distrito o cantón: ${d.distrito}`,
      d.barrio && `barrio o corregimiento: ${d.barrio}`,
      d.calle && `calle: ${d.calle}`,
    ].filter(Boolean);

    if (detalle.length > 1) lineas.push(`Desglosado — ${detalle.join("; ")}.`);
  } else if (u.zona) {
    const km = u.zona.km;
    const cerca =
      km < 3
        ? `en ${u.zona.nombre}`
        : km < 25
          ? `cerca de ${u.zona.nombre}, a unos ${Math.round(km)} km`
          : `en la zona de ${u.zona.nombre}, a unos ${Math.round(km)} km`;

    lineas.push(`El punto cae ${cerca}. La zona es válida para entregar.`);
  } else {
    lineas.push("El punto tiene coordenadas válidas.");
  }

  /*
   * EL PIN ES LA DIRECCIÓN, Y NO SE LE PIDE NADA MÁS.
   *
   * Esta es la diferencia entre una conversación de un mensaje y una de cinco.
   * El cliente cree que mandando el pin ya dio su dirección —y la dio—; volver
   * a pedirle un dato más le dice que no sirvió de nada.
   *
   * Aquí se pedía «lo que un mapa no puede dar»: el número de casa, el
   * apartamento y la seña de la puerta. Sonaba razonable y costaba ventas: la
   * dueña de República Dominicana lo paró con un caso delante —«Perfecto, Los
   * Coquitos. ¿Me puede decir el número de casa o apartamento y alguna seña
   * para reconocer la puerta?»— y es lo que los tres países ya decían en su
   * bloque: se da por buena, se dice el envío y se sigue. Lo caro no es una
   * dirección con menos detalle: es la venta que se pierde pidiéndolo, y el
   * mensajero llama por teléfono, que sí se pide.
   */
  const sitio = d?.barrio ?? d?.distrito ?? u.zona?.nombre ?? null;

  lineas.push(
    (sitio
      ? `Confírmale la zona con naturalidad —algo como «perfecto, ${sitio}»—. `
      : "") +
      "ESA ES SU DIRECCIÓN: la das por buena y NO le pides ni un dato más de ella. Nada de " +
      "preguntarle el número de casa, el apartamento, el piso, una seña para reconocer la puerta, " +
      "el color de la casa ni un punto de referencia, y nada de pedirle que la confirme o que la " +
      "repita escrita. Le dices de una vez cuánto le sale el envío a esa zona y sigues con el dato " +
      "que falte del pedido.",
  );

  return lineas.join("\n");
}

/**
 * La ubicación escrita para el HILO: lo que ven el vendedor, el analista y el
 * informe. Sustituye al texto que trajo WhatsApp, que muchas veces es solo la
 * marca pelada.
 *
 * Va dentro del contenido del mensaje y no en una columna nueva, por lo mismo
 * que la marca: es lo que ya leen los tres sitios sin tocar ninguno.
 */
export function textoDeUbicacionResuelta(
  contenido: string,
  d: DireccionAproximada,
): string {
  const enVivo = contenido.startsWith(`${MARCA_UBICACION} en vivo`);
  const traia = textoSinMarca(contenido);
  const suyo = traia === "Ubicación enviada por el cliente" ? null : traia;

  /*
   * La dirección calculada primero, y detrás lo que el cliente puso con el pin:
   * si escribió «casa de mi mamá», eso es información que el mapa no tiene y no
   * se puede perder. Solo se descarta cuando repite lo que ya dice la dirección.
   */
  const partes = [d.texto, suyo !== d.texto ? suyo : null].filter((x): x is string => !!x);

  const marca = enVivo ? `${MARCA_UBICACION} en vivo` : MARCA_UBICACION;
  return `${marca} ${partes.join(" · ")}`;
}

