/**
 * SalesDash — de un pin del mapa a una dirección que alguien pueda leer.
 *
 * UN PIN NO ES UNA DIRECCIÓN
 *
 * El cliente manda su ubicación y llegaban dos números. Con eso, ni el agente
 * puede confirmar nada —«¿es en Juan Díaz?»— ni quien despacha el pedido sabe a
 * qué provincia va, y la conversación termina como empezó: pidiéndole la
 * dirección entera por escrito a alguien que creía habérsela dado ya.
 *
 * Aquí las coordenadas se convierten en provincia, distrito, barrio y calle. Lo
 * que sigue faltando —el número de casa, el apartamento, el punto de
 * referencia— es lo único que hay que preguntar, y eso cambia una conversación
 * de cinco mensajes por una de uno.
 *
 * DE DÓNDE SALE. De Nominatim (OpenStreetMap), que es gratuito y no pide clave.
 * `GEOCODIFICADOR_URL` permite apuntar a otro servicio compatible —uno propio o
 * uno de pago— sin tocar el código.
 *
 * TRES COSAS QUE NO SE NEGOCIAN, y las tres están aquí por lo que costaron:
 *
 *   1. NUNCA HACE ESPERAR A UN CLIENTE. Tiene presupuesto de tiempo y, si no
 *      llega, el agente contesta con lo que tenga. Una respuesta sin la calle
 *      es infinitamente mejor que un silencio de treinta segundos.
 *   2. NUNCA LANZA. Un servicio caído no puede dejar sin contestar a nadie.
 *   3. SE PREGUNTA UNA VEZ POR SITIO. Las coordenadas de un cliente se repiten
 *      —vuelve a mandar la misma ubicación, o escribe otra vez desde su casa— y
 *      la política de uso de Nominatim es de una petición por segundo.
 *
 * SOBRE LOS DATOS DEL CLIENTE: esto manda unas coordenadas a un servicio de
 * fuera. No va el teléfono, ni el nombre, ni nada del pedido: solo el punto. Y
 * solo ocurre en los canales que tengan encendido «comprobar la ubicación del
 * mapa»; apagado, no sale ni una petición.
 */

export interface DireccionAproximada {
  /** ISO 3166-1 alfa-2 en minúsculas, según el propio servicio. */
  pais: string | null;
  /** Provincia, estado o departamento. */
  provincia: string | null;
  /** Distrito, cantón o municipio. */
  distrito: string | null;
  /** Barrio, corregimiento o sector: en la práctica, el dato que más sitúa. */
  barrio: string | null;
  calle: string | null;
  /** Todo junto y en orden de lectura, para enseñarlo tal cual. */
  texto: string;
}

const URL_BASE =
  process.env.GEOCODIFICADOR_URL ?? "https://nominatim.openstreetmap.org/reverse";

/**
 * Nominatim exige un User-Agent que identifique a la aplicación. Uno genérico
 * es motivo de bloqueo, y el bloqueo se vería aquí como «no hay dirección»
 * durante días sin que nadie supiera por qué.
 */
const AGENTE = `SalesDash/1.0 (${process.env.APP_URL ?? "https://salesdash.local"})`;

/** Lo que se espera como mucho. Hay un cliente mirando la pantalla. */
const TIMEOUT_MS = 4_000;

/**
 * Cuántos decimales se usan para reconocer «el mismo sitio».
 *
 * Cuatro son unos once metros: dos pines de la misma casa caen en la misma
 * casilla y se resuelven una sola vez.
 */
const DECIMALES = 4;

const cache = new Map<string, DireccionAproximada | null>();
const cacheBusqueda = new Map<string, DireccionAproximada | null>();
/** Tope de la caché. Es de proceso y no puede crecer sin fin. */
const MAX_CACHE = 500;

/**
 * La cola de un carril.
 *
 * La política de Nominatim es de UNA petición por segundo. Sin esto, un lote de
 * mensajes con tres ubicaciones dispararía tres peticiones a la vez y acabaría
 * con la instancia bloqueada para todo el servidor.
 */
let ultima: Promise<unknown> = Promise.resolve();
const ESPERA_ENTRE_MS = 1_100;

function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const salida = ultima.then(tarea, tarea);
  ultima = salida.then(
    () => new Promise((r) => setTimeout(r, ESPERA_ENTRE_MS)),
    () => new Promise((r) => setTimeout(r, ESPERA_ENTRE_MS)),
  );
  return salida;
}

interface RespuestaNominatim {
  address?: {
    road?: string;
    pedestrian?: string;
    neighbourhood?: string;
    quarter?: string;
    suburb?: string;
    city_district?: string;
    village?: string;
    town?: string;
    city?: string;
    county?: string;
    state?: string;
    country_code?: string;
  };
}

interface ResultadoBusquedaNominatim {
  lat?: string;
  lon?: string;
  address?: RespuestaNominatim["address"];
}

