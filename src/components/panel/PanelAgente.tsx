"use client";

import { useEffect, useState } from "react";
import { PLANTILLAS } from "@/lib/plantillas";
import { useRouter } from "next/navigation";

/**
 * EL AGENTE SE CONFIGURA CANAL POR CANAL.
 *
 * Un negocio con un WhatsApp en República Dominicana, otro en Costa Rica y otro
 * en Panamá no tiene un vendedor: tiene tres. La barra de arriba es la que dice
 * cuál se está tocando, y todo lo que hay debajo es de ESE canal.
 *
 * El canal 0 es la plantilla de la cuenta: de ella nacen los agentes de los
 * números que se conecten después, y es lo único que hay cuando todavía no hay
 * ninguno conectado.
 */
const PLANTILLA = 0;

interface Agente {
  canal_id: number;
  nombre: string;
  tono: string;
  instrucciones: string;
  pais: string;
  conocimiento: string;
  usar_catalogo: boolean;
  ver_imagenes: boolean;
  oir_audios: boolean;
  validar_mapa: boolean;
  modelo: string;
  modelo_respaldo: string | null;
  modelo_vision: string | null;
  modelo_audio: string | null;
  pasar_a_humano: boolean;
  silenciar_si_humano: boolean;
  retardo_seg: number;
  negocio: string;
  envio_cerca: number | null;
  envio_lejos: number | null;
  horario_activo: boolean;
  horario_desde: string | null;
  horario_hasta: string | null;
  recordatorio_visto: boolean;
  recordatorio_visto_horas: number;
  recordatorio_entrega: boolean;
  recordatorio_entrega_horas: number;
}

/** Lo que impide o condiciona que el agente conteste. Lo calcula el servidor. */
interface RevisionAgente {
  listo: boolean;
  impedimentos: string[];
  avisos: string[];
}

interface CanalAgente {
  id: number;
  nombre: string;
  phone: string | null;
  agente_activo: boolean;
  /** En este número contesta una IA ajena: el nuestro se calla, esté como esté. */
  contesta_ia: boolean;
  conectado: boolean;
  /** Cómo se presenta este número: el nombre de su perfil de WhatsApp. */
  negocio: string | null;
  revision: RevisionAgente;
  /** El agente de este canal, tal y como está guardado. */
  agente: Agente;
}

/** Lo que el agente sabe de un país. Se enseña, no se edita. Ver `paises.ts`. */
export interface PaisResumen {
  codigo: string;
  nombre: string;
  bandera: string;
  moneda: string;
  tratamiento: string;
  direcciones: string;
  pagos: string[];
  entrega: string[];
}

interface Consumo {
  respuestas_hoy: number;
  fallos_hoy: number;
  modelo_gratuito: boolean;
  cupo_estimado: number | null;
}

interface Modelo {
  id: string;
  nombre: string;
  gratis: boolean;
  precioEntrada: number | null;
  precioSalida: number | null;
  vision: boolean;
  audio: boolean;
}

const TONOS = [
  { clave: "cercano", texto: "Cercano" },
  { clave: "formal", texto: "Formal" },
  { clave: "directo", texto: "Directo" },
  { clave: "alegre", texto: "Alegre" },
];

function Interruptor({
  activo,
  onChange,
  etiqueta,
  descripcion,
}: {
  activo: boolean;
  onChange: (v: boolean) => void;
  etiqueta: string;
  descripcion: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        className="sd-switch"
        onClick={() => onChange(!activo)}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{etiqueta}</div>
        <div className="tenue">{descripcion}</div>
      </div>
    </div>
  );
}

/** Cabecera de apartado: un número, un título y para qué sirve. */
function Apartado({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="sd-apartado">
      <span className="sd-apartado-num" aria-hidden>
        {n}
      </span>
      <div>
        <h2 className="titulo-tarjeta">{titulo}</h2>
        <p className="tenue" style={{ marginTop: 2 }}>
          {children}
        </p>
      </div>
    </div>
  );
}

