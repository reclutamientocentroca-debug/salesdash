"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Conectar un número.
 *
 * El QR ES la pantalla, y ahora es el único camino: al conectar directamente
 * con WhatsApp no hay token que pegar ni proveedor donde crear nada. Se pone
 * un nombre, sale el código, se escanea.
 *
 * Se sondea cada 2 segundos mientras esta pantalla está abierta. Sin
 * WebSockets: el sondeo basta y es más simple. Al detectar la conexión, la
 * pantalla pasa sola al resumen, sin recargar.
 */

type Estado = "nombre" | "iniciando" | "esperando" | "escaneando" | "conectado" | "expirado" | "error";

const SONDEO_MS = 2000;

const TEXTOS: Record<Exclude<Estado, "nombre" | "conectado">, { punto: string; texto: string; pulso: boolean }> = {
  iniciando: { punto: "var(--amber)", texto: "Preparando el código…", pulso: true },
  esperando: { punto: "var(--amber)", texto: "Esperando a que escanees", pulso: true },
  escaneando: { punto: "var(--blue)", texto: "Conectando con WhatsApp…", pulso: true },
  expirado: { punto: "var(--ink-3)", texto: "El código venció", pulso: false },
  error: { punto: "var(--red)", texto: "Algo salió mal", pulso: false },
};

