# Servicio de respaldo: pg_dump programado con rotación.
# Imagen propia porque necesita el cliente de Postgres 16 exacto — un pg_dump
# de otra versión mayor produce volcados que no restauran.
FROM postgres:16-alpine

RUN apk add --no-cache tzdata coreutils
ENV TZ=America/Mexico_City

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY respaldar-ahora.sh /usr/local/bin/respaldar-ahora.sh
COPY restore.sh /usr/local/bin/restore.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
             /usr/local/bin/respaldar-ahora.sh \
             /usr/local/bin/restore.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
