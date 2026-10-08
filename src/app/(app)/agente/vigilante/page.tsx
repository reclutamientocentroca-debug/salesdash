import Link from "next/link";
import PanelVigilante from "@/components/panel/PanelVigilante";
import { IconoAgente, IconoDashboard, IconoRevision, IconoVentas } from "@/components/panel/Iconos";
import { Kpi, Vacio, fechaYHora } from "@/components/panel/Piezas";
import {
  contadoresVigilante,
  husoDeLaCuenta,
  listarCanales,
  listarCorreccionesVigilante,
  obtenerAgente,
  obtenerVigilanteConfig,
  type FiltroVigilancia,
} from "@/lib/db";
import { freeLlmConfigurado } from "@/lib/freellm";
import { finDelDiaEn, inicioDelDiaEn } from "@/lib/rango";
import { requerirSesion } from "@/lib/tenant";
import {
  GUIA_RD_DEFECTO,
  PROMPT_DEFECTO,
  REGLAS_FIJAS_DEFECTO,
  configDelCanal,
} from "@/lib/vigilante";

export const metadata = { title: "IA Vigilante · SalesDash" };
export const dynamic = "force-dynamic";

/** «2026-10-05» → el día entero en la hora del país de la cuenta, o null. */
function limiteDelDia(valor: string | undefined, huso: string, fin: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor ?? "");
  if (!m) return null;
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = fin ? finDelDiaEn(huso, y, mes, d) : inicioDelDiaEn(huso, y, mes, d);
  return Math.floor(ms / 1000);
}

export default async function PaginaVigilante({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string; desde?: string; hasta?: string }>;
}) {
  const ctx = await requerirSesion();
  const q = await searchParams;
  const huso = husoDeLaCuenta(ctx.orgId);

  const canales = listarCanales(ctx.orgId, ctx.canalesPermitidos);
  const canalFiltro = canales.find((c) => c.id === Number(q.canal))?.id ?? null;

  const filtro: FiltroVigilancia = {
    canalesPermitidos: ctx.canalesPermitidos,
    canalId: canalFiltro,
    desde: limiteDelDia(q.desde, huso, false),
    hasta: limiteDelDia(q.hasta, huso, true),
  };

  const contadores = contadoresVigilante(ctx.orgId, filtro);
  const correcciones = listarCorreccionesVigilante(ctx.orgId, filtro, 200);
  const revisadas = contadores.aprobadas + contadores.corregidas;
  const porcentaje = revisadas > 0 ? Math.round((contadores.corregidas / revisadas) * 100) : 0;
  const nombres = new Map(canales.map((c) => [c.id, c.nombre]));

  const general = obtenerVigilanteConfig(ctx.orgId, 0);

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">IA Vigilante</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Revisa cada respuesta del agente antes de enviarla. Si está mal, la corrige; el cliente no nota nada.{" "}
            <Link href="/agente" style={{ textDecoration: "underline" }}>
              Volver al agente
            </Link>
          </p>
        </div>
      </div>

      {!freeLlmConfigurado() && (
        <div className="aviso aviso-ambar" style={{ marginBottom: 16 }}>
          FreeLLMAPI no está configurado en el servidor (faltan <code>FREELLMAPI_BASE_URL</code> y{" "}
          <code>FREELLMAPI_API_KEY</code>). Mientras tanto la vigilante no puede revisar y todas las respuestas salen
          como las escribió el agente.
        </div>
      )}

      <PanelVigilante
        puedeEditarGeneral={ctx.canalesPermitidos === null}
        general={{ activa: general?.activa === 1, prompt: general?.prompt ?? PROMPT_DEFECTO }}
        defectos={{ prompt: PROMPT_DEFECTO, reglas: REGLAS_FIJAS_DEFECTO, guiaRD: GUIA_RD_DEFECTO }}
        canales={canales.map((c) => {
          const pais = obtenerAgente(ctx.orgId, c.id).pais;
          const cfg = configDelCanal(ctx.orgId, c.id, pais);
          return { id: c.id, nombre: c.nombre, pais, activa: cfg.canalActiva, modo: cfg.modo, guia: cfg.guia, reglas: cfg.reglas };
        })}
      />

      <h2 className="titulo-tarjeta" style={{ margin: "28px 0 10px" }}>
        Registro y contadores
      </h2>

      <form method="get" className="tarjeta" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <label>
          <span className="etiqueta-campo">Canal</span>
          <select name="canal" defaultValue={canalFiltro ?? ""} className="campo">
            <option value="">Todos</option>
            {canales.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="etiqueta-campo">Desde</span>
          <input type="date" name="desde" defaultValue={q.desde ?? ""} className="campo" />
        </label>
        <label>
          <span className="etiqueta-campo">Hasta</span>
          <input type="date" name="hasta" defaultValue={q.hasta ?? ""} className="campo" />
        </label>
        <button type="submit" className="btn btn-secundario">
          Filtrar
        </button>
        <Link href="/agente/vigilante" className="btn btn-secundario">
          Quitar filtros
        </Link>
      </form>

      <div className="rejilla" style={{ marginBottom: 14 }}>
        <Kpi etiqueta="Respuestas revisadas" icono={<IconoAgente tam={16} />} valor={revisadas} pie={contadores.fallos > 0 ? `${contadores.fallos} sin poder revisar (salió la original)` : undefined} />
        <Kpi etiqueta="Aprobadas" icono={<IconoRevision tam={16} />} valor={contadores.aprobadas} tono="acento" />
        <Kpi etiqueta="Corregidas" icono={<IconoDashboard tam={16} />} valor={contadores.corregidas} tono="ambar" />
        <Kpi etiqueta="% de corrección" icono={<IconoVentas tam={16} />} valor={`${porcentaje}%`} tono="azul" />
      </div>

      <div className="tarjeta" style={{ marginBottom: 14 }}>
        <div className="titulo-tarjeta">Motivos más frecuentes</div>
        {contadores.motivos.length === 0 ? (
          <p className="tenue">Todavía no hay correcciones.</p>
        ) : (
          <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {contadores.motivos.map((m) => (
              <li key={m.motivo} style={{ marginBottom: 4 }}>
                {m.motivo} <span className="num tenue">× {m.cantidad}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <div className="titulo-tarjeta">Registro de correcciones</div>
        {correcciones.length === 0 ? (
          <Vacio titulo="Sin correcciones" texto="Cuando la vigilante corrija una respuesta, aparecerá aquí con el motivo." />
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Canal</th>
                <th>Mensaje del cliente</th>
                <th>Respuesta original</th>
                <th>Respuesta corregida</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {correcciones.map((r) => {
                let motivos: string[] = [];
                try {
                  motivos = JSON.parse(r.motivos) as string[];
                } catch {
                  /* un registro con motivos ilegibles se enseña sin motivo */
                }
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fechaYHora(r.creado_at, huso)}</td>
                    <td>{nombres.get(r.canal_id) ?? "—"}</td>
                    <td style={{ maxWidth: 220 }}>{r.mensaje_cliente}</td>
                    <td style={{ maxWidth: 260, whiteSpace: "pre-wrap" }}>{r.respuesta_original}</td>
                    <td style={{ maxWidth: 260, whiteSpace: "pre-wrap" }}>
                      {r.respuesta_final}
                      {r.enviada === "original" && <div className="tenue">(modo «Solo vigilar»: salió la original)</div>}
                    </td>
                    <td style={{ maxWidth: 240 }}>{motivos.join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
