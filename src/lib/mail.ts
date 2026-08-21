/**
 * SalesDash — correo saliente.
 *
 * Dos correos y nada más: el código de verificación y el aviso de que alguien
 * de soporte pide entrar a la cuenta.
 *
 * Los mensajes no llevan imágenes externas ni píxeles de seguimiento. Todo el
 * estilo va en línea porque los clientes de correo descartan las hojas aparte.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const REMITENTE = () => process.env.MAIL_FROM ?? "SalesDash <no-reply@localhost>";

let transporte: Transporter | null = null;

function obtenerTransporte(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  if (!transporte) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporte = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 es TLS directo; 587 negocia STARTTLS
      auth: { user, pass },
    });
  }
  return transporte;
}

async function enviar(a: string, asunto: string, html: string, texto: string): Promise<void> {
  const t = obtenerTransporte();

  if (t) {
    try {
      await t.sendMail({ from: REMITENTE(), to: a, subject: asunto, html, text: texto });
      return;
    } catch (e) {
      // En producción esto tiene que doler: sin correo nadie verifica su
      // cuenta y por tanto nadie puede entrar. El error sube.
      if (process.env.NODE_ENV === "production") throw e;

      // En desarrollo, no. Un SMTP roto — una clave de ejemplo sin sustituir,
      // el clásico — tiene que comportarse igual que un SMTP ausente, o el
      // registro queda bloqueado por algo que en local da lo mismo.
      console.warn(`\n[correo NO enviado: ${e instanceof Error ? e.message : e}]`);
    }
  } else if (process.env.NODE_ENV === "production") {
    // Sin SMTP configurado el registro seguiría funcionando pero el código no
    // llegaría a ninguna parte. En producción es un error que hay que ver.
    throw new Error("No hay SMTP configurado: el correo no se pudo enviar");
  }

  // Respaldo de desarrollo: el código por consola, para poder probar el flujo
  // completo sin depender del correo.
  console.warn(`\n[correo por consola] Para: ${a}\n${asunto}\n${texto}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plantilla
// ─────────────────────────────────────────────────────────────────────────────

const TINTA = "#0f1a17";
const TINTA_2 = "#5a6b65";
const LINEA = "#e8edeb";
const ACENTO = "#12876a";

function envoltura(contenido: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f7f9f8;font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;color:${TINTA};font-size:14px;line-height:1.5;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid ${LINEA};border-radius:12px;padding:28px 26px;">
    <div style="font-size:15px;font-weight:600;letter-spacing:-0.02em;color:${TINTA};margin-bottom:22px;">SalesDash</div>
    ${contenido}
  </div>
  <div style="max-width:440px;margin:14px auto 0;font-size:11.5px;color:#8b9a94;text-align:center;">
    Este correo se envió automáticamente. No hace falta responderlo.
  </div>
</body></html>`;
}

/** Escapa lo que venga del usuario antes de meterlo en el HTML. */
function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Prueba de configuración
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Correo de prueba, el que manda `npm run probar-correo`.
 *
 * El registro ya no usa correo — se entra en el acto —, pero SMTP sigue
 * haciendo falta para las solicitudes de acceso de soporte. Esto existe para
 * comprobar esa configuración sin tener que provocar una solicitud real.
 */
export async function enviarPrueba(email: string): Promise<void> {
  const html = envoltura(`
    <div style="font-size:19px;font-weight:600;letter-spacing:-0.02em;margin-bottom:8px;">El correo funciona</div>
    <div style="color:${TINTA_2};margin-bottom:20px;">
      Si estás leyendo esto, la configuración SMTP de tu SalesDash es correcta y los
      avisos de la plataforma van a llegar a su destino.
    </div>
    <div style="color:${ACENTO};font-size:12.5px;">
      Mensaje de prueba enviado con <code>npm run probar-correo</code>.
    </div>
  `);

  const texto = `El correo funciona

Si estás leyendo esto, la configuración SMTP de tu SalesDash es correcta y los
avisos de la plataforma van a llegar a su destino.

Mensaje de prueba enviado con: npm run probar-correo`;

  await enviar(email, "SalesDash — prueba de correo", html, texto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Solicitud de acceso de soporte
// ─────────────────────────────────────────────────────────────────────────────

export async function enviarSolicitudSoporte(
  email: string,
  datos: { nombreNegocio: string; motivo: string },
): Promise<void> {
  const url = `${process.env.APP_URL ?? ""}/configuracion`;

  const html = envoltura(`
    <div style="font-size:19px;font-weight:600;letter-spacing:-0.02em;margin-bottom:8px;">
      Soporte pide entrar a tu cuenta
    </div>
    <div style="color:${TINTA_2};margin-bottom:16px;">
      Alguien del equipo de SalesDash solicitó acceso temporal a ${esc(datos.nombreNegocio)} para
      resolver un problema. No puede entrar hasta que tú lo apruebes.
    </div>
    <div style="border-left:3px solid ${ACENTO};padding:2px 0 2px 12px;margin-bottom:20px;color:${TINTA};">
      <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:0.1em;color:#8b9a94;margin-bottom:4px;">Motivo</div>
      ${esc(datos.motivo)}
    </div>
    <a href="${esc(url)}" style="display:inline-block;background:${TINTA};color:#ffffff;text-decoration:none;
       padding:10px 18px;border-radius:9px;font-weight:600;font-size:13.5px;">Revisar la solicitud</a>
    <div style="color:${TINTA_2};font-size:12.5px;margin-top:18px;">
      Si la apruebas, el acceso dura 60 minutos y se cierra solo. Queda registrado en tu panel:
      quién entró, cuándo y por qué. Si no la apruebas, no pasa nada.
    </div>
  `);

  const texto = `Soporte pide entrar a tu cuenta

Alguien del equipo de SalesDash solicitó acceso temporal a ${datos.nombreNegocio}.
Motivo: ${datos.motivo}

Revísalo en ${url}

No puede entrar hasta que lo apruebes. El acceso dura 60 minutos y queda registrado en tu panel.`;

  await enviar(email, "Soporte pide entrar a tu cuenta de SalesDash", html, texto);
}
