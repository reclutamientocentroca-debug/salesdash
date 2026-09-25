/**
 * SalesDash — acceso a datos.
 *
 * Este es el ÚNICO módulo con SQL de negocio. Ningún componente, ninguna ruta
 * de API escribe SQL: todo pasa por aquí. Si algún día hay que migrar a
 * Postgres, se reemplaza este archivo y la aplicación no se entera.
 *
 * REGLA INNEGOCIABLE DE AISLAMIENTO
 * Toda función que lea o escriba datos de negocio recibe `orgId` como primer
 * parámetro y lo aplica en un `WHERE org_id = ?`. No existe una función que
 * devuelva datos de más de una organización. Las consultas que cruzan
 * organizaciones viven, todas, en `admin-db.ts`.
 *
 * Las dos excepciones están marcadas con EXCEPCIÓN y justificadas en el sitio:
 * la capa de identidad (crear cuenta, buscar por correo) y la resolución del
 * canal en el webhook, que no recibe `org_id` sino que lo deduce.
 */
import Database from "better-sqlite3";
import type { Database as DB, Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { obtenerPais, paisDeTelefono } from "./paises";
import { desfaseMs, husoDelServidor, periodoEnHuso } from "./rango";

// ─────────────────────────────────────────────────────────────────────────────
// Modelos por defecto
// ─────────────────────────────────────────────────────────────────────────────

/*
 * LOS MODELOS SE RETIRAN, Y CUANDO SE RETIRAN EL PANEL SE QUEDA MUDO.
 *
 * Aquí vivía `meta-llama/llama-3.3-70b-instruct:free`. OpenRouter dejó de
 * servirlo —la variante gratuita ya no está en su catálogo— y toda cuenta que
 * siguiera con él tenía el agente pidiendo respuestas a un modelo que no
 * existe: cada llamada fallaba, el agente se callaba por su regla de oro, y no
 * había nada roto que mirar. El análisis de ventas, con el mismo modelo por
 * defecto, tampoco extraía un pedido.
 *
 * NO SON EL MISMO, y se intentó: durante un despliegue los dos corrieron con el
 * modelo pequeño para gastar menos, y la prueba contra el modelo de verdad
 * enseñó lo que costaba. Con el mismo guion y el mismo cliente, el pequeño se
 * saltó la talla, tomó «la M» por una dirección y facturó un «envío a la M»; el
 * mediano siguió el camino entero y cerró el pedido. Las reglas no arreglan un
 * modelo que no las sostiene.
 *
 * Así que cada uno donde hace falta:
 *
 *  - EL AGENTE escribe a los clientes y decide si una venta se cierra. Sostener
 *    un guion de veinte reglas mientras el cliente contesta desordenado es
 *    justo lo que un modelo pequeño no hace. Ahí va el mediano.
 *  - EL ANALISTA lee un hilo YA CERRADO y saca producto, total y envío. Es
 *    trabajo mecánico y es donde está el volumen —una llamada por venta y otra
 *    por barrido—, así que ahí el pequeño va perfecto y es donde de verdad se
 *    ahorra.
 *
 * Ninguno es gratuito a propósito: los modelos gratuitos tienen cupo diario y
 * enmudecen a media tarde, que es exactamente el fallo que no se puede tener en
 * un número que atiende clientes.
 *
 * El respaldo es la red: si el principal falla o topa su límite, `ia.ts` lo
 * intenta una vez con este antes de rendirse.
 */
export const MODELO_AGENTE = "openai/gpt-luna-latest";
export const MODELO_ANALISIS = "openai/gpt-4o-mini";
/** Para leer imágenes: facturas, comprobantes y la creatividad del anuncio. */
export const MODELO_VISION = "openai/gpt-4o-mini";
/**
 * EL RESPALDO ES DE OTRA CASA A PROPÓSITO.
 *
 * Un respaldo solo entra cuando el principal falla o topa su límite, y si es el
 * mismo modelo —o del mismo proveedor— falla con él: cuando OpenAI se cae, se
 * cae para los dos. Este cuesta más por mensaje y da igual, porque en un día
 * normal no manda ni uno; lo que paga es la venta que no se pierde la tarde que
 * el principal deja de contestar.
 */
export const MODELO_RESPALDO = "anthropic/claude-sonnet-5";
/**
 * Para oír las notas de voz, y NO es el de todo lo demás.
 *
 * `gpt-4o-mini` lee imágenes pero no oye: mandarle un audio devuelve un error, y
 * la nota de voz del cliente se quedaría en «[nota de voz]» sin que nadie
 * entendiera por qué. Bastantes menos modelos oyen que ven, así que este se
 * queda donde está.
 */
export const MODELO_AUDIO = "google/gemini-3.5-flash-lite";

/** El que se retiró. Solo lo usa la migración, para saber a quién rescatar. */
const MODELO_RETIRADO = "meta-llama/llama-3.3-70b-instruct:free";

// ─────────────────────────────────────────────────────────────────────────────
// Esquema
// ─────────────────────────────────────────────────────────────────────────────

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#12876a',
  meta_cobertura INTEGER NOT NULL DEFAULT 90,
  /* 90 y 85: la IA tiene que cerrar 9 de cada 10 y el equipo vender a 85 de
     cada 100 hilos que toca. Son las metas del negocio, no un adorno. */
  meta_efectividad INTEGER NOT NULL DEFAULT 85,
  marcador_cierre TEXT NOT NULL DEFAULT 'Resumen:',
  modelo_analisis TEXT NOT NULL DEFAULT '${MODELO_ANALISIS}',
  modelo_vision TEXT NOT NULL DEFAULT '${MODELO_VISION}',
  modelo_audio TEXT NOT NULL DEFAULT '${MODELO_AUDIO}',
  suspendida INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT CHECK(rol IN ('dueno','miembro')) NOT NULL DEFAULT 'dueno',
  superadmin INTEGER NOT NULL DEFAULT 0,
  /* El registro es directo: la cuenta nace utilizable. La columna se conserva
     porque la interfaz y la API la leen, y para no necesitar una migración si
     algún día vuelve a exigirse verificación por correo. */
  verificado INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS canales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  nombre TEXT NOT NULL,
  phone TEXT NOT NULL,
  token_cifrado TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  whapi_channel_id TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  ultimo_evento_at INTEGER,
  agente_activo INTEGER NOT NULL DEFAULT 0,
  /* En este número contesta una IA que no es la nuestra, y el panel solo mira.
     ES EL MODO POR DEFECTO de todo número que se conecta: quien trae su
     WhatsApp aquí ya tiene a alguien contestando —su propio bot— y lo que
     necesita es que se le cuenten las ventas, no que le hablen a sus clientes.
     El panel contesta solo donde se le encienda el agente, y encenderlo apaga
     esto: por número contesta uno, o el otro, o una persona. Nunca dos.
     Distinto de agente_activo: esto no manda ni un mensaje, solo dice de quién
     son los que salen. Sin ello, todo lo que sale de un número atendido por un
     bot ajeno se cuenta como que intervino una persona, y sus ventas se le
     acreditan al equipo en vez de a la IA. */
  contesta_ia INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1,
  /* CÓMO SE LLAMA EL NEGOCIO EN ESTE NÚMERO.

     El nombre del perfil de WhatsApp, tal y como lo ve el cliente en su móvil
     antes de escribir —y el nombre de la página en un canal de Meta—. Lo
     escribe solo el propio socket al conectar; nadie tiene que teclearlo.

     Existe porque el agente saludaba con el nombre de la CUENTA del panel, que
     es un dato interno: quien abrió la cuenta escribió ahí cualquier cosa, y el
     cliente recibía «bienvenido a» un nombre que no es el de la tienda con la
     que cree estar hablando. El nombre bueno es el que el cliente ya está
     viendo arriba del chat. */
  negocio TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(org_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_canales_org ON canales(org_id);

/*
 * QUÉ NÚMERO O PÁGINA PUEDE ATENDER CADA MIEMBRO DEL EQUIPO.
 *
 * Sin ninguna fila para un usuario, ese usuario ve TODO —es lo que ya pasaba
 * antes de que existiera esta tabla, y sigue pasando por defecto—: la dueña
 * pidió repartir números por persona, no obligar a repartirlos. Solo cuando
 * el dueño le marca uno o más canales a un miembro, ese miembro queda
 * limitado a esos y deja de ver —y de poder tocar— las conversaciones de los
 * demás. El dueño nunca se restringe a sí mismo por esta tabla.
 */
CREATE TABLE IF NOT EXISTS equipo_canales (
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canal_id INTEGER NOT NULL REFERENCES canales(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, canal_id)
);
CREATE INDEX IF NOT EXISTS idx_equipo_canales_org ON equipo_canales(org_id);
CREATE INDEX IF NOT EXISTS idx_equipo_canales_user ON equipo_canales(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  canal_id INTEGER NOT NULL REFERENCES canales(id),
  cliente_phone TEXT NOT NULL,
  /* La direccion EXACTA a la que se le contesta a este cliente: su numero
     (...@s.whatsapp.net) o, cuando WhatsApp no lo da, su identificador interno
     (...@lid). No se reconstruye a partir de cliente_phone: con un cliente
     identificado por LID esos digitos no son un telefono y el mensaje se va a
     una direccion que no es de nadie. Nula en los hilos anteriores a esto. */
  cliente_jid TEXT,
  cliente_nombre TEXT,
  origen TEXT,
  producto_anuncio TEXT,
  /* Texto del anuncio que trajo al cliente. El título dice QUÉ producto; esto
     dice qué se le prometió, que es lo que hay que leer para entender la
     conversación que viene detrás. */
  descripcion_anuncio TEXT,
  /* El anuncio de Meta que trajo al cliente. Llega solo en el primer evento
     del hilo, asi que se guarda al vuelo o se pierde. De aqui sale el precio
     del catalogo en cada respuesta posterior. */
  meta_ad_id TEXT,
  intervencion_humana INTEGER NOT NULL DEFAULT 0,
  cerrado_por TEXT CHECK(cerrado_por IN ('ia','humano','abierta','revision')) NOT NULL DEFAULT 'abierta',
  senal_de_cierre TEXT,
  total REAL, envio REAL,
  producto_vendido TEXT, resumen_pedido TEXT,
  justificacion TEXT, datos_faltantes TEXT, motivo_perdida TEXT,
  analizada_at INTEGER,
  /* QUIÉN ATIENDE ESTE HILO. 'ia' o 'humano'.

     Es un interruptor por conversación, no por número: en la misma bandeja hay
     clientes que el agente lleva solo hasta el cierre y otros que un vendedor
     prefiere atender a mano. Hasta ahora eso solo se podía decir apagando el
     agente en el número entero —o sea, para todos los clientes a la vez—. */
  atiende TEXT CHECK(atiende IN ('ia','humano')) NOT NULL DEFAULT 'ia',
  /* CUÁNDO SE LE DEVOLVIÓ EL HILO A LA IA por última vez. Lo que escribió el
     equipo antes de ese momento ya no la calla: el botón manda. */
  devuelta_a_ia_at INTEGER,
  /* LO QUE VENDE EL ANUNCIO POR EL QUE LLEGÓ ESTE CLIENTE, ya leído: nombre,
     precio, precio por mayor, tallas y colores, en JSON. Lo lee
     leerProductoDelAnuncio(), en anuncio.ts.

     El anuncio trae el precio escrito y solo llega en el primer mensaje: si no
     se lee y se guarda en ese momento, a la tercera respuesta el agente ya no
     sabe cuanto vale lo que esta vendiendo y acaba diciendo que un
     representante se lo confirma. Eso es un lead pagado que se cae. */
  producto_lead TEXT,
  fecha_inicio INTEGER NOT NULL DEFAULT (unixepoch()),
  fecha_cierre INTEGER, last_message_at INTEGER,
  UNIQUE(canal_id, cliente_phone)
);
CREATE INDEX IF NOT EXISTS idx_conv_org_fecha ON conversations(org_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_conv_org_estado ON conversations(org_id, cerrado_por);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  whapi_message_id TEXT UNIQUE,
  emisor TEXT CHECK(emisor IN ('cliente','ia','humano')) NOT NULL,
  tipo TEXT CHECK(tipo IN ('texto','imagen','audio','documento','comentario','otro')) NOT NULL DEFAULT 'texto',
  descripcion_imagen TEXT,
  categoria_imagen TEXT CHECK(categoria_imagen IN ('factura','comprobante_pago','foto_producto','otro')),
  /* Lo que dice una nota de voz, en texto. Sin esto un audio es un agujero en
     la conversación: ni el analista ni el agente pueden leerlo, y media venta
     puede cerrarse hablando. */
  transcripcion TEXT,
  media_url TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
-- El barrido de cierres recorre los salientes de una cuenta entera. Con el
-- historial del teléfono dentro, esta tabla pasa de miles de filas a cientos de
-- miles: sin este índice, cada barrido la leería completa.
CREATE INDEX IF NOT EXISTS idx_msg_org ON messages(org_id, emisor);

CREATE TABLE IF NOT EXISTS ai_sent_ids (
  whapi_message_id TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  /* DE QUÉ CANAL ES ESTE AGENTE. 0 = la plantilla de la cuenta.

     Un negocio con un WhatsApp en República Dominicana, otro en Costa Rica y
     otro en Panamá no tiene un vendedor: tiene tres. Cada uno con su país, su
     moneda, su forma de dar una dirección, su guion y hasta su modelo. Cuando
     esto era una fila por cuenta, cambiarle el tono al de Panamá se lo cambiaba
     a los tres.

     El 0 no es un canal: es de dónde SALE un agente nuevo. Al encender el
     agente en un canal recién conectado se copia esa fila entera, así que el
     guion que ya estaba escrito no hay que volver a escribirlo. No es una clave
     foránea justamente por eso —no apunta a ninguna fila de canales— y por
     eso el UNIQUE de abajo funciona: en SQLite dos NULL no chocan, dos ceros
     sí. */
  canal_id INTEGER NOT NULL DEFAULT 0,
  /* CON QUE NOMBRE SE PRESENTA, y por que no es 'Asistente'.
     Lo era, y salia en la primera linea de cada conversacion: "Hola, le asiste
     Asistente de ...". Anuncia una maquina antes que nada, que es justo lo
     contrario de lo que persigue el resto del prompt, y en castellano es hasta
     redundante -le asiste el asistente-. Un nombre de persona no engana a
     nadie: nadie cree que la tienda tenga una empleada llamada Ana esperando a
     las dos de la manana. Lo que hace es no anunciar lo contrario en la
     primera frase. El dueno lo cambia por el que quiera, y si lo cambia por uno
     de maquina el panel se lo dice. Ver revisarAgente en agent.ts. */
  nombre TEXT NOT NULL DEFAULT 'Ana',
  /* CON QUÉ NOMBRE SALUDA. Vacío = el del perfil de WhatsApp de este número,
     que es el que el cliente ya está viendo. Esto es para corregirlo a mano
     cuando el perfil dice una cosa y la tienda se llama de otra. */
  negocio TEXT NOT NULL DEFAULT '',
  tono TEXT NOT NULL DEFAULT 'cercano',
  instrucciones TEXT NOT NULL DEFAULT '',
  /* EL PAÍS EN EL QUE VENDE ESTE CANAL. Código ISO de dos letras, o vacío.
     De aquí sale la moneda, el trato, cómo se dan las direcciones, con qué se
     paga y la caja con la que se valida un pin del mapa. Ver paises.ts. */
  pais TEXT NOT NULL DEFAULT '',
  /* LO QUE VENDE ESTE CANAL, ESCRITO A MANO. Es el catálogo de quien no tiene
     catálogo: la mayoría de estas tiendas vende diez artículos y no va a
     cargarlos uno a uno en una tabla. Vale lo mismo que el catálogo —lo escribe
     el dueño— y por eso el agente puede cotizar con esto delante. Ver
     armarSistema en agent.ts. */
  conocimiento TEXT NOT NULL DEFAULT '',
  /* Si además de lo anterior mira el catálogo de la cuenta. */
  usar_catalogo INTEGER NOT NULL DEFAULT 1,
  /* QUÉ ENTIENDE. Mirar una foto y oír una nota de voz cuestan una llamada al
     modelo por mensaje, así que se pueden apagar por canal. Apagados, el agente
     ve «[imagen]» y «[nota de voz]», que es como estaba antes. */
  ver_imagenes INTEGER NOT NULL DEFAULT 1,
  oir_audios INTEGER NOT NULL DEFAULT 1,
  /* Validar el pin del mapa contra el país antes de darlo por dirección. */
  validar_mapa INTEGER NOT NULL DEFAULT 1,
  modelo TEXT NOT NULL DEFAULT '${MODELO_AGENTE}',
  modelo_respaldo TEXT DEFAULT '${MODELO_RESPALDO}',
  /* Nulos = los de la cuenta. Se pueden elegir por canal porque el que ve y el
     que oye no tienen por qué ser el mismo que el que habla. */
  modelo_vision TEXT,
  modelo_audio TEXT,
  /* CUÁNTO COBRA DE ENVÍO, por zona y en la moneda del país.

     Dos precios porque son dos servicios distintos: donde llega el mensajero
     propio en el día, y el resto del país, que sale por encomienda y el cliente
     retira. Nulos = el dueño no los ha cargado, y entonces el agente tiene
     PROHIBIDO decir un costo de envío. Ver envio.ts: de ahí sale la única
     cifra que puede escribir, y la zona la decide la provincia del pin del
     mapa. */
  envio_cerca REAL,
  envio_lejos REAL,
  pasar_a_humano INTEGER NOT NULL DEFAULT 1,
  silenciar_si_humano INTEGER NOT NULL DEFAULT 1,
  /* CUÁNTO ESPERA ANTES DE CONTESTAR, en segundos.

     Un negocio no contesta en medio segundo. Una respuesta instantánea, y
     encima perfecta, es lo que delata a un bot antes de la segunda frase: el
     cliente deja de hablar con una tienda y empieza a hablar con un sistema.

     Se cuenta desde que ENTRÓ el mensaje del cliente, no desde que el modelo
     termina: si pensar la respuesta ya costó cinco segundos, esos cinco cuentan
     y no se suman. Así el retardo es un mínimo de naturalidad, no un impuesto
     encima de lo que ya se tardó. En 0 contesta en cuanto puede. */
  retardo_seg INTEGER NOT NULL DEFAULT 4,
  horario_activo INTEGER NOT NULL DEFAULT 0,
  horario_desde TEXT, horario_hasta TEXT,
  /* SEGUIMIENTOS. El unico mensaje que el agente manda sin que el cliente
     haya escrito, y por eso va con interruptor propio: el del cliente
     que dejo la conversacion a medias y no volvio. Solo sale en los numeros
     donde el agente ya contesta, nunca en los que solo se vigilan: escribir
     sin que nadie lo espere es lo unico que este panel hace por su cuenta, y
     no puede pasar en un numero ajeno.
     Las columnas recordatorio_entrega* son de un aviso que ya no existe —«su
     pedido va en camino»— y no las lee nadie: se quedan porque quitarlas
     obliga a rehacer la tabla en cada base que ya esta en produccion. */
  recordatorio_visto INTEGER NOT NULL DEFAULT 1,
  recordatorio_visto_horas INTEGER NOT NULL DEFAULT 3,
  recordatorio_entrega INTEGER NOT NULL DEFAULT 1,
  recordatorio_entrega_horas INTEGER NOT NULL DEFAULT 18,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(org_id, canal_id)
);

/* Un seguimiento por conversacion y tipo, y no mas: el UNIQUE es lo que
   impide que un barrido que corre cada pocos minutos le escriba dos veces al
   mismo cliente. */
CREATE TABLE IF NOT EXISTS seguimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('visto','entrega')),
  enviado_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(conversation_id, tipo)
);

/* LO QUE LA TIENDA ANUNCIA, con su precio, leido de los propios anuncios.

   No es el catalogo que escribe la duena a mano —ese es la tabla catalogo— sino lo
   que la publicidad ya dijo ahi fuera: el nombre, el precio, el de por mayor,
   las tallas y los colores tal como salieron en el anuncio. Sirve para el
   cliente que escribe DIAS DESPUES sin pinchar nada —«quiero unos poloches»—,
   que hasta ahora llegaba a un agente sin ningun precio delante.

   Una fila por tienda y producto: el nombre llano es la llave, asi que el
   mismo producto anunciado diez veces se actualiza en vez de duplicarse. */
CREATE TABLE IF NOT EXISTS productos_anunciados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  /* El nombre sin tildes ni mayusculas: la llave con la que se reconoce. */
  nombre_llano TEXT NOT NULL,
  nombre TEXT NOT NULL,
  precio REAL,
  precio_mayor REAL,
  tallas TEXT,
  colores TEXT,
  descripcion TEXT,
  /* De que anuncio salio, para poder mirarlo si algo no cuadra. */
  ad_id TEXT,
  actualizado_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(org_id, nombre_llano)
);

CREATE TABLE IF NOT EXISTS catalogo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  /* DE QUE NUMERO ES ESTE PRODUCTO. 0 = de toda la cuenta, que es como nacio
     el catalogo y lo que sigue valiendo para quien vende en un solo pais.
     Una cuenta con tres paises tiene tres monedas y tres listas de precios, y
     con el catalogo colgado de la cuenta el agente de Costa Rica leia el combo
     dominicano de 1690 como 1690 COLONES y se lo ofrecia. Un producto es de un
     numero o es de todos, y eso lo dice esta columna. */
  canal_id INTEGER NOT NULL DEFAULT 0,
  nombre TEXT NOT NULL,
  variantes TEXT,
  precio REAL,
  activo INTEGER NOT NULL DEFAULT 1,
  /* La foto de referencia, si el producto se importo de un link. Ver
     importar-producto.ts. Es solo para que el panel la ensene: el agente
     vendedor sigue hablando por texto, con lo que hay en variantes. */
  foto_url TEXT,
  /* La descripcion de la pagina del link (su og:description), para que el
     panel la ensene junto a la foto tal como se ve en la tienda. Solo para
     el panel: el agente sigue hablando con lo que hay en variantes. */
  descripcion TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalogo_org ON catalogo(org_id);

/*
 * LOS LINKS DE LA TIENDA DE UN PRODUCTO DEL CATALOGO.
 *
 * Un producto puede tener MAS DE UN link: en Roplis, a veces cada color de un
 * mismo articulo es una ficha separada (un link distinto), no botones dentro
 * de una sola pagina. importado_at en null es "pendiente" -- es lo que mira
 * el ingreso de un lead por anuncio para decidir si hace falta ir a buscarlo,
 * y lo que evita repetir el proceso si ya se hizo. Ver importar-producto.ts
 * y importarLinksDeProducto.
 */
CREATE TABLE IF NOT EXISTS producto_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  producto_id INTEGER NOT NULL REFERENCES catalogo(id),
  url TEXT NOT NULL,
  /* Lo leido de ESTE link en concreto, en JSON: {"colores":[{"color","tallas"}],"tallas":[]}. */
  datos TEXT,
  foto_url TEXT,
  /* La descripcion de ESTE link (su og:description), para el panel. */
  descripcion TEXT,
  importado_at INTEGER,
  error TEXT,
  creado_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_producto_links_producto ON producto_links(producto_id);

/*
 * conversation_id es NULL en las anomalías de canal (webhook caído, canal por
 * debajo de su promedio), que no pertenecen a ninguna conversación. Dos de las
 * seis reglas obligatorias son de ese tipo.
 */
/*
 * ANUNCIO -> PRODUCTO DEL CATÁLOGO.
 *
 * Es la tabla que sostiene la regla del precio. El cliente llega por un anuncio
 * y el anuncio trae un ad_id; de ahí sale el producto, y del producto sale el
 * precio. Sin esta fila el agente NO cotiza: pasa el hilo a una persona.
 *
 * El precio no se guarda aquí a propósito. Vive en catalogo y se lee cuando
 * hace falta: un precio copiado es un precio que se queda viejo, y el día que
 * el dueño lo cambie el anuncio seguiría cotizando el de antes.
 */
CREATE TABLE IF NOT EXISTS anuncios_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  ad_id TEXT NOT NULL,
  producto_id INTEGER REFERENCES catalogo(id),
  titulo TEXT,
  /* El texto del anuncio, tal cual lo escribio el negocio. Es donde suele estar
     el precio cuando el anuncio no esta vinculado a un producto. */
  texto TEXT,
  /* La imagen del anuncio y lo que se ve en ella. La creatividad de Facebook
     lleva el precio y los colores ESCRITOS ENCIMA muchisimas veces, y ahi no
     los ve nadie: el cliente escribe "quiero la del anuncio" y el agente no
     sabe de que habla. Se describe UNA vez por anuncio y se reutiliza para
     todos los leads que traiga, que pueden ser cientos. */
  imagen TEXT,
  descripcion_imagen TEXT,
  /* La publicacion de Facebook que hay detras del anuncio, y su enlace.
     Meta manda el post_id en el referral y nada mas; con el se le pide a la
     Graph API el texto que escribio el negocio -que es donde suele estar el
     precio- y el permalink, para que el dueno pueda abrir el anuncio desde el
     panel y ver de que le estan hablando sus clientes. */
  post_id TEXT,
  enlace TEXT,
  /* EL IDENTIFICADOR DE LA FOTO YA SUBIDA A META.
     Cuando el cliente pide "una foto", se le manda la del anuncio por el que
     escribio. Subirla en cada peticion seria subir la MISMA imagen una vez por
     cliente -un anuncio que funciona trae cientos-, asi que la primera vez se
     sube con is_reusable y Meta devuelve este identificador; a partir de ahi el
     envio es solo esta cadena. Nulo mientras nadie haya pedido una foto de este
     anuncio, que es el caso normal. */
  attachment_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(org_id, ad_id)
);
CREATE INDEX IF NOT EXISTS idx_anuncios_org ON anuncios_meta(org_id);

/*
 * Lo que llegó por el webhook, tal cual, antes de interpretarlo.
 *
 * Se guarda ANTES de procesar y por eso org_id es nulo: un evento de una
 * página que no está conectada también se registra, y es justo el que hay que
 * poder mirar cuando alguien dice «conecté la página y no llega nada». Sin este
 * registro, un webhook que se descarta no deja ni rastro y no hay forma de
 * distinguir «Meta no manda» de «llega y lo tiramos».
 */
CREATE TABLE IF NOT EXISTS eventos_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER REFERENCES orgs(id),
  canal_id INTEGER REFERENCES canales(id),
  objeto TEXT NOT NULL,
  page_id TEXT,
  firma_ok INTEGER NOT NULL,
  procesado INTEGER NOT NULL DEFAULT 0,
  mensajes INTEGER NOT NULL DEFAULT 0,
  detalle TEXT,
  cuerpo TEXT NOT NULL,
  recibido_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_eventos_meta_recibido ON eventos_meta(recibido_at DESC);

CREATE TABLE IF NOT EXISTS anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  conversation_id INTEGER REFERENCES conversations(id),
  canal_id INTEGER REFERENCES canales(id),
  tipo TEXT NOT NULL,
  severidad TEXT CHECK(severidad IN ('alta','media')) NOT NULL DEFAULT 'media',
  detalle TEXT, resuelta INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (conversation_id IS NOT NULL OR canal_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_anom_org ON anomalies(org_id, resuelta);

CREATE TABLE IF NOT EXISTS soporte_accesos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  motivo TEXT NOT NULL,
  estado TEXT CHECK(estado IN ('solicitado','aprobado','rechazado','expirado')) NOT NULL DEFAULT 'solicitado',
  solicitado_at INTEGER NOT NULL DEFAULT (unixepoch()),
  aprobado_at INTEGER,
  expira_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_soporte_org ON soporte_accesos(org_id, estado);

/* Consumo de modelos: alimenta el indicador del agente y la salud del admin. */
CREATE TABLE IF NOT EXISTS uso_modelo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  dia TEXT NOT NULL,
  modelo TEXT NOT NULL,
  proposito TEXT CHECK(proposito IN ('agente','analisis','vision','audio')) NOT NULL,
  exitos INTEGER NOT NULL DEFAULT 0,
  fallos INTEGER NOT NULL DEFAULT 0,
  UNIQUE(org_id, dia, modelo, proposito)
);

/* LOS RECÁLCULOS DEL HISTÓRICO, uno por cuenta y por regla. Guarda las ventas
   por día antes y después, para que el dueño vea qué movió cada cambio de
   regla y no tenga que fiarse. La fila es también la marca de «ya se hizo»:
   un recálculo no se repite en el siguiente arranque. Ver recalculo.ts. */
