#!/bin/sh
# Bucle de respaldo programado. Espera a que la base responda, hace un respaldo
# inicial y después uno por día a la hora indicada en BACKUP_CRON (solo se
# interpretan minuto y hora; el resto se ignora a propósito).
set -eu

echo "[respaldo] Servicio iniciado. Programación: ${BACKUP_CRON:-0 3 * * *} (${TZ:-UTC})"

# Con límite, y saliendo distinto de cero al agotarlo. El `until` sin techo de
# antes era la peor forma de fallar que tiene este servicio: si PGPASSWORD no
# coincide con la de la base —y se escribe DOS veces en el .env, suelta y dentro
# de DATABASE_URL— el contenedor se quedaba aquí PARA SIEMPRE, en estado
# `running` y sin un solo respaldo. Se descubría el día que hacía falta uno.
#
# Al salir con error, `restart: unless-stopped` reintenta, pero el contenedor
# entra en bucle de reinicio: eso SÍ se ve en `./deploy.sh estado`.
INTENTOS=60   # 5 minutos
n=0
until pg_isready -q; do
  n=$((n + 1))
  if [ "$n" -ge "$INTENTOS" ]; then
    echo "[respaldo] ERROR: la base no respondió tras $((INTENTOS * 5)) segundos." >&2
    echo "[respaldo] Lo más probable: PGPASSWORD no coincide con POSTGRES_PASSWORD." >&2
    exit 1
  fi
  echo "[respaldo] Esperando a la base de datos… ($n/$INTENTOS)"
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
