#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Cotizador Katana Talent — operación del servidor
#
#    ./deploy.sh instalar        Primera instalación en un servidor limpio
#    ./deploy.sh actualizar      Traer la nueva versión y reiniciar
#    ./deploy.sh estado          Ver qué está corriendo
#    ./deploy.sh logs [servicio] Ver registros en vivo
#    ./deploy.sh respaldar       Respaldo inmediato y verificado
#    ./deploy.sh restaurar ARCH  Restaurar a la base de ensayo
#    ./deploy.sh detener         Parar todo (los datos se conservan)
# ═══════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

cd "$(dirname "$0")"

rojo()  { printf '\033[0;31m%s\033[0m\n' "$*"; }
verde() { printf '\033[0;32m%s\033[0m\n' "$*"; }
info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }

morir() { rojo "ERROR: $*"; exit 1; }

# ── Comprobaciones previas ────────────────────────────────────────────────
# Se usa if/then y no `cond && morir`: bajo `set -e`, un `&&` al final de una
# función hace que el script salga con 0 en vez de reportar el fallo.
verificar_requisitos() {
  if ! command -v docker >/dev/null 2>&1; then
    morir "Docker no está instalado. Instálalo con: curl -fsSL https://get.docker.com | sh"
  fi
  if ! docker compose version >/dev/null 2>&1; then
    morir "Falta el plugin 'docker compose' (v2)."
  fi
  if [ ! -f .env ]; then
    morir "No existe .env. Cópialo de .env.example y edita los valores marcados CAMBIAR."
  fi
  if grep -q 'CAMBIAR' .env; then
    rojo "El archivo .env todavía tiene valores sin cambiar:"
    grep -n 'CAMBIAR' .env | sed 's/^/    /'
    morir "Edita .env antes de continuar."
  fi

  # La contraseña de Postgres se escribe DOS veces en .env: suelta en
  # POSTGRES_PASSWORD y embebida dentro de DATABASE_URL. Si divergen, lo que
  # pasa es de lo peor que puede pasar: la app funciona y el servicio de
  # respaldos se queda esperando a la base PARA SIEMPRE, con el contenedor en
  # `running` y la salud en verde. Se descubre el día que hace falta un
  # respaldo. Mejor cazarlo aquí.
  local pwd_suelta pwd_url
  pwd_suelta="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tr -d '"'"'"'' | head -1)"
  pwd_url="$(sed -n 's|^DATABASE_URL=.*://[^:]*:\([^@]*\)@.*|\1|p' .env | head -1)"
  if [ -n "$pwd_suelta" ] && [ -n "$pwd_url" ] && [ "$pwd_suelta" != "$pwd_url" ]; then
    rojo "La contraseña de Postgres no coincide entre POSTGRES_PASSWORD y DATABASE_URL."
    rojo "Deben ser idénticas: si divergen, los respaldos fallan en silencio."
    morir "Corrige .env antes de continuar."
  fi

  local libre
  libre="$(df -Pk . | awk 'NR==2 {print int($4/1024/1024)}')"
  if [ "${libre:-99}" -lt 8 ]; then
    rojo "Quedan ${libre} GB libres y la construcción necesita cerca de 8."
    morir "Libera espacio antes de continuar."
  fi
}

# Ningún servicio debe publicar puertos: todo entra por el túnel.
#
# Se pregunta al demonio por los puertos de cada contenedor en vez de parsear
# `docker compose ps --format json` — Compose ≥2.21 emite un único array y el
# parseo línea a línea reventaba SIEMPRE, cayendo a "(ninguno)" aunque hubiera
# puertos abiertos. Era una comprobación de seguridad que no comprobaba nada.
puertos_publicados() {
  local svc cid puertos hallados=""
  for svc in $(docker compose config --services); do
    cid="$(docker compose ps -q "$svc" 2>/dev/null || true)"
    [ -n "$cid" ] || continue
    puertos="$(docker port "$cid" 2>/dev/null || true)"
    [ -n "$puertos" ] || continue
    hallados="${hallados}${svc}: $(echo "$puertos" | tr '\n' ' ')
"
  done
  printf '%s' "$hallados"
}

comprobar_salud() {
  local intentos="${1:-60}"
  info "Esperando a que la aplicación responda…"
  for _ in $(seq 1 "$intentos"); do
    if docker compose exec -T app node -e \
        "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))" \
        >/dev/null 2>&1; then
      verde "La aplicación responde correctamente."
      return 0
    fi
    sleep 3
  done
  rojo "La aplicación no respondió a tiempo. Revisa: ./deploy.sh logs app"
  return 1
}

# ── Órdenes ───────────────────────────────────────────────────────────────
case "${1:-}" in
  instalar)
    verificar_requisitos
    # Las imágenes base sí se descargan; la de la app se construye aquí.
    # (`pull --ignore-buildable` SALTA los servicios con `build:` y sale con 0,
    # así que el `|| build` de antes nunca se ejecutaba: parecía que traía la
    # app y no traía nada.)
    info "Descargando las imágenes base…"
    docker compose pull --ignore-buildable
    info "Construyendo la aplicación. La primera vez tarda 15-25 minutos."
    docker compose build
    info "Levantando los servicios…"
    docker compose up -d --wait

    # El contenedor migra y siembra en su arranque; si algo de eso falla, no
    # levanta y `up --wait` ya habría fallado. Aquí sólo se confirma.
    comprobar_salud
    verde ""
    verde "Instalación terminada."
    verde "Entra a: $(grep -E '^APP_PUBLIC_URL=' .env | cut -d= -f2- | tr -d '\"')"
    info "El primer acceso te pedirá cambiar la contraseña inicial."
    ;;

  actualizar)
    verificar_requisitos
    info "Trayendo los cambios y reconstruyendo…"
    docker compose build app
    info "Reiniciando…"
    docker compose up -d --wait
    comprobar_salud
    verde "Actualización terminada."
    ;;

  estado)
    docker compose ps
    echo ""
    info "Puertos publicados al exterior (debe estar vacío — todo entra por el túnel):"
    expuestos="$(puertos_publicados)"
    if [ -n "$expuestos" ]; then
      rojo "$expuestos"
      rojo "Hay puertos abiertos a internet. Revisa docker-compose.yml."
    else
      verde "  ninguno"
    fi
    ;;

  logs)
    docker compose logs -f --tail=200 "${2:-}"
    ;;

  respaldar)
    verificar_requisitos
    info "Respaldo inmediato…"
    docker compose exec -T backup /usr/local/bin/respaldar-ahora.sh /respaldos
    verde "Respaldo guardado en ./respaldos/"
    ls -lh respaldos/*.dump 2>/dev/null | tail -3 || true
    ;;

  restaurar)
    [ -n "${2:-}" ] || morir "Uso: ./deploy.sh restaurar respaldos/katana-AAAAMMDD-HHMMSS.dump"
    verificar_requisitos
    rojo "Se restaurará a la base de ENSAYO, no a producción."
    docker compose exec -T backup /usr/local/bin/restore.sh "/respaldos/$(basename "$2")"
    ;;

  detener)
    docker compose down
    verde "Servicios detenidos. Los datos siguen en los volúmenes."
    ;;

  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
