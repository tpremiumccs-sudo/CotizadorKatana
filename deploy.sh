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
    info "Construyendo las imágenes (puede tardar varios minutos la primera vez)…"
    if [ "${BUILD_LOCAL:-0}" = "1" ]; then
      docker compose build
    else
      docker compose pull --ignore-buildable || docker compose build
    fi
    info "Levantando los servicios…"
    docker compose up -d --wait
    comprobar_salud
    info "Creando el primer usuario administrador…"
    docker compose exec -T app node node_modules/.bin/tsx prisma/seed.ts || \
      rojo "AVISO: el seed falló o ya se había ejecutado. Revisa los registros."
    verde ""
    verde "Instalación terminada."
    verde "Entra a: $(grep -E '^APP_PUBLIC_URL=' .env | cut -d= -f2- | tr -d '\"')"
    ;;

  actualizar)
    verificar_requisitos
    info "Trayendo la nueva versión…"
    if [ "${BUILD_LOCAL:-0}" = "1" ]; then
      docker compose build app
    else
      docker compose pull app
    fi
    info "Reiniciando…"
    docker compose up -d --wait
    comprobar_salud
    verde "Actualización terminada."
    ;;

  estado)
    docker compose ps
    echo ""
    info "Puertos publicados al exterior (debe estar vacío — todo entra por el túnel):"
    docker compose ps --format json 2>/dev/null \
      | python3 -c "import sys,json;[print('  '+ (l.get('Publishers') and str(l['Publishers']) or '')) for l in map(json.loads, sys.stdin) if l.get('Publishers')]" \
      2>/dev/null || echo "  (ninguno)"
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
