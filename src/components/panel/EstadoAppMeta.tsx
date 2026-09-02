"use client";

import { useState } from "react";

/**
 * ¿PUEDE CONECTAR UN CLIENTE, O SOLO YO?
 *
 * La pregunta que no se podía contestar desde ninguna pantalla. El botón de
 * «Continuar con Facebook» se ve igual de bien esté la app de Meta en
 * Desarrollo o Activa; la diferencia es que en Desarrollo solo conecta quien
 * tiene un rol en ella, y todos los demás aterrizan en una pantalla de error de
 * Facebook y no vuelven. Desde aquí dentro eso se ve exactamente igual que si
 * nadie lo hubiera intentado nunca.
 *
 * Esto le pregunta a Meta y deja el resultado por escrito. Es de superadmin: la
 * app de Facebook es de la plataforma, no de la tienda que la usa.
 */
interface Rol {
  nombre: string | null;
  rol: string;
}

interface Estado {
  configuradas: boolean;
  credenciales: boolean;
  nombre: string | null;
  enlace: string | null;
  politicaUrl: string | null;
  terminosUrl: string | null;
  roles: Rol[] | null;
  error: string | null;
  urlDeVuelta: string;
  pendientes: string[];
}

export default function EstadoAppMeta() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function comprobar() {
    setCargando(true);
    setError(null);

    try {
      const r = await fetch("/api/meta/app", { method: "POST" });
      const datos = await r.json().catch(() => ({}));

      if (!r.ok) {
        setError(datos.error ?? "No se pudo comprobar la app.");
        return;
      }
      setEstado(datos as Estado);
    } catch {
      setError("No se pudo hablar con el servidor");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <h2 className="titulo-tarjeta" style={{ flex: 1 }}>Tu app de Facebook</h2>
        <button type="button" className="btn btn-tenue" disabled={cargando} onClick={comprobar}>
          {cargando ? "Preguntando a Meta…" : "Comprobar"}
        </button>
      </div>

      <p className="tenue" style={{ marginBottom: 12 }}>
        Es la misma para todas las cuentas del panel. Mientras siga en Desarrollo, solo conectan su
        página las personas con un rol en ella.
      </p>

      {error && (
        <div className="aviso aviso-error" role="alert">{error}</div>
      )}

      {estado && (
        <div style={{ display: "grid", gap: 12 }}>
          {!estado.credenciales ? (
            <div className="aviso aviso-error" role="status">
              {estado.error ?? "Meta no reconoció las credenciales de este servidor."}
            </div>
          ) : (
            <>{/* Lo de la app solo se puede enseñar si Meta llegó a contestar. */}
              <div style={{ fontSize: 12.5 }}>
                <span style={{ fontWeight: 600 }}>{estado.nombre ?? "(sin nombre)"}</span>
                {estado.enlace && (
                  <>
                    {" · "}
                    <a href={estado.enlace} target="_blank" rel="noreferrer noopener">
                      abrir en Meta
                    </a>
                  </>
                )}
              </div>

              {estado.error && (
                <div className="aviso aviso-ambar" role="status">{estado.error}</div>
              )}

              {/*
                QUIÉN PUEDE CONECTAR HOY. Es la respuesta literal a «mi cliente
                pulsa el botón y no pasa nada»: si la app está en Desarrollo,
                esta lista son las únicas personas del mundo que pueden.
              */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 5 }}>
                  Personas con rol en la app
                </div>
                {estado.roles === null ? (
                  <p className="tenue" style={{ fontSize: 12.5 }}>
                    Meta no dejó leer la lista. Mírala en tu app → Roles.
                  </p>
                ) : estado.roles.length === 0 ? (
                  <p className="tenue" style={{ fontSize: 12.5 }}>Ninguna.</p>
                ) : (
                  <ul style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
                    {estado.roles.map((r, i) => (
                      <li key={i} className="tenue">
                        <span className="num">{r.nombre ?? "(sin nombre)"}</span> — {r.rol}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="tenue" style={{ fontSize: 12.5, marginTop: 5 }}>
                  Si la app está en Desarrollo, solo estas personas pueden conectar una página.
                  Para que conecte cualquier cliente, la app tiene que estar Activa y con los
                  permisos aprobados por Meta.
                </p>
              </div>

            </>
          )}

          {/*
            LO QUE FALTA Y LA URL DE VUELTA VAN FUERA DEL «SI META CONTESTÓ».
            Cuando Meta NO contesta es justo cuando hacen más falta: dejarlas
            dentro las escondía en la única pantalla que iba a mirar quien tiene
            el problema.
          */}
          {estado.pendientes.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 5 }}>
                Lo que falta, por orden
              </div>
              <ol style={{ display: "grid", gap: 5, fontSize: 12.5, paddingLeft: 18 }}>
                {estado.pendientes.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ol>
            </div>
          )}

          {/*
            La dirección de vuelta tiene que estar dada de alta LETRA POR LETRA.
            Cuando no lo está, Facebook corta con «URL bloqueada» y el cliente ve
            un error de Facebook sin nada que pueda hacer.
          */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 5 }}>
              URI de redireccionamiento válido
            </div>
            <div
              className="num"
              style={{
                padding: "9px 11px", borderRadius: 8, background: "var(--soft)",
                fontSize: 12.5, wordBreak: "break-all",
              }}
            >
              {estado.urlDeVuelta || "(falta APP_URL)"}
            </div>
            <p className="tenue" style={{ fontSize: 12.5, marginTop: 5 }}>
              Va en tu app → Inicio de sesión con Facebook → Configuración. Si no está exacta,
              Facebook corta con «URL bloqueada».
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
