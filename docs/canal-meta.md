# El canal de Meta, en SalesDash

Messenger, mensajes directos de Instagram y comentarios de anuncios, escrito en
la arquitectura de este proyecto: Next.js App Router, TypeScript y `src/lib/`.

> **Estado al 26 de agosto de 2026.** Hecho: el apartado «Messenger» en el menú
> y la página `/canales/meta`, que enseña qué configuración está puesta. Falta
> todo lo demás: recepción del webhook, tablas, bandeja y envío.
>
> Este documento **no sustituye** al `docs/messenger.md` que viene con los
> archivos base y que todavía no está en el repo. Aquel define el contrato con
> Meta —forma de los eventos, validación de la firma—; este dice dónde encaja
> cada pieza aquí dentro. Cuando llegue, mandan los dos: el contrato es suyo, la
> arquitectura es esta.

## Lo primero: la estructura de origen no se copia

Los archivos base vienen de un proyecto Express + React con `client/`, `server/`,
`src/routes/`, `src/services/` y `src/channels/`. Nada de eso existe aquí, y
copiarlo tal cual rompe cosas concretas:

- **`src/pages/` es el directorio del Pages Router de Next.** Este proyecto usa
  el App Router (`src/app/`). Un archivo ahí no se queda quieto: Next intenta
  enrutarlo y quedan las dos convenciones mezcladas.
- **No hay servidor aparte.** Los endpoints son *route handlers* en
  `src/app/api/<ruta>/route.ts`.
- **Todo `src/` es TypeScript** y `npm run typecheck` entra en el CI.
- **La lógica que no es de pantalla vive en `src/lib/`.** Añadir `routes/` y
  `services/` para lo mismo parte el criterio en tres.

## Dónde va cada pieza

| Archivo base | Aquí |
|---|---|
| `docs/messenger.md` | `docs/messenger.md` — tal cual, es documentación |
| `client/MessengerPage.jsx` | `src/app/(app)/canales/meta/page.tsx` ✅ *creada* |
| `client/BandejaMeta.jsx` | `src/components/panel/BandejaMeta.tsx` |
| `client/messenger.css` | dentro de `src/app/globals.css` |
| `server/meta-canales.js` | `src/app/api/meta/canales/route.ts` |
| `server/bandeja-meta.js` | `src/app/api/meta/bandeja/route.ts` |
| `server/contexto-anuncio.js` | `src/lib/meta/contexto-anuncio.ts` |
| `server/normalize.js` | `src/lib/meta/normalize.ts` |
| `server/send.js` | `src/lib/meta/send.ts` |
| `server/webhook.js` *(falta escribirlo)* | `src/app/api/meta/webhook/route.ts` |

## Lo que se reutiliza tal cual

Esta es la parte importante: casi nada hay que inventarlo. El proyecto ya está
montado para recibir mensajes de un proveedor cualquiera.

### La entrada de mensajes — `ingerir()` en `src/lib/ingesta.ts`

Es el punto de entrada del canal nuevo, y ya está diseñado para esto: su
cabecera dice *«aquí dentro no hay ni una palabra de Baileys»*. Quien llama
traduce; `ingerir` es agnóstica de proveedor.

```
ingerir(canal: Canal, mensajes: MensajeEntrante[], { dentroDePeticion: boolean })
```

`normalize.ts` tiene un solo trabajo: convertir el evento de Meta en
`MensajeEntrante` (`ingesta.ts:51`):

```
id, deMi, chatId, tipo, content, mediaUrl, cuando,
nombre, deAnuncio, productoAnuncio, descripcionAnuncio
```

Sus cuatro invariantes se heredan gratis. Dos importan especialmente:

- **Idempotencia (invariante 3).** `messages.whapi_message_id` es `UNIQUE`. Si
  `normalize.ts` mapea el `mid` de Meta a ese campo, el `message_echoes` que
  Meta manda cuando el vendedor responde desde la bandeja no duplica nada. No
  hay que construir nada: hay que **no romperlo**.
- **Atribución (invariante 2).** De quién es un mensaje se decide por
  `message_id` contra `ai_sent_ids`, no por `from_me`. Los mensajes del agente y
  los del vendedor salen de la misma página.

### El registro de la venta — `src/lib/cierre.ts`

`registrarCierre(orgId, conversationId, { emisor, content, cuando })`. Detecta
el marcador de la cuenta (`orgs.marcador_cierre`, por defecto `"Resumen:"`) y
sella con `sellarCierre()`. Vale igual para Meta: no sabe de dónde vino el
mensaje.

### Automatizada / Asistida

No hay tabla de ventas: **una venta es una conversación con `cerrado_por`
sellado**.

```
conversations.cerrado_por CHECK(cerrado_por IN ('ia','humano','abierta','revision'))
```

`'ia'` es **Automatizada**, `'humano'` es **Asistida** (cambiaron las etiquetas
visibles, no los valores). Todo lo demás se deriva en `src/lib/metrics.ts`.

### La sesión — `src/lib/tenant.ts`

No es middleware: son funciones que se llaman al principio de cada handler.
`requerirSesion()` en páginas, `sesionApi()` en rutas de API. **El `orgId` sale
siempre de la cookie firmada, nunca del body ni del query string.**

