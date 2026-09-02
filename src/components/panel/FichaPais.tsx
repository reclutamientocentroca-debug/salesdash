"use client";

import { useEffect, useRef } from "react";
import type { PaisResumen } from "@/lib/paises";

/**
 * LA FICHA DEL PAÍS, FLOTANDO POR ENCIMA DEL PANEL.
 *
 * Elegir el país es la decisión que más cambia al agente y la que menos se ve:
 * de ahí salen la moneda, el trato, cómo se piden las direcciones, con qué paga
 * la gente y qué datos hacen falta para levantar un pedido. En la tarjeta caben
 * cinco líneas de resumen, y con cinco líneas nadie decide: el dueño elige por
 * el nombre, se queda con la duda de qué acaba de encender y, para curarse en
 * salud, vuelve a escribir en sus instrucciones lo que el país ya sabía.
 *
 * Por eso hay una ficha entera y por eso flota. Entera, porque lo que se
 * enseña es TODO lo que el modelo va a leer por haber pulsado ese país —sin
 * recortes, o volvemos a las cinco líneas—. Y flotando, porque esto se consulta
 * y se cierra: si viviera dentro del formulario, doscientas líneas de lectura
 * empujarían hacia abajo el guion y los modelos, que es donde de verdad se
 * trabaja.
 *
 * No se edita nada aquí, y es a propósito. Esto no es la configuración del
 * país: es lo que el sistema ya sabe de él. Lo que el negocio quiera cambiar
 * —sus precios, sus condiciones— va en sus instrucciones, y ahí manda él.
 */
