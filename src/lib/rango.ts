/**
 * SalesDash — el periodo del panel, EN LA HORA DEL PAÍS.
 *
 * «Hoy» no es el mismo día en todas partes. El servidor corre en UTC, y a las
 * ocho de la noche en Santo Domingo —cuando más se vende— en UTC ya es mañana:
 * con el día calculado en la hora del servidor, las ventas de la noche caían
 * en el día siguiente y el panel decía que hoy se cerraron dos cuando fueron
 * cuatro. Un día empieza a las 00:00 de donde está el negocio.
 *
 * Este módulo es puro: no toca la base ni Next. Lo usan `tenant.ts` para leer
 * la URL y `db.ts` para recalcular el periodo de cada número en su propia hora.
 */

/** Cuando ningún país dice la hora, manda la del servidor. */
export function husoDelServidor(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** ¿Este nombre de huso lo entiende el sistema? */
export function husoValido(huso: string | null | undefined): huso is string {
  if (!huso) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: huso });
    return true;
  } catch {
    return false;
  }
}

interface Partes { y: number; m: number; d: number; h: number; mi: number; s: number }

function partesEn(huso: string, ms: number): Partes {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: huso,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const parte of f.formatToParts(new Date(ms))) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** Cuántos milisegundos va el huso por delante de UTC en ese instante. */
export function desfaseMs(huso: string, ms: number = Date.now()): number {
  const p = partesEn(huso, ms);
  const comoUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return comoUTC - Math.floor(ms / 1000) * 1000;
}

/** «2026-09-04»: la fecha de ese instante en el huso. */
export function fechaISOEn(huso: string, epochSegundos: number): string {
  const p = partesEn(huso, epochSegundos * 1000);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${dos(p.m)}-${dos(p.d)}`;
}

/**
 * QUÉ HORA ES ALLÁ, en minutos desde la medianoche: 14:30 son 870.
 *
 * El servidor corre en UTC. Sin esto, un horario de atención de 9:00 a 21:00
 * puesto para Santo Domingo se aplicaba de 9 a 21 UTC —de 5 de la mañana a 5
 * de la tarde allá— y el agente se callaba a media tarde, que es cuando más se
 * vende. Ver `dentroDeHorario` en agent.ts.
 */
export function minutosDelDiaEn(huso: string, ms: number = Date.now()): number {
  const p = partesEn(huso, ms);
  return p.h * 60 + p.mi;
}

/**
 * Las 00:00:00 del día (año, mes, día) EN EL HUSO, como epoch en milisegundos.
 * El desfase se lee en el propio instante para que un cambio de hora no
 * desplace el día: los tres países no lo tienen, pero el cuarto podría.
 */
export function inicioDelDiaEn(huso: string, y: number, m: number, d: number): number {
  const supuesto = Date.UTC(y, m - 1, d);
  const primera = supuesto - desfaseMs(huso, supuesto);
  return primera - (desfaseMs(huso, primera) - desfaseMs(huso, supuesto));
}

/** Las 23:59:59 de ese mismo día, en el huso. */
export function finDelDiaEn(huso: string, y: number, m: number, d: number): number {
  return inicioDelDiaEn(huso, y, m, d + 1) - 1000;
}

export interface Periodo {
  desde: number;
  hasta: number;
  /**
   * La clave con la que se calculó («hoy», «7d»…), si vino de una. Con ella,
   * el periodo se puede volver a calcular en la hora de OTRO país: cada número
   * del panel cuenta su día en su propia hora.
   */
  clave?: string;
}

/** Las claves que entiende la barra lateral. Cualquier otra vale como «7d». */
export const CLAVES_DE_RANGO = ["hoy", "ayer", "7d", "30d", "mes", "mes_pasado", "todo"] as const;

/**
 * De una clave de rango a segundos epoch, con los días contados en el huso.
 *
 * `ahora` se puede fijar para las pruebas: «hoy» tiene que ser un día
 * concreto para poder comprobar que a las 11 de la noche de Santo Domingo
 * sigue siendo hoy.
 */
export function rangoAEpochs(
  clave: string,
  huso: string = husoDelServidor(),
  ahora: number = Date.now(),
): Periodo {
  const zona = husoValido(huso) ? huso : husoDelServidor();
  const hoy = partesEn(zona, ahora);
  const seg = (ms: number) => Math.floor(ms / 1000);
  const inicio = (y: number, m: number, d: number) => seg(inicioDelDiaEn(zona, y, m, d));
  const fin = (y: number, m: number, d: number) => seg(finDelDiaEn(zona, y, m, d));

  switch (clave) {
    case "hoy":
      return { desde: inicio(hoy.y, hoy.m, hoy.d), hasta: fin(hoy.y, hoy.m, hoy.d), clave };
    case "ayer":
      return { desde: inicio(hoy.y, hoy.m, hoy.d - 1), hasta: fin(hoy.y, hoy.m, hoy.d - 1), clave };
    case "7d":
    case "30d": {
      const dias = clave === "7d" ? 6 : 29;
      return { desde: inicio(hoy.y, hoy.m, hoy.d - dias), hasta: fin(hoy.y, hoy.m, hoy.d), clave };
    }
    case "mes":
      return { desde: inicio(hoy.y, hoy.m, 1), hasta: fin(hoy.y, hoy.m, hoy.d), clave };
    case "mes_pasado":
      // El día 0 del mes es el último del anterior: Date.UTC lo entiende así.
      return { desde: inicio(hoy.y, hoy.m - 1, 1), hasta: fin(hoy.y, hoy.m, 0), clave };
    case "todo":
      return { desde: 0, hasta: fin(hoy.y, hoy.m, hoy.d), clave };
    default:
      return rangoAEpochs("7d", zona, ahora);
  }
}

/**
 * El mismo periodo, contado en la hora de otro país. Solo se puede si vino de
 * una clave; unas fechas exactas del calendario se respetan tal cual.
 */
export function periodoEnHuso(p: Periodo, huso: string, ahora: number = Date.now()): Periodo {
  if (!p.clave) return p;
  return rangoAEpochs(p.clave, huso, ahora);
}

const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * QUÉ DÍA DE LA SEMANA ES ALLÁ, en ISO (1 = lunes … 7 = domingo).
 *
 * Lo usa el motor de difusiones (`src/lib/difusion.ts`) para saber si hoy
 * cae dentro de los días que eligió la dueña («lunes a viernes») EN LA HORA
 * DEL DESTINATARIO: a las 11 de la noche del domingo en Santo Domingo, en UTC
 * ya puede ser lunes, y contar el día por el reloj del servidor mandaría un
 * mensaje de domingo un lunes que allá todavía no empezó.
 */
export function diaDeLaSemanaEn(huso: string, ms: number = Date.now()): number {
  const nombre = new Intl.DateTimeFormat("en-US", { timeZone: huso, weekday: "short" }).format(new Date(ms));
  return DIA_ISO[nombre] ?? 1;
}
