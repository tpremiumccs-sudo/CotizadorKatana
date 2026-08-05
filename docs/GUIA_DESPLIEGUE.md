# Guía de despliegue

Instalación del Cotizador en un servidor Ubuntu, de principio a fin. Está
escrita para que la siga alguien que nunca vio este repositorio: si en algún
paso hay que adivinar algo, es un fallo de esta guía — repórtalo.

**Tiempo aproximado:** 40 minutos, de los cuales 25 son la compilación de la
imagen — se hace sola, no hay que mirarla.

---

## 1. Lo que hace falta antes de empezar

| Cosa | Para qué | Cómo conseguirla |
|---|---|---|
| Un servidor Ubuntu 22.04 o 24.04 | Donde vive el cotizador | 2 vCPU y 4 GB de RAM, **4 GB de swap** y 15 GB de disco libre |
| Acceso `sudo` por SSH | Instalar Docker | — |
| Una cuenta de Cloudflare | Publicarlo sin abrir puertos | Gratuita en cloudflare.com |
| El dominio en Cloudflare | Que `cotizador.katanatalent.com` apunte al túnel | Ya lo está si el sitio usa Cloudflare |

La **swap no es opcional**: la imagen se compila en el propio servidor y el pico
de `next build` ronda los 3 GB. Con 4 GB de RAM y sin swap, la compilación muere
con un `Killed` a secas y sin explicación. Si el servidor no la tiene:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h        # debe aparecer la línea Swap con 4,0Gi
```

No hace falta abrir los puertos 80 ni 443 del servidor, ni gestionar
certificados: el túnel abre una conexión **saliente** hacia Cloudflare y por ahí
entra el tráfico. Es más seguro y no hay nada que renovar.

---

## 2. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Cierra la sesión de SSH y vuelve a entrar (el cambio de grupo no aplica hasta
entonces). Comprueba:

```bash
docker compose version
```

Debe imprimir `Docker Compose version v2.x`. Si dice que no existe el comando,
falta el plugin: `sudo apt-get install -y docker-compose-plugin`.

---

## 3. Crear el túnel de Cloudflare

1. Entra a **Cloudflare Zero Trust** → **Networks** → **Tunnels**.
2. **Create a tunnel** → **Cloudflared** → ponle un nombre (`cotizador-katana`).
3. Cloudflare muestra un comando de instalación con un **token** largo. **No lo
   ejecutes**: sólo copia el token (la cadena que va después de `--token`).
4. En la pestaña **Public Hostnames**, añade:
   - **Subdomain:** `cotizador`
   - **Domain:** `katanatalent.com`
   - **Service:** `HTTP` → `app:3000`

   `app` es el nombre del servicio dentro de la red de Docker; no es un dominio.

Guarda. El túnel aparecerá como *Inactive* hasta que levantes los servicios.

---

## 4. Traer el código y configurarlo

```bash
git clone https://github.com/tpremiumccs-sudo/CotizadorKatana.git
cd CotizadorKatana
cp .env.example .env
```

Genera la contraseña de la base **en el servidor**, no en tu máquina ni en un
chat:

```bash
openssl rand -base64 32   # para POSTGRES_PASSWORD
```

Abre `.env` y cambia **todos** los valores que dicen `CAMBIAR`:

| Variable | Qué poner |
|---|---|
| `POSTGRES_PASSWORD` | El secreto que acabas de generar |
| `DATABASE_URL` | **La misma contraseña**, dentro de la URL |
| `APP_PUBLIC_URL` | `https://cotizador.katanatalent.com` |
| `SEED_ADMIN_EMAIL` | El correo del primer administrador |
| `SEED_ADMIN_NOMBRE` | Su nombre completo |
| `SEED_ADMIN_PASSWORD` | Una contraseña inicial de 12+ caracteres |
| `CLOUDFLARE_TUNNEL_TOKEN` | El token del paso 3 |

> **La contraseña de Postgres se escribe dos veces** —suelta en
> `POSTGRES_PASSWORD` y embebida dentro de `DATABASE_URL`— y tienen que ser
> idénticas. Si divergen, la aplicación funciona con normalidad y el servicio de
> respaldos no consigue conectarse; se descubriría el día que hiciera falta un
> respaldo. `deploy.sh` compara las dos y se niega a instalar si no coinciden.

> **Sobre la contraseña inicial.** Sólo sirve para el primer acceso: el sistema
> obliga a cambiarla al entrar. Pasa por la **misma** política que se exige
> después, así que no puede tener menos de 12 caracteres ni contener "katana",
> "cotizador", "password", "contrasena", "123456", "qwerty", ni tu nombre o tu
> correo. Si no cumple, el contenedor **no arranca** y dice exactamente por qué.

> **No hay ningún secreto de sesión que poner.** Las sesiones son opacas: el
> identificador es aleatorio y la fila vive en la base, así que no hay nada que
> firmar. Para revocar accesos de verdad se cierran las sesiones desde
> **Usuarios** —eso borra las filas y surte efecto al instante—, no se rota un
> secreto.

