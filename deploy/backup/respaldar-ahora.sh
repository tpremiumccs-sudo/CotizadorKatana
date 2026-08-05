#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  Un respaldo, en primer plano, verificado.
#
#  Separado del bucle del cron a propósito: `./deploy.sh respaldar` lo invoca
#  directamente y necesita un código de salida real, no un "se programó".
# ═══════════════════════════════════════════════════════════════════════════
set -eu

DESTINO="${1:-/respaldos}"
RETENCION="${BACKUP_RETENTION_DAYS:-30}"
SELLO="$(date +%Y%m%d-%H%M%S)"
ARCHIVO="${DESTINO}/katana-${SELLO}.dump"

mkdir -p "$DESTINO"

echo "[respaldo] Volcando ${PGDATABASE} a ${ARCHIVO}…"
# Formato custom (-Fc): comprimido y restaurable de forma selectiva.
# Se escribe a un temporal y se renombra: un respaldo a medias nunca aparece
# con nombre definitivo.
pg_dump --format=custom --compress=9 --file="${ARCHIVO}.parcial"
mv "${ARCHIVO}.parcial" "$ARCHIVO"

# Verificación real: si el volcado está corrupto, pg_restore --list falla aquí
# y no dentro de seis meses, cuando haga falta de verdad.
echo "[respaldo] Verificando integridad…"
if ! pg_restore --list "$ARCHIVO" > /dev/null 2>&1; then
  echo "[respaldo] ERROR: el volcado no es legible. Se descarta." >&2
  rm -f "$ARCHIVO"
  exit 1
fi

sha256sum "$ARCHIVO" | awk '{print $1}' > "${ARCHIVO}.sha256"
TAM="$(du -h "$ARCHIVO" | cut -f1)"
echo "[respaldo] OK: ${ARCHIVO} (${TAM})"

# Rotación: solo se borran respaldos ya verificados.
BORRADOS="$(find "$DESTINO" -name 'katana-*.dump' -type f -mtime "+${RETENCION}" -print -delete | wc -l)"
find "$DESTINO" -name 'katana-*.dump.sha256' -type f -mtime "+${RETENCION}" -delete 2>/dev/null || true
[ "$BORRADOS" -gt 0 ] && echo "[respaldo] Rotación: ${BORRADOS} respaldo(s) de más de ${RETENCION} días eliminados."

exit 0
