/**
 * SalesDash — la forma de un agente de país.
 *
 * TRES AGENTES, UN SOLO COMPORTAMIENTO.
 *
 * Cómo se vende —el orden de las preguntas, cuándo se manda el resumen, cuándo
 * se transfiere— está escrito UNA vez, en `base-comportamiento.ts`, y es el
 * mismo para los tres países. Lo que cambia de un país a otro es solo
 * información: cómo se llama la tienda, en qué moneda cobra, cuánto cuesta el
 * envío y a dónde, con qué se paga, qué tallas maneja y cómo habla la gente.
 * Eso es lo que cabe en este tipo y NADA más: si un campo de aquí describe
 * cómo conversar, está en el sitio equivocado.
 *
 * Cada archivo de `paises/` rellena esta forma con los datos de SU país. El
 * prompt de un canal se arma en tiempo de ejecución con la base más UN solo
 * archivo de país —el del país del canal— y nunca ve los de los otros dos.
 *
 * Los datos que no se saben se dejan en `null`, nunca inventados: el
 * comportamiento base sabe qué hacer con un dato que falta (lo pasa a un
 * representante), y no sabe qué hacer con uno falso.
 */

export interface ZonaDeEnvio {
  /** Cómo se le nombra la zona al cliente: «Gran Santo Domingo». */
  nombre: string;
  /**
   * Los lugares que la identifican, tal como salen en la provincia que devuelve
   * el mapa o en la dirección que escribe el cliente. Se comparan sin tildes ni
   * mayúsculas, y basta con que el lugar aparezca dentro del texto: «Santo
   * Domingo» reconoce «Santo Domingo Este».
   */
  lugares: string[];
  /**
   * LOS QUE CAEN DENTRO DEL NOMBRE DE LA ZONA Y NO COBRAN COMO ELLA.
   *
   * Boca Chica está en la provincia de Santo Domingo y la gente la escribe así
   * —«Calle 5, Boca Chica, Santo Domingo»—, pero su envío es el del interior
   * (la dueña, 2026-09-09). Sin esto, el «Santo Domingo» de la dirección la
   * metía en la zona de la ciudad y le cobraba de menos.
   */
  excepciones?: string[];
  /** Cuánto cuesta el envío aquí, en la moneda del país. */
  costo: number;
  /** Cómo llega el pedido: a domicilio con mensajero, por correo, retira… */
  modalidad: string;
  /** Cómo y cuándo se paga en esta zona. Sin esto, vale la forma general. */
  pago?: string;
  /**
   * EN DOS PALABRAS, PARA EL MAPA: «A DOMICILIO, paga al recibir».
   *
   * Con ella cada lugar del mapa lleva escrito al lado cómo le llega el
   * pedido. Sin ella se pone el nombre de la zona con su tarifa, que es lo
   * que distingue a las zonas donde lo que cambia es el precio.
   */
  etiqueta?: string;
}

/** Un tramo de la lista de precios: de tantas a tantas unidades, a tanto cada una. */
export interface TramoDePrecio {
  desde: number;
  /** Null = de ahí en adelante. */
  hasta: number | null;
  /** Lo que cuesta CADA unidad dentro del tramo. */
  precio: number;
}

/** La lista de precios por cantidad de UN artículo. Ver `mayoreo.escalas`. */
export interface EscalaDePrecio {
  /** Cómo se llama en el prompt: «Polos». */
  articulo: string;
  /** Cómo lo nombran el anuncio y el catálogo, para reconocerlo. */
  palabras: string;
  /** Los tramos, de menos unidades a más. El primero es el precio de siempre. */
  tramos: TramoDePrecio[];
}

export interface DatosPais {
  /** ISO 3166-1 alfa-2 en minúsculas: el mismo código que lleva el canal. */
  codigo: string;
  nombre: string;

