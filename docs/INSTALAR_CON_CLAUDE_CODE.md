# Instalar en el servidor — instrucciones para Claude Code

> Este archivo está escrito para **otra instancia de Claude Code**, la que corre
> en VS Code en la máquina de Chuy y sí tiene acceso SSH al servidor. Si estás
> leyendo esto como Claude Code: esto es tu encargo completo. No hace falta que
> preguntes nada para empezar.

---

## Qué es esto

El **Cotizador Katana Talent**: una app Next.js que importa el CRM de la agencia
desde Excel, arma tabuladores y cotizaciones para marcas, y genera un PDF
idéntico al que la agencia venía haciendo a mano.

La aplicación está terminada y probada: **426 pruebas en verde** (191 unitarias,
116 de integración contra los `.xlsx` reales, 29 de fidelidad del PDF, 90 de
extremo a extremo en escritorio/iPad/iPhone).

Lo que falta es **ponerla en pie en el servidor**. Eso es lo tuyo.

## Qué se sabe ya, para que no lo redescubras

La ruta de despliegue **nunca había funcionado**. Se arregló entera en la rama
`claude/influencer-quote-generator-b78shn` y ahí están los 22 fallos corregidos
—desde que la imagen no construía hasta que nadie podía entrar porque la siembra
fallaba en silencio—. El detalle está en el mensaje del commit `aadfa97`.

Lo que importa para ti:

- **La imagen se compila EN EL SERVIDOR.** No hay registro de imágenes. Tarda
  **15-25 minutos** la primera vez. No está colgado.
- **Hace falta swap.** `next build` pica en ~3 GB. Con 4 GB de RAM y sin swap la
  compilación muere con un `Killed` a secas, sin más explicación.
- **Los secretos se generan en el servidor.** No los traigas de ningún lado.
- **El token de Cloudflare que tenga Chuy a mano está quemado** (pasó por un
  chat). Que lo rote en Zero Trust → su túnel → *Refresh token* antes de
  pegarlo, y que el nuevo vaya directo al `.env`.

## Lo primero: el diagnóstico

Conéctate por SSH y corre esto. **Pega la salida entera en el chat con Chuy** —
de ahí sale cuánta swap crear y si hay que instalar Docker.

```bash
echo "== SO ==";      . /etc/os-release && echo "$PRETTY_NAME  ($(uname -m))"
echo "== CPU/RAM ==";  nproc; free -h | head -2
echo "== SWAP ==";     swapon --show || echo "(sin swap)"
echo "== DISCO ==";    df -h / | tail -1
echo "== DOCKER ==";   docker --version 2>&1; docker compose version 2>&1
echo "== USUARIO ==";  whoami; groups
```

Lo que buscas:

| Si ves | Haz |
|---|---|
| Menos de 4 GB de swap | Créala (abajo) |
| Menos de 15 GB libres en `/` | `docker system prune -af`, y si no basta, avisa |
| `docker: command not found` | Instala Docker (abajo) |
| El usuario no está en el grupo `docker` | `sudo usermod -aG docker "$USER"` y reconecta |

---

## Paso 1 — Swap y Docker

**Swap**, si falta o es menor de 4 GB:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h        # debe aparecer Swap con 4,0Gi
```

**Docker**, si falta:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Después de `usermod` hay que **reconectar la sesión SSH** o el grupo no aplica.
Comprueba con `docker compose version` — debe decir `v2.x`.

## Paso 2 — El código

```bash
git clone https://github.com/tpremiumccs-sudo/CotizadorKatana.git
cd CotizadorKatana
git checkout claude/influencer-quote-generator-b78shn
cp .env.example .env
```

> La rama importa. `main` todavía tiene la ruta de despliegue rota.

## Paso 3 — El `.env`

Genera la contraseña de Postgres **en el servidor**:

```bash
openssl rand -base64 32
```

Edita `.env` y cambia **todo lo que diga `CAMBIAR`**:

| Variable | Qué poner |
|---|---|
| `POSTGRES_PASSWORD` | La contraseña que acabas de generar |
| `DATABASE_URL` | **La misma contraseña**, dentro de la URL |
| `APP_PUBLIC_URL` | `https://cotizador.katanatalent.com` (o el dominio que use) |
| `SEED_ADMIN_EMAIL` | El correo de Chuy |
| `SEED_ADMIN_NOMBRE` | Su nombre completo |
| `SEED_ADMIN_PASSWORD` | Una frase de 12+ caracteres |
| `CLOUDFLARE_TUNNEL_TOKEN` | El token **rotado** |

