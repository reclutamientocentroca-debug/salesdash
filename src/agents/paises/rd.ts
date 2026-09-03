/**
 * República Dominicana — RINCON DCM.
 *
 * SOLO DATOS. Cómo vende el agente está en `../base-comportamiento.ts` y es el
 * mismo para los tres países; aquí va lo que es de ESTE país y de ESTA tienda.
 * Cambiar una cifra aquí no toca a Costa Rica ni a Panamá.
 *
 * Todo lo que cambie el dueño, lo cambia en este archivo.
 */
import type { DatosPais } from "../tipos";

export const RD: DatosPais = {
  codigo: "do",
  nombre: "República Dominicana",

  // ── Identidad ──────────────────────────────────────────────────────────
  tienda: "RINCON DCM",
  nombreAgente: "Orlanda",
  saludo: "Hola, le asiste Orlanda de RINCON DCM",
  trato: "usted",

  // ── Moneda ─────────────────────────────────────────────────────────────
  moneda: {
    codigo: "DOP",
    simbolo: "RD$",
    nombre: "peso dominicano",
    ejemplo: "RD$1,500",
    // La coma separa los miles: RD$2,500.
    miles: ",",
    decimales: 0,
  },

  // ── Envío ──────────────────────────────────────────────────────────────
  envio: {
    cobertura: "A domicilio en todo el país. Lo único que cambia por zona es el costo.",
    zonas: [
      {
        nombre: "Gran Santo Domingo",
        // «Santo Domingo» reconoce también Santo Domingo Este, Norte y Oeste.
        // Santiago se queda fuera a propósito: cobra como interior.
        lugares: ["Distrito Nacional", "Santo Domingo"],
        costo: 250,
        modalidad: "a domicilio, con mensajero",
      },
    ],
    restoDelPais: {
      costo: 290,
      modalidad: "a domicilio",
    },
    direccion:
      "Se da por calle y número, con EL SECTOR detrás y LA PROVINCIA al final: «calle Duarte #45, " +
      "Los Prados, Santo Domingo, Distrito Nacional». Los dos datos que sitúan un pedido son la " +
      "PROVINCIA —de ella depende el costo del envío— y el SECTOR, porque sin él dos calles con el " +
      "mismo nombre están a media hora una de otra. En los edificios hace falta el nombre y el " +
      "apartamento. Con calle, sector y provincia ya se despacha: lo demás —punto de referencia, " +
      "color de la casa— ayuda, pero no se exige. Se pide UNA VEZ Y ENTERA, con el sector y la " +
      "provincia, y se añade, una sola vez: «Si le queda más cómodo, puede compartirme su " +
      "ubicación por aquí».",
    datosParaCerrar: [
      "El nombre con el que recibe el pedido, tal cual lo escribió el cliente",
      "El celular al que llama el mensajero",
      "La dirección con calle y número, EL SECTOR y LA PROVINCIA: sin sector, dos calles con el " +
        "mismo nombre están a media hora una de otra",
      "En un edificio, además el nombre del edificio y el apartamento",
    ],
  },

  // ── Pago ───────────────────────────────────────────────────────────────
  pago:
    "Contra entrega: el cliente paga al recibir el pedido, en su mano, y puede revisar el " +
    "producto antes de pagarle al mensajero. Igual en todo el país. No paga nada por adelantado. " +
    "Si pregunta «¿es seguro?», esa es la respuesta.",

  // ── Ubicación ──────────────────────────────────────────────────────────
  ubicacion: {
    tiendaFisica: "Somos tienda virtual y enviamos a todo el país. No tenemos local físico.",
    alRecibirMapa:
      "Esa ES su dirección. La tomas como buena, se lo confirmas en corto —«Perfecto, ya me " +
      "llegó su ubicación en <sector>»—, le dices de una vez cuánto le sale el envío de esa " +
      "zona y sigues con lo que falte. Esa dirección la escribes TAL CUAL en el resumen, con su " +
      "sector y su provincia. Nunca escribas «ubicación compartida» ni dejes esa línea en " +
      "blanco, y nunca le vuelvas a pedir la dirección.",
  },

  // ── Tallas ─────────────────────────────────────────────────────────────
  tallas: {
    usaTablaBase: true,
    zapatoEn: "numeración europea (de la 39 a la 45, que es lo mismo que del 7 al 11 americana)",
    conTallaYColor: ["Correas y cinturones"],
    sinTallaNiColor: ["Cepillos", "Abejones"],
    soloRopaYCalzado: false,
    notas: [
      "Si el cliente da la talla del zapato en americana (7, 8, 9, 10, 11), se acepta tal cual y " +
        "se anota: no se le corrige ni se le explica la equivalencia.",
    ],
  },

  // ── Mayoreo ────────────────────────────────────────────────────────────
  mayoreo: {
    vende: true,
    // El agente no cotiza mayoreo: lo pasa a un representante.
    agenteCotiza: false,
    desde: 3,
  },

  // ── Cambios y devoluciones ─────────────────────────────────────────────
  politicaDeCambios:
    "Hay cambio dentro de las 24 horas siguientes a recibir el pedido, y en la entrega el " +
    "cliente puede revisar el producto antes de pagarle al mensajero. Lo que eso no cubra, lo " +
    "pasa un representante.",

  // ── Cómo habla la gente ────────────────────────────────────────────────
  habla: {
    descripcion:
      "Dominicana y natural: cercana, con calor, sin formalidad de oficina. Se tutea con " +
      "naturalidad en la calle, pero aquí se vende de usted.",
    expresiones: [
      "«dime» o «dime a ver» para invitar a que sigan hablando",
      "«a la orden» al despedirse o al confirmar",
      "«ahora mismo» o «ahorita» para algo inmediato",
      "«claro que sí» para confirmar",
      "«chequea» para pedir que revisen algo",
    ],
  },

  // ── El pie del resumen ─────────────────────────────────────────────────
  pieDelResumen: [
    "Somos tienda virtual y enviamos a todo el país.",
    "Paga al momento de recibir su pedido.",
    "Se despacha dentro de 24 a 48 horas.",
  ],
};
