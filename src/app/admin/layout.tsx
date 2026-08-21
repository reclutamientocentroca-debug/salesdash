import Link from "next/link";
import { requerirSuperadmin } from "@/lib/tenant";

export const metadata = { title: "Plataforma · SalesDash" };
export const dynamic = "force-dynamic";

/**
 * La consola de plataforma no se parece al panel de cliente: barra oscura
 * arriba en vez de lateral clara. Es a propósito — nunca debe haber duda de
 * dónde estás parado.
 */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const ctx = await requerirSuperadmin();

  return (
    <div style={{ minHeight: "100vh", background: "var(--page)" }}>
      <header className="sd-admin-barra">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,.14)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600,
            }}
            aria-hidden="true"
          >
            S
          </div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>SalesDash · Plataforma</span>
        </div>

        <nav style={{ display: "flex", gap: 4 }}>
          <Link href="/admin" className="sd-admin-enlace">Resumen</Link>
          <Link href="/admin/salud" className="sd-admin-enlace">Salud técnica</Link>
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12.5, color: "#9db3ac" }}>{ctx.usuario.email}</span>
          <Link href="/dashboard" className="sd-admin-enlace">Ir a mi panel</Link>
        </div>
      </header>

      <main style={{ padding: "22px 24px 40px" }}>{children}</main>
    </div>
  );
}
