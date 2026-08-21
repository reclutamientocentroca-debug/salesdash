import PanelAgente from "@/components/panel/PanelAgente";
import { listarCanales, obtenerAgente, usoDelDia } from "@/lib/db";
import { hoyISO } from "@/lib/ia";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Agente de IA · SalesDash" };
export const dynamic = "force-dynamic";

const CUPO_GRATUITO_ESTIMADO = 50;

export default async function PaginaAgente() {
  const ctx = await requerirSesion();
  const agente = obtenerAgente(ctx.orgId);
  const uso = usoDelDia(ctx.orgId, hoyISO()).filter((u) => u.proposito === "agente");
  const esGratuito = agente.modelo.endsWith(":free");

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Agente de IA</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Opcional. Contesta a tus clientes por ti en los números que elijas.
          </p>
        </div>
      </div>

      <PanelAgente
        agenteInicial={{
          nombre: agente.nombre,
          tono: agente.tono,
          instrucciones: agente.instrucciones,
          modelo: agente.modelo,
          modelo_respaldo: agente.modelo_respaldo,
          pasar_a_humano: agente.pasar_a_humano === 1,
          silenciar_si_humano: agente.silenciar_si_humano === 1,
          horario_activo: agente.horario_activo === 1,
          horario_desde: agente.horario_desde,
          horario_hasta: agente.horario_hasta,
        }}
        canalesIniciales={listarCanales(ctx.orgId).map((c) => ({
          id: c.id,
          nombre: c.nombre,
          phone: c.phone.startsWith("pendiente:") ? null : c.phone,
          agente_activo: c.agente_activo === 1,
          contesta_ia: c.contesta_ia === 1,
          conectado: c.estado === "conectado",
        }))}
        consumo={{
          respuestas_hoy: uso.reduce((n, u) => n + u.exitos, 0),
          fallos_hoy: uso.reduce((n, u) => n + u.fallos, 0),
          modelo_gratuito: esGratuito,
          cupo_estimado: esGratuito ? CUPO_GRATUITO_ESTIMADO : null,
        }}
      />
    </>
  );
}
