/**
 * Pantalla partida de autenticación.
 *
 * Izquierda: el argumento del producto, a pantalla completa sobre --ink.
 * Derecha: 466px fijos con el formulario. Bajo 900px la izquierda desaparece.
 */
const BENEFICIOS = [
  "Distingue las ventas que cierra tu IA de las que cierra tu equipo, aunque salgan del mismo número.",
  "Conecta tus números escaneando un código. Sin instalar nada.",
  "Descubre por qué se caen las conversaciones que no terminan en venta.",
];

function Palomita() {
  return (
    <span className="auth-palomita" aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M2.5 6.2l2.3 2.3L9.5 3.8"
          stroke="#ffffff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-marco">
      <aside className="auth-izquierda">
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>SalesDash</div>

        <div>
          <h1 className="auth-titular">
            Sabes cuánto vendes.
            <br />
            Ahora vas a saber
            <br />
            quién lo vendió.
          </h1>
          <p className="auth-apoyo" style={{ marginTop: 16 }}>
            En tu WhatsApp cierran ventas tu agente automático y tus vendedores, desde el mismo
            número. SalesDash mide cuánto pone cada uno.
          </p>
        </div>

        <ul style={{ display: "grid", gap: 13, maxWidth: "44ch" }}>
          {BENEFICIOS.map((b) => (
            <li key={b} className="auth-beneficio">
              <Palomita />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="auth-derecha">{children}</main>
    </div>
  );
}
