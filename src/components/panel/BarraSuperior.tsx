"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconoBuscar } from "./Iconos";

/**
 * LA BARRA DE ARRIBA: qué pantalla es, qué periodo se está mirando, el
 * buscador y los rangos de fechas.
 *
 * El periodo vive aquí y no en la barra lateral porque es lo que cambia veinte
 * veces al día: se mira «hoy», luego «7 días», luego «hoy» otra vez. La barra
 * lateral es para ir a otro sitio; esta es para mirar lo mismo de otra forma.
 */

const TITULOS: [string, string][] = [
  ["/dashboard", "Resumen"],
  ["/conversaciones/", "Conversación"],
  ["/conversaciones", "Conversaciones"],
  ["/canales/meta", "Messenger"],
  ["/canales", "Canales"],
  ["/revision", "Revisión"],
  ["/ventas", "Ventas"],
  ["/productos", "Productos"],
  ["/numeros", "Números"],
  ["/agente", "Agente de IA"],
  ["/equipo", "Equipo"],
  ["/configuracion", "Ajustes"],
];

const RANGOS = [
  { clave: "hoy", texto: "Hoy", largo: "hoy" },
  { clave: "ayer", texto: "Ayer", largo: "ayer" },
  { clave: "7d", texto: "7 días", largo: "últimos 7 días" },
  { clave: "30d", texto: "30 días", largo: "últimos 30 días" },
  { clave: "mes", texto: "Mes", largo: "este mes" },
];

const RANGOS_MAS = [
  { clave: "mes_pasado", texto: "Mes pasado", largo: "mes pasado" },
  { clave: "todo", texto: "Todo", largo: "todo el histórico" },
];

/*
 * El calendario habla en días; la URL, en segundos. La conversión se hace con
 * `new Date(año, mes, día)` —hora local— y no interpretando la cadena
 * «2026-03-04», que se lee como UTC y en media América corre el periodo un
 * día entero. «Desde» empieza a las 00:00 y «hasta» a las 23:59:59.
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

function fechaCorta(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

export default function BarraSuperior() {
  const ruta = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const superficie = params.get("surface");
  const buscador = useRef<HTMLInputElement>(null);

  const rangoActual = params.get("rango") ?? "7d";
  const desdeParam = params.get("desde");
  const hastaParam = params.get("hasta");
  const personalizado = Boolean(desdeParam && hastaParam);

  const tituloBase = TITULOS.find(([prefijo]) => ruta === prefijo || ruta.startsWith(prefijo))?.[1] ?? "SalesDash";
  const titulo = ruta.startsWith("/canales/meta") && superficie === "instagram" ? "Instagram" : tituloBase;
  const periodo = personalizado
    ? `del ${fechaCorta(aIso(desdeParam))} al ${fechaCorta(aIso(hastaParam))}`
    : ([...RANGOS, ...RANGOS_MAS].find((r) => r.clave === rangoActual)?.largo ?? "últimos 7 días");

  // ⌘K / Ctrl+K lleva al buscador desde cualquier sitio.
  useEffect(() => {
    function atajo(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        buscador.current?.focus();
      }
    }
    window.addEventListener("keydown", atajo);
    return () => window.removeEventListener("keydown", atajo);
  }, []);

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

  const masActivo = personalizado || RANGOS_MAS.some((r) => r.clave === rangoActual);

  return (
    <header className="sd-superior">
      <div className="sd-superior-titulo">
        <span style={{ fontWeight: 600, fontSize: 15 }}>{titulo}</span>
        <span className="tenue" style={{ fontSize: 12.5 }}>· {periodo}</span>
      </div>

      {/* El buscador manda a la bandeja de WhatsApp con lo escrito: es donde
          están los clientes, los pedidos y los números. */}
      <form className="sd-buscador" action="/conversaciones" method="get" role="search">
        <IconoBuscar tam={15} />
        <input
          ref={buscador}
          type="search"
          name="q"
          placeholder="Buscar cliente, pedido o número"
          aria-label="Buscar cliente, pedido o número"
          defaultValue={ruta.startsWith("/conversaciones") ? (params.get("q") ?? "") : ""}
        />
        <input type="hidden" name="rango" value={rangoActual} />
        <kbd>⌘K</kbd>
      </form>

      <div className="sd-rangos" role="group" aria-label="Periodo">
        {RANGOS.map((r) => (
          <button
            key={r.clave}
            type="button"
            className="sd-rango-btn"
            aria-pressed={!personalizado && rangoActual === r.clave}
            onClick={() => cambiarRango(r.clave)}
          >
            {r.texto}
          </button>
        ))}

        {/* Lo que no cabe en una pastilla: el mes pasado, todo el histórico y
            el calendario para «del 3 al 17». */}
        <details className="sd-mas">
          <summary className="sd-rango-btn" aria-pressed={masActivo}>
            {personalizado ? periodo : masActivo ? RANGOS_MAS.find((r) => r.clave === rangoActual)?.texto : "Más"} ▾
          </summary>
          <div className="sd-mas-panel">
            {RANGOS_MAS.map((r) => (
              <button
                key={r.clave}
                type="button"
                className={`sd-enlace${!personalizado && rangoActual === r.clave ? " sd-enlace-activo" : ""}`}
                onClick={() => cambiarRango(r.clave)}
              >
                {r.texto}
              </button>
            ))}
            <form
              className="sd-fechas"
              key={`${desdeParam ?? ""}:${hastaParam ?? ""}`}
              onSubmit={aplicarFechas}
            >
              <label>
                <span>Desde</span>
                <input type="date" name="desde" className="campo sd-campo-fecha" defaultValue={aIso(desdeParam)} required />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" name="hasta" className="campo sd-campo-fecha" defaultValue={aIso(hastaParam)} required />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="submit" className="btn btn-secundario sd-btn-fecha">Aplicar</button>
                {personalizado && (
                  <button type="button" onClick={() => cambiarRango("7d")} className="sd-quitar-fechas">
                    Quitar
                  </button>
                )}
              </div>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