  // ── Identidad ──────────────────────────────────────────────────────────
  /** Nombre de la tienda. Vacío = el del perfil de WhatsApp del número. */
  tienda: string;
  /** Con qué nombre de persona atiende. Null = el que diga el panel. */
  nombreAgente: string | null;
  /**
   * La frase EXACTA con la que abre la conversación. Admite `<agente>` y
   * `<negocio>` como marcadores. Sin líneas en blanco dentro: el saludo sale en
   * su propio globo y una línea en blanco lo partiría en dos.
   */
  saludo: string;
  /** De usted o de tú. Es lo primero que delata a un agente de fuera. */
  trato: "usted" | "tu";

  // ── Moneda ─────────────────────────────────────────────────────────────
  moneda: {
    codigo: string;
    /** Como lo escribe la gente del país: «RD$», «₡», «US$». */
    simbolo: string;
    nombre: string;
    /** Un importe de ejemplo, escrito como allí se escribe. */
    ejemplo: string;
    /** Con qué se separan los miles al escribir un importe. */
    miles: "," | ".";
    /** Cuántos decimales lleva un importe. 0 = ninguno. */
    decimales: number;
  };

  // ── Envío ──────────────────────────────────────────────────────────────
  envio: {
    /** En una frase: a dónde se envía y qué cambia por zona. */
    cobertura: string;
    /** Las zonas con condiciones propias. Puede estar vacío. */
    zonas: ZonaDeEnvio[];
    /**
     * Lo que vale para todo lo que no caiga en ninguna zona de arriba.
     *
     * `lugares` son las provincias y ciudades que se reconocen como «resto»
     * cuando el cliente las escribe: con ellas el agente le dice la tarifa
     * del interior de una vez, sin preguntarle la provincia otra vez.
     */
    restoDelPais: {
      costo: number;
      modalidad: string;
      pago?: string;
      lugares?: string[];
      /** La misma etiqueta corta de `ZonaDeEnvio.etiqueta`, para el mapa. */
      etiqueta?: string;
    };
    /** Cómo se da una dirección en este país, y qué dato la sitúa. */
    direccion: string;
    /** Sin estos datos no se levanta la orden. Los del país, no los del pedido. */
    datosParaCerrar: string[];
  };

  // ── El mapa ────────────────────────────────────────────────────────────
  /**
   * EL MAPA DEL PAÍS: los lugares que la gente escribe, agrupados por región
   * o provincia, para que un nombre de lugar se lea como lugar.
   *
   * Existe por un caso real: un cliente escribió el nombre de su sector y el
   * agente lo leyó como un producto —en República Dominicana hay barrios que
   * se llaman «Sabana Perdida» o «Sabana de la Mar», y en Costa Rica está
   * «La Sabana»—. Con el mapa delante, el modelo sabe que eso es una
   * dirección, la sitúa en su provincia y le dice al cliente su envío.
   *
   * Es para RECONOCER, no para tarifar: la tarifa la deciden `envio.zonas`
   * y `envio.restoDelPais.lugares`, que son del dueño.
   */
  mapa: {
    /** Cada región con los lugares que la gente escribe, tal cual los escribe. */
    regiones: { nombre: string; lugares: string[] }[];
    /** Nombres que se confunden con otra cosa, y qué son de verdad. Null si no hay. */
    aviso: string | null;
  };

  // ── Pago ───────────────────────────────────────────────────────────────
  /**
   * La forma de pago general del país, en una o dos frases. Null = NO
   * CONFIGURADA: el agente no la inventa y, si el cliente pregunta, transfiere.
   */
  pago: string | null;
  /**
   * CÓMO SE PAGA, DICHO AL CLIENTE tal cual. `pago` está escrito para el
   * agente; esto está escrito para el cliente, y lo manda el sistema sin
   * modelo cuando el revisor paró la respuesta y el cliente había preguntado
   * eso. Null = no se contesta solo.
   */
  pagoAlCliente: string | null;

  // ── Ubicación ──────────────────────────────────────────────────────────
  ubicacion: {
    /** Respuesta fija cuando preguntan dónde están o si hay tienda física. */
    tiendaFisica: string;
    /** Qué hace cuando el cliente comparte su ubicación por el mapa. */
    alRecibirMapa: string;
  };

