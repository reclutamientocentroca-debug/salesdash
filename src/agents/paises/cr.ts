/**
 * Costa Rica — TELLERIA.
 *
 * SOLO DATOS. Cómo vende el agente está en `../base-comportamiento.ts` y es el
 * mismo para los tres países; aquí va lo que es de ESTE país y de ESTA tienda.
 * Cambiar una cifra aquí no toca a República Dominicana ni a Panamá.
 *
 * Lo particular de aquí: el envío cuesta lo mismo en todo el país, y lo que
 * cambia por zona es CÓMO llega y CUÁNDO se paga.
 */
import type { DatosPais } from "../tipos";

export const CR: DatosPais = {
  codigo: "cr",
  nombre: "Costa Rica",

  // ── Identidad ──────────────────────────────────────────────────────────
  tienda: "TELLERIA",
  // Sin nombre personal: se presenta la tienda.
  nombreAgente: null,
  saludo: "Hola, te asiste TELLERIA",
  trato: "tu",

  // ── Moneda ─────────────────────────────────────────────────────────────
  moneda: {
    codigo: "CRC",
    simbolo: "₡",
    nombre: "colón",
    ejemplo: "₡25.000",
    // El punto separa los miles: ₡3.500, nunca ₡3,500.
    miles: ".",
    decimales: 0,
  },

  // ── Envío ──────────────────────────────────────────────────────────────
  envio: {
    cobertura:
      "₡3.500 a todo el país, el mismo costo en todas partes. Lo que cambia por zona es cómo " +
      "llega el pedido y cuándo se paga.",
    zonas: [
      {
        nombre: "Zona de entrega a domicilio",
        lugares: [
          "Alajuela",
          "Alajuelita",
          "Heredia",
          "Santa Ana",
          "Escazú",
          "Vázquez de Coronado",
          "Coronado",
          "Tibás",
          "Goicoechea",
          "Moravia",
          "Montes de Oca",
          "Curridabat",
          "Aserrí",
        ],
        costo: 3500,
        modalidad: "entrega a domicilio",
        pago: "paga al recibir, por transferencia o SINPE Móvil",
      },
    ],
    restoDelPais: {
      costo: 3500,
      modalidad: "va por correo o encomienda y el cliente retira en la sucursal más cercana",
      pago:
        "se cobra ANTES de enviar: pago previo por SINPE Móvil o transferencia, y sin el " +
        "comprobante no sale el paquete",
    },
    direccion:
      "EN COSTA RICA NO HAY CALLE Y NÚMERO. Las direcciones se dan por referencias y distancias " +
      "desde un punto conocido: «200 metros norte y 50 este de la iglesia, casa color verde». " +
      "Cien metros es una cuadra. Pedir «la calle y el número» delata al instante que quien " +
      "escribe no es de aquí: se pide la PROVINCIA, el CANTÓN y el DISTRITO, y después las " +
      "señas. Con la dirección no seas exigente: con el cantón, el distrito y unas señas ya se " +
      "despacha.",
    datosParaCerrar: [
      "El nombre con el que recibe el pedido, tal cual lo escribió el cliente",
      "El celular al que se le llama",
      "PROVINCIA, CANTÓN y DISTRITO, más las señas desde un punto conocido: aquí no hay calle y " +
        "número que pedir",
      "Fuera de la zona de entrega a domicilio, el pago por delante: ahí se cobra ANTES de enviar, " +
        "y sin el comprobante no sale el paquete",
    ],
  },

  // ── Pago ───────────────────────────────────────────────────────────────
  pago:
    "Por SINPE Móvil o transferencia bancaria. CUÁNDO se paga depende de la zona: en la zona " +
    "de entrega a domicilio se paga al recibir; fuera de ella, antes de enviar. El número de " +
    "SINPE Móvil o la cuenta se los da el representante después del resumen: tú no los tienes " +
    "y NO SE LOS INVENTES.",

  // ── Ubicación ──────────────────────────────────────────────────────────
  ubicacion: {
    tiendaFisica: "Somos tienda virtual y enviamos a todo el país. No tenemos tienda física.",
    alRecibirMapa:
      "Esa ES su dirección. La tomas como buena, se lo confirmas en corto —«Perfecto, ya me " +
      "llegó tu ubicación en <cantón>»—, le dices que el envío son ₡3.500 y cómo le llega según " +
      "la zona, y sigues con lo que falte. Esa dirección la escribes TAL CUAL en el resumen, con " +
      "el cantón y la provincia que se entiendan de ella. Nunca escribas «ubicación compartida» " +
      "ni dejes esa línea en blanco, y nunca le vuelvas a pedir la dirección.",
  },

  // ── Tallas ─────────────────────────────────────────────────────────────
  tallas: {
    usaTablaBase: true,
    zapatoEn: "numeración europea (de la 39 a la 45)",
    conTallaYColor: [],
    sinTallaNiColor: ["Planchas"],
    // Una plancha, un electrodoméstico o cualquier cosa que no sea ropa ni
    // calzado: no se pide talla ni color, solo se ofrece y se vende.
    soloRopaYCalzado: true,
    notas: ["La talla se pide como la pida el anuncio: por letra o por número, nunca al revés."],
  },

  // ── Mayoreo ────────────────────────────────────────────────────────────
  mayoreo: {
    // PENDIENTE DE CONFIRMAR: mientras no se sepa, se transfiere.
    vende: null,
    agenteCotiza: false,
    desde: null,
  },

  // ── Cambios y devoluciones ─────────────────────────────────────────────
  // PENDIENTE DE CONFIRMAR: mientras no haya política, se transfiere.
  politicaDeCambios: null,

  // ── Cómo habla la gente ────────────────────────────────────────────────
  habla: {
    descripcion:
      "Costarricense y natural: amable, sin prisa aparente y con el «con mucho gusto» en la " +
      "boca. Se habla de usted con facilidad; el tuteo aquí es cercano, no confianzudo.",
    expresiones: [
      "«con mucho gusto» en lugar de «de nada»: es la muletilla nacional",
      "«pura vida» para saludar, agradecer y despedirse",
      "«diay» al empezar una frase",
      "«¿me confirma?» para pedir un dato",
      "«ocupo» en lugar de «necesito»",
    ],
  },

  // ── El pie del resumen ─────────────────────────────────────────────────
  pieDelResumen: [
    "Somos tienda virtual y enviamos a todo el país.",
    "Se despacha dentro de 24 a 48 horas.",
  ],
};
