"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const CASILLAS = 6;
const ESPERA_REENVIO = 30; // segundos antes de poder pedir otro código

function Sobre() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 52, height: 52, borderRadius: 12, background: "var(--acc-bg)",
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="1.6">
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
        <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function FormularioVerificar({ correo }: { correo: string }) {
  const router = useRouter();
  const [digitos, setDigitos] = useState<string[]>(Array(CASILLAS).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [espera, setEspera] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const enviado = useRef(false);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function comprobar(codigo: string) {
    if (enviado.current) return;
    enviado.current = true;
    setCargando(true);
    setError(null);

    try {
      const r = await fetch("/api/auth/verificar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: correo, codigo }),
      });
      const datos = await r.json();

      if (!r.ok) {
        setError(
          datos.restantes > 0
            ? `${datos.error} Te quedan ${datos.restantes} intento${datos.restantes === 1 ? "" : "s"}.`
            : (datos.error ?? "El código no es correcto."),
        );
        setDigitos(Array(CASILLAS).fill(""));
        refs.current[0]?.focus();
        setCargando(false);
        enviado.current = false;
        return;
      }
      router.push("/numeros");
    } catch {
      setError("No hay conexión con el servidor. Intenta de nuevo.");
      setCargando(false);
      enviado.current = false;
    }
  }

  function escribir(i: number, valor: string) {
    const limpio = valor.replace(/\D/g, "");
    if (!limpio) {
      // Borrado
      setDigitos((d) => d.map((x, j) => (j === i ? "" : x)));
      return;
    }

    setDigitos((d) => {
      const nuevo = [...d];
      // Si pegan el código completo, se reparte entre las casillas.
      for (let k = 0; k < limpio.length && i + k < CASILLAS; k++) nuevo[i + k] = limpio[k]!;
      const siguiente = Math.min(i + limpio.length, CASILLAS - 1);
      refs.current[siguiente]?.focus();

      const completo = nuevo.join("");
      if (completo.length === CASILLAS && !completo.includes("")) void comprobar(completo);
      return nuevo;
    });
  }

  function tecla(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digitos[i] && i > 0) {
      e.preventDefault();
      setDigitos((d) => d.map((x, j) => (j === i - 1 ? "" : x)));
      refs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < CASILLAS - 1) refs.current[i + 1]?.focus();
  }

  async function reenviar() {
    setError(null);
    setNota(null);
    setEspera(ESPERA_REENVIO);

    try {
      const r = await fetch("/api/auth/reenviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: correo }),
      });
      const datos = await r.json();
      if (!r.ok) {
        setError(datos.error ?? "No pudimos enviar el código.");
        setEspera(0);
        return;
      }
      setNota("Listo, te mandamos un código nuevo.");
      setDigitos(Array(CASILLAS).fill(""));
      refs.current[0]?.focus();
    } catch {
      setError("No hay conexión con el servidor. Intenta de nuevo.");
      setEspera(0);
    }
  }

  return (
    <div className="tarjeta" style={{ padding: "26px 24px" }}>
      <Sobre />

      <h1 className="h1-pagina" style={{ marginBottom: 6 }}>
        Revisa tu correo
      </h1>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 20 }}>
        Te mandamos un código de 6 dígitos a <strong style={{ color: "var(--ink)" }}>{correo}</strong>.
        Escríbelo aquí para terminar.
      </p>

      <div
        style={{ display: "flex", gap: 8, marginBottom: 16 }}
        role="group"
        aria-label="Código de verificación de 6 dígitos"
      >
        {digitos.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="casilla-codigo"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={CASILLAS}
            value={d}
            disabled={cargando}
            aria-label={`Dígito ${i + 1}`}
            onChange={(e) => escribir(i, e.target.value)}
            onKeyDown={(e) => tecla(i, e)}
          />
        ))}
      </div>

      {error && (
        <div className="aviso aviso-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      {nota && (
        <div className="aviso aviso-acento" role="status" style={{ marginBottom: 14 }}>
          {nota}
        </div>
      )}

      <p className="tenue" style={{ marginBottom: 14 }}>
        El código vence en 15 minutos.
      </p>

      <button type="button" className="btn btn-secundario" style={{ width: "100%" }}
        onClick={reenviar} disabled={espera > 0 || cargando}>
        {espera > 0 ? `Puedes pedir otro en ${espera}s` : "Enviar un código nuevo"}
      </button>
    </div>
  );
}
