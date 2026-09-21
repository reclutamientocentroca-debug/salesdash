/**
 * Del anuncio al producto, y del producto al precio.
 *
 * LA REGLA (la dueña, 2026-09-17): el precio lo manda el anuncio, NUNCA el
 * modelo y NUNCA el catálogo por encima de él. El anuncio es lo que el
 * cliente vio y lo que este negocio publicó; el catálogo llena lo que el
 * anuncio no dice —el nombre para hablar igual, las variantes, y el precio
 * cuando el anuncio de verdad no trae ninguno—. Si el vínculo del anuncio en
 * el catálogo está mal hecho, eso ya no cambia el precio: lo único que
 * cambia es que no hay variantes de más que ofrecer.
 *
 * Y cuando el anuncio no está vinculado a ningún producto, tampoco se suelta
 * el lead: se vende con lo que el propio anuncio dice, que también lo
 * publicó y lo pagó este negocio.
 *
 * Lo que sigue intacto es no inventar. Un agente que se inventa un precio
 * hace una venta a un precio que el negocio no puede sostener, y el cliente
 * ya lo leyó: no hay forma de desdecirlo sin quedar mal. Sin precio en
 * ningún sitio —ni el anuncio, ni el catálogo— no se cotiza: se pasa el
 * hilo a una persona.
 */
import { anuncioMetaPorAdId, fotoDelAnuncio, productoPorId, registrarAnuncioVisto, type Conversacion, type Mensaje } from "@/lib/db";
import { descripcionUtil, llegoPorAnuncio } from "@/lib/anuncio";
import { familiasNombradas } from "@/lib/apertura";

export interface ContextoAnuncio {
  adId: string;
  /** Qué hacer con este hilo. */
  puedeCotizar: boolean;
  producto: { nombre: string; precio: number | null; variantes: string | null } | null;
  /** Por qué no se puede cotizar, para la anomalía y para el panel. */
  motivo:
    | "vinculado"
    | "sin_vincular"
    | "producto_borrado"
    | "producto_inactivo"
    | "sin_precio"
    | "producto_ajeno";
  /**
   * QUÉ DECÍA EL ANUNCIO. Su texto, y lo que se lee en su imagen.
   *
   * Se guardaban las dos cosas y no las leía nadie: el agente sabía el TÍTULO
   * del anuncio y nada más. En la publicidad de Facebook el precio, los colores
   * y las tallas van escritos ENCIMA de la foto la mitad de las veces, así que
   * el cliente escribía «quiero la del anuncio, la azul» y el agente no tenía
   * ni idea de qué azul le hablaban.
   */
  texto: string | null;
  descripcionImagen: string | null;
}

/**
 * Resuelve el anuncio que trajo al cliente.
 *
 * Deja constancia del anuncio ANTES de resolverlo, siempre. El `ad_id` llega en
 * el referral del primer mensaje del hilo y en ningún otro sitio: si no se
 * guarda en ese instante, el dueño no tiene forma de vincularlo después —
 * tendría que adivinar el identificador de un anuncio que ya pasó—. Guardarlo
 * sin producto es exactamente lo que llena la lista de «anuncios por vincular».
 */
