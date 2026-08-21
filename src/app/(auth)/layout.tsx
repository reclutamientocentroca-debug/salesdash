import Image from "next/image";
import logo from "../../../public/marca-salesdash.png";

/**
 * Pantalla partida de autenticación.
 *
 * Izquierda: el argumento del producto sobre el lienzo del escaparate.
 * Derecha: 466px fijos con el formulario. Bajo 900px la izquierda desaparece,
 * el lienzo pasa a la derecha y la marca reaparece sobre la tarjeta — porque
 * si no, el móvil se queda sin ver el logotipo en ningún momento.
 *
 * El logotipo se coloca solo aquí, y solo aquí puede colocarse: en el archivo
 * original «Sales» y el lema son blancos, así que sobre una superficie clara
 * la mitad del logotipo desaparece. Esta pantalla es oscura y es su sitio. La
 * barra lateral, que es clara, se queda con el logotipo tipográfico, donde
 * «Sales» hereda la tinta y solo «Dash» lleva el degradado.
 *
 * Importado como módulo en vez de escribir la ruta a mano: así Next conoce el
 * tamaño real, reserva el hueco antes de descargarla —sin salto de maquetación
 * al cargar— y sirve el formato moderno que acepte cada navegador.
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
        {/* `priority`: es la imagen más grande de la mitad visible, así que
            Next la carga sin esperar al observador de visibilidad. */}
        <Image src={logo} alt="SalesDash" width={288} priority className="auth-logo" />

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

      <main className="auth-derecha">
        <div className="auth-marca-movil">
          <Image src={logo} alt="SalesDash" width={252} priority className="auth-logo" />
        </div>
        {children}
      </main>
    </div>
  );
}
