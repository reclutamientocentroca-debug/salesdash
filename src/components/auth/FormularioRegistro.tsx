"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

/** Barra de tres pasos: crear cuenta, confirmar correo, conectar un número. */
function Pasos({ actual }: { actual: 1 | 2 | 3 }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {[1, 2, 3].map((p) => (
          <div key={p} className={`paso${p <= actual ? " paso-hecho" : ""}`} />
        ))}
      </div>
      <div className="rotulo">Paso {actual} de 3 · Crea tu cuenta</div>
    </div>
  );
}

export default function FormularioRegistro() {
  const router = useRouter();
  const [datos, setDatos] = useState({ nombre: "", negocio: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cambiar = (campo: keyof typeof datos) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDatos((d) => ({ ...d, [campo]: e.target.value }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (datos.password.length < 8) {
      setError("La contraseña necesita al menos 8 caracteres.");
      return;
    }

    setCargando(true);
    try {
      const r = await fetch("/api/auth/registro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(datos),
      });
      const respuesta = await r.json();

      if (!r.ok) {
        setError(respuesta.error ?? "No pudimos crear la cuenta. Intenta de nuevo.");
        setCargando(false);
        return;
      }
      router.push(`/verificar?correo=${encodeURIComponent(datos.email)}`);
    } catch {
      setError("No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.");
      setCargando(false);
    }
  }

  return (
    <div className="tarjeta" style={{ padding: "26px 24px" }}>
      <Pasos actual={1} />

      <h1 className="h1-pagina" style={{ marginBottom: 4 }}>
        Crea tu cuenta
      </h1>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 20 }}>
        En dos minutos estás viendo tus primeras métricas.
      </p>

      <form onSubmit={enviar} noValidate>
        <div style={{ marginBottom: 13 }}>
          <label className="etiqueta-campo" htmlFor="nombre">Tu nombre</label>
          <input id="nombre" className="campo" required autoComplete="name"
            value={datos.nombre} onChange={cambiar("nombre")} placeholder="Ana Rodríguez" />
        </div>

        <div style={{ marginBottom: 13 }}>
          <label className="etiqueta-campo" htmlFor="negocio">Nombre de tu negocio</label>
          <input id="negocio" className="campo" required autoComplete="organization"
            value={datos.negocio} onChange={cambiar("negocio")} placeholder="Tienda Bella" />
        </div>

        <div style={{ marginBottom: 13 }}>
          <label className="etiqueta-campo" htmlFor="email">Correo</label>
          <input id="email" className="campo" type="email" required autoComplete="email"
            value={datos.email} onChange={cambiar("email")} placeholder="tu@correo.com" />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label className="etiqueta-campo" htmlFor="password">Contraseña</label>
          <input id="password" className="campo" type="password" required autoComplete="new-password"
            value={datos.password} onChange={cambiar("password")} placeholder="Mínimo 8 caracteres" />
        </div>

        {error && (
          <div className="aviso aviso-error" role="alert" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primario" style={{ width: "100%" }} disabled={cargando}>
          {cargando ? "Creando la cuenta…" : "Crear cuenta"}
        </button>
      </form>

      <p style={{ marginTop: 18, fontSize: 13, color: "var(--ink-2)", textAlign: "center" }}>
        ¿Ya tienes cuenta? <Link href="/login" className="enlace">Entra</Link>
      </p>
    </div>
  );
}