export default function FichaPais({
  pais,
  activo,
  onCerrar,
  onElegir,
}: {
  pais: PaisResumen;
  /** ¿Es el país que este número tiene puesto? Cambia el pie, no el contenido. */
  activo: boolean;
  onCerrar: () => void;
  /** Elegir el país desde la propia ficha, que es donde se acaba de decidir. */
  onElegir: () => void;
}) {
  const cerrarRef = useRef<HTMLButtonElement>(null);

  /*
   * Escape cierra, y el foco entra en la ficha y vuelve por donde vino.
   *
   * Sin esto, quien abre la ficha con el teclado se queda tabulando por el
   * formulario de abajo —que sigue ahí, debajo del velo— sin ver dónde está el
   * cursor. `foco` guarda el botón que la abrió para devolvérselo al cerrar.
   */
  useEffect(() => {
    const foco = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();

    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", tecla);

    /* El fondo no scrollea mientras la ficha está abierta. */
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
      foco?.focus?.();
    };
  }, [onCerrar]);

  return (
    <div
      className="sd-velo"
      /* Solo el clic en el velo cierra: uno dentro de la ficha no debe. */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        className="sd-ficha"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ficha-pais-titulo"
        style={{ ["--pais" as string]: pais.color }}
      >
        <header className="sd-ficha-cabecera">
          <span className="sd-ficha-bandera" aria-hidden>
            {pais.bandera}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 id="ficha-pais-titulo" className="sd-ficha-titulo">
              {pais.nombre}
            </h2>
            <p className="sd-ficha-bajada">
              Lo que tu agente sabe de aquí en cuanto eliges este país. No hace falta que lo
              repitas en tus instrucciones.
            </p>
          </div>
          <button
            ref={cerrarRef}
            type="button"
            className="sd-ficha-cerrar"
            aria-label="Cerrar la ficha"
            onClick={onCerrar}
          >
            ✕
          </button>
        </header>

        <div className="sd-ficha-tiras">
          <Tira rotulo="Moneda" valor={`${pais.moneda.simbolo} · ${pais.moneda.codigo}`} />
          <Tira rotulo="Se escribe" valor={pais.moneda.ejemplo} />
          <Tira rotulo="Prefijo" valor={pais.prefijo} />
          <Tira rotulo="Hora" valor={pais.husoHorario.split("/")[1]?.replace(/_/g, " ") ?? pais.husoHorario} />
        </div>

        <div className="sd-ficha-cuerpo">
          <Bloque titulo="Cómo trata al cliente">
            <p className="sd-ficha-texto">{pais.tratamiento}</p>
          </Bloque>

          <Bloque titulo="Cómo habla la gente aquí">
            <ul className="sd-ficha-lista">
              {pais.expresiones.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <p className="tenue" style={{ marginTop: 6 }}>
              El agente las usa con cuentagotas, no en cada mensaje.
            </p>
          </Bloque>

          <Bloque titulo="Cómo se dan las direcciones">
            <p className="sd-ficha-texto">{pais.direcciones}</p>
          </Bloque>

          {/*
            LO QUE MÁS DINERO MUEVE DE TODA LA FICHA, y por eso va marcado.
            Sin uno de estos datos el paquete vuelve, y el que vuelve se paga
            dos veces. Aquí se ve lo que el agente va a exigir antes de dar un
            pedido por cerrado.
          */}
          <Bloque titulo="Sin esto no se levanta un pedido" fuerte>
            <ul className="sd-ficha-lista">
              {pais.datosParaCerrar.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Bloque>

          <Bloque titulo="Cómo llegan los pedidos">
            <ul className="sd-ficha-lista">
              {pais.entrega.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Bloque>

          <Bloque titulo="Con qué paga la gente">
            <ul className="sd-ficha-lista">
              {pais.pagos.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Bloque>

          {/*
            La zona cercana no es geografía: es la línea que parte la tarifa de
            envío en dos. Verla aquí es lo que evita cobrar el envío de la
            capital por un pedido del interior en cada venta.
          */}
          <Bloque titulo="Dónde llega tu mensajero el mismo día">
            <div className="sd-ficha-zonas">
              {pais.zonasCercanas.map((z) => (
                <span key={z} className="sd-ficha-zona sd-ficha-zona-cerca">
                  {z}
                </span>
              ))}
            </div>
            <p className="tenue" style={{ marginTop: 8 }}>
              Un pedido a estas zonas paga tu envío cercano; al resto del país, el lejano. El agente
              lo decide con la provincia del pin del mapa.
            </p>
          </Bloque>

          <Bloque titulo="Zonas que va a oír nombrar">
            <div className="sd-ficha-zonas">
              {pais.zonas.map((z) => (
                <span key={z} className="sd-ficha-zona">
                  {z}
                </span>
              ))}
            </div>
            <p className="tenue" style={{ marginTop: 8 }}>
              Y conoce {pais.ciudades} ciudades con sus coordenadas, para situar un pin del mapa y
              avisar cuando cae fuera de {pais.nombre}.
            </p>
          </Bloque>
        </div>

        <footer className="sd-ficha-pie">
          <p className="tenue" style={{ margin: 0, flex: 1, minWidth: 180 }}>
            Esto es para que el agente ENTIENDA al cliente y suene de aquí. Los precios, los plazos y
            las formas de pago que puede ofrecer salen solo de tu catálogo y de tus instrucciones.
          </p>
          {activo ? (
            <button type="button" className="btn btn-secundario" onClick={onCerrar}>
              Cerrar
            </button>
          ) : (
            <button type="button" className="btn sd-btn-pais" onClick={onElegir}>
              Vender en {pais.nombre}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Tira({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="sd-ficha-tira">
      <span className="rotulo">{rotulo}</span>
      <strong className="sd-ficha-tira-valor">{valor}</strong>
    </div>
  );
}

function Bloque({
  titulo,
  fuerte,
  children,
}: {
  titulo: string;
  fuerte?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`sd-ficha-bloque ${fuerte ? "sd-ficha-bloque-fuerte" : ""}`}>
      <h3 className="sd-ficha-bloque-titulo">{titulo}</h3>
      {children}
    </section>
  );
}