export function resolverAnuncio(
  orgId: number,
  adId: string,
  titulo: string | null = null,
): ContextoAnuncio {
  registrarAnuncioVisto(orgId, adId, titulo);

  const fila = anuncioMetaPorAdId(orgId, adId);

  // Lo que decía el anuncio vale igual esté o no vinculado a un producto: es
  // lo que el cliente vio antes de escribir.
  const dicho = {
    texto: fila?.texto?.trim() || null,
    descripcionImagen: descripcionUtil(fila?.descripcion_imagen),
  };

  if (!fila || fila.producto_id === null) {
    return { adId, puedeCotizar: false, producto: null, motivo: "sin_vincular", ...dicho };
  }

  // El producto se borró del catálogo pero el anuncio sigue apuntándolo.
  if (fila.producto_nombre === null) {
    return { adId, puedeCotizar: false, producto: null, motivo: "producto_borrado", ...dicho };
  }

  const producto = {
    nombre: fila.producto_nombre,
    precio: fila.producto_precio,
    variantes: fila.producto_variantes,
  };

  // Apagado en el catálogo: el dueño dijo que ahora mismo no se vende.
  if (fila.producto_activo === 0) {
    return { adId, puedeCotizar: false, producto, motivo: "producto_inactivo", ...dicho };
  }

  /*
   * Vinculado pero sin precio. `precio` es opcional en el catálogo, así que
   * este caso existe de verdad, y es el más traicionero: el producto está bien
   * y el agente creería que puede hablar de dinero. No puede — no hay dinero
   * que decir.
   */
  if (producto.precio === null) {
    return { adId, puedeCotizar: false, producto, motivo: "sin_precio", ...dicho };
  }

  // Vinculado a otra cosa: el anuncio vende un cepillo y el producto es una
  // bota. Ver `elProductoNoEsDelAnuncio`: manda lo que el cliente vio.
  if (elProductoNoEsDelAnuncio(producto, dicho)) {
    return { adId, puedeCotizar: false, producto, motivo: "producto_ajeno", ...dicho };
  }

  return { adId, puedeCotizar: true, producto, motivo: "vinculado", ...dicho };
}

/**
 * ¿EL PRODUCTO VINCULADO ES DE LO QUE HABLA EL ANUNCIO?
 *
 * El caso de la dueña (Costa Rica, 2026-09-10): un anuncio de «CEPILLO secador
 * + PLANCHA, llévate los 2 por ₡15.500» estaba vinculado a «Bota MR, ₡42.750»,
 * y el agente abrió el chat vendiéndole las botas a quien había pinchado en el
 * combo: «Bota MR · ₡42.750 · ¿Qué número calza?». El prompt le decía, con esas
 * palabras, que el producto del catálogo manda sobre lo que dijera el anuncio.
 *
 * Y manda —para el PRECIO, que es lo que se actualiza en el catálogo y no en un
 * anuncio viejo—. Pero cuando lo vinculado es de otra familia, eso no es un
 * precio actualizado: es una vinculación equivocada, y seguirla es contestarle
 * a un cliente con un artículo que él no vio.
 *
 * Solo decide cuando las DOS partes nombran algo reconocible y no coinciden en
 * nada: un producto llamado «Roplis 3» o un anuncio sin palabras de artículo no
 * acusan a nadie. Ver `familiasNombradas`.
 */
function elProductoNoEsDelAnuncio(
  producto: { nombre: string },
  dicho: { texto: string | null; descripcionImagen: string | null },
): boolean {
  const delProducto = familiasNombradas(producto.nombre).map((f) => f.familia);
  if (!delProducto.length) return false;

  // El texto manda; la lectura de la imagen solo acompaña. Se miran los dos:
  // un anuncio que es solo foto no tiene texto que comparar.
  const delAnuncio = familiasNombradas([dicho.texto, dicho.descripcionImagen].filter(Boolean).join(" "))
    .map((f) => f.familia);
  if (!delAnuncio.length) return false;

  return !delProducto.some((f) => delAnuncio.includes(f));
}

/** En castellano, para la anomalía que ve el dueño. */
export function explicarMotivo(c: ContextoAnuncio): string {
  switch (c.motivo) {
    case "sin_vincular":
      return `El anuncio ${c.adId} no está vinculado a ningún producto. El agente no cotiza y el hilo pasa a una persona.`;
    case "producto_borrado":
      return `El anuncio ${c.adId} apunta a un producto que ya no está en el catálogo.`;
    case "producto_inactivo":
      return `El producto «${c.producto?.nombre}» del anuncio ${c.adId} está apagado en el catálogo.`;
    case "sin_precio":
      return `El producto «${c.producto?.nombre}» del anuncio ${c.adId} no tiene precio en el catálogo.`;
    case "producto_ajeno":
      return (
        `El anuncio ${c.adId} está vinculado a «${c.producto?.nombre}», que no es de lo que habla el anuncio: ` +
        "está mal vinculado. Mientras tanto el agente vende lo que dice el propio anuncio, con su precio, " +
        "y no ofrece ese producto. Revisa la vinculación en Anuncios."
      );
    default:
      return "";
  }
}

