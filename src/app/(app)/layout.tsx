import { Suspense } from "react";
import BarraLateral from "@/components/panel/BarraLateral";
import BarraSuperior from "@/components/panel/BarraSuperior";
import { contarRevisiones, listarCanales, obtenerAgente } from "@/lib/db";
import { paisDeTelefono } from "@/lib/paises";
import { requerirSesion } from "@/lib/tenant";

/** El color con el que nació la plataforma. Quien no lo cambió no eligió nada. */
const COLOR_DE_FABRICA = "#12876a";

/**
 * Antes de que React arranque, el marco toma el tema que el navegador
 * recuerda. Va como script en línea a propósito: si esperara a hidratar, la
 * página parpadearía del oscuro al claro en cada carga.
 */
const SCRIPT_TEMA =
  "try{var t=localStorage.getItem('sd-tema');if(t==='claro'||t==='oscuro'){document.currentScript.parentElement.dataset.tema=t}}catch(e){}";

export const dynamic = "force-dynamic";

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  const ctx = await requerirSesion();

  /*
   * En cuántos países vende la cuenta: el país de cada número, por su agente o
   * por su prefijo. Es el subtítulo de la cuenta en la barra lateral.
   */
  const paises = new Set(
    listarCanales(ctx.orgId)
      .filter((c) => c.activo === 1)
      .map((c) => obtenerAgente(ctx.orgId, c.id).pais || paisDeTelefono(c.phone)?.codigo || "")
      .filter(Boolean),
  ).size;

  /*
   * El acento de la organización entra como variable CSS en el marco, y
   * `--acc-2` y `--acc-bg` se derivan de él en la hoja de estilos. En claro
   * manda siempre el color de la cuenta; en oscuro, el morado del panel salvo
   * que la cuenta haya elegido uno propio.
   */
  const color = ctx.org.color.trim().toLowerCase();
  const propio = color !== "" && color !== COLOR_DE_FABRICA;

  return (
    <div
      className="sd-marco"
      data-tema="oscuro"
      suppressHydrationWarning
      style={{
        ["--acc-claro" as string]: ctx.org.color,
        ...(propio ? { ["--acc-oscuro" as string]: ctx.org.color } : {}),
      }}
    >
      <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      <Suspense fallback={<div className="sd-lateral" />}>
        <BarraLateral
          negocio={ctx.org.nombre}
          paises={paises}
          usuario={{ nombre: ctx.usuario.nombre, email: ctx.usuario.email }}
          superadmin={ctx.superadmin}
          pendientesRevision={contarRevisiones(ctx.orgId)}
        />
      </Suspense>

      <div className="sd-columna">
        <Suspense fallback={<header className="sd-superior" />}>
          <BarraSuperior />
        </Suspense>
        <main className="sd-contenido">{children}</main>
      </div>
    </div>
  );
}
