/**
 * Panamá.
 *
 * SOLO DATOS. Cómo vende el agente está en `../base-comportamiento.ts` y es el
 * mismo para los tres países; aquí va lo que es de ESTE país y de ESTA tienda.
 * Cambiar una cifra aquí no toca a República Dominicana ni a Costa Rica.
 *
 * VARIOS DATOS ESTÁN PENDIENTES DE CONFIRMAR y van en null a propósito: el
 * agente no los inventa y, si el cliente los pregunta, pasa el chat a un
 * representante. Rellenarlos es cambiar este archivo y nada más:
 *
 *   - `tienda` y `nombreAgente`: mientras estén vacíos se usa el nombre del
 *     perfil de WhatsApp del número y el nombre que diga el panel.
 *   - `pago`: la forma de pago.
 *   - `mayoreo` y `politicaDeCambios`.
 */
import type { DatosPais } from "../tipos";

export const PA: DatosPais = {
  codigo: "pa",
  nombre: "Panamá",

  // ── Identidad ──────────────────────────────────────────────────────────
  // PENDIENTE: nombre de la tienda. Vacío = el del perfil de WhatsApp.
  tienda: "",
  // PENDIENTE: nombre de quien atiende. Null = el del panel.
  nombreAgente: null,
  saludo: "Hola, le asiste <agente> de <negocio>",
  trato: "usted",

  // ── Moneda ─────────────────────────────────────────────────────────────
  moneda: {
    codigo: "USD",
    simbolo: "US$",
    nombre: "dólar",
    ejemplo: "US$25.00",
    // Con coma en los miles y siempre dos decimales: US$5.00.
    miles: ",",
    decimales: 2,
  },

  // ── Envío ──────────────────────────────────────────────────────────────
  envio: {
    cobertura: "US$5.00 a todo el país, el mismo costo en todas partes.",
    zonas: [],
    restoDelPais: {
      costo: 5,
      modalidad: "envío a todo el país",
    },
    direccion:
      "Se da por corregimiento, barriada y casa o edificio: «Villa Lucre, calle 3, casa 12» o " +
      "«PH Torres del Mar, apto 14-B, Costa del Este». El CORREGIMIENTO es el dato que sitúa " +
      "todo lo demás. En los edificios hay que pedir el número de apartamento, o el pedido llega " +
      "al lobby y ahí se queda. Se pide UNA VEZ Y ENTERA, y cuando la dé se da por buena.",
    datosParaCerrar: [
      "El nombre con el que recibe el pedido, tal cual lo escribió el cliente",
      "El celular al que llama el mensajero",
      "PROVINCIA, DISTRITO y CORREGIMIENTO, más la calle o el edificio y un punto de referencia: " +
        "el corregimiento es el dato que sitúa todo lo demás",
      "En un edificio, además el número de apartamento, o el pedido se queda en el lobby",
    ],
  },

  // ── El mapa ────────────────────────────────────────────────────────────
  // Para RECONOCER un lugar cuando el cliente lo escribe. El envío es el
  // mismo en todo el país.
  mapa: {
    regiones: [
      {
        nombre: "Panamá (provincia y ciudad)",
        lugares: [
          "Bella Vista", "San Francisco", "Juan Díaz", "Tocumen", "Betania", "Río Abajo", "Parque Lefevre",
          "Pueblo Nuevo", "Calidonia", "El Chorrillo", "Santa Ana", "Ancón", "Las Cumbres", "Alcalde Díaz",
          "Chilibre", "Pacora", "24 de Diciembre", "Costa del Este", "Villa Lucre", "Condado del Rey",
          "Brisas del Golf", "Villa Zaita", "San Miguelito (Amelia Denis de Icaza, Belisario Porras, José Domingo Espinar, Rufina Alfaro)",
          "Chepo",
        ],
      },
      {
        nombre: "Panamá Oeste",
        lugares: ["La Chorrera", "Arraiján", "Vista Alegre", "Burunga", "Vacamonte", "Capira", "Chame", "San Carlos", "Coronado"],
      },
      { nombre: "Colón", lugares: ["Colón centro", "Sabanitas", "Portobelo", "Cativá", "Puerto Pilón"] },
      { nombre: "Coclé", lugares: ["Penonomé", "Aguadulce", "Antón", "Natá", "La Pintada", "Olá"] },
      { nombre: "Herrera", lugares: ["Chitré", "Ocú", "Parita", "Pesé", "Las Minas", "Santa María"] },
      { nombre: "Los Santos", lugares: ["Las Tablas", "Guararé", "Pedasí", "Macaracas", "Tonosí", "Pocrí"] },
      { nombre: "Veraguas", lugares: ["Santiago de Veraguas", "Soná", "Atalaya", "Cañazas", "Santa Fe"] },
      { nombre: "Chiriquí", lugares: ["David", "Boquete", "Bugaba", "Volcán", "Puerto Armuelles", "Dolega", "Boquerón"] },
      { nombre: "Bocas del Toro", lugares: ["Changuinola", "Almirante", "Bocas del Toro (isla)"] },
      { nombre: "Darién y comarcas", lugares: ["Metetí", "La Palma", "Yaviza", "Guna Yala", "Ngäbe-Buglé"] },
    ],
    aviso:
      "OJO: «Sabanitas» es un corregimiento de Colón, no un producto. Esta tienda NO vende sábanas ni " +
      "nada que se llame así: si un cliente escribe ese nombre, te está diciendo dónde vive.",
  },

  // ── Pago ───────────────────────────────────────────────────────────────
  // PENDIENTE DE CONFIRMAR. Null = NO CONFIGURADA: el agente no la inventa y,
  // si el cliente pregunta cómo se paga, transfiere a un representante.
  pago: null,
  pagoAlCliente: null,

  // ── Ubicación ──────────────────────────────────────────────────────────
  ubicacion: {
    tiendaFisica: "Somos tienda virtual y enviamos a todo el país. No tenemos local físico.",
    alRecibirMapa:
      "Esa ES su dirección. La tomas como buena, se lo confirmas en corto —«Perfecto, ya me " +
      "llegó su ubicación en <corregimiento>»—, le dices que el envío son US$5.00 y sigues con " +
      "lo que falte. Esa dirección la escribes TAL CUAL en el resumen, con su corregimiento. " +
      "Nunca escribas «ubicación compartida» ni dejes esa línea en blanco, y nunca le vuelvas a " +
      "pedir la dirección.",
  },

  // ── Tallas ─────────────────────────────────────────────────────────────
  tallas: {
    usaTablaBase: true,
    zapatoEn: "numeración europea (de la 39 a la 45)",
    conTallaYColor: [],
    sinTallaNiColor: [],
    soloRopaYCalzado: false,
    notas: [],
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
      "Panameña y natural: de usted al vender, cordial y directa, sin rodeos. El tuteo se usa " +
      "con clientes jóvenes o de confianza, pero aquí se vende de usted.",
    expresiones: [
      "«a la orden» para ofrecerse y para cerrar",
      "«listo» para confirmar",
      "«¿me confirma?» al pedir un dato",
      "«ahí mismo» o «de una» para algo inmediato",
      "«chuzo» y «xopá» son de calle: no van en una venta",
    ],
  },

  // ── El pie del resumen ─────────────────────────────────────────────────
  pieDelResumen: ["Enviamos a todo el país.", "Se despacha dentro de 24 a 48 horas."],
};
