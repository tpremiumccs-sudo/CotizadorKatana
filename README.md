# Cotizador Katana Talent

Cotizador de talento para **Katana Talent**: arma tabuladores de tarifas y
cotizaciones para marcas, con una **vista previa idéntica al PDF** que se envía.
Lo que se cambia en el editor cambia en el preview y en el PDF descargable.

- **Guía de instalación:** [`docs/GUIA_DESPLIEGUE.md`](docs/GUIA_DESPLIEGUE.md)
- **Manual de uso:** [`docs/MANUAL_USUARIO.md`](docs/MANUAL_USUARIO.md)
- **Diseño técnico:** [`docs/DISENO_TECNICO.md`](docs/DISENO_TECNICO.md)

## Qué hace

- **Importa** los Excel del CRM (`KATANA ENGINE — CRM COMERCIAL` y
  `CRM_Roster_Katana_Actualizado`) mostrando qué cambiaría **antes** de aplicar
  nada: en qué fila iba el encabezado de cada hoja, qué filas no se pudieron
  colocar, qué nombres no coinciden y qué precios editados a mano contradice el
  archivo.
- **Ajusta precios por cotización sin tocar el tarifario maestro**, marcando qué
  está ajustado y cuánto se movió (`● Base $195,000 · −$45,000 (−23.1%)`).
- **Genera el PDF** desde la misma definición que dibuja la vista previa.
- **Funciona en iPad, celular y escritorio**: las cotizaciones se enseñan en
  junta y se mandan por WhatsApp.
- **Registra todo** en una bitácora que no se puede borrar.

## Las tres decisiones que explican el resto

**Una sola definición del documento.** `renderDocumentHtml` es una función pura
que devuelve HTML. La vista previa la ejecuta en el navegador y el servidor la
ejecuta para imprimir. No hay dos implementaciones que puedan desincronizarse, y
un candado de lint prohíbe bifurcar por "estoy imprimiendo" dentro de
`src/lib/doc/**`.

**El precio base y el ajuste viven separados.** El tarifario da el precio de
lista; la cotización guarda el ajuste al lado, nunca encima. Es lo que permite
enseñar de dónde salió cada cifra y revertir sin volver al Excel. Sale del dato
que define el producto: el tabulador de HONOR real cobra $150,000 donde el
tarifario dice $195,000, y pone cifra en tres formatos que el tarifario tiene en
"Pendiente".

**Un precio sin importe no es cero.** `Pendiente`, `Caso por caso`, `No aplica` y
vacío son cuatro cosas distintas, con su propio estado en la base y un CHECK que
impide guardar un importe donde no debe haberlo. Colapsarlas en `0` es como se
manda una cotización con un formato regalado.

## Instalación rápida

```bash
cp .env.example .env
$EDITOR .env          # cambia TODOS los valores marcados CAMBIAR
./deploy.sh instalar
```

Requiere Docker con el plugin `compose` v2 y un túnel de Cloudflare. No hay que
abrir puertos ni gestionar certificados. La guía completa cubre el túnel, la
comprobación de salud y la carga inicial de datos.

## Operación

```bash
./deploy.sh estado         # qué está corriendo
./deploy.sh logs app       # registros en vivo
./deploy.sh respaldar      # respaldo inmediato y verificado
./deploy.sh restaurar ARCH # ensayar una restauración (a base de ensayo)
./deploy.sh actualizar     # traer nueva versión
```

## Desarrollo

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # solo Postgres
npx prisma migrate deploy && npm run db:seed
npm run dev
```

| Comando | Qué comprueba |
|---|---|
| `npm run test:unit` | Motor de dinero, parsers, política de permisos, editor |
| `npm run test:integracion` | Importación contra los `.xlsx` **reales**, permisos y bitácora contra Postgres |
| `npm run test:pdf` | **Fidelidad contra el PDF original de HONOR**, con pdfplumber como oráculo |
| `npm run test:e2e` | El flujo completo en escritorio, iPad y iPhone, más axe |
| `npm run test:todo` | Todo lo anterior, en orden |

Las pruebas de integración y E2E comparten un solo Postgres y corren en serie a
propósito: en paralelo se pisan y fallan de forma intermitente, que es la peor
clase de fallo.

## Cómo está partido

```
src/lib/doc/          El documento. Funciones puras, sin servidor ni navegador
src/lib/editor/       Del estado del editor al documento. Pura también
src/lib/authz/        can() / assertCan(). Pura: la usan la interfaz y el servidor
src/server/import/    Leer → planear → aplicar. Ninguna fase toca la base salvo la última
src/server/data/      TODA la Prisma. autorizar() es la puerta de lo que escribe
src/server/pdf/       Chromium, con guarda de desbordamiento
src/app/(app)/        Lo que exige sesión: cuelga de un layout que la comprueba
tools/                huella.py, comparar.py, calibrar.py — el oráculo de fidelidad
```

Un candado de lint impide importar Prisma fuera de `src/server/data/**` (con
`src/server/auth/**` exento a propósito: es la capa que averigua quién es el
actor, cuando todavía no hay rol por el que filtrar).

## Lo que quedó fuera

Enlace público para la marca con token, segundo factor, modo oscuro y "revertir
importación" — sustituido por el respaldo automático antes de aplicar, que es
más barato y más seguro.