CREATE TABLE IF NOT EXISTS recalculos (
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  clave TEXT NOT NULL,
  creado_at INTEGER NOT NULL DEFAULT (unixepoch()),
  informe TEXT NOT NULL,
  PRIMARY KEY (org_id, clave)
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Conexión
// ─────────────────────────────────────────────────────────────────────────────

const RUTA_DB =
  process.env.SALESDASH_DB === ":memory:"
    ? ":memory:"
    : process.env.SALESDASH_DB
      ? resolve(process.env.SALESDASH_DB)
      : resolve(process.cwd(), "data", "salesdash.db");

/**
 * La carpeta donde vive todo lo que tiene que sobrevivir a un redespliegue: la
 * base de datos y, desde que se conecta por QR, las sesiones de WhatsApp.
 *
 * Con `:memory:` —las pruebas— no hay carpeta de base, así que se cae a `data/`
 * del proyecto para que nada intente escribir en la raíz del disco.
 */
export function rutaDatos(): string {
  return RUTA_DB === ":memory:" ? resolve(process.cwd(), "data") : dirname(RUTA_DB);
}

// En dev, Next recarga los módulos en caliente; sin esto se abrirían decenas
// de conexiones a la misma base.
const global_ = globalThis as unknown as { __salesdash_db?: DB };

function abrir(): DB {
  if (RUTA_DB !== ":memory:") mkdirSync(dirname(RUTA_DB), { recursive: true });

  const conexion = new Database(RUTA_DB);
  conexion.pragma("journal_mode = WAL");
  conexion.pragma("foreign_keys = ON");
  conexion.exec(DDL);
  migrar(conexion);
  return conexion;
}

/**
 * Migraciones. `CREATE TABLE IF NOT EXISTS` no toca las tablas que ya existen,
 * así que los cambios de forma sobre una base viva van aquí.
 */
function migrar(conexion: DB): void {
  const columnas = (tabla: string) =>
    (conexion.pragma(`table_info(${tabla})`) as { name: string }[]).map((c) => c.name);

  /**
   * AÑADE UNA COLUMNA SI FALTA, Y AGUANTA QUE OTRO LA AÑADA A LA VEZ.
   *
   * Preguntar si la columna está y añadirla después son DOS operaciones, y
   * entre una y otra cabe otro proceso haciendo lo mismo. No es teórico:
   * `next build` levanta tres workers y el arranque de producción puede
   * levantar varios. Los dos ven que falta, los dos lanzan el ALTER, y el
   * segundo revienta con «duplicate column name» y se lleva por delante la
   * ruta que estuviera arrancando. Se reproduce a la primera.
   *
   * El error de columna duplicada significa que la columna YA ESTÁ, que es
   * exactamente lo que se quería: se traga. Cualquier otro sube, porque un
   * ALTER que falla por otro motivo es una base a medio migrar y eso hay que
   * verlo. Toda columna nueva debería entrar por aquí.
   */
  const agregarColumna = (tabla: string, columna: string, tipo = "TEXT") => {
    if (columnas(tabla).includes(columna)) return;
    try {
      conexion.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
    } catch (e) {
      if (!/duplicate column name/i.test((e as Error).message)) throw e;
    }
  };

  /*
   * uso_modelo: el CHECK de `proposito` no admitía 'audio'. Una restricción no
   * se puede ampliar con ALTER en SQLite, así que se reconstruye la tabla —
   * son estadísticas de consumo y se conservan enteras.
   */
  const chequeoUso = (
    conexion.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='uso_modelo'`).get() as
      | { sql?: string }
      | undefined
  )?.sql;

  if (chequeoUso && !chequeoUso.includes("'audio'")) {
    conexion.exec(`
      ALTER TABLE uso_modelo RENAME TO uso_modelo_viejo;

      CREATE TABLE uso_modelo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL REFERENCES orgs(id),
        dia TEXT NOT NULL,
        modelo TEXT NOT NULL,
        proposito TEXT CHECK(proposito IN ('agente','analisis','vision','audio')) NOT NULL,
        exitos INTEGER NOT NULL DEFAULT 0,
        fallos INTEGER NOT NULL DEFAULT 0,
        UNIQUE(org_id, dia, modelo, proposito)
      );

      INSERT INTO uso_modelo (id, org_id, dia, modelo, proposito, exitos, fallos)
        SELECT id, org_id, dia, modelo, proposito, exitos, fallos FROM uso_modelo_viejo;

      DROP TABLE uso_modelo_viejo;
    `);
  }

  // canales: el nombre del negocio tal y como lo ve el cliente.
  /*
   * El catálogo pasa a ser de un número. Lo que ya está se queda «de toda la
   * cuenta» (0): en una cuenta de un solo país eso es exactamente lo de antes,
   * y en una de varios la dueña reparte los productos desde Productos.
   */
  agregarColumna("catalogo", "canal_id", "INTEGER NOT NULL DEFAULT 0");

  /* La foto de referencia del producto, cuando se importó de un link. */
  agregarColumna("catalogo", "foto_url");

  /* La descripción de la página del link, para enseñarla junto a la foto. */
  agregarColumna("catalogo", "descripcion");
  agregarColumna("producto_links", "descripcion");

  /*
   * La imagen del anuncio, en grande. El referral solo trae la MINIATURA que
   * Meta usa de vista previa, y esa es la que se le mandaba al cliente: borrosa
   * al abrirla en el móvil. La grande vive en la publicación y hay que ir a
   * buscarla. Esta marca dice si ya se intentó, para no pedirla en cada mensaje
   * ni dejar fuera a los anuncios que ya estaban guardados.
   */
  agregarColumna("anuncios_meta", "imagen_hd", "INTEGER NOT NULL DEFAULT 0");

  if (!columnas("canales").includes("negocio")) {
    conexion.exec(`ALTER TABLE canales ADD COLUMN negocio TEXT`);
  }

  // agentes: con qué nombre saluda, cuando el del perfil no sirve.
  if (!columnas("agentes").includes("negocio")) {
    conexion.exec(`ALTER TABLE agentes ADD COLUMN negocio TEXT NOT NULL DEFAULT ''`);
  }

  // agentes: las tarifas de envío por zona, para no inventarse el costo.
  if (!columnas("agentes").includes("envio_cerca")) {
    conexion.exec(`ALTER TABLE agentes ADD COLUMN envio_cerca REAL`);
    conexion.exec(`ALTER TABLE agentes ADD COLUMN envio_lejos REAL`);
  }

  // agentes: el retardo con el que contesta, para no responder al instante.
  if (!columnas("agentes").includes("retardo_seg")) {
    conexion.exec(`ALTER TABLE agentes ADD COLUMN retardo_seg INTEGER NOT NULL DEFAULT 4`);
  }

  /*
   * conversations: EL ANUNCIO ACTUAL, aparte del primero.
   *
   * `producto_anuncio` y `descripcion_anuncio` guardan el primer anuncio que
   * trajo al cliente, y no se pisan: es el lead que la publicidad pagó. Pero
   * un cliente que vuelve tres días después por OTRO anuncio pregunta por
   * otro artículo, y el agente cotizaba el de la primera vez. Estas dos
   * guardan el último anuncio por el que escribió; el agente lee estas.
   */
  if (!columnas("conversations").includes("anuncio_actual_producto")) {
    conexion.exec(`
      ALTER TABLE conversations ADD COLUMN anuncio_actual_producto TEXT;
      ALTER TABLE conversations ADD COLUMN anuncio_actual_descripcion TEXT;
      UPDATE conversations SET anuncio_actual_producto = producto_anuncio,
                               anuncio_actual_descripcion = descripcion_anuncio;
    `);
  }

  // conversations: quién atiende este hilo, la IA o una persona.
  if (!columnas("conversations").includes("atiende")) {
    conexion.exec(
      `ALTER TABLE conversations ADD COLUMN atiende TEXT NOT NULL DEFAULT 'ia'`,
    );
  }

  // conversations: cuándo se le devolvió el hilo a la IA por última vez.
  if (!columnas("conversations").includes("devuelta_a_ia_at")) {
    conexion.exec(`ALTER TABLE conversations ADD COLUMN devuelta_a_ia_at INTEGER`);
  }

  // messages: la transcripción de las notas de voz.
  if (!columnas("messages").includes("transcripcion")) {
    conexion.exec(`ALTER TABLE messages ADD COLUMN transcripcion TEXT`);
  }

  // orgs: el modelo que transcribe. Se separa del de visión porque no todos
  // los que ven imágenes oyen audio.
  if (!columnas("orgs").includes("modelo_audio")) {
    conexion.exec(
      `ALTER TABLE orgs ADD COLUMN modelo_audio TEXT NOT NULL DEFAULT 'google/gemini-3.5-flash-lite'`,
    );
  }

  // canales: en este número contesta una IA ajena.
  if (!columnas("canales").includes("contesta_ia")) {
    conexion.exec(`ALTER TABLE canales ADD COLUMN contesta_ia INTEGER NOT NULL DEFAULT 1`);
  }

  // conversations: la descripción del anuncio que trajo al cliente. ALTER ADD
  // COLUMN no reescribe la tabla ni toca una sola fila existente.
  if (!columnas("conversations").includes("descripcion_anuncio")) {
    conexion.exec(`ALTER TABLE conversations ADD COLUMN descripcion_anuncio TEXT`);
  }

  /*
   * canales: de qué es este canal.
   *
   * Una página de Meta ES un canal, no una tabla aparte. Esa decisión es la que
   * hace que todo lo demás salga gratis: métricas por canal, la tabla del
   * dashboard, el interruptor del agente, contesta_ia y el aislamiento por
   * cuenta ya están escritos contra `canales` y funcionan igual con una página
   * que con un número.
   *
   * En un canal de Meta, `phone` guarda el ID de la página. Encaja sin forzar
   * nada: es numérico, y UNIQUE(org_id, phone) sigue diciendo lo mismo —una
   * página no se conecta dos veces en la misma cuenta—.
   */
  if (!columnas("canales").includes("tipo")) {
    conexion.exec(`ALTER TABLE canales ADD COLUMN tipo TEXT NOT NULL DEFAULT 'whatsapp'`);
  }

  /*
   * canales: la cuenta de Instagram enlazada a la página.
   *
   * Los mensajes de Instagram llegan con el ID de la cuenta de IG, no con el de
   * la página, aunque los mande el mismo webhook. Sin esta columna no hay forma
   * de saber a qué canal pertenece un mensaje directo de Instagram.
   */
  if (!columnas("canales").includes("meta_ig_id")) {
    conexion.exec(`ALTER TABLE canales ADD COLUMN meta_ig_id TEXT`);
  }

  /*
   * conversations: por dónde entró este hilo.
   *
   * Va en la conversación y no en el canal porque UNA página produce las tres
   * cosas: mensajes de Messenger, mensajes directos de Instagram y comentarios
   * de anuncios. Son el mismo canal y tres conversaciones distintas.
   */
  if (!columnas("conversations").includes("superficie")) {
    conexion.exec(`ALTER TABLE conversations ADD COLUMN superficie TEXT`);
  }

  /*
   * conversations: el identificador del anuncio que trajo al cliente.
   *
   * EL REFERRAL LLEGA UNA SOLA VEZ. Meta lo manda en el PRIMER evento del hilo
   * y en ninguno más: a partir del segundo mensaje, el anuncio ha desaparecido
   * del evento. Si no se guarda aquí en ese instante, se pierde para siempre —y
   * con él, el único vínculo entre el cliente y el producto que vino buscando—.
   *
   * De esta columna sale el precio en cada respuesta posterior del agente. Es
   * la que sostiene la regla del catálogo.
   */
  if (!columnas("conversations").includes("meta_ad_id")) {
    conexion.exec(`ALTER TABLE conversations ADD COLUMN meta_ad_id` + " TEXT");
  }

  /*
   * conversations: por qué RED entró, 'facebook' u 'instagram'.
   *
   * No es lo mismo que `superficie`: esa dice si se contesta por privado o
   * colgado del comentario. Esta dice de qué app vino, y hace falta aparte
   * porque un comentario no dice a qué red pertenece —`superficie` vale
   * "comentario" tanto si es de un post de Facebook como de Instagram— y sin
   * esta columna la bandeja de Instagram no podría separar sus propios
   * comentarios de los de Facebook.
   */
  if (!columnas("conversations").includes("red")) {
    conexion.exec(`ALTER TABLE conversations ADD COLUMN red TEXT`);
  }

  /*
   * conversations: la dirección exacta a la que se le contesta al cliente.
   *
   * Queda NULA en los hilos que ya existen y se rellena sola con el siguiente
   * mensaje que llegue de ese cliente. No se puede deducir de lo guardado: unos
   * dígitos que son un teléfono y unos que son un LID se ven igual, y adivinar
   * mal es volver a mandar el mensaje a ninguna parte.
   */
  if (!columnas("conversations").includes("cliente_jid")) {
    conexion.exec(`ALTER TABLE conversations ADD COLUMN cliente_jid TEXT`);
  }

  /*
   * conversations: EL ARTÍCULO QUE EL CLIENTE ENSEÑÓ EN UNA FOTO.
   *
   * El caso (2026-09-08): el cliente llega por un anuncio que sí tiene su
   * producto y su precio, y a mitad de la conversación manda OTRA foto
   * preguntando por otra cosa. Eso no es el artículo del anuncio y no se le
   * puede pegar encima: el anuncio lo comparten cientos de clientes. Vive
   * aquí, en SU hilo, y solo vale para él.
   */
  agregarColumna("conversations", "foto_producto_id", "INTEGER");
  // Lo que vende el anuncio del lead, ya leído. Ver `producto_lead` arriba.
  agregarColumna("conversations", "producto_lead", "TEXT");
  /*
   * CUÁNDO SE ENVIÓ LA FACTURA de esta venta: la primera foto de factura o de
   * comprobante que mandó el equipo. NO es la fecha de la venta —la venta
   * cuenta el día en que se CERRÓ, `fecha_cierre`—: la factura solo la
   * confirma. De aquí salen las «facturas enviadas hoy» del resumen, que
   * pueden ser de ventas cerradas días atrás. Ver `marcarFacturada`.
   */
  agregarColumna("conversations", "facturada_at", "INTEGER");

  /*
   * agentes: los dos seguimientos.
   *
   * Nacen encendidos, y no es un descuido: solo salen por los números donde el
   * agente ya está contestando, que es una decisión que el dueño ya tomó a
   * mano. En un número que solo se vigila no sale ni uno.
   */
  /*
   * anuncios_meta: el texto y la imagen del anuncio, para poder leerlos.
   *
   * Una columna, una guarda. Varios ALTER en un solo `exec` NO son atómicos en
   * SQLite: cada uno confirma por su cuenta, así que si el proceso se cae entre
   * el primero y el segundo, la tabla queda con `texto` y sin `imagen` — y una
   * guarda que pregunte solo por `imagen` vuelve a intentar añadir `texto` y
   * revienta el arranque con «duplicate column name». Pasó de verdad.
   */
  for (const columna of [
    "texto", "imagen", "descripcion_imagen", "post_id", "enlace", "attachment_id",
  ]) {
    agregarColumna("anuncios_meta", columna);
  }

  if (!columnas("agentes").includes("recordatorio_visto")) {
    conexion.exec(`
      ALTER TABLE agentes ADD COLUMN recordatorio_visto INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE agentes ADD COLUMN recordatorio_visto_horas INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE agentes ADD COLUMN recordatorio_entrega INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE agentes ADD COLUMN recordatorio_entrega_horas INTEGER NOT NULL DEFAULT 18;
    `);
  }

  /*
   * DE UN AGENTE POR CUENTA A UN AGENTE POR CANAL.
   *
   * Las columnas nuevas entran con ALTER, pero el `UNIQUE(org_id)` de la tabla
   * vieja no se puede ampliar en SQLite: hay que reconstruirla, igual que se
   * hizo con `messages` y con `uso_modelo`.
   *
   * LA FILA QUE YA EXISTÍA NO SE TOCA. Pasa a ser la plantilla de la cuenta
   * (`canal_id = 0`) con su nombre, su tono y —sobre todo— sus instrucciones
   * intactas: ahí está el guion de venta que alguien escribió a mano, y es lo
   * último que puede perderse en una migración. Los agentes de cada canal nacen
   * de esa fila, así que al abrir el panel después de actualizar cada número se
   * encuentra al mismo vendedor que tenía, y desde ahí se le cambia lo que
   * distingue a su país.
   */
  if (!columnas("agentes").includes("canal_id")) {
    /*
     * TODO ESTO VA EN UNA TRANSACCION, y es la migracion donde mas importa.
     *
     * SQLite confirma cada sentencia de un `exec` por su cuenta. Sin
     * transaccion, un corte entre el RENAME y el CREATE deja la base con los
     * agentes guardados en `agentes_viejo` y sin tabla `agentes`; al volver a
     * arrancar, el `CREATE TABLE IF NOT EXISTS` del esquema crea una vacia, la
     * guarda de aqui arriba ve que ya tiene `canal_id` y se salta la copia. El
     * resultado es un panel entero con el guion de venta en blanco y los datos
     * vivos en una tabla que ya no mira nadie.
     *
     * Un reinicio a mitad de despliegue no es una hipotesis: es como se
     * despliega. Envuelto, o pasa entero o no pasa nada.
     */
    conexion.transaction(() => {
    conexion.exec(`
      ALTER TABLE agentes RENAME TO agentes_viejo;

      CREATE TABLE agentes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL REFERENCES orgs(id),
        canal_id INTEGER NOT NULL DEFAULT 0,
        nombre TEXT NOT NULL DEFAULT 'Ana',
        tono TEXT NOT NULL DEFAULT 'cercano',
        instrucciones TEXT NOT NULL DEFAULT '',
        pais TEXT NOT NULL DEFAULT '',
        conocimiento TEXT NOT NULL DEFAULT '',
        usar_catalogo INTEGER NOT NULL DEFAULT 1,
        ver_imagenes INTEGER NOT NULL DEFAULT 1,
        oir_audios INTEGER NOT NULL DEFAULT 1,
        validar_mapa INTEGER NOT NULL DEFAULT 1,
        modelo TEXT NOT NULL DEFAULT '${MODELO_AGENTE}',
        modelo_respaldo TEXT DEFAULT '${MODELO_RESPALDO}',
        modelo_vision TEXT,
        modelo_audio TEXT,
        pasar_a_humano INTEGER NOT NULL DEFAULT 1,
        silenciar_si_humano INTEGER NOT NULL DEFAULT 1,
        horario_activo INTEGER NOT NULL DEFAULT 0,
        horario_desde TEXT, horario_hasta TEXT,
        recordatorio_visto INTEGER NOT NULL DEFAULT 1,
        recordatorio_visto_horas INTEGER NOT NULL DEFAULT 3,
        recordatorio_entrega INTEGER NOT NULL DEFAULT 1,
        recordatorio_entrega_horas INTEGER NOT NULL DEFAULT 18,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(org_id, canal_id)
      );

      INSERT INTO agentes (
        id, org_id, canal_id, nombre, tono, instrucciones,
        modelo, modelo_respaldo, pasar_a_humano, silenciar_si_humano,
        horario_activo, horario_desde, horario_hasta,
        recordatorio_visto, recordatorio_visto_horas,
        recordatorio_entrega, recordatorio_entrega_horas, updated_at
      )
      SELECT
        id, org_id, 0, nombre, tono, instrucciones,
        modelo, modelo_respaldo, pasar_a_humano, silenciar_si_humano,
        horario_activo, horario_desde, horario_hasta,
        recordatorio_visto, recordatorio_visto_horas,
        recordatorio_entrega, recordatorio_entrega_horas, updated_at
      FROM agentes_viejo;

      DROP TABLE agentes_viejo;
    `);

    /*
     * Y cada canal que ya existe estrena su copia, con el guion de la cuenta
     * dentro. Sin esto, el dueño abriría el panel y se encontraría tres canales
     * con un agente en blanco cada uno: técnicamente correcto, y exactamente
     * igual de inservible que haber perdido las instrucciones.
     */
    conexion.exec(`
      INSERT INTO agentes (
        org_id, canal_id, nombre, tono, instrucciones, pais, conocimiento,
        usar_catalogo, ver_imagenes, oir_audios, validar_mapa,
        modelo, modelo_respaldo, modelo_vision, modelo_audio,
        pasar_a_humano, silenciar_si_humano,
        horario_activo, horario_desde, horario_hasta,
        recordatorio_visto, recordatorio_visto_horas,
        recordatorio_entrega, recordatorio_entrega_horas
      )
      SELECT
        c.org_id, c.id, a.nombre, a.tono, a.instrucciones, a.pais, a.conocimiento,
        a.usar_catalogo, a.ver_imagenes, a.oir_audios, a.validar_mapa,
        a.modelo, a.modelo_respaldo, a.modelo_vision, a.modelo_audio,
        a.pasar_a_humano, a.silenciar_si_humano,
        a.horario_activo, a.horario_desde, a.horario_hasta,
        a.recordatorio_visto, a.recordatorio_visto_horas,
        a.recordatorio_entrega, a.recordatorio_entrega_horas
      FROM canales c
      JOIN agentes a ON a.org_id = c.org_id AND a.canal_id = 0
    `);
    })();
  }

  /*
   * EL PAÍS DE CADA NÚMERO, DEDUCIDO DE SU PREFIJO.
   *
   * Los canales que ya estaban conectados cuando llegó el agente por canal se
   * quedaron sin país, y un agente sin país habla en neutro: no sabe en qué
   * moneda cobrar, pide las direcciones como no se piden ahí y no puede
   * comprobar si un pin del mapa cae donde entrega. Es la avería más silenciosa
   * de todas, porque el agente parece estar funcionando.
   *
   * Y el dato estaba delante todo el tiempo: el teléfono del canal dice de qué
   * país es. +507 vende en Panamá.
   *
   * Solo rellena los que están VACÍOS —nunca pisa un país elegido a mano— y
   * solo cuando el prefijo no deja dudas: un +1 puede ser dominicano o de
   * Miami, y lo que lo distingue es el código de área. El que no se pueda
   * deducir se queda sin país y el panel lo sigue avisando, que es mejor que
   * cotizar en la moneda equivocada.
   *
   * No lleva guarda de «ya se hizo» a propósito: es idempotente por su WHERE, y
   * así también recoge los canales que se vincularon entre dos despliegues.
   */
  {
    const sinPais = conexion
      .prepare(
        `SELECT a.org_id, a.canal_id, c.phone
           FROM agentes a
           JOIN canales c ON c.id = a.canal_id AND c.org_id = a.org_id
          WHERE a.canal_id <> 0 AND a.pais = ''`,
      )
      .all() as { org_id: number; canal_id: number; phone: string }[];

    const poner = conexion.prepare(
      `UPDATE agentes SET pais = ?, updated_at = unixepoch()
        WHERE org_id = ? AND canal_id = ? AND pais = ''`,
    );

    let puestos = 0;
    conexion.transaction(() => {
      for (const fila of sinPais) {
        const pais = paisDeTelefono(fila.phone);
        if (!pais) continue;
        poner.run(pais.codigo, fila.org_id, fila.canal_id);
        puestos++;
      }
    })();

    if (puestos > 0) {
      console.log(`[db] ${puestos} número(s) estrenan país, deducido de su prefijo`);
    }
  }

  /*
   * messages: `tipo` tiene que admitir 'comentario'.
   *
   * Un CHECK no se amplía con ALTER en SQLite, así que la tabla se reconstruye
   * —mismo procedimiento que se usó con uso_modelo—. Se copia entera: son los
   * mensajes de todos los hilos y no se pierde ni uno.
   */
  const chequeoMensajes = (
    conexion.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'`).get() as
      | { sql?: string }
      | undefined
  )?.sql;

  if (chequeoMensajes && !chequeoMensajes.includes("'comentario'")) {
    conexion.exec(`
      ALTER TABLE messages RENAME TO messages_viejo;

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL REFERENCES orgs(id),
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        whapi_message_id TEXT UNIQUE,
        emisor TEXT CHECK(emisor IN ('cliente','ia','humano')) NOT NULL,
        tipo TEXT CHECK(tipo IN ('texto','imagen','audio','documento','comentario','otro')) NOT NULL DEFAULT 'texto',
        descripcion_imagen TEXT,
        categoria_imagen TEXT CHECK(categoria_imagen IN ('factura','comprobante_pago','foto_producto','otro')),
        transcripcion TEXT,
        media_url TEXT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      INSERT INTO messages
        (id, org_id, conversation_id, whapi_message_id, emisor, tipo,
         descripcion_imagen, categoria_imagen, transcripcion, media_url, content, created_at)
        SELECT id, org_id, conversation_id, whapi_message_id, emisor, tipo,
               descripcion_imagen, categoria_imagen, transcripcion, media_url, content, created_at
          FROM messages_viejo;

      DROP TABLE messages_viejo;

      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
    `);
  }

  /*
   * orgs: la meta de efectividad del equipo pasa de 80 a 85.
   *
   * El DEFAULT del esquema solo vale para las cuentas nuevas, así que las que
   * ya existen seguirían midiéndose contra el 80 viejo y el semáforo diría
   * verde donde el negocio dice que falta.
   *
   * Va detrás de `user_version` y no de un `WHERE meta_efectividad = 80` a
   * secas porque esto corre en CADA arranque: sin la marca, al dueño que
   * mañana decida bajar su meta a 80 se la volveríamos a subir en el siguiente
   * reinicio, sin que nadie lo tocara. Se hace una vez y no se repite.
   */
  const version = (conexion.prepare(`PRAGMA user_version`).get() as { user_version: number })
    .user_version;
  if (version < 1) {
    conexion.prepare(`UPDATE orgs SET meta_efectividad = 85 WHERE meta_efectividad = 80`).run();
    conexion.exec(`PRAGMA user_version = 1`);
  }

  /*
   * conversations: las ventas que cerró un resumen de la IA vuelven a la IA.
   *
   * `resumen_tras_intervencion` era la señal de «la IA mandó el resumen, pero
   * un vendedor había escrito antes, así que la venta es del equipo». Esa regla
   * se retiró: el resumen es de quien lo escribe, y que una persona metiera
   * mano se lee en `intervencion_humana`, que es un dato aparte y no se toca
   * aquí. Toda fila con esa señal la cerró un resumen de la IA, así que la
   * conversión es exacta y no hay nada que adivinar.
   *
   * Una sola vez: después el dueño puede corregir a mano lo que quiera desde la
   * bandeja de revisión, y no se lo vamos a pisar en el siguiente arranque.
   */
  if (version < 2) {
    conexion.prepare(
      `UPDATE conversations SET cerrado_por = 'ia', senal_de_cierre = 'resumen_ia'
        WHERE senal_de_cierre = 'resumen_tras_intervencion'`,
    ).run();
    conexion.exec(`PRAGMA user_version = 2`);
  }

  /*
   * canales: los números que ya estaban conectados pasan al modo de vigilar.
   *
   * El `DEFAULT 1` solo vale para los que se conecten a partir de ahora. En los
   * que ya estaban, el panel tampoco contestaba —su agente está apagado— pero
   * seguía anotando como escritas por una persona las respuestas del bot del
   * dueño, y acreditándole al equipo esas ventas.
   *
   * Solo donde nuestro agente está APAGADO. Si alguien lo tiene encendido, ahí
   * el que contesta es él y no hay nada que suponer.
   *
   * Cambia cómo se cuenta lo que entre a partir de ahora; lo ya guardado se
   * queda como está. Reescribir el histórico de todas las cuentas sin que nadie
   * lo pida sería pasarse: eso lo hace el botón de cada número, que avisa de lo
   * que va a recalcular antes de tocar nada.
   */
  if (version < 3) {
    conexion.prepare(`UPDATE canales SET contesta_ia = 1 WHERE agente_activo = 0`).run();
    conexion.exec(`PRAGMA user_version = 3`);
  }

  /*
   * Y el histórico de esos números, también.
   *
   * La migración anterior arregló lo que ENTRARA a partir de ahora, y eso dejó
   * un panel a medias: el número donde el dueño pulsó el botón contaba bien y
   * los demás seguían enseñando las mismas ventas del lado del equipo, sin que
   * nada distinguiera a unos de otros más que haber pulsado. Un panel que
   * cuenta distinto según qué botón pulsaste no se puede leer.
   *
   * Es exactamente lo que hace `reatribuirCanalAIa` —el botón de cada número—,
   * aplicado de una vez a todos los que están en modo vigilar. Y por las mismas
   * razones: se corrige el ORIGEN, el emisor de los mensajes, y lo demás se
   * deriva de ahí. Los cierres por foto de factura o comprobante NO se mueven:
   * esos los manda una persona desde su móvil.
   *
   * Los números donde contesta nuestro agente quedan fuera: ahí cada mensaje ya
   * tiene dueño de verdad y no hay nada que suponer.
   *
   * Una sola vez, detrás de `user_version`. Después, lo que el dueño corrija a
   * mano desde la bandeja de revisión no se le vuelve a pisar en el siguiente
   * arranque.
   */
  if (version < 4) {
    const enModoVigilar = `SELECT id FROM canales WHERE contesta_ia = 1`;

    conexion.prepare(
      `UPDATE messages SET emisor = 'ia'
        WHERE emisor = 'humano'
          AND conversation_id IN (
            SELECT id FROM conversations WHERE canal_id IN (${enModoVigilar}))`,
    ).run();

    conexion.prepare(
      `UPDATE conversations SET intervencion_humana = 0
        WHERE canal_id IN (${enModoVigilar})`,
    ).run();

    conexion.prepare(
      `UPDATE conversations SET cerrado_por = 'ia', senal_de_cierre = 'resumen_ia'
        WHERE canal_id IN (${enModoVigilar})
          AND cerrado_por = 'humano'
          AND senal_de_cierre IN ('confirmacion_texto', 'resumen_tras_intervencion')`,
    ).run();

    conexion.exec(`PRAGMA user_version = 4`);
  }

  /*
   * agentes y orgs: fuera el modelo que OpenRouter retiró.
   *
   * El `DEFAULT` nuevo del esquema solo vale para las cuentas que se creen a
   * partir de ahora; las que ya existen seguirían apuntando a un modelo que ya
   * no se sirve, que es tanto como tener el agente apagado sin que lo diga
   * ninguna pantalla. Se cambia el modelo del agente, el del análisis, y se le
   * pone respaldo al que no tenía: un agente sin red se queda mudo con que
   * falle una sola llamada.
   *
   * Solo a quien esté en el modelo retirado. Al que eligió otro no se le toca:
   * esto corre en cada arranque y pisarle su elección sería quitarle el ajuste
   * cada vez que se reinicia el servidor.
   */
  if (version < 5) {
    conexion.prepare(`UPDATE agentes SET modelo = ? WHERE modelo = ?`)
      .run(MODELO_AGENTE, MODELO_RETIRADO);
    conexion.prepare(`UPDATE agentes SET modelo_respaldo = ? WHERE modelo_respaldo = ?`)
      .run(MODELO_RESPALDO, MODELO_RETIRADO);
    conexion.prepare(
      `UPDATE agentes SET modelo_respaldo = ?
        WHERE modelo = ? AND (modelo_respaldo IS NULL OR modelo_respaldo = '')`,
    ).run(MODELO_RESPALDO, MODELO_AGENTE);
    conexion.prepare(`UPDATE orgs SET modelo_analisis = ? WHERE modelo_analisis = ?`)
      .run(MODELO_ANALISIS, MODELO_RETIRADO);
    conexion.exec(`PRAGMA user_version = 5`);
  }

  /*
   * MENOS GASTO POR MENSAJE, sin tocar lo que alguien haya elegido.
   *
   * El agente y el analista corrían con los modelos grandes de Anthropic, que
   * contestan de maravilla y cuestan lo suyo en un número que atiende todo el
   * día. Con `gpt-4o-mini` la factura baja un orden de magnitud y la venta se
   * cierra igual: son mensajes de WhatsApp de dos líneas, no literatura.
   *
   * Se mueve SOLO a quien tenía el valor por defecto, que es quien nunca eligió
   * nada. Al que entró en Agente y puso su modelo no se le toca: eligió, y esto
   * no es una corrección de un error suyo. Va detrás de `user_version` porque
   * esto corre en cada arranque, y sin la marca le desharíamos mañana el cambio
   * al que hoy prefiera volver a Opus.
   */
  if (version < 6) {
    conexion.prepare(`UPDATE agentes SET modelo = ? WHERE modelo = ?`)
      .run("openai/gpt-4o-mini", "anthropic/claude-opus-5");
    conexion.prepare(`UPDATE orgs SET modelo_analisis = ? WHERE modelo_analisis = ?`)
      .run(MODELO_ANALISIS, "anthropic/claude-sonnet-5");
    conexion.exec(`PRAGMA user_version = 6`);
  }

  /*
   * Y EL AGENTE VUELVE A UN MODELO QUE SOSTIENE EL GUION.
   *
   * La migración de arriba bajó a los dos —agente y analista— al modelo
   * pequeño, y con el agente fue un paso atrás: en la prueba contra el modelo de
   * verdad se saltó la talla, tomó «la M» por una dirección y facturó un «envío
   * a la M». El analista se queda abajo, que ahí el pequeño hace su trabajo y es
   * donde está el volumen.
   *
   * Se mueve solo a quien tenga el valor que puso esa migración, o sea, a quien
   * nunca eligió. Al que entró en Agente y escogió el pequeño a sabiendas no se
   * le toca.
   */
  if (version < 7) {
    conexion.prepare(`UPDATE agentes SET modelo = ? WHERE modelo = ?`)
      .run(MODELO_AGENTE, "openai/gpt-4o-mini");
    conexion.exec(`PRAGMA user_version = 7`);
  }

  /*
   * EL RESUMEN DE PEDIDO ES AUTOMATIZADO SIEMPRE, y el histórico también.
   *
   * La regla de conteo del panel es esta y solo esta:
   *
   *   - Se mandó el RESUMEN → automatizada. No importa quién lo escribiera: el
   *     agente del panel, el bot propio del dueño en un número que solo
   *     vigilamos, o un vendedor copiando el formato desde su móvil.
   *   - Se mandó la FOTO DE LA FACTURA y en el hilo no hubo resumen → asistida.
   *
   * Hasta ahora el resumen se atribuía por el EMISOR del mensaje, y desde fuera
   * un resumen escrito por un bot ajeno y uno escrito a mano son idénticos: las
   * ventas que cerró una máquina se contaban del lado del equipo. La migración 4
   * arregló eso solo en los números marcados como «en modo vigilar»; el resto
   * del panel seguía contando mal, y con dos criterios distintos conviviendo
   * ninguna de las dos cifras se podía leer.
   *
   * `confirmacion_texto` y `resumen_tras_intervencion` son exactamente «cerró un
   * resumen de pedido», así que la conversión es exacta y no hay nada que
   * adivinar. Lo cerrado por una FOTO no se toca: eso es lo asistido. Y
   * `correccion_manual` tampoco: esa la firmó una persona desde la bandeja de
   * revisión, y pisarla sería deshacerle el trabajo.
   *
   * Una sola vez, detrás de `user_version`: esto corre en cada arranque y sin la
   * marca le volveríamos a pisar mañana lo que hoy corrija a mano.
   */
  if (version < 8) {
    conexion.prepare(
      `UPDATE conversations SET cerrado_por = 'ia', senal_de_cierre = 'resumen_ia'
        WHERE cerrado_por = 'humano'
          AND senal_de_cierre IN ('confirmacion_texto', 'resumen_tras_intervencion')`,
    ).run();
    conexion.exec(`PRAGMA user_version = 8`);
  }

  /*
   * EL ANUNCIO ACTUAL VUELVE A SER EL QUE TRAJO AL CLIENTE.
   *
   * Hasta el 2026-09-05 la vista previa de CUALQUIER enlace pegado en el chat
   * —también uno que mandara el propio vendedor— entraba como «el anuncio por
   * el que escribe ahora», y el agente pasaba a vender ese otro artículo. Ya
   * no entra (ver `esAnuncioDeMeta` en wa.ts), pero lo que se pisó, se pisó:
   * aquí se devuelve al primer anuncio, que es el que el cliente vio. El
   * siguiente clic real en un anuncio lo vuelve a poner al día.
   */
  if (version < 9) {
    conexion.prepare(
      `UPDATE conversations SET anuncio_actual_producto = producto_anuncio,
                                anuncio_actual_descripcion = descripcion_anuncio
        WHERE producto_anuncio IS NOT NULL
          AND (anuncio_actual_producto IS NOT producto_anuncio
               OR anuncio_actual_descripcion IS NOT descripcion_anuncio)`,
    ).run();
    conexion.exec(`PRAGMA user_version = 9`);
  }

  /*
   * EL VENDEDOR PASA A GPT LUNA LATEST (la dueña, 2026-09-22).
   *
   * «Latest» es un alias que OpenRouter mantiene apuntando siempre al último
   * modelo de la familia GPT Luna: no hay que volver a moverlo a mano cada
   * vez que salga una versión nueva.
   *
   * Solo a quien tenía el valor por defecto de antes (gpt-4o), igual que en
   * las migraciones 6 y 7: al que entró en Agente y puso el suyo no se le
   * toca, esto corre en cada arranque y pisarle su elección sería quitarle
   * el ajuste cada vez que se reinicia el servidor.
   */
  if (version < 10) {
    conexion.prepare(`UPDATE agentes SET modelo = ? WHERE modelo = ?`)
      .run(MODELO_AGENTE, "openai/gpt-4o");
    conexion.exec(`PRAGMA user_version = 10`);
  }

  // anomalies: las anomalías de canal no tienen conversación.
  if (!columnas("anomalies").includes("canal_id")) {
    conexion.exec(`
      ALTER TABLE anomalies RENAME TO anomalies_viejo;

      CREATE TABLE anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL REFERENCES orgs(id),
        conversation_id INTEGER REFERENCES conversations(id),
        canal_id INTEGER REFERENCES canales(id),
        tipo TEXT NOT NULL,
        severidad TEXT CHECK(severidad IN ('alta','media')) NOT NULL DEFAULT 'media',
        detalle TEXT, resuelta INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CHECK (conversation_id IS NOT NULL OR canal_id IS NOT NULL)
      );

      INSERT INTO anomalies (id, org_id, conversation_id, tipo, severidad, detalle, resuelta, created_at)
        SELECT id, org_id, conversation_id, tipo, severidad, detalle, resuelta, created_at
          FROM anomalies_viejo;

      DROP TABLE anomalies_viejo;
      CREATE INDEX IF NOT EXISTS idx_anom_org ON anomalies(org_id, resuelta);
    `);
  }
}

