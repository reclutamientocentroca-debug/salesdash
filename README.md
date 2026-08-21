# SalesDash

Plataforma para medir ventas por WhatsApp. En una tienda que vende por WhatsApp, unas ventas las cierra un agente automático y otras las cierran vendedores humanos — **desde el mismo número**. Nadie sabe cuál es cuál. SalesDash lo mide.

Cada persona crea su cuenta, conecta sus números y obtiene su propio panel. Las cuentas están completamente aisladas entre sí.

---

## Las dos IAs, y por qué están separadas

**IA analista** (`src/lib/analyzer.ts`) — lee conversaciones y las clasifica. **Nunca escribe a un cliente.** No importa `agent.ts`, ni la función de envío, ni nada que hable con WhatsApp.

**IA vendedora** (`src/lib/agent.ts`) — responde a los clientes. Es **opcional** y se enciende por número. Es el **único módulo que puede mandar un mensaje**: el transporte vive en `src/lib/wa.ts`, pero solo `agent.ts` importa su función de envío.

La separación no es una convención que se pueda romper sin darse cuenta: hay una prueba que barre todo `src/` y falla si cualquier otro archivo importa la función de envío.

```bash
npm test    # incluye «solo el agente puede enviar mensajes a un cliente»
```

---

## Empezar en local

```bash
npm install
cp .env.example .env.local     # y rellena SESSION_SECRET como mínimo
npm run seed                   # cuenta de ejemplo con 30 días de datos
npm run dev
```

Genera el secreto de sesión con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

La cuenta de ejemplo entra en `/login` con **demo@salesdash.app** / **demo1234**.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Producción |
| `npm run seed` | Organización de ejemplo con datos |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 39 pruebas: aislamiento, invariante de conteo, regla maestra, salvaguardas del agente |
| `npm run diagnostico` | Por qué no llegan conversaciones: sesiones en disco, mensajes recibidos y su estado |
| `npm run probar-correo -- x@y.com` | Envía un correo de prueba. Comprueba SMTP sin pasar por la app |
| `npm run superadmin -- x@y.com` | Marca una cuenta como superadmin de la plataforma |
| `npm run verificar-ia` | **Consume crédito.** Analiza conversaciones reales contra OpenRouter y comprueba el respaldo del agente |
| `npm run verificar-vision` | **Consume crédito.** Clasifica una factura y una foto de producto reales |

Las dos últimas gastan tokens de verdad: son para comprobar una configuración nueva, no para el día a día. `npm test` no toca la red.

**El registro es directo: se crea la cuenta y se entra en el acto.** No hay confirmación por correo ni código de seis dígitos. SMTP sigue haciendo falta, pero solo para avisar al dueño de una solicitud de acceso de soporte — si falta, nadie se queda fuera de su cuenta.

---

## Variables de entorno

```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL_ANALISIS=openai/gpt-4o-mini
OPENROUTER_MODEL_AGENTE=openai/gpt-4o-mini

# Firma las cookies de sesión y deriva las claves derivadas de la aplicación.
# Si cambia, se invalidan las sesiones y los tokens guardados dejan de leerse.
SESSION_SECRET=

# Con Resend: el usuario es la palabra "resend", no tu correo.
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_...
MAIL_FROM="SalesDash <no-reply@tudominio.com>"

APP_URL=https://tudominio.com  # sin barra final
```

### Correo con Resend

