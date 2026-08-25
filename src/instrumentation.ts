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

  /*
   * El barrido de ventas NO se espera aquí.
   *
   * `register()` corre ANTES de que el servidor atienda la primera petición, y
   * lo que se ponga dentro retrasa el momento en que el panel empieza a
   * responder. El barrido recorre los mensajes de todos los hilos sin cerrar:
   * en una base con meses de conversaciones eso son segundos de reloj con el
   * proceso ocupado y nadie contestando, justo cuando la plataforma comprueba
   * si el contenedor está vivo. Un despliegue que tarda en responder se
   * reinicia solo, y vuelta a empezar.
   *
   * Se lanza sin esperarlo, un segundo después: el panel abre de inmediato y
   * las ventas viejas quedan selladas enseguida, sin que nadie note la
   * diferencia. Sellar tarde es un inconveniente; no arrancar es una avería.
   */
  setTimeout(() => {
    void (async () => {
      try {
        const { barrerCierresPendientes } = await import("@/lib/cierre");
        const selladas = barrerCierresPendientes();
        if (selladas > 0) {
          console.log(`[arranque] ${selladas} venta(s) con resumen de pedido que estaban sin contar`);
        }
      } catch (e) {
        console.error("[arranque] no se pudo barrer los cierres pendientes", e);
      }
    })();
  }, 1_000);

  try {
    const { rehidratar } = await import("@/lib/wa");
    await rehidratar();
  } catch (e) {
    // Que no arranquen las sesiones no puede impedir que el panel se levante:
    // el usuario tiene que poder entrar y ver qué pasa.
    console.error("[arranque] no se pudieron reabrir las sesiones de WhatsApp", e);
  }
}