  // ── Tallas ─────────────────────────────────────────────────────────────
  tallas: {
    /** Si usa la tabla interna del archivo base (correa, zapato, pantalón…). */
    usaTablaBase: boolean;
    /** En qué numeración se da el calzado, y cómo se acepta la otra. */
    zapatoEn: string | null;
    /** Artículos que SÍ llevan talla y color aunque no lo parezca. */
    conTallaYColor: string[];
    /** Artículos que NO llevan talla ni color: no se preguntan. */
    sinTallaNiColor: string[];
    /** Solo la ropa y el calzado llevan talla; lo demás, nunca. */
    soloRopaYCalzado: boolean;
    /** Lo que haga falta añadir, en frases sueltas. */
    notas: string[];
  };

  // ── Mayoreo ────────────────────────────────────────────────────────────
  mayoreo: {
    /** Si la tienda vende al por mayor. Null = no se sabe: se transfiere. */
    vende: boolean | null;
    /** Si el agente puede cotizar mayoreo. False = lo pasa a un representante. */
    agenteCotiza: boolean;
    /** A partir de cuántas unidades es mayoreo. Null = no se sabe. */
    desde: number | null;
    /**
     * LA LISTA DE PRECIOS POR CANTIDAD, artículo por artículo.
     *
     * Lo que la dueña dicta cuando dice «los polos, de 1 a 2 a RD$1,400; de 3
     * a 11, a RD$1,190; por docena, a RD$990 cada uno». Sin esto, el precio
     * del anuncio era el único que existía: tres polos se cobraban al precio
     * de uno por tres, y a quien preguntaba por la docena se le pasaba a un
     * representante porque el agente no tenía la cifra.
     *
     * Es una lista de PRECIOS, no de descuentos: cada tramo dice lo que cuesta
     * CADA UNIDAD dentro de él. El primero es el precio de siempre, el mismo
     * que lleva escrito el anuncio, y por eso se comprueba: la escala solo se
     * aplica cuando el precio del anuncio es ese. Un polo anunciado a otro
     * precio es otro polo, y ahí no hay escala que valga.
     */
    escalas?: EscalaDePrecio[];
  };

  // ── Cambios y devoluciones ─────────────────────────────────────────────
  /** La política, en una o dos frases. Null = no configurada: se transfiere. */
  politicaDeCambios: string | null;

  // ── Cómo habla la gente ────────────────────────────────────────────────
  habla: {
    /** El tono del país en una frase. */
    descripcion: string;
    /** Expresiones con su uso al lado. Se citan enteras, no se recortan. */
    expresiones: string[];
    /**
     * LO QUE EL AGENTE NO DICE NUNCA EN ESTE PAÍS, aunque el cliente sí lo
     * diga. Sin comillas y en minúscula, tal cual se escribiría.
     *
     * No es lo mismo que dejarlo fuera de `expresiones`: lo que no está en la
     * lista el modelo lo dice igual si lo sabe —y «pura vida» lo sabe—. Esto
     * se le prohíbe en el prompt Y lo para el revisor, así que no depende de
     * que el modelo obedezca. Y sigue contando como saludo de aquí y no como
     * nombre de nadie: ver `expresionesDelPais` en `lib/memoria.ts`.
     */
    prohibidas?: string[];
    /**
     * CÓMO LLAMA LA GENTE DE AQUÍ A LO QUE SE VENDE, cuando la palabra del
     * país no es la del catálogo.
     *
     * NO son artículos distintos: son el mismo con otro nombre, y por eso van
     * aquí y no en el catálogo. El caso que lo trajo (Costa Rica, 2026-09-09):
     * en cuanto el cliente escribía «faja» —que aquí es el cinturón— el agente
     * lo leía como algo que la tienda no vende y pasaba el chat a una persona.
     * Cada línea se escribe entera, como se le dice al modelo.
     */
    sinonimos?: string[];
  };

  // ── El pie del resumen ─────────────────────────────────────────────────
  /**
   * Las líneas que van debajo del resumen del pedido, en este orden: lo que le
   * quita el miedo al cliente justo cuando acaba de dar su dirección.
   */
  pieDelResumen: string[];
}
