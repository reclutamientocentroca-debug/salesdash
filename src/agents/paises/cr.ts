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
  // El nombre de quien atiende es el que diga el panel («Nombre del agente»).
  nombreAgente: null,
  // El de la dueña (2026-09-05), primera línea de su guion (`cr-guion.ts`).
  saludo: "Hola! Bienvenido(a) a <negocio>. Gracias por escribirnos.",
  trato: "usted",

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
        // La dueña (2026-09-04): San José, Heredia, Alajuela y Alajuelita van
        // a domicilio. San José va con su ciudad y sus distritos, como los
        // escribe la gente.
        lugares: [
          "San José",
          "San Jose",
          "Chepe",
          "San José centro",
          "Desamparados",
          "Pavas",
          "Hatillo",
          "Zapote",
          "San Sebastián",
          "Uruca",
          "La Sabana",
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
          // Distritos que la gente escribe sin decir el cantón, y que caen en
          // los cantones de arriba: Sabanilla y San Pedro son Montes de Oca;
          // Guadalupe, Goicoechea; Coronado ya está.
          "Sabanilla",
          "San Pedro de Montes de Oca",
          "Guadalupe de Goicoechea",
        ],
        costo: 3500,
        modalidad: "entrega a domicilio",
        pago: "paga al recibir, como prefiera: en efectivo, por transferencia o por SINPE Móvil",
      },
    ],
    restoDelPais: {
      costo: 3500,
      // Lo que está claramente fuera de la zona de entrega a domicilio: las
      // otras provincias y sus cantones. Lo del Gran Área Metropolitana que no
      // esté en la lista de arriba no se decide aquí: el agente pregunta.
      lugares: [
        "Guanacaste", "Liberia", "Nicoya", "Santa Cruz", "Bagaces", "Carrillo", "Cañas",
        "Abangares", "Tilarán", "Nandayure", "La Cruz", "Hojancha", "Tamarindo", "Sámara",
        "Puntarenas", "Esparza", "Buenos Aires", "Montes de Oro", "Osa", "Quepos", "Golfito",
        "Coto Brus", "Parrita", "Corredores", "Garabito", "Jacó", "Monteverde", "Puerto Jiménez",
        "Ciudad Neily", "Limón", "Pococí", "Guápiles", "Siquirres", "Talamanca", "Matina", "Guácimo",
        "Cahuita", "Puerto Viejo", "Pérez Zeledón", "San Isidro de El General", "Turrialba",
        "Jiménez", "San Carlos", "Ciudad Quesada", "Upala", "Los Chiles", "Guatuso", "Río Cuarto",
        "Sarapiquí", "Puriscal", "Tarrazú", "Dota", "León Cortés", "Acosta", "Turrubares",
        "San Ramón", "Grecia", "Naranjo", "Palmares", "Zarcero", "Sarchí", "Atenas", "Orotina",
        "San Mateo", "Poás", "Zona Sur", "Zona Norte", "Caribe",
      ],
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
      "Cómo quiere pagar, si lo dijo: efectivo, transferencia o SINPE Móvil —es su elección, no la tuya—",
      "Fuera de la zona de entrega a domicilio, el pago por delante: ahí se cobra ANTES de enviar, " +
        "y sin el comprobante no sale el paquete",
    ],
  },

  // ── El mapa ────────────────────────────────────────────────────────────
  // Para RECONOCER un lugar cuando el cliente lo escribe. La tarifa es la
  // misma en todo el país; lo que decide la zona son las listas de arriba.
  mapa: {
    regiones: [
      {
        nombre: "San José (provincia)",
        lugares: [
          "San José centro (Chepe)", "La Sabana", "Pavas", "Hatillo", "Zapote", "San Sebastián",
          "Uruca", "Escazú", "Santa Ana", "Desamparados", "Alajuelita", "Aserrí", "Acosta", "Mora (Ciudad Colón)",
          "Goicoechea (Guadalupe)", "Vázquez de Coronado", "Tibás", "Moravia", "Montes de Oca (San Pedro, Sabanilla)",
          "Curridabat", "Puriscal", "Tarrazú", "Dota", "León Cortés", "Turrubares",
          "Pérez Zeledón (San Isidro de El General)",
        ],
      },
      {
        nombre: "Alajuela (provincia)",
        lugares: [
          "Alajuela centro", "San Ramón", "Grecia", "Naranjo", "Palmares", "Poás", "Atenas", "Orotina",
          "San Mateo", "Zarcero", "Sarchí", "San Carlos (Ciudad Quesada)", "Upala", "Los Chiles",
          "Guatuso", "Río Cuarto",
        ],
      },
      {
        nombre: "Cartago (provincia)",
        lugares: ["Cartago centro", "Paraíso", "La Unión (Tres Ríos)", "Jiménez", "Turrialba", "Alvarado", "Oreamuno", "El Guarco"],
      },
      {
        nombre: "Heredia (provincia)",
        lugares: [
          "Heredia centro", "Barva", "Santo Domingo de Heredia", "Santa Bárbara", "San Rafael", "San Isidro",
          "Belén", "Flores", "San Pablo", "Sarapiquí",
        ],
      },
      {
        nombre: "Guanacaste",
        lugares: [
          "Liberia", "Nicoya", "Santa Cruz", "Tamarindo", "Bagaces", "Carrillo", "Cañas", "Abangares",
          "Tilarán", "Nandayure", "La Cruz", "Hojancha", "Sámara",
        ],
      },
      {
        nombre: "Puntarenas",
        lugares: [
          "Puntarenas centro", "Esparza", "Buenos Aires", "Montes de Oro", "Osa", "Quepos", "Golfito",
          "Coto Brus", "Parrita", "Corredores (Ciudad Neily)", "Garabito (Jacó)", "Monteverde", "Puerto Jiménez",
        ],
      },
      {
        nombre: "Limón",
        lugares: ["Limón centro", "Pococí (Guápiles)", "Siquirres", "Talamanca (Cahuita, Puerto Viejo)", "Matina", "Guácimo"],
      },
    ],
    aviso:
      "OJO: «La Sabana», «Sabanilla» y «Sabana Grande» son barrios y distritos —La Sabana está en " +
      "San José centro y Sabanilla en Montes de Oca—, no productos. Esta tienda NO vende sábanas ni " +
      "nada que se llame así: si un cliente escribe uno de esos nombres, te está diciendo dónde vive. " +
      "«Chepe» es San José; «la GAM» es el Gran Área Metropolitana: San José, Alajuela, Cartago y Heredia.",
  },

  // ── Pago ───────────────────────────────────────────────────────────────
  pago:
    "COMO EL CLIENTE PREFIERA: en efectivo, por transferencia bancaria o por SINPE Móvil. Nunca " +
    "le impongas una forma: si dice cómo quiere pagar, esa es. CUÁNDO se paga depende de la " +
    "zona: en la zona de entrega a domicilio (San José, Heredia, Alajuela, Alajuelita y los " +
    "cantones de la lista) se paga al recibir, en la puerta, con cualquiera de las tres; fuera " +
    "de ella el paquete va por correo y se cobra antes de enviar, por SINPE Móvil o " +
    "transferencia —en efectivo no se puede, porque no hay mensajero que lo reciba—. El número " +
    "de SINPE Móvil o la cuenta se los da el representante después del resumen: tú no los " +
    "tienes y NO SE LOS INVENTES.",
  pagoAlCliente:
    "Paga como prefiera: en efectivo, por transferencia o por SINPE Móvil. En San José, Heredia, " +
    "Alajuela y Alajuelita se lo llevamos a domicilio y paga al recibir; fuera de esa zona va por " +
    "correo y se paga antes del envío, por SINPE o transferencia.",

  // ── Ubicación ──────────────────────────────────────────────────────────
  ubicacion: {
    tiendaFisica: "Somos tienda virtual y enviamos a todo el país. No tenemos tienda física.",
    alRecibirMapa:
      "Esa ES su dirección. La tomas como buena, se lo confirmas en corto —«Perfecto, ya me " +
      "llegó su ubicación en <cantón>»—, le dices que el envío son ₡3.500 y cómo le llega según " +
      "la zona, y sigues con lo que falte. Esa dirección la escribes TAL CUAL en el resumen, con " +
      "el cantón y la provincia que se entiendan de ella. Nunca escribas «ubicación compartida» " +
      "ni dejes esa línea en blanco, y nunca le vuelvas a pedir la dirección.",
  },

  // ── Tallas ─────────────────────────────────────────────────────────────
  tallas: {
    usaTablaBase: true,
    zapatoEn: "numeración europea (de la 39 a la 45)",
    conTallaYColor: [],
    // Cepillos y abejones: la dueña (2026-09-05), «sin talla ni color, no las preguntes».
    sinTallaNiColor: ["Cepillos", "Abejones", "Planchas", "Mochilas", "Bolsos", "Carteras", "Gorras", "Relojes", "Accesorios"],
    // Una plancha, un electrodoméstico o cualquier cosa que no sea ropa ni
    // calzado: no se pide talla ni color, solo se ofrece y se vende.
    soloRopaYCalzado: true,
    notas: [
      "La talla se pide como la pida el anuncio: por letra o por número, nunca al revés.",
      "Los polos y los bóxers van como las camisas: de la S a la XXL.",
    ],
  },

  // ── Mayoreo ────────────────────────────────────────────────────────────
  // La dueña (2026-09-05): de 3 unidades en adelante va el precio por mayor,
  // SOLO si la descripción del producto lo trae; si no lo trae, se transfiere.
  mayoreo: {
    vende: true,
    agenteCotiza: true,
    desde: 3,
  },

  // ── Cambios y devoluciones ─────────────────────────────────────────────
  // PENDIENTE DE CONFIRMAR: mientras no haya política, se transfiere.
  politicaDeCambios: null,

  // ── Cómo habla la gente ────────────────────────────────────────────────
  habla: {
    descripcion:
      "Costarricense, FORMAL Y EDUCADA: de usted siempre, con cortesía tica en cada mensaje y " +
      "sin confianzas. Se pide con «¿me regala…?», se agradece con «con mucho gusto», se " +
      "confirma con «¿me confirma?». Un «por favor» y un «muchas gracias» donde caigan " +
      "naturales. Amable y sin prisa, pero siempre avanzando la venta.",
    expresiones: [
      "«con mucho gusto» en lugar de «de nada», y para aceptar cualquier cosa que pida: es la cortesía nacional",
      "«¿me regala su dirección?», «¿me regala su nombre?» para pedir un dato: es la forma cortés de pedir aquí",
      "«¿me confirma?» para cerrar un dato o el pedido",
      "«pura vida» solo al agradecer o al despedirse, una vez y con moderación: nunca para vender",
      "«diay», «ocupo», «mae» y «tuanis» son de confianza: NO van en una venta formal, aunque el cliente los use",
      "NUNCA se llama al cliente «maestro», «jefe», «amigo», «compa» ni ningún apodo: es un trato de empresa, de usted, por su nombre si lo dio o sin nada",
    ],
  },

  // ── El pie del resumen ─────────────────────────────────────────────────
  pieDelResumen: [
    "Somos tienda virtual y enviamos a todo el país.",
    "Se lo enviamos dentro de 24 a 48 horas.",
  ],
};
