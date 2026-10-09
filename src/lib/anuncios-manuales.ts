import { listarAnunciosManuales, type AnuncioManual } from "./db";

/**
 * ¿ALGUNO DE LOS ANUNCIOS ESCRITOS A MANO ES EL QUE TRAJO A ESTE CLIENTE?
 * (la dueña, Costa Rica, 2026-10-09)
 *
 * WhatsApp manda el título y el cuerpo del anuncio; el texto que la tienda
 * puso en el panel es el mismo, a veces recortado o con otro salto de línea.
 * Coinciden si uno contiene al otro, o si comparten la mayoría de sus palabras.
 */
const norm = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export function textosCoinciden(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x.length < 8 || y.length < 8) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const A = new Set(x.split(" ").filter((w) => w.length > 2));
  const B = new Set(y.split(" ").filter((w) => w.length > 2));
  if (A.size < 4 || B.size < 4) return false;
  let comunes = 0;
  for (const w of A) if (B.has(w)) comunes++;
  return comunes / Math.min(A.size, B.size) >= 0.7;
}

export function anuncioManualQueCoincide(
  orgId: number,
  canalId: number,
  textos: (string | null | undefined)[],
): AnuncioManual | null {
  const dichos = textos.map((t) => t?.trim() ?? "").filter(Boolean);
  if (!dichos.length) return null;
  return (
    listarAnunciosManuales(orgId).find(
      (m) => (m.canal_id === 0 || m.canal_id === canalId) && dichos.some((t) => textosCoinciden(m.descripcion, t)),
    ) ?? null
  );
}
