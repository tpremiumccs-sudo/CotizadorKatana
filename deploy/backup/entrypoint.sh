#!/bin/sh
# Bucle de respaldo programado. Espera a que la base responda, hace un respaldo
# inicial y después uno por día a la hora indicada en BACKUP_CRON (solo se
# interpretan minuto y hora; el resto se ignora a propósito).
set -eu

echo "[respaldo] Servicio iniciado. Programación: ${BACKUP_CRON:-0 3 * * *} (${TZ})"

until pg_isready -q; do
  echo "[respaldo] Esperando a la base de datos…"
  sleep 5
done

# Respaldo al arrancar: si el servidor lleva días caído, no queremos esperar
# hasta las 3 de la mañana para tener el primero.
/usr/local/bin/respaldar-ahora.sh /respaldos || \
  echo "[respaldo] AVISO: falló el respaldo inicial; se reintenta en el ciclo."

MIN="$(echo "${BACKUP_CRON:-0 3 * * *}" | awk '{print $1}')"
HORA="$(echo "${BACKUP_CRON:-0 3 * * *}" | awk '{print $2}')"

while true; do
  AHORA_MIN="$(date +%-M)"
  AHORA_HORA="$(date +%-H)"
  if [ "$AHORA_MIN" = "$MIN" ] && [ "$AHORA_HORA" = "$HORA" ]; then
    /usr/local/bin/respaldar-ahora.sh /respaldos || \
      echo "[respaldo] ERROR: el respaldo programado falló." >&2
    sleep 3660   # más de una hora: evita repetir dentro del mismo minuto
  fi
  sleep 30
done
