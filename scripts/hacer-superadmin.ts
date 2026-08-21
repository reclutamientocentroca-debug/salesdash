/**
 * Marca una cuenta como superadmin de la plataforma.
 *
 *   npm run superadmin -- tu@correo.com
 *   npm run superadmin -- tu@correo.com --quitar
 *   npm run superadmin                      (lista quién lo tiene)
 *
 * El panel /admin exige `superadmin = 1` y no se puede conceder desde la
 * interfaz: quien lo tiene ve todas las organizaciones, así que el primer
 * superadmin se marca aquí a propósito. Que no exista un botón es la
 * salvaguarda, no un olvido.
 *
 * Es también la operación que el Dockerfile anticipa al instalar sqlite3 en la
 * imagen. Con esto ya no hace falta escribir SQL a mano dentro del contenedor:
 *
 *   docker exec -it <contenedor> npm run superadmin -- tu@correo.com
 */
import "./env-loader";
import { buscarUsuarioPorEmail, marcarSuperadmin, db } from "../src/lib/db";

const correo = process.argv[2];
const quitar = process.argv.includes("--quitar");

function listar(): void {
  const filas = db
    .prepare(
      `SELECT u.email, u.nombre, o.nombre AS org
         FROM users u JOIN orgs o ON o.id = u.org_id
        WHERE u.superadmin = 1
        ORDER BY u.id`,
    )
    .all() as { email: string; nombre: string; org: string }[];

  if (filas.length === 0) {
    console.log("No hay ningún superadmin. El panel /admin está fuera del alcance de todos.");
    return;
  }

  console.log(`Superadmin${filas.length > 1 ? "es" : ""} de la plataforma:`);
  for (const f of filas) console.log(`  ${f.email}  —  ${f.nombre} (${f.org})`);
}

if (!correo) {
  listar();
  console.log("\nUso: npm run superadmin -- tu@correo.com [--quitar]");
  process.exit(0);
}

const usuario = buscarUsuarioPorEmail(correo);

if (!usuario) {
  console.error(`No existe ninguna cuenta con el correo ${correo}.`);
  console.error("Regístrate primero en /registro, o usa la cuenta de ejemplo de `npm run seed`.");
  process.exit(1);
}

marcarSuperadmin(usuario.id, !quitar);

if (quitar) {
  console.log(`${usuario.email} ya no es superadmin.`);
} else {
  console.log(`${usuario.email} (${usuario.nombre}) es superadmin de la plataforma.`);

  // Sin verificar no puede iniciar sesión, y entonces el permiso no sirve de
  // nada: más vale decirlo ahora que dejar que lo descubra en el login.
  if (usuario.verificado !== 1) {
    console.log(
      "\nAviso: esta cuenta está SIN VERIFICAR, así que todavía no puede entrar.\n" +
        "Verifícala con el código de /verificar antes de usar el panel.",
    );
  }

  console.log("\nEl panel de plataforma está en /admin.");
}
