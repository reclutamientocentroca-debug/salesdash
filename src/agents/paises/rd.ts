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
  // Como lo pidió la dueña (2026-09-04): bienvenida, quién atiende y gracias.
  saludo: "Hola! Bienvenido(a) a RINCON DCM. Gracias por escribirnos.",
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
        // Debajo, los sectores y municipios que la gente escribe sin decir la
        // provincia: con ellos el agente sabe que es ciudad sin preguntar más.
        // Santiago se queda fuera a propósito: cobra como interior.
        lugares: [
          "Distrito Nacional",
          "Santo Domingo",
          // Como lo abrevia la gente: «Sto Dgo Este», «SDE», «SDN», «SDO», «DN».
          "Sto Dgo",
          "Sto. Dgo.",
          "Santo Dgo",
          "Sto Domingo",
          "SDE",
          "SDN",
          "SDO",
          "DN",
          "Capital",
          "Los Mameyes",
          "Isabelita",
          "Ciudad Juan Bosco",
          "El Almirante",
          "Vista Hermosa",
          "Prados de San Luis",
          "San Luis",
          "Bayona",
          "Buenos Aires de Herrera",
          "Palmarejo",
          "Hidalgos",
          "Los Alcarrizos",
          "Villa Mella",
          "Sabana Perdida",
          "Pedro Brand",
          "San Antonio de Guerra",
          "Guerra",
          "Boca Chica",
          "Los Mina",
          "Villa Duarte",
          "Alma Rosa",
          "San Isidro",
          "Invivienda",
          "Los Frailes",
          "Villa Faro",
          "Gazcue",
          "Naco",
          "Piantini",
          "Bella Vista",
          "Los Prados",
          "Arroyo Hondo",
          "Villa Juana",
          "Cristo Rey",
          "Los Ríos",
          "Herrera",
          "Manoguayabo",
          "Ozama",
          "Zona Colonial",
          "Evaristo Morales",
          "Los Jardines",
          "Mirador",
          "Villa Consuelo",
          "Villa Francisca",
          "Los Guandules",
          "Guaricano",
          "La Victoria",
          "Cancino",
          "Lucerna",
          "Charles de Gaulle",
          "Las Américas",
          "Hainamosa",
          "Mendoza",
          "Andrés",
          "La Caleta",
          "Pantoja",
          "Hato Nuevo",
          "Ensanche Ozama",
          "Mirador Sur",
          "Mirador Norte",
          "La Feria",
          "Ciudad Nueva",
          "San Carlos",
          "Villa Agrícolas",
          "Ensanche La Fe",
          "Los Girasoles",
          "Engombe",
          "El Café",
          "Villa Aura",
          "Las Caobas",
          "Ciudad Satélite",
          "Brisas del Este",
          "Los Tres Ojos",
          "Villa Carmen",
          "Los Trinitarios",
          "Katanga",
        ],
        costo: 250,
        modalidad: "a domicilio, con mensajero",
      },
    ],
    restoDelPais: {
      costo: 290,
      modalidad: "a domicilio",
      // Las provincias y ciudades del interior, como las escribe la gente.
      lugares: [
        "Santiago",
        "La Vega",
        "San Cristóbal",
        "Puerto Plata",
        "San Pedro de Macorís",
        "San Pedro",
        "La Romana",
        "Higüey",
        "Punta Cana",
        "Bávaro",
        "Verón",
        "Moca",
        "Bonao",
        "Baní",
        "Azua",
        "Barahona",
        "San Francisco de Macorís",
        "San Francisco",
        "Nagua",
        "Samaná",
        "Las Terrenas",
        "Cotuí",
        "Hato Mayor",
        "El Seibo",
        "Monte Plata",
        "San Juan",
        "Constanza",
        "Jarabacoa",
        "Dajabón",
        "Montecristi",
        "Mao",
        "Valverde",
        "Neiba",
        "Pedernales",
        "Elías Piña",
        "Salcedo",
        "Villa Altagracia",
        "Haina",
        "Sosúa",
        "Cabarete",
        "Tamboril",
        "Licey",
        "Villa González",
        "Yamasá",
        "Sabana de la Mar",
        "Miches",
        "Cibao",
        "interior",
        // Y los «Sabana» del interior, que no son sábanas: son municipios.
        "Sabana Grande de Boyá",
        "Sabana Grande de Palenque",
        "Sabana Yegua",
        "Sabana Larga",
        "Sabana Iglesia",
        "Sabana Buey",
        "Sabaneta",
        // El resto de provincias y municipios, como los escribe la gente.
        "San José de Ocoa",
        "Ocoa",
        "Santiago Rodríguez",
        "Hermanas Mirabal",
        "La Altagracia",
        "Espaillat",
        "Sánchez Ramírez",
        "María Trinidad Sánchez",
        "Peravia",
        "Bahoruco",
        "Monseñor Nouel",
        "Navarrete",
        "Gaspar Hernández",
        "Río San Juan",
        "Cabrera",
        "Villa Riva",
        "Pimentel",
        "Tenares",
        "Villa Tapia",
        "Jánico",
        "Luperón",
        "Imbert",
        "Altamira",
        "Guayubín",
        "Castañuelas",
        "Villa Vásquez",
        "Loma de Cabrera",
        "Comendador",
        "Las Matas de Farfán",
        "El Cercado",
        "Vicente Noble",
        "Enriquillo",
        "Jimaní",
        "Duvergé",
        "Tamayo",
        "Padre Las Casas",
        "Nizao",
        "Matanzas",
        "Yaguate",
        "Cambita",
        "Nigua",
        "Bayaguana",
        "Peralvillo",
        "Quisqueya",
        "Ramón Santana",
        "Guaymate",
        "El Valle",
        "Oviedo",
        "Sánchez",
        "Río San Juan",
      ],
    },
    direccion:
      "Se da por calle y número, con EL SECTOR detrás y LA PROVINCIA al final: «calle Duarte #45, " +
      "Los Prados, Santo Domingo, Distrito Nacional». Los dos datos que sitúan un pedido son la " +
      "PROVINCIA —de ella depende el costo del envío— y el SECTOR, porque sin él dos calles con el " +
      "mismo nombre están a media hora una de otra. En los edificios hace falta el nombre y el " +
      "apartamento. Con calle, sector y provincia ya se despacha: lo demás —punto de referencia, " +
      "color de la casa— ayuda, pero no se exige. Se pide UNA VEZ, y se toma lo que el cliente " +
      "diga: si escribe su provincia, su sector o su ciudad, con eso ya sabes dónde está y cuánto " +
      "le sale el envío. NUNCA le pidas que comparta su ubicación por el mapa ni insistas con la " +
      "dirección: si él la manda por su cuenta, se usa; si no, se sigue con lo que escribió.",
    datosParaCerrar: [
      "El nombre con el que recibe el pedido, tal cual lo escribió el cliente",
      "El celular al que llama el mensajero",
      "La dirección con calle y número, EL SECTOR y LA PROVINCIA: sin sector, dos calles con el " +
        "mismo nombre están a media hora una de otra",
      "En un edificio, además el nombre del edificio y el apartamento",
    ],
  },

  // ── El mapa ────────────────────────────────────────────────────────────
  // Para RECONOCER un lugar cuando el cliente lo escribe. La tarifa la
  // deciden las listas de arriba.
  mapa: {
    regiones: [
      {
        nombre: "Distrito Nacional (la capital)",
        lugares: [
          "Gazcue", "Naco", "Piantini", "Bella Vista", "Los Prados", "Arroyo Hondo", "Villa Juana",
          "Cristo Rey", "Los Ríos", "Villa Consuelo", "Villa Francisca", "Zona Colonial",
          "Evaristo Morales", "Mirador Sur", "Mirador Norte", "Los Jardines", "La Feria",
          "Ciudad Nueva", "San Carlos", "Villa Agrícolas", "Ensanche La Fe", "Los Guandules",
          "Los Girasoles", "Villa María", "Honduras", "Ensanche Luperón", "Ensanche Quisqueya",
        ],
      },
      {
        nombre: "Santo Domingo Este",
        lugares: [
          "Los Mina", "Villa Duarte", "Alma Rosa", "San Isidro", "Invivienda", "Los Frailes",
          "Villa Faro", "Cancino", "Lucerna", "Hainamosa", "Mendoza", "Charles de Gaulle",
          "Las Américas", "Ensanche Ozama", "Los Tres Ojos", "Villa Carmen", "Los Trinitarios",
          "Brisas del Este", "Katanga", "Boca Chica", "Andrés", "La Caleta",
        ],
      },
      {
        nombre: "Santo Domingo Norte",
        lugares: ["Villa Mella", "Sabana Perdida", "Guaricano", "La Victoria", "Ciudad Satélite"],
      },
      {
        nombre: "Santo Domingo Oeste",
        lugares: [
          "Herrera", "Manoguayabo", "Los Alcarrizos", "Pedro Brand", "Pantoja", "Hato Nuevo",
          "Engombe", "El Café", "Villa Aura", "Las Caobas",
        ],
      },
      {
        nombre: "Cibao (norte, interior)",
        lugares: [
          "Santiago (Tamboril, Licey, Villa González, Jánico, Sabana Iglesia, Navarrete)",
          "La Vega (Constanza, Jarabacoa)", "Espaillat (Moca, Gaspar Hernández)",
          "Duarte (San Francisco de Macorís, Villa Riva, Pimentel)",
          "Hermanas Mirabal (Salcedo, Tenares, Villa Tapia)", "Sánchez Ramírez (Cotuí)",
          "Monseñor Nouel (Bonao)", "Puerto Plata (Sosúa, Cabarete, Luperón, Imbert, Altamira)",
          "Valverde (Mao, Esperanza)", "Santiago Rodríguez (Sabaneta)",
          "Dajabón (Loma de Cabrera)", "Montecristi (Guayubín, Villa Vásquez, Castañuelas)",
          "María Trinidad Sánchez (Nagua, Cabrera, Río San Juan)", "Samaná (Las Terrenas, Sánchez)",
        ],
      },
      {
        nombre: "Este (interior)",
        lugares: [
          "La Altagracia (Higüey, Punta Cana, Bávaro, Verón)", "La Romana (Guaymate)",
          "San Pedro de Macorís (Consuelo, Quisqueya, Ramón Santana)", "El Seibo (Miches)",
          "Hato Mayor (Sabana de la Mar, El Valle)",
          "Monte Plata (Sabana Grande de Boyá, Bayaguana, Yamasá, Peralvillo)",
        ],
      },
      {
        nombre: "Sur (interior)",
        lugares: [
          "San Cristóbal (Haina, Nigua, Villa Altagracia, Yaguate, Cambita, Sabana Grande de Palenque)",
          "Peravia (Baní, Nizao, Matanzas, Sabana Buey)", "San José de Ocoa (Sabana Larga)",
          "Azua (Sabana Yegua, Padre Las Casas)", "San Juan (Las Matas de Farfán, El Cercado)",
          "Elías Piña (Comendador)", "Barahona (Cabral, Vicente Noble, Enriquillo, Paraíso)",
          "Bahoruco (Neiba, Tamayo)", "Independencia (Jimaní, Duvergé)", "Pedernales (Oviedo)",
        ],
      },
    ],
    aviso:
      "OJO CON LOS «SABANA»: «Sabana Perdida», «Sabana de la Mar», «Sabana Grande de Boyá», " +
      "«Sabana Grande de Palenque», «Sabana Yegua», «Sabana Larga», «Sabana Iglesia», «Sabana Buey» " +
      "y «Sabaneta» son LUGARES —sectores y municipios, con su provincia—. Esta tienda NO vende " +
      "sábanas ni nada que se llame así: si un cliente escribe uno de esos nombres, te está diciendo " +
      "dónde vive. «La capital» es Santo Domingo; «el Cibao» es el norte y va como interior.",
  },

  // ── Pago ───────────────────────────────────────────────────────────────
  pago:
    "Contra entrega: el cliente paga al recibir el pedido, en su mano, y puede revisar el " +
    "producto antes de pagarle al mensajero. Igual en todo el país. No paga nada por adelantado. " +
    "Si pregunta «¿es seguro?», esa es la respuesta.",
  pagoAlCliente:
    "Se paga contra entrega: al recibir el pedido lo revisa en su mano y le paga al mensajero. " +
    "No paga nada por adelantado.",

  // ── Ubicación ──────────────────────────────────────────────────────────
  ubicacion: {
    tiendaFisica: "Somos tienda virtual, le llevamos el pedido hasta su casa.",
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
    // Lo que se vende fijo, tal cual: ni talla ni color se preguntan.
    sinTallaNiColor: [
      "Cepillos", "Blowers", "Secadores", "Planchas", "Combos de cepillo y plancha",
      "Abejones", "Electrodomésticos", "Artículos del hogar", "Perfumes", "Relojes",
    ],
    soloRopaYCalzado: false,
    notas: [
      "Si el cliente da la talla del zapato en americana (7, 8, 9, 10, 11), se acepta tal cual y " +
        "se anota: no se le corrige ni se le explica la equivalencia.",
    ],
  },

  // ── Mayoreo ────────────────────────────────────────────────────────────
  mayoreo: {
    vende: true,
    // La dueña (2026-09-05): de 3 en adelante el agente cotiza con el precio por
    // mayor SI la descripción del anuncio lo trae; si no lo trae, transfiere.
    agenteCotiza: true,
    desde: 3,
  },

  // ── Cambios y devoluciones ─────────────────────────────────────────────
  politicaDeCambios:
    "SÍ se hace cambio y devolución dentro de las 24 horas después de haber recibido el pedido. " +
    "Y como la empresa se lo envía a domicilio, el cliente puede verificar su producto antes de " +
    "pagarle al mensajero y hasta medírselo. Se contesta en corto y con seguridad, en una o dos " +
    "frases: primero lo de las 24 horas, después lo de revisarlo y medírselo antes de pagar. " +
    "Lo que eso no cubra —cómo se hace el cambio, quién lo recoge—, lo pasa un representante.",

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
    "Se lo enviamos dentro de 24 a 48 horas.",
  ],
};
