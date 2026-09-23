/**
 * Verificación real contra un producto de verdad de Roplis.
 *
 * No corre con `npm test` —abre un navegador y pega contra internet, como
 * `real-vision.ts` y `real-ia.ts`—. Comprueba que `importarProductoDeLink`
 * saca las mismas tallas por color que se vieron a mano en el navegador
 * (2026-09-23): Azul y Gris con las cuatro tallas, Negro sin XL, y una
 * cuarta variante de negro con solo XL.
 */
import "../scripts/env-loader";
import assert from "node:assert/strict";
import { importarProductoDeLink } from "../src/lib/importar-producto";

const URL_PRODUCTO =
  "https://do.roplis.com/kcd3906-l-azul/poloshirt-de-cuello-keneth-cole?source=inventory&color=azul&size=l";

async function main() {
  const r = await importarProductoDeLink(1, URL_PRODUCTO);
  console.log(JSON.stringify(r, null, 2));

  assert.ok(r.nombre?.toLowerCase().includes("poloshirt"), "el nombre tiene que venir del <h1> real");
  assert.ok(r.precio && r.precio > 1000, "el precio tiene que ser el de verdad, no un placeholder");
  assert.ok(r.datos.colores.length >= 4, "el polo real trae cuatro variantes de color");

  const porColor = new Map(r.datos.colores.map((c) => [c.color.toLowerCase(), c.tallas.map((t) => t.toLowerCase())]));

  assert.ok(porColor.get("azul")?.includes("xl"), "azul trae XL");
  assert.ok(porColor.get("gris")?.includes("xl"), "gris trae XL");
  assert.ok(porColor.get("negro") && !porColor.get("negro")!.includes("xl"), "negro NO trae XL");

  console.log("\nOK — coincide con lo comprobado a mano en el navegador.");
}

main().catch((e) => {
  console.error("FALLÓ:", e);
  process.exit(1);
});