| Campo | Valor |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` (TLS directo) o `587` (STARTTLS) |
| `SMTP_USER` | `resend` — literalmente esa palabra, no tu correo |
| `SMTP_PASS` | tu clave de API, la que empieza por `re_` |

`MAIL_FROM` tiene que usar un dominio verificado en Resend. **Mientras no verifiques uno, `onboarding@resend.dev` solo envía a la dirección de tu propia cuenta de Resend** — sirve para probar el despliegue, no para atender usuarios reales, que se registran con correos cualesquiera.

Comprueba que funciona antes de perseguir el fallo dentro de la aplicación:

```bash
npm run probar-correo -- tu@correo.com
```

### Qué modelo usar

**Usa `openai/gpt-4o-mini` o algún otro de pago.** Los modelos `:free` de OpenRouter tienen un límite diario muy bajo y devuelven 429 en producción real. Sirven para probar; para atender clientes, no.

Una cuenta nueva nace con un modelo gratuito para que se pueda probar sin pagar, y el aviso es visible desde el primer momento en la pantalla del agente.

Configura siempre un **modelo de respaldo**. Si el principal falla o agota su cupo, se reintenta una vez con él. Si tampoco hay respuesta, el agente **se calla**: marca la conversación para atención humana y genera una anomalía. Nunca le escribe "hubo un error" a un cliente.

La lista de modelos se carga de OpenRouter (`GET /api/v1/models`, cacheada 24 h), no está escrita a mano en el código.

---

## Cómo se conecta un número

Se **escanea un QR desde el panel**, y es el único camino. No hay proveedor, no hay token que pegar, no hay cuota mensual: el servidor habla directamente con WhatsApp usando [Baileys](https://github.com/WhiskeySockets/Baileys), el mismo protocolo de WhatsApp Web.

Se pone un nombre, aparece el código, se escanea con el teléfono. El número queda vinculado igual que si abrieras WhatsApp Web, y así aparece en **Dispositivos vinculados** del móvil.

Mientras la pantalla del QR está abierta se sondea el estado cada 2 segundos. Ese sondeo ya no sale a la red: solo lee el estado del socket que este mismo proceso mantiene abierto.

### Lo que hay que saber antes de desplegarlo

**La sesión vive en el disco**, en `<datos>/sesiones/<canalId>`. Es la consecuencia más importante de no tener proveedor: si esa carpeta no sobrevive al redespliegue, **hay que reescanear el QR de todos los números**. El volumen dejó de ser recomendable y pasó a ser obligatorio.

**El contenedor tiene que estar siempre encendido.** Con un proveedor, sus servidores recibían los mensajes aunque el panel estuviera caído y los reenviaban después. Aquí no hay nadie detrás: con el proceso apagado, el socket está cerrado.

**Una sola réplica.** Los sockets viven en la memoria del proceso. Dos réplicas abrirían la misma sesión y WhatsApp cerraría una de las dos.

**WhatsApp puede bloquear un número** por comportamiento automatizado. No es la API oficial de Meta, y ese riesgo es real y no lo controla esta aplicación.

Al arrancar, `src/instrumentation.ts` reabre las sesiones de los números ya vinculados — solo esos: un canal creado y nunca escaneado no tiene nada que reabrir.

**Ya no hay tokens que guardar ni que revelar.** La credencial es la vinculación del teléfono, no un texto: desapareció `canales.token_cifrado`, la pantalla de «Ver token» y, con ellas, la posibilidad de filtrar uno por la interfaz.

---

## La atribución, que es el corazón del producto

Los mensajes de la IA y los del vendedor salen del mismo número, así que `from_me` no los distingue. Se resuelve por `message_id`:

1. Al enviar, el agente registra el id devuelto en `ai_sent_ids`. Si el envío lo hace Make, avisa por `POST /api/ai-sent`.
2. Cuando el saliente vuelve por el socket, se busca ese id: si está → `ia`; si no → `humano` + `intervencion_humana = 1`.

**La carrera está resuelta.** El saliente puede volver antes que el aviso: el mensaje queda como `humano` de forma provisional, y cuando llega `/api/ai-sent` se corrige a `ia` y se recalcula la conversación entera. Sin esto, los cierres de la IA se contarían como humanos.

`POST /api/ai-sent` se identifica con la sesión del panel o con `?canal=<id>&s=<webhook_secret>`. Ya no hay webhook entrante, pero esa credencial se conserva: es lo que permite a una automatización externa avisar de que un envío fue suyo. Sin ella, sus mensajes se contarían como humanos.

### La regla maestra

**La venta pertenece a quien produjo la PRIMERA señal de cierre, en orden cronológico. Lo posterior no reclasifica nada.**

El caso que más se da: la IA manda el resumen del pedido → la venta ya es suya. Diez minutos después el vendedor manda la foto de la factura → **eso es papeleo, no un cierre**. La venta sigue siendo de la IA.

Está garantizado en el `UPDATE`, no en el código que lo llama:

```sql
UPDATE conversations SET cerrado_por = ?, fecha_cierre = ?
 WHERE org_id = ? AND id = ? AND fecha_cierre IS NULL