Tres trampas que ya costaron caro, y que conviene comprobar antes de instalar:

1. **La contraseña de Postgres se escribe dos veces** —suelta y dentro de
   `DATABASE_URL`—. Si divergen, la app funciona con normalidad y **el servicio
   de respaldos nunca conecta**. `deploy.sh` las compara y se niega a instalar,
   pero mejor no llegar ahí.
2. **`SEED_ADMIN_PASSWORD` pasa por la misma política que el resto**: 12+
   caracteres, y **no puede contener** `katana`, `cotizador`, `password`,
   `contrasena`, `123456`, `qwerty`, ni el nombre o el correo del usuario. Si no
   cumple, el contenedor **no arranca** y dice exactamente por qué.
3. **`APP_PUBLIC_URL` se hornea dentro de la imagen** (`allowedOrigins` de las
   Server Actions). Cambiarlo después obliga a recompilar; si no, los
   formularios dejan de guardar sin decir por qué.

## Paso 4 — El túnel de Cloudflare

Si el túnel aún no existe, en **Zero Trust → Networks → Tunnels**:

1. *Create a tunnel* → *Cloudflared* → nómbralo `cotizador-katana`.
2. Copia **sólo el token** (lo que va después de `--token`). No ejecutes el
   comando que muestra Cloudflare.
3. En **Public Hostnames**, añade:
   - Subdomain: `cotizador`
   - Domain: `katanatalent.com`
   - Service: `HTTP` → `app:3000`

`app` es el nombre del servicio en la red de Docker, no un dominio. Eso es lo que
hace que no haya que abrir el 80 ni el 443 en el firewall.

## Paso 5 — Instalar

```bash
./deploy.sh instalar
```

**15-25 minutos.** Compila Next, descarga Chromium con sus librerías y trae el
cliente de PostgreSQL 16. Al arrancar, el contenedor aplica las migraciones y
siembra el catálogo y el primer administrador; si algo de eso falla, **no
levanta** y el error queda a la vista. Es deliberado.

Si algo va mal:

| Síntoma | Causa |
|---|---|
| `Killed` sin más | Falta swap. Vuelve al paso 1 |
| `Quedan N GB libres y la construcción necesita cerca de 8` | `docker system prune -af` |
| `La contraseña de Postgres no coincide` | Trampa 1 del paso 3 |
| `SEED_ADMIN_PASSWORD no cumple la política` | Trampa 2 del paso 3 |
| `Configuración de entorno inválida` | Falta una variable; el mensaje dice cuál |
| El contenedor `backup` reinicia en bucle | Trampa 1 otra vez |
| El túnel sigue *Inactive* | Token mal copiado, o el hostname no apunta a `app:3000` |

Para ver qué pasa: `./deploy.sh logs app`

## Paso 6 — Comprobar que quedó bien

```bash
./deploy.sh estado
```

Los cuatro servicios arriba, y la línea de puertos publicados debe decir
**`ninguno`** en verde. Si sale una lista en rojo, alguien metió un `ports:` en
el compose y el servidor quedó expuesto.

Luego, la sonda de salud:

```bash
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
```

Todo debe estar en `true`:

```json
{"ok":true,"db":true,"restricciones":true,"chromium":true,
 "documento":true,"almacenamiento":true,"pgDump":true}
```

Qué significa cada uno, y qué hacer si sale `false`:

- **db** — la base responde.
- **restricciones** — los candados de integridad están puestos. En `false`, una
  migración quedó a medias.
