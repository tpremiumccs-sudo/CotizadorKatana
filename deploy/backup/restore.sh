#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  Restauración a una BASE DE ENSAYO, nunca directamente sobre producción.
#
#  Un respaldo que nunca se restauró no es un respaldo. Este script existe para
#  poder ensayarlo sin arriesgar los datos vivos: restaura a `katana_ensayo`,
#  imprime los conteos y ahí para. La promoción es un paso manual y explícito.
# ═══════════════════════════════════════════════════════════════════════════
set -eu

VOLCADO="${1:?Uso: restore.sh <ruta-del-dump> [base-destino]}"
DESTINO="${2:-katana_ensayo}"

[ -f "$VOLCADO" ] || { echo "No existe el archivo: $VOLCADO" >&2; exit 1; }

if [ -f "${VOLCADO}.sha256" ]; then
  echo "[restaurar] Verificando suma de comprobación…"
  ESPERADO="$(cat "${VOLCADO}.sha256")"
  REAL="$(sha256sum "$VOLCADO" | awk '{print $1}')"
  if [ "$ESPERADO" != "$REAL" ]; then
    echo "[restaurar] ERROR: el archivo está alterado o corrupto." >&2
    exit 1
  fi
  echo "[restaurar] Suma correcta."
fi

echo "[restaurar] Recreando la base de ensayo '${DESTINO}'…"
psql -d postgres -c "DROP DATABASE IF EXISTS \"${DESTINO}\";"
psql -d postgres -c "CREATE DATABASE \"${DESTINO}\";"

echo "[restaurar] Restaurando…"
pg_restore --dbname="$DESTINO" --no-owner --no-privileges --exit-on-error "$VOLCADO"

echo ""
echo "[restaurar] Conteos en '${DESTINO}':"
psql -d "$DESTINO" -c "
  SELECT 'talentos'      AS tabla, count(*) FROM \"Talent\"
  UNION ALL SELECT 'tarifas',      count(*) FROM \"TalentRate\"
  UNION ALL SELECT 'cotizaciones', count(*) FROM \"Quote\"
  UNION ALL SELECT 'snapshots',    count(*) FROM \"QuoteSnapshot\"
  UNION ALL SELECT 'usuarios',     count(*) FROM \"Usuario\"
  UNION ALL SELECT 'bitácora',     count(*) FROM \"Bitacora\";"

echo ""
echo "[restaurar] Listo. Los datos están en '${DESTINO}', NO en producción."
echo "[restaurar] Compara los conteos con los de la base viva antes de promover."
