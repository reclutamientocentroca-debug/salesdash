/**
 * SalesDash — lo que el agente sabe del país en el que vende.
 *
 * UN AGENTE POR CANAL, Y CADA CANAL EN SU PAÍS
 *
 * El mismo negocio tiene un WhatsApp en República Dominicana, otro en Costa
 * Rica y otro en Panamá. No son tres copias del mismo vendedor: son tres
 * vendedores distintos, y lo que los separa no es el idioma sino todo lo demás.
 *
 * Un agente que le dice «son 1.500 pesos» a un tico, o que le pide «la calle y
 * el número» a alguien de San José —donde las direcciones se dan por
 * referencias, «200 metros norte de la iglesia»—, o que ofrece pagar contra
 * entrega en Costa Rica cuando ahí se cobra por SINPE por adelantado, se delata
 * en el primer mensaje. El cliente no piensa «qué mal configurado está el bot»:
 * piensa que la tienda no es de aquí, y no compra.
 *
 * Todo eso vive AQUÍ, escrito una vez, y no en las instrucciones que escribe el
 * dueño. Las instrucciones son de su negocio —qué vende, cómo cobra, qué no
 * puede prometer— y no tienen por qué repetir cómo se llama la moneda o cómo
 * se dan las direcciones en su propio país. Elegir el país en el canal es lo
 * único que hace falta.
 *
 * Lo que hay aquí es DESCRIPTIVO, no normativo: le dice al modelo cómo se
 * habla y se compra en ese país para que suene natural. El precio, el envío y
 * las condiciones siguen saliendo del catálogo y de las instrucciones del
 * negocio, y ninguna línea de este archivo autoriza a inventarse ninguno.
 */

/** Un punto conocido del país, para poder situar un pin del mapa. */
interface Ciudad {
  nombre: string;
  lat: number;
  lng: number;
}

