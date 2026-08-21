"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

export default function FormularioLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const datos = await r.json();

      if (datos.verificar) {
        router.push(`/verificar?correo=${encodeURIComponent(datos.email)}`);
        return;
      }
      if (!r.ok) {
        setError(datos.error ?? "No pudimos entrar. Intenta de nuevo.");
        setCargando(false);
        return;
      }
      router.push(datos.superadmin ? "/admin" : "/dashboard");
    } catch {
      setError("No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.");
      setCargando(false);
    }
  }

  return (
    <div className="tarjeta" style={{ padding: "26px 24px" }}>
      <h1 className="h1-pagina" style={{ marginBottom: 4 }}>
        Entra a tu cuenta
      </h1>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 22 }}>
        Tus números y tus métricas te esperan.
      </p>

      <form onSubmit={enviar} noValidate>
        <div style={{ marginBottom: 14 }}>
          <label className="etiqueta-campo" htmlFor="email">
            Correo
          </label>
          <input
            id="email"
            className="campo"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label className="etiqueta-campo" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            className="campo"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="aviso aviso-error" role="alert" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primario" style={{ width: "100%" }} disabled={cargando}>
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <p style={{ marginTop: 18, fontSize: 13, color: "var(--ink-2)", textAlign: "center" }}>
        ¿Todavía no tienes cuenta? <Link href="/registro" className="enlace">Crea una</Link>
      </p>
    </div>
  );
}