/**
 * ¿EL ANUNCIO TRAE SU PROPIO PRECIO ESCRITO? En su texto, o en lo que se leyó
 * de su imagen. Con símbolos genéricos: aquí no se sabe el país del cliente,
 * y los tres —RD$, ₡, B/. o US$— tienen la misma pinta de siempre: el signo
 * pegado a una cifra.
 */
const TRAE_PRECIO = /(?:RD\$|US\$|B\/\.|₡|\$)\s?\d/;
function anuncioTraePrecio(c: { texto: string | null; descripcionImagen: string | null }): boolean {
  return TRAE_PRECIO.test(c.texto ?? "") || TRAE_PRECIO.test(c.descripcionImagen ?? "");
}

/**
 * EL PRECIO DEL CATÁLOGO QUE NO VALE EN ESTE CHAT, para el revisor.
 *
 * La instrucción de arriba ya le dice al modelo que el precio del anuncio
 * manda sobre el del catálogo, pero es una instrucción en prosa, y el modelo
 * puede no seguirla —lo mismo que ya se cuidó con «no inventes un precio»
 * en cada otro sitio de este código—. La captura de la dueña (2026-09-21):
 * un anuncio con su propio precio de $990 vinculado a «Cepillo 5 en 1
 * Multifuncional» del catálogo, a RD$21,150, y el agente cotizó los
 * RD$21,150. Ese número SÍ estaba delante —en la línea del catálogo, para
 * que el modelo supiera el nombre exacto y las variantes— y por eso el
 * revisor, que solo comprueba que el importe esté escrito en algún sitio, no
 * lo paraba: estaba escrito, solo que en el sitio equivocado.
 *
 * Con esto, `revisor.ts` puede parar ESE número en concreto cuando el
 * anuncio trae uno propio, en vez de fiarse de que el modelo elija bien.
 */
export function precioDelCatalogoQueNoAplica(c: ContextoAnuncio): number | null {
  return c.motivo === "vinculado" && c.producto && anuncioTraePrecio(c) ? c.producto.precio : null;
}

/**
 * El bloque que se le añade al prompt.
 *
 * NO sustituye a `anuncioParaModelo`: aquel cuenta qué se le prometió al
 * cliente y este dice qué se puede prometer. Los dos van juntos, y este manda.
 */
