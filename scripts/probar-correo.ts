/**
 * Comprueba que el correo saliente funciona, sin pasar por la aplicación.
 *
 *   npm run probar-correo -- tu@correo.com
 *
 * Manda el mismo correo de verificación que recibe un usuario al registrarse,
 * con un código de mentira. Si esto llega, el registro funciona; si falla,
 * el error sale aquí completo en vez de esconderse en los registros del
 * servidor.
 */
import "./env-loader";
import { enviarCodigoVerificacion } from "../src/lib/mail";

const destino = process.argv[2];

if (!destino || !destino.includes("@")) {
  console.error("Uso: npm run probar-correo -- tu@correo.com");
  process.exit(1);
}

const host = process.env.SMTP_HOST;
const usuario = process.env.SMTP_USER;
const clave = process.env.SMTP_PASS;
const remitente = process.env.MAIL_FROM;

console.log("Configuración detectada:");
console.log(`  SMTP_HOST  ${host ?? "(sin configurar)"}`);
console.log(`  SMTP_PORT  ${process.env.SMTP_PORT ?? "587 (por defecto)"}`);
console.log(`  SMTP_USER  ${usuario ?? "(sin configurar)"}`);
console.log(`  SMTP_PASS  ${clave ? `${clave.slice(0, 4)}… (${clave.length} caracteres)` : "(sin configurar)"}`);
console.log(`  MAIL_FROM  ${remitente ?? "(sin configurar)"}`);
console.log();

if (!host || !usuario || !clave) {
  console.error(
    "Falta configuración SMTP. En desarrollo el código se imprime en la consola,\n" +
      "pero en producción sin SMTP nadie puede verificar su cuenta y por tanto\n" +
      "nadie puede entrar.",
  );
  process.exit(1);
}

// Aviso concreto para el caso más común al empezar con Resend.
if (remitente?.includes("resend.dev")) {
  console.log(
    "Aviso: el dominio resend.dev solo puede enviar a la dirección de tu propia\n" +
      "cuenta de Resend. Para escribir a tus usuarios necesitas verificar un dominio.\n",
  );
}

enviarCodigoVerificacion(destino, "Prueba", "123456")
  .then(() => {
    console.log(`Enviado a ${destino}. Revisa la bandeja y también el correo no deseado.`);
  })
  .catch((e: unknown) => {
    console.error("\nNo se pudo enviar:\n");
    console.error(e);
    console.error(
      "\nCausas habituales:\n" +
        "  - SMTP_PASS no es la clave de API de Resend (empieza por re_)\n" +
        "  - SMTP_USER debe ser exactamente 'resend', no tu correo\n" +
        "  - MAIL_FROM usa un dominio que no está verificado en Resend\n" +
        "  - El destinatario no es el de tu cuenta y estás usando resend.dev",
    );
    process.exit(1);
  });
