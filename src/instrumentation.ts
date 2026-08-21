/**
 * Arranque del servidor.
 *
 * Next llama a `register()` una vez, antes de atender la primera petición. Es
 * el único sitio donde se puede reabrir las sesiones de WhatsApp: sin esto,
 * tras cada despliegue los números quedarían caídos hasta que alguien abriera
 * su pantalla en el panel — y mientras tanto no entraría ni un mensaje.
 *
 * El import es dinámico y va dentro del `if`: `wa.ts` arrastra Baileys entero,
 * y no tiene por qué cargarse en el tiempo de ejecución del navegador ni en el
 * de las funciones de borde.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // En `next build` también corre este archivo: reconectar durante la
  // compilación abriría sesiones en una máquina que no es la que sirve.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { rehidratar } = await import("@/lib/wa");
    await rehidratar();
  } catch (e) {
    // Que no arranquen las sesiones no puede impedir que el panel se levante:
    // el usuario tiene que poder entrar y ver qué pasa.
    console.error("[arranque] no se pudieron reabrir las sesiones de WhatsApp", e);
  }
}