`deploy.sh` se niega a arrancar si queda algún `CAMBIAR` en el archivo.

---

## 5. Instalar

```bash
./deploy.sh instalar
```

Esto compila la imagen, levanta los cuatro servicios y espera a que la
aplicación responda. **La primera vez tarda entre 15 y 25 minutos**: compila
Next, descarga Chromium y sus librerías, y trae el cliente de PostgreSQL 16.
Déjalo correr; no está colgado.

Al arrancar, el contenedor de la app aplica las migraciones y siembra el
catálogo y el primer administrador. Si cualquiera de esas dos cosas falla, el
contenedor **no levanta** y la instalación se detiene con el error a la vista.
Es deliberado: una app en pie contra una base a medio migrar, o sin un solo
usuario con el que entrar, es peor que una que no arranca y lo dice.

Cuando termine, imprime la dirección. Entra, escribe el correo y la contraseña
inicial, y el sistema te pedirá elegir una nueva.

### Si algo falla

```bash
./deploy.sh logs app       # los registros de la aplicación
./deploy.sh estado         # qué está corriendo
```

| Síntoma | Causa habitual |
|---|---|
| `El archivo .env todavía tiene valores sin cambiar` | Quedó un `CAMBIAR`; el propio mensaje dice en qué líneas |
| `La contraseña de Postgres no coincide` | `POSTGRES_PASSWORD` y la que va dentro de `DATABASE_URL` son distintas |
| La compilación muere con `Killed` y nada más | Falta swap. Vuelve al paso 1 y créala |
| `Quedan N GB libres y la construcción necesita cerca de 8` | Libera disco: `docker system prune -af` |
| `SEED_ADMIN_PASSWORD no cumple la política` | La contraseña inicial lleva una palabra prohibida o es corta; el mensaje dice cuál |
| La app no responde y los registros dicen `Configuración de entorno inválida` | Falta una variable o tiene un valor imposible; el mensaje dice cuál |
| El túnel sigue *Inactive* | El token está mal copiado, o el Public Hostname no apunta a `app:3000` |
| `almacenamiento: false` en `/api/health` | El volumen no se montó; revisa `docker compose ps` |
| El contenedor `backup` reinicia en bucle | `PGPASSWORD` no coincide con la de la base. Es la misma causa que la fila 2 |

---

## 6. Comprobar que quedó bien

```bash
./deploy.sh estado
```

Los cuatro servicios deben aparecer arriba, y debajo la línea de puertos
publicados debe decir **`ninguno`** en verde. Si en su lugar sale una lista en
rojo, alguien añadió un `ports:` al `docker-compose.yml` y el servidor quedó
expuesto a internet.

Y desde el navegador visita `/api/health`. Debe decir:

```json
{"ok":true,"db":true,"restricciones":true,"chromium":true,
 "documento":true,"almacenamiento":true,"pgDump":true}
```

Esa dirección es pública —el chequeo de salud de Docker no puede autenticarse—
pero sólo publica banderas sí/no. Los mensajes de error y las versiones exactas
sólo aparecen si la visitas **con tu sesión iniciada**; es lo que conviene mirar
cuando algo dice `false`.

Qué significa cada uno:

- **db** — la base responde.
- **restricciones** — los candados de integridad están puestos. Si dice `false`,
  una migración quedó a medias y la base aceptaría datos que el resto del
  sistema considera imposibles.
- **chromium** — el navegador que imprime los PDFs está donde se le espera.
- **documento** — están las fuentes y el logo. Sin ellos no hay vista previa ni
  PDF.
- **almacenamiento** — el volumen donde van los `.xlsx` importados se puede
  escribir.
- **pgDump** — están las herramientas con las que la app se respalda a sí misma
  antes de aplicar una importación, **y son de la misma versión mayor que el
  servidor**. Si dice `false`, la app funciona pero las importaciones se
  bloquearán: `pg_dump` se niega a volcar de un servidor más nuevo que él. Con
  sesión iniciada, `pgDumpVersiones` muestra las dos.

---

## 7. Cargar los datos

Entra al cotizador → **Importar** → sube el
`KATANA ENGINE — CRM COMERCIAL 2026.xlsx`.

La pantalla **no aplica nada todavía**: muestra qué cambiaría. Revisa que la
fila de encabezado detectada en cada hoja sea la correcta (los archivos reales
las tienen en filas distintas), atiende las filas que no se pudieron colocar, y
confirma los nombres que no coinciden. Cuando estés conforme, **Aplicar al
tarifario**. Antes de escribir nada, el sistema se respalda solo en
`respaldos-previos/` dentro del volumen: si ese respaldo falla, la importación
no se aplica. Se conservan los **diez** más recientes; los anteriores se borran
solos para que el volumen no crezca sin techo.