export function anuncioParaPrompt(c: ContextoAnuncio): string {
  /*
   * LO QUE EL CLIENTE VIO ANTES DE ESCRIBIR.
   *
   * Va delante de todo lo demás, y se pone esté el anuncio vinculado o no,
   * porque no es permiso para cotizar: es de qué se está hablando. Sin esto el
   * agente sabe el TÍTULO del anuncio y nada más, y a un «quiero la del anuncio,
   * la azul» contesta preguntando de qué producto se trata. En la publicidad de
   * Facebook el precio y los colores van escritos ENCIMA de la foto la mitad de
   * las veces, y ahí no los veía nadie.
   */
  /*
   * EL TEXTO MANDA. La lectura de la imagen la hizo una máquina, y una máquina
   * que ve una prenda sobre una cama puede escribir que el anuncio es de ropa
   * de cama. Se le dice al agente para qué sirve cada línea: el artículo es
   * el que nombra el texto, y la imagen solo aporta lo que va escrito encima.
   */
  const vio: string[] = [];
  if (c.texto) {
    vio.push(
      `Lo que dice el anuncio —ESTO ES LO QUE MANDA: el artículo que se vende es el que se nombra aquí, con este nombre—: ${c.texto}`,
    );
  }
  if (c.descripcionImagen) {
    /*
     * EL ANUNCIO QUE ES SOLO UNA FOTO.
     *
     * Con texto del anuncio delante, la imagen es un apoyo: la leyó una máquina
     * y puede equivocarse de artículo. SIN texto, esa lectura es lo único que
     * se guardó de lo que el cliente vio, y decirle al agente que «solo sirve
     * para el precio» lo dejaba sin artículo ninguno: la dueña vio a la IA
     * contestarle a quien llegó por un anuncio de jeans que le ofrecía los
     * polos del catálogo. Lo que se ve en la foto ES lo que se vende.
     */
    vio.push(
      c.texto
        ? `Lo que una máquina leyó en su imagen —sirve SOLO para el precio, los colores y las tallas escritos encima; si nombra un artículo distinto del texto de arriba, la máquina se equivocó y el artículo sigue siendo el del anuncio—: ${c.descripcionImagen}`
        : `Este anuncio es SOLO una foto, y esto es lo que se ve en ella —el artículo de este chat es ESE, con ese nombre, y en él van también el precio, los colores y las tallas que estén escritos encima—: ${c.descripcionImagen}`,
    );
  }

  const contexto = vio.length
    ? ["ESTO ES LO QUE VIO EL CLIENTE EN EL ANUNCIO ANTES DE ESCRIBIRTE:", ...vio, ""].join("\n")
    : "";

  if (!c.puedeCotizar) {
    /*
     * SIN PRODUCTO DEL CATÁLOGO, PERO CON EL ANUNCIO DELANTE, SE VENDE IGUAL.
     *
     * Antes aquí se soltaba el lead: «que le atienda alguien del equipo». La
     * intención era buena —que el agente no se inventara un precio— pero el
     * efecto era el contrario del que se buscaba: en un negocio que vive de
     * anuncios y no mantiene el catálogo vinculado, ESO ERA TODOS LOS LEADS. El
     * agente contestaba a cada cliente que ya le atendería una persona, y la
     * persona llegaba tarde o no llegaba.
     *
     * El anuncio lo escribió y lo pagó este negocio. Un precio anunciado por el
     * propio dueño no es una invención del modelo: es su precio, y es el que
     * vio el cliente antes de escribir. Vender con eso no rompe la regla de «no
     * inventes precios» — la respeta, porque el precio no sale del modelo.
     *
     * Lo que se pierde es el aviso al dueño de que ese anuncio no está
     * vinculado. No se pierde: sigue creando su anomalía, y el panel se la
     * enseña. Vincularlo sigue siendo mejor —el catálogo se actualiza y un
     * anuncio viejo no— pero ya no es la diferencia entre vender y no vender.
     */
    if (!vio.length) {
      return [
        "IMPORTANTE — este cliente llegó por un anuncio del que no se guardó nada: ni su texto ni lo que se veía en él.",
        "No sabes qué le prometieron, así que no des precios ni condiciones que no estén en tu catálogo o en tus instrucciones.",
        "Pregúntale con naturalidad qué artículo vio, en una sola línea, y sigue desde ahí. NO le propongas tú ninguno del catálogo: él vio algo concreto, y ofrecerle otra cosa es perderlo.",
      ].join("\n");
    }

    return (
      contexto +
      [
        c.motivo === "producto_ajeno"
          ? "El producto que el catálogo tiene pegado a este anuncio es de otra cosa —está mal vinculado— así que NO lo uses ni lo nombres: lo que dice ARRIBA es tu fuente, el artículo que sale ahí y el precio que anuncia son los buenos, y con eso vendes."
          : "Este anuncio no está vinculado a ningún producto del catálogo, así que lo que dice ARRIBA es tu fuente: el artículo que sale ahí y el precio que anuncia son los buenos, y con eso vendes.",
        /*
         * EL CATÁLOGO NO MANDA SOBRE EL ANUNCIO, NUNCA (la dueña, 2026-09-17):
         * ni siquiera cuando por el nombre parece el mismo artículo. Antes esta
         * línea decía lo contrario —que el catálogo ganaba si tenía «ese mismo
         * artículo» a otro precio—, y eso era la misma grieta del vínculo mal
         * hecho: bastaba con que el catálogo tuviera ALGO de nombre parecido.
         */
        "Si el catálogo tiene un artículo de nombre parecido a otro precio, eso NO lo cambia: el precio de este chat es el del anuncio, no el de un artículo parecido del catálogo.",
        /*
         * Y SI NO SABES QUÉ ES O CUÁNTO VALE, SE TRANSFIERE. NO SE CAMBIA DE
         * ARTÍCULO. El caso de la dueña: el cliente pidió tres pantalones y el
         * agente le contestó que no había pantalones pero que le ofrecía unos
         * polos. Se fue. Al transferir, quien atiende escribe en el panel el
         * nombre y el monto de esa foto y a partir de ahí ya se vende sola.
         */
        "EL ARTÍCULO DE ESTE CHAT ES EL DE ARRIBA Y NO HAY OTRO: está PROHIBIDO ofrecerle un artículo distinto —del catálogo o de donde sea— porque del suyo no sepas el nombre o el precio. Nada de «no tenemos eso, pero le ofrezco…».",
        "Si el artículo que vino buscando no tiene precio ni en el anuncio ni en el catálogo, no te lo inventes y no lo cambies por otro: dile en una línea que un representante le pasa la información y escribe \"[HANDOFF]\".",
      ].join("\n")
    );
  }

  const p = c.producto!;

  /*
   * EL CATÁLOGO NO MANDA SOBRE EL ANUNCIO, NUNCA (la dueña, 2026-09-17).
   *
   * Hasta aquí, con el anuncio vinculado a un producto, el precio del
   * catálogo se imponía siempre sobre el del propio anuncio —era la defensa
   * contra un anuncio viejo con un precio que ya subió—. Pero un vínculo
   * puede estar mal hecho sin que sea una familia distinta —«producto_ajeno»
   * no lo ve todo—, y ahí el catálogo terminaba mandando un precio que el
   * cliente nunca vio anunciado. La dueña lo zanjó: lo que diga el anuncio,
   * en su texto o en su imagen, es lo que se cotiza siempre que diga algo. El
   * catálogo solo llena lo que el anuncio no dice —el nombre para hablar
   * igual con el cliente, las variantes, y el precio cuando el anuncio no
   * trae ninguno—.
   */
  /*
   * Y LO MISMO PARA EL NOMBRE, por la misma grieta (la dueña, 2026-09-21): un
   * anuncio de chaqueta vinculado a «Chacabana» en el catálogo —sin que
   * `elProductoNoEsDelAnuncio` lo viera, porque esa comprobación solo acusa
   * cuando las DOS partes nombran una familia reconocible y no coinciden— y
   * el agente le ofrecía al cliente la chacabana, con ese nombre, porque esta
   * misma línea se lo mandaba: «ESE es el artículo... con ese mismo nombre»,
   * usando el nombre del catálogo por encima de lo que el anuncio ya decía.
   *
   * Si el anuncio nombra algo reconocible por su cuenta, ESE nombre es el que
   * manda —ya se le dio arriba, en `contexto`— y el catálogo baja a ser solo
   * precio y variantes: ni siquiera se le enseña el nombre del catálogo, para
   * no ponerle delante dos nombres del mismo artículo y que elija el que no
   * es. Sin nombre propio en el anuncio no hay de dónde sacar uno mejor, y
   * ahí sí vale el del catálogo, que es lo único que hay.
   */
  const anuncioNombraArticulo =
    familiasNombradas([c.texto, c.descripcionImagen].filter(Boolean).join(" ")).length > 0;

  if (anuncioNombraArticulo) {
    const soloDatos = [`— ${p.precio}`];
    if (p.variantes) soloDatos.push(`(${p.variantes})`);

    return (
      contexto +
      [
        `El artículo de este chat es el que ya dice el anuncio ARRIBA, con ese mismo nombre: NO lo cambies por «${p.nombre}», que es el nombre que tiene en el catálogo y puede estar vinculado a otra cosa.`,
        `Del catálogo solo toma esto: ${soloDatos.join(" ")}`,
        anuncioTraePrecio(c)
          ? "PERO EL PRECIO LO MANDA EL ANUNCIO, no el catálogo: si arriba —en su texto, o en lo que se leyó de su imagen— hay un precio escrito, ESE es el que cotizas, tal cual está escrito, y no el del catálogo. El precio del catálogo de arriba solo vale si el anuncio no trae ningún precio escrito en ningún sitio."
          : "Y como el anuncio no traía ningún precio escrito, ese precio del catálogo es el bueno.",
      ].join("\n")
    );
  }

  const partes = [`- ${p.nombre}`];
  if (p.variantes) partes.push(`(${p.variantes})`);
  partes.push(`— ${p.precio}`);

  return (
    contexto +
    [
      "El anuncio que trajo a este cliente corresponde a este producto del catálogo, y ESE es el artículo que vendes en este chat, con ese mismo nombre:",
      partes.join(" "),
      anuncioTraePrecio(c)
        ? "PERO EL PRECIO LO MANDA EL ANUNCIO, no el catálogo: si arriba —en su texto, o en lo que se leyó de su imagen— hay un precio escrito, ESE es el que cotizas, tal cual está escrito, y no el del catálogo. El precio del catálogo de arriba solo vale si el anuncio no trae ningún precio escrito en ningún sitio."
        : "Y como el anuncio no traía ningún precio escrito, ese precio del catálogo es el bueno.",
    ].join("\n")
  );
}

