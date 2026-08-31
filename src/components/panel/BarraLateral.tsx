"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconoMarca } from "@/components/IconoMarca";
import {
  IconoAdmin,
  IconoAgente,
  IconoConfiguracion,
  IconoConversaciones,
  IconoDashboard,
  IconoEquipo,
  IconoMessenger,
  IconoNumeros,
  IconoProductos,
  IconoRevision,
  IconoSalir,
  IconoVentas,
} from "./Iconos";

const MENU = [
  { href: "/dashboard", texto: "Dashboard", Icono: IconoDashboard },
  { href: "/numeros", texto: "Números", Icono: IconoNumeros },
  { href: "/canales/meta", texto: "Messenger", Icono: IconoMessenger },
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

/*
 * El calendario habla en días; la URL, en segundos.
 *
 * La conversión se hace con `new Date(año, mes, día)` —hora local— y no
 * interpretando la cadena «2026-03-04», que se lee como UTC y en media América
 * corre el periodo un día entero. «Desde» empieza a las 00:00 y «hasta»
 * termina a las 23:59:59, igual que los rangos con nombre: un día elegido en
 * el calendario es el día completo, no el instante en que se pulsó.
 */
function aSegundos(iso: string, finDelDia: boolean): number | null {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return null;
  const fecha = finDelDia ? new Date(a, m - 1, d, 23, 59, 59) : new Date(a, m - 1, d);
  return Math.floor(fecha.getTime() / 1000);
}

function aIso(segundos: string | null): string {
  if (!segundos) return "";
  const n = Number(segundos);
  if (!Number.isFinite(n) || n <= 0) return "";
  const f = new Date(n * 1000);
  const dos = (x: number) => String(x).padStart(2, "0");
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

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

  const desdeParam = params.get("desde");
  const hastaParam = params.get("hasta");
  const personalizado = Boolean(desdeParam && hastaParam);

  /*
   * El menú navega con el periodo puesto. Si hay fechas elegidas viajan con
   * cada enlace: perderlas al cambiar de página devolvería al usuario a
   * «últimos 7 días» sin decírselo.
   */
  const consulta = (() => {
    const p = new URLSearchParams();
    p.set("rango", rangoActual);
    if (personalizado) {
      p.set("desde", desdeParam!);
      p.set("hasta", hastaParam!);
    }
    return p.toString();
  })();

  async function salir() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function cambiarRango(clave: string) {
    const nuevos = new URLSearchParams(params.toString());
    nuevos.set("rango", clave);
    // Un rango con nombre manda: las fechas del calendario se retiran.
    nuevos.delete("desde");
    nuevos.delete("hasta");
    router.push(`${ruta}?${nuevos.toString()}`);
  }

  function aplicarFechas(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    const uno = String(datos.get("desde") ?? "");
    const otro = String(datos.get("hasta") ?? "");
    if (!uno || !otro) return;

    // Elegidas al revés, se ordenan solas en vez de no enseñar nada.
    const [ini, fin] = uno <= otro ? [uno, otro] : [otro, uno];
    const desde = aSegundos(ini, false);
    const hasta = aSegundos(fin, true);
    if (desde === null || hasta === null) return;

    const nuevos = new URLSearchParams(params.toString());
    nuevos.set("rango", "personalizado");
    nuevos.set("desde", String(desde));
    nuevos.set("hasta", String(hasta));
    router.push(`${ruta}?${nuevos.toString()}`);
  }

  return (
    <nav className="sd-lateral" aria-label="Menú principal">
      <div className="sd-lateral-cuerpo">
        {/* Dos filas, y separadas a propósito: arriba el producto, abajo la
            cuenta. Antes iban mezcladas y "SalesDash" quedaba como un
            subtítulo del nombre del negocio, que es justo lo contrario de lo
            que es. El azulejo es el mismo del icono de pestaña: la aplicación
            se reconoce igual por dentro que en el navegador. */}
        <div className="sd-marca">
          <IconoMarca tamano={28} id="lateral" />
          <span className="marca-texto" style={{ fontSize: 16 }}>
            Sales<span className="marca-degradado">Dash</span>
          </span>
        </div>

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
            <div className="tenue">Tu cuenta</div>
          </div>
        </div>

        <ul className="sd-menu">
          {MENU.map(({ href, texto, Icono }) => {
            const activo = ruta === href || ruta.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={`${href}?${consulta}`}
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
                className={`sd-enlace sd-rango${!personalizado && rangoActual === r.clave ? " sd-enlace-activo" : ""}`}
              >
                {r.texto}
              </button>
            </li>
          ))}
        </ul>

        {/*
          El calendario, debajo de los atajos y no en lugar de ellos.

          Los rangos con nombre resuelven casi todo con un clic, pero «del 3 al
          17» no está en esa lista y hasta ahora solo se podía pedir escribiendo
          segundos en la URL a mano. Son dos campos de fecha nativos: el
          calendario lo pone el navegador, que es el que el usuario ya sabe usar
          en su teléfono y en su ordenador.

          El `key` es lo que mantiene los campos pegados a la URL: al pulsar un
          rango con nombre —que borra las fechas— React los vuelve a montar
          vacíos, en vez de dejar a la vista un periodo que ya no se aplica.
        */}
        <form
          className="sd-fechas"
          key={`${desdeParam ?? ""}:${hastaParam ?? ""}`}
          onSubmit={aplicarFechas}
        >
          <label>
            <span>Desde</span>
            <input
              type="date"
              name="desde"
              className="campo sd-campo-fecha"
              defaultValue={aIso(desdeParam)}
              required
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="date"
              name="hasta"
              className="campo sd-campo-fecha"
              defaultValue={aIso(hastaParam)}
              required
            />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="submit" className="btn btn-secundario sd-btn-fecha">
              Aplicar
            </button>
            {personalizado && (
              <button type="button" onClick={() => cambiarRango("7d")} className="sd-quitar-fechas">
                Quitar
              </button>
            )}
          </div>
        </form>
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