export interface Pais {
  /** ISO 3166-1 alfa-2, en minúsculas. */
  codigo: string;
  nombre: string;
  bandera: string;
  /**
   * EL COLOR CON EL QUE EL PANEL VISTE ESTE PAÍS.
   *
   * No sale de la bandera, y no es un descuido: las tres banderas son azul,
   * rojo y blanco, así que copiarlas dejaría tres países del mismo color y el
   * color no serviría para nada. Lo que hace falta es que se distingan de un
   * vistazo —que quien tiene tres números abiertos sepa en cuál está sin leer
   * el nombre—, y para eso hacen falta tres tonos separados.
   *
   * Va como dato del país y no como una tabla en el CSS porque el país nace
   * aquí: añadir el cuarto tiene que ser una entrada en este archivo y nada
   * más.
   */
  color: string;
  moneda: {
    codigo: string;
    /** Como lo escribe la gente del país, no como lo escribe un banco. */
    simbolo: string;
    nombre: string;
    /** Un importe de ejemplo, ya escrito como allí se escribe. */
    ejemplo: string;
  };
  /** Prefijo internacional, escrito para leerlo una persona. */
  prefijo: string;
  /**
   * Con qué empieza un número de este país, para reconocerlo por el prefijo.
   *
   * Son varios y no uno porque República Dominicana comparte el código +1 con
   * media América: lo que la identifica es el código de área —809, 829, 849—,
   * no el 1. Por eso aquí van los prefijos COMPLETOS y no el código de país:
   * con solo el 1, un número de Miami entraría como dominicano.
   */
  prefijosTelefono: string[];
  husoHorario: string;
  /** De usted, de tú o de vos. Es lo primero que delata a un agente de fuera. */
  tratamiento: string;
  /**
   * CON QUÉ ABRE LA CONVERSACIÓN, que es la única frase que sale siempre.
   *
   * No es lo mismo en los tres y por eso vive aquí: Santo Domingo abre con la
   * tienda, San José con el nombre de quien atiende y Panamá con el «Hola, le
   * asiste X de Tienda», que lleva la tienda delante. Cambiarlo en un país no
   * puede cambiárselo a los otros dos.
   *
   * Y tiene que decir LO MISMO que el archivo del país (`src/agents/paises`),
   * que es de donde sale el saludo que se le manda al modelo: de aquí sale el
   * ejemplo que el panel le enseña al dueño, y un ejemplo que no coincide con
   * lo que el cliente lee enseña a no fiarse del panel.
   *
   * `<agente>` es el nombre que el dueño puso en el panel y `<negocio>` el de
   * la tienda. Van con marcador y NUNCA con un nombre escrito: un nombre propio
   * dentro del prompt acaba siendo el de todos los clientes.
   */
  saludo: string;
  /** Cómo se habla ahí. Sirve para sonar natural, no para imitar un acento. */
  expresiones: string[];
  /** Provincias, cantones y barrios que se nombran al dar una dirección. */
  zonas: string[];
  /**
   * Dónde entrega un mensajero propio en el día, frente al resto del país.
   *
   * No es geografía: es la línea que parte la tarifa de envío en dos. En
   * República Dominicana, al Gran Santo Domingo y Santiago va un motorista y
   * cobra una cosa; al interior sale por Caribe Express y cobra otra. Cobrar la
   * primera por un pedido de la segunda es perder dinero en cada venta del
   * interior. Ver `envio.ts`.
   */
  zonasCercanas: string[];
  /** Cómo se dan las direcciones. En Costa Rica esto lo cambia TODO. */
  direcciones: string;
  /**
   * SIN ESTO NO SE LEVANTA UNA ORDEN, y no es lo mismo en los tres.
   *
   * En República Dominicana un pedido se despacha con el sector y la provincia;
   * en Panamá hace falta el corregimiento; en Costa Rica no hay calle que pedir
   * —van las señas— y además el dinero entra ANTES de que salga el paquete.
   * Cerrar sin uno de estos datos es un paquete que vuelve, y el que vuelve se
   * paga dos veces.
   *
   * Va al prompt pegado a las reglas de cierre, así que vale aunque el número
   * no tenga ningún guion escrito.
   */
  datosParaCerrar: string[];
  /**
   * SIN ESTO NO SE LEVANTA UNA ORDEN, y no es lo mismo en los tres.
   *
   * En República Dominicana un pedido se despacha con el sector y la provincia;
   * en Panamá hace falta el corregimiento; en Costa Rica no hay calle que pedir
   * —van las señas— y además el dinero entra ANTES de que salga el paquete.
   * Cerrar sin uno de estos datos es un paquete que vuelve, y el que vuelve se
   * paga dos veces.
   *
   * Va al prompt pegado a las reglas de cierre, así que vale aunque el número
   * no tenga ningún guion escrito.
   */
  /** Cómo llega un pedido y quién lo lleva. */
  entrega: string[];
  /** Con qué paga la gente. Yappy, SINPE y tPago no son intercambiables. */
  pagos: string[];
  /** La caja que contiene al país, para validar un pin del mapa. */
  caja: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  ciudades: Ciudad[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Los tres países
// ─────────────────────────────────────────────────────────────────────────────

const REPUBLICA_DOMINICANA: Pais = {
  codigo: "do",
  nombre: "República Dominicana",
  bandera: "🇩🇴",
  // El azul, que es el que manda en su bandera y en su escudo.
  color: "#1552a8",
  moneda: {
    codigo: "DOP",
    simbolo: "RD$",
    nombre: "peso dominicano",
    ejemplo: "RD$1,500",
  },
  prefijo: "+1 (809 / 829 / 849)",
  prefijosTelefono: ["1809", "1829", "1849"],
  husoHorario: "America/Santo_Domingo",
  tratamiento:
    "Se tutea con naturalidad, incluso vendiendo. El usted suena distante salvo con gente mayor.",
  // El mismo de `src/agents/paises/rd.ts`, que es el que lee el cliente.
  saludo: "Hola! Bienvenido(a) a <negocio>. Gracias por escribirnos.",
  expresiones: [
    "«dime» o «dime a ver» para invitar a que sigan hablando",
    "«a la orden» al despedirse o al confirmar",
    "«ahora mismo» o «ahorita» para algo inmediato",
    "«claro que sí» para confirmar",
    "«chequea» para pedir que revisen algo",
  ],
  /*
   * El Gran Santo Domingo y nada más.
   *
   * Santiago se queda fuera a propósito, aunque tenga mensajería: la tarifa que
   * cobran estos negocios es «capital» contra «interior», y meter Santiago en
   * la de capital le cobraría de menos a cada pedido del Cibao. Si alguien
   * entrega allí al mismo precio, lo dice en sus instrucciones.
   */
  zonasCercanas: [
    "Distrito Nacional",
    "Santo Domingo",
  ],
  zonas: [
    "Distrito Nacional",
    "Santo Domingo Este",
    "Santo Domingo Norte",
    "Santo Domingo Oeste",
    "Santiago",
    "La Vega",
    "San Cristóbal",
    "Puerto Plata",
    "San Pedro de Macorís",
    "La Romana",
    "Higüey",
    "Punta Cana y Bávaro",
    "Moca",
    "Bonao",
    "Baní",
    "San Francisco de Macorís",
  ],
  direcciones:
    "Se dan por calle y número, con el sector detrás y la provincia al final: «calle Duarte #45, " +
    "Los Prados, Santo Domingo, Distrito Nacional». Los dos datos que sitúan un pedido son la " +
    "PROVINCIA —de ella depende si lo lleva el mensajero o sale por Caribe Express— y el SECTOR, " +
    "porque sin él dos calles con el mismo nombre están a media hora una de otra. En los edificios " +
    "hace falta el nombre y el apartamento. Con calle, sector y provincia ya se despacha: lo demás " +
    "—punto de referencia, color de la casa— ayuda, pero no se exige.",
  datosParaCerrar: [
    "El nombre completo de quien recibe el pedido",
    "La dirección con calle y número, EL SECTOR y LA PROVINCIA: sin sector, dos calles con el " +
      "mismo nombre están a media hora una de otra",
    "En un edificio, además el nombre del edificio y el apartamento",
  ],
  entrega: [
    "En el Gran Santo Domingo y Santiago, mensajero propio en 24–48 horas",
    "Al interior, por Caribe Express, Vimenca o Deprisa: el cliente retira en la sucursal de su pueblo",
    "El pago contra entrega es lo normal y el cliente lo da por hecho",
  ],
  pagos: [
    "Efectivo contra entrega, lo más común",
    "Transferencia bancaria (Banreservas, Popular, BHD)",
    "tPago",
    "Tarjeta de crédito",
  ],
  caja: { latMin: 17.4, latMax: 20.1, lngMin: -72.1, lngMax: -68.2 },
  ciudades: [
    { nombre: "Santo Domingo", lat: 18.4861, lng: -69.9312 },
    { nombre: "Santiago de los Caballeros", lat: 19.4517, lng: -70.697 },
    { nombre: "San Cristóbal", lat: 18.4167, lng: -70.1 },
    { nombre: "La Vega", lat: 19.2214, lng: -70.5288 },
    { nombre: "San Pedro de Macorís", lat: 18.4539, lng: -69.297 },
    { nombre: "La Romana", lat: 18.4273, lng: -68.9728 },
    { nombre: "Higüey", lat: 18.6157, lng: -68.708 },
    { nombre: "Punta Cana", lat: 18.5601, lng: -68.3725 },
    { nombre: "Puerto Plata", lat: 19.7934, lng: -70.6884 },
    { nombre: "San Francisco de Macorís", lat: 19.3009, lng: -70.2529 },
    { nombre: "Barahona", lat: 18.2085, lng: -71.1008 },
  ],
};

const COSTA_RICA: Pais = {
  codigo: "cr",
  nombre: "Costa Rica",
  bandera: "🇨🇷",
  // Verde: no está en su bandera —es azul, blanco y rojo, como las otras dos—
  // y por eso mismo sirve para separarla de un vistazo del dominicano.
  color: "#0e7f66",
  moneda: {
    codigo: "CRC",
    simbolo: "₡",
    nombre: "colón",
    // El punto separa los miles, no la coma: ₡25.000, nunca ₡25,000.
    ejemplo: "₡25.000",
  },
  prefijo: "+506 (ocho dígitos)",
  prefijosTelefono: ["506"],
  husoHorario: "America/Costa_Rica",
  tratamiento:
    "Se habla de USTED casi siempre, incluso con confianza; el vos aparece entre conocidos. " +
    "Tutear suena a extranjero.",
  // El mismo de `src/agents/paises/cr.ts`, que es el que lee el cliente.
  saludo: "Hola, le asiste <agente>, un gusto.",
  expresiones: [
    "«con mucho gusto» en lugar de «de nada»: es la muletilla nacional",
    // «pura vida» la dice todo el mundo aquí, pero la dueña la sacó de los
    // mensajes de la tienda (2026-09-08). No se lista: esto no describe el
    // país para un libro, es lo que el agente puede decir.
    "«diay» al empezar una frase",
    "«¿me confirma?» para pedir un dato",
    "«ocupo» en lugar de «necesito»",
  ],
  zonasCercanas: [
    "San José",
    "Heredia",
    "Alajuela",
    "Cartago",
  ],
  zonas: [
    "San José",
    "Alajuela",
    "Cartago",
    "Heredia",
    "Guanacaste (Liberia, Nicoya, Santa Cruz)",
    "Puntarenas (Jacó, Quepos)",
    "Limón",
    "Pérez Zeledón",
    "Desamparados",
    "Escazú",
    "Santa Ana",
    "Curridabat",
  ],
  direcciones:
    "EN COSTA RICA NO HAY CALLE Y NÚMERO. Las direcciones se dan por referencias y distancias " +
    "desde un punto conocido: «200 metros norte y 50 este de la iglesia de Santa Ana, casa color " +
    "verde». Cien metros es una cuadra. Pedir «la calle y el número» delata al instante que quien " +
    "escribe no es de aquí: se pide el CANTÓN y el DISTRITO, y después las señas.",
  datosParaCerrar: [
    "El nombre completo de quien recibe el pedido",
    "PROVINCIA, CANTÓN y DISTRITO, más las señas desde un punto conocido: aquí no hay calle y " +
      "número que pedir",
    "Y el pago: aquí se cobra ANTES de enviar, así que sin el comprobante por delante no sale " +
      "el paquete",
  ],
  entrega: [
    "Correos de Costa Rica al país entero, con guía de rastreo",
    "Mensajería propia o Uber Flash en el Gran Área Metropolitana, el mismo día",
    "El pago contra entrega NO es lo habitual: se cobra por adelantado por SINPE y luego se envía",
  ],
  pagos: [
    "SINPE Móvil, la forma más común: se paga al número de teléfono",
    "Transferencia bancaria (BAC, Banco Nacional, BCR)",
    "Tarjeta",
    "Efectivo al entregar en mano",
  ],
  caja: { latMin: 7.9, latMax: 11.3, lngMin: -86.0, lngMax: -82.5 },
  ciudades: [
    { nombre: "San José", lat: 9.9281, lng: -84.0907 },
    { nombre: "Alajuela", lat: 10.0162, lng: -84.2116 },
    { nombre: "Heredia", lat: 9.9981, lng: -84.1197 },
    { nombre: "Cartago", lat: 9.8644, lng: -83.9194 },
    { nombre: "Liberia", lat: 10.6346, lng: -85.4377 },
    { nombre: "Puntarenas", lat: 9.9763, lng: -84.8384 },
    { nombre: "Limón", lat: 9.9907, lng: -83.0359 },
    { nombre: "San Isidro de El General", lat: 9.3667, lng: -83.7 },
    { nombre: "Nicoya", lat: 10.1483, lng: -85.4522 },
  ],
};

const PANAMA: Pais = {
  codigo: "pa",
  nombre: "Panamá",
  bandera: "🇵🇦",
  // El rojo del cuartel de su bandera.
  color: "#b3372c",
  moneda: {
    codigo: "PAB",
    simbolo: "B/.",
    nombre: "balboa, a la par con el dólar",
    ejemplo: "B/. 25.00",
  },
  prefijo: "+507 (ocho dígitos)",
  prefijosTelefono: ["507"],
  husoHorario: "America/Panama",
  tratamiento:
    "De usted al vender, cordial y directo. El tuteo se usa con clientes jóvenes o de confianza.",
  saludo: "Hola, le asiste <agente> de <negocio>",
  expresiones: [
    "«a la orden» para ofrecerse y para cerrar",
    "«listo» para confirmar",
    "«¿me confirma?» al pedir un dato",
    "«ahí mismo» o «de una» para algo inmediato",
    "«chuzo» y «xopá» son de calle: no van en una venta",
  ],
  zonasCercanas: [
    "Ciudad de Panamá",
    "San Miguelito",
    "Panamá Oeste",
  ],
  zonas: [
    "Ciudad de Panamá (Bella Vista, Betania, Juan Díaz, Costa del Este, San Francisco)",
    "San Miguelito",
    "Tocumen y 24 de Diciembre",
    "Panamá Oeste (Arraiján, La Chorrera, Capira)",
    "Colón",
    "Chiriquí (David, Boquete)",
    "Veraguas (Santiago)",
    "Herrera (Chitré)",
    "Los Santos (Las Tablas)",
    "Coclé (Penonomé, Aguadulce)",
    "Bocas del Toro",
    "Darién",
  ],
  direcciones:
    "Se dan por corregimiento, barriada y casa o edificio: «Villa Lucre, calle 3, casa 12» o «PH " +
    "Torres del Mar, apto 14-B, Costa del Este». El CORREGIMIENTO es el dato que sitúa todo lo " +
    "demás. En los edificios hay que pedir el número de apartamento, o el pedido llega al lobby y " +
    "ahí se queda.",
  datosParaCerrar: [
    "El nombre completo de quien recibe el pedido",
    "PROVINCIA, DISTRITO y CORREGIMIENTO, más la calle o el edificio y un punto de referencia: " +
      "el corregimiento es el dato que sitúa todo lo demás",
    "En un edificio, además el número de apartamento, o el pedido se queda en el lobby",
  ],
  entrega: [
    "En ciudad de Panamá y Panamá Oeste, mensajero propio en 24–48 horas",
    "Al interior, por Uno Express o encomienda de bus: el cliente retira en la terminal de su provincia",
    "El pago contra entrega es lo normal en la ciudad",
  ],
  pagos: [
    "Yappy, la forma más común entre particulares",
    "Efectivo contra entrega",
    "Transferencia o ACH (Banco General, Banistmo)",
    "Tarjeta",
  ],
  caja: { latMin: 7.1, latMax: 9.7, lngMin: -83.1, lngMax: -77.1 },
  ciudades: [
    { nombre: "Ciudad de Panamá", lat: 8.9824, lng: -79.5199 },
    { nombre: "San Miguelito", lat: 9.0333, lng: -79.5 },
    { nombre: "Arraiján", lat: 8.95, lng: -79.6667 },
    { nombre: "La Chorrera", lat: 8.88, lng: -79.7833 },
    { nombre: "Colón", lat: 9.3592, lng: -79.9014 },
    { nombre: "David", lat: 8.4333, lng: -82.4333 },
    { nombre: "Santiago de Veraguas", lat: 8.1, lng: -80.9833 },
    { nombre: "Chitré", lat: 7.9614, lng: -80.4292 },
    { nombre: "Penonomé", lat: 8.5194, lng: -80.3572 },
    { nombre: "Las Tablas", lat: 7.7667, lng: -80.2833 },
    { nombre: "Changuinola", lat: 9.43, lng: -82.52 },
  ],
};

/** Los países que el panel sabe atender, en el orden en que se enseñan. */
export const PAISES: Pais[] = [REPUBLICA_DOMINICANA, COSTA_RICA, PANAMA];

/**
 * El país de un canal, o null si no se le puso ninguno.
 *
 * Null NO es un error: un canal sin país es un canal que vende en un sitio que
 * este archivo no conoce, y ahí el agente trabaja sin este bloque, exactamente
 * igual que antes de que existiera.
 */
export function obtenerPais(codigo: string | null | undefined): Pais | null {
  if (!codigo) return null;
  return PAISES.find((p) => p.codigo === codigo.toLowerCase().trim()) ?? null;
}

/**
 * EL PAÍS DE UN NÚMERO, DEDUCIDO DE SU PREFIJO.
 *
 * El número de un canal YA DICE en qué país vende: un WhatsApp +507 atiende a
 * panameños. Preguntárselo al dueño cuando el dato está delante es hacerle
 * escribir algo que ya sabemos, y —peor— es un campo que se queda sin rellenar,
 * con el agente hablando en neutro sin que nadie se dé cuenta.
 *
 * Devuelve null cuando no se puede saber, y eso es lo importante: NO adivina.
 * Un +1 puede ser dominicano, estadounidense o de media docena de islas más, y
 * lo que lo distingue es el código de área. Un número de Miami metido como
 * dominicano haría que el agente cotizara en pesos a quien paga en dólares, que
 * es peor que no saber de dónde es. Ante la duda, sin país, y el panel avisa.
 *
 * `telefono` llega tal como se guarda: solo dígitos y sin el «+». Un canal sin
 * vincular tiene «pendiente:…» ahí, y de ese no hay nada que deducir.
 */
export function paisDeTelefono(telefono: string | null | undefined): Pais | null {
  if (!telefono) return null;

  const digitos = telefono.replace(/\D/g, "");
  if (!digitos) return null;

  /*
   * El prefijo más largo gana. Sin ordenar, un país con prefijo "1" se llevaría
   * por delante a otro con "1809": aquí no pasa —ninguno usa el "1" pelado—
   * pero es la clase de detalle que se rompe solo el día que se añade un país.
   */
  const candidatos = PAISES.flatMap((p) => p.prefijosTelefono.map((pre) => ({ p, pre })))
    .filter(({ pre }) => digitos.startsWith(pre))
    .sort((a, b) => b.pre.length - a.pre.length);

  return candidatos[0]?.p ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// El bloque que lee el modelo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que el agente sabe del país, escrito para que lo lea un modelo.
 *
 * Es CONTEXTO, no permiso. La última línea existe porque sin ella un modelo al
 * que se le acaba de contar cómo se paga y cuánto tarda un envío en ese país
 * empieza a prometer plazos y formas de pago que el negocio no ofrece: esto
 * sirve para ENTENDER al cliente, no para prometerle nada.
 */
export function bloqueDePais(pais: Pais): string {
  return [
    `DÓNDE VENDES — ${pais.nombre}. Este WhatsApp atiende a clientes de ahí, y tienes que sonar de ahí.`,
    "",
    `Moneda: ${pais.moneda.nombre} (${pais.moneda.codigo}). Se escribe «${pais.moneda.simbolo}» y un importe se ve así: ${pais.moneda.ejemplo}. Todo precio que digas va en esta moneda y escrito de esta forma.`,
    `Trato: ${pais.tratamiento}`,
    `Así habla la gente ahí:\n${pais.expresiones.map((e) => `- ${e}`).join("\n")}`,
    "",
    `CÓMO SE DAN LAS DIRECCIONES AQUÍ: ${pais.direcciones}`,
    `Zonas que vas a oír nombrar: ${pais.zonas.join(", ")}.`,
    "",
    /*
     * CÓMO SE PIDE, que es distinto de cómo se escribe.
     *
     * Sin esto el agente hace un interrogatorio: pide la dirección, el cliente
     * la manda entera, y él vuelve a preguntar por el punto de referencia, y
     * luego por el color de la casa. Cada repregunta es una oportunidad de que
     * el cliente se canse, y el pedido ya se podía despachar desde la primera
     * respuesta. Lo caro no es una dirección con menos detalle: es la venta que
     * se pierde pidiéndolo.
     */
    "CÓMO SE PIDE: una sola vez y entera, en una pregunta. Cuando el cliente te la dé, DALA POR " +
      "BUENA y sigue con lo que falte del pedido: nada de repreguntar el punto de referencia, el " +
      "color de la casa ni la calle de al lado. Solo vuelves a preguntar si de verdad no se puede " +
      "entregar ahí —falta la provincia o la zona, o te dijeron únicamente el nombre de una " +
      "ciudad— y entonces pides EXACTAMENTE el dato que falta, no la dirección otra vez. Si te " +
      "mandan la ubicación por el mapa, esa ES su dirección y con eso basta: ni el número de casa " +
      "ni el apartamento ni la seña de la puerta se preguntan.",
    "",
    `Cómo llegan los pedidos en este país:\n${pais.entrega.map((e) => `- ${e}`).join("\n")}`,
    `Con qué paga la gente aquí:\n${pais.pagos.map((e) => `- ${e}`).join("\n")}`,
    "",
    "Todo esto es para que ENTIENDAS al cliente y suenes de su país, no para prometerle nada. Los " +
      "precios, los plazos y las formas de pago que puedes ofrecer son solo los del catálogo y los " +
      "de las instrucciones del negocio. Si el cliente propone una forma de pago o un envío que no " +
      "está ahí, no lo confirmes: dile que lo revisas con el equipo.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Situar un punto del mapa
// ─────────────────────────────────────────────────────────────────────────────

const RADIO_TIERRA_KM = 6371;

/** Distancia en línea recta entre dos puntos, en kilómetros. */
export function distanciaKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h));
}

/** ¿El punto cae dentro de la caja del país? */
export function dentroDelPais(pais: Pais, lat: number, lng: number): boolean {
  const c = pais.caja;
  return lat >= c.latMin && lat <= c.latMax && lng >= c.lngMin && lng <= c.lngMax;
}

/**
 * La ciudad conocida más cercana al punto, con su distancia.
 *
 * No es geocodificación —no hay una calle detrás— y no pretende serlo: sirve
 * para decir «esto está por Santiago, a unos 8 km», que es lo que necesita
 * saber quien va a despachar el pedido y lo que le permite al agente confirmar
 * la zona en vez de repreguntar la dirección entera.
 */
export function ciudadMasCercana(
  pais: Pais,
  lat: number,
  lng: number,
): { nombre: string; km: number } | null {
  let mejor: { nombre: string; km: number } | null = null;

  for (const c of pais.ciudades) {
    const km = distanciaKm({ lat, lng }, { lat: c.lat, lng: c.lng });
    if (!mejor || km < mejor.km) mejor = { nombre: c.nombre, km };
  }

  return mejor;
}

// ─────────────────────────────────────────────────────────────────────────────
// El país, escrito para el panel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LO QUE EL PANEL ENSEÑA DE UN PAÍS. Se lee, no se edita.
 *
 * Vive aquí y no en el componente por la misma razón por la que vive aquí el
 * país: si el resumen se armara en la página, añadir un dato al país obligaría
 * a tocar dos archivos y el que se olvidara sería siempre el segundo. Un país
 * nuevo es una entrada en este archivo, y el panel lo enseña entero sin que
 * nadie lo cablee.
 *
 * Es un tipo aparte de `Pais` a propósito: `Pais` lleva cajas de coordenadas y
 * prefijos de teléfono que al dueño no le dicen nada, y esto cruza al cliente.
 */
export interface PaisResumen {
  codigo: string;
  nombre: string;
  bandera: string;
  color: string;
  prefijo: string;
  husoHorario: string;
  moneda: {
    codigo: string;
    simbolo: string;
    nombre: string;
    ejemplo: string;
  };
  tratamiento: string;
  /** Con qué abre, con sus marcadores sin rellenar. Ver `saludoDelPais`. */
  saludo: string;
  expresiones: string[];
  direcciones: string;
  zonas: string[];
  /** Dónde llega el mensajero propio en el día. Parte la tarifa de envío. */
  zonasCercanas: string[];
  datosParaCerrar: string[];
  entrega: string[];
  pagos: string[];
  /** Cuántas ciudades conoce, para poder situar un pin del mapa. */
  ciudades: number;
}

/**
 * EL SALUDO YA ESCRITO, tal cual lo va a leer el cliente.
 *
 * Sale de aquí y no de dos plantillas sueltas porque hay DOS sitios que lo
 * necesitan y tienen que decir lo mismo: el prompt, que se lo manda al modelo,
 * y el aviso del panel, que le enseña al dueño cómo se presenta su agente. El
 * día que se cambia uno y no el otro, el panel jura que dice una cosa y el
 * cliente lee otra, y nadie lo descubre porque el dueño no se escribe a sí
 * mismo.
 *
 * Sin país, el de siempre: el agente vende en neutro y el saludo también.
 */
export function saludoDelPais(
  pais: Pick<Pais, "saludo"> | null,
  agente: string,
  negocio: string,
): string {
  const forma = pais?.saludo ?? "Hola, le asiste <agente> de <negocio>";
  return forma.replace("<agente>", agente).replace("<negocio>", negocio);
}

/** El país tal y como lo lee el panel. Ver `PaisResumen`. */
export function resumenDePais(p: Pais): PaisResumen {
  return {
    codigo: p.codigo,
    nombre: p.nombre,
    bandera: p.bandera,
    color: p.color,
    prefijo: p.prefijo,
    husoHorario: p.husoHorario,
    moneda: { ...p.moneda },
    tratamiento: p.tratamiento,
    saludo: p.saludo,
    expresiones: p.expresiones,
    direcciones: p.direcciones,
    zonas: p.zonas,
    zonasCercanas: p.zonasCercanas,
    datosParaCerrar: p.datosParaCerrar,
    entrega: p.entrega,
    pagos: p.pagos,
    ciudades: p.ciudades.length,
  };
}