```

Lo único que rompe el sellado es una corrección manual desde la bandeja de revisión, y queda registrada como anomalía para poder auditarla.

### Los cinco estados y la invariante

Toda conversación del día termina en exactamente uno de cinco estados. No existe "sin procesar":

| Estado | Significado |
|---|---|
| lead | Toda conversación lo es desde que existe |
| `ia` | La IA mandó el resumen con el marcador, sin intervención humana previa |
| `humano` | Un vendedor cerró: factura, comprobante o confirmación con monto |
| `abierta` | Hay conversación pero no hay cierre |
| `revision` | El analista no pudo decidir. Aparece en la bandeja para que una persona lo resuelva |

```
leads = cerradas_ia + cerradas_humano + abiertas + revision
```

Hay una prueba que lo verifica (`tests/conteo.test.ts`), el barrido diario lo comprueba al terminar, y el dashboard muestra un aviso rojo si deja de cumplirse. **Si no cuadra, hay conversaciones perdiéndose y el reporte es falso.**

**Un lead es un cliente que llega.** La conversación se crea con el primer mensaje *entrante*: no importa si después nadie contesta, ya cuenta. Un mensaje saliente a un número con el que nunca hubo conversación no abre ninguna, para que las salidas en frío no inflen el conteo.

### Las imágenes

En esta operación el vendedor no manda un resumen de texto: **cierra mandando la foto de la factura**. Pero también manda fotos de productos cuando el cliente las pide, y contar cualquier imagen como cierre inflaría los cierres humanos.

Por eso las imágenes salientes de hilos **sin cierre asignado** se describen con un modelo de visión y se clasifican en `factura`, `comprobante_pago`, `foto_producto` u `otro`. Solo las dos primeras cierran.

Dos consecuencias que importan:

- **Si la conversación ya está sellada, la imagen no se procesa.** Ahí se iba la mayor parte del gasto: las facturas de trámite posterior son la mayoría. Hay una prueba que lo verifica.
- **Si el modelo de visión falla, la conversación va a `revision`.** Nunca se asume que era una factura.

El archivo **no se descarga ni se almacena**. Guardar las facturas de los clientes de tus clientes es un problema de privacidad que no queremos.

**Al conectar por QR esto tiene una consecuencia:** un proveedor daba una URL temporal que el modelo con visión podía leer; por el socket los archivos llegan como bytes cifrados, y servirlos exigiría almacenarlos. Así que hoy las imágenes **se registran pero no se clasifican**: el mensaje entra con su marca  —el conteo, la atribución y la detección de intervención humana siguen exactos— y la descripción queda como .

---

## Aislamiento entre cuentas

Si una consulta olvida filtrar por `org_id`, un cliente ve los datos de otro. Las reglas:

1. Toda tabla de datos lleva `org_id`, incluso cuando podría deducirse por join.
2. **Ninguna función de negocio de `db.ts` tiene una firma sin `orgId` como primer parámetro.** Hay una prueba que lee el propio archivo y falla si alguien añade una que no lo cumpla.
3. Toda consulta lleva `WHERE org_id = ?`.
4. El `orgId` sale **siempre de la cookie firmada**, nunca del body ni del query string.
5. Las únicas consultas que cruzan organizaciones viven en `src/lib/admin-db.ts`, y cada función empieza verificando `superadmin = 1`.

Excepciones, ambas documentadas en el sitio y enumeradas en la prueba:

- La **capa de identidad** (crear cuenta, buscar por correo), que corre antes de que exista sesión y no devuelve datos de negocio.
- **`canalPorWebhook(canalId, secret)`**, porque el webhook deduce la organización desde el canal: recibir `org_id` por parámetro sería regalar escritura en la cuenta ajena.

---

## Consola de plataforma

Vive en `/admin`, con barra oscura arriba en vez de lateral clara, para que nunca haya duda de dónde estás.

**El rol `superadmin` solo se activa a mano en la base de datos.** No hay interfaz que lo otorgue:

```bash
npm run superadmin -- tu@correo.com     # conceder
npm run superadmin -- tu@correo.com --quitar
npm run superadmin                      # ver quién lo tiene
```

Dentro del contenedor: `docker exec -it <contenedor> npm run superadmin -- tu@correo.com`

**Lo que el superadmin NO ve:** el contenido de ninguna conversación, ni nombres o teléfonos de los clientes finales, ni tokens en claro. Las métricas son agregados.

**Acceso de soporte con consentimiento.** No existe un botón de "entrar a la cuenta". Existe *pedir permiso*: el superadmin explica el motivo, el dueño recibe un correo y aprueba desde su propio panel, la sesión dura 60 minutos y expira sola. Todo queda en `soporte_accesos`, **visible también para el dueño**, en Equipo. Nunca hay un acceso silencioso.

---

## Anomalías

Reglas mecánicas, sin modelos: son deterministas, baratas y explicables.

| Regla | Severidad |
|---|---|
| Cierre sin `total` o sin `envio` | alta |
| Cliente escribió último y pasaron 30 minutos | alta |
| Canal conectado con cero mensajes en 24 h (casi siempre el webhook caído) | alta |
| Canal muy por debajo de su promedio de 7 días | alta |
| La IA repitió el mismo texto dos veces seguidas | media |
| `producto_vendido` distinto de `producto_anuncio` | media |

Dos de ellas son de canal y no de conversación, así que `anomalies.conversation_id` es nullable y existe `anomalies.canal_id`, con un `CHECK` de que al menos uno esté presente. La migración se aplica sola al arrancar.

---

## Despliegue en EasyPanel

1. **Volumen persistente en `/app/data`.** Crítico: ahí vive `salesdash.db`. Sin volumen, cada redespliegue borra todas las cuentas.
2. `nixpacks.toml` ya está en el repo. `better-sqlite3` y `argon2` compilan código nativo: sin `python3`, `gcc` y `gnumake` el build remoto falla.
3. Las variables de entorno se configuran en el panel de EasyPanel, **nunca en el repo**.
4. La URL del webhook la arma el panel solo: `https://tudominio.com/api/webhook/[canalId]?s=[secret]`.

