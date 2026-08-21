import { Suspense } from "react";
import BarraLateral from "@/components/panel/BarraLateral";
import { contarRevisiones } from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  const ctx = await requerirSesion();

  return (
    /*
     * El acento de la organización entra como variable CSS en el marco.
     * `--acc-2` y `--acc-bg` se derivan de él con color-mix en la hoja de
     * estilos, así que no hace falta calcularlos ni guardarlos.
     */
    <div className="sd-marco" style={{ ["--acc" as string]: ctx.org.color }}>
      <Suspense fallback={<div className="sd-lateral" />}>
        <BarraLateral
          negocio={ctx.org.nombre}
          usuario={{ nombre: ctx.usuario.nombre, email: ctx.usuario.email }}
          superadmin={ctx.superadmin}
          pendientesRevision={contarRevisiones(ctx.orgId)}
        />
      </Suspense>

      <main className="sd-contenido">{children}</main>
    </div>
  );
}
