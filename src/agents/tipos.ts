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
  /** Cuánto cuesta el envío aquí, en la moneda del país. */
  costo: number;
  /** Cómo llega el pedido: a domicilio con mensajero, por correo, retira… */
  modalidad: string;
  /** Cómo y cuándo se paga en esta zona. Sin esto, vale la forma general. */
  pago?: string;
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
    restoDelPais: { costo: number; modalidad: string; pago?: string; lugares?: string[] };
    /** Cómo se da una dirección en este país, y qué dato la sitúa. */
    direccion: string;
    /** Sin estos datos no se levanta la orden. Los del país, no los del pedido. */
    datosParaCerrar: string[];
  };

  // ── Pago ───────────────────────────────────────────────────────────────
  /**
   * La forma de pago general del país, en una o dos frases. Null = NO
   * CONFIGURADA: el agente no la inventa y, si el cliente pregunta, transfiere.
   */
  pago: string | null;

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
  };

  // ── El pie del resumen ─────────────────────────────────────────────────
  /**
   * Las líneas que van debajo del resumen del pedido, en este orden: lo que le
   * quita el miedo al cliente justo cuando acaba de dar su dirección.
   */
  pieDelResumen: string[];
}