function SelectorModelo({
  valor,
  modelos,
  onChange,
  id,
  vacio,
}: {
  valor: string;
  modelos: Modelo[];
  onChange: (v: string) => void;
  id: string;
  /** Qué dice la opción vacía. Sin ella, el campo es obligatorio. */
  vacio?: string;
}) {
  const gratuitos = modelos.filter((m) => m.gratis);
  const dePago = modelos.filter((m) => !m.gratis);

  const precio = (m: Modelo) =>
    m.precioSalida === null ? "" : ` · $${m.precioSalida.toFixed(2)}/M`;

  /*
   * El modelo guardado, cuando ya no está en el catálogo, se enseña IGUAL.
   *
   * Los modelos se retiran —a `meta-llama/llama-3.3-70b-instruct:free` le pasó,
   * y con él dejaron de contestar los agentes que lo tenían puesto—. Sin esta
   * opción, un `<select>` con un valor que no existe entre sus opciones pinta
   * el primero de la lista: la pantalla enseñaba un modelo y el servidor
   * llamaba a otro, muerto, sin que nadie pudiera verlo. Aquí se ve, y dice
   * lo que le pasa.
   */
  const desaparecido = valor !== "" && modelos.length > 0 && !modelos.some((m) => m.id === valor);

  return (
    <select id={id} className="campo" value={valor} onChange={(e) => onChange(e.target.value)}>
      {vacio && <option value="">{vacio}</option>}
      {modelos.length === 0 && valor !== "" && <option value={valor}>{valor}</option>}
      {desaparecido && <option value={valor}>{valor} · ya no está disponible, elige otro</option>}

      {gratuitos.length > 0 && (
        <optgroup label="Gratuitos">
          {gratuitos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre} · Gratis
            </option>
          ))}
        </optgroup>
      )}

      {dePago.length > 0 && (
        <optgroup label="De pago">
          {dePago.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
              {precio(m)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export default function PanelAgente({
  plantillaInicial,
  canalesIniciales,
  paises,
  consumo,
}: {
  /** El agente de la cuenta (canal 0): el molde del que nacen los demás. */
  plantillaInicial: Agente;
  canalesIniciales: CanalAgente[];
  paises: PaisResumen[];
  consumo: Consumo;
}) {
  const router = useRouter();
  const [canales, setCanales] = useState(canalesIniciales);
  const [plantilla, setPlantilla] = useState(plantillaInicial);

  /*
   * Se abre por el primer canal conectado, no por la plantilla. Quien entra
   * aquí viene a tocar un número suyo; la plantilla es para cuando no hay
   * ninguno, o para dejar preparado lo que heredará el siguiente.
   */
  const [seleccion, setSeleccion] = useState<number>(canalesIniciales[0]?.id ?? PLANTILLA);

  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chat de prueba
  const [prueba, setPrueba] = useState("");
  /* `mensajes` es la respuesta partida tal y como le llega al cliente: en la
     apertura de un hilo son dos —el saludo y, detrás, la respuesta—. Se pinta
     eso y no `texto`, o la prueba enseñaría un globo donde van a ir dos. */
  const [respuesta, setRespuesta] = useState<{
    texto: string;
    mensajes?: string[];
    modelo: string;
    fueRespaldo: boolean;
  } | null>(null);
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    fetch("/api/modelos")
      .then((r) => r.json())
      .then((d) => setModelos([...(d.gratuitos ?? []), ...(d.de_pago ?? [])]))
      .catch(() => {
        /* Sin lista, los selectores muestran el modelo guardado y ya. */
      });
  }, []);

  const canal = canales.find((c) => c.id === seleccion) ?? null;
  const agente = canal ? canal.agente : plantilla;
  const pais = paises.find((p) => p.codigo === agente.pais) ?? null;

  const encendidos = canales.filter((c) => c.agente_activo && !c.contesta_ia).length;
  const esGratuito = agente.modelo.endsWith(":free") || modelos.find((m) => m.id === agente.modelo)?.gratis;

  /** Solo los modelos que de verdad ven, y solo los que de verdad oyen. */
  const queVen = modelos.filter((m) => m.vision);
  const queOyen = modelos.filter((m) => m.audio);

  function cambiar<K extends keyof Agente>(campo: K, valor: Agente[K]) {
    if (canal) {
      setCanales((cs) =>
        cs.map((c) => (c.id === canal.id ? { ...c, agente: { ...c.agente, [campo]: valor } } : c)),
      );
    } else {
      setPlantilla((a) => ({ ...a, [campo]: valor }));
    }
    setNota(null);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setNota(null);

    const r = await fetch("/api/agente", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // El canal viaja en el cuerpo: sin él, el servidor guardaría en la
      // plantilla lo que el dueño escribió para un número concreto.
      body: JSON.stringify({ ...agente, canal: canal?.id ?? PLANTILLA }),
    });
    const datos = await r.json();

    setGuardando(false);
    if (!r.ok) setError(datos.error ?? "No se pudo guardar.");
    else {
      setNota(canal ? `Guardado en ${canal.nombre}.` : "Guardado.");
      router.refresh();
    }
  }

  /**
   * Encender el agente en un número es DECIDIR QUIÉN CONTESTA AHÍ.
   *
   * Por defecto el panel solo vigila: se supone que en el WhatsApp del dueño ya
   * contesta su propia IA. Encender el nuestro le quita ese sitio, así que se
   * pregunta —una vez, y solo cuando de verdad cambia algo—: quien no se dé
   * cuenta se encuentra a dos vendedores escribiéndole al mismo cliente.
   *
   * La pregunta se hace EN LA PÁGINA y no con el `confirm()` del navegador. Un
   * `confirm()` bloqueado —pasa dentro de la app de Facebook, en algunos
   * navegadores de móvil y con cualquier bloqueador— devuelve «cancelar» sin
   * enseñar nada: el dueño pulsa el interruptor, no ocurre absolutamente nada,
   * y se queda esperando respuestas de un agente que nunca se encendió.
   */
  const [confirmando, setConfirmando] = useState<number | null>(null);

  /** La plantilla de guion que pide confirmación por sustituir lo escrito. */
  const [guion, setGuion] = useState<string | null>(null);

  /*
   * COPIAR EL GUION A LOS DEMÁS NÚMEROS.
   *
   * Cada canal tiene su agente porque cada país vende distinto, pero las reglas
   * del negocio —la política de cambios, cómo se cierra un pedido, qué no se
   * promete— son las mismas en los tres. Sin esto hay que pegarlas a mano en
   * cada número, y a la tercera vez alguien se olvida.
   *
   * Pisa lo escrito en los otros canales, así que se pregunta antes, en la
   * página y no con el `confirm()` del navegador, por lo mismo que el resto.
   */
  const [copiando, setCopiando] = useState(false);
  const [confirmarCopia, setConfirmarCopia] = useState(false);

  async function copiarGuion() {
    setConfirmarCopia(false);
    setCopiando(true);
    setError(null);
    setNota(null);

    const r = await fetch("/api/agente/copiar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ desde: canal?.id ?? PLANTILLA }),
    });
    const datos = await r.json();

    setCopiando(false);
    if (!r.ok) {
      setError(datos.error ?? "No se pudo copiar.");
      return;
    }

    setNota(
      `Guion copiado a ${datos.alcanzados} agente${datos.alcanzados === 1 ? "" : "s"} más.`,
    );
    router.refresh();
  }

  /*
   * LOS GUIONES DE ESTE NÚMERO PRIMERO.
   *
   * Cada guion trae dentro la moneda, los precios y el envío de SU país. El de
   * este número va arriba porque es el único que no hay que corregir antes de
   * vender; los demás siguen ahí, pero detrás y avisados.
   */
  const guiones = [...PLANTILLAS].sort((a, b) => {
    const suyo = (p: { pais: string }) => (agente.pais && p.pais === agente.pais ? 0 : 1);
    return suyo(a) - suyo(b);
  });

  /** Este guion es de otro país que el que vende este número. */
  const cruzaPais = (p: { pais: string }) => !!agente.pais && p.pais !== agente.pais;

  function aplicarGuion(clave: string, confirmada: boolean) {
    const p = PLANTILLAS.find((x) => x.clave === clave);
    if (!p) return;

    // Con el cuadro vacío no hay nada que perder... salvo que el guion sea de
    // otro país, que es el fallo que no se ve hasta que se está cobrando mal.
    if (!confirmada && (agente.instrucciones.trim() || cruzaPais(p))) {
      setGuion(clave);
      return;
    }

    setGuion(null);
    cambiar("instrucciones", p.instrucciones);
    setNota("Guion puesto. Revísalo y pulsa «Guardar cambios».");
  }

  async function alternarCanal(id: number, activo: boolean) {
    const previo = canales.find((c) => c.id === id);

    if (activo && previo?.contesta_ia && confirmando !== id) {
      setConfirmando(id);
      return;
    }

    setConfirmando(null);
    setError(null);

    setCanales((cs) =>
      cs.map((c) =>
        c.id === id ? { ...c, agente_activo: activo, contesta_ia: activo ? false : c.contesta_ia } : c,
      ),
    );

    const r = await fetch(`/api/canales/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agente_activo: activo }),
    });

    if (!r.ok) {
      setCanales((cs) => cs.map((c) => (c.id === id ? { ...c, ...previo } : c)));
      setError("No se pudo cambiar el número.");
      return;
    }

    /*
     * El servidor contesta con lo que de verdad va a pasar cuando escriba un
     * cliente. Se pinta ahí mismo: «listo» o la lista de lo que falta.
     */
    const datos = (await r.json().catch(() => ({}))) as { agente?: RevisionAgente };
    if (datos.agente) {
      setCanales((cs) => cs.map((c) => (c.id === id ? { ...c, revision: datos.agente! } : c)));
    }
    router.refresh();
  }

  async function probar() {
    if (!prueba.trim()) return;
    setProbando(true);
    setError(null);
    setRespuesta(null);

    const r = await fetch("/api/agente/probar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canal: canal?.id ?? PLANTILLA,
        conversacion: [{ rol: "cliente", texto: prueba }],
      }),
    });
    const datos = await r.json();

    setProbando(false);
    if (!r.ok) setError(datos.error ?? "No se pudo generar la respuesta.");
    else setRespuesta(datos);
  }

  const etiquetaCanal = canal ? canal.nombre : "la plantilla de la cuenta";

  return (
    <div className="rejilla">
      {/* ── Qué canal se está configurando ─────────────────────────────────── */}
      <section className="tarjeta">
        <Apartado n={1} titulo="Qué número estás configurando">
          Cada número tiene su propio agente: su país, su guion y su modelo. Lo que cambies aquí
          abajo es solo de este número.
        </Apartado>

        <div className="sd-canales">
          {canales.map((c) => {
            const suPais = paises.find((p) => p.codigo === c.agente.pais);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={seleccion === c.id}
                className={`sd-canal ${seleccion === c.id ? "sd-canal-activo" : ""}`}
                onClick={() => {
                  setSeleccion(c.id);
                  setRespuesta(null);
                  setNota(null);
                  setGuion(null);
                }}
              >
                <span className="sd-canal-nombre">
                  <span aria-hidden>{suPais?.bandera ?? "🌐"}</span>
                  {c.nombre}
                </span>
                <span className="num tenue">{c.phone ? `+${c.phone}` : "sin vincular"}</span>
                <span
                  className={`pastilla ${c.agente_activo && !c.contesta_ia ? "pastilla-ia" : "pastilla-abierta"}`}
                  style={{ justifySelf: "start", marginTop: 3 }}
                >
                  {c.contesta_ia ? "Solo vigila" : c.agente_activo ? "Responde" : "Apagado"}
                </span>
              </button>
            );
          })}

          {/*
            La plantilla siempre está, incluso sin ningún número conectado: es
            donde se deja escrito el guion que heredará el primero que entre.
          */}
          <button
            type="button"
            aria-pressed={seleccion === PLANTILLA}
            className={`sd-canal ${seleccion === PLANTILLA ? "sd-canal-activo" : ""}`}
            onClick={() => {
              setSeleccion(PLANTILLA);
              setRespuesta(null);
              setNota(null);
              setGuion(null);
            }}
          >
            <span className="sd-canal-nombre">
              <span aria-hidden>📋</span>
              Plantilla de la cuenta
            </span>
            <span className="tenue">De aquí nace cada número nuevo</span>
          </button>
        </div>

        {canales.length === 0 && (
          <p className="tenue" style={{ marginTop: 12 }}>
            Todavía no hay ningún número conectado. Lo que dejes escrito en la plantilla será lo que
            traiga el primero que conectes.
          </p>
        )}
      </section>

      {/* ── Encendido y estado de este canal ───────────────────────────────── */}
      {canal ? (
        <section className="tarjeta">
          <Apartado n={2} titulo="Si contesta o no en este número">
            El agente escribe a tus clientes de verdad. Enciéndelo solo donde quieras que conteste
            solo. La IA que mide tus ventas es otra y nunca escribe a nadie.
          </Apartado>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/*
                El interruptor SÍ se puede tocar en un número que solo se
                vigila: encenderlo es precisamente cómo se le da el sitio a
                nuestro agente. Y TAMBIÉN en uno desconectado: un número recién
                vinculado tarda unos segundos en decir «conectado», y bloquearlo
                ahí dejaba al dueño pulsando un interruptor muerto.
              */}
              <button
                type="button"
                role="switch"
                aria-checked={canal.agente_activo && !canal.contesta_ia}
                aria-label={`Agente en ${canal.nombre}`}
                className="sd-switch"
                onClick={() => alternarCanal(canal.id, !canal.agente_activo)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Que el agente conteste en {canal.nombre}
                </div>
                <div className="num tenue">
                  {canal.phone ? `+${canal.phone}` : "sin vincular"}
                  {!canal.conectado && " · desconectado"}
                  {canal.contesta_ia && " · aquí contesta tu IA, el panel solo mira"}
                </div>
              </div>
            </div>

            {/* La pregunta que antes hacía el navegador, ahora en la página. */}
            {confirmando === canal.id && (
              <div className="aviso aviso-ambar" style={{ display: "grid", gap: 10 }}>
                <div>
                  En <strong>{canal.nombre}</strong> contesta tu IA y el panel solo vigila. Si
                  enciendes el agente del panel, el que contesta a partir de ahora es él y tu IA deja
                  de tener ese sitio: las respuestas de este número pasarán a contarse como suyas.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-acento"
                    onClick={() => alternarCanal(canal.id, true)}
                  >
                    Sí, que conteste el agente
                  </button>
                  <button
                    type="button"
                    className="btn btn-secundario"
                    onClick={() => setConfirmando(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/*
              Con qué se encuentra un cliente que escriba a este número. Solo se
              pinta cuando hay algo que decir: con el agente apagado a propósito,
              «el agente está apagado» no es una noticia.
            */}
            {canal.agente_activo && confirmando !== canal.id && (
              <>
                {canal.revision.impedimentos.map((t) => (
                  <div className="aviso aviso-error" key={t} role="alert">
                    {t}
                  </div>
                ))}
                {canal.revision.avisos.map((t) => (
                  <div className="aviso aviso-ambar" key={t}>
                    {t}
                  </div>
                ))}
                {canal.revision.listo && canal.revision.avisos.length === 0 && (
                  <div className="tenue" style={{ color: "var(--acc)" }}>
                    ✓ Listo: el agente contesta al próximo cliente que escriba a este número.
                  </div>
                )}
              </>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              marginTop: 18,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
            }}
          >
            <Interruptor
              activo={agente.silenciar_si_humano}
              onChange={(v) => cambiar("silenciar_si_humano", v)}
              etiqueta="Callarse si un vendedor está atendiendo"
              descripcion="Si alguien de tu equipo escribió en las últimas 2 horas, el agente no responde. Evita que le escriban encima al cliente."
            />
            <Interruptor
              activo={agente.pasar_a_humano}
              onChange={(v) => cambiar("pasar_a_humano", v)}
              etiqueta="Pasar a una persona cuando lo pidan"
              descripcion="Si el cliente pide hablar con alguien, el agente deja de responder y la conversación se marca."
            />

            {/*
              CONTESTAR AL INSTANTE ES LO QUE MÁS DELATA A UN BOT.
              Ningún negocio responde en medio segundo, y menos con una frase
              perfecta. El retardo se cuenta desde que entró el mensaje del
              cliente: lo que el modelo tardó en pensar ya cuenta, así que esto
              no se suma a la espera, la iguala.
            */}
            <div>
              <label className="etiqueta-campo" htmlFor="retardo">
                Esperar antes de contestar
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <input
                  id="retardo" type="number" min={0} max={60} className="campo"
                  style={{ width: 130 }}
                  value={agente.retardo_seg}
                  onChange={(e) => cambiar("retardo_seg", Number(e.target.value))}
                />
                <span className="tenue" style={{ fontSize: 12.5 }}>segundos</span>
              </div>
              <p className="tenue" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                Mientras espera, el cliente ve «escribiendo…», como cuando contesta una persona. Se
                cuenta desde que llegó su mensaje: si el modelo ya tardó, no se suma. En 0 responde
                en cuanto puede.
              </p>
            </div>
            {/*
              EL COSTO DE ENVÍO NO SE INVENTA.
              Es el error más caro y el más fácil: al agente le falta una línea
              para cerrar y escribe una cifra. Si se pasa, pierde la venta; si
              se queda corto, el negocio paga la diferencia en cada pedido de
              esa zona. Con esto cargado, la provincia del pin del mapa decide
              cuál de los dos importes le toca al cliente. Vacío, el agente
              tiene PROHIBIDO decir un costo: dice que lo confirma.
            */}
            <div>
              <div className="etiqueta-campo">Costo de envío</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <label className="tenue" style={{ fontSize: 12 }} htmlFor="envio-cerca">
                    Donde llega tu mensajero
                  </label>
                  <input
                    id="envio-cerca" type="number" min={0} className="campo"
                    style={{ width: 150, display: "block", marginTop: 4 }}
                    placeholder="sin cargar"
                    value={agente.envio_cerca ?? ""}
                    onChange={(e) =>
                      cambiar("envio_cerca", e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </div>

                <div>
                  <label className="tenue" style={{ fontSize: 12 }} htmlFor="envio-lejos">
                    Al resto del país
                  </label>
                  <input
                    id="envio-lejos" type="number" min={0} className="campo"
                    style={{ width: 150, display: "block", marginTop: 4 }}
                    placeholder="sin cargar"
                    value={agente.envio_lejos ?? ""}
                    onChange={(e) =>
                      cambiar("envio_lejos", e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </div>
              </div>

              <p className="tenue" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                En la moneda de este número. Cuando el cliente manda su ubicación, la provincia del
                mapa decide cuál de los dos le toca. Déjalos vacíos y el agente no dirá ningún costo
                de envío: dirá que se lo confirmas.
              </p>
            </div>

            <Interruptor
              activo={agente.horario_activo}
              onChange={(v) => cambiar("horario_activo", v)}
              etiqueta="Responder solo en un horario"
              descripcion="Fuera de la franja que elijas, el agente no contesta. Es la hora del servidor, así que revísala si este número está en otro huso."
            />

            {agente.horario_activo && (
              <div style={{ display: "flex", gap: 10, paddingLeft: 50 }}>
                <div>
                  <label className="etiqueta-campo" htmlFor="desde">Desde</label>
                  <input
                    id="desde" type="time" className="campo" style={{ width: 130 }}
                    value={agente.horario_desde ?? "09:00"}
                    onChange={(e) => cambiar("horario_desde", e.target.value)}
                  />
                </div>
                <div>
                  <label className="etiqueta-campo" htmlFor="hasta">Hasta</label>
                  <input
                    id="hasta" type="time" className="campo" style={{ width: 130 }}
                    value={agente.horario_hasta ?? "18:00"}
                    onChange={(e) => cambiar("horario_hasta", e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* ── País ───────────────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <Apartado n={canal ? 3 : 2} titulo="En qué país vende este número">
          Es lo que hace que suene de aquí. De esto salen la moneda, el trato, cómo se piden las
          direcciones, con qué paga la gente y contra qué se comprueba un mapa.
        </Apartado>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {paises.map((p) => (
            <button
              key={p.codigo}
              type="button"
              className={`pastilla ${agente.pais === p.codigo ? "pastilla-ia" : "pastilla-abierta"}`}
              style={{ cursor: "pointer", border: "none", padding: "6px 13px" }}
              onClick={() => cambiar("pais", p.codigo)}
            >
              <span aria-hidden style={{ marginRight: 5 }}>{p.bandera}</span>
              {p.nombre}
            </button>
          ))}
          <button
            type="button"
            className={`pastilla ${agente.pais === "" ? "pastilla-ia" : "pastilla-abierta"}`}
            style={{ cursor: "pointer", border: "none", padding: "6px 13px" }}
            onClick={() => cambiar("pais", "")}
          >
            Ninguno
          </button>
        </div>

        {/*
          Lo que el agente sabe por haber elegido ese país, a la vista. No se
          edita: es lo que este panel ya sabe de cada país, y enseñarlo es lo que
          evita que el dueño lo repita a mano en sus instrucciones.
        */}
        {pais ? (
          <dl className="sd-pais-datos">
            <dt>Moneda</dt>
            <dd>{pais.moneda}</dd>
            <dt>Trato</dt>
            <dd>{pais.tratamiento}</dd>
            <dt>Direcciones</dt>
            <dd>{pais.direcciones}</dd>
            <dt>Pagos</dt>
            <dd>{pais.pagos.join(" · ")}</dd>
            <dt>Entrega</dt>
            <dd>{pais.entrega.join(" · ")}</dd>
          </dl>
        ) : (
          <p className="tenue">
            Sin país, el agente habla en neutro: no sabe en qué moneda cobrar, cómo se dan las
            direcciones ni con qué paga la gente, y no puede comprobar si un mapa cae donde entregas.
          </p>
        )}
      </section>

      <div className="sd-mitades">
        {/* ── Qué vende ──────────────────────────────────────────────────── */}
        <section className="tarjeta">
          <Apartado n={canal ? 4 : 3} titulo="Qué vende, y a qué precio">
            Escríbelo aquí y el agente vende sin necesidad de catálogo. Esto vale lo mismo que el
            catálogo: de aquí saca los precios que puede decir.
          </Apartado>

          <label className="etiqueta-campo" htmlFor="conocimiento">
            Artículos, precios y condiciones de este número
          </label>
          <textarea
            id="conocimiento"
            className="campo"
            rows={9}
            style={{ resize: "vertical", fontFamily: "inherit" }}
            placeholder={
              "Camisas de lino, talla S a XL — RD$1,850\n" +
              "Pantalón cargo, negro y beige — RD$2,400\n" +
              "Envío a la capital RD$200, al interior RD$300 por Caribe Express"
            }
            value={agente.conocimiento}
            onChange={(e) => cambiar("conocimiento", e.target.value)}
          />
          <p className="tenue" style={{ marginTop: 6 }}>
            Una línea por artículo, con su precio. Lo que no esté escrito aquí ni en el catálogo, el
            agente no lo promete: dice que lo confirma con el equipo.
          </p>

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <Interruptor
              activo={agente.usar_catalogo}
              onChange={(v) => cambiar("usar_catalogo", v)}
              etiqueta="Usar además el catálogo de la cuenta"
              descripcion="El catálogo es común a todos tus números. Apágalo aquí si este país vende otra cosa o a otros precios."
            />
          </div>
        </section>

        {/* ── Qué entiende ───────────────────────────────────────────────── */}
        <section className="tarjeta">
          <Apartado n={canal ? 5 : 4} titulo="Qué entiende del cliente">
            Media venta llega sin escribirse: la foto del artículo, el audio con la talla y la
            dirección, el pin del mapa.
          </Apartado>

          <div style={{ display: "grid", gap: 14 }}>
            <Interruptor
              activo={agente.ver_imagenes}
              onChange={(v) => cambiar("ver_imagenes", v)}
              etiqueta="Mirar las fotos que manda el cliente"
              descripcion="Reconoce el artículo de la foto y los comprobantes de pago. Apagado, el agente solo ve «[imagen]» y tiene que preguntar."
            />
            <Interruptor
              activo={agente.oir_audios}
              onChange={(v) => cambiar("oir_audios", v)}
              etiqueta="Escuchar las notas de voz"
              descripcion="Las pasa a texto y contesta a lo que dicen, sin pedirle al cliente que lo repita escrito."
            />
            <Interruptor
              activo={agente.validar_mapa}
              onChange={(v) => cambiar("validar_mapa", v)}
              etiqueta="Comprobar la ubicación del mapa"
              descripcion={
                pais
                  ? `Sitúa el pin y confirma la zona. Si cae fuera de ${pais.nombre}, no lo da por dirección: pregunta.`
                  : "Sitúa el pin y confirma la zona. Elige un país arriba para poder avisar cuando caiga fuera."
              }
            />
          </div>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <label className="etiqueta-campo" htmlFor="vision">Modelo que mira las fotos</label>
            <SelectorModelo
              id="vision"
              valor={agente.modelo_vision ?? ""}
              modelos={queVen}
              vacio="El de la cuenta"
              onChange={(v) => cambiar("modelo_vision", v || null)}
            />

            <label className="etiqueta-campo" htmlFor="audio" style={{ marginTop: 12 }}>
              Modelo que escucha los audios
            </label>
            <SelectorModelo
              id="audio"
              valor={agente.modelo_audio ?? ""}
              modelos={queOyen}
              vacio="El de la cuenta"
              onChange={(v) => cambiar("modelo_audio", v || null)}
            />
            <p className="tenue" style={{ marginTop: 6 }}>
              Solo salen los modelos que de verdad ven y los que de verdad oyen, que son bastantes
              menos. Déjalos en «el de la cuenta» si no tienes motivo para separarlos.
            </p>
          </div>
        </section>
      </div>

      <div className="sd-mitades">
        {/* ── Cómo habla ─────────────────────────────────────────────────── */}
        <section className="tarjeta">
          <Apartado n={canal ? 6 : 5} titulo="Cómo habla y qué guion sigue">
            El nombre con el que se presenta y las reglas de tu negocio. Esto es lo que convierte al
            agente genérico en el vendedor de esta tienda.
          </Apartado>

          <label className="etiqueta-campo" htmlFor="nombre-agente">Nombre del agente</label>
          <input
            id="nombre-agente" className="campo" style={{ marginBottom: 14 }}
            value={agente.nombre} onChange={(e) => cambiar("nombre", e.target.value)}
          />

          {/*
            CON QUÉ NOMBRE SALUDA AL CLIENTE.
            El cliente lleva el nombre del negocio delante desde antes de
            escribir —es lo que ve arriba del chat, y en un anuncio el de la
            página que lo publicó—. Saludarle con otro suena a conversación
            equivocada. Vacío se rellena solo con el perfil de WhatsApp del
            número; esto es para corregirlo cuando el perfil dice una cosa y la
            tienda se llama de otra.
          */}
          <label className="etiqueta-campo" htmlFor="negocio-agente">Nombre del negocio</label>
          <input
            id="negocio-agente" className="campo"
            placeholder={canal?.negocio ?? "El del perfil de WhatsApp de este número"}
            value={agente.negocio} onChange={(e) => cambiar("negocio", e.target.value)}
          />
          <p className="tenue" style={{ fontSize: 12, margin: "6px 0 14px", lineHeight: 1.5 }}>
            Con este nombre saluda: «Hola, bienvenido a …». Déjalo vacío y usa el del perfil de
            WhatsApp de este número, que es el que el cliente ya está viendo.
          </p>

          <div className="etiqueta-campo">Tono</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {TONOS.map((t) => (
              <button
                key={t.clave}
                type="button"
                className={`pastilla ${agente.tono === t.clave ? "pastilla-ia" : "pastilla-abierta"}`}
                style={{ cursor: "pointer", border: "none", padding: "5px 13px" }}
                onClick={() => cambiar("tono", t.clave)}
              >
                {t.texto}
              </button>
            ))}
          </div>

          <label className="etiqueta-campo" htmlFor="instrucciones">Instrucciones de tu negocio</label>
          <textarea
            id="instrucciones" className="campo" rows={10}
            style={{ resize: "vertical", fontFamily: "inherit" }}
            placeholder="No damos descuentos por debajo de 3 unidades. Antes de cerrar hay que tener talla y color…"
            value={agente.instrucciones}
            onChange={(e) => cambiar("instrucciones", e.target.value)}
          />
          <p className="tenue" style={{ marginTop: 6 }}>
            Lo que escribas aquí es lo que el agente da por cierto. No hace falta repetir la moneda
            ni cómo se dan las direcciones: eso ya lo sabe por el país.
          </p>

          {/*
            Las reglas del negocio son las mismas en los tres países; lo que
            cambia es la moneda y los precios, y eso NO viaja con el botón.
          */}
          {canales.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {confirmarCopia ? (
                <div className="aviso aviso-ambar" style={{ display: "grid", gap: 10 }}>
                  <div>
                    Se copian estas instrucciones a <strong>todos tus demás números</strong> y a la
                    plantilla de la cuenta, sustituyendo lo que cada uno tenga escrito. El país, los
                    precios y el modelo de cada número NO se tocan.
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-acento" onClick={copiarGuion}>
                      Sí, copiar a todos
                    </button>
                    <button
                      type="button"
                      className="btn btn-secundario"
                      onClick={() => setConfirmarCopia(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-secundario"
                    disabled={copiando}
                    onClick={() => setConfirmarCopia(true)}
                  >
                    {copiando ? "Copiando…" : "Copiar estas instrucciones a los demás números"}
                  </button>
                  <p className="tenue" style={{ marginTop: 6 }}>
                    Para las reglas que son iguales en todos los países —cómo se cierra un pedido, la
                    política de cambios—. Guárdalas antes: se copia lo último guardado.
                  </p>
                </>
              )}
            </div>
          )}

          {/*
            Un guion de venta entero no se escribe delante de un cuadro vacío.
            La plantilla lo deja puesto de una vez y sigue siendo editable: es
            un punto de partida, no un candado. Pisa lo que haya escrito, así
            que se avisa antes cuando hay algo que perder.
          */}
          {PLANTILLAS.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <div className="rotulo" style={{ marginBottom: 8 }}>Empezar desde un guion hecho</div>
              {guiones.map((p) => (
                <div key={p.clave} style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.nombre}</div>
                  <p className="tenue" style={{ margin: 0 }}>{p.descripcion}</p>

                  {guion === p.clave ? (
                    <div className="aviso aviso-ambar" style={{ display: "grid", gap: 10 }}>
                      {cruzaPais(p) && (
                        <div>
                          <strong>Este guion es de otro país.</strong> Trae dentro su moneda, sus
                          precios y su costo de envío, y este número no vende ahí. Si lo aplicas sin
                          corregirlo, el agente va a cotizar el envío de otra tienda en cada pedido
                          —y desde fuera parece que todo va bien—.
                        </div>
                      )}
                      {agente.instrucciones.trim() && (
                        <div>
                          Ya tienes instrucciones escritas en {etiquetaCanal}. Si aplicas el guion, se
                          sustituyen por las suyas y lo que tenías se pierde.
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-acento"
                          onClick={() => aplicarGuion(p.clave, true)}
                        >
                          Sustituir por el guion
                        </button>
                        <button
                          type="button"
                          className="btn btn-secundario"
                          onClick={() => setGuion(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        className="btn btn-secundario"
                        onClick={() => aplicarGuion(p.clave, false)}
                      >
                        Usar este guion
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <p className="tenue" style={{ marginTop: 8 }}>
                Se escribe en el cuadro de arriba. Revísalo, cámbiale lo que quieras y pulsa
                «Guardar cambios».
              </p>
            </div>
          )}
        </section>

        {/* ── La IA que contesta ─────────────────────────────────────────── */}
        <section className="tarjeta">
          <Apartado n={canal ? 7 : 6} titulo="Qué IA contesta en este número">
            Puedes darle a cada número un modelo distinto: uno rápido y barato donde hay mucho
            volumen, uno mejor donde el ticket lo justifica.
          </Apartado>

          <label className="etiqueta-campo" htmlFor="modelo">Modelo principal</label>
          <SelectorModelo
            id="modelo" valor={agente.modelo} modelos={modelos}
            onChange={(v) => cambiar("modelo", v)}
          />

          {esGratuito && (
            <div className="aviso aviso-ambar" style={{ marginTop: 10 }}>
              Los modelos gratuitos tienen un límite diario bajo. Al agotarse, tu agente deja de
              responder hasta el día siguiente. Sirven para probar; para atender clientes de verdad,
              usa un modelo de pago.
            </div>
          )}

          <label className="etiqueta-campo" htmlFor="respaldo" style={{ marginTop: 14 }}>
            Modelo de respaldo
          </label>
          <SelectorModelo
            id="respaldo" valor={agente.modelo_respaldo ?? ""} modelos={modelos} vacio="Sin respaldo"
            onChange={(v) => cambiar("modelo_respaldo", v || null)}
          />
          <p className="tenue" style={{ marginTop: 6 }}>
            Si el principal falla o agota su límite, se intenta una vez con este. Si tampoco hay
            respuesta, el agente se calla y marca la conversación: nunca le escribe un error al cliente.
          </p>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <div className="rotulo" style={{ marginBottom: 8 }}>
              Consumo de hoy · toda la cuenta
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Respuestas generadas</span>
              <span className="num" style={{ fontWeight: 600 }}>
                {consumo.respuestas_hoy}
                {consumo.cupo_estimado && <span className="tenue"> de ~{consumo.cupo_estimado}</span>}
              </span>
            </div>

            {consumo.cupo_estimado && (
              <div style={{ height: 5, background: "var(--soft)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min((consumo.respuestas_hoy / consumo.cupo_estimado) * 100, 100)}%`,
                    height: "100%",
                    background:
                      consumo.respuestas_hoy / consumo.cupo_estimado > 0.8 ? "var(--amber)" : "var(--acc)",
                  }}
                />
              </div>
            )}

            {consumo.fallos_hoy > 0 && (
              <p className="tenue" style={{ marginTop: 8, color: "var(--red)" }}>
                {consumo.fallos_hoy} intento{consumo.fallos_hoy === 1 ? "" : "s"} fallido
                {consumo.fallos_hoy === 1 ? "" : "s"} hoy.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* ── Seguimientos ───────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <Apartado n={canal ? 8 : 7} titulo="Seguimiento automático">
          Los dos únicos mensajes que el agente manda sin que el cliente escriba. Solo salen por los
          números donde ya está encendido, y uno solo por conversación.
        </Apartado>

        <div style={{ display: "grid", gap: 14 }}>
          <Interruptor
            activo={agente.recordatorio_visto}
            onChange={(v) => cambiar("recordatorio_visto", v)}
            etiqueta="Recordar al que dejó la conversación a medias"
            descripcion="Si el cliente no volvió a contestar, el agente le escribe una vez: le recuerda el artículo, que queda poco, y le pregunta lo que faltaba para cerrar."
          />

          {agente.recordatorio_visto && (
            <div style={{ paddingLeft: 50 }}>
              <label className="etiqueta-campo" htmlFor="visto-horas">A las cuántas horas</label>
              <input
                id="visto-horas" type="number" min={1} max={168} className="campo"
                style={{ width: 130 }}
                value={agente.recordatorio_visto_horas}
                onChange={(e) => cambiar("recordatorio_visto_horas", Number(e.target.value))}
              />
            </div>
          )}

          <Interruptor
            activo={agente.recordatorio_entrega}
            onChange={(v) => cambiar("recordatorio_entrega", v)}
            etiqueta="Avisar de que el pedido va en camino"
            descripcion="Horas después de levantar el pedido, el cliente recibe un aviso para que esté pendiente al mensajero. Con pago contra entrega, el paquete que nadie recibe se devuelve."
          />

          {agente.recordatorio_entrega && (
            <div style={{ paddingLeft: 50 }}>
              <label className="etiqueta-campo" htmlFor="entrega-horas">A las cuántas horas del pedido</label>
              <input
                id="entrega-horas" type="number" min={1} max={168} className="campo"
                style={{ width: 130 }}
                value={agente.recordatorio_entrega_horas}
                onChange={(e) => cambiar("recordatorio_entrega_horas", Number(e.target.value))}
              />
            </div>
          )}
        </div>
      </section>

      {/* ── Chat de prueba ─────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <Apartado n={canal ? 9 : 8} titulo="Pruébalo">
          Genera una respuesta con lo que está GUARDADO en {etiquetaCanal}. No se envía a nadie.
        </Apartado>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="campo"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Escribe lo que diría un cliente…"
            value={prueba}
            onChange={(e) => setPrueba(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void probar();
            }}
          />
          <button type="button" className="btn btn-secundario" onClick={probar} disabled={probando}>
            {probando ? "Pensando…" : "Probar"}
          </button>
        </div>

        {respuesta && (
          <div className="sd-hilo" style={{ marginTop: 14 }}>
            <div className="sd-burbuja sd-burbuja-cliente">{prueba}</div>
            {(respuesta.mensajes?.length ? respuesta.mensajes : [respuesta.texto]).map((m, i) => (
              <div key={i} className="sd-burbuja sd-burbuja-ia" style={{ whiteSpace: "pre-wrap" }}>
                {m}
              </div>
            ))}
            <p className="tenue" style={{ alignSelf: "flex-end" }}>
              {respuesta.modelo}
              {respuesta.fueRespaldo && " · respondió el respaldo"}
            </p>
          </div>
        )}
      </section>

      {error && (
        <div className="aviso aviso-error" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primario" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : `Guardar cambios en ${etiquetaCanal}`}
        </button>
        {nota && <span className="tenue">{nota}</span>}
        <span className="tenue" style={{ marginLeft: "auto" }}>
          {encendidos === 0
            ? "El agente no responde en ningún número."
            : `Responde en ${encendidos} número${encendidos === 1 ? "" : "s"}.`}
        </span>
      </div>
    </div>
  );
}
