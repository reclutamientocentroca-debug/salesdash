import Link from "next/link";
import { Burbuja } from "@/components/panel/Burbuja";
import { Pastilla, Vacio, dinero, hace } from "@/components/panel/Piezas";
import {
  bandeja,
  getConversation,
  listarCanales,
  listarMensajes,
  type EstadoCierre,
  type FilaBandeja,
} from "@/lib/db";
import { requerirSesion } from "@/lib/tenant";

export const metadata = { title: "Conversaciones · SalesDash" };
export const dynamic = "force-dynamic";

/**
 * La bandeja, con la forma de un cliente de mensajería: la lista de chats a la
 * izquierda y el hilo abierto a la derecha.
 *
 * UNA BANDEJA POR NÚMERO, y esto es lo importante. Cada número conectado tiene
 * la suya, como tendría su propio WhatsApp. No hay una vista «todos los
 * números» ni la va a haber por descuido: dos números son dos negocios, o dos
 * sucursales, o dos personas atendiendo — y mezclar sus hilos en una sola lista
 * hace imposible saber a cuál de tus números escribió el cliente, que es
 * precisamente lo que hay que saber para contestarle.
 *
 * Todo el estado va en la URL (`canal`, `chat`, `estado`) en vez de en el
 * cliente: así un hilo abierto se puede compartir por enlace, el botón atrás
 * del navegador funciona, y la página sigue renderizándose en el servidor sin
 * necesitar JavaScript para pintar la bandeja.
 */

const FILTROS: { clave: string; texto: string }[] = [
  { clave: "", texto: "Todas" },
  { clave: "ia", texto: "Cerró la IA" },
  { clave: "humano", texto: "Cerró el equipo" },
  { clave: "abierta", texto: "Sin cerrar" },
  { clave: "revision", texto: "En revisión" },
];

interface Props {
  searchParams: Promise<{ rango?: string; estado?: string; canal?: string; chat?: string }>;
}

