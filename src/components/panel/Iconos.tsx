/**
 * Iconos de línea de 16px, dibujados a mano.
 *
 * Sin librería: son diez trazos y una dependencia menos que auditar. Todos
 * comparten grosor 1.6 y heredan el color del texto.
 */
interface Props {
  tam?: number;
  className?: string;
}

function Svg({ tam = 16, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconoDashboard = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="8.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.6" />
    <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.6" />
  </Svg>
);

export const IconoNumeros = (p: Props) => (
  <Svg {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.6" />
    <path d="M10.5 18.5h3" />
  </Svg>
);

export const IconoConversaciones = (p: Props) => (
  <Svg {...p}>
    <path d="M20.5 12.5c0 4-3.8 7.2-8.5 7.2-1 0-2-.15-2.9-.42L4 21l1.4-3.6C4.2 16.1 3.5 14.4 3.5 12.5c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z" />
  </Svg>
);

export const IconoMessenger = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.2c-4.9 0-8.8 3.6-8.8 8.1 0 2.5 1.2 4.7 3.2 6.2v3.3l3-1.6c.8.2 1.7.35 2.6.35 4.9 0 8.8-3.6 8.8-8.1S16.9 3.2 12 3.2Z" />
    <path d="m7.4 14.2 3.1-3.3 2 2.1 3.1-3.3" />
  </Svg>
);

export const IconoAgente = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4.5M9.5 13.5v1.5M14.5 13.5v1.5M2.5 13h1.5M20 13h1.5" />
  </Svg>
);

export const IconoVentas = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 17.5 9 11l4 3.6 7.5-8" />
    <path d="M16.5 6.5h4v4" />
  </Svg>
);

export const IconoProductos = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
    <path d="m3.5 7.5 8.5 4.6 8.5-4.6M12 12.1V21" />
  </Svg>
);

export const IconoEquipo = (p: Props) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M2.8 20c0-3.2 2.8-5.3 6.2-5.3s6.2 2.1 6.2 5.3" />
    <path d="M16.5 6.2a3 3 0 0 1 0 5.6M18 14.9c2 .6 3.4 2.2 3.4 4.4" />
  </Svg>
);

export const IconoConfiguracion = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
  </Svg>
);

export const IconoRevision = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.2 21 19H3l9-15.8Z" />
    <path d="M12 9.5v4M12 16.4v.1" />
  </Svg>
);

export const IconoSalir = (p: Props) => (
  <Svg {...p}>
    <path d="M15 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M10 16.5 5.5 12 10 7.5M5.5 12h9" />
  </Svg>
);

export const IconoRayo = (p: Props) => (
  <Svg {...p}>
    <path d="M13.5 2.5 4.5 13.8h6L10 21.5l9.5-11.6h-6.4l.4-7.4Z" />
  </Svg>
);

export const IconoPersona = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20.5c0-3.7 3.3-6.2 7.5-6.2s7.5 2.5 7.5 6.2" />
  </Svg>
);

export const IconoReloj = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 7v5.3l3.3 2" />
  </Svg>
);

export const IconoMoneda = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M14.8 9.2c-.6-.9-1.7-1.4-2.9-1.4-1.7 0-2.9.9-2.9 2.1 0 3 5.9 1.4 5.9 4.4 0 1.3-1.3 2.2-3 2.2-1.3 0-2.4-.5-3-1.5M12 6v12" />
  </Svg>
);

export const IconoAdmin = (p: Props) => (
  <Svg {...p}>
    <path d="M12 2.8 20 6v6c0 4.6-3.3 8.3-8 9.2-4.7-.9-8-4.6-8-9.2V6l8-3.2Z" />
    <path d="m8.8 12 2.2 2.2 4.2-4.4" />
  </Svg>
);
