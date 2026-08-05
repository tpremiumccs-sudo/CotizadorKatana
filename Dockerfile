# ═══════════════════════════════════════════════════════════════════════════
#  Cotizador Katana Talent
#
#  Imagen única con la app Next.js en modo standalone MÁS Chromium, porque el
#  PDF se genera imprimiendo el mismo HTML que alimenta la vista previa.
#
#  Base Debian (bookworm-slim) y no Alpine: Chromium sobre musl da fallos de
#  fuentes y de sandbox que no vale la pena pelear en un servidor de una agencia.
# ═══════════════════════════════════════════════════════════════════════════

ARG NODE_IMAGE=node:22-bookworm-slim

# ─────────────────────────── 1. Dependencias ───────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ──────────────────────────── 2. Compilación ────────────────────────────
FROM deps AS builder
WORKDIR /app

# El dominio público NO es un valor de relleno: `next.config.ts` lo lee en
# tiempo de build y lo deja serializado en `allowedOrigins`. Con el valor
# equivocado, las Server Actions mueren en cuanto Cloudflare reescriba el
# `Host`, y ninguna variable de entorno lo arregla — hay que reconstruir.
ARG APP_PUBLIC_URL="http://localhost:3000"

COPY prisma ./prisma
RUN npx prisma generate
COPY . .
# Relleno para lo que `next build` valida al importar src/env.ts. Esto sí no
# queda en la imagen: en ejecución mandan las variables reales.
#
# `NODE_OPTIONS` acota el montón de V8: compilar Next sin techo en una máquina
# de 2 vCPU y 4 GB —que es el servidor de la agencia— se lleva la memoria por
# delante. `SALTAR_TYPECHECK` evita que `next build` vuelva a type-chequear
# también los tests; de eso ya se encarga CI en un paso propio.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    APP_PUBLIC_URL=${APP_PUBLIC_URL} \
    NODE_OPTIONS="--max-old-space-size=1536" \
    SALTAR_TYPECHECK=1
RUN npm run build

# El seed empaquetado a un solo archivo. La imagen de ejecución NO tiene `tsx`
# —es devDependency— ni el árbol `src/`, así que un `.ts` con imports locales
# no puede correr allí. esbuild deja las dependencias de node_modules fuera
# (`@prisma/client` y `@node-rs/argon2` sí están en el bundle standalone) e
# incorpora el import local de `src/server/import/catalogo`.
#
# El binario local, no `npx --yes esbuild@X`: así la versión sale del
# package-lock y no de una descarga a mitad del build, que además traía una
# versión distinta de la que usa el resto del proyecto.
RUN ./node_modules/.bin/esbuild prisma/seed.ts \
      --bundle --platform=node --format=esm --packages=external \
      --outfile=prisma/seed.mjs

# ─────────────────── 3. Chromium y fuentes del documento ───────────────────
FROM ${NODE_IMAGE} AS browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
# Solo Chromium. --with-deps trae las librerías del sistema que necesita.
RUN npx --yes playwright@1.56.0 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# ─────────────────── 3.b CLI de Prisma para las migraciones ───────────────────
# El CLI carga `@prisma/config` en ámbito de módulo, y éste requiere `effect` y
# `empathic/package`. En el árbol del builder viven hoisted en la raíz, así que
# copiar sólo `node_modules/prisma` deja el CLI sin sus dependencias y
# `migrate deploy` muere con MODULE_NOT_FOUND — el contenedor entra en bucle de
# reinicio y nunca arranca.
#
# Se instala aparte y se copia entero en vez de enumerar a mano lo que hace
# falta: esa lista se rompe en cuanto Prisma cambie de dependencias.
FROM ${NODE_IMAGE} AS prisma-cli
WORKDIR /cli
# SIN `--ignore-scripts`, al revés que la etapa `deps`: el postinstall de
# `@prisma/engines` es quien descarga el **schema-engine**, que es el binario
# que `migrate deploy` usa. Saltándolo, el CLI intentaría bajárselo de
# binaries.prisma.sh en CADA arranque del contenedor.
#
# La versión se deriva de package.json en vez de escribirse a mano, para que no
# pueda quedar desalineada con el cliente generado.
#
# El archivo se copia FUERA de /cli y conservando la extensión `.json`. Las dos
# cosas importan: fuera, porque `npm init -y` escribe un package.json aquí y
# pisaría el original; con extensión `.json`, porque `require()` elige el
# cargador por la extensión y con una desconocida cae al de JavaScript — un JSON
# leído como JS revienta en el primer `:`. Así falló la primera construcción.
COPY package.json /tmp/version-prisma.json
RUN PV="$(node -p "require('/tmp/version-prisma.json').devDependencies.prisma")" \
    && case "$PV" in ''|undefined) echo "No se pudo leer la versión de prisma de package.json" >&2; exit 1;; esac \
    && echo "[imagen] CLI de Prisma: ${PV}" \
    && npm init -y >/dev/null \
    && npm install --no-audit --no-fund "prisma@${PV}"

# ───────────────────────────── 4. Ejecución ─────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# CHECKPOINT_DISABLE: el CLI de Prisma llama a checkpoint.prisma.io en cada
# ejecución, y aquí se ejecuta en cada arranque del contenedor. Son segundos de
# espera a cambio de nada, y una llamada saliente que este servidor no necesita.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# fonts-urw-base35 trae Nimbus Sans, el clon de Helvetica con el que se calibra
# el documento. fonts-liberation queda de respaldo (métricas de Arial).
# Sin estas fuentes el PDF NO sale idéntico al original.
ARG PG_MAJOR=16

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini gnupg curl \
    && rm -rf /var/lib/apt/lists/*

# `pg_dump` de la MISMA versión mayor que el servidor. El de bookworm es el 15
# y el servicio corre postgres:16: pg_dump se niega a volcar de un servidor más
# nuevo, el respaldo previo falla y la importación del CRM queda bloqueada por
# completo. Por eso se trae del repositorio de PostgreSQL, no del de Debian.
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] \
https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-${PG_MAJOR} \
    && rm -rf /var/lib/apt/lists/*

# fonts-urw-base35 trae Nimbus Sans, el clon de Helvetica con el que se calibra
# el documento. fonts-liberation queda de respaldo (métricas de Arial).
# Sin estas fuentes el PDF NO sale idéntico al original.
#
# `fontconfig` es quien aporta `fc-cache`: los paquetes de fuentes sólo traen
# `libfontconfig1`, que no incluye el binario. Sin él la línea de abajo sale
# 127 y mata la etapa. En CI no se nota porque el runner de GitHub ya lo tiene.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fontconfig \
      fonts-urw-base35 fonts-liberation fonts-dejavu-core \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

COPY --from=browsers /ms-playwright /ms-playwright

# La salida standalone trae su propio node_modules mínimo.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Fuentes y logo del documento. NO son opcionales: se leen desde el disco con
# `process.cwd()` y se embeben en el HTML, así que sin ellas no hay vista previa
# ni PDF — falla la generación entera, no sólo la tipografía.
COPY --from=builder /app/assets ./assets

# Migraciones y esquema.
COPY --from=builder /app/prisma ./prisma
# El motor de consultas que usa la app en ejecución.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# El CLI, con SU árbol de dependencias completo, en una ruta aparte. Se usa sólo
# al arrancar, para `migrate deploy`; no se mezcla con el node_modules de la app.
COPY --from=prisma-cli /cli/node_modules /opt/prisma-cli/node_modules

COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Usuario sin privilegios. `node` ya existe en la imagen oficial con uid 1000.
RUN mkdir -p /var/lib/katana && chown -R node:node /var/lib/katana /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
