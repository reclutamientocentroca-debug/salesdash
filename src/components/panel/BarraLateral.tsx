"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconoMarca } from "@/components/IconoMarca";
import {
  IconoAdmin,
  IconoAgente,
  IconoChevron,
  IconoConfiguracion,
  IconoConversaciones,
  IconoDashboard,
  IconoDifusiones,
  IconoEquipo,
  IconoInstagram,
  IconoLuna,
  IconoMessenger,
  IconoNumeros,
  IconoProductos,
  IconoRevision,
  IconoSalir,
  IconoSol,
  IconoVentas,
} from "./Iconos";

/*
 * El menú, en tres grupos: lo que se mira a diario, lo del negocio y lo que se
 * configura una vez. Un menú de diez entradas seguidas obliga a leerlas todas;
 * con los rótulos, el ojo va al grupo y luego a la entrada.
 */
const SECCIONES = [
  {
    titulo: "Operación",
    items: [
      { href: "/dashboard", texto: "Resumen", Icono: IconoDashboard },
      { href: "/conversaciones", texto: "Conversaciones", Icono: IconoConversaciones },
      { href: "/canales/meta", texto: "Messenger", Icono: IconoMessenger },
      { href: "/canales/instagram", texto: "Instagram", Icono: IconoInstagram },
      { href: "/revision", texto: "Revisión", Icono: IconoRevision },
    ],
  },
  {
    titulo: "Negocio",
    items: [
      { href: "/ventas", texto: "Ventas", Icono: IconoVentas },
      { href: "/productos", texto: "Productos", Icono: IconoProductos },
      { href: "/difusiones", texto: "Difusiones", Icono: IconoDifusiones },
    ],
  },
  {
    titulo: "Configuración",
    items: [
      { href: "/numeros", texto: "Números", Icono: IconoNumeros },
      { href: "/agente", texto: "Agente de IA", Icono: IconoAgente },
      { href: "/equipo", texto: "Equipo", Icono: IconoEquipo },
      { href: "/configuracion", texto: "Ajustes", Icono: IconoConfiguracion },
    ],
  },
];

type Tema = "oscuro" | "claro";

interface Props {
  negocio: string;
  /** En cuántos países vende la cuenta, por los números conectados. */
  paises: number;
  usuario: { nombre: string; email: string };
  superadmin: boolean;
  pendientesRevision: number;
}

export default function BarraLateral({ negocio, paises, usuario, superadmin, pendientesRevision }: Props) {
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

  /*
   * El tema vive en el marco (`data-tema`) y se recuerda en el navegador. El
   * marco ya llega pintado desde el servidor y un script lo ajusta antes de
   * que React arranque, así que aquí solo se lee lo que ya hay.
   */
  const [tema, setTema] = useState<Tema>("oscuro");
  useEffect(() => {
    const marco = document.querySelector<HTMLElement>(".sd-marco");
    setTema(marco?.dataset.tema === "claro" ? "claro" : "oscuro");
  }, []);

  function cambiarTema() {
    const nuevo: Tema = tema === "oscuro" ? "claro" : "oscuro";
    const marco = document.querySelector<HTMLElement>(".sd-marco");
    if (marco) marco.dataset.tema = nuevo;
    try {
      localStorage.setItem("sd-tema", nuevo);
    } catch {
      // Sin almacenamiento el tema dura lo que dure la página. No pasa nada.
    }
    setTema(nuevo);
  }

  async function salir() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="sd-lateral" aria-label="Menú principal">
      <div className="sd-lateral-cuerpo">
        {/* Arriba el producto, debajo la cuenta. El azulejo es el mismo del
            icono de pestaña: la aplicación se reconoce igual por dentro que
            en el navegador. */}
        <div className="sd-marca">
          <IconoMarca tamano={28} id="lateral" />
          <span className="marca-texto" style={{ fontSize: 16 }}>
            Sales<span className="marca-degradado">Dash</span>
          </span>
          <span className="sd-beta">Beta</span>
        </div>

        <Link href={`/configuracion?${consulta}`} className="sd-org" title="Ajustes de la cuenta">
          <span className="sd-org-inicial" aria-hidden="true">
            {negocio.charAt(0).toUpperCase()}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="sd-org-nombre">{negocio}</span>
            <span className="tenue" style={{ display: "block" }}>
              {paises > 0 ? `${paises} país${paises === 1 ? "" : "es"}` : "Tu cuenta"}
            </span>
          </span>
          <IconoChevron tam={14} />
        </Link>

        {SECCIONES.map((seccion) => (
          <div key={seccion.titulo} className="sd-seccion">
            <div className="rotulo sd-seccion-titulo">{seccion.titulo}</div>
            <ul className="sd-menu">
              {seccion.items.map(({ href, texto, Icono }) => {
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
              {seccion.titulo === "Configuración" && superadmin && (
                <li>
                  <Link href="/admin" className="sd-enlace">
                    <IconoAdmin />
                    <span>Plataforma</span>
                  </Link>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="sd-lateral-pie">
        <div className="sd-usuario-inicial" aria-hidden="true">
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
        <button
          type="button"
          onClick={cambiarTema}
          className="sd-tema-boton"
          aria-label={tema === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
          title={tema === "oscuro" ? "Tema claro" : "Tema oscuro"}
        >
          {tema === "oscuro" ? <IconoSol tam={15} /> : <IconoLuna tam={15} />}
        </button>
        <button type="button" onClick={salir} className="sd-salir" aria-label="Salir de la cuenta" title="Salir">
          <IconoSalir />
        </button>
      </div>
    </nav>
  );
}
