# SalesDash — imagen de producción.
#
# El proyecto también trae nixpacks.toml; este Dockerfile existe para que
# funcione igual con el método de build por Dockerfile, sin depender de qué
# opción esté marcada en el panel.
#
# Dos etapas: en la primera se compila (hacen falta python3, make y g++ para
# better-sqlite3 y argon2), y en la segunda solo queda lo necesario para
# ejecutar. Las dos usan la MISMA imagen base a propósito: los módulos
# nativos compilados arriba tienen que encajar abajo.

# ──────────────────────────────────────────────────────────────────────────
# Etapa 1 · compilación
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

# better-sqlite3 y argon2 compilan código nativo. Sin esto, npm ci falla.
#
# git tampoco es opcional: baileys depende de libsignal, que se instala desde un
# repositorio de GitHub y no desde npm. Sin git, `npm ci` se cae aquí mismo.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Las dependencias se copian aparte para que Docker reutilice esta capa
# mientras el lockfile no cambie: el build vuelve a ser rápido tras cada
# cambio de código.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

# NODE_ENV=production aquí para que Next compile de verdad en modo producción.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────
# Etapa 2 · ejecución
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

# sqlite3 no lo necesita la aplicación: se instala para poder inspeccionar la
# base desde la consola del contenedor (verificar una cuenta a mano, marcar
# un superadmin) sin tener que instalar nada en caliente.
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next        ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

# next.config.ts lo vuelve a leer `next start`, no solo `next build`. Si no
# está en la imagen, el servidor arranca con la configuración por defecto y sin
# decir nada.
COPY --from=build /app/next.config.ts ./next.config.ts

# `next start` sirve /public desde el disco, no desde .next: sin esto el
# logotipo devuelve 404 en producción aunque el build haya ido bien.
COPY --from=build /app/public ./public

# src y scripts viajan a la imagen para poder ejecutar dentro del contenedor
# `npm run seed` y `npm run probar-correo`, que son los dos comandos que hacen
# falta al poner en marcha un despliegue nuevo.
COPY --from=build /app/src     ./src
COPY --from=build /app/scripts ./scripts

# Punto de montaje del volumen. Si EasyPanel no monta nada aquí, la aplicación
# funciona igual pero pierde todas las cuentas en el siguiente redespliegue;
# /api/salud lo detecta y lo avisa.
RUN mkdir -p /app/data

EXPOSE 3000

# El health check va contra /api/salud, que responde 200 mientras la
# aplicación esté viva (los avisos de configuración NO la marcan como caída:
# eso reiniciaría el contenedor en bucle y dejaría el sitio en 500).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3   CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `next start -H 0.0.0.0`: dentro de un contenedor, escuchar solo en localhost
# lo deja inalcanzable para el proxy.
CMD ["npm", "run", "start"]
