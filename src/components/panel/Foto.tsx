"use client";

import { useState, type ReactNode } from "react";

/**
 * Una foto del hilo que sabe fallar.
 *
 * El archivo se sirve por una ruta con sesión y puede no estar: se borró del
 * volumen, no se llegó a descargar, o WhatsApp lo mandó cifrado y caducó. El
 * navegador, ante una imagen rota, pinta un icono roto con el texto
 * alternativo encima del color del globo — ilegible. Aquí, si no carga, se
 * enseña en su lugar la fila con la descripción, la misma que ve la IA.
 */
export function Foto({ src, alt, fallback }: { src: string; alt: string; fallback: ReactNode }) {
  const [rota, setRota] = useState(false);
  if (rota) return <>{fallback}</>;
  return (
    // Sin next/image: la ruta exige sesión y su optimizador no la lleva.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setRota(true)}
      style={{ display: "block", maxWidth: "100%", borderRadius: 8, marginBottom: 6 }}
    />
  );
}
