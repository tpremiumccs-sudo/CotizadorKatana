#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  Arranque del contenedor de la app.
#
#  Migra y siembra ANTES de levantar el servidor. Con `replicas: 1` no hay
#  carrera posible; si algún día hay más de una réplica, esto debe moverse a un
#  job aparte.
#
#  Si algo de esto falla, el contenedor NO arranca. Es deliberado: una app en
#  pie contra una base a medio migrar, o sin un solo usuario con el que entrar,
#  es peor que una app que no levanta y lo dice.
# ═══════════════════════════════════════════════════════════════════════════
set -eu

# El CLI de Prisma vive con su propio árbol de dependencias: carga
# `@prisma/config`, que requiere `effect` y `empathic/package`, y ninguno de
# esos está en el node_modules mínimo de la salida standalone. Copiar sólo
# `node_modules/prisma` dejaba el CLI sin sus dependencias y el contenedor
# entraba en bucle de reinicio con MODULE_NOT_FOUND.
CLI="/opt/prisma-cli/node_modules/prisma/build/index.js"

echo "[katana] Aplicando migraciones de base de datos…"
if ! node "$CLI" migrate deploy --schema=/app/prisma/schema.prisma; then
  echo "[katana] ERROR: fallaron las migraciones. El contenedor no arranca." >&2
  exit 1
fi
echo "[katana] Migraciones al día."

# PDFs emitidos, archivos importados y respaldos previos a una importación.
mkdir -p "${STORAGE_DIR:-/var/lib/katana}/documentos" \
         "${STORAGE_DIR:-/var/lib/katana}/importaciones" \
         "${STORAGE_DIR:-/var/lib/katana}/respaldos-previos"

# El seed es idempotente: crea los 19 formatos y los ajustes del documento, y el
# primer administrador si no existe. NO rota la contraseña de nadie ni pisa los
# ajustes cambiados desde la app, así que correrlo en cada arranque es seguro —
# y es la única forma de que exista un usuario con el que entrar tras una
# instalación limpia.
if [ ! -f prisma/seed.mjs ]; then
  echo "[katana] ERROR: falta prisma/seed.mjs en la imagen." >&2
  exit 1
fi

echo "[katana] Sembrando catálogo y primer administrador…"
if ! node prisma/seed.mjs; then
  echo "[katana] ERROR: falló la siembra. El contenedor no arranca." >&2
  echo "[katana] Sin ella no hay formatos cotizables ni con quién entrar." >&2
  exit 1
fi

echo "[katana] Iniciando la aplicación en el puerto ${PORT:-3000}…"
exec "$@"