export default function ConectarNumero({ alConectar }: { alConectar: () => void }) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("nombre");
  const [nombre, setNombre] = useState("");
  const [canalId, setCanalId] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Evita que un sondeo en vuelo escriba sobre la pantalla ya desmontada.
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  async function crear() {
    setOcupado(true);
    setDetalle(null);

    try {
      const r = await fetch("/api/canales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      const datos = await r.json();

      if (!r.ok) {
        setDetalle(datos.error ?? "No pudimos conectar el número.");
        setOcupado(false);
        return;
      }

      setCanalId(datos.id);
      if (datos.estado === "conectado") {
        setPhone(datos.phone ?? null);
        setEstado("conectado");
      } else {
        setEstado("iniciando");
      }
    } catch {
      setDetalle("No hay conexión con el servidor.");
    }
    setOcupado(false);
  }

  /** Un ciclo de sondeo: primero el estado del canal, y el QR si hace falta. */
  const sondear = useCallback(async () => {
    if (!canalId) return;

    try {
      const rEstado = await fetch(`/api/canales/${canalId}/estado`, { cache: "no-store" });
      const salud = await rEstado.json();
      if (!vivo.current) return;

      if (salud.estado === "conectado") {
        setPhone(salud.phone ?? null);
        setDetalle(salud.aviso ?? null);
        setEstado("conectado");
        router.refresh();
        return;
      }

      if (salud.estado === "escaneando") {
        setEstado("escaneando");
        return;
      }

      // Sigue esperando el escaneo: se refresca el código.
      const rQr = await fetch(`/api/canales/${canalId}/qr`, { cache: "no-store" });
      const codigo = await rQr.json();
      if (!vivo.current) return;

      if (codigo.estado === "conectado") {
        setEstado("conectado");
        router.refresh();
        return;
      }
      if (codigo.estado === "expirado") {
        setEstado("expirado");
        setQr(null);
        return;
      }
      if (codigo.estado === "error") {
        setEstado("error");
        setDetalle(codigo.detalle ?? null);
        return;
      }

      if (codigo.base64) {
        setQr(codigo.base64);
        setEstado("esperando");
      } else {
        setEstado("iniciando");
      }
    } catch {
      // Un fallo suelto de red no rompe la pantalla: el siguiente ciclo reintenta.
    }
  }, [canalId, router]);

  useEffect(() => {
    if (!canalId) return;
    if (estado === "conectado" || estado === "expirado" || estado === "error") return;

    void sondear();
    const id = setInterval(sondear, SONDEO_MS);
    return () => clearInterval(id);
  }, [canalId, estado, sondear]);

  // ── Paso 1: el nombre ────────────────────────────────────────────────────
  if (estado === "nombre") {
    return (
      <div className="tarjeta" style={{ maxWidth: 440, margin: "0 auto" }}>
        <h2 className="h1-pagina" style={{ marginBottom: 4 }}>Conectar un número</h2>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginBottom: 18 }}>
          Ponle un nombre para reconocerlo en el panel. Después escaneas un código con tu
          WhatsApp, como cuando abres WhatsApp Web.
        </p>

        <label className="etiqueta-campo" htmlFor="nombre-canal">Nombre del número</label>
        <input
          id="nombre-canal"
          className="campo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ventas, Sucursal centro…"
          style={{ marginBottom: 14 }}
        />

        {detalle && (
          <div className="aviso aviso-error" role="alert" style={{ marginBottom: 14 }}>
            {detalle}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primario"
          style={{ width: "100%" }}
          disabled={ocupado || nombre.trim().length < 2}
          onClick={() => crear()}
        >
          {ocupado ? "Preparando…" : "Conectar número"}
        </button>

      </div>
    );
  }

  // ── Conectado ────────────────────────────────────────────────────────────
  if (estado === "conectado") {
    return (
      <div className="tarjeta" style={{ maxWidth: 440, margin: "0 auto", textAlign: "center" }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: "50%", background: "var(--acc-bg)", color: "var(--acc)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}
          aria-hidden="true"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </div>

        <h2 className="h1-pagina" style={{ marginBottom: 4 }}>Número conectado</h2>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginBottom: 6 }}>
          <strong style={{ color: "var(--ink)" }}>{nombre}</strong>
        </p>
        {phone && <p className="num tenue" style={{ marginBottom: 18 }}>+{phone}</p>}

        {detalle && (
          <div className="aviso aviso-ambar" style={{ marginBottom: 16, textAlign: "left" }}>
            {detalle}
          </div>
        )}

        <p className="tenue" style={{ marginBottom: 18 }}>
          Ya estamos recibiendo tus conversaciones. Las métricas aparecerán en cuanto lleguen los primeros mensajes.
        </p>

        <button type="button" className="btn btn-primario" style={{ width: "100%" }} onClick={alConectar}>
          Listo
        </button>
      </div>
    );
  }

  // ── El QR ────────────────────────────────────────────────────────────────
  const t = TEXTOS[estado];

  return (
    <div className="tarjeta" style={{ maxWidth: 440, margin: "0 auto", textAlign: "center" }}>
      <h2 className="h1-pagina" style={{ marginBottom: 4 }}>Escanea este código</h2>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginBottom: 18 }}>
        Desde el WhatsApp del número <strong style={{ color: "var(--ink)" }}>{nombre}</strong>.
      </p>

      <div
        style={{
          width: 232, height: 232, margin: "0 auto 18px", borderRadius: 12,
          border: "1px solid var(--line)", background: "var(--card)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 10,
        }}
      >
        {qr && estado === "esperando" ? (
          <img
            src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
            alt="Código QR para vincular tu WhatsApp"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span className="tenue" style={{ maxWidth: "22ch" }}>
            {estado === "expirado" ? "El código venció" : "Preparando el código…"}
          </span>
        )}
      </div>

      <ol
        style={{
          textAlign: "left", display: "grid", gap: 7, fontSize: 12.5,
          color: "var(--ink-2)", maxWidth: 270, margin: "0 auto 18px",
        }}
      >
        <li>1. Abre WhatsApp en tu teléfono</li>
        <li>2. Entra a Ajustes › Dispositivos vinculados</li>
        <li>3. Toca «Vincular un dispositivo» y escanea</li>
      </ol>

      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 }}
        role="status"
        aria-live="polite"
      >
        <span className={`punto${t.pulso ? " punto-pulso" : ""}`} style={{ background: t.punto }} />
        <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{t.texto}</span>
      </div>

      {detalle && (
        <div className="aviso aviso-error" style={{ marginBottom: 14, textAlign: "left" }}>
          {detalle}
        </div>
      )}

      {(estado === "expirado" || estado === "error") && (
        <button
          type="button"
          className="btn btn-primario"
          style={{ width: "100%" }}
          onClick={() => {
            setEstado("iniciando");
            setDetalle(null);
            void sondear();
          }}
        >
          Generar nuevo código
        </button>
      )}
    </div>
  );
}
