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

  /*
   * El reloj de los seguimientos.
   *
   * Cada diez minutos se mira quién se quedó en visto y a qué pedido le toca el
   * aviso de que va en camino. Diez minutos y no uno porque nada de esto es
   * urgente al minuto —el recordatorio sale «a las tres horas», no a las tres
   * horas y cero segundos— y cada vuelta abre la base para todas las cuentas
   * con agente encendido.
   *
   * `unref()` es lo que deja que el proceso termine cuando la plataforma lo
   * pare: un temporizador sin soltar mantiene a Node vivo y convierte cada
   * despliegue en una espera hasta que alguien lo mata a la fuerza.
   *
   * No se espera aquí, por lo mismo que el barrido de cierres: `register()`
   * corre antes de la primera petición y lo que se ponga dentro retrasa el
   * momento en que el panel contesta.
   */
  const reloj = setInterval(
    () => {
      void (async () => {
        try {
          const { barrerSeguimientos } = await import("@/lib/seguimiento");
          await barrerSeguimientos();
        } catch (e) {
          console.error("[arranque] falló el barrido de seguimientos", e);
        }
      })();
    },
    10 * 60 * 1000,
  );
  reloj.unref?.();

  try {
    const { rehidratar } = await import("@/lib/wa");
    await rehidratar();
  } catch (e) {
    // Que no arranquen las sesiones no puede impedir que el panel se levante:
    // el usuario tiene que poder entrar y ver qué pasa.
    console.error("[arranque] no se pudieron reabrir las sesiones de WhatsApp", e);
  }
}