/**
 * LO QUE SE VE EN LA FOTO DE ESTE CHAT: cómo se llama y cuánto vale.
 *
 * Es lo que sostiene la casilla del panel (`ProductoDeLaFoto`). Hay DOS fotos
 * distintas que el agente puede no saber leer, y no se guardan en el mismo
 * sitio:
 *
 *  - LA DEL ANUNCIO. Un anuncio que es solo una imagen no dice cómo se llama
 *    lo que vende ni cuánto vale. Lo que se escriba vale para este cliente y
 *    para todos los que lleguen después por ese anuncio.
 *
 *  - LA QUE MANDA EL CLIENTE A MITAD DE LA CONVERSACIÓN, preguntando por OTRA
 *    cosa. Llegó por un anuncio de camisas y enseña unas botas: eso es SUYO.
 *    Pegarlo al anuncio le cambiaría el artículo a los cientos de clientes que
 *    llegan por esa misma publicidad, así que se guarda en su hilo.
 *
 * De ahí `destino`: dice dónde va lo que se escriba, y la casilla lo enseña
 * para que nadie tenga que adivinarlo.
 *
 * Devuelve null cuando no hay ninguna foto que nombrar. Ahí no se enseña.
 */
export interface FichaDeLaFoto {
  adId: string | null;
  porAnuncio: boolean;
  /** El cliente mandó una foto que no es lo de este chat. */
  fotoDelCliente: boolean;
  /** A quién le vale lo que se escriba: al anuncio (a todos) o solo a este chat. */
  destino: "anuncio" | "chat";
  /** Lo que se ve en esa foto, para no tener que escribir a ciegas. */
  descripcion: string | null;
  nombre: string | null;
  precio: number | null;
}