function urlDeBusqueda(): string {
  if (process.env.GEOCODIFICADOR_BUSQUEDA_URL) return process.env.GEOCODIFICADOR_BUSQUEDA_URL;
  return URL_BASE.replace(/\/reverse\/?$/, "/search");
}

/**
 * Ordena lo que devuelve el servicio, que no llama igual a las cosas en cada
 * país: lo que en Panamá es `suburb` en Costa Rica es `city_district` y en
 * República Dominicana `neighbourhood`. Se coge el primero que venga.
 */
function ordenar(d: RespuestaNominatim["address"]): DireccionAproximada | null {
  if (!d) return null;

  const primero = (...valores: (string | undefined)[]) =>
    valores.find((v) => v?.trim())?.trim() ?? null;

  const direccion: DireccionAproximada = {
    pais: d.country_code?.toLowerCase() ?? null,
    provincia: primero(d.state, d.county),
    distrito: primero(d.county, d.city_district, d.town, d.city),
    barrio: primero(d.neighbourhood, d.quarter, d.suburb, d.village),
    calle: primero(d.road, d.pedestrian),
    texto: "",
  };

  /*
   * De lo pequeño a lo grande, que es como se dice una dirección aquí y como la
   * lee quien va a entregar. Sin repetir: en muchos sitios el distrito y la
   * ciudad son la misma palabra.
   */
  const partes = [direccion.calle, direccion.barrio, direccion.distrito, direccion.provincia]
    .filter((p): p is string => !!p)
    .filter((p, i, todas) => todas.indexOf(p) === i);

  if (partes.length === 0) return null;

  direccion.texto = partes.join(", ");
  return direccion;
}

/**
 * La dirección aproximada de un punto, o null.
 *
 * Null significa «no se pudo saber» y es una respuesta perfectamente válida:
 * quien llame sigue teniendo las coordenadas y el enlace al mapa.
 */
export async function describirPunto(
  lat: number,
  lng: number,
  opciones: { timeoutMs?: number } = {},
): Promise<DireccionAproximada | null> {
  const clave = `${lat.toFixed(DECIMALES)},${lng.toFixed(DECIMALES)}`;
  if (cache.has(clave)) return cache.get(clave)!;

  const url =
    `${URL_BASE}?format=jsonv2&lat=${lat}&lon=${lng}` +
    `&zoom=18&addressdetails=1&accept-language=es`;

  try {
    const direccion = await enCola(async () => {
      const r = await fetch(url, {
        headers: { "User-Agent": AGENTE, accept: "application/json" },
        signal: AbortSignal.timeout(opciones.timeoutMs ?? TIMEOUT_MS),
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`el geocodificador respondió ${r.status}`);
      return ordenar(((await r.json()) as RespuestaNominatim).address);
    });

    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(clave, direccion);
    return direccion;
  } catch (e) {
    /*
     * No se cachea el fallo: un servicio caído hoy funciona mañana, y guardar
     * el null dejaría a ese cliente sin dirección para siempre.
     */
    console.error(
      `[mapa] no se pudo describir el punto ${clave}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Busca una dirección escrita por el cliente y devuelve su zona administrativa.
 * Se usa para cotizar el envío cuando no llegó un pin de WhatsApp.
 */
export async function geocodificarDireccion(
  texto: string,
  codigoPais: string | null = null,
  opciones: { timeoutMs?: number } = {},
): Promise<DireccionAproximada | null> {
  const limpio = texto.trim().replace(/\s+/g, " ");
  if (limpio.length < 8) return null;

  const claveBusqueda = `${codigoPais ?? ""}|${limpio.toLowerCase()}`;
  if (cacheBusqueda.has(claveBusqueda)) return cacheBusqueda.get(claveBusqueda)!;

  const params = new URLSearchParams({
    q: limpio,
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
    "accept-language": "es",
  });
  if (codigoPais) params.set("countrycodes", codigoPais);

  try {
    const direccion = await enCola(async () => {
      const r = await fetch(`${urlDeBusqueda()}?${params}`, {
        headers: { "User-Agent": AGENTE, accept: "application/json" },
        signal: AbortSignal.timeout(opciones.timeoutMs ?? TIMEOUT_MS),
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`el geocodificador respondió ${r.status}`);
      const resultados = (await r.json()) as ResultadoBusquedaNominatim[];
      return ordenar(resultados[0]?.address);
    });

    if (cacheBusqueda.size >= MAX_CACHE) cacheBusqueda.clear();
    cacheBusqueda.set(claveBusqueda, direccion);
    return direccion;
  } catch (e) {
    console.error(
      `[mapa] no se pudo buscar la dirección «${limpio.slice(0, 80)}»:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** Para las pruebas. */
export function _vaciarCache(): void {
  cache.clear();
  cacheBusqueda.clear();
}
