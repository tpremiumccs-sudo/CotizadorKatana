#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  Arranque del contenedor de la app.
#
#  Aplica las migraciones ANTES de levantar el servidor. Con `replicas: 1` no
#  hay carrera posible; si algún día hay más de una réplica, las migraciones
#  deben moverse a un job aparte.
# ═══════════════════════════════════════════════════════════════════════════
set -eu

echo "[katana] Aplicando migraciones de base de datos…"
if ! node node_modules/prisma/build/index.js migrate deploy; then
  echo "[katana] ERROR: fallaron las migraciones. El contenedor no arranca." >&2
  exit 1
fi
echo "[katana] Migraciones al día."

# Directorio de PDFs emitidos y archivos importados.
mkdir -p "${STORAGE_DIR:-/var/lib/katana}/documentos" \
         "${STORAGE_DIR:-/var/lib/katana}/importaciones"

echo "[katana] Iniciando la aplicación en el puerto ${PORT:-3000}…"
exec "$@"