/** Una foto del cliente que sea de un producto: un comprobante de pago no lo es. */
type FotoDelCliente = Pick<Mensaje, "emisor" | "tipo" | "descripcion_imagen" | "categoria_imagen">;

export function fichaDeLaFoto(
  orgId: number,
  conv: Conversacion,
  mensajes: FotoDelCliente[],
): FichaDeLaFoto | null {
  const porAnuncio = llegoPorAnuncio(conv);

  const anuncio = conv.meta_ad_id ? anuncioMetaPorAdId(orgId, conv.meta_ad_id) : undefined;
  const vinculado = anuncio && anuncio.producto_id !== null && anuncio.producto_nombre !== null;

  /*
   * ¿EL CLIENTE ENSEÑÓ OTRA COSA? Se compara por familias —«botas» contra
   * «camisas»— entre lo que se ve en su foto y EL ARTÍCULO DE ESTE CHAT, que
   * es el del anuncio. El catálogo no entra en la comparación a propósito: que
   * la tienda venda botas en otro anuncio no convierte esa foto en lo que este
   * cliente vino a comprar, y con el catálogo dentro la casilla desaparecía en
   * cuanto se guardaba el primer artículo. Una foto que la máquina no supo
   * nombrar cuenta también: es justo la que el agente no puede cotizar.
   */
  const fotos = mensajes.filter(
    (m) => m.emisor === "cliente" && m.tipo === "imagen" &&
      m.categoria_imagen !== "comprobante_pago" && m.categoria_imagen !== "factura",
  );
  const ultima = fotos.at(-1);
  const deLaFoto = descripcionUtil(ultima?.descripcion_imagen ?? null);

  const loDeEsteChat = [
    conv.producto_anuncio ?? "", conv.descripcion_anuncio ?? "",
    anuncio?.texto ?? "", anuncio?.descripcion_imagen ?? "", anuncio?.producto_nombre ?? "",
  ].join("\n");

  const familiasDeAqui = new Set(familiasNombradas(loDeEsteChat).map((f) => f.familia));
  const familiasDeLaFoto = familiasNombradas(deLaFoto ?? "");
  const enseñaOtraCosa =
    !!ultima && (!familiasDeLaFoto.length || familiasDeLaFoto.some((f) => !familiasDeAqui.has(f.familia)));

  if (!porAnuncio && !ultima) return null;

  /*
   * Sin anuncio de Meta al que pegarlo, el destino es el chat aunque el hilo
   * venga de una publicidad: no hay `ad_id` que vincular.
   */
  const destino: "anuncio" | "chat" = enseñaOtraCosa || !conv.meta_ad_id ? "chat" : "anuncio";

  const delChat = conv.foto_producto_id !== null ? productoPorId(orgId, conv.foto_producto_id) : undefined;
  const puesto = destino === "chat" ? delChat : vinculado ? anuncio : undefined;

  return {
    adId: conv.meta_ad_id ?? null,
    porAnuncio,
    fotoDelCliente: enseñaOtraCosa,
    destino,
    descripcion: destino === "chat" ? deLaFoto : descripcionUtil(anuncio?.descripcion_imagen ?? null),
    nombre: puesto ? ("nombre" in puesto ? puesto.nombre : puesto.producto_nombre) : null,
    precio: puesto ? ("precio" in puesto ? puesto.precio : puesto.producto_precio) : null,
  };
}

