/** Recorre el panel entero con una sesión real y verifica que todo responde. */
import "../scripts/env-loader";

const BASE = "http://localhost:3111";

const PAGINAS = [
  "/dashboard",
  "/numeros",
  "/conversaciones",
  "/revision",
  "/agente",
  "/ventas",
  "/productos",
  "/equipo",
  "/configuracion",
];

const APIS = ["/api/metrics", "/api/conversations", "/api/agente", "/api/catalogo", "/api/org", "/api/soporte"];

async function esperarServidor() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return true;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (!(await esperarServidor())) {
    console.error("El servidor no respondió.");
    process.exit(1);
  }

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@salesdash.app", password: "demo1234" }),
  });

  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  console.log(`login: ${login.status} ${cookie ? "con cookie" : "SIN COOKIE"}\n`);

  console.log("PÁGINAS");
  for (const ruta of PAGINAS) {
    const r = await fetch(`${BASE}${ruta}`, { headers: { cookie }, redirect: "manual" });
    const html = r.status === 200 ? await r.text() : "";
    const marca = html.includes("SalesDash") || html.includes("sd-marco");
    console.log(`  ${String(r.status).padEnd(4)} ${ruta.padEnd(20)} ${marca ? "renderizada" : ""}`);
  }

  console.log("\nAPIS");
  for (const ruta of APIS) {
    const r = await fetch(`${BASE}${ruta}`, { headers: { cookie } });
    const cuerpo = await r.text();
    console.log(`  ${String(r.status).padEnd(4)} ${ruta.padEnd(22)} ${cuerpo.slice(0, 60).replace(/\s+/g, " ")}`);
  }

  console.log("\nSIN SESIÓN (deben redirigir o dar 401)");
  for (const ruta of ["/dashboard", "/admin", "/api/metrics", "/api/canales"]) {
    const r = await fetch(`${BASE}${ruta}`, { redirect: "manual" });
    console.log(`  ${String(r.status).padEnd(4)} ${ruta.padEnd(20)} → ${r.headers.get("location") ?? "sin redirección"}`);
  }

  console.log("\nCONSOLA DE PLATAFORMA con sesión de cliente (no superadmin)");
  for (const ruta of ["/admin", "/api/admin/orgs", "/api/admin/resumen"]) {
    const r = await fetch(`${BASE}${ruta}`, { headers: { cookie }, redirect: "manual" });
    console.log(`  ${String(r.status).padEnd(4)} ${ruta.padEnd(22)} → ${r.headers.get("location") ?? "sin redirección"}`);
  }

  const metricas = await (await fetch(`${BASE}/api/metrics?rango=30d`, { headers: { cookie } })).json();
  console.log("\nMÉTRICAS (30 días)");
  console.log(
    `  leads ${metricas.leads} = ia ${metricas.cierres_ia} + humano ${metricas.cierres_humano} + abiertas ${metricas.sin_cerrar} + revisión ${metricas.revision}`,
  );
  console.log(`  invariante cuadra: ${metricas.cuadra}`);
  console.log(`  ventas ${metricas.ventas_generadas} · promedio ${metricas.valor_promedio_venta}`);
  console.log(`  cobertura IA ${metricas.cobertura_ia.valor}% (${metricas.cobertura_ia.estado})`);
  console.log(`  top: ${metricas.top_productos.map((p: { producto: string; unidades: number }) => `${p.producto} ×${p.unidades}`).join(", ")}`);
}

main();
