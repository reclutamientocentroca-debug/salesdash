/**
 * El azulejo de la marca: el cuadrado con el degradado y la S del logotipo.
 *
 * Es el ÚNICO trozo de identidad que funciona sobre cualquier fondo. El
 * logotipo completo —`public/marca-salesdash.png`— lleva «Sales» y el lema en
 * blanco, así que sobre una superficie clara desaparece medio; por eso vive
 * solo en la pantalla de acceso, que es oscura. Esto se lleva su propio fondo
 * encima y da igual dónde se ponga.
 *
 * Es el mismo dibujo que `src/app/icon.svg`, que es el icono de pestaña. Están
 * duplicados a propósito: aquel tiene que ser un archivo suelto para que Next
 * lo detecte como favicon, y este tiene que ser un componente para poder
 * pintarse a distintos tamaños dentro de la aplicación. Si cambia uno, cambia
 * el otro.
 *
 * La S va trazada como recorrido y no como texto: así no depende de que haya
 * una tipografía disponible ni de cómo la calcule cada navegador.
 */

export function IconoMarca({
  tamano = 26,
  id = "icono",
  className,
}: {
  tamano?: number;
  id?: string;
  className?: string;
}) {
  const grad = `${id}-grad`;

  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2f7ff0" />
          <stop offset="0.52" stopColor="#1fa8c9" />
          <stop offset="1" stopColor="#2ed8a7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill={`url(#${grad})`} />
      <path
        d="M21.2 11C21.2 8.3 18.6 6.7 16 6.7C13.2 6.7 10.8 8.2 10.8 10.7C10.8 13.3 13 14.4 16 15.3C19 16.2 21.3 17.4 21.3 20.1C21.3 22.9 18.7 24.7 16 24.7C13.3 24.7 10.6 23.3 10.6 20.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