export const db: DB = global_.__salesdash_db ?? (global_.__salesdash_db = abrir());

/** Prepara una sentencia una sola vez y la reutiliza. */
const cache = new Map<string, Statement>();
function s(sql: string): Statement {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

export const ahora = () => Math.floor(Date.now() / 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type Emisor = "cliente" | "ia" | "humano";
export type TipoMensaje = "texto" | "imagen" | "audio" | "documento" | "otro";
export type CategoriaImagen = "factura" | "comprobante_pago" | "foto_producto" | "otro";
/**
 * Los cinco estados del procedimiento diario. `lead_nuevo` no es una columna:
 * toda conversación es un lead desde que existe, y su estado de cierre es uno
 * de estos cuatro. De ahí la invariante:
 *   leads = cerradas_ia + cerradas_humano + abiertas + revision
 */
export type EstadoCierre = "ia" | "humano" | "abierta" | "revision";

export interface Org {
  id: number; nombre: string; color: string;
  meta_cobertura: number; meta_efectividad: number;
  marcador_cierre: string; modelo_analisis: string; modelo_vision: string; modelo_audio: string;
  suspendida: number; created_at: number;
}

export interface Usuario {
  id: number; org_id: number; email: string; nombre: string;
  password_hash: string; rol: "dueno" | "miembro";
  superadmin: number; verificado: number; created_at: number;
}

export interface Canal {
  id: number; org_id: number; nombre: string; phone: string;
  token_cifrado: string; webhook_secret: string;
  whapi_channel_id: string | null; estado: string; ultimo_evento_at: number | null;
  agente_activo: number; contesta_ia: number; activo: number; created_at: number;
  /** 'whatsapp' o 'meta'. En un canal de Meta, `phone` es el ID de la página. */
  tipo: string;
  /** El nombre del negocio tal y como lo ve el cliente: el perfil de WhatsApp
      de este número, o el de la página de Meta. Lo rellena la conexión. */
  negocio: string | null;
  /** Cuenta de Instagram enlazada a la página, si la hay. */
  meta_ig_id: string | null;
}

export interface Conversacion {
  id: number; org_id: number; canal_id: number;
  cliente_phone: string; cliente_nombre: string | null;
  /**
   * La dirección exacta a la que se le contesta a este cliente. Nula en los
   * hilos abiertos antes de que se guardara; se rellena con su próximo mensaje.
   */
  cliente_jid: string | null;
  origen: string | null; producto_anuncio: string | null; descripcion_anuncio: string | null;
  /** El último anuncio por el que escribió. Ver `anuncioVigente` en anuncio.ts. */
  anuncio_actual_producto: string | null; anuncio_actual_descripcion: string | null;
  intervencion_humana: number; cerrado_por: EstadoCierre;
  /** Quién atiende este hilo: 'ia' o 'humano'. Se cambia desde la conversación. */
  atiende: string;
  /** Cuándo se le devolvió el hilo a la IA por última vez. Ver `devolverALaIa`. */
  devuelta_a_ia_at: number | null;
  senal_de_cierre: string | null;
  total: number | null; envio: number | null;
  producto_vendido: string | null; resumen_pedido: string | null;
  justificacion: string | null; datos_faltantes: string | null;
  motivo_perdida: string | null; analizada_at: number | null;
  fecha_inicio: number; fecha_cierre: number | null; last_message_at: number | null;
  /** Cuándo mandó el equipo la primera foto de la factura. Ver `marcarFacturada`. */
  facturada_at: number | null;
  /** Por dónde entró: 'whatsapp', 'messenger', 'instagram' o 'comentario'. */
  superficie: string | null;
  /** El anuncio de Meta que lo trajo. Se guarda del primer evento y no cambia. */
  meta_ad_id: string | null;
  /** De qué app de Meta vino: 'facebook' o 'instagram'. Nulo fuera de Meta. */
  red: string | null;
  /**
   * EL ARTÍCULO QUE EL CLIENTE ENSEÑÓ EN UNA FOTO, con su nombre y su precio
   * puestos por una persona desde el hilo. Solo de esta conversación: el
   * anuncio es de todos, esa foto es suya. Ver `fijarProductoDeLaFoto`.
   */
  foto_producto_id: number | null;
  /**
   * LO QUE VENDE EL ANUNCIO QUE TRAJO A ESTE CLIENTE, en JSON: nombre, precio,
   * precio por mayor, tallas y colores. Ver `leerProductoDelAnuncio`.
   */
  producto_lead: string | null;
}

export interface Mensaje {
  id: number; org_id: number; conversation_id: number;
  whapi_message_id: string | null; emisor: Emisor; tipo: TipoMensaje;
  descripcion_imagen: string | null; categoria_imagen: CategoriaImagen | null;
  transcripcion: string | null;
  media_url: string | null; content: string; created_at: number;
}

export interface Agente {
  id: number; org_id: number;
  /** Con qué nombre saluda. Vacío = el del perfil de WhatsApp del número. */
  negocio: string;
  /** El canal al que atiende. 0 es la plantilla de la cuenta. */
  canal_id: number;
  nombre: string; tono: string;
  instrucciones: string;
  /** Código ISO del país en el que vende este canal, o vacío. Ver `paises.ts`. */
  pais: string;
  /** Lo que vende, escrito a mano. El catálogo de quien no tiene catálogo. */
  conocimiento: string;
  usar_catalogo: number;
  /** Si mira las fotos y oye las notas de voz antes de contestar. */
  ver_imagenes: number; oir_audios: number;
  /** Si valida el pin del mapa contra el país antes de darlo por dirección. */
  validar_mapa: number;
  modelo: string; modelo_respaldo: string | null;
  /** Nulos = los de la cuenta. */
  modelo_vision: string | null; modelo_audio: string | null;
  pasar_a_humano: number; silenciar_si_humano: number;
  /** Lo que cobra de envío en la zona del mensajero y en el resto del país. */
  envio_cerca: number | null; envio_lejos: number | null;
  /** Segundos que espera antes de contestar, contados desde que entró el mensaje. */
  retardo_seg: number;
  horario_activo: number; horario_desde: string | null; horario_hasta: string | null;
  /** Recordatorio al cliente que dejó la conversación a medias. */
  recordatorio_visto: number; recordatorio_visto_horas: number;
  updated_at: number;
}

export interface Producto {
  id: number; org_id: number;
  /** De qué número es. 0 = de toda la cuenta, que es lo que vale para todos. */
  canal_id: number;
  nombre: string;
  variantes: string | null; precio: number | null; activo: number;
  /** La foto de referencia, si se importó de un link. Ver `importar-producto.ts`. */
  foto_url: string | null;
  /** La descripción de la página del link, para el panel. Ver `importar-producto.ts`. */
  descripcion: string | null;
}

export interface Anomalia {
  id: number; org_id: number;
  conversation_id: number | null; canal_id: number | null;
  tipo: string; severidad: "alta" | "media"; detalle: string | null;
  resuelta: number; created_at: number;
}

export interface SoporteAcceso {
  id: number; org_id: number; admin_user_id: number; motivo: string;
  estado: "solicitado" | "aprobado" | "rechazado" | "expirado";
  solicitado_at: number; aprobado_at: number | null; expira_at: number | null;
}

/** Construye `SET a = ?, b = ?` solo con las columnas permitidas y presentes. */
function armarSet(campos: Record<string, unknown>, permitidas: readonly string[]) {
  const claves = Object.keys(campos).filter(
    (k) => permitidas.includes(k) && campos[k] !== undefined,
  );
  return { sql: claves.map((k) => `${k} = ?`).join(", "), valores: claves.map((k) => campos[k]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad — orgs y usuarios
//
// EXCEPCIÓN a la regla del `orgId`: estas funciones son las que CREAN la
// organización o resuelven quién eres antes de que exista una sesión. No
// pueden recibir un `orgId` porque todavía no hay ninguno. Ninguna devuelve
// datos de negocio: solo la fila del usuario que se autentica.
// ─────────────────────────────────────────────────────────────────────────────

export function crearOrgConDueno(datos: {
  negocio: string; color: string;
  nombre: string; email: string; passwordHash: string;
}): { orgId: number; userId: number } {
  const tx = db.transaction((d: typeof datos) => {
    const org = s(`INSERT INTO orgs (nombre, color, modelo_analisis) VALUES (?, ?, ?)`)
      .run(d.negocio, d.color, MODELO_ANALISIS);
    const orgId = Number(org.lastInsertRowid);

    // `verificado = 1` de entrada: el registro es directo, sin código por
    // correo. La columna se conserva porque la interfaz y la API la leen, y
    // porque volver a exigir verificación algún día no debería costar una
    // migración.
    const user = s(
      `INSERT INTO users (org_id, email, nombre, password_hash, rol, verificado)
       VALUES (?, ?, ?, ?, 'dueno', 1)`,
    ).run(orgId, d.email.toLowerCase(), d.nombre, d.passwordHash);

    // Toda organización nace con su agente vendedor configurado y APAGADO.
    s(`INSERT INTO agentes (org_id, modelo, modelo_respaldo) VALUES (?, ?, ?)`)
      .run(orgId, MODELO_AGENTE, MODELO_RESPALDO);

    return { orgId, userId: Number(user.lastInsertRowid) };
  });
  return tx(datos);
}

export function buscarUsuarioPorEmail(email: string): Usuario | undefined {
  return s(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as Usuario | undefined;
}

export function obtenerUsuario(userId: number): Usuario | undefined {
  return s(`SELECT * FROM users WHERE id = ?`).get(userId) as Usuario | undefined;
}

/**
 * DA DE ALTA A UN COMPAÑERO EN LA MISMA CUENTA, sin correo de por medio.
 *
 * `crearOrgConDueno` es para quien no tenía nada: abre organización propia.
 * Esto es para quien YA tiene una y quiere meter a alguien de su equipo
 * DENTRO de ella —mismos números, mismo catálogo, mismas ventas—, con el rol
 * `miembro` desde el primer segundo. El dueño escribe la contraseña él mismo
 * y se la pasa por fuera del panel: es el mismo espíritu de «sin código y sin
 * correo» que ya tiene el registro, y no depende de que el envío de correos
 * esté funcionando.
 *
 * El correo es único EN TODA LA PLATAFORMA, no solo en esta cuenta —la tabla
 * lo exige con `UNIQUE`—, así que quien llama comprueba antes con
 * `buscarUsuarioPorEmail` y decide qué decir si ya existe.
 */
export function crearMiembro(orgId: number, datos: {
  nombre: string; email: string; passwordHash: string;
}): number {
  const r = s(
    `INSERT INTO users (org_id, email, nombre, password_hash, rol, verificado)
     VALUES (?, ?, ?, ?, 'miembro', 1)`,
  ).run(orgId, datos.email.toLowerCase(), datos.nombre, datos.passwordHash);
  return Number(r.lastInsertRowid);
}

/**
 * Saca a alguien del equipo. Nunca al dueño —lo comprueba quien llama, la
 * ruta de la API—, y solo de SU cuenta: el `WHERE` con `org_id` es lo que
 * impide borrar al miembro de otra organización sabiendo su id.
 */
export function eliminarMiembro(orgId: number, userId: number): boolean {
  return s(`DELETE FROM users WHERE org_id = ? AND id = ? AND rol = 'miembro'`).run(orgId, userId).changes > 0;
}

/**
 * Superadmin de la plataforma. No hay forma de concederlo desde la interfaz, y
 * es deliberado: el panel /admin ve todas las organizaciones, así que el
 * primer superadmin tiene que marcarse desde la consola con
 * `npm run superadmin`. Que no exista un botón es la salvaguarda.
 */
export function marcarSuperadmin(userId: number, valor: boolean): void {
  s(`UPDATE users SET superadmin = ? WHERE id = ?`).run(valor ? 1 : 0, userId);
}

// ── Organización (ya con sesión) ────────────────────────────────────────────

export function obtenerOrg(orgId: number): Org | undefined {
  return s(`SELECT * FROM orgs WHERE id = ?`).get(orgId) as Org | undefined;
}

const COLUMNAS_ORG = [
  "nombre", "color", "meta_cobertura", "meta_efectividad",
  "marcador_cierre", "modelo_analisis", "modelo_vision", "modelo_audio",
] as const;

export function actualizarOrg(orgId: number, campos: Partial<Org>): void {
  const { sql, valores } = armarSet(campos, COLUMNAS_ORG);
  if (!sql) return;
  s(`UPDATE orgs SET ${sql} WHERE id = ?`).run(...valores, orgId);
}

export function listarMiembros(orgId: number): Usuario[] {
  return s(
    `SELECT * FROM users WHERE org_id = ? ORDER BY created_at ASC`,
  ).all(orgId) as Usuario[];
}

/**
 * LOS CANALES QUE UN MIEMBRO PUEDE ATENDER.
 *
 * Vacío quiere decir «todos»: ver la nota de `equipo_canales` en el esquema.
 * Quien llame a esto y reciba `[]` no lo puede tratar como «ninguno» —eso
 * dejaría al miembro sin ver nada el día que se le da de alta y nadie le ha
 * asignado un número todavía—; lo trata como «sin restricción», que es la
 * regla en toda la plataforma.
 */
export function canalesDeMiembro(orgId: number, userId: number): number[] {
  return (
    s(`SELECT canal_id FROM equipo_canales WHERE org_id = ? AND user_id = ?`).all(
      orgId,
      userId,
    ) as { canal_id: number }[]
  ).map((r) => r.canal_id);
}

/**
 * REEMPLAZA de una vez los canales de un miembro. Solo lo llama el dueño —la
 * ruta que lo expone lo comprueba— y con la lista entera, no uno a uno: es
 * exactamente lo que pinta un formulario de casillas marcadas.
 */
export function asignarCanalesAMiembro(orgId: number, userId: number, canalIds: number[]): void {
  const unicos = [...new Set(canalIds)];
  const reemplazar = db.transaction((ids: number[]) => {
    s(`DELETE FROM equipo_canales WHERE org_id = ? AND user_id = ?`).run(orgId, userId);
    const insertar = s(
      `INSERT INTO equipo_canales (org_id, user_id, canal_id) VALUES (?, ?, ?)`,
    );
    for (const id of ids) insertar.run(orgId, userId, id);
  });
  reemplazar(unicos);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canales
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `restringirA`: `null` o sin poner es «todos»; con una lista, filtra a solo
 * esos —AUNQUE VENGA VACÍA—. Que venga vacía y aun así traiga todos sería el
 * fallo que hay que evitar: `ctx.canalesPermitidos` nunca llega aquí como `[]`
 * —`getSession` ya lo convierte en `null`, ver `tenant.ts`—, así que un `[]`
 * de verdad solo puede venir de quien llama pidiendo «nada», y tratarlo como
 * «todos» sería abrir de más justo donde se pidió cerrar.
 */
export function listarCanales(orgId: number, restringirA?: number[] | null): Canal[] {
  if (restringirA === undefined || restringirA === null) {
    return s(
      `SELECT * FROM canales WHERE org_id = ? ORDER BY created_at ASC`,
    ).all(orgId) as Canal[];
  }
  if (restringirA.length === 0) return [];
  const marcas = restringirA.map(() => "?").join(",");
  return s(
    `SELECT * FROM canales WHERE org_id = ? AND id IN (${marcas}) ORDER BY created_at ASC`,
  ).all(orgId, ...restringirA) as Canal[];
}

export function obtenerCanal(orgId: number, id: number): Canal | undefined {
  return s(`SELECT * FROM canales WHERE org_id = ? AND id = ?`).get(orgId, id) as Canal | undefined;
}

export function contarCanales(orgId: number): number {
  return (s(`SELECT COUNT(*) AS n FROM canales WHERE org_id = ?`).get(orgId) as { n: number }).n;
}

export function crearCanal(orgId: number, datos: {
  nombre: string; phone: string; tokenCifrado: string;
  webhookSecret: string; whapiChannelId: string | null; estado?: string;
}): number {
  const r = s(
    `INSERT INTO canales (org_id, nombre, phone, token_cifrado, webhook_secret, whapi_channel_id, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    orgId, datos.nombre, datos.phone, datos.tokenCifrado,
    datos.webhookSecret, datos.whapiChannelId, datos.estado ?? "pendiente",
  );
  return Number(r.lastInsertRowid);
}

const COLUMNAS_CANAL = [
  "nombre", "negocio", "phone", "token_cifrado", "whapi_channel_id",
  "estado", "ultimo_evento_at", "agente_activo", "contesta_ia", "activo",
  "meta_ig_id",
] as const;

export function actualizarCanal(orgId: number, id: number, campos: Partial<Canal>): void {
  const { sql, valores } = armarSet(campos, COLUMNAS_CANAL);
  if (!sql) return;
  s(`UPDATE canales SET ${sql} WHERE org_id = ? AND id = ?`).run(...valores, orgId, id);
}

/**
 * BORRAR UN NÚMERO TIENE QUE BORRARLO DE VERDAD.
 *
 * Esta función dejaba tres cabos sueltos, y con las claves foráneas encendidas
 * un cabo suelto no es un dato huérfano: es que el `DELETE` del canal FALLA, la
 * transacción entera se deshace y el número se queda en la pantalla. Desde
 * fuera se ve exactamente así — «lo desconecté y no se quita»— porque el
 * teléfono sí se desvinculó: lo que no se pudo fue borrar la fila.
 *
 * Los tres cabos:
 *
 *  - `seguimientos`, colgados de la conversación. Cualquier número que haya
 *    mandado un recordatorio o un aviso de entrega tenía uno, así que a los
 *    números que MÁS se usaron era justo a los que no había forma de borrar.
 *  - `anomalies` con `canal_id`, que son las del número y no las de un hilo:
 *    «canal activo sin leads», por ejemplo. Se borraban solo las de hilo.
 *  - `eventos_meta`, el registro de lo que entró por una página de Meta.
 *
 * Se borra de dentro hacia fuera: primero lo que cuelga de las conversaciones,
 * luego las conversaciones, y al final lo que cuelga del canal y el canal.
 */
/**
 * BORRAR UNA CONVERSACIÓN, con todo lo que cuelga de ella.
 *
 * Mensajes, recordatorios y anomalías del hilo se van con él, en una sola
 * transacción: un hilo a medio borrar dejaría mensajes huérfanos que ninguna
 * pantalla puede abrir. Si tenía una venta cerrada, esa venta deja de contar:
 * el conteo lee `conversations`, y esta fila ya no está.
 *
 * Devuelve si había algo que borrar, para que la API conteste 404 y no un
 * «ok» sobre un hilo que no existía o que era de otra cuenta.
 */
export function eliminarConversacion(orgId: number, id: number): boolean {
  const tx = db.transaction(() => {
    const existe = s(`SELECT id FROM conversations WHERE org_id = ? AND id = ?`).get(orgId, id);
    if (!existe) return false;

    s(`DELETE FROM messages WHERE org_id = ? AND conversation_id = ?`).run(orgId, id);
    s(`DELETE FROM seguimientos WHERE org_id = ? AND conversation_id = ?`).run(orgId, id);
    s(`DELETE FROM anomalies WHERE org_id = ? AND conversation_id = ?`).run(orgId, id);
    s(`DELETE FROM conversations WHERE org_id = ? AND id = ?`).run(orgId, id);
    return true;
  });
  return tx();
}

export function eliminarCanal(orgId: number, id: number): void {
  const tx = db.transaction(() => {
    const hilos = `(SELECT id FROM conversations WHERE org_id = ? AND canal_id = ?)`;

    // Las conversaciones del canal se van con él; si no, quedan huérfanas
    // contando leads de un número que ya nadie tiene.
    s(`DELETE FROM messages WHERE org_id = ? AND conversation_id IN ${hilos}`).run(orgId, orgId, id);
    s(`DELETE FROM seguimientos WHERE org_id = ? AND conversation_id IN ${hilos}`).run(orgId, orgId, id);
    s(`DELETE FROM anomalies WHERE org_id = ? AND conversation_id IN ${hilos}`).run(orgId, orgId, id);
    s(`DELETE FROM conversations WHERE org_id = ? AND canal_id = ?`).run(orgId, id);

    // Y lo que cuelga del número, no de un hilo.
    s(`DELETE FROM anomalies WHERE org_id = ? AND canal_id = ?`).run(orgId, id);
    /*
     * `org_id` es nulo en los eventos que llegaron sin poder resolver la cuenta.
     * El canal ya la fija —es de esta organización o no se llega hasta aquí— y
     * dejar fuera esas filas sería volver a bloquear el borrado por una fila que
     * nadie mira.
     */
    s(`DELETE FROM eventos_meta WHERE canal_id = ? AND (org_id = ? OR org_id IS NULL)`).run(id, orgId);

    // El agente del canal se va con él. La plantilla de la cuenta (canal_id 0)
    // no se toca nunca: de ella nacen los que vengan después.
    s(`DELETE FROM agentes WHERE org_id = ? AND canal_id = ?`).run(orgId, id);
    s(`DELETE FROM canales WHERE org_id = ? AND id = ?`).run(orgId, id);
  });
  tx();
}

/**
 * EXCEPCIÓN justificada: el webhook no recibe `org_id` por parámetro — sería
 * regalarle a cualquiera la capacidad de escribir en la organización que
 * quisiera. Deduce la organización desde el canal, y solo si el secreto
 * coincide. La pareja (id, secreto) es la credencial.
 */
export function canalPorWebhook(canalId: number, secret: string): Canal | undefined {
  return s(
    `SELECT * FROM canales WHERE id = ? AND webhook_secret = ? AND activo = 1`,
  ).get(canalId, secret) as Canal | undefined;
}

/**
 * EXCEPCIÓN — el socket de WhatsApp no tiene sesión ni organización.
 *
 * Un mensaje entra por un socket que solo conoce su `canalId`; la organización
 * se deduce del canal, igual que hace el webhook. No se expone a ninguna ruta
 * de API: lo usa `wa.ts` y nadie más.
 */
export function obtenerCanalSinOrg(canalId: number): Canal | undefined {
  return s(`SELECT * FROM canales WHERE id = ?`).get(canalId) as Canal | undefined;
}

/**
 * EXCEPCIÓN — reconexión al arrancar.
 *
 * Al levantarse el servidor hay que reabrir la sesión de cada número conectado,
 * y en ese momento no existe ninguna sesión de usuario. Devuelve identificadores
 * y nada más: ni un dato de negocio, ni un nombre, ni un teléfono.
 */
export function canalesParaReconectar(): { id: number }[] {
  return s(`SELECT id FROM canales WHERE activo = 1 ORDER BY id`).all() as { id: number }[];
}

export function marcarActividadCanal(orgId: number, canalId: number, cuando: number): void {
  s(
    `UPDATE canales SET ultimo_evento_at = ? WHERE org_id = ? AND id = ?`,
  ).run(cuando, orgId, canalId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversaciones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la conversación del par (canal, teléfono) y la crea si no existe.
 * La creación es lo que cuenta un LEAD: pasa una sola vez por cliente y canal.
 */
export function getOrCreateConversation(
  orgId: number,
  canalId: number,
  clientePhone: string,
  datos: {
    nombre?: string | null; origen?: string | null;
    productoAnuncio?: string | null; descripcionAnuncio?: string | null; cuando?: number;
    superficie?: string | null; metaAdId?: string | null; red?: string | null;
    /** La dirección exacta a la que se le contesta. Ver `cliente_jid`. */
    jid?: string | null;
  } = {},
): { conversacion: Conversacion; nueva: boolean } {
  const existente = s(
    `SELECT * FROM conversations WHERE org_id = ? AND canal_id = ? AND cliente_phone = ?`,
  ).get(orgId, canalId, clientePhone) as Conversacion | undefined;

  if (existente) {
    /*
     * La dirección se refresca con cada mensaje del cliente, no solo al abrir
     * el hilo: los que ya existían la tienen nula —la columna es nueva— y sin
     * esto seguirían contestando con el número reconstruido a mano, que es lo
     * que no llegaba. También cubre al cliente que cambia de dirección.
     */
    if (datos.jid && datos.jid !== existente.cliente_jid) {
      s(`UPDATE conversations SET cliente_jid = ? WHERE org_id = ? AND id = ?`)
        .run(datos.jid, orgId, existente.id);
      existente.cliente_jid = datos.jid;
    }

    // El nombre puede llegar más tarde que el primer mensaje.
    if (datos.nombre && !existente.cliente_nombre) {
      s(`UPDATE conversations SET cliente_nombre = ? WHERE org_id = ? AND id = ?`)
        .run(datos.nombre, orgId, existente.id);
      existente.cliente_nombre = datos.nombre;
    }

    /*
     * El anuncio también puede llegar después: el cliente escribe «hola», y es
     * el segundo mensaje —o uno de días más tarde, al pinchar un anuncio— el
     * que trae el `externalAdReply`. Sin esto ese lead se quedaba para siempre
     * como «escribió por su cuenta» aunque lo hubiera traído la publicidad.
     *
     * Solo se rellena lo que está vacío. Si el cliente vuelve por un anuncio
     * distinto, el lead sigue siendo del primero que lo trajo: el lead se
     * cuenta una sola vez, y es esa primera vez la que la publicidad pagó.
     */
    const anuncio: Record<string, string> = {};
    if (datos.origen && !existente.origen) anuncio.origen = datos.origen;
    // La superficie tampoco se pisa: un hilo que empezó como comentario y
    // siguió por privado se cuenta por donde llegó el cliente la primera vez.
    if (datos.superficie && !existente.superficie) anuncio.superficie = datos.superficie;
    // La red tampoco se pisa, por la misma razón que la superficie.
    if (datos.red && !existente.red) anuncio.red = datos.red;
    if (datos.metaAdId && !existente.meta_ad_id) anuncio.meta_ad_id = datos.metaAdId;
    if (datos.productoAnuncio && !existente.producto_anuncio) {
      anuncio.producto_anuncio = datos.productoAnuncio;
    }
    if (datos.descripcionAnuncio && !existente.descripcion_anuncio) {
      anuncio.descripcion_anuncio = datos.descripcionAnuncio;
    }
    // El anuncio ACTUAL sí se pisa: es por el que escribe ahora.
    if (datos.productoAnuncio || datos.descripcionAnuncio) {
      anuncio.anuncio_actual_producto = datos.productoAnuncio ?? "";
      anuncio.anuncio_actual_descripcion = datos.descripcionAnuncio ?? "";
    }

    const campos = Object.keys(anuncio);
    if (campos.length > 0) {
      s(
        `UPDATE conversations SET ${campos.map((c) => `${c} = ?`).join(", ")}
          WHERE org_id = ? AND id = ?`,
      ).run(...campos.map((c) => anuncio[c]!), orgId, existente.id);
      Object.assign(existente, anuncio);
    }

    return { conversacion: existente, nueva: false };
  }

  const cuando = datos.cuando ?? ahora();
  const r = s(
    `INSERT INTO conversations
       (org_id, canal_id, cliente_phone, cliente_jid, cliente_nombre, origen, producto_anuncio, descripcion_anuncio,
        anuncio_actual_producto, anuncio_actual_descripcion, superficie, meta_ad_id, red, fecha_inicio, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    orgId, canalId, clientePhone, datos.jid ?? null, datos.nombre ?? null,
    datos.origen ?? null, datos.productoAnuncio ?? null, datos.descripcionAnuncio ?? null,
    datos.productoAnuncio ?? null, datos.descripcionAnuncio ?? null,
    datos.superficie ?? null, datos.metaAdId ?? null, datos.red ?? null, cuando, cuando,
  );

  return {
    conversacion: s(`SELECT * FROM conversations WHERE org_id = ? AND id = ?`)
      .get(orgId, Number(r.lastInsertRowid)) as Conversacion,
    nueva: true,
  };
}

/** ¿Ya existe la conversación? Un saliente no debe abrir una nueva. */
export function existeConversacion(orgId: number, canalId: number, clientePhone: string): boolean {
  const fila = s(
    `SELECT 1 AS x FROM conversations WHERE org_id = ? AND canal_id = ? AND cliente_phone = ?`,
  ).get(orgId, canalId, clientePhone) as { x: number } | undefined;
  return !!fila;
}

export function getConversation(orgId: number, id: number): Conversacion | undefined {
  return s(`SELECT * FROM conversations WHERE org_id = ? AND id = ?`)
    .get(orgId, id) as Conversacion | undefined;
}

export interface FilaBandeja extends Conversacion {
  /** Texto del último mensaje, para la vista previa de la lista. */
  ultimo_texto: string | null;
  ultimo_emisor: Emisor | null;
  mensajes: number;
}

/**
 * La bandeja de UN número.
 *
 * `canalId` es obligatorio y no opcional a propósito: cada número conectado
 * tiene su propia bandeja, como tendría su propio WhatsApp. Mezclar los hilos
 * de dos números en una sola lista es exactamente lo que no se quiere — dos
 * clientes distintos pueden escribir al mismo negocio por números distintos, y
 * quien atiende uno no está atendiendo el otro.
 *
 * La vista previa sale de subconsultas y no de un JOIN: con un JOIN habría que
 * agrupar toda la tabla de mensajes para quedarse con una fila por conversación.
 */
export function bandeja(
  orgId: number,
  canalId: number,
  filtros: { estado?: EstadoCierre; limite?: number } = {},
): FilaBandeja[] {
  const cond = ["c.org_id = ?", "c.canal_id = ?"];
  const val: unknown[] = [orgId, canalId];

  if (filtros.estado !== undefined) {
    cond.push("c.cerrado_por = ?");
    val.push(filtros.estado);
  }

  val.push(Math.min(filtros.limite ?? 200, 400));

  return s(
    `SELECT c.*,
            (SELECT m.content FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultimo_texto,
            (SELECT m.emisor FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultimo_emisor,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS mensajes
       FROM conversations c
      WHERE ${cond.join(" AND ")}
      ORDER BY COALESCE(c.last_message_at, c.fecha_inicio) DESC
      LIMIT ?`,
  ).all(...val) as FilaBandeja[];
}

/**
 * UN LEAD EMPIEZA CUANDO EL CLIENTE ESCRIBIÓ, NO CUANDO ESTE PANEL SE ENTERÓ.
 *
 * `fecha_inicio` la pone el primer mensaje que abre el hilo, y hasta que se
 * importó el historial ese era siempre el primero que se veía. Al vincular un
 * número por QR entran de golpe conversaciones de semanas atrás: si todas
 * nacieran con la fecha de la importación, el panel diría que hoy llegaron
 * trescientos leads y el dashboard de hoy quedaría inservible, con las ventas
 * viejas contadas como de esta mañana.
 *
 * Solo se mueve hacia atrás, y solo con un mensaje DEL CLIENTE: un saliente
 * nuestro no empieza ningún lead, y una fecha que avanzara le cambiaría el
 * periodo a una conversación ya contada.
 */
export function adelantarInicio(orgId: number, id: number, cuando: number): void {
  s(
    `UPDATE conversations SET fecha_inicio = ?
      WHERE org_id = ? AND id = ? AND fecha_inicio > ?`,
  ).run(cuando, orgId, id, cuando);
}

/**
 * EL MISMO CLIENTE, UN SOLO HILO.
 *
 * WhatsApp identifica a una persona de dos maneras —su número y un `@lid`
 * interno que no se le parece en nada— y no siempre manda las dos. Cuando solo
 * llega el `@lid`, la conversación se abre bajo esos dígitos; si más tarde el
 * mismo cliente llega con su número, se abría OTRA. El resultado en pantalla
 * son dos hilos del mismo cliente, cada uno con la mitad de lo hablado, y una
 * venta cerrada en uno de los dos que el otro no conoce.
 *
 * En cuanto WhatsApp dice qué teléfono hay detrás de ese `@lid` —lo manda en el
 * lote del historial y en el mapa de la sesión— esto los junta:
 *
 *  - Si el hilo del teléfono no existe, al del `@lid` se le cambia la clave. No
 *    se mueve ni un mensaje: es el mismo hilo, ahora con el nombre bueno.
 *  - Si existen los dos, todo lo del `@lid` se muda al del teléfono: mensajes,
 *    anomalías y seguimientos. El lead empieza en la fecha más antigua de los
 *    dos, y si uno de ellos tenía la venta cerrada, esa venta se conserva.
 *
 * Devuelve el identificador del hilo que queda, o null si no había nada que
 * juntar. Es idempotente: a la segunda pasada ya no existe el hilo de origen.
 */
export function unificarConversacion(
  orgId: number,
  canalId: number,
  telefonoViejo: string,
  telefonoBueno: string,
): number | null {
  if (!telefonoViejo || !telefonoBueno || telefonoViejo === telefonoBueno) return null;

  const tx = db.transaction(() => {
    const origen = s(
      `SELECT * FROM conversations WHERE org_id = ? AND canal_id = ? AND cliente_phone = ?`,
    ).get(orgId, canalId, telefonoViejo) as Conversacion | undefined;
    if (!origen) return null;

    const destino = s(
      `SELECT * FROM conversations WHERE org_id = ? AND canal_id = ? AND cliente_phone = ?`,
    ).get(orgId, canalId, telefonoBueno) as Conversacion | undefined;

    // Nadie con quien juntarse: basta con ponerle la clave buena.
    if (!destino) {
      s(`UPDATE conversations SET cliente_phone = ? WHERE org_id = ? AND id = ?`)
        .run(telefonoBueno, orgId, origen.id);
      return origen.id;
    }

    s(`UPDATE messages SET conversation_id = ? WHERE org_id = ? AND conversation_id = ?`)
      .run(destino.id, orgId, origen.id);
    s(`UPDATE anomalies SET conversation_id = ? WHERE org_id = ? AND conversation_id = ?`)
      .run(destino.id, orgId, origen.id);
    // El seguimiento es único por hilo y tipo: el que ya tenga el destino manda,
    // y el repetido se tira en vez de reventar la unión entera.
    s(`UPDATE OR IGNORE seguimientos SET conversation_id = ? WHERE org_id = ? AND conversation_id = ?`)
      .run(destino.id, orgId, origen.id);
    s(`DELETE FROM seguimientos WHERE org_id = ? AND conversation_id = ?`).run(orgId, origen.id);

    /*
     * UNA SOLA VENTA, y la que manda es la que cerró el pedido.
     *
     * Se hereda la del `@lid` cuando el destino estaba abierto —el caso que
     * hacía desaparecer ventas del dashboard— y TAMBIÉN cuando el destino solo
     * tenía la factura y el `@lid` el resumen: es la misma venta, la cerró el
     * resumen y cuenta el día del resumen. Sin esto, el resumen de ayer en un
     * hilo y la factura de hoy en el otro acababan en una venta asistida de hoy.
     * Entre dos cierres del mismo tipo, el primero. Una corrección manual del
     * destino no se toca.
     */
    const porFactura = (c: Conversacion) =>
      c.senal_de_cierre === "imagen_factura" || c.senal_de_cierre === "imagen_comprobante";
    const heredaCierre =
      origen.fecha_cierre !== null &&
      (destino.fecha_cierre === null ||
        (destino.senal_de_cierre !== "correccion_manual" &&
          ((porFactura(destino) && !porFactura(origen) && origen.senal_de_cierre === "resumen_ia") ||
            (porFactura(destino) === porFactura(origen) && origen.fecha_cierre < destino.fecha_cierre))));
    // La factura de los dos hilos, la primera que hubo.
    const facturas = [origen.facturada_at, destino.facturada_at].filter((f): f is number => f !== null);
    if (heredaCierre && destino.fecha_cierre !== null && porFactura(destino)) facturas.push(destino.fecha_cierre);
    const facturadaAt = facturas.length ? Math.min(...facturas) : null;

    s(
      `UPDATE conversations SET
         fecha_inicio = MIN(fecha_inicio, ?),
         last_message_at = MAX(COALESCE(last_message_at, 0), COALESCE(?, 0)),
         cliente_nombre = COALESCE(cliente_nombre, ?),
         cliente_jid = COALESCE(cliente_jid, ?),
         origen = COALESCE(origen, ?),
         superficie = COALESCE(superficie, ?),
         red = COALESCE(red, ?),
         meta_ad_id = COALESCE(meta_ad_id, ?),
         producto_anuncio = COALESCE(producto_anuncio, ?),
         descripcion_anuncio = COALESCE(descripcion_anuncio, ?),
         intervencion_humana = MAX(intervencion_humana, ?),
         cerrado_por = CASE WHEN ? = 1 THEN ? ELSE cerrado_por END,
         senal_de_cierre = CASE WHEN ? = 1 THEN ? ELSE senal_de_cierre END,
         fecha_cierre = CASE WHEN ? = 1 THEN ? ELSE fecha_cierre END,
         facturada_at = ?,
         total = COALESCE(total, ?),
         envio = COALESCE(envio, ?),
         producto_vendido = COALESCE(producto_vendido, ?),
         resumen_pedido = COALESCE(resumen_pedido, ?)
       WHERE org_id = ? AND id = ?`,
    ).run(
      origen.fecha_inicio,
      origen.last_message_at,
      origen.cliente_nombre,
      origen.cliente_jid,
      origen.origen,
      origen.superficie,
      origen.red,
      origen.meta_ad_id,
      origen.producto_anuncio,
      origen.descripcion_anuncio,
      origen.intervencion_humana,
      heredaCierre ? 1 : 0, origen.cerrado_por,
      heredaCierre ? 1 : 0, origen.senal_de_cierre,
      heredaCierre ? 1 : 0, origen.fecha_cierre,
      facturadaAt,
      origen.total,
      origen.envio,
      origen.producto_vendido,
      origen.resumen_pedido,
      orgId, destino.id,
    );

    s(`DELETE FROM conversations WHERE org_id = ? AND id = ?`).run(orgId, origen.id);
    return destino.id;
  });

  return tx();
}

export function listarConversaciones(orgId: number, filtros: {
  desde?: number; hasta?: number; canalId?: number;
  /**
   * El reparto por miembro: solo estos canales, o ninguna condición si viene
   * vacío o sin poner —«sin restricción» es el mismo significado en toda la
   * plataforma, ver `canalesDeMiembro`—. Va aparte de `canalId`, que es el
   * filtro manual de la pantalla: los dos pueden venir juntos, y entonces
   * mandan los dos a la vez.
   */
  canalIds?: number[];
  estado?: EstadoCierre; limite?: number; offset?: number;
} = {}): Conversacion[] {
  const cond: string[] = ["org_id = ?"];
  const val: unknown[] = [orgId];

  if (filtros.desde !== undefined) { cond.push("fecha_inicio >= ?"); val.push(filtros.desde); }
  if (filtros.hasta !== undefined) { cond.push("fecha_inicio <= ?"); val.push(filtros.hasta); }
  if (filtros.canalId !== undefined) { cond.push("canal_id = ?"); val.push(filtros.canalId); }
  if (filtros.canalIds !== undefined) {
    if (filtros.canalIds.length === 0) return [];
    cond.push(`canal_id IN (${filtros.canalIds.map(() => "?").join(",")})`);
    val.push(...filtros.canalIds);
  }
  if (filtros.estado !== undefined) { cond.push("cerrado_por = ?"); val.push(filtros.estado); }

  return s(
    `SELECT * FROM conversations WHERE ${cond.join(" AND ")}
      ORDER BY COALESCE(last_message_at, fecha_inicio) DESC
      LIMIT ? OFFSET ?`,
  ).all(...val, filtros.limite ?? 100, filtros.offset ?? 0) as Conversacion[];
}

const COLUMNAS_CONV = [
  "cliente_nombre", "origen", "producto_anuncio", "descripcion_anuncio", "intervencion_humana",
  "senal_de_cierre", "total", "envio", "producto_vendido", "resumen_pedido",
  "justificacion", "datos_faltantes", "motivo_perdida", "analizada_at",
  "last_message_at",
] as const;

/** Actualiza campos de análisis. NO puede tocar `cerrado_por` ni `fecha_cierre`. */
export function actualizarConversacion(orgId: number, id: number, campos: Partial<Conversacion>): void {
  const { sql, valores } = armarSet(campos, COLUMNAS_CONV);
  if (!sql) return;
  s(`UPDATE conversations SET ${sql} WHERE org_id = ? AND id = ?`).run(...valores, orgId, id);
}

/**
 * REGLA MAESTRA — el primero que cierra se lleva la venta.
 *
 * Sella el cierre solo si la conversación no tenía uno. Una vez sellada, ni la
 * factura que manda el vendedor diez minutos después ni ninguna otra señal
 * posterior la reclasifican. Las dos únicas formas de cambiarla son
 * `resolverRevision`, que es una corrección humana explícita, y
 * `reatribuirCierrePorResumen`, que es la regla del resumen sobre la factura y
 * está justificada ahí mismo.
 *
 * Devuelve true si este cierre fue el que quedó.
 */
export function sellarCierre(orgId: number, id: number, cierre: {
  cerradoPor: "ia" | "humano"; senal: string; fechaCierre: number;
  /** Si lo que cierra es la propia factura, la venta nace ya facturada. */
  facturadaAt?: number | null;
}): boolean {
  const r = s(
    `UPDATE conversations
        SET cerrado_por = ?, senal_de_cierre = ?, fecha_cierre = ?,
            facturada_at = COALESCE(facturada_at, ?)
      WHERE org_id = ? AND id = ? AND fecha_cierre IS NULL`,
  ).run(cierre.cerradoPor, cierre.senal, cierre.fechaCierre, cierre.facturadaAt ?? null, orgId, id);
  return r.changes > 0;
}

/**
 * LA FACTURA CONFIRMA LA VENTA; NO LA CREA NI LA MUEVE DE DÍA.
 *
 * La venta ya existe —la cerró el resumen de la IA— y el equipo manda la foto
 * de la factura, quizá al día siguiente. Esto solo apunta cuándo: la venta se
 * queda en el día en que se cerró. Vale la PRIMERA foto: las siguientes de la
 * misma factura no cambian nada, ni cuentan otra vez. Devuelve true si esta
 * foto fue la que la marcó.
 */
export function marcarFacturada(orgId: number, id: number, cuando: number): boolean {
  const r = s(
    `UPDATE conversations SET facturada_at = ?
      WHERE org_id = ? AND id = ? AND (facturada_at IS NULL OR facturada_at > ?)`,
  ).run(cuando, orgId, id, cuando);
  return r.changes > 0;
}

/**
 * EL DINERO DEL RESUMEN, en cuanto se sella la venta.
 *
 * Solo rellena lo que está vacío: si el analista ya pasó y dejó su total, o si
 * una persona lo corrigió, eso manda. Es lo que hace que una venta cerrada
 * hace un minuto ya facture en el panel, en vez de valer cero hasta que el
 * modelo pase por el hilo.
 */
export function asentarMontosSiFaltan(
  orgId: number,
  id: number,
  montos: { total: number | null; envio: number | null },
): void {
  if (montos.total === null && montos.envio === null) return;
  s(
    `UPDATE conversations
        SET total = COALESCE(total, ?), envio = COALESCE(envio, ?)
      WHERE org_id = ? AND id = ?`,
  ).run(montos.total, montos.envio, orgId, id);
}

/**
 * EL RESUMEN DE PEDIDO MANDA SOBRE LA FACTURA.
 *
 * Única excepción a la regla maestra, y solo en un sentido: un resumen de
 * pedido le quita la venta a una factura, nunca al revés. El resumen es el
 * momento en que el pedido queda cerrado —producto, total y envío—, y la
 * factura es papeleo alrededor de esa misma venta. Un vendedor que adelanta la
 * factura mientras la IA está cerrando no le quita la venta a la IA.
 *
 * El `WHERE` es la garantía, no el código que llama: solo se mueven los cierres
 * cuya señal fue una imagen. Un cierre por resumen no se toca —el primero de
 * ellos manda— y una corrección manual, menos todavía: esa la firmó una
 * persona.
 *
 * Y SE LLEVA SU FECHA. La venta automatizada cuenta el día del resumen, no el
 * de la factura (la dueña, 2026-09-11: «la venta cuenta el día en que se
 * cerró, no el día de la factura»). Antes aquí la fecha no se tocaba, y una
 * venta que el resumen cerró ayer se quedaba contada el día en que llegó la
 * foto. La hora de esa foto no se pierde: pasa a `facturada_at`, que es lo que
 * de verdad era.
 */
export function reatribuirCierrePorResumen(orgId: number, id: number, cierre: {
  cerradoPor: "ia" | "humano"; senal: string; fechaCierre: number;
}): boolean {
  const r = s(
    `UPDATE conversations
        SET cerrado_por = ?, senal_de_cierre = ?, fecha_cierre = ?,
            facturada_at = COALESCE(facturada_at, fecha_cierre)
      WHERE org_id = ? AND id = ?
        AND senal_de_cierre IN ('imagen_factura', 'imagen_comprobante')`,
  ).run(cierre.cerradoPor, cierre.senal, cierre.fechaCierre, orgId, id);
  return r.changes > 0;
}

/** Manda la conversación a la bandeja de revisión. No es un cierre: no sella. */
export function marcarRevision(orgId: number, id: number, justificacion: string): void {
  s(
    `UPDATE conversations SET cerrado_por = 'revision', justificacion = ?
      WHERE org_id = ? AND id = ? AND fecha_cierre IS NULL`,
  ).run(justificacion, orgId, id);
}

/**
 * Corrección manual desde la bandeja. Es lo único que rompe el sellado.
 *
 * La fecha, si no la tenía, es la de la señal que cierra según quién —el
 * resumen, o la primera factura—, la calcula `fechaDelCierre` en `cierre.ts`.
 * Con el último mensaje, una venta confirmada hoy de un pedido de ayer se
 * contaba hoy, que es justo lo que no puede pasar.
 */
export function resolverRevision(orgId: number, id: number, quien: "ia" | "humano", fecha?: number | null): void {
  s(
    `UPDATE conversations
        SET cerrado_por = ?, senal_de_cierre = 'correccion_manual',
            fecha_cierre = COALESCE(fecha_cierre, ?, last_message_at, unixepoch())
      WHERE org_id = ? AND id = ?`,
  ).run(quien, fecha ?? null, orgId, id);
}

export function contarRevisiones(orgId: number, restringirA?: number[] | null): number {
  if (restringirA !== undefined && restringirA !== null && restringirA.length === 0) return 0;
  const cond = ["org_id = ?", "cerrado_por = 'revision'"];
  const val: unknown[] = [orgId];
  if (restringirA) {
    cond.push(`canal_id IN (${restringirA.map(() => "?").join(",")})`);
    val.push(...restringirA);
  }
  return (s(`SELECT COUNT(*) AS n FROM conversations WHERE ${cond.join(" AND ")}`).get(...val) as { n: number }).n;
}

/**
 * Recalcula `intervencion_humana` a partir de los mensajes reales del hilo.
 * Se llama cuando `/api/ai-sent` llega tarde y corrige un mensaje de humano a
 * IA: sin esto, un cierre de la IA se queda contado como humano para siempre.
 */
export function recalcularIntervencionHumana(orgId: number, conversationId: number): void {
  s(
    `UPDATE conversations
        SET intervencion_humana = (
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM messages
             WHERE org_id = ? AND conversation_id = ? AND emisor = 'humano'
          ) THEN 1 ELSE 0 END
        )
      WHERE org_id = ? AND id = ?`,
  ).run(orgId, conversationId, orgId, conversationId);
}

/**
 * Todo lo que salió de este número lo escribió una IA, no una persona.
 *
 * Se ejecuta cuando el dueño marca el número como atendido por una IA. Hasta
 * ese momento el panel no tenía forma de saberlo: un mensaje saliente que no
 * mandamos nosotros —porque lo manda su propio bot— se guardaba como `humano`,
 * y de ahí salían las dos cosas que el dueño ve mal: la pastilla naranja de
 * «intervino» en conversaciones donde no intervino nadie, y sus ventas
 * acreditadas al equipo en vez de a la IA.
 *
 * Corrige el ORIGEN —el emisor de los mensajes— y con eso se apaga la pastilla
 * de «intervino» en los hilos donde no intervino nadie.
 *
 * NO toca los cierres, y ya no hace falta: quién cerró lo decide la SEÑAL y no
 * el emisor —el resumen es automatizado siempre, la foto de la factura es
 * asistida siempre—, así que un número marcado como atendido por IA ya cuenta
 * bien sus ventas antes de pulsar nada. Este botón es para la intervención, que
 * es el otro dato.
 *
 * Es una corrección explícita del dueño, y no se deshace sola al apagar el
 * ajuste: los mensajes ya reatribuidos se quedan como IA.
 */
export function reatribuirCanalAIa(orgId: number, canalId: number): { mensajes: number } {
  const tx = db.transaction(() => {
    const enElCanal = `SELECT id FROM conversations WHERE org_id = ? AND canal_id = ?`;

    const mensajes = s(
      `UPDATE messages SET emisor = 'ia'
        WHERE org_id = ? AND emisor = 'humano' AND conversation_id IN (${enElCanal})`,
    ).run(orgId, orgId, canalId).changes;

    s(
      `UPDATE conversations SET intervencion_humana = 0
        WHERE org_id = ? AND canal_id = ?`,
    ).run(orgId, canalId);

    return { mensajes };
  });

  return tx();
}

/**
 * Hilos a barrer en el procedimiento diario: con novedades, todavía abiertos, o
 * CERRADOS SIN ANALIZAR.
 *
 * Ese tercer grupo es el de las ventas que se sellaron solas al llegar el
 * mensaje con el marcador. El cierre ya está atribuido —eso no cuesta ni una
 * llamada al modelo—, pero el pedido que hay dentro (producto, total, envío)
 * sigue sin extraer. Sin esta rama, esas ventas contaban como cierre y
 * facturaban cero para siempre: la conversación estaba cerrada, así que nada
 * volvía a mirarla.
 */
export function conversacionesPorAnalizar(orgId: number, desde: number): Conversacion[] {
  return s(
    `SELECT * FROM conversations
      WHERE org_id = ?
        AND (
          (fecha_cierre IS NULL
            AND (analizada_at IS NULL OR last_message_at > analizada_at OR last_message_at >= ?))
          OR (fecha_cierre IS NOT NULL AND analizada_at IS NULL)
        )
      ORDER BY last_message_at ASC`,
  ).all(orgId, desde) as Conversacion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mensajes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserta un mensaje. IDEMPOTENTE: `whapi_message_id` es UNIQUE y el proveedor
 * reintenta los webhooks. Si ya existía, no hace nada y devuelve `null`.
 */
export function insertMessage(orgId: number, datos: {
  conversationId: number; whapiMessageId: string | null; emisor: Emisor;
  tipo: TipoMensaje; content: string; createdAt: number;
  mediaUrl?: string | null;
}): number | null {
  const tx = db.transaction(() => {
    const r = s(
      `INSERT INTO messages
         (org_id, conversation_id, whapi_message_id, emisor, tipo, content, media_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(whapi_message_id) DO NOTHING`,
    ).run(
      orgId, datos.conversationId, datos.whapiMessageId, datos.emisor,
      datos.tipo, datos.content, datos.mediaUrl ?? null, datos.createdAt,
    );

    if (r.changes === 0) return null;

    s(
      `UPDATE conversations
          SET last_message_at = MAX(COALESCE(last_message_at, 0), ?),
              intervencion_humana = CASE WHEN ? = 'humano' THEN 1 ELSE intervencion_humana END
        WHERE org_id = ? AND id = ?`,
    ).run(datos.createdAt, datos.emisor, orgId, datos.conversationId);

    return Number(r.lastInsertRowid);
  });
  return tx();
}

export function listarMensajes(orgId: number, conversationId: number): Mensaje[] {
  return s(
    `SELECT * FROM messages
      WHERE org_id = ? AND conversation_id = ?
      ORDER BY created_at ASC, id ASC`,
  ).all(orgId, conversationId) as Mensaje[];
}

export function ultimosMensajes(orgId: number, conversationId: number, n: number): Mensaje[] {
  const filas = s(
    `SELECT * FROM messages
      WHERE org_id = ? AND conversation_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(orgId, conversationId, n) as Mensaje[];
  return filas.reverse();
}

/** El texto de una nota de voz. Lo escribe el analista una sola vez. */
export function guardarTranscripcion(orgId: number, mensajeId: number, texto: string): void {
  s(`UPDATE messages SET transcripcion = ? WHERE org_id = ? AND id = ?`).run(texto, orgId, mensajeId);
}

/** Deja constancia de la ruta del archivo guardado, ya descargado del socket. */
export function guardarMediaUrl(orgId: number, mensajeId: number, url: string): void {
  s(`UPDATE messages SET media_url = ? WHERE org_id = ? AND id = ?`).run(url, orgId, mensajeId);
}

/**
 * Reescribe el texto de una UBICACIÓN con la dirección que salió de sus
 * coordenadas: provincia, distrito, barrio y calle.
 *
 * Va en el `content` y no en una columna nueva, por lo mismo que la marca
 * `[ubicación]`: el contenido es lo que ya leen el hilo, la vista previa de la
 * bandeja, el analista y el informe, así que la dirección aparece en los cuatro
 * sin tocar ninguno.
 *
 * Solo toca mensajes que SIGAN siendo una ubicación —el LIKE de la condición—,
 * para que esto no pueda reescribir por error el texto de un cliente.
 */
export function guardarUbicacionResuelta(
  orgId: number,
  mensajeId: number,
  texto: string,
): void {
  s(
    `UPDATE messages SET content = ?
      WHERE org_id = ? AND id = ? AND tipo = 'otro' AND content LIKE '[ubicación]%'`,
  ).run(texto, orgId, mensajeId);
}

export function guardarDescripcionImagen(orgId: number, mensajeId: number, datos: {
  descripcion: string; categoria: CategoriaImagen | null;
}): void {
  s(
    `UPDATE messages SET descripcion_imagen = ?, categoria_imagen = ?
      WHERE org_id = ? AND id = ?`,
  ).run(datos.descripcion, datos.categoria, orgId, mensajeId);
}

/**
 * Los mensajes que mandamos nosotros en los hilos donde un resumen de pedido
 * todavía puede cambiar algo. Es lo que barre `cierre.ts`.
 *
 * Son dos grupos, y por dos razones distintas:
 *
 *   - Los que siguen SIN CERRAR: puede haber un resumen dentro que nadie selló
 *     nunca —porque llegó antes de que existiera el sellado automático— y esa
 *     venta está hecha y sin contar.
 *   - Los cerrados POR UNA FACTURA: si además hay un resumen en el hilo, la
 *     venta es de quien lo escribió. Ver `reatribuirCierrePorResumen`.
 *
 * Lo cerrado por un resumen no entra: ahí ya mandó el primero, y ninguno
 * posterior lo mueve. Solo salientes, porque un cliente no cierra una venta
 * escribiendo «resumen».
 *
 * El orden es el de la conversación, para que el PRIMER marcador de cada hilo
 * sea también el primero que sale de aquí: entre dos resúmenes gana el
 * primero, no el último que se escribió.
 */
export function salientesDeHilosPorSellar(
  orgId: number,
  limite = 20_000,
): { conversation_id: number; emisor: Emisor; content: string; created_at: number }[] {
  return s(
    `SELECT m.conversation_id, m.emisor, m.content, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id AND c.org_id = m.org_id
      WHERE m.org_id = ? AND m.emisor <> 'cliente'
        AND (c.fecha_cierre IS NULL
             OR c.senal_de_cierre IN ('imagen_factura', 'imagen_comprobante'))
      ORDER BY m.conversation_id ASC, m.created_at ASC, m.id ASC
      LIMIT ?`,
  ).all(orgId, limite) as {
    conversation_id: number; emisor: Emisor; content: string; created_at: number;
  }[];
}

/**
 * DESDE DÓNDE PEDIRLE AL TELÉFONO LO QUE FALTA.
 *
 * WhatsApp solo manda el historial entero una vez, al vincular el número. Para
 * un número que ya estaba conectado —donde el panel empezó a existir a media
 * conversación— la única forma de recuperar lo de antes es pedírselo hilo por
 * hilo, y para eso hace falta un ancla: el mensaje MÁS VIEJO que tenemos de esa
 * conversación. El teléfono devuelve lo que había antes de él.
 *
 * Sale la dirección del cliente, el identificador de ese mensaje, si lo
 * mandamos nosotros y cuándo: es exactamente lo que pide `fetchMessageHistory`.
 * Los hilos sin un solo identificador —los sembrados a mano en una prueba— no
 * salen: no hay ancla que dar.
 *
 * Ordenado por actividad reciente: si hay que cortar por el límite, se pide
 * primero el pasado de las conversaciones vivas.
 */
export function anclasDeHistorial(
  orgId: number,
  canalId: number,
  limite = 300,
): { jid: string; mensaje: string; deMi: boolean; cuando: number }[] {
  const filas = s(
    `SELECT COALESCE(c.cliente_jid, c.cliente_phone) AS jid,
            m.whapi_message_id AS mensaje,
            m.emisor AS emisor,
            m.created_at AS cuando
       FROM conversations c
       JOIN messages m ON m.id = (
              SELECT m2.id FROM messages m2
               WHERE m2.conversation_id = c.id AND m2.whapi_message_id IS NOT NULL
               ORDER BY m2.created_at ASC, m2.id ASC LIMIT 1)
      WHERE c.org_id = ? AND c.canal_id = ?
      ORDER BY COALESCE(c.last_message_at, c.fecha_inicio) DESC
      LIMIT ?`,
  ).all(orgId, canalId, limite) as
    { jid: string; mensaje: string; emisor: Emisor; cuando: number }[];

  return filas.map((f) => ({
    jid: f.jid,
    mensaje: f.mensaje,
    deMi: f.emisor !== "cliente",
    cuando: f.cuando,
  }));
}

/**
 * Las organizaciones que tienen algo que barrer al arrancar.
 *
 * EXCEPCIÓN a la regla de aislamiento, de la misma clase que
 * `canalesParaReconectar`: el barrido del arranque no tiene sesión de la que
 * deducir una organización. Devuelve identificadores y nada más —ni una
 * conversación, ni un mensaje, ni un importe—, y cada identificador vuelve
 * inmediatamente como `orgId` de las funciones normales.
 */
export function orgsParaBarrerCierres(): number[] {
  const filas = s(
    `SELECT DISTINCT org_id FROM conversations
      WHERE fecha_cierre IS NULL
         OR senal_de_cierre IN ('imagen_factura', 'imagen_comprobante')`,
  ).all() as { org_id: number }[];
  return filas.map((f) => f.org_id);
}

/** ¿Escribió un humano desde `desde`? Silencia al agente vendedor. */
export function huboHumanoReciente(orgId: number, conversationId: number, desde: number): boolean {
  /*
   * LO QUE ESCRIBIÓ EL EQUIPO ANTES DE DEVOLVER EL HILO A LA IA NO CUENTA.
   *
   * El caso real (la dueña, 2026-09-05): un mensaje salió por el número desde
   * otra plataforma, entró como «humano», y el agente se calló dos horas
   * aunque ella le devolvió la atención. Devolver el hilo es decir «desde ahora
   * contesta la IA»: solo la calla lo que el equipo escriba DESPUÉS.
   *
   * Y DESPUÉS ES ESTRICTAMENTE DESPUÉS (la dueña, 2026-09-10): las horas se
   * guardan en segundos, y el gesto normal es escribir la despedida y pulsar
   * «Contesta la IA» en el mismo segundo. Con un «>=», ese último mensaje del
   * propio equipo volvía a callar al agente que acababan de despertar.
   */
  const fila = s(
    `SELECT 1 AS x FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.org_id = ? AND m.conversation_id = ? AND m.emisor = 'humano'
        AND m.created_at >= ? AND m.created_at > COALESCE(c.devuelta_a_ia_at, 0)
      LIMIT 1`,
  ).get(orgId, conversationId, desde) as { x: number } | undefined;
  return !!fila;
}

/** Respuestas que el agente ya mandó en esta conversación desde `desde`. */
export function contarRespuestasIa(orgId: number, conversationId: number, desde: number): number {
  return (s(
    `SELECT COUNT(*) AS n FROM messages
      WHERE org_id = ? AND conversation_id = ? AND emisor = 'ia' AND created_at >= ?`,
  ).get(orgId, conversationId, desde) as { n: number }).n;
}

/**
 * Los últimos mensajes que escribió el agente en un hilo, del más nuevo al más
 * viejo. Se usa para reconocer un bucle: el agente repitiendo la misma frase.
 *
 * `desde` acota a los recientes, y no es un detalle: un bucle pasa en minutos.
 * Sin ventana, tres respuestas iguales dejaban ese hilo mudo PARA SIEMPRE —las
 * tres seguían siendo las últimas, porque el agente ya no volvía a escribir—, y
 * el cliente que volvía tres días después no recibía nada.
 */
export function ultimasRespuestasIa(orgId: number, conversationId: number, n: number, desde = 0): string[] {
  const filas = s(
    `SELECT content FROM messages
      WHERE org_id = ? AND conversation_id = ? AND emisor = 'ia' AND created_at >= ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(orgId, conversationId, desde, n) as { content: string }[];
  return filas.map((f) => f.content);
}

/**
 * Devuelve el hilo a la IA: cierra las anomalías que la tenían callada.
 *
 * `pidio_humano` y `handoff_agente` no son avisos, son interruptores: mientras
 * estén abiertas, `atenderConversacion` no escribe una palabra en ese hilo. Y
 * hasta ahora no había forma de cerrarlas desde ninguna pantalla, así que una
 * conversación que pasó a un asesor se quedaba sin agente PARA SIEMPRE —también
 * cuando el cliente volvía tres días después a comprar—.
 *
 * Devuelve cuántas se cerraron.
 */
export function devolverALaIa(orgId: number, conversationId: number): number {
  const tx = db.transaction(() => {
    const r = s(
      `UPDATE anomalies SET resuelta = 1
        WHERE org_id = ? AND conversation_id = ? AND resuelta = 0
          AND tipo IN ('pidio_humano', 'handoff_agente', 'agente_en_bucle')`,
    ).run(orgId, conversationId);

    // Y el interruptor de la conversación, que es la otra forma de tenerla
    // callada: devolver el hilo a la IA es una sola cosa, no dos. Con la hora,
    // para que lo que el equipo escribió antes deje de callarla (ver
    // `huboHumanoReciente`): no hay que esperar dos horas.
    s(`UPDATE conversations SET atiende = 'ia', devuelta_a_ia_at = ? WHERE org_id = ? AND id = ?`)
      .run(ahora(), orgId, conversationId);

    return r.changes;
  });
  return tx();
}

/**
 * QUIÉN ATIENDE ESTE HILO, dicho a mano desde la conversación.
 *
 * Pasarlo a 'humano' calla al agente en esa conversación y solo en esa: el
 * número sigue contestando a todos los demás clientes. Es la pieza que faltaba
 * entre las dos únicas opciones que había —el agente encendido para todo el
 * mundo, o apagado para todo el mundo—.
 *
 * No crea ninguna anomalía a propósito: esto no es una avería que alguien deba
 * revisar, es una decisión de quien atiende.
 */
export function ponerAtiende(orgId: number, conversationId: number, quien: "ia" | "humano"): void {
  s(`UPDATE conversations SET atiende = ? WHERE org_id = ? AND id = ?`)
    .run(quien, orgId, conversationId);
}

/** Las anomalías abiertas de un hilo. El panel enseña por qué está callado. */
export function anomaliasDeConversacion(orgId: number, conversationId: number): Anomalia[] {
  return s(
    `SELECT * FROM anomalies
      WHERE org_id = ? AND conversation_id = ? AND resuelta = 0
      ORDER BY id DESC`,
  ).all(orgId, conversationId) as Anomalia[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Atribución — ai_sent_ids
// ─────────────────────────────────────────────────────────────────────────────

export function registrarAiSent(orgId: number, whapiMessageId: string): void {
  s(
    `INSERT INTO ai_sent_ids (whapi_message_id, org_id) VALUES (?, ?)
     ON CONFLICT(whapi_message_id) DO NOTHING`,
  ).run(whapiMessageId, orgId);
}

export function esDeIa(orgId: number, whapiMessageId: string): boolean {
  const fila = s(
    `SELECT 1 AS x FROM ai_sent_ids WHERE org_id = ? AND whapi_message_id = ?`,
  ).get(orgId, whapiMessageId) as { x: number } | undefined;
  return !!fila;
}

/**
 * Carrera obligatoria: el webhook del saliente puede llegar ANTES que el aviso
 * de `/api/ai-sent`. En ese caso el mensaje quedó marcado como `humano`.
 * Cuando llega el aviso, esto lo corrige y devuelve la conversación afectada
 * para que quien llame recalcule `intervencion_humana`.
 */
export function corregirEmisorAIa(orgId: number, whapiMessageId: string): number | null {
  const msg = s(
    `SELECT id, conversation_id, emisor FROM messages
      WHERE org_id = ? AND whapi_message_id = ?`,
  ).get(orgId, whapiMessageId) as
    | { id: number; conversation_id: number; emisor: Emisor }
    | undefined;

  if (!msg || msg.emisor !== "humano") return null;

  s(`UPDATE messages SET emisor = 'ia' WHERE org_id = ? AND id = ?`).run(orgId, msg.id);
  return msg.conversation_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agente vendedor y catálogo
// ─────────────────────────────────────────────────────────────────────────────

/** El identificador con el que se pide la plantilla de la cuenta. */
export const AGENTE_DE_LA_CUENTA = 0;

/** Todo lo que se copia de un agente a otro al crear el de un canal nuevo. */
const HEREDABLES = `nombre, negocio, tono, instrucciones, pais, conocimiento,
  usar_catalogo, ver_imagenes, oir_audios, validar_mapa,
  modelo, modelo_respaldo, modelo_vision, modelo_audio,
  pasar_a_humano, silenciar_si_humano, retardo_seg, envio_cerca, envio_lejos,
  horario_activo, horario_desde, horario_hasta,
  recordatorio_visto, recordatorio_visto_horas`;

/**
 * El agente de un canal, creándolo la primera vez que se pide.
 *
 * `canalId = 0` es la plantilla de la cuenta: la que se copia al conectar un
 * número nuevo y la que ve quien todavía no tiene ninguno. Ese es el
 * comportamiento de antes, así que quien llame sin canal sigue obteniendo lo
 * mismo que obtenía.
 *
 * UN AGENTE NUEVO NACE COPIADO, no en blanco. El guion de venta es lo que más
 * trabajo cuesta escribir de todo el panel: conectar el cuarto número y
 * encontrarse un cuadro de instrucciones vacío es la diferencia entre encender
 * un canal en un minuto y no encenderlo. Lo que cambia entre países —el país,
 * el conocimiento, el modelo— se cambia después, encima de la copia.
 */
export function obtenerAgente(orgId: number, canalId: number = AGENTE_DE_LA_CUENTA): Agente {
  const leer = (id: number) =>
    s(`SELECT * FROM agentes WHERE org_id = ? AND canal_id = ?`).get(orgId, id) as
      | Agente
      | undefined;

  const fila = leer(canalId);
  if (fila) return fila;

  // La plantilla primero: de ella sale la copia. Si tampoco existe, nace con
  // los valores por defecto de la tabla.
  if (canalId !== AGENTE_DE_LA_CUENTA && !leer(AGENTE_DE_LA_CUENTA)) {
    s(`INSERT INTO agentes (org_id, canal_id, modelo, modelo_respaldo) VALUES (?, 0, ?, ?)`)
      .run(orgId, MODELO_AGENTE, MODELO_RESPALDO);
  }

  if (canalId === AGENTE_DE_LA_CUENTA) {
    s(`INSERT INTO agentes (org_id, canal_id, modelo, modelo_respaldo) VALUES (?, 0, ?, ?)`)
      .run(orgId, MODELO_AGENTE, MODELO_RESPALDO);
  } else {
    s(
      `INSERT INTO agentes (org_id, canal_id, ${HEREDABLES})
       SELECT ?, ?, ${HEREDABLES} FROM agentes WHERE org_id = ? AND canal_id = 0`,
    ).run(orgId, canalId, orgId);

    /*
     * Y el país sale del propio número, si la plantilla no traía uno.
     *
     * El teléfono del canal YA DICE dónde vende: preguntárselo al dueño es
     * hacerle escribir un dato que tenemos delante, y es justo el campo que se
     * queda sin rellenar —con el agente hablando en neutro— porque nadie ve que
     * falta. Solo se rellena si la plantilla venía vacía: un país puesto a mano
     * manda sobre el prefijo, siempre.
     */
    ponerPaisPorTelefono(orgId, canalId);
  }

  return leer(canalId)!;
}

/** Los agentes de una cuenta, plantilla incluida. Para el panel. */
export function listarAgentes(orgId: number): Agente[] {
  return s(`SELECT * FROM agentes WHERE org_id = ? ORDER BY canal_id`).all(orgId) as Agente[];
}

/**
 * COPIA EL GUION DE UN CANAL A TODOS LOS DEMÁS.
 *
 * Un agente por canal fue lo correcto —cada país tiene su moneda, su forma de
 * dar una dirección y su modelo— pero trajo un problema que no se ve hasta que
 * se usa: las reglas del NEGOCIO son las mismas en los tres. La política de
 * cambios y devoluciones, cómo se cierra un pedido, qué no se promete. Cambiar
 * eso obligaba a pegarlo tres veces a mano, y a la tercera alguien se olvida y
 * un país empieza a contestar distinto que los otros dos sin que nadie se
 * entere.
 *
 * Copia SOLO las instrucciones, y esa lista corta es la decisión de diseño:
 *
 *   - el país, NO. Es lo que distingue a un canal del otro.
 *   - lo que vende y sus precios, NO. En Panamá se cobra en balboas y en Costa
 *     Rica en colones; pisar eso con los precios del vecino sería la peor
 *     manera de romper esto.
 *   - el modelo, NO. Se elige por número, según volumen y ticket.
 *
 * Alcanza también a la plantilla de la cuenta, para que los números que se
 * conecten mañana nazcan con la misma política.
 *
 * Devuelve a cuántos llegó.
 */
export function copiarGuionATodos(orgId: number, desdeCanalId: number): number {
  const origen = obtenerAgente(orgId, desdeCanalId);

  const r = s(
    `UPDATE agentes SET instrucciones = ?, updated_at = unixepoch()
      WHERE org_id = ? AND canal_id <> ?`,
  ).run(origen.instrucciones, orgId, desdeCanalId);

  return r.changes;
}

/**
 * Le pone al agente de un canal el país que dice su número, si no tenía uno.
 *
 * NO PISA lo que haya elegido una persona: el `pais = ''` del WHERE es la
 * condición entera. Alguien puede tener un número dominicano atendiendo a
 * clientes de Miami, y esa decisión suya no la puede deshacer un prefijo.
 *
 * Se llama en los dos momentos en que se sabe algo nuevo del número: al crear
 * el agente del canal, y al vincularlo por QR —que es cuando el canal deja de
 * ser «pendiente:…» y aprende su teléfono de verdad—.
 *
 * Devuelve el código que quedó puesto, o null si no había nada que deducir.
 */
export function ponerPaisPorTelefono(orgId: number, canalId: number): string | null {
  const canal = obtenerCanal(orgId, canalId);
  if (!canal) return null;

  const pais = paisDeTelefono(canal.phone);
  if (!pais) return null;

  const r = s(
    `UPDATE agentes SET pais = ?, updated_at = unixepoch()
      WHERE org_id = ? AND canal_id = ? AND pais = ''`,
  ).run(pais.codigo, orgId, canalId);

  return r.changes > 0 ? pais.codigo : null;
}

const COLUMNAS_AGENTE = [
  "nombre", "negocio", "tono", "instrucciones", "pais", "conocimiento", "usar_catalogo",
  "ver_imagenes", "oir_audios", "validar_mapa",
  "modelo", "modelo_respaldo", "modelo_vision", "modelo_audio",
  "pasar_a_humano", "silenciar_si_humano", "retardo_seg",
  "envio_cerca", "envio_lejos", "horario_activo",
  "horario_desde", "horario_hasta",
  "recordatorio_visto", "recordatorio_visto_horas",
] as const;

export function actualizarAgente(
  orgId: number,
  campos: Partial<Agente>,
  canalId: number = AGENTE_DE_LA_CUENTA,
): void {
  obtenerAgente(orgId, canalId);
  const { sql, valores } = armarSet(campos, COLUMNAS_AGENTE);
  if (!sql) return;
  s(`UPDATE agentes SET ${sql}, updated_at = unixepoch() WHERE org_id = ? AND canal_id = ?`)
    .run(...valores, orgId, canalId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seguimientos — el mensaje que el agente manda sin que le escriban
// ─────────────────────────────────────────────────────────────────────────────

/*
 * Solo queda uno. El aviso de «su pedido ya va en camino con el mensajero» se
 * quitó: lo mandaba el panel por su cuenta a quien no había pedido nada. La
 * tabla sigue admitiendo 'entrega' porque hay filas viejas con ese tipo, pero
 * ya no se escribe ninguna. Ver `enviarSeguimiento` en `agent.ts`.
 */
export type TipoSeguimiento = "visto";

/**
 * Las cuentas donde hay un agente contestando en algún número.
 *
 * El barrido corre cada pocos minutos y recorre cuentas: preguntar primero
 * cuáles tienen agente encendido evita pasearse por todas las demás, que no
 * pueden producir ni un seguimiento porque en sus números no escribe nadie.
 *
 * EXCEPCIÓN a la regla de aislamiento, la misma que `orgsParaBarrerCierres`:
 * el barrido no viene de una sesión y tiene que empezar por saber a quién
 * mirar. Devuelve identificadores de cuenta y nada más; a partir de aquí todo
 * vuelve a ir con `org_id`.
 */
export function orgsConAgente(): number[] {
  const filas = s(
    `SELECT DISTINCT org_id FROM canales
      WHERE activo = 1 AND agente_activo = 1 AND contesta_ia = 0`,
  ).all() as { org_id: number }[];
  return filas.map((f) => f.org_id);
}

/**
 * Conversaciones que se quedaron en el aire: habló el agente y el cliente no
 * volvió.
 *
 * Las condiciones son todas necesarias y ninguna es de adorno:
 *   - sigue abierta: una venta cerrada no se persigue.
 *   - el ÚLTIMO mensaje es del agente: si contestó el cliente, la conversación
 *     sigue viva; si escribió un vendedor, hay una persona ocupándose y el
 *     agente no se mete.
 *   - el número tiene al agente encendido: donde no contesta, tampoco insiste.
 *   - no se le mandó ya el recordatorio, y nadie pidió un asesor.
 *
 * La ventana tiene tope por arriba a propósito: al encender esto por primera
 * vez, sin él, saldría un recordatorio para cada conversación abandonada de
 * los últimos meses, todos a la vez.
 */
export function conversacionesEnVisto(
  orgId: number,
  ventana: { desde: number; hasta: number },
  limite = 20,
  /** Un solo canal. El barrido va canal por canal: cada uno tiene sus horas. */
  canalId?: number,
): Conversacion[] {
  return s(
    `SELECT c.* FROM conversations c
       JOIN canales ca ON ca.id = c.canal_id
      WHERE c.org_id = ?
        AND (? = 0 OR c.canal_id = ?)
        AND c.cerrado_por = 'abierta'
        AND ca.activo = 1 AND ca.agente_activo = 1 AND ca.contesta_ia = 0
        AND c.last_message_at BETWEEN ? AND ?
        AND (
          SELECT m.emisor FROM messages m
           WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC, m.id DESC LIMIT 1
        ) = 'ia'
        AND NOT EXISTS (
          SELECT 1 FROM seguimientos s
           WHERE s.conversation_id = c.id AND s.tipo = 'visto'
        )
        AND NOT EXISTS (
          SELECT 1 FROM anomalies a
           WHERE a.conversation_id = c.id AND a.resuelta = 0
             AND a.tipo IN ('pidio_humano', 'handoff_agente')
        )
      ORDER BY c.last_message_at ASC
      LIMIT ?`,
  ).all(orgId, canalId ?? 0, canalId ?? 0, ventana.desde, ventana.hasta, limite) as Conversacion[];
}

/**
 * Deja constancia de que este seguimiento ya salió. Devuelve `false` si ya
 * estaba: el UNIQUE de la tabla es lo que impide el mensaje duplicado cuando
 * dos barridos se solapan.
 */
export function registrarSeguimiento(
  orgId: number,
  conversationId: number,
  tipo: TipoSeguimiento,
): boolean {
  const r = s(
    `INSERT OR IGNORE INTO seguimientos (org_id, conversation_id, tipo) VALUES (?, ?, ?)`,
  ).run(orgId, conversationId, tipo);
  return r.changes > 0;
}

/**
 * EL CATÁLOGO, Y DE QUIÉN ES.
 *
 * Sin `canalId` sale entero: es la pantalla de Productos, donde la dueña ve y
 * reparte todo lo que vende. Con `canalId` sale lo de ESE número más lo que es
 * de toda la cuenta, y eso es lo único que puede leer su agente.
 *
 * Esa segunda forma existe por una fuga real: con el catálogo colgado de la
 * cuenta, el agente de Costa Rica leía los productos dominicanos y panameños
 * —y sus precios, que no llevan moneda escrita— como si fueran suyos, en
 * colones. Un combo de RD$1,690 le salía al cliente tico como ₡1.690.
 */
/**
 * LO QUE VENDE EL ANUNCIO DE ESTE CLIENTE, guardado en su conversación.
 *
 * Se pisa siempre: si el cliente vuelve por otro anuncio, lo que vale es el de
 * ahora —igual que `anuncio_actual_*`—. Y se guarda aunque no traiga precio: el
 * nombre, las tallas y los colores también hacen falta, y el precio puede
 * llegar del catálogo de anunciados.
 */
export function guardarProductoLead(orgId: number, conversationId: number, producto: unknown): void {
  s(`UPDATE conversations SET producto_lead = ? WHERE org_id = ? AND id = ?`)
    .run(JSON.stringify(producto), orgId, conversationId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que la tienda ANUNCIA, con su precio
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductoAnunciadoFila {
  id: number;
  org_id: number;
  nombre_llano: string;
  nombre: string;
  precio: number | null;
  precio_mayor: number | null;
  tallas: string | null;
  colores: string | null;
  descripcion: string | null;
  ad_id: string | null;
  actualizado_at: number;
}

/** Sin tildes ni mayúsculas, que es como se compara un nombre de producto. */
function llanoDeProducto(nombre: string): string {
  return nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * GUARDA LO QUE DICE UN ANUNCIO, o lo actualiza si ya estaba.
 *
 * El precio manda: un anuncio nuevo del mismo producto trae el precio de hoy y
 * pisa al de la campaña anterior. Lo que no se pisa es lo que el anuncio nuevo
 * no diga —las tallas, los colores—: perder un dato por un anuncio más escueto
 * sería cambiar información buena por nada.
 *
 * Sin precio no se guarda: este catálogo existe para poder cotizar, y una fila
 * sin cifra no sirve para eso y sí ensucia la búsqueda.
 */
export function guardarProductoAnunciado(
  orgId: number,
  p: { nombre: string; precio: number | null; precioMayor?: number | null; tallas?: string | null; colores?: string | null; descripcion?: string | null; adId?: string | null },
): void {
  const nombre = p.nombre.trim();
  if (!nombre || p.precio === null || p.precio === undefined) return;

  s(
    `INSERT INTO productos_anunciados
       (org_id, nombre_llano, nombre, precio, precio_mayor, tallas, colores, descripcion, ad_id, actualizado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(org_id, nombre_llano) DO UPDATE SET
       nombre        = excluded.nombre,
       precio        = excluded.precio,
       precio_mayor  = COALESCE(excluded.precio_mayor, productos_anunciados.precio_mayor),
       tallas        = COALESCE(excluded.tallas,       productos_anunciados.tallas),
       colores       = COALESCE(excluded.colores,      productos_anunciados.colores),
       descripcion   = COALESCE(excluded.descripcion,  productos_anunciados.descripcion),
       ad_id         = COALESCE(excluded.ad_id,        productos_anunciados.ad_id),
       actualizado_at = unixepoch()`,
  ).run(
    orgId,
    llanoDeProducto(nombre),
    nombre,
    p.precio,
    p.precioMayor ?? null,
    p.tallas ?? null,
    p.colores ?? null,
    p.descripcion ?? null,
    p.adId ?? null,
  );
}

/** Todo lo anunciado por esta tienda, de lo más reciente a lo más viejo. */
export function listarProductosAnunciados(orgId: number): ProductoAnunciadoFila[] {
  return s(
    `SELECT * FROM productos_anunciados WHERE org_id = ? ORDER BY actualizado_at DESC LIMIT 200`,
  ).all(orgId) as ProductoAnunciadoFila[];
}

/**
 * LA RAÍZ DE UNA PALABRA DE ARTÍCULO, para que dos formas de decir lo mismo
 * casen.
 *
 * La dueña (2026-09-11): «recuerda que los polos y los poloches» son lo mismo.
 * El catálogo de lo anunciado se buscaba palabra a palabra, así que la tienda
 * anunciaba «POLOS BRONX» y el cliente que escribía «quiero unos poloches» —o
 * «un polo», en singular— no lo encontraba: se quedaba sin precio y el agente,
 * sin nada que vender.
 *
 * Dos pasos, y los mismos a los dos lados de la comparación: el poloche es el
 * polo —en todas sus formas— y el plural se deja en singular.
 */
function raizDeArticulo(palabra: string): string {
  if (/^poloch(e|es|er|eres)$/.test(palabra)) return "polo";
  if (palabra.endsWith("ones") && palabra.length > 5) return palabra.slice(0, -2); // cinturones → cinturon
  if (palabra.endsWith("s") && palabra.length > 4) return palabra.slice(0, -1); // polos → polo
  return palabra;
}

/**
 * EL PRODUCTO ANUNCIADO QUE NOMBRA ESTE TEXTO, si es de esta tienda.
 *
 * El caso: el cliente escribe «quiero unos poloches» sin pinchar ningún
 * anuncio. Ese nombre lo anunció la tienda la semana pasada, con su precio, y
 * hasta ahora el agente no tenía dónde mirarlo.
 *
 * Se compara PALABRA A PALABRA y no por parecido: se exige que el texto del
 * cliente traiga una palabra del nombre que sea del artículo —«poloches»,
 * «combo»— y no un «de», un «para» ni el nombre de la tienda. Gana el que más
 * palabras comparta; a igualdad, el anunciado más recientemente.
 */
export function buscarProductoAnunciado(orgId: number, texto: string | null | undefined): ProductoAnunciadoFila | null {
  const t = llanoDeProducto(texto ?? "");
  if (!t) return null;

  const palabras = (x: string) =>
    x.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 4).map(raizDeArticulo);

  const palabrasDelCliente = new Set(palabras(t));
  if (!palabrasDelCliente.size) return null;

  let mejor: { fila: ProductoAnunciadoFila; aciertos: number } | null = null;

  for (const fila of listarProductosAnunciados(orgId)) {
    const suyas = palabras(fila.nombre_llano);
    const aciertos = suyas.filter((p) => palabrasDelCliente.has(p)).length;
    if (aciertos > 0 && (!mejor || aciertos > mejor.aciertos)) mejor = { fila, aciertos };
  }

  return mejor?.fila ?? null;
}

/**
 * SOLO UNA SUGERENCIA: el producto del catálogo cuyo nombre comparte más
 * palabras con lo que dice o enseña un anuncio (su texto, o lo que se leyó de
 * su imagen).
 *
 * NO vincula nada por su cuenta —eso lo sigue haciendo la dueña a mano en
 * «Anuncios»—: el panel la enseña como propuesta, con el nombre encima, para
 * que confirme con un clic o la descarte. Mismo criterio de palabra a palabra
 * que `buscarProductoAnunciado`, para no decidir por parecido difuso: un
 * vínculo automático mal hecho es justo el error que ya le costó caro a la
 * dueña (ver `elProductoNoEsDelAnuncio` en `contexto-anuncio.ts`).
 */
export function sugerirProductoDelCatalogo(
  orgId: number,
  texto: string | null | undefined,
): { id: number; nombre: string } | null {
  const t = llanoDeProducto(texto ?? "");
  if (!t) return null;

  const palabras = (x: string) =>
    x.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 4).map(raizDeArticulo);

  const palabrasDelAnuncio = new Set(palabras(t));
  if (!palabrasDelAnuncio.size) return null;

  let mejor: { producto: Producto; aciertos: number } | null = null;

  for (const producto of listarCatalogo(orgId, true)) {
    const suyas = palabras(llanoDeProducto(producto.nombre));
    const aciertos = suyas.filter((p) => palabrasDelAnuncio.has(p)).length;
    if (aciertos > 0 && (!mejor || aciertos > mejor.aciertos)) mejor = { producto, aciertos };
  }

  return mejor ? { id: mejor.producto.id, nombre: mejor.producto.nombre } : null;
}

export function listarCatalogo(orgId: number, soloActivos = false, canalId?: number): Producto[] {
  const suyos = canalId === undefined ? "" : "AND (canal_id = 0 OR canal_id = ?)";
  return s(
    `SELECT * FROM catalogo WHERE org_id = ? ${soloActivos ? "AND activo = 1" : ""} ${suyos}
      ORDER BY nombre ASC`,
  ).all(...(canalId === undefined ? [orgId] : [orgId, canalId])) as Producto[];
}

/**
 * ¿DE QUÉ NÚMERO ES un producto importado de un link, por el país que ya
 * tiene cada número?
 *
 * Roplis separa sus tiendas por país en el subdominio —`do.roplis.com`,
 * `cr.roplis.com`, `pa.roplis.com`—, el mismo código de dos letras que
 * `agentes.pais` ya usa para decidir el guion y la moneda de cada número
 * (ver `agents/paises`). Es un dato que YA ESTABA, no una adivinanza.
 *
 * Solo contesta cuando hay UN único número de ese país: con ninguno —o con
 * más de uno, cuenta con dos números en el mismo país—, no hay nada que
 * repartir sin arriesgarse a equivocar, y el producto se queda en «toda la
 * cuenta», como siempre.
 */
export function canalPorPaisDeLink(orgId: number, url: string): number | null {
  let codigo: string;
  try {
    codigo = new URL(url).hostname.split(".")[0]?.toLowerCase() ?? "";
  } catch {
    return null;
  }
  if (!codigo) return null;

  /*
   * SOLO LECTURA. `obtenerAgente` crea la fila del agente si no existe —bien
   * para cuando de verdad hace falta el agente completo, mal aquí: esto es un
   * simple «¿este canal es de este país?» que se ejecuta en cada canal de la
   * cuenta. Con `obtenerAgente` de por medio, un canal recién conectado y
   * todavía sin abrir en «Configurar agente» nacía con su fila y su país
   * adivinado por el prefijo del teléfono —efecto secundario de una búsqueda
   * que a él ni le tocaba—, por el solo hecho de que alguien importó un
   * producto por link en OTRO canal de la misma cuenta.
   */
  const paisDelCanal = (canalId: number): string | null => {
    const fila = s(`SELECT pais FROM agentes WHERE org_id = ? AND canal_id = ?`).get(orgId, canalId) as
      | { pais: string }
      | undefined;
    return fila?.pais || null;
  };

  const candidatos = listarCanales(orgId).filter((c) => paisDelCanal(c.id) === codigo);
  return candidatos.length === 1 ? candidatos[0]!.id : null;
}

export function crearProducto(orgId: number, datos: {
  nombre: string; variantes: string | null; precio: number | null;
  /** De qué número es. Sin decir nada, de toda la cuenta. */
  canalId?: number;
  fotoUrl?: string | null;
  descripcion?: string | null;
}): number {
  const r = s(
    `INSERT INTO catalogo (org_id, canal_id, nombre, variantes, precio, foto_url, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    orgId, datos.canalId ?? 0, datos.nombre, datos.variantes, datos.precio,
    datos.fotoUrl ?? null, datos.descripcion ?? null,
  );
  return Number(r.lastInsertRowid);
}

export function actualizarProducto(orgId: number, id: number, campos: Partial<Producto>): void {
  const { sql, valores } = armarSet(campos, ["nombre", "variantes", "precio", "activo", "canal_id", "foto_url", "descripcion"]);
  if (!sql) return;
  s(`UPDATE catalogo SET ${sql} WHERE org_id = ? AND id = ?`).run(...valores, orgId, id);
}

/** Un producto del catálogo por su id, o undefined. Del catálogo de ESTA cuenta. */
export function productoPorId(orgId: number, id: number): Producto | undefined {
  return s(`SELECT * FROM catalogo WHERE org_id = ? AND id = ?`).get(orgId, id) as Producto | undefined;
}

/**
 * Quitar un producto NO puede dejarlo a medias por una restricción de la
 * base de datos.
 *
 * `producto_links.producto_id` y `anuncios_meta.producto_id` apuntan a
 * `catalogo(id)`: con las claves foráneas activas (`PRAGMA foreign_keys`,
 * arriba del todo), borrar un producto que todavía tuviera un link —o un
 * anuncio vinculado— fallaba con «FOREIGN KEY constraint failed» y el botón
 * «Quitar» del panel se quedaba sin efecto, sin decir por qué. Sus links se
 * van con él; sus anuncios se quedan, solo se desvinculan —son el historial
 * de esa publicidad, no algo del producto—.
 */
export function eliminarProducto(orgId: number, id: number): void {
  const tx = db.transaction(() => {
    s(`DELETE FROM producto_links WHERE org_id = ? AND producto_id = ?`).run(orgId, id);
    s(`UPDATE anuncios_meta SET producto_id = NULL WHERE org_id = ? AND producto_id = ?`).run(orgId, id);
    s(`DELETE FROM catalogo WHERE org_id = ? AND id = ?`).run(orgId, id);
  });
  tx();
}

// ─────────────────────────────────────────────────────────────────────────────
// Los links de la tienda de un producto. Ver `importar-producto.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductoLink {
  id: number; org_id: number; producto_id: number;
  url: string;
  /** JSON de `DatosVariantes` (ver importar-producto.ts), o null si aún no se importó. */
  datos: string | null;
  foto_url: string | null;
  descripcion: string | null;
  /** null = pendiente de importar. */
  importado_at: number | null;
  error: string | null;
  creado_at: number;
}

export function listarLinksProducto(orgId: number, productoId: number): ProductoLink[] {
  return s(
    `SELECT * FROM producto_links WHERE org_id = ? AND producto_id = ? ORDER BY creado_at ASC`,
  ).all(orgId, productoId) as ProductoLink[];
}

export function agregarLinkProducto(orgId: number, productoId: number, url: string): number {
  const r = s(
    `INSERT INTO producto_links (org_id, producto_id, url) VALUES (?, ?, ?)`,
  ).run(orgId, productoId, url);
  return Number(r.lastInsertRowid);
}

export function eliminarLinkProducto(orgId: number, id: number): void {
  s(`DELETE FROM producto_links WHERE org_id = ? AND id = ?`).run(orgId, id);
}

/** Lo que dejó la última pasada por ese link: sus datos, su foto, o su error. */
export function marcarLinkImportado(
  orgId: number,
  id: number,
  resultado: { datos: string | null; fotoUrl: string | null; descripcion: string | null; error: string | null },
): void {
  s(
    `UPDATE producto_links SET datos = ?, foto_url = ?, descripcion = ?, error = ?, importado_at = unixepoch() WHERE org_id = ? AND id = ?`,
  ).run(resultado.datos, resultado.fotoUrl, resultado.descripcion, resultado.error, orgId, id);
}

/**
 * Productos con AL MENOS un link pendiente de importar (nunca se importó).
 * Es lo que mira el ingreso de un lead por anuncio para decidir si hace falta
 * ir a Roplis ahora mismo, en segundo plano, sin retrasar la respuesta.
 */
export function productoConLinksPendientes(orgId: number, productoId: number): boolean {
  const fila = s(
    `SELECT 1 FROM producto_links WHERE org_id = ? AND producto_id = ? AND importado_at IS NULL LIMIT 1`,
  ).get(orgId, productoId);
  return !!fila;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomalías
// ─────────────────────────────────────────────────────────────────────────────

export function crearAnomalia(orgId: number, datos: {
  conversationId?: number | null; canalId?: number | null;
  tipo: string; severidad: "alta" | "media"; detalle: string;
}): void {
  const conversationId = datos.conversationId ?? null;
  const canalId = datos.canalId ?? null;
  if (conversationId === null && canalId === null) return;

  // Una anomalía viva del mismo tipo por sujeto; si no, el panel se llena con
  // la misma alerta repetida cada vez que corre el analista.
  const existe = s(
    `SELECT 1 AS x FROM anomalies
      WHERE org_id = ? AND tipo = ? AND resuelta = 0
        AND conversation_id IS ? AND canal_id IS ?
      LIMIT 1`,
  ).get(orgId, datos.tipo, conversationId, canalId) as { x: number } | undefined;
  if (existe) return;

  s(
    `INSERT INTO anomalies (org_id, conversation_id, canal_id, tipo, severidad, detalle)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(orgId, conversationId, canalId, datos.tipo, datos.severidad, datos.detalle);
}

/**
 * `restringirA`: el reparto por miembro. La mayoría de las anomalías se crean
 * con `conversation_id` y sin `canal_id` propio —ver `crearAnomalia`—, así
 * que el canal de una anomalía sale de su conversación cuando ella misma no
 * trae uno: sin este `LEFT JOIN`, filtrar por `canal_id` a secas dejaría a
 * todo miembro restringido sin ver ni una sola anomalía de conversación.
 */
export function listarAnomalias(orgId: number, soloAbiertas = true, restringirA?: number[] | null): Anomalia[] {
  const cond = ["a.org_id = ?"];
  const val: unknown[] = [orgId];
  if (soloAbiertas) cond.push("a.resuelta = 0");
  if (restringirA !== undefined && restringirA !== null) {
    if (restringirA.length === 0) cond.push("0");
    else {
      cond.push(`COALESCE(a.canal_id, c.canal_id) IN (${restringirA.map(() => "?").join(",")})`);
      val.push(...restringirA);
    }
  }
  return s(
    `SELECT a.* FROM anomalies a LEFT JOIN conversations c ON c.id = a.conversation_id
      WHERE ${cond.join(" AND ")}
      ORDER BY a.severidad ASC, a.created_at DESC LIMIT 200`,
  ).all(...val) as Anomalia[];
}

/** ¿Hay una anomalía viva de este tipo en la conversación? */
export function hayAnomaliaAbierta(orgId: number, conversationId: number, tipo: string): boolean {
  const fila = s(
    `SELECT 1 AS x FROM anomalies
      WHERE org_id = ? AND conversation_id = ? AND tipo = ? AND resuelta = 0 LIMIT 1`,
  ).get(orgId, conversationId, tipo) as { x: number } | undefined;
  return !!fila;
}

export function resolverAnomalia(orgId: number, id: number): void {
  s(`UPDATE anomalies SET resuelta = 1 WHERE org_id = ? AND id = ?`).run(orgId, id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumo de modelos
// ─────────────────────────────────────────────────────────────────────────────

export function registrarUso(orgId: number, datos: {
  dia: string; modelo: string; proposito: "agente" | "analisis" | "vision" | "audio"; ok: boolean;
}): void {
  s(
    `INSERT INTO uso_modelo (org_id, dia, modelo, proposito, exitos, fallos)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, dia, modelo, proposito) DO UPDATE SET
       exitos = exitos + excluded.exitos,
       fallos = fallos + excluded.fallos`,
  ).run(orgId, datos.dia, datos.modelo, datos.proposito, datos.ok ? 1 : 0, datos.ok ? 0 : 1);
}

export function usoDelDia(orgId: number, dia: string) {
  return s(
    `SELECT modelo, proposito, exitos, fallos FROM uso_modelo WHERE org_id = ? AND dia = ?`,
  ).all(orgId, dia) as { modelo: string; proposito: string; exitos: number; fallos: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Accesos de soporte — visibles para el dueño de la cuenta
// ─────────────────────────────────────────────────────────────────────────────

export function listarSoporteAccesos(orgId: number): SoporteAcceso[] {
  return s(
    `SELECT * FROM soporte_accesos WHERE org_id = ? ORDER BY solicitado_at DESC LIMIT 50`,
  ).all(orgId) as SoporteAcceso[];
}

export function responderSoporte(orgId: number, id: number, aprobado: boolean, expiraAt: number): void {
  s(
    `UPDATE soporte_accesos
        SET estado = ?, aprobado_at = ?, expira_at = ?
      WHERE org_id = ? AND id = ? AND estado = 'solicitado'`,
  ).run(
    aprobado ? "aprobado" : "rechazado",
    aprobado ? ahora() : null,
    aprobado ? expiraAt : null,
    orgId, id,
  );
}

export function soporteVigente(orgId: number, adminUserId: number): SoporteAcceso | undefined {
  return s(
    `SELECT * FROM soporte_accesos
      WHERE org_id = ? AND admin_user_id = ? AND estado = 'aprobado' AND expira_at > unixepoch()
      ORDER BY id DESC LIMIT 1`,
  ).get(orgId, adminUserId) as SoporteAcceso | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas de métricas
//
// Devuelven filas crudas; `metrics.ts` deriva porcentajes y normaliza nombres.
// Viven aquí para que el SQL no se disperse y la migración a Postgres siga
// siendo el reemplazo de un solo módulo.
// ─────────────────────────────────────────────────────────────────────────────

export interface Rango {
  desde: number;
  hasta: number;
  canalId?: number;
  /**
   * EL REPARTO POR MIEMBRO: solo estos canales entran en la cuenta, o
   * ninguna condición si no viene puesto —ver `canalesDeMiembro`, que es de
   * donde sale esta lista—. Va aparte de `canalId`, que es el filtro manual
   * de una pantalla —«mira solo este número»—: los dos pueden venir juntos.
   * Con una lista vacía de verdad, no cuenta nada: fallar cerrado y no abierto.
   */
  canalIds?: number[];
  /**
   * Deja fuera a quien escribió por su cuenta: el panel entero pasa a hablar
   * solo de la gente que trajo un anuncio.
   *
   * Va en el rango y no en cada consulta porque tiene que aplicarse a TODAS a
   * la vez. Si el filtro alcanzara a los leads pero no a los cierres, la tasa
   * dividiría cierres de todo el mundo entre leads de anuncio y pasaría del
   * 100 %; y la invariante `leads = ia + humano + abiertas + revisión`, que se
   * comprueba en pantalla, dejaría de cuadrar sin que nada estuviera roto.
   */
  soloAnuncio?: boolean;
  /**
   * La clave con la que se calculó el periodo («hoy», «7d»…), si vino de una.
   * Con ella, cada número vuelve a contar el mismo periodo EN LA HORA DE SU
   * PAÍS: «hoy» en Santo Domingo no empieza a la misma hora que en San José.
   */
  clave?: string;
  /** El huso de la cuenta, para agrupar por día y para los números sin país. */
  huso?: string;
}

/**
 * QUIÉN LLEGÓ en el periodo: la conversación se cuenta el día que empezó.
 * De aquí salen los leads, los abiertos y los que están en revisión.
 */
function filtroRango(orgId: number, r: Rango) {
  const cond = ["org_id = ?", "fecha_inicio >= ?", "fecha_inicio <= ?"];
  const val: unknown[] = [orgId, r.desde, r.hasta];
  if (r.canalId !== undefined) { cond.push("canal_id = ?"); val.push(r.canalId); }
  if (r.canalIds !== undefined) {
    if (r.canalIds.length === 0) cond.push("0");
    else { cond.push(`canal_id IN (${r.canalIds.map(() => "?").join(",")})`); val.push(...r.canalIds); }
  }
  if (r.soloAnuncio) cond.push(DE_ANUNCIO);
  return { where: cond.join(" AND "), val };
}

/**
 * QUÉ SE VENDIÓ en el periodo: la venta se cuenta el día que se CERRÓ.
 *
 * Es la diferencia entre «hoy escribieron dos» y «hoy se cerraron cuatro». Con
 * las ventas contadas por el día en que el cliente escribió, una venta cerrada
 * hoy con un cliente que llegó el martes se apuntaba al martes, y el dueño,
 * que había visto cerrarse cuatro pedidos, encontraba dos en el panel. De aquí
 * salen los cierres, lo facturado y la serie de cierres por día.
 */
function filtroCierres(orgId: number, r: Rango) {
  const cond = ["org_id = ?", "cerrado_por IN ('ia','humano')", "fecha_cierre >= ?", "fecha_cierre <= ?"];
  const val: unknown[] = [orgId, r.desde, r.hasta];
  if (r.canalId !== undefined) { cond.push("canal_id = ?"); val.push(r.canalId); }
  if (r.canalIds !== undefined) {
    if (r.canalIds.length === 0) cond.push("0");
    else { cond.push(`canal_id IN (${r.canalIds.map(() => "?").join(",")})`); val.push(...r.canalIds); }
  }
  if (r.soloAnuncio) cond.push(DE_ANUNCIO);
  return { where: cond.join(" AND "), val };
}

/**
 * EN QUÉ HORA VIVE LA CUENTA: el huso del país en el que venden sus números.
 *
 * Con números en varios países manda el más repetido, y cada número vuelve a
 * contar su periodo en su propia hora en `metricasPorCanal`. Sin ningún país
 * conocido, la hora del servidor, que es lo que había.
 *
 * El país sale del agente del canal y, si el agente todavía no existe, del
 * prefijo del número: es el mismo dato del que sale el país del agente.
 */
export function husoDeLaCuenta(orgId: number): string {
  const filas = s(
    `SELECT ca.phone, COALESCE(a.pais, '') AS pais
       FROM canales ca
       LEFT JOIN agentes a ON a.org_id = ca.org_id AND a.canal_id = ca.id
      WHERE ca.org_id = ?`,
  ).all(orgId) as { phone: string; pais: string }[];

  const votos = new Map<string, number>();
  for (const f of filas) {
    const huso = husoDelCanal(f);
    if (huso) votos.set(huso, (votos.get(huso) ?? 0) + 1);
  }
  let elegido = "";
  let mayor = 0;
  for (const [huso, n] of votos) {
    if (n > mayor) { elegido = huso; mayor = n; }
  }
  return elegido || husoDelServidor();
}

/** El huso del país de un número, o null si no se sabe dónde vende. */
function husoDelCanal(canal: { phone: string; pais: string }): string | null {
  const codigo = canal.pais || paisDeTelefono(canal.phone)?.codigo || "";
  return obtenerPais(codigo)?.husoHorario ?? null;
}

/**
 * La hora de cada número, para escribir la fecha y la hora de sus mensajes y
 * sus ventas como se leen allá. El servidor corre en UTC: sin esto, una venta
 * de las nueve de la noche en Santo Domingo salía con la fecha de mañana.
 */
export function husosDeLosCanales(orgId: number): Map<number, string> {
  const filas = s(
    `SELECT ca.id AS canal_id, ca.phone, COALESCE(a.pais, '') AS pais
       FROM canales ca
       LEFT JOIN agentes a ON a.org_id = ca.org_id AND a.canal_id = ca.id
      WHERE ca.org_id = ?`,
  ).all(orgId) as { canal_id: number; phone: string; pais: string }[];
  const deLaCuenta = husoDeLaCuenta(orgId);
  return new Map(filas.map((f) => [f.canal_id, husoDelCanal(f) ?? deLaCuenta]));
}

/** Conteo por estado. La suma de estos cuatro DEBE ser el total de leads. */
export function conteoPorEstado(orgId: number, r: Rango): Record<EstadoCierre, number> {
  const { where, val } = filtroRango(orgId, r);
  const filas = s(
    `SELECT cerrado_por, COUNT(*) AS n FROM conversations WHERE ${where} GROUP BY cerrado_por`,
  ).all(...val) as { cerrado_por: EstadoCierre; n: number }[];

  const base: Record<EstadoCierre, number> = { ia: 0, humano: 0, abierta: 0, revision: 0 };
  for (const f of filas) base[f.cerrado_por] = f.n;
  return base;
}

export function totalLeads(orgId: number, r: Rango): number {
  const { where, val } = filtroRango(orgId, r);
  return (s(`SELECT COUNT(*) AS n FROM conversations WHERE ${where}`).get(...val) as { n: number }).n;
}

/**
 * LO FACTURADO — el dinero del pedido, sin el envío.
 *
 * `total` es lo que el cliente paga en total y `envio` es la parte de ese total
 * que es transporte. El envío entra y sale: se le cobra al cliente y se le paga
 * al mensajero, así que sumarlo a la facturación infla el número justo en el
 * dinero que el negocio no se queda. Lo que se factura es el pedido.
 *
 * El `MAX(..., 0)` es una defensa, no un adorno. Los montos los extrae un
 * modelo de un chat escrito a mano, y de vez en cuando apunta un envío mayor
 * que el total —porque el cliente escribió el precio sin el envío, o porque el
 * modelo se equivocó—. Sin el tope, esa fila restaría de las demás y una venta
 * mal leída bajaría la facturación del mes.
 */
export const facturado = (p = "") =>
  `MAX(COALESCE(${p}total, 0) - COALESCE(${p}envio, 0), 0)`;

const FACTURADO = facturado();

export function resumenVentas(orgId: number, r: Rango) {
  const { where, val } = filtroCierres(orgId, r);
  return s(
    `SELECT COALESCE(SUM(${FACTURADO}), 0) AS facturado,
            COALESCE(SUM(CASE WHEN cerrado_por = 'ia'     THEN ${FACTURADO} END), 0) AS facturado_ia,
            COALESCE(SUM(CASE WHEN cerrado_por = 'humano' THEN ${FACTURADO} END), 0) AS facturado_humano,
            COALESCE(SUM(envio), 0) AS envios,
            COUNT(total) AS con_monto
       FROM conversations
      WHERE ${where}`,
  ).get(...val) as {
    facturado: number; facturado_ia: number; facturado_humano: number;
    envios: number; con_monto: number;
  };
}

/**
 * Llegó por un anuncio.
 *
 * Se pregunta por el ORIGEN, no por el título. Meta no siempre manda `title` en
 * el anuncio —hay creatividades sin titular—, y con la condición puesta sobre
 * `producto_anuncio` ese cliente se contaba como si hubiera escrito por su
 * cuenta: el anuncio lo trajo y la cifra de publicidad no lo veía.
 *
 * El título se deja como segunda vía a propósito: las conversaciones guardadas
 * antes de que existiera la columna `origen`, o por cualquier otra entrada que
 * solo apunte el producto, siguen contando como lo que son. Las dos ramas se
 * niegan enteras en `leadsPorSuCuenta`, así que los dos grupos siguen sumando
 * exactamente el total.
 */
/*
 * `COALESCE` y no `origen = 'anuncio'` a secas: en SQL una comparación contra
 * NULL da NULL, no falso, y `NOT (NULL OR falso)` vuelve a ser NULL — la fila
 * no entraría ni en un grupo ni en el otro y los dos dejarían de sumar el
 * total, que es justo lo que comprueba la prueba de conteo.
 */
/* Gemela de `llegoPorAnuncio` en `anuncio.ts`: las dos deciden lo mismo, una
 * para contar en SQL y otra para pintar en pantalla. Cambiar una sola de ellas
 * deja el panel enseñando pastillas de anuncio que el conteo no ve. */
export const deAnuncio = (p = "") =>
  `(COALESCE(${p}origen, '') = 'anuncio' OR COALESCE(${p}producto_anuncio, '') <> '')`;

/** El prefijo es para las consultas que aliasan la tabla, como la de canales. */
const DE_ANUNCIO = deAnuncio();

/**
 * Cuántos trajo la publicidad y cuántos de ellos se cerraron.
 *
 * NO sustituye a `totalLeads`, que cuenta toda conversación abierta y es la que
 * sostiene la invariante `leads = ia + humano + abiertas + revisión`. Son dos
 * preguntas distintas: cuánta gente escribió, y cuánta escribió porque la
 * trajo un anuncio. La segunda es la que dice si la publicidad funciona.
 *
 * Los cierres vienen de aquí y no de `conteoPorEstado` porque la tasa que se
 * enseña bajo «Leads por anuncio» tiene que dividir cierres DE ESOS leads entre
 * ESOS leads. Mezclar el numerador de todos con este denominador da porcentajes
 * por encima de 100.
 */
export function resumenDeAnuncio(
  orgId: number,
  r: Rango,
): { leads: number; cerrados: number; cierres_ia: number; cierres_humano: number } {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT COUNT(*) AS leads,
            SUM(CASE WHEN cerrado_por IN ('ia','humano') THEN 1 ELSE 0 END) AS cerrados,
            SUM(CASE WHEN cerrado_por = 'ia'     THEN 1 ELSE 0 END) AS cierres_ia,
            SUM(CASE WHEN cerrado_por = 'humano' THEN 1 ELSE 0 END) AS cierres_humano
       FROM conversations
      WHERE ${where} AND ${DE_ANUNCIO}`,
  ).get(...val) as { leads: number; cerrados: number; cierres_ia: number; cierres_humano: number };
}

/**
 * Qué producto anunciado trae a cada cliente, con lo que el anuncio prometía.
 *
 * Se agrupa por el título y, cuando el anuncio no trae título, por su texto:
 * sin eso todas las creatividades sin titular caerían en la misma fila y el
 * panel diría que un solo «anuncio» trae la mitad de los clientes. `producto`
 * sale nulo en ese caso y lo nombra `metrics.ts`, que es quien decide qué se
 * lee en pantalla.
 *
 * La descripción se toma con MAX y no con GROUP_CONCAT: varios anuncios pueden
 * compartir título con textos distintos, y aquí interesa una muestra legible,
 * no todas concatenadas.
 */
export function productosDeAnuncio(
  orgId: number,
  r: Rango,
): { producto: string | null; descripcion: string | null; leads: number; cerrados: number }[] {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT MAX(NULLIF(producto_anuncio, '')) AS producto,
            MAX(NULLIF(descripcion_anuncio, '')) AS descripcion,
            COUNT(*) AS leads,
            SUM(CASE WHEN cerrado_por IN ('ia','humano') THEN 1 ELSE 0 END) AS cerrados
       FROM conversations
      WHERE ${where} AND ${DE_ANUNCIO}
      GROUP BY COALESCE(NULLIF(producto_anuncio, ''), NULLIF(descripcion_anuncio, ''), '')
      ORDER BY leads DESC, producto ASC
      LIMIT 12`,
  ).all(...val) as { producto: string | null; descripcion: string | null; leads: number; cerrados: number }[];
}

export function leadsPorSuCuenta(orgId: number, r: Rango): number {
  const { where, val } = filtroRango(orgId, r);
  return (s(
    `SELECT COUNT(*) AS n FROM conversations
      WHERE ${where} AND NOT ${DE_ANUNCIO}`,
  ).get(...val) as { n: number }).n;
}

/** Conversaciones donde un vendedor llegó a escribir. Denominador de la efectividad humana. */
export function conteoConIntervencionHumana(orgId: number, r: Rango): number {
  const { where, val } = filtroRango(orgId, r);
  return (s(
    `SELECT COUNT(*) AS n FROM conversations WHERE ${where} AND intervencion_humana = 1`,
  ).get(...val) as { n: number }).n;
}

/**
 * De los hilos que tocó un vendedor, cuántos acabaron en VENTA. Da igual quién
 * los cerrara.
 *
 * Es el numerador de la efectividad asistida, y tiene que ser este. El
 * denominador son los hilos donde una persona llegó a escribir; contar solo los
 * `cerrado_por = 'humano'` dejaba fuera al vendedor que desatasca la venta y
 * deja que el resumen la cierre —que es el caso normal y el trabajo bien
 * hecho—, así que la métrica medía la proporción de ventas cerradas con una
 * foto de factura y la enseñaba como si midiera al equipo.
 */
export function cierresConIntervencionHumana(orgId: number, r: Rango): number {
  const { where, val } = filtroRango(orgId, r);
  return (s(
    `SELECT COUNT(*) AS n FROM conversations
      WHERE ${where} AND intervencion_humana = 1 AND cerrado_por IN ('ia','humano')`,
  ).get(...val) as { n: number }).n;
}

/** Tiempo medio hasta el cierre, en segundos. Excluye conversaciones abiertas. */
export function tiemposDeCierre(orgId: number, r: Rango) {
  const { where, val } = filtroCierres(orgId, r);
  return s(
    `SELECT
       AVG(CASE WHEN cerrado_por = 'ia'     THEN fecha_cierre - fecha_inicio END) AS ia,
       AVG(CASE WHEN cerrado_por = 'humano' THEN fecha_cierre - fecha_inicio END) AS humano
     FROM conversations
     WHERE ${where}`,
  ).get(...val) as { ia: number | null; humano: number | null };
}

/**
 * Producto y monto de cada venta cerrada. La normalización va en metrics.ts.
 *
 * El monto es lo FACTURADO, sin el envío: el ranking dice qué producto trae el
 * dinero, y un producto no vende más por mandarse más lejos.
 */
export function ventasParaRanking(orgId: number, r: Rango) {
  const { where, val } = filtroCierres(orgId, r);
  return s(
    `SELECT producto_vendido, ${FACTURADO} AS facturado FROM conversations
      WHERE ${where} AND producto_vendido IS NOT NULL`,
  ).all(...val) as { producto_vendido: string; facturado: number }[];
}

/**
 * EL PANEL DE CADA NÚMERO, contado en la hora de su país.
 *
 * Dos cuentas distintas por número: quién LLEGÓ en el periodo —por el día en
 * que escribió— y qué se VENDIÓ en el periodo —por el día en que se cerró—.
 * Los leads, los abiertos y la revisión salen de la primera; los cierres y el
 * dinero, de la segunda. Por eso una fila puede cerrar más ventas de las
 * conversaciones que le llegaron hoy: cerró pedidos de gente que escribió ayer.
 *
 * Y el periodo se vuelve a calcular en el huso del país del número cuando
 * vino de una clave («hoy», «7d»…): a las diez de la noche en Santo Domingo
 * sigue siendo hoy, aunque en el servidor ya sea mañana. Con fechas exactas
 * del calendario se respetan tal cual.
 *
 * Con `canalId` en el rango, solo sale ese número.
 */
export function metricasPorCanal(orgId: number, r: Rango) {
  const canales = s(
    `SELECT ca.id AS canal_id, ca.nombre, ca.phone, COALESCE(a.pais, '') AS pais,
            ca.tipo, ca.agente_activo, ca.contesta_ia, ca.estado
       FROM canales ca
       LEFT JOIN agentes a ON a.org_id = ca.org_id AND a.canal_id = ca.id
      WHERE ca.org_id = ?
      ORDER BY ca.created_at ASC`,
  ).all(orgId) as {
    canal_id: number; nombre: string; phone: string; pais: string;
    tipo: string; agente_activo: number; contesta_ia: number; estado: string;
  }[];

  const filas = canales
    .filter((ca) => r.canalId === undefined || ca.canal_id === r.canalId)
    .filter((ca) => r.canalIds === undefined || r.canalIds.includes(ca.canal_id))
    .map((ca) => {
      const pais = ca.pais || paisDeTelefono(ca.phone)?.codigo || "";
      const { huso, periodo } = periodoDelCanal(ca, r);
      const propio: Rango = { ...r, desde: periodo.desde, hasta: periodo.hasta, canalId: ca.canal_id };

      const cohorte = filtroRango(orgId, propio);
      const llegaron = s(
        `SELECT COUNT(*) AS leads,
                COALESCE(SUM(CASE WHEN ${DE_ANUNCIO} THEN 1 ELSE 0 END), 0) AS leads_anuncio,
                COALESCE(SUM(CASE WHEN cerrado_por = 'abierta'  THEN 1 ELSE 0 END), 0) AS sin_cerrar,
                COALESCE(SUM(CASE WHEN cerrado_por = 'revision' THEN 1 ELSE 0 END), 0) AS revision
           FROM conversations
          WHERE ${cohorte.where}`,
      ).get(...cohorte.val) as { leads: number; leads_anuncio: number; sin_cerrar: number; revision: number };

      const cierres = filtroCierres(orgId, propio);
      const vendieron = s(
        `SELECT COALESCE(SUM(CASE WHEN cerrado_por = 'ia'     THEN 1 ELSE 0 END), 0) AS cierres_ia,
                COALESCE(SUM(CASE WHEN cerrado_por = 'humano' THEN 1 ELSE 0 END), 0) AS cierres_humano,
                COALESCE(SUM(${FACTURADO}), 0) AS ventas,
                COALESCE(SUM(CASE WHEN cerrado_por = 'ia'     THEN ${FACTURADO} END), 0) AS ventas_ia,
                COALESCE(SUM(CASE WHEN cerrado_por = 'humano' THEN ${FACTURADO} END), 0) AS ventas_humano,
                COALESCE(SUM(envio), 0) AS envios,
                COUNT(total) AS con_monto
           FROM conversations
          WHERE ${cierres.where}`,
      ).get(...cierres.val) as {
        cierres_ia: number; cierres_humano: number; ventas: number;
        ventas_ia: number; ventas_humano: number; envios: number; con_monto: number;
      };

      /*
       * LAS FACTURAS ENVIADAS EN EL PERIODO, aparte de las ventas: la factura
       * de hoy puede ser de una venta que se cerró ayer, y esa venta cuenta
       * ayer. Por eso van en su propia cifra, con las de ventas de días
       * anteriores contadas aparte para decirlo en pantalla.
       */
      const facturas = s(
        `SELECT COUNT(*) AS facturas,
                COALESCE(SUM(CASE WHEN fecha_cierre < ? THEN 1 ELSE 0 END), 0) AS facturas_de_antes
           FROM conversations
          WHERE org_id = ? AND canal_id = ? AND cerrado_por IN ('ia','humano')
            AND facturada_at >= ? AND facturada_at <= ?${propio.soloAnuncio ? ` AND ${DE_ANUNCIO}` : ""}`,
      ).get(periodo.desde, orgId, ca.canal_id, periodo.desde, periodo.hasta) as { facturas: number; facturas_de_antes: number };

      return {
        canal_id: ca.canal_id,
        nombre: ca.nombre,
        phone: ca.phone,
        pais,
        tipo: ca.tipo,
        agente_activo: ca.agente_activo,
        contesta_ia: ca.contesta_ia,
        estado: ca.estado,
        huso,
        desde: periodo.desde,
        hasta: periodo.hasta,
        ...llegaron,
        ...vendieron,
        ...facturas,
      };
    });

  // Los que más traen arriba; el id desempata para que dos en cero no bailen.
  return filas.sort((a, b) => b.leads - a.leads || a.canal_id - b.canal_id);
}

/** El periodo de un número en la hora de su país. Ver `metricasPorCanal`. */
function periodoDelCanal(ca: { phone: string; pais: string }, r: Rango) {
  const huso = husoDelCanal(ca) ?? r.huso ?? husoDelServidor();
  return { huso, periodo: periodoEnHuso(r, huso) };
}

/**
 * LAS VENTAS DEL PERIODO, UNA A UNA: exactamente las que cuentan los KPIs.
 *
 * Gemela de los cierres de `metricasPorCanal`: cada venta entra por el día en
 * que se CERRÓ y en la hora del país de su número. Listarlas por el día en que
 * el cliente escribió —como hace `listarConversaciones`— daba otra lista: con
 * un día elegido, la tarjeta decía «Automatizada 4» y la tabla enseñaba las
 * ventas de los clientes que llegaron ese día, que no son esas cuatro.
 *
 * Con `cerradoPor`, solo las automatizadas o solo las asistidas.
 */
export function listarVentas(
  orgId: number,
  r: Rango,
  filtros: { cerradoPor?: "ia" | "humano"; limite?: number } = {},
): Conversacion[] {
  const canales = s(
    `SELECT ca.id AS canal_id, ca.phone, COALESCE(a.pais, '') AS pais
       FROM canales ca
       LEFT JOIN agentes a ON a.org_id = ca.org_id AND a.canal_id = ca.id
      WHERE ca.org_id = ?`,
  ).all(orgId) as { canal_id: number; phone: string; pais: string }[];

  const tramos = canales
    .filter((ca) => r.canalId === undefined || ca.canal_id === r.canalId)
    .filter((ca) => r.canalIds === undefined || r.canalIds.includes(ca.canal_id))
    .map((ca) => ({ canal_id: ca.canal_id, ...periodoDelCanal(ca, r).periodo }));
  if (tramos.length === 0) return [];

  const cond = [
    "org_id = ?",
    filtros.cerradoPor ? "cerrado_por = ?" : "cerrado_por IN ('ia','humano')",
    `(${tramos.map(() => "(canal_id = ? AND fecha_cierre >= ? AND fecha_cierre <= ?)").join(" OR ")})`,
  ];
  const val: unknown[] = [orgId];
  if (filtros.cerradoPor) val.push(filtros.cerradoPor);
  for (const t of tramos) val.push(t.canal_id, t.desde, t.hasta);
  if (r.soloAnuncio) cond.push(DE_ANUNCIO);

  return s(
    `SELECT * FROM conversations WHERE ${cond.join(" AND ")}
      ORDER BY fecha_cierre DESC, id DESC
      LIMIT ?`,
  ).all(...val, filtros.limite ?? 500) as Conversacion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Canales de Meta: páginas, anuncios y eventos
// ─────────────────────────────────────────────────────────────────────────────

/** Las páginas conectadas de una cuenta. Un canal de Meta ES una página. */
/** `restringirA`: el mismo significado que en `listarCanales`. */
export function listarPaginasMeta(orgId: number, restringirA?: number[] | null): Canal[] {
  if (restringirA === undefined || restringirA === null) {
    return s(
      `SELECT * FROM canales WHERE org_id = ? AND tipo = 'meta' ORDER BY created_at ASC`,
    ).all(orgId) as Canal[];
  }
  if (restringirA.length === 0) return [];
  const marcas = restringirA.map(() => "?").join(",");
  return s(
    `SELECT * FROM canales WHERE org_id = ? AND tipo = 'meta' AND id IN (${marcas}) ORDER BY created_at ASC`,
  ).all(orgId, ...restringirA) as Canal[];
}

export function contarPaginasMeta(orgId: number): number {
  return (
    s(`SELECT COUNT(*) AS n FROM canales WHERE org_id = ? AND tipo = 'meta'`).get(orgId) as {
      n: number;
    }
  ).n;
}

export function crearPaginaMeta(orgId: number, datos: {
  pageId: string; nombre: string; tokenCifrado: string; webhookSecret: string;
  igUserId: string | null;
}): number {
  /*
   * `negocio` sale del mismo sitio que el nombre del canal: así se llama la
   * PÁGINA que publica los anuncios, y es el nombre que el cliente vio antes de
   * escribir. Con él saluda el agente. Ver `armarSistema`.
   */
  const r = s(
    `INSERT INTO canales
       (org_id, nombre, negocio, phone, token_cifrado, webhook_secret, tipo, meta_ig_id, estado, contesta_ia)
     VALUES (?, ?, ?, ?, ?, ?, 'meta', ?, 'conectado', 1)`,
  ).run(
    orgId, datos.nombre, datos.nombre, datos.pageId,
    datos.tokenCifrado, datos.webhookSecret, datos.igUserId,
  );
  return Number(r.lastInsertRowid);
}

/**
 * EXCEPCIÓN a la regla de aislamiento, y la misma que ya tiene
 * `canalPorWebhook`: el webhook no trae sesión ni org_id. La cuenta se DEDUCE
 * de la página, que es lo único que manda Meta, y a partir de ahí todo vuelve a
 * ir con `org_id`. Sin esta función no hay forma de saber de quién es un evento.
 *
 * Busca por ID de página y también por cuenta de Instagram: los mensajes
 * directos de Instagram llegan con el ID de la cuenta de IG, no con el de la
 * página, aunque los mande el mismo webhook y sean el mismo canal.
 */
/**
 * ¿HAY ALGUNA CUENTA DE INSTAGRAM CONECTADA EN LA PLATAFORMA?
 *
 * De ello depende si la app de Meta tiene que suscribirse también al objeto
 * `instagram`: sin esa suscripción no llega ni un mensaje directo de Instagram
 * —tampoco los de un anuncio— y la IA no tiene nada que contestar. No lleva
 * `orgId` porque la app de Meta es una sola para toda la plataforma; solo lo
 * pregunta el diagnóstico de superadmin. Ver `revisarSuscripcionApp`.
 */
export function hayInstagramConectado(): boolean {
  return !!s(
    `SELECT 1 AS x FROM canales
      WHERE tipo = 'meta' AND activo = 1 AND meta_ig_id IS NOT NULL AND meta_ig_id <> ''
      LIMIT 1`,
  ).get();
}

export function canalMetaPorDestino(destinoId: string): Canal | undefined {
  return s(
    `SELECT * FROM canales
      WHERE tipo = 'meta' AND activo = 1 AND (phone = ? OR meta_ig_id = ?)
      LIMIT 1`,
  ).get(destinoId, destinoId) as Canal | undefined;
}

// ── Anuncios vinculados a un producto ───────────────────────────────────────

export interface AnuncioMeta {
  id: number; org_id: number; ad_id: string;
  producto_id: number | null; titulo: string | null; created_at: number;
  /** El texto del anuncio y lo que se ve en su imagen. Ver el esquema. */
  texto: string | null; imagen: string | null; descripcion_imagen: string | null;
  /** La publicación detrás del anuncio y su enlace público. Ver el esquema. */
  post_id: string | null; enlace: string | null;
  /** La foto del anuncio ya subida a Meta, lista para reenviar. */
  attachment_id: string | null;
  /** 1 cuando ya se buscó la foto en grande, se encontrara o no. */
  imagen_hd: number;
}

export function listarAnunciosMeta(orgId: number) {
  return s(
    `SELECT a.*, c.nombre AS producto_nombre, c.precio AS producto_precio,
            c.variantes AS producto_variantes
       FROM anuncios_meta a
       LEFT JOIN catalogo c ON c.id = a.producto_id AND c.org_id = a.org_id
      WHERE a.org_id = ?
      ORDER BY a.created_at DESC`,
  ).all(orgId) as (AnuncioMeta & {
    producto_nombre: string | null; producto_precio: number | null;
    producto_variantes: string | null;
  })[];
}

/**
 * El anuncio con su producto, o undefined.
 *
 * Devolver undefined es una respuesta válida y significativa: es el caso «este
 * anuncio no está vinculado», y de él depende que el agente no cotice.
 */
export function anuncioMetaPorAdId(orgId: number, adId: string) {
  return s(
    `SELECT a.*, c.nombre AS producto_nombre, c.precio AS producto_precio,
            c.variantes AS producto_variantes, c.activo AS producto_activo
       FROM anuncios_meta a
       LEFT JOIN catalogo c ON c.id = a.producto_id AND c.org_id = a.org_id
      WHERE a.org_id = ? AND a.ad_id = ?`,
  ).get(orgId, adId) as
    | (AnuncioMeta & {
        producto_nombre: string | null; producto_precio: number | null;
        producto_variantes: string | null; producto_activo: number | null;
      })
    | undefined;
}

/**
 * Deja constancia del anuncio en cuanto se ve, aunque nadie lo haya vinculado.
 *
 * El `ad_id` llega en el referral del primer mensaje y solo ahí. Si no se guarda
 * en ese momento, el dueño no tiene forma de vincularlo: tendría que adivinar
 * el identificador de un anuncio que ya pasó. Guardarlo sin producto es
 * exactamente lo que llena la lista de «anuncios por vincular».
 */
export function registrarAnuncioVisto(
  orgId: number,
  adId: string,
  titulo: string | null,
  /**
   * El texto, la imagen y la publicación del anuncio, cuando el mensaje los
   * trae. `postId` es lo que permite pedirle a Meta el resto más tarde.
   */
  extra: { texto?: string | null; imagen?: string | null; postId?: string | null } = {},
): void {
  s(
    `INSERT INTO anuncios_meta (org_id, ad_id, titulo, texto, imagen, post_id)
          VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, ad_id) DO UPDATE SET
       titulo  = COALESCE(anuncios_meta.titulo,  excluded.titulo),
       texto   = COALESCE(anuncios_meta.texto,   excluded.texto),
       imagen  = COALESCE(anuncios_meta.imagen,  excluded.imagen),
       post_id = COALESCE(anuncios_meta.post_id, excluded.post_id)`,
  ).run(orgId, adId, titulo, extra.texto ?? null, extra.imagen ?? null, extra.postId ?? null);
}

/**
 * Lo que la Graph API contó de la publicación que hay detrás del anuncio.
 *
 * Se guarda aparte de `registrarAnuncioVisto` porque llega en otro momento: el
 * referral trae el `post_id` en el acto y el texto hay que ir a buscarlo.
 */
export function guardarPublicacionAnuncio(
  orgId: number,
  adId: string,
  datos: { texto: string | null; enlace: string | null },
): void {
  s(
    `UPDATE anuncios_meta
        SET texto  = COALESCE(texto, ?),
            enlace = COALESCE(enlace, ?)
      WHERE org_id = ? AND ad_id = ?`,
  ).run(datos.texto, datos.enlace, orgId, adId);
}

/**
 * Anuncios de los que sabemos la publicación pero todavía no su texto.
 *
 * `enlace IS NULL` y no `texto IS NULL` como condición de pendiente: hay
 * publicaciones que de verdad no llevan texto —una foto y nada más—, y con
 * `texto` como guarda esas se pedirían otra vez con cada cliente que traiga el
 * anuncio. El enlace SIEMPRE viene, así que sirve de marca de «ya preguntamos».
 */
export function anunciosPorCompletar(orgId: number, limite = 3) {
  return s(
    `SELECT ad_id, post_id FROM anuncios_meta
      WHERE org_id = ? AND post_id IS NOT NULL AND (enlace IS NULL OR imagen_hd = 0)
      ORDER BY created_at DESC LIMIT ?`,
  ).all(orgId, limite) as { ad_id: string; post_id: string }[];
}

/**
 * LA IMAGEN DEL ANUNCIO, EN GRANDE, SUSTITUYENDO A LA MINIATURA.
 *
 * Aquí SÍ se pisa lo que había —al revés que en `registrarAnuncioVisto`, que
 * nunca sobrescribe—, porque lo que había es peor: la vista previa del referral,
 * que al cliente le llega borrosa. Y se borra el `attachment_id`, que es la
 * copia que Meta ya tiene de la miniatura: sin eso se seguiría mandando la
 * antigua para siempre, que es justo lo que se quería arreglar.
 *
 * `imagen_hd` se marca aunque no se consiga ninguna: es la diferencia entre
 * «no lo hemos intentado» y «no la hay», y sin esa marca cada mensaje que
 * entrara volvería a pedírsela a Meta.
 */
export function guardarImagenGrandeAnuncio(orgId: number, adId: string, imagen: string | null): void {
  if (imagen) {
    s(`UPDATE anuncios_meta SET imagen = ?, attachment_id = NULL, imagen_hd = 1 WHERE org_id = ? AND ad_id = ?`)
      .run(imagen, orgId, adId);
    return;
  }
  s(`UPDATE anuncios_meta SET imagen_hd = 1 WHERE org_id = ? AND ad_id = ?`).run(orgId, adId);
}

/**
 * Lo que se ve en la imagen del anuncio, escrito por el modelo de visión.
 *
 * Se guarda en el anuncio y no en la conversación a propósito: un anuncio trae
 * decenas de clientes y la imagen es la misma para todos. Describirla una vez
 * y reutilizarla es la diferencia entre una llamada al modelo y cien.
 */
export function guardarDescripcionAnuncio(orgId: number, adId: string, descripcion: string): void {
  s(`UPDATE anuncios_meta SET descripcion_imagen = ? WHERE org_id = ? AND ad_id = ?`)
    .run(descripcion, orgId, adId);
}

/** Anuncios con imagen guardada y sin describir todavía. */
export function anunciosPorDescribir(orgId: number, limite = 5) {
  return s(
    `SELECT ad_id, imagen, titulo, texto FROM anuncios_meta
      WHERE org_id = ? AND imagen IS NOT NULL AND descripcion_imagen IS NULL
      ORDER BY created_at DESC LIMIT ?`,
  ).all(orgId, limite) as { ad_id: string; imagen: string; titulo: string | null; texto: string | null }[];
}

/**
 * ANUNCIOS DESCRITOS CON LA ETIQUETA DE LA CAMPAÑA EN VEZ DE CON LO QUE SE VE.
 *
 * La captura de la dueña (Costa Rica, 2026-09-23): un anuncio titulado
 * «Anuncio en estados» —así organizó ella la campaña en Meta, no es un
 * nombre de producto— quedó descrito «Anuncio en estados. Solo se ve en
 * negro...»: antes de este arreglo, la visión repetía obligatoriamente el
 * título de la tienda, y esa vez el título no nombraba ningún producto.
 * `promptAnuncio` (analyzer.ts) ya no fuerza esa repetición, pero los
 * anuncios que ya se describieron así se quedan con la descripción vieja
 * para siempre: `anunciosPorDescribir` solo mira los que están en NULL. Esto
 * los encuentra por la forma —la descripción empieza igual que su propio
 * título— para que `analyzer.ts` decida, con `nombraUnArticulo`, si de
 * verdad hace falta reencolarlos.
 */
export function anunciosConDescripcionSospechosa(orgId: number, limite = 20) {
  return s(
    `SELECT ad_id, titulo, descripcion_imagen FROM anuncios_meta
      WHERE org_id = ? AND titulo IS NOT NULL AND descripcion_imagen IS NOT NULL
        AND descripcion_imagen LIKE (titulo || '.%')
      LIMIT ?`,
  ).all(orgId, limite) as { ad_id: string; titulo: string; descripcion_imagen: string }[];
}

/** Vuelve a poner un anuncio en la cola: `describirAnunciosPendientes` lo recoge en la próxima vuelta. */
export function reencolarDescripcionAnuncio(orgId: number, adId: string): void {
  s(`UPDATE anuncios_meta SET descripcion_imagen = NULL WHERE org_id = ? AND ad_id = ?`).run(orgId, adId);
}

/**
 * LA FOTO DEL ANUNCIO POR EL QUE ESCRIBIÓ ESTE CLIENTE.
 *
 * Es la que se le manda cuando pide «una foto», y tiene que ser ESA y no otra:
 * el cliente pinchó un anuncio concreto y lo que quiere ver es lo que vio ahí.
 * Mandarle la foto de otro artículo del catálogo es contestarle a una pregunta
 * que no hizo.
 *
 * Devuelve las dos formas que tiene de existir —el archivo guardado y, si ya se
 * subió alguna vez, el identificador de Meta— porque cada canal usa una.
 */
export function fotoDelAnuncio(
  orgId: number,
  adId: string,
): { imagen: string | null; attachment_id: string | null } | undefined {
  return s(
    `SELECT imagen, attachment_id FROM anuncios_meta WHERE org_id = ? AND ad_id = ?`,
  ).get(orgId, adId) as { imagen: string | null; attachment_id: string | null } | undefined;
}

/** Meta ya tiene esta foto: se apunta su identificador y no se vuelve a subir. */
export function guardarAdjuntoAnuncio(orgId: number, adId: string, attachmentId: string): void {
  s(`UPDATE anuncios_meta SET attachment_id = ? WHERE org_id = ? AND ad_id = ?`)
    .run(attachmentId, orgId, adId);
}

export function vincularAnuncioAProducto(orgId: number, adId: string, productoId: number | null): void {
  s(`UPDATE anuncios_meta SET producto_id = ? WHERE org_id = ? AND ad_id = ?`)
    .run(productoId, orgId, adId);
}

/**
 * EL NOMBRE Y EL MONTO DE LO QUE SALE EN LA FOTO, PUESTOS A MANO.
 *
 * La dueña (2026-09-08), con la captura delante: un anuncio que es SOLO una
 * imagen —unos jeans sobre una mesa, con el precio escrito encima— no le dice
 * al agente cómo se llama lo que vende ni cuánto vale, y el agente acabó
 * ofreciéndole al cliente otro artículo del catálogo: «no tenemos pantalones,
 * pero le ofrezco los polos». Eso no es vender, es perder al cliente.
 *
 * Lo que se hace ahora es transferir, y quien atiende escribe ahí mismo, en el
 * hilo, el nombre y el monto de esa foto. Eso entra en el CATÁLOGO —que es de
 * donde sale el precio, nunca del modelo— y queda pegado AL ANUNCIO, así que
 * vale para este cliente y para todos los que lleguen después por el mismo
 * anuncio, sin que nadie tenga que volver a escribirlo.
 *
 * Si ya hay un producto que se llama igual, se le pone el precio nuevo en vez
 * de crear un duplicado: corregir un monto no puede llenar el catálogo de
 * artículos repetidos.
 *
 * DÓNDE QUEDA PEGADO, que no siempre es el anuncio:
 *
 *  - `destino: "anuncio"` — la foto es la del anuncio. Vale para este cliente
 *    y para todos los que lleguen después por él.
 *  - `destino: "chat"` — la foto la mandó el cliente a mitad de la
 *    conversación, preguntando por OTRA cosa. Eso es suyo y de nadie más: se
 *    guarda en su hilo. Pegarlo al anuncio le cambiaría el artículo a los
 *    cientos de clientes que llegan por esa misma publicidad.
 *
 * Devuelve el id del producto del catálogo.
 */
export function fijarProductoDeLaFoto(
  orgId: number,
  datos: {
    adId: string | null;
    conversationId: number | null;
    destino: "anuncio" | "chat";
    nombre: string;
    precio: number;
  },
): number {
  const nombre = datos.nombre.trim();

  /*
   * Y NACE EN EL NÚMERO DE ESA CONVERSACIÓN, no en toda la cuenta.
   *
   * El monto que se escribe aquí está en la moneda de ese país. Colgado de la
   * cuenta, un «Pantalón cargo — 1690» puesto desde República Dominicana le
   * llegaba al agente tico como 1.690 colones, y además pisaba el pantalón
   * tico que se llamara igual. Por eso también el duplicado se busca solo
   * entre lo suyo y lo que es de todos.
   */
  const canalId =
    datos.conversationId === null
      ? 0
      : ((s(`SELECT canal_id FROM conversations WHERE org_id = ? AND id = ?`)
          .get(orgId, datos.conversationId) as { canal_id: number } | undefined)?.canal_id ?? 0);

  const tx = db.transaction(() => {
    const existente = s(
      `SELECT id FROM catalogo
        WHERE org_id = ? AND lower(trim(nombre)) = lower(?) AND (canal_id = 0 OR canal_id = ?)`,
    ).get(orgId, nombre, canalId) as { id: number } | undefined;

    let productoId: number;
    if (existente) {
      s(`UPDATE catalogo SET precio = ?, activo = 1 WHERE org_id = ? AND id = ?`)
        .run(datos.precio, orgId, existente.id);
      productoId = existente.id;
    } else {
      productoId = Number(
        s(`INSERT INTO catalogo (org_id, canal_id, nombre, variantes, precio) VALUES (?, ?, ?, NULL, ?)`)
          .run(orgId, canalId, nombre, datos.precio).lastInsertRowid,
      );
    }

    if (datos.destino === "chat" && datos.conversationId !== null) {
      s(`UPDATE conversations SET foto_producto_id = ? WHERE org_id = ? AND id = ?`)
        .run(productoId, orgId, datos.conversationId);
    }

    if (datos.destino === "anuncio" && datos.adId) {
      // El anuncio puede no estar todavía en la tabla —el hilo es viejo, o el
      // referral llegó antes de que existiera—: se crea con su producto ya
      // puesto en vez de perder lo que la persona acaba de escribir.
      s(
        `INSERT INTO anuncios_meta (org_id, ad_id, producto_id) VALUES (?, ?, ?)
         ON CONFLICT(org_id, ad_id) DO UPDATE SET producto_id = excluded.producto_id`,
      ).run(orgId, datos.adId, productoId);

      // Y el aviso de «este anuncio no cotiza» deja de estar abierto: se acaba
      // de arreglar, y dejarlo en la lista de lo que necesita atención hace
      // que nadie se fíe de esa lista.
      s(
        `UPDATE anomalies SET resuelta = 1
          WHERE org_id = ? AND resuelta = 0 AND tipo = 'anuncio_sin_producto'
            AND conversation_id IN (SELECT id FROM conversations WHERE org_id = ? AND meta_ad_id = ?)`,
      ).run(orgId, orgId, datos.adId);
    }

    return productoId;
  });

  return tx();
}

// ── Registro de eventos del webhook ─────────────────────────────────────────

/**
 * EXCEPCIÓN a la regla de aislamiento: `orgId` puede ser nulo a propósito.
 *
 * Un evento de una página que NO está conectada también se guarda, y es el más
 * útil de todos: es el que contesta «conecté la página y no llega nada». Si
 * solo se registraran los eventos con dueño, ese caso no dejaría rastro.
 */
export function registrarEventoMeta(datos: {
  orgId: number | null; canalId: number | null; objeto: string; pageId: string | null;
  firmaOk: boolean; procesado: boolean; mensajes: number; detalle: string | null; cuerpo: string;
}): number {
  const r = s(
    `INSERT INTO eventos_meta
       (org_id, canal_id, objeto, page_id, firma_ok, procesado, mensajes, detalle, cuerpo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    datos.orgId, datos.canalId, datos.objeto, datos.pageId,
    datos.firmaOk ? 1 : 0, datos.procesado ? 1 : 0, datos.mensajes,
    datos.detalle, datos.cuerpo.slice(0, 20_000),
  );
  return Number(r.lastInsertRowid);
}

/** Los últimos eventos de una cuenta. Para el diagnóstico del apartado. */
export function ultimosEventosMeta(orgId: number, limite = 20) {
  return s(
    `SELECT id, objeto, page_id, firma_ok, procesado, mensajes, detalle, recibido_at
       FROM eventos_meta WHERE org_id = ?
      ORDER BY recibido_at DESC, id DESC LIMIT ?`,
  ).all(orgId, limite) as {
    id: number; objeto: string; page_id: string | null; firma_ok: number;
    procesado: number; mensajes: number; detalle: string | null; recibido_at: number;
  }[];
}

/**
 * Los eventos que llegaron SIN dueño, para toda la plataforma.
 *
 * No lleva orgId porque, por definición, no pertenecen a ninguna cuenta: son
 * los de páginas que nadie conectó. Solo los mira el superadmin.
 */
export function eventosMetaHuerfanos(limite = 20) {
  return s(
    `SELECT id, objeto, page_id, firma_ok, detalle, recibido_at
       FROM eventos_meta WHERE org_id IS NULL
      ORDER BY recibido_at DESC, id DESC LIMIT ?`,
  ).all(limite) as {
    id: number; objeto: string; page_id: string | null;
    firma_ok: number; detalle: string | null; recibido_at: number;
  }[];
}

/**
 * Quién llega y quién cierra, por día. Los leads van al día en que escribieron
 * y los cierres al día en que se cerraron, y los dos días se cortan en la hora
 * de la cuenta: SQLite agrupa en UTC, y al oeste de Greenwich la noche entera
 * caía en el día siguiente.
 */
export function serieDiaria(orgId: number, r: Rango) {
  const desfase = Math.round(desfaseMs(r.huso ?? husoDelServidor()) / 1000);

  type Punto = { dia: string; leads: number; leads_anuncio: number; cierres_ia: number; cierres_humano: number };
  const porDia = new Map<string, Punto>();
  const punto = (dia: string): Punto => {
    let p = porDia.get(dia);
    if (!p) {
      p = { dia, leads: 0, leads_anuncio: 0, cierres_ia: 0, cierres_humano: 0 };
      porDia.set(dia, p);
    }
    return p;
  };

  const cohorte = filtroRango(orgId, r);
  const llegaron = s(
    `SELECT date(fecha_inicio + ?, 'unixepoch') AS dia,
            COUNT(*) AS leads,
            SUM(CASE WHEN ${DE_ANUNCIO} THEN 1 ELSE 0 END) AS leads_anuncio
       FROM conversations
      WHERE ${cohorte.where}
      GROUP BY dia`,
  ).all(desfase, ...cohorte.val) as { dia: string; leads: number; leads_anuncio: number }[];
  for (const l of llegaron) {
    const p = punto(l.dia);
    p.leads = l.leads;
    p.leads_anuncio = l.leads_anuncio;
  }

  const cierres = filtroCierres(orgId, r);
  const cerraron = s(
    `SELECT date(fecha_cierre + ?, 'unixepoch') AS dia,
            SUM(CASE WHEN cerrado_por = 'ia'     THEN 1 ELSE 0 END) AS cierres_ia,
            SUM(CASE WHEN cerrado_por = 'humano' THEN 1 ELSE 0 END) AS cierres_humano
       FROM conversations
      WHERE ${cierres.where}
      GROUP BY dia`,
  ).all(desfase, ...cierres.val) as { dia: string; cierres_ia: number; cierres_humano: number }[];
  for (const c of cerraron) {
    const p = punto(c.dia);
    p.cierres_ia = c.cierres_ia;
    p.cierres_humano = c.cierres_humano;
  }

  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Motivos de pérdida del segmento sin cerrar. Lo más valioso del panel. */
export function conteoMotivosPerdida(orgId: number, r: Rango) {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT COALESCE(motivo_perdida, 'sin clasificar') AS motivo, COUNT(*) AS n
       FROM conversations
      WHERE ${where} AND cerrado_por = 'abierta'
      GROUP BY motivo ORDER BY n DESC`,
  ).all(...val) as { motivo: string; n: number }[];
}

/** Muestra de hilos abiertos para que el analista deduzca por qué se cayeron. */
export function abiertasSinMotivo(orgId: number, r: Rango, limite: number): Conversacion[] {
  const { where, val } = filtroRango(orgId, r);
  return s(
    `SELECT * FROM conversations
      WHERE ${where} AND cerrado_por = 'abierta' AND motivo_perdida IS NULL
      ORDER BY last_message_at DESC LIMIT ?`,
  ).all(...val, limite) as Conversacion[];
}

/** Alimenta la anomalía "canal por debajo de su promedio de 7 días". */
export function leadsPorCanalEnVentana(orgId: number, desde: number, hasta: number) {
  return s(
    `SELECT canal_id, COUNT(*) AS n FROM conversations
      WHERE org_id = ? AND fecha_inicio >= ? AND fecha_inicio < ?
      GROUP BY canal_id`,
  ).all(orgId, desde, hasta) as { canal_id: number; n: number }[];
}

/** Conversaciones sin actividad reciente donde el cliente escribió último. */
export function esperandoRespuesta(orgId: number, antesDe: number): Conversacion[] {
  return s(
    `SELECT c.* FROM conversations c
      WHERE c.org_id = ? AND c.fecha_cierre IS NULL AND c.last_message_at < ?
        AND (SELECT m.emisor FROM messages m
              WHERE m.org_id = c.org_id AND m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'cliente'
      ORDER BY c.last_message_at DESC LIMIT 100`,
  ).all(orgId, antesDe) as Conversacion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// La bandeja de Meta
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaBandejaMeta extends FilaBandeja {
  /** El nombre de la página, para poder mezclar varias en una lista. */
  canal: string;
}

/**
 * Los hilos de las páginas de Facebook, mensajes y comentarios juntos.
 *
 * Es la hermana de `bandeja()`, y la diferencia es deliberada: allí el canal es
 * obligatorio porque cada número de WhatsApp es una bandeja aparte; aquí las
 * páginas de una misma cuenta se miran juntas —quien atiende RINCON atiende
 * también ESTILO AUTÉNTICO— y el selector de página filtra cuando hace falta.
 *
 * Comentarios y privados salen mezclados A PROPÓSITO. Quien comenta «¿cuánto
 * cuesta?» debajo de un anuncio es el mismo lead que después escribe por
 * Messenger; separarlos en dos listas obliga a mirar dos veces y a atar a mano
 * lo que ya está atado en la base.
 */
export function bandejaMeta(
  orgId: number,
  /** `canalIds`: el reparto por miembro. Ver la nota gemela en `listarConversaciones`. */
  filtros: { canalId?: number; canalIds?: number[]; limite?: number; red?: "facebook" | "instagram" } = {},
): FilaBandejaMeta[] {
  const cond = ["c.org_id = ?", "ca.tipo = 'meta'"];
  const val: unknown[] = [orgId];

  if (filtros.canalId !== undefined) {
    cond.push("c.canal_id = ?");
    val.push(filtros.canalId);
  }
  if (filtros.canalIds !== undefined) {
    if (filtros.canalIds.length === 0) return [];
    cond.push(`c.canal_id IN (${filtros.canalIds.map(() => "?").join(",")})`);
    val.push(...filtros.canalIds);
  }

  /*
   * Las conversaciones de antes de que existiera esta columna no tienen `red`.
   * Se les asigna una por su `superficie`, que sí tenían: las de Instagram se
   * quedan en Instagram, todo lo demás —Messenger y comentarios viejos, que no
   * decían de qué red venían— se queda en Facebook, que es donde ya se veían.
   * Sin este respaldo, un hilo viejo desaparecería de las dos bandejas.
   */
  if (filtros.red) {
    cond.push(
      "COALESCE(c.red, CASE WHEN c.superficie = 'instagram' THEN 'instagram' ELSE 'facebook' END) = ?",
    );
    val.push(filtros.red);
  }

  val.push(Math.min(filtros.limite ?? 120, 400));

  return s(
    `SELECT c.*,
            ca.nombre AS canal,
            (SELECT m.content FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultimo_texto,
            (SELECT m.emisor FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS ultimo_emisor,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS mensajes
       FROM conversations c
       JOIN canales ca ON ca.id = c.canal_id
      WHERE ${cond.join(" AND ")}
      ORDER BY COALESCE(c.last_message_at, c.fecha_inicio) DESC
      LIMIT ?`,
  ).all(...val) as FilaBandejaMeta[];
}

// ─────────────────────────────────────────────────────────────────────────────
// El supervisor — ver `supervisor.ts`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las cuentas con algún número encendido. Es por donde empieza el supervisor.
 *
 * EXCEPCIÓN a la regla de aislamiento, la misma que `orgsConAgente`: una
 * vuelta programada no viene de una sesión. Devuelve identificadores y nada
 * más, y a partir de ahí todo vuelve a ir con `org_id`.
 */
export function orgsConCanales(): number[] {
  const filas = s(`SELECT DISTINCT org_id FROM canales WHERE activo = 1`).all() as { org_id: number }[];
  return filas.map((f) => f.org_id);
}

/**
 * Las ventas cerradas por un resumen desde `desde`, INCLUIDAS las que el
 * supervisor ya mandó a revisión: son las que sirven para contar cuántos chats
 * distintos llevan el mismo nombre. Las corregidas a mano no salen: llevan
 * otra señal y esa la firmó una persona.
 */
export function cierresRecientesPorResumen(orgId: number, desde: number, limite = 500): Conversacion[] {
  return s(
    `SELECT * FROM conversations
      WHERE org_id = ? AND fecha_cierre >= ?
        AND senal_de_cierre = 'resumen_ia'
        AND cerrado_por IN ('ia', 'revision')
      ORDER BY fecha_cierre DESC
      LIMIT ?`,
  ).all(orgId, desde, limite) as Conversacion[];
}

/**
 * El primer mensaje nuestro de un hilo que sea un resumen de pedido, según
 * `esResumen`. Es el que selló la venta —entre dos resúmenes manda el
 * primero— y por eso es el que se juzga.
 */
export function primerResumenDe(
  orgId: number,
  conversationId: number,
  esResumen: (content: string) => boolean,
): string | null {
  const filas = s(
    `SELECT content FROM messages
      WHERE org_id = ? AND conversation_id = ? AND emisor <> 'cliente'
      ORDER BY created_at ASC, id ASC`,
  ).all(orgId, conversationId) as { content: string }[];

  for (const f of filas) if (esResumen(f.content)) return f.content;
  return null;
}

/**
 * PONE EN DUDA UNA VENTA: pasa a revisión sin dejar de ser un cierre.
 *
 * Es la segunda forma legítima de mover un cierre sellado, y va en un solo
 * sentido: de «venta de la IA» a «que lo mire alguien». La fecha de cierre se
 * conserva —si una persona la confirma desde la bandeja, la venta vuelve con
 * su hora de verdad— y las corregidas a mano no se tocan: el `WHERE` solo
 * admite las que siguen selladas por un resumen y a nombre de la IA.
 */
export function dudarDelCierre(orgId: number, id: number, justificacion: string): boolean {
  const r = s(
    `UPDATE conversations
        SET cerrado_por = 'revision', justificacion = ?
      WHERE org_id = ? AND id = ?
        AND cerrado_por = 'ia' AND senal_de_cierre = 'resumen_ia'`,
  ).run(justificacion, orgId, id);
  return r.changes > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// La factura de cada venta. Ver `marcarFacturada` y `cierre.ts`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las fotos que mandó el equipo DESPUÉS de cerrarse la venta y que nadie ha
 * mirado todavía (`descripcion_imagen` nula: la visión, al fallar, también
 * escribe, así que una foto que no se pudo leer no se vuelve a pagar).
 */
export function fotosPorMirarTrasElCierre(orgId: number, conversationId: number, desde: number): Mensaje[] {
  return s(
    `SELECT * FROM messages
      WHERE org_id = ? AND conversation_id = ? AND emisor <> 'cliente'
        AND tipo = 'imagen' AND descripcion_imagen IS NULL AND created_at >= ?
      ORDER BY created_at ASC, id ASC`,
  ).all(orgId, conversationId, desde) as Mensaje[];
}

/**
 * Ventas recientes sin factura apuntada que tienen fotos del equipo sin mirar
 * después del cierre: ahí puede estar la factura. Solo las de los últimos días
 * —mirar fotos cuesta visión, y una factura llega en horas, no en meses—.
 */
export function ventasPorFacturar(orgId: number, desde: number, limite: number): Conversacion[] {
  return s(
    `SELECT c.* FROM conversations c
      WHERE c.org_id = ? AND c.cerrado_por IN ('ia','humano') AND c.facturada_at IS NULL
        AND c.fecha_cierre >= ?
        AND EXISTS (
          SELECT 1 FROM messages m
           WHERE m.org_id = c.org_id AND m.conversation_id = c.id AND m.emisor <> 'cliente'
             AND m.tipo = 'imagen' AND m.descripcion_imagen IS NULL AND m.created_at >= c.fecha_cierre)
      ORDER BY c.fecha_cierre DESC
      LIMIT ?`,
  ).all(orgId, desde, limite) as Conversacion[];
}

/**
 * Las ventas de la IA de la cuenta cerradas entre `desde` y `hasta`, fuera de
 * `excluir`. Son las candidatas a ser LA MISMA venta que una factura que llegó
 * por otro hilo. Ver `ventaQueConfirmaLaFactura` en `cierre.ts`.
 */
export function ventasDeLaIaEntre(orgId: number, desde: number, hasta: number, excluir: number): Conversacion[] {
  return s(
    `SELECT * FROM conversations
      WHERE org_id = ? AND id <> ? AND cerrado_por = 'ia' AND senal_de_cierre = 'resumen_ia'
        AND fecha_cierre BETWEEN ? AND ?
      ORDER BY fecha_cierre DESC`,
  ).all(orgId, excluir, desde, hasta) as Conversacion[];
}

/**
 * UNA FACTURA QUE NO ES OTRA VENTA: el hilo deja de contar como venta.
 *
 * Es la foto de la factura de una venta que ya cerró la IA en otro hilo del
 * mismo cliente. Contarla sería contar dos veces la misma venta: el hilo vuelve
 * a abierto con la explicación, y la venta de verdad queda marcada como
 * facturada. Las corregidas a mano no se tocan.
 */
export function deshacerVentaDuplicada(orgId: number, id: number, justificacion: string): boolean {
  const r = s(
    `UPDATE conversations
        SET cerrado_por = 'abierta', senal_de_cierre = NULL, fecha_cierre = NULL,
            justificacion = ?, analizada_at = unixepoch()
      WHERE org_id = ? AND id = ? AND COALESCE(senal_de_cierre, '') <> 'correccion_manual'`,
  ).run(justificacion, orgId, id);
  return r.changes > 0;
}

/** Todas las conversaciones con cierre sellado de una cuenta. Para el recálculo. */
export function conversacionesSelladas(orgId: number): Conversacion[] {
  return s(
    `SELECT * FROM conversations WHERE org_id = ? AND fecha_cierre IS NOT NULL ORDER BY fecha_cierre ASC, id ASC`,
  ).all(orgId) as Conversacion[];
}

/**
 * Reescribe el cierre de una venta con lo que dice la regla. SOLO para el
 * recálculo del histórico (`recalculo.ts`): fuera de ahí, un cierre sellado no
 * se mueve más que por las vías de arriba.
 */
export function reescribirCierre(orgId: number, id: number, cierre: {
  cerradoPor: EstadoCierre; senal: string | null; fechaCierre: number; facturadaAt: number | null;
}): void {
  s(
    `UPDATE conversations
        SET cerrado_por = ?, senal_de_cierre = ?, fecha_cierre = ?, facturada_at = ?
      WHERE org_id = ? AND id = ?`,
  ).run(cierre.cerradoPor, cierre.senal, cierre.fechaCierre, cierre.facturadaAt, orgId, id);
}

/** El informe de un recálculo ya hecho, o null. */
export function obtenerRecalculo(orgId: number, clave: string): { creado_at: number; informe: string } | null {
  return (s(`SELECT creado_at, informe FROM recalculos WHERE org_id = ? AND clave = ?`)
    .get(orgId, clave) as { creado_at: number; informe: string } | undefined) ?? null;
}

/** Apunta un recálculo. Devuelve false si ya estaba: nunca se hace dos veces. */
export function guardarRecalculo(orgId: number, clave: string, informe: string): boolean {
  return s(`INSERT OR IGNORE INTO recalculos (org_id, clave, informe) VALUES (?, ?, ?)`)
    .run(orgId, clave, informe).changes > 0;
}

/** Las cuentas con alguna venta sellada: el recálculo del arranque pasa por cada una. */
export function orgsConVentas(): number[] {
  return (s(`SELECT DISTINCT org_id FROM conversations WHERE fecha_cierre IS NOT NULL ORDER BY org_id`)
    .all() as { org_id: number }[]).map((f) => f.org_id);
}

/** Ventas selladas que todavía facturan cero: el pedido está sin extraer. */
export function selladasSinAnalizar(orgId: number, limite: number): Conversacion[] {
  return s(
    `SELECT * FROM conversations
      WHERE org_id = ? AND fecha_cierre IS NOT NULL AND analizada_at IS NULL
      ORDER BY fecha_cierre DESC
      LIMIT ?`,
  ).all(orgId, limite) as Conversacion[];
}

/**
 * Conversaciones abiertas que se quedaron quietas —su último mensaje cae
 * entre `desde` y `hasta`— y no se han analizado desde entonces.
 */
export function asentadasSinAnalizar(
  orgId: number,
  desde: number,
  hasta: number,
  limite: number,
): Conversacion[] {
  return s(
    `SELECT * FROM conversations
      WHERE org_id = ? AND fecha_cierre IS NULL AND cerrado_por = 'abierta'
        AND last_message_at BETWEEN ? AND ?
        AND (analizada_at IS NULL OR analizada_at < last_message_at)
      ORDER BY last_message_at ASC
      LIMIT ?`,
  ).all(orgId, desde, hasta, limite) as Conversacion[];
}
