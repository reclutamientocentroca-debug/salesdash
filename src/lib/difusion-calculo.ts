/**
 * SalesDash — el reparto de una campaña de difusión, puro.
 *
 * Sin base ni IA: solo aritmética, para que el formulario de «Nueva campaña»
 * pueda enseñar «se reparte en X días, termina el [fecha]» ANTES de guardar
 * nada, y para que `difusion.ts` calcule lo mismo del lado del motor. Vive
 * aparte para que la UI (cliente, sin acceso a la base) lo pueda importar.
 */

export interface Reparto {
  diasNecesarios: number;
  /** «2026-10-03», en el calendario de quien mira, sin huso: es una cuenta de días, no una hora exacta. */
  fechaEstimadaFin: string;
}

/**
 * Cuántos días de la semana elegida hay entre hoy y dentro de `diasNecesarios`
 * días, contando desde el día 0. `diasSemana` en ISO (1 lunes … 7 domingo).
 */
function diasHabilesHastaCubrir(pendientes: number, porDia: number, diasSemana: number[]): number {
  if (pendientes <= 0) return 0;
  if (porDia <= 0 || diasSemana.length === 0) return Infinity;

  let quedan = pendientes;
  let dia = 0;
  const hoyIso = ((new Date().getUTCDay() + 6) % 7) + 1; // 1=lunes..7=domingo

  // Tope de seguridad: con menos de un envío por semana esto podría no
  // terminar nunca en la práctica; 10 años de días es más que suficiente
  // para decir «esto no es razonable» sin colgar el cálculo.
  const TOPE_DIAS = 365 * 10;

  while (quedan > 0 && dia < TOPE_DIAS) {
    const isoDeEsteDia = ((hoyIso - 1 + dia) % 7) + 1;
    if (diasSemana.includes(isoDeEsteDia)) quedan -= porDia;
    dia++;
  }
  return quedan > 0 ? Infinity : dia;
}

/** «Se reparte en X días, termina el [fecha]». `diasSemana` en ISO (1 lunes … 7 domingo). */
export function calcularReparto(
  totalClientes: number, mensajesPorDia: number, diasSemana: number[],
): Reparto {
  const dias = diasHabilesHastaCubrir(totalClientes, mensajesPorDia, diasSemana);
  if (dias <= 0 || !Number.isFinite(dias)) return { diasNecesarios: 0, fechaEstimadaFin: "" };

  const fin = new Date();
  fin.setUTCDate(fin.getUTCDate() + (dias - 1));
  return { diasNecesarios: dias, fechaEstimadaFin: fin.toISOString().slice(0, 10) };
}
