/**
 * Marca SalesDash.
 *
 * El símbolo es SVG, no una imagen: escala sin pesar, se ve nítido en pantallas
 * de alta densidad y hereda el color del texto donde hace falta.
 *
 * La línea ascendente y sus nodos usan `currentColor` a propósito. Sobre el
 * fondo oscuro de la portada son blancos; sobre una superficie clara —la barra
 * lateral— toman la tinta y siguen viéndose. Con blanco fijo desaparecerían.
 *
 * `id` distingue el degradado cuando hay más de un símbolo en la misma página:
 * dos `<linearGradient>` con el mismo id se pisan y el segundo se dibuja mal.
 */

interface PropsSimbolo {
  tamano?: number;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Simbolo({ tamano = 32, id = "marca", className, style }: PropsSimbolo) {
  const grad = `${id}-grad`;

  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="10" y1="54" x2="54" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2f7ff0" />
          <stop offset="0.52" stopColor="#1fa8c9" />
          <stop offset="1" stopColor="#2ed8a7" />
        </linearGradient>
      </defs>

      {/* Marco */}
      <rect x="9" y="9" width="46" height="46" rx="11" stroke={`url(#${grad})`} strokeWidth="3.6" />

      {/* Barras, apoyadas en el borde inferior */}
      <g fill={`url(#${grad})`}>
        <rect x="18.5" y="38" width="8" height="12" rx="2" />
        <rect x="30" y="31" width="8" height="19" rx="2" />
        <rect x="41.5" y="24" width="8" height="26" rx="2" />
      </g>

      {/* Tendencia: cruza el marco por la esquina, como en el logotipo */}
      <path
        d="M17 43.5 L27.5 35.5 L38.5 27.5 L50.5 14.5"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="currentColor">
        <circle cx="17" cy="43.5" r="3.1" />
        <circle cx="27.5" cy="35.5" r="3.1" />
        <circle cx="38.5" cy="27.5" r="3.1" />
        <circle cx="50.5" cy="14.5" r="3.5" />
      </g>
    </svg>
  );
}

interface PropsLogo {
  /** Alto del símbolo en píxeles. El texto se dimensiona a partir de él. */
  tamano?: number;
  /** Muestra el lema bajo el logotipo. Solo tiene sentido a tamaño grande. */
  lema?: boolean;
  id?: string;
  className?: string;
}

/** Símbolo + logotipo. `Sales` en la tinta heredada, `Dash` en el degradado. */
export function Logo({ tamano = 34, lema = false, id = "logo", className }: PropsLogo) {
  const cuerpo = (
    <span className={`marca${className ? ` ${className}` : ""}`}>
      <Simbolo tamano={tamano} id={id} />
      <span className="marca-texto" style={{ fontSize: Math.round(tamano * 0.72) }}>
        Sales<span className="marca-degradado">Dash</span>
      </span>
    </span>
  );

  if (!lema) return cuerpo;

  return (
    <span className="marca-bloque">
      {cuerpo}
      <span className="marca-lema">
        <i aria-hidden="true" />
        Datos que impulsan decisiones
        <i aria-hidden="true" />
      </span>
    </span>
  );
}
