import PanelAgente, { type PaisResumen } from "@/components/panel/PanelAgente";
import { revisarAgente } from "@/lib/agent";
import { AGENTE_DE_LA_CUENTA, listarCanales, obtenerAgente, usoDelDia, type Agente } from "@/lib/db";
import { hoyISO } from "@/lib/ia";
import { PAISES } from "@/lib/paises";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Agente de IA · SalesDash" };
export const dynamic = "force-dynamic";

const CUPO_GRATUITO_ESTIMADO = 50;

/** El agente, escrito como lo lee el panel: enteros de SQLite a booleanos. */
function paraElPanel(a: Agente) {
  return {
    canal_id: a.canal_id,
    nombre: a.nombre,
    tono: a.tono,
    instrucciones: a.instrucciones,
    pais: a.pais,
    conocimiento: a.conocimiento,
    usar_catalogo: a.usar_catalogo === 1,
    ver_imagenes: a.ver_imagenes === 1,
    oir_audios: a.oir_audios === 1,
    validar_mapa: a.validar_mapa === 1,
    modelo: a.modelo,
    modelo_respaldo: a.modelo_respaldo,
    modelo_vision: a.modelo_vision,
    modelo_audio: a.modelo_audio,
    pasar_a_humano: a.pasar_a_humano === 1,
    silenciar_si_humano: a.silenciar_si_humano === 1,
    retardo_seg: a.retardo_seg,
    horario_activo: a.horario_activo === 1,
    horario_desde: a.horario_desde,
    horario_hasta: a.horario_hasta,
    recordatorio_visto: a.recordatorio_visto === 1,
    recordatorio_visto_horas: a.recordatorio_visto_horas,
    recordatorio_entrega: a.recordatorio_entrega === 1,
    recordatorio_entrega_horas: a.recordatorio_entrega_horas,
  };
}

/**
 * Lo que el panel enseña de cada país: lo justo para que el dueño VEA qué se le
 * está contando al modelo por haber elegido ese país, y no lo repita a mano en
 * sus instrucciones. El paquete entero vive en `paises.ts` y no se edita aquí.
 */
const paises: PaisResumen[] = PAISES.map((p) => ({
  codigo: p.codigo,
  nombre: p.nombre,
  bandera: p.bandera,
  moneda: `${p.moneda.nombre} · se escribe ${p.moneda.ejemplo}`,
  tratamiento: p.tratamiento,
  direcciones: p.direcciones,
  pagos: p.pagos,
  entrega: p.entrega,
}));

export default async function PaginaAgente() {
  const ctx = await requerirSesion();

  const plantilla = obtenerAgente(ctx.orgId, AGENTE_DE_LA_CUENTA);
  const uso = usoDelDia(ctx.orgId, hoyISO()).filter((u) => u.proposito === "agente");
  const esGratuito = plantilla.modelo.endsWith(":free");

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Agente de IA</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            Opcional. Un agente por número: cada uno con su país, su guion y su modelo.
          </p>
        </div>
      </div>

      <PanelAgente
        plantillaInicial={paraElPanel(plantilla)}
        canalesIniciales={listarCanales(ctx.orgId).map((c) => ({
          id: c.id,
          nombre: c.nombre,
          phone: c.phone.startsWith("pendiente:") ? null : c.phone,
          agente_activo: c.agente_activo === 1,
          contesta_ia: c.contesta_ia === 1,
          conectado: c.estado === "conectado",
          /*
           * El agente de ESTE número. Se pide aquí y no en el cliente porque
           * pedirlo lo crea si no existe: al abrir la página, cada canal ya
           * tiene el suyo, copiado de la plantilla con el guion dentro.
           */
          agente: paraElPanel(obtenerAgente(ctx.orgId, c.id)),
          /*
           * Con qué se encuentra un cliente que escriba AHORA a este número.
           * Se calcula al pintar la página y no solo al tocar el interruptor:
           * un agente que dejó de contestar anoche —cupo agotado, número
           * caído— tiene que verse al entrar, sin apagar y encender nada.
           */
          revision: revisarAgente(ctx.orgId, c.id),
        }))}
        paises={paises}
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