---

## Notas de escala

**SQLite aguanta bien las primeras decenas de cuentas.** Cuando haga falta más, la migración natural es Postgres, y está preparada: **todo el SQL vive en `db.ts` y `admin-db.ts`**. Ningún componente ni ninguna ruta escribe SQL, así que el cambio es reemplazar un módulo, no reescribir la aplicación.

**El límite de intentos vive en memoria del proceso.** Para un contenedor único de EasyPanel es suficiente. Con varias réplicas, el límite pasa a ser por réplica y habría que moverlo a la base.

---

## Mejoras pendientes

- **Entrar con Google.** El diseño lo contempla, pero necesita credenciales de OAuth y rutas de callback que no están en el alcance actual. Un botón que no hace nada es peor que ningún botón, así que no está.
- **Barrido automático diario.** Hoy el análisis se dispara desde el panel (`POST /api/analyze`); no hay tareas programadas en el stack.
- **Transcripción de notas de voz.** Se registran para que el conteo de mensajes y la detección de intervención humana sean correctos, pero su contenido no se analiza.
- **Invitar miembros al equipo.** La tabla `users` ya soporta el rol `miembro`; falta el flujo de invitación por correo.
- **Cupo real de los modelos gratuitos.** El indicador de consumo usa una estimación: OpenRouter no publica el cupo restante por clave.
- **Contexto del anuncio.** Se lee `contextInfo.externalAdReply` de forma defensiva; si WhatsApp no lo manda, `producto_anuncio` queda vacío y lo deduce el analista del texto.