El webhook es la excepción conocida: no trae sesión, así que deduce la cuenta
resolviendo la página de Meta contra la tabla de páginas. Es el mismo patrón que
`canalPorWebhook()` ya usa, y está declarado como excepción en la cabecera de
`db.ts`.

### El prompt y los precios — `src/lib/agent.ts`

`armarSistema(negocio, agente, catalogo, anuncio, marcador)` (`agent.ts:139`).
**No se toca.** El canal nuevo le pasa los mismos argumentos.

## Los cuatro requisitos, y dónde se apoya cada uno

### 1. El referral llega solo en el primer evento

**Ya resuelto, y no por casualidad.** `getOrCreateConversation()` (`db.ts:733`)
guarda `origen`, `producto_anuncio` y `descripcion_anuncio` en la conversación,
y rellena **solo lo que está vacío**: si el cliente vuelve por otro anuncio, el
lead sigue siendo del primero que lo trajo.

La reinyección también existe: `anuncioParaModelo()` (`src/lib/anuncio.ts:47`)
lo convierte en texto y `armarSistema` lo mete en **cada** llamada al modelo.

Para Meta solo hay que llenar `deAnuncio`, `productoAnuncio` y
`descripcionAnuncio` desde el `referral` del primer evento. El resto ya pasa.

### 2. El precio sale del catálogo, nunca del modelo

La regla ya está escrita en el prompt, literal: *«No inventes precios,
productos, plazos ni promociones»*, más las dos reglas de anuncio — *«El anuncio
dice lo que se le prometió, no lo que hay»*.

Lo que falta es la parte de datos: **vincular anuncio → producto del catálogo**.
Ahí entra `contexto-anuncio.ts`. Y el caso «anuncio sin producto vinculado»
se apoya en lo que ya hace `atenderConversacion()` para transferir — la misma
salida que usa `pideHumano()`.

### 3. Facturado por moneda, sin sumar RD$ con ₡

**Es el único que necesita columna nueva.** Hoy no hay moneda en ninguna parte:
`conversations.total` y `.envio` son `REAL` a secas, y `dinero()`
(`Piezas.tsx:368`) formatea con `es-DO` fijo.

Afecta a más de lo que parece: `resumenVentas()`, `metricasPorCanal()`,
`facturado_por_canal`, el informe y la tarjeta de Facturado del dashboard suman
todo junto. Sumar dos monedas da un número que no significa nada, así que la
agregación tiene que agrupar por moneda **antes** de formatear.

### 4. El `message_echoes` no puede duplicar el hilo

Cubierto por el `UNIQUE` de `whapi_message_id` — ver invariante 3 arriba.
Requisito: que `normalize.ts` ponga ahí el `mid` de Meta, siempre, también en
los ecos.

## Migraciones

Van en `migrar(conexion)` (`db.ts:252`). Dos mecanismos conviviendo:

- **Añadir columna:** `if (!columnas("tabla").includes("x")) ALTER TABLE …`.
  No reescribe la tabla ni toca una fila.
- **Cambios de datos que solo deben correr una vez:** detrás de
  `PRAGMA user_version`. **La última usada es la 4**; la siguiente es la 5.

Tablas nuevas que pide el plan: páginas de Meta, anuncios vinculados a
productos, eventos recibidos. Columnas nuevas: `canal` en conversaciones (y en
lo que consulte ventas), y la moneda del requisito 3.

### La decisión que hay que tomar antes de escribirlas

```sql
conversations: cliente_phone TEXT NOT NULL, UNIQUE(canal_id, cliente_phone)
```

**Un PSID de Messenger o un IGSID no son teléfonos**, y `normalizarTelefono()`
(`src/lib/telefono.ts`) los rechazaría — `ingerir` descarta el mensaje antes de
llegar a la base.

Dos salidas, y hay que elegir una a propósito:

1. **Reutilizar la columna** como «identificador del cliente en su canal».
   No hay migración de esquema, pero `ingerir` tiene que dejar de normalizar
   como teléfono cuando el canal es de Meta.
2. **Columna aparte** (`cliente_externo_id`) y mover el índice único.
   Más limpio conceptualmente, pero toca el `UNIQUE` de una tabla viva y toda
   consulta que hoy busca por `cliente_phone`.

Es la decisión estructural más grande de la integración. No la tomo yo.

## Lo que sigue bloqueado

El webhook (`X-Hub-Signature-256` sobre el cuerpo crudo), las tablas y las
funciones de datos (`paginasMeta`, `anuncios`, `conversaciones`, `eventosMeta`,
`metricasCanal`) dependen de `docs/messenger.md`: define el contrato de los
eventos y la validación de la firma, y las firmas de esas funciones las imponen
las llamadas desde `meta-canales.js` y `bandeja-meta.js`.

Escribirlas adivinando significaría rehacerlas cuando lleguen los archivos —y en
el caso de la firma, adivinar tiene consecuencias de seguridad.

## Configuración

Las variables están documentadas en `.env.example`, sección «Meta». La página
`/canales/meta` enseña cuáles están puestas, sin leer ni un valor.
