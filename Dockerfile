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
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
# Valores de relleno: `next build` importa src/env.ts, que valida el entorno.
# Nada de esto queda en la imagen — en tiempo de ejecución mandan las reales.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    APP_PUBLIC_URL="http://localhost:3000" \
    SESSION_SECRET="build-time-placeholder-secret-0123456789abcdef"
RUN npm run build

# ─────────────────── 3. Chromium y fuentes del documento ───────────────────
FROM ${NODE_IMAGE} AS browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
# Solo Chromium. --with-deps trae las librerías del sistema que necesita.
RUN npx --yes playwright@1.56.0 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# ───────────────────────────── 4. Ejecución ─────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# fonts-urw-base35 trae Nimbus Sans, el clon de Helvetica con el que se calibra
# el documento. fonts-liberation queda de respaldo (métricas de Arial).
# Sin estas fuentes el PDF NO sale idéntico al original.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini \
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

# Prisma: el CLI y el motor hacen falta para `migrate deploy` al arrancar.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

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