Después sube el `CRM_Roster_Katana_Actualizado.xlsx` para las métricas de
audiencia.

Volver a subir el mismo archivo es seguro: dirá "Este archivo no cambia nada".

> Los dos `.xlsx` **no están en el repositorio** y no deben volver a estarlo: son
> el tarifario completo, el roster y las notas comerciales internas. Estuvieron
> versionados mientras el repositorio era público, así que siguen en el
> historial de git y hay que dar por hecho que pudieron copiarse. Quien
> desarrolle y quiera correr las pruebas de importación los deja en
> `tests/fixtures/xlsx/` —está en `.gitignore`—; sin ellos, esas pruebas se
> omiten con un mensaje en vez de fallar.

---

## 8. Operación del día a día

```bash
./deploy.sh estado              # qué está corriendo
./deploy.sh logs app            # registros en vivo (Ctrl-C para salir)
./deploy.sh respaldar           # respaldo inmediato y verificado
./deploy.sh actualizar          # traer la nueva versión
./deploy.sh detener             # parar todo (los datos se conservan)
```

### Respaldos

Se hacen solos todas las noches a las 3:00 y se guardan en `./respaldos/`
durante 30 días. Cada respaldo:

1. Se vuelca comprimido a un archivo temporal y sólo entonces se renombra —
   un respaldo a medias nunca aparece con nombre definitivo.
2. Se verifica leyéndolo con `pg_restore --list`. Si está corrupto, se borra y
   el proceso falla ruidosamente.
3. Se le calcula una suma `sha256` al lado.

Cambia el horario o la retención con `BACKUP_CRON` y `BACKUP_RETENTION_DAYS`.

### Ensayar una restauración

**Un respaldo que nunca se restauró no es un respaldo.** Hazlo cada pocos meses:

```bash
./deploy.sh restaurar respaldos/katana-20260805-030000.dump
```

Restaura a una base llamada `katana_ensayo`, **nunca sobre producción**, e
imprime los conteos de talentos, tarifas, cotizaciones y usuarios. Compáralos
con los de la base viva. Si el archivo está alterado aunque sea en un byte, se
detiene antes de tocar nada.

Promover un respaldo a producción es un paso manual y deliberado; si llega el
caso, para la app primero.

---

## 9. Actualizar

```bash
cd CotizadorKatana
git pull
./deploy.sh actualizar
```

La imagen se **recompila en el servidor**, igual que en la instalación: 10-20
minutos, algo menos que la primera vez porque Docker reaprovecha las capas que
no cambiaron.

Las migraciones de base de datos se aplican solas al arrancar el contenedor. Si
fallan, el contenedor **no** levanta: es preferible a arrancar contra una base
en un estado que nadie sabe interpretar.

> **Si cambias `APP_PUBLIC_URL`, hay que recompilar.** El dominio se hornea
> dentro de la imagen (`allowedOrigins` de las Server Actions): editarlo en el
> `.env` y reiniciar no basta, y el síntoma es que los formularios dejan de
> guardar sin decir por qué. `./deploy.sh actualizar` lo resuelve porque
> reconstruye.

> **Cuando esto lleve un tiempo en pie, vale la pena publicar la imagen en
> GHCR.** El flujo de CI ya la compila en cada rama; sólo falta que la publique
> y que el servidor haga `pull` en vez de compilar. Se activa poniendo
> `APP_IMAGE` y `APP_VERSION` en el `.env` —están comentadas en `.env.example`—
> y ahorra 20 minutos de CPU por despliegue en una máquina de 2 vCPU. No hace
> falta para arrancar.

---

## 10. Dar de alta al equipo

**Usuarios** → *Dar de alta a alguien*. Elige el rol:

| Rol | Puede |
|---|---|
| **Administrador** | Todo: aplicar importaciones, administrar usuarios, eliminar y aprobar |
| **Comercial** | Crear y editar sus cotizaciones, editar el tarifario, subir archivos, ver la bitácora |
| **Solo lectura** | Consultar y descargar PDFs. Nada más |

La contraseña inicial se la das **en persona o por teléfono**, nunca por
escrito: el sistema obliga a cambiarla en el primer acceso, pero mientras tanto
sirve.

Bajar un rol o suspender una cuenta cierra sus sesiones abiertas al instante, no
cuando la persona recargue.

---

## Apéndice: qué hay dentro

| Servicio | Qué hace |
|---|---|
| `db` | PostgreSQL 16 con los datos |
| `app` | La aplicación y el Chromium que imprime los PDFs |
| `cloudflared` | El túnel. Sólo abre conexiones salientes |
| `backup` | El respaldo nocturno |

Ninguno publica un puerto. Los datos viven en dos volúmenes de Docker
(`katana_db` y `katana_storage`) y los respaldos en `./respaldos/`, que es una
carpeta normal del servidor — inclúyela en el respaldo externo que uses.