export default async function PaginaConversaciones({ searchParams }: Props) {
  const ctx = await requerirSesion();
  const { rango: clave = "7d", estado, canal: canalParam, chat: chatParam } = await searchParams;

  /*
   * Solo los números REALMENTE vinculados tienen bandeja.
   *
   * Crear un número en el panel no lo conecta a nada: hasta que alguien escanea
   * su QR no existe como WhatsApp, no puede recibir un mensaje y su bandeja
   * estaría vacía por definición. Una pestaña ahí solo sirve para hacer creer
   * que ese número está atendiendo.
   *
   * El teléfono es la marca de que se escaneó: hasta entonces la fila guarda un
   * `pendiente:…`, y el número real lo escribe `wa.ts` cuando WhatsApp confirma
   * la vinculación. Se usa eso y no `estado` porque el estado va y viene con
   * cada reconexión, y una bandeja no puede aparecer y desaparecer porque el
   * socket se haya caído medio minuto.
   */
  const canales = listarCanales(ctx.orgId).filter(
    (c) => c.activo === 1 && !c.phone.startsWith("pendiente:"),
  );

  if (canales.length === 0) {
    // Hay números creados pero ninguno escaneado: es un caso distinto de no
    // tener ninguno, y merece un texto distinto o el usuario se queda mirando
    // una pantalla vacía sin saber que le falta un paso.
    const sinEscanear = listarCanales(ctx.orgId).filter((c) => c.activo === 1).length;

    return (
      <>
        <div className="sd-cabecera">
          <h1 className="h1-pagina">Conversaciones</h1>
        </div>
        <div className="tarjeta">
          <Vacio
            titulo={
              sinEscanear > 0
                ? "Te falta escanear el código"
                : "Todavía no hay ningún número conectado"
            }
            texto={
              sinEscanear > 0
                ? `Tienes ${sinEscanear} número${sinEscanear === 1 ? "" : "s"} creado${sinEscanear === 1 ? "" : "s"}, pero ninguno vinculado a un WhatsApp. Su bandeja aparece en cuanto escanees el QR desde el teléfono.`
                : "Conecta un número escaneando su código QR y aquí aparecerá su bandeja."
            }
          />
          <p style={{ textAlign: "center", marginTop: 12 }}>
            <Link href="/numeros" className="btn btn-primario" style={{ textDecoration: "none" }}>
              {sinEscanear > 0 ? "Ir a escanear el QR" : "Conectar un número"}
            </Link>
          </p>
        </div>
      </>
    );
  }

  // El número elegido, o el primero. Nunca «todos»: ver arriba.
  const pedido = Number(canalParam);
  const canal = canales.find((c) => c.id === pedido) ?? canales[0]!;

  const chats = bandeja(ctx.orgId, canal.id, {
    estado: (estado as EstadoCierre) || undefined,
    limite: 200,
  });

  /*
   * El hilo abierto tiene que pertenecer a ESTE número: al cambiar de bandeja,
   * el chat de la anterior no se arrastra.
   *
   * Si no se pidió ninguno, se abre el primero — el más reciente. Una bandeja
   * que se abre con el panel derecho vacío obliga a un clic para ver algo, y
   * ninguna aplicación de mensajería hace eso: entras y ya estás leyendo la
   * última conversación.
   */
  const pedidoChat = Number(chatParam);
  const elegidoAMano = Number.isInteger(pedidoChat) && chats.some((c) => c.id === pedidoChat);
  const elegido = elegidoAMano ? pedidoChat : (chats[0]?.id ?? null);

  const abierta = elegido === null ? undefined : getConversation(ctx.orgId, elegido);

  const mensajes = abierta ? listarMensajes(ctx.orgId, abierta.id) : [];

  const url = (cambios: { canal?: number; chat?: number | null; estado?: string }) => {
    const p = new URLSearchParams();
    p.set("rango", clave);
    p.set("canal", String(cambios.canal ?? canal.id));
    const est = cambios.estado ?? estado ?? "";
    if (est) p.set("estado", est);
    const c = cambios.chat === undefined ? abierta?.id : cambios.chat;
    if (c) p.set("chat", String(c));
    return `/conversaciones?${p.toString()}`;
  };

  return (
    <>
      <div className="sd-cabecera">
        <div>
          <h1 className="h1-pagina">Conversaciones</h1>
          <p className="tenue" style={{ marginTop: 2 }}>
            {chats.length} en la bandeja de <strong>{canal.nombre}</strong>
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTROS.map((f) => {
            const activo = (estado ?? "") === f.clave;
            return (
              <Link
                key={f.clave || "todas"}
                href={url({ estado: f.clave, chat: null })}
                className={`btn ${activo ? "btn-primario" : "btn-secundario"}`}
                style={{ textDecoration: "none", padding: "6px 12px", fontSize: 12.5 }}
              >
                {f.texto}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Una pestaña por número. Con uno solo no se enseña: no hay nada entre
          lo que elegir y sería ruido. */}
      {canales.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {canales.map((c) => (
            <Link
              key={c.id}
              href={url({ canal: c.id, chat: null })}
              className={`btn ${c.id === canal.id ? "btn-primario" : "btn-secundario"}`}
              style={{ textDecoration: "none", padding: "7px 13px", fontSize: 12.5 }}
            >
              {c.nombre}
              {!c.phone.startsWith("pendiente:") && (
                <span style={{ opacity: 0.7, marginLeft: 6 }}>+{c.phone}</span>
              )}
            </Link>
          ))}
        </div>
      )}

      {/*
        `con-hilo` marca que el usuario ELIGIÓ un chat, no que haya uno abierto.
        La diferencia importa solo en móvil, donde no caben los dos paneles: si
        se marcara por el hilo abierto, como ahora siempre se abre el primero,
        el teléfono enseñaría el hilo y nunca la lista.
      */}
      <div className={`sd-bandeja${elegidoAMano ? " con-hilo" : ""}`}>
        {/* ── Lista de chats ────────────────────────────────────────────── */}
        <div className="sd-bandeja-lista">
          {chats.length === 0 ? (
            <div style={{ padding: 22 }}>
              <Vacio
                titulo="Sin conversaciones"
                texto={`Cuando alguien escriba a ${canal.nombre}, su chat aparecerá aquí.`}
              />
            </div>
          ) : (
            chats.map((c) => (
              <Link
                key={c.id}
                href={url({ chat: c.id })}
                className={`sd-chat${abierta?.id === c.id ? " sd-chat-activo" : ""}`}
              >
                <div className="sd-chat-fila">
                  <span className="sd-chat-nombre">{c.cliente_nombre ?? `+${c.cliente_phone}`}</span>
                  <span className="sd-chat-hora">{hace(c.last_message_at)}</span>
                </div>

                <div className="sd-chat-previo">{vistaPrevia(c)}</div>

                <div className="sd-chat-pastillas">
                  <Pastilla estado={c.cerrado_por} />
                  {c.intervencion_humana === 1 && (
                    <span className="pastilla pastilla-intervencion">Intervino</span>
                  )}
                  {c.producto_anuncio && (
                    <span className="pastilla pastilla-abierta">{c.producto_anuncio}</span>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>

        {/* ── Hilo abierto ──────────────────────────────────────────────── */}
        <div className="sd-bandeja-hilo">
          {!abierta ? (
            <div style={{ margin: "auto", padding: 24, textAlign: "center", maxWidth: 320 }}>
              <p className="tenue" style={{ fontSize: 13 }}>
                Elige una conversación de la lista para leerla aquí.
              </p>
            </div>
          ) : (
            <>
              <div className="sd-bandeja-cabecera">
                {/* En móvil el hilo ocupa la pantalla entera y la lista se
                    esconde: sin esto no habría forma de volver a ella. */}
                <Link
                  href={url({ chat: null })}
                  className="btn btn-tenue solo-movil"
                  style={{ textDecoration: "none", padding: "4px 8px", fontSize: 12, flexShrink: 0 }}
                >
                  ← Chats
                </Link>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {abierta.cliente_nombre ?? "Sin nombre"}
                  </div>
                  <div className="num tenue" style={{ fontSize: 11.5 }}>
                    +{abierta.cliente_phone} · escribió a {canal.nombre}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  {abierta.total !== null && (
                    <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {dinero(abierta.total)}
                    </span>
                  )}
                  <Pastilla estado={abierta.cerrado_por} />
                  <Link
                    href={`/conversaciones/${abierta.id}?rango=${clave}`}
                    className="btn btn-secundario"
                    style={{ textDecoration: "none", padding: "5px 10px", fontSize: 12 }}
                  >
                    Ficha
                  </Link>
                </div>
              </div>

              {abierta.producto_anuncio && (
                <div
                  style={{
                    padding: "9px 16px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--card)",
                    fontSize: 12,
                  }}
                >
                  <strong>Llegó por un anuncio:</strong> {abierta.producto_anuncio}
                  {abierta.descripcion_anuncio && (
                    <div className="tenue" style={{ marginTop: 2 }}>{abierta.descripcion_anuncio}</div>
                  )}
                </div>
              )}

              <div className="sd-bandeja-hilo-cuerpo">
                {mensajes.length === 0 ? (
                  <p className="tenue" style={{ fontSize: 13 }}>Esta conversación no tiene mensajes.</p>
                ) : (
                  <div className="sd-hilo">
                    {mensajes.map((m) => (
                      <Burbuja key={m.id} m={m} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * La línea de vista previa. Lleva delante quién habló último, porque saber si
 * la última palabra fue del cliente —y por tanto está esperando respuesta— es
 * la mitad de la información que da una bandeja.
 */
function vistaPrevia(c: FilaBandeja): string {
  if (!c.ultimo_texto) return "Sin mensajes";

  const quien =
    c.ultimo_emisor === "cliente" ? "" : c.ultimo_emisor === "ia" ? "IA: " : "Tú: ";

  const texto = c.ultimo_texto.replace(/\s+/g, " ").trim();
  return `${quien}${texto}`;
}
