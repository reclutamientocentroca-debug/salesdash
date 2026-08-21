"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  IconoAdmin,
  IconoAgente,
  IconoConfiguracion,
  IconoConversaciones,
  IconoDashboard,
  IconoEquipo,
  IconoNumeros,
  IconoProductos,
  IconoRevision,
  IconoSalir,
  IconoVentas,
} from "./Iconos";

const MENU = [
  { href: "/dashboard", texto: "Dashboard", Icono: IconoDashboard },
  { href: "/numeros", texto: "Números", Icono: IconoNumeros },
  { href: "/conversaciones", texto: "Conversaciones", Icono: IconoConversaciones },
  { href: "/revision", texto: "Revisión", Icono: IconoRevision },
  { href: "/agente", texto: "Agente de IA", Icono: IconoAgente },
  { href: "/ventas", texto: "Ventas", Icono: IconoVentas },
  { href: "/productos", texto: "Productos", Icono: IconoProductos },
  { href: "/equipo", texto: "Equipo", Icono: IconoEquipo },
  { href: "/configuracion", texto: "Configuración", Icono: IconoConfiguracion },
];

const RANGOS = [
  { clave: "hoy", texto: "Hoy" },
  { clave: "ayer", texto: "Ayer" },
  { clave: "7d", texto: "Últimos 7 días" },
  { clave: "30d", texto: "Últimos 30 días" },
  { clave: "mes", texto: "Este mes" },
  { clave: "mes_pasado", texto: "Mes pasado" },
  { clave: "todo", texto: "Todo" },
];

interface Props {
  negocio: string;
  usuario: { nombre: string; email: string };
  superadmin: boolean;
  pendientesRevision: number;
}

export default function BarraLateral({ negocio, usuario, superadmin, pendientesRevision }: Props) {
  const ruta = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const rangoActual = params.get("rango") ?? "7d";

  async function salir() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function cambiarRango(clave: string) {
    const nuevos = new URLSearchParams(params.toString());
    nuevos.set("rango", clave);
    router.push(`${ruta}?${nuevos.toString()}`);
  }

  return (
    <nav className="sd-lateral" aria-label="Menú principal">
      <div className="sd-lateral-cuerpo">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div
            style={{
              width: 34, height: 34, borderRadius: 9, background: "var(--acc)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 600, fontSize: 15, flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {negocio.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {negocio}
            </div>
            <div className="tenue">SalesDash</div>
          </div>
        </div>

        <ul className="sd-menu">
          {MENU.map(({ href, texto, Icono }) => {
            const activo = ruta === href || ruta.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={`${href}?rango=${rangoActual}`}
                  className={`sd-enlace${activo ? " sd-enlace-activo" : ""}`}
                  aria-current={activo ? "page" : undefined}
                >
                  <Icono />
                  <span>{texto}</span>
                  {href === "/revision" && pendientesRevision > 0 && (
                    <span className="sd-contador num">{pendientesRevision}</span>
                  )}
                </Link>
              </li>
            );
          })}

          {superadmin && (
            <li>
              <Link href="/admin" className="sd-enlace">
                <IconoAdmin />
                <span>Plataforma</span>
              </Link>
            </li>
          )}
        </ul>

        <div className="rotulo" style={{ margin: "22px 0 8px" }}>
          Rango de fechas
        </div>
        <ul className="sd-menu">
          {RANGOS.map((r) => (
            <li key={r.clave}>
              <button
                type="button"
                onClick={() => cambiarRango(r.clave)}
                className={`sd-enlace sd-rango${rangoActual === r.clave ? " sd-enlace-activo" : ""}`}
              >
                {r.texto}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sd-lateral-pie">
        <div
          style={{
            width: 28, height: 28, borderRadius: "50%", background: "var(--soft)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 600, color: "var(--ink-2)", flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {usuario.nombre.charAt(0).toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {usuario.nombre}
          </div>
          <div className="tenue" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {usuario.email}
          </div>
        </div>
        <button type="button" onClick={salir} className="sd-salir" aria-label="Salir de la cuenta" title="Salir">
          <IconoSalir />
        </button>
      </div>
    </nav>
  );
}