/**
 * EL ARTÍCULO QUE EL CLIENTE ENSEÑÓ EN SU FOTO, para el prompt.
 *
 * Una persona ya le puso nombre y precio desde el hilo, así que el agente deja
 * de estar a ciegas: eso es lo que el cliente quiere ahora, y se le vende. Sin
 * este bloque el agente seguiría con el artículo del anuncio —o transfiriendo
 * otra vez por la misma foto—, que es lo que el equipo acaba de resolver.
 *
 * Devuelve null cuando en este hilo no hay ninguna foto resuelta.
 */
export function productoDeLaFotoParaPrompt(orgId: number, conv: Conversacion): string | null {
  if (conv.foto_producto_id === null) return null;
  const p = productoPorId(orgId, conv.foto_producto_id);
  if (!p || p.precio === null) return null;

  return [
    `EL CLIENTE TE ENSEÑÓ OTRO ARTÍCULO EN UNA FOTO, y el equipo ya te dijo cuál es y cuánto vale: ${p.nombre}${p.variantes ? ` (${p.variantes})` : ""} — ${p.precio}.`,
    "ESE es el artículo por el que preguntó en esta conversación: véndeselo con ese nombre y ese precio, aunque llegara por otro anuncio. Ya no transfieres por esa foto ni le dices que no lo tienes.",
    "Si sigue interesado en el del anuncio, también se lo vendes: el que él diga. Y si te enseña un TERCER artículo del que aquí no hay nombre ni precio, ese sí: dile que un representante le pasa la información y escribe \"[HANDOFF]\".",
  ].join("\n");
}

/**
 * LA FOTO DEL ANUNCIO POR EL QUE ESCRIBIÓ ESTE CLIENTE, LISTA PARA MANDAR.
 *
 * Es la imagen que se descargó y se guardó cuando entró el lead —ver la entrada
 * en `ingesta.ts`—, no la URL de Meta, que caduca. Devuelve null cuando el hilo
 * no viene de un anuncio o cuando esa imagen no llegó a guardarse: prometerle
 * una foto que no existe es peor que no ofrecerla.
 *
 * `attachmentId` es el identificador de Meta si ya se subió alguna vez; con él
 * la misma foto no se vuelve a subir aunque la pidan cien clientes.
 */
export function fotoDelHilo(
  orgId: number,
  conv: Conversacion,
): { adId: string; imagen: string; attachmentId: string | null } | null {
  if (!conv.meta_ad_id) return null;
  const foto = fotoDelAnuncio(orgId, conv.meta_ad_id);
  if (!foto?.imagen) return null;
  return { adId: conv.meta_ad_id, imagen: foto.imagen, attachmentId: foto.attachment_id };
}