- **chromium** — el navegador que imprime los PDFs. En `false` no hay PDF.
- **documento** — las fuentes Nimbus y el logo. En `false` no hay ni vista
  previa: el documento se dibuja con ellas embebidas.
- **almacenamiento** — el volumen se puede escribir. En `false`, problema de
  permisos del volumen (el proceso corre como uid 1000).
- **pgDump** — `pg_dump` está **y es de la misma versión mayor que el
  servidor**. En `false`, las importaciones del CRM se bloquean: `pg_dump` se
  niega a volcar de un servidor más nuevo que él. Visitando `/api/health` con
  sesión iniciada aparece `pgDumpVersiones` con las dos.

## Paso 7 — Primer acceso y carga de datos

1. Entra al dominio. El sistema **obliga a cambiar la contraseña inicial**.
2. **Importar** → sube `KATANA ENGINE — CRM COMERCIAL 2026.xlsx`.

   La pantalla **no aplica nada todavía**: enseña qué cambiaría. Revisa que la
   fila de encabezado detectada en cada hoja sea la correcta —los archivos
   reales las tienen en filas distintas—, atiende las filas huérfanas y confirma
   los nombres que no coinciden. Cuando esté conforme: **Aplicar al tarifario**.

   Antes de escribir nada, el sistema se respalda solo. Si ese respaldo falla, la
   importación **no** se aplica.

3. Después sube `CRM_Roster_Katana_Actualizado.xlsx` para las métricas.

**Cómo saber que la importación salió bien.** Estos números son los del CRM real
y sirven de comprobación: 23 talentos, **399 tarifas** repartidas en
N/A = 93, Pendiente = 87, Caso por caso = 37 y **182 con precio**.

## Paso 8 — La prueba de que todo funciona de verdad

Desde el iPad de Chuy y por el dominio de Cloudflare:

1. Arma el tabulador de **HONOR**.
2. Ajusta **Ronny × espejo** a `$150,000`. La celda debe decir exactamente:
   `● Base $195,000 · −$45,000 (−23.1%)`
3. Descarga el PDF y compártelo por WhatsApp desde el propio iPad.
4. `./deploy.sh respaldar` produce un respaldo verificado, y
   `./deploy.sh restaurar respaldos/<archivo>.dump` imprime conteos idénticos
   (restaura a una base de **ensayo**, no a producción).

Si los cuatro pasan, está instalado.

---

## Cosas que conviene saber

**Operación diaria:**

```bash
./deploy.sh estado         # qué está corriendo
./deploy.sh logs app       # registros en vivo
./deploy.sh respaldar      # respaldo inmediato y verificado
./deploy.sh actualizar     # traer nueva versión (recompila, 10-20 min)
./deploy.sh detener        # parar todo, los datos se conservan
```

**Respaldos:** automáticos a las 3:00, 30 días de retención, en `./respaldos/`.
Cada uno se vuelca a un archivo temporal, se verifica con `pg_restore --list` y
sólo entonces toma su nombre definitivo. Incluye `./respaldos/` en el respaldo
externo del servidor.

**Lo que NO hay que hacer:**

- No abrir puertos. Todo entra por el túnel; que `./deploy.sh estado` diga
  `ninguno` es una comprobación de seguridad, no cosmética.
- No meter los `.xlsx` del CRM en el repositorio. Son el tarifario completo, el
  roster y notas comerciales internas. Están fuera a propósito y `.gitignore`
  los bloquea.
- No editar `.env` y reiniciar esperando que `APP_PUBLIC_URL` cambie. Hay que
  recompilar.

**Si algo no encaja con lo que dice esta guía**, la fuente completa es
`docs/GUIA_DESPLIEGUE.md`, y el porqué de cada decisión está en
`docs/DISENO_TECNICO.md`.

---

## Qué reportar de vuelta

Después de cada paso, pega en el chat la salida tal cual: la del diagnóstico, la
del final de `./deploy.sh instalar`, la de `./deploy.sh estado` y el JSON de
`/api/health`. Si algo falla, la salida completa del error y de
`./deploy.sh logs app` — no un resumen.
