# PLAN DE CONSTRUCCIÓN — Cotizador Katana Talent

Documento único de ejecución. Resuelve las contradicciones entre las cinco dimensiones y aplica las correcciones de las críticas adversariales.

**Hechos re-verificados por mí contra los archivos reales** (`pdfplumber` sobre `/root/.claude/uploads/79702344-727d-53e6-a039-f03e92494866/202ccb33-KatanaTabuladorHONOR.pdf`; los `.xlsx` en `…/scratchpad/KAT/01_CRM/`). Los archivos **sí existen**; el bloqueador §4.9 de la dimensión `pdf` era falso.

| Afirmación del brief | Medición real | Efecto |
|---|---|---|
| Precios de la tabla: 9.7pt `#3D0070` | **9.6pt `#1E3A8A`** (`0.1176,0.2275,0.5412`) | color nuevo en la paleta; el nombre del talento sí es 9.7pt `#3D0070` |
| 8 viñetas, paso 15.7 | **9 viñetas**, tops 489.60→616.00, paso **15.8** exacto | +1 bullet, `--rhythm` cambia |
| Términos con "lead" bold morado | marcador `1.` bold morado, **todo el texto regular `#1C1326`** | se borra el modelo de runs bold |
| Sangría francesa en listas | **no hay**: continuación en x=52.02, igual que el marcador | `text-indent`, no `padding-left` |
| Viñeta `•` en x=52 | glifo `(cid:127)` de **avance cero** en x=52.02 + **dos espacios** → texto en 57.02 | offset real 5.004pt @9pt |
| Términos: texto en x=52 | marcador en 52.02 (ancho 7.5) + 2 espacios → texto en **59.52** | offset 12.51pt |
| Tabla en rejilla uniforme | centros **240.803 / 320.173 / 408.047 / 498.756** = **60/88/119/151 mm** desde el borde de caja; **sin líneas verticales** | plantilla `honor-4col` con centros fijos |
| Barra de confidencialidad | borde lila 0.6 en los 4 lados **+** trazo morado lw=3 centrado en x=34.02 (sobresale 1.5pt) | `::before` absoluto, no `border-left` |
| Interlínea de wrap | 711.20→724.40 = **13.2** (no 13.0) | `--leading` |
| Logo pág.1 | 34.0157→153.0709 × 42.5197→84.3633 = **119.0551 × 41.8436** | valores exactos |

---

## 1. STACK FINAL

| Capa | Elección | Versión | Justificación (solo si no es obvia) |
|---|---|---|---|
| Runtime | Node LTS | 22.22.x | fijado por el entorno |
| Framework | Next.js App Router, `output:'standalone'` | 15.5.x | ≥15.2.3 obligatorio por CVE-2025-29927 |
| Lenguaje | TypeScript `strict` | 5.7 | |
| UI runtime | React | 19 | `useDeferredValue` es el mecanismo del preview en vivo sin debounce |
| Base de datos | PostgreSQL | 16.10 | |
| ORM | Prisma | 6.x | `Bytes` devuelve `Uint8Array` en 6.x — el código lo asume |
| Estilos | Tailwind v4 CSS-first + shadcn/ui | 4.1 / latest | **`npx shadcn init` primero**, los tokens Katana se derivan encima; nunca un vocabulario paralelo |
| Estado del editor | zustand + middleware immer | 5.x | `Context+useReducer` re-renderiza el documento entero por tecla |
| Formularios (admin/import) | react-hook-form + zod | 7.x / **4.x** | zod 4: `z.strictObject()`, `.strict()` está deprecado |
| Excel | **exceljs** (streaming, server-only) | 4.x | SheetJS en npm está congelado con CVEs de prototype pollution |
| Dinero | **big.js** | 6.x | `toFixed(2)` no es HALF_UP; `(1234.565).toFixed(2)==='1234.56'` |
| PDF | **Playwright + Chromium en la imagen de la app** | 1.5x (la del lockfile) | mismo componente React para preview y PDF; sin contenedor Chromium aparte |
| PDF post-proceso | pdf-lib | 1.17 | solo metadatos (`Title/Author/Subject/CreationDate` fijado a `updatedAt`) |
| Fuente del documento | **Nimbus Sans** (URW, clon de Helvetica) → subset woff2 `KatanaSans`; respaldo Liberation Sans | `fonts-urw-base35` | Liberation clona **Arial**: métricas iguales, **formas distintas** → el diff de píxeles nunca cierra. Nimbus clona Helvetica en métricas **y** trazos |
| Fuente de la app | Inter Variable vía `next/font/local` desde `app/fonts/` | — | nunca en `public/` (duplica y expone sin hash) |
| Auth | **sesiones propias opacas en Postgres** + cookie `__Host-` | — | Auth.js+Credentials fuerza JWT irrevocable; Lucia está descontinuado |
| Hash | `@node-rs/argon2` argon2id m=64MiB t=3 p=1 | 2.x | binarios precompilados, sin node-gyp. **No exporta `needsRehash`**: se parsea PHC a mano |
| Logs | pino con `redact` + allowlist | 9.x | |
| Pruebas | Vitest 3 + @playwright/test + fast-check | — | |
| Oráculo de fidelidad | **Python 3 + pdfplumber** (solo CI e imagen de dev) | 0.11.10 | es el mismo extractor con el que se levantó la spec; declarado como paso de CI |
| Despliegue | Docker Compose + Cloudflare Tunnel; **build en CI → GHCR**, el servidor hace `pull` | Compose v2/v5 | construir Next en 2 vCPU/4 GB con el stack en pie es OOM garantizado |

**Descartado explícitamente:** `@react-pdf/renderer` (no sirve de preview → doble implementación), pdf-lib/PDFKit como generador (reimplementar wrap, viudas, cebra), Auth.js, Lucia, `@dnd-kit` (⌃⌄ + ⌥↑↓ cubren el caso), `nuqs` en el editor (solo en filtros del listado), `pg_trgm`/GIN (son 69 nombres: el scoring va en Node), Redis, S3/R2 para PDFs, IndexedDB/service worker, modo horizontal del tabulador, `revertImport`.

### Resolución de contradicciones entre dimensiones

1. **¿Chromium en contenedor aparte (authops §5.3) o en la app (deploy)?** → **En la app**, y el render usa `page.setContent(html)` con HTML **totalmente autocontenido** (fuentes y logo como `data:` URI) + `page.route('**', r => r.abort())` salvo `data:`. Esto elimina de un golpe: la autenticación del headless (authops B2), el matcher del middleware, la ruta `/render`, el riesgo de SSRF hacia `db:5432`, y la carrera de carga de red. Es la única respuesta coherente.
2. **¿Preview = HTML o = PDF regenerado?** → HTML, en un **`<iframe>` mismo-origen construido con la misma función `renderDocumentHtml()`**. Aísla el CSS de la app (Tailwind preflight es la amenaza real, no un `if (isPrint)`), elimina el `@media screen` dentro del documento y hace que el candado "DOM idéntico" signifique algo.
3. **`taxMode: EXCLUDED`** → se elimina. El tabulador no tiene totales; "No incluyen IVA." es una `QuoteConsideration` (texto). `TaxMode { ADDED, EXEMPT }`.
4. **Dinero `BigInt` vs `Int`** → columnas `Int` centavos (JSON-serializable en RSC/Server Actions); `bigint` solo dentro de `computeQuote`, con conversión y **guarda dura de $20,000,000.00 MXN** al cruzar la frontera.
5. **Identidad partida en `Talent.normalizedKey` + `TalentAlias.normalized`** → una sola tabla `TalentIdentifier` con **un único índice global** de identidad.
6. **Subida de Excel por Server Action** → **Route Handler** `POST /api/importaciones` (el límite de 1 MB de Server Actions rompe la importación), síncrono con timeout de 60 s.
7. **`Talent.code` NOT NULL** → nullable; **jamás se acuñan `KT-*`**; el id interno es `cuid()`.
8. **Bitácora dentro de la transacción de render/import** → el render ocurre **fuera** de toda transacción; el import usa `$transaction(fn, {timeout:120_000, isolationLevel:'ReadCommitted'})` con la identidad ya resuelta en la fase de preview.

---

## 2. ÁRBOL DE ARCHIVOS DEL REPOSITORIO

```
/home/user/CotizadorKatana
├── README.md
├── package.json                      # scripts: dev build start test:unit test:e2e test:pdf calibrar
├── next.config.ts                    # standalone, serverExternalPackages, allowedOrigins
├── tsconfig.json  eslint.config.mjs  stylelint.config.mjs
│                                     # eslint: no-restricted-imports de prisma fuera de src/server/data/**
│                                     # stylelint: prohíbe el shorthand `font:` en document.css
├── vitest.config.ts  playwright.config.ts
├── .env.example                      # TODOS los valores entrecomillados (bash-safe)
├── .gitignore                        # .env, docker-compose.override.yml, .auth/
├── .dockerignore
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   │   └── 0001_init/migration.sql   # + CHECKs y triggers PEGADOS al final (Prisma solo ejecuta migration.sql)
│   └── seed.ts                       # admin inicial, 19 DeliverableType, plantillas, 7 alias imposibles
│
├── assets/                           # fuera de public/: next/font los hashea
│   ├── fonts/KatanaSans-{Regular,Bold}.woff2   # Nimbus Sans subset latino+es (~18 KB c/u)
│   ├── fonts/LICENSE-URW-AFPL.txt
│   ├── fonts/Inter-Variable.woff2
│   └── brand/katana_logo.png         # 478×168, versionado desde el scratchpad
│
├── src/
│   ├── env.ts                        # zod al arranque; falla ruidosamente
│   ├── middleware.ts                 # SOLO redirige si no hay cookie + nonce CSP. NO autoriza.
│   │
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/invitacion/[token]/page.tsx
│   │   ├── (app)/layout.tsx          # AppShell: sidebar ≥1024 | bottom-nav <768
│   │   ├── (app)/page.tsx            # lanzadera, no BI
│   │   ├── (app)/cotizaciones/page.tsx
│   │   ├── (app)/cotizaciones/[id]/page.tsx        # RSC → <EditorShell>
│   │   ├── (app)/cotizaciones/[id]/vista/page.tsx  # modo junta (única pantalla completa)
│   │   ├── (app)/talentos/{page,[id]/page}.tsx
│   │   ├── (app)/tarifario/page.tsx
│   │   ├── (app)/importar/page.tsx                 # wizard completo con ?paso=
│   │   ├── (app)/admin/{usuarios,bitacora}/page.tsx
│   │   ├── (app)/ajustes/{marca,plantillas}/page.tsx
│   │   ├── api/health/route.ts       # 200 solo si SELECT 1 && existe el binario de Chromium
│   │   ├── api/importaciones/route.ts             # POST multipart (NO Server Action)
│   │   └── api/documentos/[snapshotFileId]/route.ts # descarga autenticada + auditada
│   │
│   ├── lib/
│   │   ├── authz/policy.ts           # can()/assertCan() — puro, importable desde cliente
│   │   ├── money.ts                  # centavos, formatMXN propio (NUNCA Intl: ICU diverge)
│   │   ├── fecha.ts                  # meses en español a mano
│   │   └── doc/
│   │       ├── metrics.ts            # LAYOUT (invariantes) y GOLDEN_HONOR (fixture) SEPARADOS
│   │       ├── afm.ts                # tabla de anchos Helvetica 1000upm, vendorizada
│   │       ├── measure.ts            # runWidth/wrap — determinista, sin DOM
│   │       ├── paginate.ts           # función pura → PagedDoc
│   │       └── payload.ts            # buildDocumentPayload(): estado no guardado → SnapshotPayload
│   │
│   ├── components/
│   │   ├── ui/                       # shadcn (instalar bajo demanda)
│   │   ├── doc/                      # ⚠ prohibido isPrint/isPreview/typeof window (lint)
│   │   │   ├── Documento.tsx  Pagina.tsx  Cromo.tsx  CajaMetadatos.tsx
│   │   │   ├── TablaTarifas.tsx  GrupoTalento.tsx  BloqueTotales.tsx
│   │   │   ├── Listas.tsx  Confidencialidad.tsx  Firma.tsx  PieDoc.tsx
│   │   │   └── document.css          # hex literales, longhands, sin @media
│   │   └── editor/                   # EditorShell, PanelPreview (iframe), MatrizPrecios,
│   │                                 # CeldaPrecio, InputMoneda, SelectorTalentos, …
│   │
│   └── server/
│       ├── auth/{password,session,rate-limit}.ts
│       ├── audit/append.ts           # append(tx, evento) — SIEMPRE recibe el tx
│       ├── data/**                   # ÚNICA puerta a Prisma; toda consulta recibe `actor`
│       │                             # y filtra en el WHERE. `import 'server-only'`
│       ├── import/
│       │   ├── types.ts  header.ts   # detectHeaderRow heurístico (medido: 0,1,3 según hoja)
│       │   ├── parse-price.ts  parse-metric.ts  identity.ts
│       │   ├── plan.ts  commit.ts
│       ├── pricing/compute.ts        # PURA: sin Prisma, sin I/O, sin Date.now()
│       ├── quote/{folio,freeze}.ts
│       └── pdf/{browser,render,stamp}.ts   # pool singleton + setContent + guarda de desbordamiento
│
├── tests/
│   ├── fixtures/
│   │   ├── honor_tabulador_original.pdf     # copiado de uploads en el commit 1
│   │   ├── honor_baseline.json              # huella generada por tools/huella.py
│   │   ├── datos-honor.ts                   # los 4 talentos × 4 formatos con sus overrides
│   │   └── xlsx/                            # los dos .xlsx reales, para pruebas de importación
│   ├── unit/{parse-price,parse-metric,identity,compute,folio,money}.test.ts
│   ├── integracion/{import,seed,concurrencia}.test.ts
│   ├── pdf/fidelidad-{tabulador,cotizacion}.test.ts
│   └── e2e/{flujo,importacion,roles,responsivo}.spec.ts
│
├── tools/
│   ├── huella.py                     # pdfplumber → JSON de runs (texto,x,top,size,color)
│   ├── comparar.py                   # oráculo: diff de runs + cajas de tinta canonicalizadas
│   └── calibrar.py                   # deriva las constantes de document.css DESDE el fixture
│
├── deploy/
│   ├── backup/{Dockerfile,entrypoint.sh,respaldar-ahora.sh,restore.sh}
│   └── fonts/local.conf
├── docker-compose.yml                # sin override versionado; dev usa docker-compose.dev.yml
├── docker-compose.dev.yml            # NO se carga solo
├── Dockerfile                        # deps → browsers → builder → runtime-base → {migrator,runner}
├── deploy.sh                         # instalar|actualizar|estado|logs|respaldar|restaurar
├── .github/workflows/ci.yml          # pruebas + build + push a GHCR
└── docs/{GUIA_DESPLIEGUE.md,MANUAL_USUARIO.md}
```

---

## 3. MODELO DE DATOS

```prisma
// prisma/schema.prisma
// ═══════════════════════════════════════════════════════════════════════════
//  REGLAS DE DINERO (inviolables)
//   · Todo importe es CENTAVOS ENTEROS de MXN, columna `Int`. Prohibido Float/Decimal.
//   · `BigInt` NO se usa en columnas: JSON.stringify(1n) lanza y rompe RSC/Server Actions.
//     computeQuote trabaja en bigint internamente y valida el techo de $20,000,000.00
//     (2_000_000_000 centavos < Int32) al cruzar la frontera.
//   · Porcentajes en basis points Int (1600 = 16.00%).
//  Los CHECK y triggers viven en migrations/0001_init/migration.sql, NO en un
//  constraints.sql hermano (Prisma solo ejecuta migration.sql).
// ═══════════════════════════════════════════════════════════════════════════

generator client { provider = "prisma-client-js" }

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [citext]
}

// ───────────────────────────── ENUMS ─────────────────────────────

enum Rol { ADMIN COMERCIAL LECTURA }
enum EstadoUsuario { ACTIVO SUSPENDIDO DESACTIVADO }

/// El precio es un TIPO COMPUESTO. Los 3 tokens de texto son los únicos que
/// existen en las 19 columnas de precio del TARIFARIO (N/A×93, Pendiente×87,
/// Caso por caso×37 sobre 399 celdas).
enum PriceStatus { QUOTED PENDING NOT_APPLICABLE CASE_BY_CASE }

enum RosterKind { KATANA KIF FIERA }
enum TalentRateStatus { ACTIVO INCOMPLETO CAPTURADO PENDIENTE REFERENCIA_HISTORICA }
enum Platform { INSTAGRAM TIKTOK YOUTUBE FACEBOOK TWITCH KICK X OTRA }
enum MetricParseStatus { EXACT INFERRED FAILED }

enum DeliverableCategory { SOCIAL_CONTENT PLACEMENT EVENT STREAMING YOUTUBE LONGFORM RIGHTS }
enum UnitKind { PIEZA HORA MES EVENTO PERIODO_7D }

enum QuoteStatus { DRAFT REQUIERE_APROBACION SENT IN_NEGOTIATION ACCEPTED REJECTED EXPIRED CANCELLED }
enum TaxMode { ADDED EXEMPT }
enum DiscountType { PERCENT FIXED }
enum DocKind { TABULADOR COTIZACION }

enum RateChangeSource { IMPORT MANUAL SEED }
enum IdentifierSource { PERFIL_COMERCIAL TARIFARIO TALENTOS ROSTER KIF FIERA MANUAL SEED IMPORT_MATCH }

enum ImportKind { CRM_COMERCIAL ROSTER }
enum ImportStatus { UPLOADED PARSED PREVIEWED COMMITTED ABORTED FAILED }

enum CategoriaBitacora { AUTENTICACION USUARIOS CATALOGO TARIFARIO COTIZACION DOCUMENTO IMPORTACION AJUSTES SISTEMA }

// ──────────────────── USUARIOS · SESIONES · BITÁCORA ────────────────────

model Usuario {
  id                  String        @id @default(cuid())
  email               String        @unique @db.Citext
  /// Al dar de baja liberando el correo se reescribe a "baja+{id}@katana.local"
  /// y el original queda aquí. Prisma no expresa índices únicos parciales.
  emailOriginal       String?
  nombre              String
  rol                 Rol           @default(LECTURA)
  estado              EstadoUsuario @default(ACTIVO)
  /// Aprobador de cotizaciones sin necesidad de ser ADMIN (Ramiro Ortiz en el CRM real).
  esAprobador         Boolean       @default(false)

  passwordHash        String?
  passwordAlgo        String        @default("argon2id")
  passwordCambiadoEn  DateTime?
  debeCambiarPassword Boolean       @default(false)
  bloqueadoHasta      DateTime?
  ultimoAccesoEn      DateTime?

  creadoEn            DateTime      @default(now())
  actualizadoEn       DateTime      @updatedAt

  sesiones            Sesion[]
  eventos             Bitacora[]     @relation("ActorBitacora")
  cotizacionesCreadas Quote[]        @relation("QuoteCreadaPor")
  cotizacionesAgente  Quote[]        @relation("QuoteAgente")
  snapshots           QuoteSnapshot[]
  lotesImport         ImportBatch[]
  revisionesTarifa    TalentRateRevision[]

  @@index([estado, rol])
}

model Sesion {
  id               String    @id @default(cuid())   // NO es el token
  tokenHash        Bytes     @unique                 // sha256(token); Prisma 6 → Uint8Array
  usuarioId        String
  usuario          Usuario   @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  creadaEn         DateTime  @default(now())
  expiraEn         DateTime                          // deslizante
  expiraAbsolutoEn DateTime                          // tope duro
  ultimaActividadEn DateTime @default(now())
  /// Step-up: operaciones peligrosas exigen < 10 min desde esta marca.
  reautenticadoEn  DateTime?
  recordar         Boolean   @default(false)
  ip               String?
  userAgent        String?
  revocadaEn       DateTime?
  motivoRevocacion String?

  @@index([usuarioId, revocadaEn])
  @@index([expiraAbsolutoEn])
}

model Invitacion {
  id            String    @id @default(cuid())
  email         String
  nombre        String
  rol           Rol
  tokenHash     Bytes     @unique
  invitadoPorId String
  creadaEn      DateTime  @default(now())
  expiraEn      DateTime
  aceptadaEn    DateTime?
  revocadaEn    DateTime?
  @@index([email, aceptadaEn, revocadaEn])
}

model TokenRestablecimiento {
  id        String    @id @default(cuid())
  usuarioId String
  tokenHash Bytes     @unique
  creadoEn  DateTime  @default(now())
  expiraEn  DateTime
  usadoEn   DateTime?
  @@index([usuarioId, usadoEn])
}

/// Tabla barata y purgable. Los login_fallido NO van a Bitacora: un ataque de
/// credential stuffing haría crecer sin límite una tabla append-only.
model IntentoAcceso {
  id       String   @id @default(cuid())
  email    String
  ip       String?
  exito    Boolean
  motivo   String?
  creadoEn DateTime @default(now())
  @@index([email, creadoEn])
  @@index([ip, creadoEn])
}

/// Append-only. Trigger + REVOKE UPDATE,DELETE al rol de la app.
/// onDelete: Restrict (NO SetNull: el UPDATE del SetNull dispararía el trigger).
model Bitacora {
  id              String            @id @default(cuid())
  ocurridoEn      DateTime          @default(now())
  actorId         String?
  actor           Usuario?          @relation("ActorBitacora", fields: [actorId], references: [id], onDelete: Restrict)
  actorEmail      String?           // snapshots: el histórico no se reescribe
  actorNombre     String?
  actorRol        Rol?
  categoria       CategoriaBitacora
  accion          String            // "tarifario.precio_base_cambiado"
  entidadTipo     String?
  entidadId       String?
  entidadEtiqueta String?           // "KAT-HON-2026-001", "Ronny · TikTok + réplica Reel"
  resumen         String            // frase en español lista para pintar
  cambios         Json?             // { campo: { antes, despues } }
  metadatos       Json?
  exito           Boolean           @default(true)
  ip              String?
  userAgent       String?
  sesionId        String?
  /// Coalescencia: (actor, entidad, campo, ventana 5 min) actualiza `cambios.despues`
  /// en vez de insertar. Las transiciones de estado nunca se coalescen.
  ventana         String?

  @@index([ocurridoEn(sort: Desc)])
  @@index([entidadTipo, entidadId, ocurridoEn(sort: Desc)])
  @@index([actorId, ocurridoEn(sort: Desc)])
  @@unique([ventana])
}

// ──────────────────────── TALENTOS · IDENTIDAD ────────────────────────

model Talent {
  id                  String     @id @default(cuid())
  /// SOLO se lee de la hoja PERFIL COMERCIAL — CAPTURA. NUNCA se acuña.
  /// 21 códigos reales, no contiguos (faltan KT-018 y KT-021..KT-026).
  code                String?    @unique
  canonicalName       String
  /// Lo que se imprime por defecto. El Excel trae display_name = canonical_name
  /// para KT-004 ("Ronaldo BXM"); el seed lo corrige a "Ronny" para los 4 del PDF.
  displayName         String
  slug                String     @unique
  roster              RosterKind @default(KATANA)

  category            String?
  verticals           String[]   @default([])
  relationshipType    String?    // "KATANA — Casa" | "— Aliado (definir)" | …
  country             String?
  city                String?

  /// col 12 del TARIFARIO: TEXTO ("Twitch principal | Kick disponible"). NO es formato.
  primaryPlatformNote String?
  rateStatus          TalentRateStatus @default(INCOMPLETO)
  rateStatusRaw       String?
  rateSourceLabel     String?
  /// Nota de Padigol (704 car. con un tarifario de paquetes en prosa) y las de
  /// Tejón/Divino/Gambetiti/Mike. Se preserva ÍNTEGRA, jamás se parsea.
  rateNotes           String?    @db.Text

  bio                 String?    @db.Text
  achievements        String?    @db.Text
  campaigns           String?    @db.Text
  photoUrl            String?
  driveFolderId       String?

  isActive            Boolean    @default(true)
  /// El último import commiteado no lo trajo. NUNCA se borra por ausencia.
  missingInLastImport Boolean    @default(false)

  creadoEn            DateTime   @default(now())
  actualizadoEn       DateTime   @updatedAt
  actualizadoPorId    String?
  actualizadoPorNombre String?

  identifiers    TalentIdentifier[]
  metrics        TalentMetric[]
  rates          TalentRate[]
  rateRevisions  TalentRateRevision[]
  quoteTalents   QuoteTalent[]

  @@index([roster, isActive])
  @@index([displayName])
}

/// ⭐ ÚNICO índice de identidad del sistema. Absorbe canónico, display y alias.
/// Dos talentos no pueden reclamar el mismo nombre normalizado → la resolución
/// es determinista y las fusiones erróneas se detectan como colisión real.
model TalentIdentifier {
  id          String           @id @default(cuid())
  talentId    String
  raw         String           // crudo: "Tony Gastelum ", "Padigol)", "Ronny (Ronaldo López"
  normalized  String           @unique
  isCanonical Boolean          @default(false)
  source      IdentifierSource
  confidence  Float?
  creadoEn    DateTime         @default(now())
  talent      Talent           @relation(fields: [talentId], references: [id], onDelete: Cascade)
  @@index([talentId])
}

/// Append-only con deduplicación. Chuy re-importa cada 14 días; sin el unique,
/// un archivo sin cambios inserta 64 filas idénticas.
model TalentMetric {
  id           String            @id @default(cuid())
  talentId     String
  platform     Platform
  followers    Int?
  rawValue     String            // "99.1.K", "7.1 M", "48.9K aprox. — validar"
  parseStatus  MetricParseStatus
  needsReview  Boolean           @default(false)
  notes        String[]          @default([])
  /// "Última actualización" del roster. Está vacía en todas las filas medidas →
  /// el fallback es la fecha del archivo; si no, importedAt truncado a día.
  capturedAt   DateTime
  importedAt   DateTime          @default(now())
  sourceLabel  String?
  importBatchId String?
  talent       Talent            @relation(fields: [talentId], references: [id], onDelete: Cascade)

  @@unique([talentId, platform, capturedAt, rawValue])
  @@index([talentId, platform, capturedAt(sort: Desc)])
  @@index([needsReview])
}

// ─────────── CATÁLOGO: 19 FORMATOS (cols 1-11 y 13-20 del TARIFARIO) ───────────

model DeliverableType {
  id             String   @id @default(cuid())
  code           String   @unique          // TIKTOK, REEL_IG, TIKTOK_REEL_MIRROR, …
  name           String                    // etiqueta es-MX en la app
  pdfLabel       String                    // "TIKTOK + REEL"
  pdfSublabel    String?                   // "(ESPEJO)"  ← segunda línea centrada
  excelHeader    String   @unique          // encabezado EXACTO del .xlsx
  category       DeliverableCategory
  unit           UnitKind @default(PIEZA)
  unitLabel      String   @default("pieza")
  allowsQuantity Boolean  @default(true)   // false: Exclusividad mensual, Fee pelea
  sortOrder      Int
  isActive       Boolean  @default(true)

  rates         TalentRate[]
  rateRevisions TalentRateRevision[]
  quotePrices   QuotePrice[]
  quoteColumns  QuoteColumn[]
  quoteLines    QuoteLine[]
  @@index([category, sortOrder])
}

// ─────────────────── TARIFAS BASE (estado + historia) ───────────────────

model TalentRate {
  id                String      @id @default(cuid())
  talentId          String
  deliverableTypeId String
  amountCents       Int?
  priceStatus       PriceStatus @default(PENDING)
  note              String?     @db.Text
  sourceLabel       String?
  lastChangeSource  RateChangeSource @default(IMPORT)
  lastImportBatchId String?
  /// Dispara la detección de CONFLICTO al re-importar un Excel viejo.
  manuallyEditedAt  DateTime?
  /// Bloqueo optimista.
  revision          Int         @default(0)
  creadoEn          DateTime    @default(now())
  actualizadoEn     DateTime    @updatedAt
  actualizadoPorId  String?

  talent          Talent          @relation(fields: [talentId], references: [id], onDelete: Cascade)
  deliverableType DeliverableType @relation(fields: [deliverableTypeId], references: [id])
  revisions       TalentRateRevision[]

  @@unique([talentId, deliverableTypeId])
  @@index([deliverableTypeId, priceStatus])
}

model TalentRateRevision {
  id                String      @id @default(cuid())
  talentRateId      String
  talentId          String
  deliverableTypeId String
  beforeAmountCents Int?
  beforePriceStatus PriceStatus?
  afterAmountCents  Int?
  afterPriceStatus  PriceStatus
  source            RateChangeSource
  importBatchId     String?
  actorId           String?
  reason            String?
  creadoEn          DateTime    @default(now())

  talentRate      TalentRate      @relation(fields: [talentRateId], references: [id], onDelete: Cascade)
  talent          Talent          @relation(fields: [talentId], references: [id], onDelete: Cascade)
  deliverableType DeliverableType @relation(fields: [deliverableTypeId], references: [id])
  actor           Usuario?        @relation(fields: [actorId], references: [id], onDelete: Restrict)
  importBatch     ImportBatch?    @relation(fields: [importBatchId], references: [id], onDelete: SetNull)

  @@index([talentId, creadoEn(sort: Desc)])
  @@index([importBatchId])
}

// ──────────────────────── CLIENTES · CONTACTOS ────────────────────────

model Client {
  id            String  @id @default(cuid())
  displayName   String                      // "HONOR" ← lo impreso
  legalName     String?
  normalizedKey String  @unique
  /// 3 caracteres del folio. En el import NO se deriva: se parsea de
  /// KAT-([A-Z0-9]{3})-(\d{4})-(\d{3}). Reales: VPV HON NFX UFC PLR VDS RON AZT.
  folioCode     String  @unique @db.Char(3)
  vertical      String?
  taxId         String?
  /// KAT-RON-2026-001 tiene como "cliente" a Ronaldo BXM, que es un talento.
  isTalentManagement Boolean @default(false)
  isActive      Boolean @default(true)
  notes         String? @db.Text
  creadoEn      DateTime @default(now())
  actualizadoEn DateTime @updatedAt

  contacts ClientContact[]
  quotes   Quote[]
  @@index([displayName])
}

model ClientContact {
  id        String  @id @default(cuid())
  clientId  String
  name      String                          // "Fer Nicolini"
  role      String?
  email     String?
  phone     String?
  isPrimary Boolean @default(false)
  client    Client  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  quotes    Quote[]
  @@index([clientId])
}

// ───────────────────────────── COTIZACIÓN ─────────────────────────────

model Quote {
  id          String      @id @default(cuid())
  /// NULL mientras es DRAFT: un borrador muerto no quema consecutivo.
  folio       String?     @unique
  folioYear   Int?
  folioSeq    Int?
  draftRef    String      @unique          // "BORRADOR-7Q4K" (con reintento por colisión)
  /// Cotización histórica importada de PROPUESTAS KATANA ENGINE: conserva su
  /// folio aunque su estatus real sea "En desarrollo".
  isLegacy    Boolean     @default(false)

  clientId    String
  contactId   String?
  /// La columna "Agente / proveedor" del CRM trae "PARK8", una agencia externa
  /// que no es usuario de la app.
  agentUserId String?
  agentLabel  String?
  createdById String

  projectName String?
  quoteType   String?
  scopeText   String?     @db.Text
  status      QuoteStatus @default(DRAFT)
  aprobadaPorId String?
  aprobadaEn  DateTime?

  currency    String      @default("MXN")   // etiqueta de display; el sistema es mono-moneda
  taxMode     TaxMode     @default(ADDED)
  taxRateBps  Int         @default(1600)

  packageDiscountType  DiscountType?
  packageDiscountValue Int?                 // bps si PERCENT · centavos si FIXED
  validityLabel  String?  @default("15 días naturales")
  paymentTerms   String?

  includeTabulador  Boolean @default(true)
  includeCotizacion Boolean @default(false)
  layoutVersion     String  @default("honor-v1")

  // Caché de totales (la verdad la da computeQuote). Int centavos.
  subtotalCents        Int @default(0)
  lineDiscountCents    Int @default(0)
  packageDiscountCents Int @default(0)
  taxableBaseCents     Int @default(0)
  taxCents             Int @default(0)
  totalCents           Int @default(0)
  hasNonQuotedLines    Boolean @default(false)
  computedAt           DateTime?

  /// Bloqueo optimista: toda mutación va por updateMany({where:{id,revision}}).
  revision      Int      @default(0)
  notes         String?  @db.Text
  creadoEn      DateTime @default(now())
  actualizadoEn DateTime @updatedAt
  actualizadoPorNombre String?
  emittedAt     DateTime?
  currentSnapshotId String? @unique

  client          Client         @relation(fields: [clientId], references: [id])
  contact         ClientContact? @relation(fields: [contactId], references: [id], onDelete: SetNull)
  agent           Usuario?       @relation("QuoteAgente", fields: [agentUserId], references: [id])
  createdBy       Usuario        @relation("QuoteCreadaPor", fields: [createdById], references: [id])
  currentSnapshot QuoteSnapshot? @relation("SnapshotActual", fields: [currentSnapshotId], references: [id])

  talents        QuoteTalent[]
  columns        QuoteColumn[]
  prices         QuotePrice[]
  lines          QuoteLine[]
  considerations QuoteConsideration[]
  terms          QuoteTerm[]
  snapshots      QuoteSnapshot[] @relation("SnapshotsDeQuote")

  @@index([clientId, status])
  @@index([status, actualizadoEn(sort: Desc)])
}

model QuoteTalent {
  id                  String  @id @default(cuid())
  quoteId             String
  talentId            String
  /// Prellenado con Talent.displayName. Permite imprimir "Ronny" para KT-004
  /// y acortar "Kike Padilla / Rookie Leagues" (29 car. en 150pt de columna).
  displayNameOverride String?
  sortOrder           Int     @default(0)

  grossCents                    Int @default(0)
  lineDiscountCents             Int @default(0)
  allocatedPackageDiscountCents Int @default(0)
  netCents                      Int @default(0)

  quote  Quote  @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  talent Talent @relation(fields: [talentId], references: [id])
  prices QuotePrice[]
  lines  QuoteLine[]

  @@unique([quoteId, talentId])
  @@index([quoteId, sortOrder])
}

/// Columnas del tabulador con su etiqueta impresa: el PDF renombra
/// "TikTok + réplica Reel" → "TIKTOK + REEL" / "(ESPEJO)".
model QuoteColumn {
  id                String  @id @default(cuid())
  quoteId           String
  deliverableTypeId String
  headerLabel       String
  headerSublabel    String?
  sortOrder         Int     @default(0)
  quote           Quote           @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  deliverableType DeliverableType @relation(fields: [deliverableTypeId], references: [id])
  @@unique([quoteId, deliverableTypeId])
  @@index([quoteId, sortOrder])
}

/// ⭐ EL CORAZÓN DEL PRODUCTO. Precio efectivo = override ?? base.
/// Evidencia: el PDF HONOR imprime Mariel/Reel $120,000 con el tarifario en
/// "Pendiente"; Ronny/espejo $150,000 vs $195,000; Tony/espejo $80,000 vs $90,000.
model QuotePrice {
  id                String  @id @default(cuid())
  quoteId           String
  quoteTalentId     String
  deliverableTypeId String

  baseAmountCents   Int?
  basePriceStatus   PriceStatus
  baseCapturedAt    DateTime @default(now())

  overrideAmountCents Int?
  overridePriceStatus PriceStatus?
  overrideReason      String?
  overriddenById      String?
  overriddenAt        DateTime?

  showInTabulador Boolean @default(true)
  sortOrder       Int     @default(0)

  quote           Quote           @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  quoteTalent     QuoteTalent     @relation(fields: [quoteTalentId], references: [id], onDelete: Cascade)
  deliverableType DeliverableType @relation(fields: [deliverableTypeId], references: [id])
  lines           QuoteLine[]

  @@unique([quoteId, quoteTalentId, deliverableTypeId])
  @@index([quoteId, sortOrder])
}

/// Renglones de la COTIZACIÓN.
/// CHECK: si hay quotePriceId, unitAmountCents DEBE ser NULL (el precio se
/// resuelve desde QuotePrice). unitAmountCents solo existe para renglones
/// libres (producción, viáticos, paquetes de Padigol).
model QuoteLine {
  id                String  @id @default(cuid())
  quoteId           String
  quoteTalentId     String?
  quotePriceId      String?
  deliverableTypeId String?

  description       String
  detail            String?     @db.Text
  quantity          Int         @default(1)
  unitAmountCents   Int?
  priceStatus       PriceStatus @default(QUOTED)

  lineDiscountType  DiscountType?
  lineDiscountValue Int?
  grossCents        Int     @default(0)
  discountCents     Int     @default(0)
  totalCents        Int     @default(0)
  isBillable        Boolean @default(true)
  sortOrder         Int     @default(0)
  notes             String?

  quote           Quote            @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  quoteTalent     QuoteTalent?     @relation(fields: [quoteTalentId], references: [id], onDelete: Cascade)
  quotePrice      QuotePrice?      @relation(fields: [quotePriceId], references: [id], onDelete: SetNull)
  deliverableType DeliverableType? @relation(fields: [deliverableTypeId], references: [id])

  @@index([quoteId, sortOrder])
}

/// Consideraciones y términos se COPIAN desde AppSetting a la cotización al
/// crearla, para que sean editables por cotización. (Sin modelos DocTemplate.)
model QuoteConsideration {
  id        String @id @default(cuid())
  quoteId   String
  text      String @db.Text
  sortOrder Int    @default(0)
  quote     Quote  @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  @@index([quoteId, sortOrder])
}

model QuoteTerm {
  id        String @id @default(cuid())
  quoteId   String
  number    Int
  /// El fixture NO tiene "lead" en negritas: solo el marcador "N." es bold
  /// morado y todo el cuerpo es Helvetica regular #1C1326.
  body      String @db.Text
  sortOrder Int    @default(0)
  quote     Quote  @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  @@unique([quoteId, number])
}

/// ⭐ SNAPSHOT INMUTABLE. Trigger bloquea UPDATE/DELETE.
/// El renderer lee EXCLUSIVAMENTE de `payload`; nunca de las tablas vivas.
model QuoteSnapshot {
  id              String   @id @default(cuid())
  quoteId         String
  version         Int
  folio           String
  emittedAt       DateTime @default(now())
  emittedById     String
  payload         Json     // SnapshotPayload autosuficiente (incluye logoDataUri)
  payloadHash     String   // sha256 del JSON canónico
  engineVersion   String
  layoutVersion   String
  templateVersion String
  chromiumVersion String

  quote     Quote  @relation("SnapshotsDeQuote", fields: [quoteId], references: [id], onDelete: Restrict)
  currentOf Quote? @relation("SnapshotActual")
  emittedBy Usuario @relation(fields: [emittedById], references: [id])
  files     QuoteSnapshotFile[]

  @@unique([quoteId, version])
  @@index([folio])
}

/// Tabla hija: el usuario pidió DOS documentos. Además, escribir los PDFs aquí
/// evita relajar el trigger de inmutabilidad del snapshot.
model QuoteSnapshotFile {
  id         String        @id @default(cuid())
  snapshotId String
  kind       DocKind
  path       String        // /var/lib/katana/documentos/{aaaa}/{mm}/{uuid}.pdf
  sha256     String
  bytes      Int
  pageCount  Int
  renderedAt DateTime      @default(now())
  snapshot   QuoteSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  @@unique([snapshotId, kind])
}

// ─────────────────── FOLIOS · MARCA · AJUSTES · IMPORT ───────────────────

/// scope = "{FOLIO_CODE}-{YYYY}" p.ej. "HON-2026".
/// INSERT … ON CONFLICT DO UPDATE … RETURNING: atómico, sin lock explícito.
model FolioCounter {
  scope         String   @id
  lastSeq       Int      @default(0)
  actualizadoEn DateTime @updatedAt
}

model BrandAsset {
  id          String   @id @default(cuid())
  key         String   @unique          // "logo_primary"
  fileName    String
  mimeType    String
  width       Int?
  height      Int?
  sha256      String
  storagePath String
  creadoEn    DateTime @default(now())
}

model AppSetting {
  key           String   @id            // "iva.bps", "consideraciones.default", "terminos.default"
  value         Json
  actualizadoEn DateTime @updatedAt
}

/// El preview vive minutos: plan y decisiones son JSON, no 4 tablas con ~2000
/// filas. La evidencia permanente es el .xlsx guardado + TalentRateRevision + Bitacora.
model ImportBatch {
  id               String       @id @default(cuid())
  kind             ImportKind
  originalFileName String
  sha256           String                      // indexado, NO único: re-importar es válido
  sizeBytes        Int
  storagePath      String
  status           ImportStatus @default(UPLOADED)
  uploadedById     String
  uploadedAt       DateTime     @default(now())
  committedAt      DateTime?
  /// sha256(archivo + JSON canónico de decisiones). Doble clic no duplica nada.
  commitKey        String?      @unique
  /// ImportPlan completo: 1 entrada por TALENTO (no por talento×formato).
  plan             Json?
  decisions        Json?
  stats            Json?
  errorMessage     String?      @db.Text

  uploadedBy    Usuario @relation(fields: [uploadedById], references: [id])
  rateRevisions TalentRateRevision[]

  @@index([sha256])
  @@index([status, uploadedAt(sort: Desc)])
}
```

### `migrations/0001_init/migration.sql` — cola obligatoria

```sql
-- ⚠ Prisma solo ejecuta migration.sql. Este bloque va PEGADO al final del
-- archivo generado con `prisma migrate dev --create-only`.
-- src/env.ts verifica su presencia al arrancar y falla el boot si faltan.

ALTER TABLE "TalentRate" ADD CONSTRAINT tr_price_shape CHECK (
  ("priceStatus" = 'QUOTED' AND "amountCents" IS NOT NULL AND "amountCents" >= 0)
  OR ("priceStatus" <> 'QUOTED' AND "amountCents" IS NULL));

ALTER TABLE "QuotePrice" ADD CONSTRAINT qp_base_shape CHECK (
  ("basePriceStatus" = 'QUOTED' AND "baseAmountCents" IS NOT NULL)
  OR ("basePriceStatus" <> 'QUOTED' AND "baseAmountCents" IS NULL));
ALTER TABLE "QuotePrice" ADD CONSTRAINT qp_override_shape CHECK (
  "overridePriceStatus" IS NULL
  OR ("overridePriceStatus" = 'QUOTED' AND "overrideAmountCents" IS NOT NULL)
  OR ("overridePriceStatus" <> 'QUOTED' AND "overrideAmountCents" IS NULL));

-- Una sola fuente de verdad para el precio de un renglón ligado.
ALTER TABLE "QuoteLine" ADD CONSTRAINT ql_price_source CHECK (
  ("quotePriceId" IS NOT NULL AND "unitAmountCents" IS NULL)
  OR ("quotePriceId" IS NULL));
ALTER TABLE "QuoteLine" ADD CONSTRAINT ql_free_shape CHECK (
  "quotePriceId" IS NOT NULL
  OR ("priceStatus" = 'QUOTED' AND "unitAmountCents" IS NOT NULL)
  OR ("priceStatus" <> 'QUOTED' AND "unitAmountCents" IS NULL));
ALTER TABLE "QuoteLine" ADD CONSTRAINT ql_qty CHECK ("quantity" > 0);

ALTER TABLE "Quote" ADD CONSTRAINT q_tax_bps CHECK ("taxRateBps" BETWEEN 0 AND 10000);
ALTER TABLE "Quote" ADD CONSTRAINT q_folio_when_emitted CHECK (
  "isLegacy" OR "status" IN ('DRAFT','REQUIERE_APROBACION','CANCELLED') OR "folio" IS NOT NULL);
ALTER TABLE "Quote" ADD CONSTRAINT q_total_ceiling CHECK ("totalCents" <= 2000000000);

CREATE OR REPLACE FUNCTION katana_inmutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Tabla de solo inserción (%).', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_snapshot_inmutable BEFORE UPDATE OR DELETE ON "QuoteSnapshot"
  FOR EACH ROW EXECUTE FUNCTION katana_inmutable();
CREATE TRIGGER bitacora_inmutable BEFORE DELETE ON "Bitacora"
  FOR EACH ROW EXECUTE FUNCTION katana_inmutable();
-- La coalescencia de 5 min necesita UPDATE, así que en Bitacora el trigger
-- solo cubre DELETE; el rol de la app tiene REVOKE DELETE de todos modos.
REVOKE DELETE ON "Bitacora", "QuoteSnapshot", "TalentRateRevision" FROM katana_app;
REVOKE UPDATE ON "QuoteSnapshot", "TalentRateRevision" FROM katana_app;
```

### Semilla de los 19 formatos

| # | code | excelHeader | pdfLabel / pdfSublabel | unidad |
|---|---|---|---|---|
| 1 | `TIKTOK` | TikTok | TIKTOK | pieza |
| 2 | `REEL_IG` | Reel IG | REEL (IG) | pieza |
| 3 | `REEL_COLLAB` | Reel Collab | REEL COLABORATIVO (IG) | pieza |
| 4 | `TIKTOK_REEL_MIRROR` | TikTok + réplica Reel | **TIKTOK + REEL** / **(ESPEJO)** | pieza |
| 5 | `POST_IG` | Post fijo IG | POST FIJO (IG) | pieza |
| 6 | `STORY_IG` | Story | STORY (IG) | pieza |
| 7 | `PIN_7D` | Fijación 7 días | FIJACIÓN 7 DÍAS | 7 días |
| 8 | `EVENT_PRESENCE` | Presencia evento | PRESENCIA EN EVENTO | evento |
| 9 | `HOSTING` | Hosteo | HOSTEO | evento |
| 10 | `EVENT_STREAM` | Stream evento | STREAM DE EVENTO | evento |
| 11 | `DEDICATED_STREAM_HOUR` | Stream dedicado / hora | STREAM DEDICADO | hora |
| 12 | `YT_SHORT` | YouTube Short | YOUTUBE SHORT | pieza |
| 13 | `YT_INTEGRATION` | Integración YouTube | INTEGRACIÓN YOUTUBE | pieza |
| 14 | `YT_DEDICATED` | Video dedicado YouTube | VIDEO DEDICADO YOUTUBE | pieza |
| 15 | `PODCAST_MONTHLY` | Podcast mensual | PODCAST MENSUAL | mes |
| 16 | `MASTERCLASS` | Masterclass / experiencia | MASTERCLASS / EXPERIENCIA | evento |
| 17 | `EXCLUSIVITY_MONTHLY` | Exclusividad mensual | EXCLUSIVIDAD MENSUAL | mes (`allowsQuantity=false`) |
| 18 | `FIGHT_FEE` | Fee pelea | FEE DE PELEA | evento (`allowsQuantity=false`) |
| 19 | `TIKTOK_AUDIO` | Audio musical TikTok | AUDIO MUSICAL TIKTOK | pieza |

**No son formatos:** `Plataforma principal`→`primaryPlatformNote`, `Estado`→`rateStatus`, `Notas`→`rateNotes`, `Fuente / fecha`→`rateSourceLabel`.

### Alias sembrados a mano (ninguna métrica los infiere)

`ronny→KT-004` · `ronaldo lopez→KT-004` · `ronny ronaldo lopez→KT-004` · `mariely coronel→KT-008` · `mariely→KT-008` · `divino espinosa→KT-001` · `juan de dios garcia→KT-027` · `padigol santiago padilla→KT-028` · `kike padilla rookie leagues→KT-014` · `tejon de la miel→(su KT)`. Más `displayName`: KT-004→"Ronny", KT-014→"Kike Padilla".

---

## 4. CONTRATOS CLAVE

```ts
// ═══════════════ src/server/import/types.ts — PARSER DE EXCEL ═══════════════
export type CellValue = string | number | boolean | Date | null | undefined;
export interface SheetGrid { sheetName: string; rows: CellValue[][] }

export interface ExpectedHeaderSpec {
  entity: 'TARIFARIO'|'TALENTOS'|'PERFIL'|'ROSTER_BASE'|'KIF'|'FIERA'|'PROPUESTAS'|'CATALOGOS';
  required: string[];
  synonyms?: Record<string, string[]>;
}

export interface HeaderDetection {
  headerRowIndex: number;        // 0-based, DETECTADO. Medido: TARIFARIO=0, PERFIL=1,
  firstDataRowIndex: number;     // Base de Talentos=3, Perfil comercial=3, KIF=0, FIERA=1
  confidence: number;            // score = 0.80·coverage + 0.10·density + 0.10·nextRowDensity
  matched: Array<{ colIndex: number; raw: string; canonical: string; score: number }>;
  unmatchedRequired: string[];
  unmappedColumns: Array<{ colIndex: number; raw: string }>;
  /// TALENTOS: las cols 11–20 tienen datos y NINGÚN encabezado. La UI lo muestra.
  headerlessDataColumns: number[];
  needsManualMapping: boolean;   // confidence < 0.60
}

export declare function normalizeHeader(raw: string): string;   // NFD→sin diacríticos→lower→alfanum
export declare function isSentinelRow(row: CellValue[]): boolean; // "EJEMPLO", "— borrar esta fila —", "[...]"
export declare function detectHeaderRow(g: SheetGrid, s: ExpectedHeaderSpec,
  o?: { maxScanRows?: number; minConfidence?: number }): HeaderDetection;   // default 8, 0.60
export declare function readWorkbook(buf: Buffer): Promise<SheetGrid[]>;     // exceljs, cellFormula:false

// ═══════════════ src/server/import/parse-price.ts ═══════════════
export type PriceWarningCode = 'UNRECOGNIZED_TOKEN'|'NEGATIVE'|'SUSPICIOUS_MAGNITUDE'|'EMPTY_CELL';
export interface ParsedPrice {
  amountCents: number | null;
  status: PriceStatus | null;   // null ⇒ !ok, requiere decisión humana
  raw: string;
  ok: boolean;
  warning?: { code: PriceWarningCode; message: string };
}
export declare function parsePrice(raw: CellValue): ParsedPrice;
/// HALF_UP exacto con big.js. Rechaza no-finitos. NUNCA Math.round(x*100).
export declare function pesosToCents(input: string | number): number;
/// Sin Intl (ICU diverge entre Node en Docker y Safari en iPad).
/// Omite decimales cuando cents % 100 === 0 → "$100,000", igual que el PDF.
export declare function formatMXN(cents: number | null, status: PriceStatus): string;

// ═══════════════ src/server/import/parse-metric.ts ═══════════════
export interface ParsedMetric {
  followers: number | null; raw: string;
  confidence: MetricParseStatus; needsReview: boolean; notes: string[];
}
/// Casos reales: 919K→919000 · 5.9M→5900000 · 99.1.K→99100(INFERRED) · 215k →215000
/// 496.0→496(EXACT+⚠plausibilidad) · 7.1 M→7100000 · 48.9K aprox. — validar→48900(INFERRED)
/// 0.0→0(⚠cero). NUNCA lanza; NUNCA inventa un 0.
export declare function parseFollowerCount(raw: CellValue,
  ctx?: { platform?: Platform; talentName?: string }): ParsedMetric;

// ═══════════════ src/server/import/identity.ts ═══════════════
export interface IdentityCandidate {
  talentId: string; code: string | null; canonicalName: string; displayName: string;
  matchedOn: 'exact'|'levenshtein'|'tokenset'|'jaro'; score: number;
}
export interface IdentityResolution {
  raw: string; normalized: string; extractedVariants: string[];
  decision: 'AUTO_MATCH'|'NEEDS_REVIEW'|'CREATE_NEW';
  best?: IdentityCandidate; alternatives: IdentityCandidate[];  // hasta 8
  reason: string;                                               // explicable en la UI
}
/// NFD→sin diacríticos→lower→cierra paréntesis huérfanos→quita ()[]{}.,;:·—–_/\| y
/// las comillas " ' “ ” ’ « » (FIERA trae Ronaldo “Ronny” BXM)→colapsa espacios.
export declare function normalizeName(raw: string): string;
/// "Ronny (Ronaldo López" → ["ronny ronaldo lopez","ronny","ronaldo lopez"]
/// Mike “Máquina del Mal” → [..., "maquina del mal"]; "A / B" → [todo, "a", "b"]
export declare function extractVariants(raw: string): string[];
/// score = max(0.6·jaroWinkler + 0.4·tokenSet, levenshteinRatio)
/// El max con levRatio es lo que rescata Espinoza/Espinosa (0.93 vs 0.717).
export declare function nameSimilarity(a: string, b: string): number;
/// Carga los ~69 TalentIdentifier completos en memoria (~4 KB) y puntúa en Node.
/// AUTO_MATCH solo si exacto. ≥0.55 → NEEDS_REVIEW. Nada se fusiona sin humano.
export declare function resolveIdentity(raw: string, index: IdentityIndex): IdentityResolution;
export declare function buildIdentityIndex(tx: PrismaTx): Promise<IdentityIndex>;

// ═══════════════ Plan y commit de importación ═══════════════
export type ChangeKind = 'CREATE'|'UPDATE'|'NOOP'|'CONFLICT'|'ERROR';
export type RowDecision = 'PENDING'|'APPLY'|'SKIP'|'KEEP_DB'|'TAKE_FILE';
export interface FieldDiff {
  field: string; label: string;
  beforeDisplay: string; afterDisplay: string;   // "Pendiente" → "$120,000"
  changed: boolean;
  /// TalentRate.manuallyEditedAt > último commit ⇒ conflict, default KEEP_DB.
  conflict?: boolean;
}
export interface TalentChange {
  id: string; kind: ChangeKind; talentLabel: string; targetTalentId?: string;
  sheetName: string; excelRow: number;
  identity?: IdentityResolution;
  rateDiffs: FieldDiff[];     // las 19 celdas en UNA tarjeta (no 399 filas)
  profileDiffs: FieldDiff[];
  metricDiffs: FieldDiff[];
  issues: ImportIssue[];
  defaultDecision: RowDecision;
}
export interface ImportIssue {
  severity: 'INFO'|'WARNING'|'ERROR';
  code: 'ORPHAN_ROW'|'SHIFTED_COLUMN_BAND'|'UNPARSED_PRICE'|'METRIC_NEEDS_REVIEW'
      | 'AMBIGUOUS_NAME'|'IDENTIFIER_COLLISION'|'HEADER_LOW_CONFIDENCE'|'HEADERLESS_COLUMNS'
      | 'MANUAL_EDIT_CONFLICT'|'QUOTED_TO_PENDING'|'STALE_METRICS';
  message: string; sheetName?: string; excelRow?: number; rawDump?: string[];
}
export interface ImportPlan {
  batchId: string; generatedAt: string;
  sheets: Array<{ sheetName: string; supported: boolean; detection: HeaderDetection | null }>;
  talents: TalentChange[];
  clients: EntityChange[];        // de PROPUESTAS: crea Client con folioCode PARSEADO
  legacyQuotes: EntityChange[];   // + siembra FolioCounter con max(seq) por scope
  summary: { creates: number; updates: number; conflicts: number; errors: number; warnings: number };
}
export declare function buildImportPlan(sheets: SheetGrid[], kind: ImportKind, tx: PrismaTx): Promise<ImportPlan>;
export declare function commitImport(batchId: string, decisions: Record<string, RowDecision>,
  actor: Actor): Promise<ImportResult>;

// ═══════════════ src/server/pricing/compute.ts — MOTOR ═══════════════
// FUNCIÓN PURA: cero Prisma, cero I/O, cero Date.now(). Idéntica en el
// navegador (preview) y en el servidor (PDF). bigint interno, Int en la frontera.
export interface PriceValue { amountCents: number | null; status: PriceStatus }
export interface ResolvedPrice extends PriceValue { base: PriceValue; isOverridden: boolean; overrideReason?: string }
export interface Discount { type: DiscountType; value: number }   // PERCENT=bps · FIXED=centavos

export interface QuoteLineInput {
  id: string; quoteTalentId: string | null; deliverableTypeId: string | null;
  description: string; quantity: number;
  price: ResolvedPrice;             // ← SIEMPRE resuelto; el motor no lee de la BD
  discount?: Discount; isBillable: boolean; sortOrder: number;
}
export interface QuoteComputationInput {
  talents: Array<{ id: string; label: string; sortOrder: number }>;
  lines: QuoteLineInput[];
  packageDiscount?: Discount;
  taxMode: TaxMode; taxRateBps: number;
}
export interface LineResult {
  lineId: string; quantity: number; unitAmountCents: number | null; status: PriceStatus;
  grossCents: number; discountCents: number; totalCents: number; billable: boolean;
  renderLabel: string | null;   // "Cotización aparte" | "Tarifa pendiente" | "No aplica" | "—"
}
export interface QuoteTotals {
  subtotalCents: number; lineDiscountCents: number; packageDiscountCents: number;
  taxableBaseCents: number; taxCents: number; totalCents: number;
  nonQuotedCount: number; hasPending: boolean; exceedsCeiling: boolean;
}
export interface QuoteComputation {
  lines: LineResult[];
  talents: Array<{ quoteTalentId: string; grossCents: number; lineDiscountCents: number;
                   allocatedPackageDiscountCents: number; netCents: number; nonQuotedLineIds: string[] }>;
  totals: QuoteTotals; engineVersion: string;
}

export declare function resolveEffectivePrice(p: {
  baseAmountCents: number | null; basePriceStatus: PriceStatus;
  overrideAmountCents: number | null; overridePriceStatus: PriceStatus | null;
  overrideReason?: string;
}): ResolvedPrice;

/// Orden: renglón → descuento de renglón → talento → subtotal → descuento de
/// paquete (UNA vez, sobre el subtotal) → reparto por mayor resto a talentos →
/// base gravable → IVA (UNA vez) → total. Redondeo HALF_UP una sola vez por nivel.
/// PENDING/CASE_BY_CASE/NOT_APPLICABLE aparecen en el documento, importe 0, NO suman.
/// unitAmountCents null con status QUOTED ⇒ gross 0 + renderLabel "—" (jamás BigInt(null)).
export declare function computeQuote(input: QuoteComputationInput): QuoteComputation;

export declare function applyPercentBps(base: bigint, bps: number): bigint;          // HALF_UP entero
export declare function allocateLargestRemainder(total: bigint, weights: bigint[]): bigint[];
export type EmitCheck = { ok: true } | { ok: false; motivo: string; lineIds: string[] };
/// PENDING bloquea DRAFT→SENT salvo acknowledge explícito (queda en Bitacora).
/// CASE_BY_CASE no bloquea. Excede techo ⇒ bloquea siempre.
export declare function checkEmittable(c: QuoteComputation, o?: { acknowledgePending?: boolean }): EmitCheck;

// ═══════════════ src/server/quote/folio.ts ═══════════════
/// Para clientes NUEVOS. Los históricos NO se derivan: se parsea el folio.
/// "Visit Puerto Vallarta"→VPV · "HONOR"→HON · colisión→2 letras + dígito ("HO2")
export declare function deriveFolioCodeCandidates(displayName: string): string[];
export declare function ensureClientFolioCode(tx: PrismaTx, clientId: string): Promise<string>;
/// INSERT … ON CONFLICT ("scope") DO UPDATE SET lastSeq = lastSeq + 1 RETURNING lastSeq
/// Atómico en una sentencia; sin SELECT FOR UPDATE, sin advisory lock.
/// Se asigna al EMITIR, no al crear. Quote.folio @unique es la red (reintento ×3 ante 23505).
export declare function allocateFolio(tx: PrismaTx, clientId: string, year: number
): Promise<{ folio: string; seq: number; scope: string }>;   // "KAT-HON-2026-002"
export declare function parseLegacyFolio(folio: string
): { prefix: 'KAT'; clientCode: string; year: number; seq: number } | null;

// ═══════════════ src/lib/doc/payload.ts + src/server/pdf/render.ts ═══════════════
export interface SnapshotPayload {
  schemaVersion: 1;
  document: { folio: string; draftRef: string | null; revision: number; emittedAt: string | null;
              layoutVersion: string; pageSize: 'LETTER'; kind: DocKind };
  brand: { logoDataUri: string; logoSha256: string;   // autosuficiente: sin volumen compartido
           primaryHex: '#7B2FBE'; darkHex: '#3D0070'; tintHex: '#FBF9FE';
           borderHex: '#E4DBF0'; labelHex: '#9A92A6'; bodyHex: '#1C1326';
           confHex: '#5E5566'; priceHex: string };   // '#1E3A8A' medido en el fixture
  meta: { rows: Array<[{ label: string; value: string }, { label: string; value: string } | null]> };
  tabulador: {
    columns: Array<{ label: string; sublabel: string | null }>;
    rows: Array<{ talentLabel: string;
                  cells: Array<{ display: string; status: PriceStatus; isOverridden: boolean }> }>;
    footnotes: string[];                              // "▪ Tarifa ajustada para esta cotización."
  } | null;
  cotizacion: {
    groups: Array<{ talentLabel: string; platformNote: string | null;
      lines: Array<{ description: string; detail: string | null; quantity: number;
                     unitDisplay: string; totalDisplay: string; status: PriceStatus;
                     renderLabel: string | null }>;
      subtotalDisplay: string }>;
    totals: { subtotalDisplay: string; packageDiscountDisplay: string | null;
              taxableBaseDisplay: string; taxLabel: string; taxDisplay: string;
              totalDisplay: string; totalEnLetra: string | null;
              raw: { subtotalCents: number; packageDiscountCents: number;
                     taxableBaseCents: number; taxCents: number; totalCents: number;
                     taxMode: TaxMode; taxRateBps: number } };
  } | null;
  considerations: string[];                            // 9 bullets, texto final
  terms: Array<{ number: number; body: string }>;       // 1..7, sin runs bold
  confidentiality: { heading: string; body: string };
  signature: string;
  footer: { left: string; rightPattern: string };       // "Pág. {n}" | "Pág. {n} de {m}"
  provenance: { engineVersion: string; templateVersion: string; chromiumVersion: string;
                emittedBy: { name: string; email: string } };
}

/// ⭐ PURA. Opera sobre el estado NO GUARDADO del editor. El preview y freezeQuote
/// consumen exactamente el mismo objeto → la igualdad es estructural, no una promesa.
export declare function buildDocumentPayload(input: QuoteDraftState, kind: DocKind): SnapshotPayload;
/// PURA, sin DOM: usa la tabla AFM. El iPad ve los mismos saltos que el PDF, en vivo.
export declare function paginate(p: SnapshotPayload): PagedDoc;
/// SSR del mismo <Documento/>, con fuentes y logo como data: URI. Autocontenido.
export declare function renderDocumentHtml(paged: PagedDoc, mode: 'print'|'preview'): string;
/// setContent + document.fonts.ready + images decode + GUARDA de desbordamiento
/// (page.evaluate ~2ms) + page.pdf + stampMetadata. Si desborda: 500, NUNCA un PDF recortado.
export declare function renderPdf(p: SnapshotPayload): Promise<{ buffer: Buffer; pageCount: number }>;
export declare function freezeQuote(quoteId: string, actor: Actor,
  o?: { acknowledgePending?: boolean }
): Promise<{ snapshotId: string; folio: string; version: number; files: Array<{kind: DocKind; sha256: string}> }>;
```

**Contrato de `page.pdf()` (no negociable, es lo que hace reproducible el documento):**
```ts
await page.pdf({ printBackground: true, preferCSSPageSize: true, scale: 1,
                 margin: { top:'0', right:'0', bottom:'0', left:'0' },
                 displayHeaderFooter: false, timeout: 15000 });
```
más `@page { size: 612pt 792pt; margin: 0 }`, `print-color-adjust: exact`, y flags de lanzamiento `--font-render-hinting=none --disable-lcd-text --hide-scrollbars --disable-dev-shm-usage` (sin `--disable-dev-shm-usage` si se usa `shm_size: 512m`; **no ambos**).

---

## 5. FASES DE IMPLEMENTACIÓN

### Fase 1 — Esqueleto arrancable + fixtures versionados
**Construye:** repo Next 15 standalone + TS strict + Tailwind v4 con `shadcn init`, Prisma con `schema.prisma` completo + `migration.sql` con CHECKs, `src/env.ts`, `/api/health`, `docker-compose.yml` (db + migrate + app), `.env.example` con **todos los valores entrecomillados**, `deploy.sh` con `if/then` (nunca `cond && morir`).
**Archivos:** `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `stylelint.config.mjs`, `prisma/**`, `src/env.ts`, `src/app/api/health/route.ts`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`, `.dockerignore`, `deploy.sh`, `tests/fixtures/honor_tabulador_original.pdf`, `tests/fixtures/xlsx/*`, `assets/brand/katana_logo.png`.
**HECHO:** `docker compose up -d --wait` termina; `curl -s localhost:3000/api/health` → `{"ok":true,"db":true,"chromium":true}`; `psql -c "select conname from pg_constraint where conname like 'q%_%'"` lista los 8 CHECK; `git log` muestra el PDF y los dos `.xlsx` versionados.

### Fase 2 — Calibración tipográfica y oráculo de fidelidad (antes de escribir el documento)
**Construye:** subset de Nimbus Sans → `KatanaSans-{Regular,Bold}.woff2`; `tools/huella.py` que emite `honor_baseline.json`; `tools/calibrar.py` que mide en Chromium el offset baseline↔caja de línea por estilo y **genera** las constantes de `document.css` y `metrics.ts`; `tools/comparar.py` (canonicaliza `(cid:127)`→`•`, colapsa espacios, agrupa runs por línea, fusiona trazos co-localizados, normaliza el nombre de fuente).
**Archivos:** `assets/fonts/**`, `tools/{huella,calibrar,comparar}.py`, `src/lib/doc/{metrics,afm}.ts`, `tests/fixtures/honor_baseline.json`.
**HECHO:** `python tools/calibrar.py --verificar` confirma que el ancho medido en Chromium de `"Tabulador de Tarifas"` a 19pt con `font-kerning:none` está a ≤0.05pt de los 186.884pt de la AFM de Helvetica, y que `"Mariel Estrella"` a 9.7pt Bold está a ≤0.05pt de 65.78pt. `honor_baseline.json` contiene 9 viñetas y el color `#1E3A8A` en 16 celdas.

### Fase 3 — Motor de dinero y de cálculo (puro, sin UI)
**Construye:** `money.ts` (`pesosToCents` con big.js HALF_UP, `formatMXN` sin Intl), `compute.ts` completo, `folio.ts`, `checkEmittable`.
**Archivos:** `src/lib/money.ts`, `src/server/pricing/compute.ts`, `src/server/quote/folio.ts`, `tests/unit/{money,compute,folio}.test.ts`.
**HECHO:** `npm run test:unit -- compute money folio` verde con **100% de líneas y funciones** en `compute.ts`; test de propiedad `fast-check`: para cualquier combinación, `Σ talentos.net + tax === total` y `Σ allocated === packageDiscount`; caso Azteca ($300k + 4×$10k = $340,000 → IVA $54,400 → $394,400) exacto; `(1234.565)` → `123457` centavos.

### Fase 4 — Importador de Excel (parsers → plan → commit)
**Construye:** `readWorkbook` con exceljs, `detectHeaderRow`, `parsePrice`, `parseFollowerCount`, `normalizeName`/`extractVariants`/`nameSimilarity`/`resolveIdentity`, `buildImportPlan`, `commitImport` idempotente, `POST /api/importaciones`.
**Archivos:** `src/server/import/**`, `src/app/api/importaciones/route.ts`, `prisma/seed.ts` (19 formatos + 10 alias sembrados), `tests/unit/{parse-price,parse-metric,identity}.test.ts`, `tests/integracion/import.test.ts`.
**HECHO:** `npm run test:integracion -- import` contra los `.xlsx` **reales**: se detectan headers en filas 0/1/3 sin hardcode; se leen 21 talentos × 19 formatos; `N/A=93, Pendiente=87, Caso por caso=37`; las 19 filas huérfanas de `TALENTOS` (24–51) generan `ORPHAN_ROW`/`SHIFTED_COLUMN_BAND` **sin descartar ninguna en silencio**; los 7 pares de nombres divergentes se resuelven por alias sembrado o `NEEDS_REVIEW` (cero `CREATE_NEW` silencioso); la nota de 704 caracteres de Padigol queda íntegra en `rateNotes`; **re-importar el mismo archivo produce 0 cambios**; `commitImport` con el mismo `commitKey` devuelve el resultado previo sin duplicar.

### Fase 5 — Documento: TABULADOR con fidelidad demostrada
**Construye:** `components/doc/**` + `document.css` (longhands, sin `font:` shorthand, `text-indent` para listas, `::before` absoluto para la barra de confidencialidad, `honor-4col` con los 4 centros medidos), `paginate.ts`, `buildDocumentPayload`, `renderDocumentHtml`, pool de Chromium, `renderPdf` con guarda de desbordamiento.
**Archivos:** `src/components/doc/**`, `src/lib/doc/{paginate,payload,measure}.ts`, `src/server/pdf/**`, `tests/pdf/fidelidad-tabulador.test.ts`, `tests/fixtures/datos-honor.ts`.
**HECHO:** `npm run test:pdf -- tabulador` verde: 2 páginas 612×792; secuencia de texto por línea **idéntica** al baseline; `x0` ≤0.75pt y `top` ≤1.0pt en todos los runs; tamaños ±0.05; colores hex exactos incluido `#1E3A8A`; cajas de tinta (8 rects + 15 lines pág.1, 2 rects + 7 lines pág.2) dentro de 0.5pt; diff de píxeles a 150 dpi ≥99.5% con Δ≤8.

### Fase 6 — Documento: COTIZACIÓN + segundo golden
**Construye:** `GrupoTalento`, `BloqueTotales`, caja de metadatos de 3 filas, `totalEnLetra` (~80 líneas con su tabla de pruebas), reglas de corte (`talentGroup` nunca se parte salvo que no quepa en página vacía; `totals` atómico con `keepWithPrevious`).
**Archivos:** `src/components/doc/{GrupoTalento,BloqueTotales}.tsx`, `src/lib/doc/numero-a-letra.ts`, `tests/pdf/fidelidad-cotizacion.test.ts`.
**HECHO:** `npm run test:pdf -- cotizacion` genera la cotización Azteca (4 talentos × 2 conceptos), y re-parseando el PDF: `Total == Subtotal − Descuento + IVA`, el folio del PDF coincide con el de la BD, el total en letra dice "trescientos noventa y cuatro mil cuatrocientos pesos 00/100 M.N.", y el bloque de totales nunca queda partido.

### Fase 7 — Auth, roles y bitácora
**Construye:** sesiones propias, argon2id con rehash PHC, `can()/assertCan()` con motivo, `src/server/data/**` con filtro en el WHERE, `append(tx, evento)` con coalescencia de 5 min, rate limiting en BD, invitaciones, seed del admin idempotente, `middleware.ts` con matcher explícito.
**Archivos:** `src/lib/authz/policy.ts`, `src/server/auth/**`, `src/server/audit/append.ts`, `src/server/data/**`, `src/middleware.ts`, `src/app/(auth)/**`, `tests/unit/policy.test.ts`, `tests/integracion/auth.test.ts`.
**HECHO:** tabla exhaustiva `(3 roles × 34 permisos × recurso propio/ajeno/estado)` verde; una Server Action de edición invocada con actor `LECTURA` mockeado lanza `ForbiddenError` **y** deja fila en `Bitacora`; correr `db seed` 3 veces deja 1 admin y no rota su contraseña; el flujo `debeCambiarPassword` redirige desde `requireActor()`.

### Fase 8 — Editor: matriz, override y preview en iframe
**Construye:** `EditorShell` con store zustand, `MatrizPrecios`, `CeldaPrecio` con sus 3 estados, `InputMoneda` con reposicionamiento de caret, `PanelPreview` como `<iframe>` alimentado por `renderDocumentHtml(...,'preview')`, autosave con `If-Match: revision` y 409, sincronización editor→preview por `data-anchor`.
**Archivos:** `src/components/editor/**`, `src/app/(app)/cotizaciones/**`, `src/server/data/quote.ts`.
**HECHO:** en pantalla: escribir `150000` en la celda Ronny×Espejo actualiza el preview en <80 ms, marca `● precio ajustado` con hover `Base $195,000 · −$45,000 (−23.1%)`, y recargando persiste; dos pestañas editando la misma cotización → la segunda recibe 409 con banner de conflicto; el iframe no hereda ni un byte del CSS de la app (verificado con `getComputedStyle` de `.doc` = `font-family: KatanaSans`).

### Fase 9 — Wizard de importación, tarifario, talentos, admin
**Construye:** las 4 pantallas del wizard (subir → mapeo → reconciliar → revisar/aplicar) con tarjetas por talento, `/tarifario` con virtualización, fichas de talento con alias editables, `/admin/{usuarios,bitacora}`, `/ajustes/{marca,plantillas}`.
**Archivos:** `src/app/(app)/{importar,tarifario,talentos,admin,ajustes}/**`, `src/components/data/**`.
**HECHO:** en pantalla: subir el `KATANA ENGINE` real muestra las hojas con su fila de encabezado detectada y editable, 21 tarjetas de talento con 19 chips de color cada una, el panel de advertencias con las 19 filas huérfanas y su volcado crudo, y los pares `Tony Gastelum ` / `Tony Gastélum` como chips de confirmación. Aplicar deja `Ronny·TikTok=$90,000` y `Ronny·espejo=$195,000` en `/tarifario`.

### Fase 10 — Responsividad, accesibilidad y E2E
**Construye:** layout iPad (split horizontal / segmentado vertical), flujo por pasos en celular, `--kb-inset` con `visualViewport`, barra de acciones **fuera** del elemento con `@container`, `navigator.share` con el PDF **pre-generado** (el `File` en un ref antes del tap), suite Playwright en 3 viewports.
**Archivos:** `src/components/editor/{BarraAccionesMovil,StepperMovil}.tsx`, `playwright.config.ts`, `tests/e2e/**`.
**HECHO:** `npx playwright test` verde en `escritorio`, `ipad-vertical`, `iphone-14`: desbordamiento horizontal ≤1 px en 6 rutas; 0 elementos `[data-touch-target]` <44×44; 0 violaciones serious/critical de axe; el flujo completo login→importar→cotizar→override→descargar produce un PDF cuyo texto contiene `HONOR`, `Fer Nicolini` y `$150,000` y **no** contiene `$195,000`.

### Fase 11 — Endurecimiento, respaldos y despliegue
**Construye:** CSP con nonce, cabeceras, `allowedOrigins`, servicio `backup` con **Dockerfile propio** (postgres + rclone), `respaldar-ahora.sh` separado del bucle, `restore.sh` con base de ensayo, `deploy.sh` corregido, `docker-compose.dev.yml` no versionado como override, CI que construye y publica a GHCR.
**Archivos:** `deploy/backup/**`, `deploy.sh`, `docker-compose.yml`, `docker-compose.dev.yml`, `.github/workflows/ci.yml`, `next.config.ts`.
**HECHO:** `./deploy.sh instalar` en un servidor limpio deja la app pública respondiendo 200 en `${APP_PUBLIC_URL}/api/health` en <10 min; `./deploy.sh respaldar` produce un `.dump` nuevo con su `.sha256` en primer plano; `./deploy.sh restaurar <dump>` restaura a una base de ensayo e imprime conteos idénticos; `docker compose ps --format json` no muestra **ningún** puerto publicado.

### Fase 12 — Documentación, seed de producción y entrega
**Construye:** `README.md`, `docs/GUIA_DESPLIEGUE.md` (12 secciones con la tabla síntoma→causa→arreglo), `docs/MANUAL_USUARIO.md` (11 secciones, §7 con el caso HONOR trabajado), bitácora de operación, simulacro de restauración ejecutado y registrado.
**HECHO:** un operador que nunca vio el repo ejecuta `docs/GUIA_DESPLIEGUE.md` de principio a fin sin preguntar nada y termina con Chuy dentro de la app; Chuy produce el tabulador HONOR desde cero en <5 minutos siguiendo el manual.

---

## 6. LOS 10 RIESGOS MÁS ALTOS Y SU MITIGACIÓN

**R1 · Fidelidad del PDF: la fuente sustituida cambia el documento en silencio.**
Liberation Sans clona Arial (métricas de Helvetica, **trazos distintos**) → el diff de píxeles nunca cierra y nadie sabe por qué. Además `fc-match Helvetica` depende de qué paquete instaló el último `apt`.
*Mitigación:* la fuente **nunca** se referencia como "Helvetica": se llama `KatanaSans`, es Nimbus Sans (clon PostScript de Helvetica: mismas métricas **y** mismas formas), va subsetada en el repo, embebida como `data:` URI en el HTML de impresión, y su sha entra en el hash de caché. Fase 2 verifica ancho a ancho contra la AFM antes de escribir una línea de documento. Si Nimbus fallara, `fontStack` es una constante de plantilla y se cambia con dos archivos.

**R2 · Fidelidad del PDF: el kerning se reactiva solo.**
El shorthand `font:` **resetea** `font-kerning`, `font-variant-ligatures` y `font-feature-settings` a `initial`. Medido: `"Tabulador de Tarifas"` pasa de 186.844pt a 184.020pt — 2.82pt de error en un título.
*Mitigación:* regla stylelint `declaration-property-disallowed-list: [font]` en `document.css`; última regla del archivo `.doc, .doc * { font-kerning:none; font-variant-ligatures:none; font-feature-settings:"kern" 0,"liga" 0,"clig" 0,"calt" 0 }`; y el test de calibración de la Fase 2 como red.

**R3 · Paginación con muchos talentos: el tabulador de 4 filas es un caso especial, no el caso general.**
Con 21 talentos la tabla desborda la página 1, empuja Consideraciones y Términos, y todas las anclas absolutas dejan de significar nada.
*Mitigación:* (a) `metrics.ts` separa `LAYOUT` (invariantes) de `GOLDEN_HONOR` (el fixture); (b) paginador analítico puro con reglas explícitas: nunca 1 fila huérfana ni viuda, `<thead>` morado re-emitido en cada fragmento con "(continuación)" en la celda TALENTO, cebra por índice **global**; (c) casos golden estructurales para N = 1, 4, 12, 21 talentos que verifican número de páginas, encabezado presente en toda página con filas, y pie correcto; (d) `Pág. N` si M≤2, `Pág. N de M` si M≥3 (reproduce el fixture sin bandera de compatibilidad).

**R4 · El paginador se equivoca y el PDF sale recortado sin error.**
`overflow:hidden` en `.page` evita páginas fantasma pero **oculta** el desbordamiento; verificarlo solo en los goldens deja pasar los datos reales.
*Mitigación:* la invariante vive en el **camino de render**, no en los tests: antes de `page.pdf()`, un `page.evaluate` de ~2 ms comprueba, para cada página, `frame.scrollHeight + frameTop <= 747` y que el número de `.page` coincide con el del paginador. Si falla → 500 con alerta, **nunca** un PDF recortado. El mismo chequeo corre en el preview para que la deriva se detecte con datos reales.

**R5 · Divergencia preview↔PDF por CSS de la app, no por un `if (isPrint)`.**
La amenaza real es el preflight de Tailwind, `box-sizing` universal, `font-size:16px` en `:root` y `line-height:1.5` heredado filtrándose al preview, que vive dentro de la app mientras el PDF se genera con `setContent` aislado. Los candados de lint y "DOM idéntico" no detectan nada de eso.
*Mitigación:* el preview se renderiza en un **`<iframe>` mismo-origen cuyo documento es la salida literal de `renderDocumentHtml()`**, actualizado por portal de React. Aislamiento total, `--zoom` aplicado al `<iframe>`, y desaparece la única bifurcación "permitida" (`@media screen`). Se conservan el lint (prohibición sintáctica de `isPrint`/`isPreview`/`typeof window` en `components/doc/**`) y el test de DOM idéntico como candados baratos.

**R6 · Datos sucios del Excel: los encabezados no están donde dice el brief y las filas huérfanas no son ruido.**
Medido: header en fila **0, 1 y 3** según la hoja (el brief traía las tres corridas). Las filas 24–51 de `TALENTOS` son **19 filas** con datos reales — la 50 trae precios (`40000`, `30000`, `15000`) en columnas **sin encabezado** (11–20).
*Mitigación:* detección heurística obligatoria (`score = 0.80·coverage + 0.10·density + 0.10·nextRowDensity`, umbral 0.60, 8 filas de escaneo, penalizaciones por títulos e instrucciones) con mapeo manual en la UI si no alcanza; gatillo de huérfana = `col[0]` vacía **y ≥1 celda no vacía en cualquier columna** → `ORPHAN_ROW` con volcado crudo; subtipo `SHIFTED_COLUMN_BAND` con "asignar a talento…"; `headerlessDataColumns` expuesto en la UI. **Nada se descarta en silencio.**

**R7 · Nombres que no coinciden entre archivos: los umbrales estándar fallan justo en los casos documentados.**
Medido con `0.6·JW + 0.4·tokenSet`: `Espinoza`/`Espinosa` = **0.717**, `Mar Coronel`/`Mariely Coronel` = **0.658**, `Ronny`/`Ronaldo BXM` = **0.442**. Con umbral 0.72 los tres se crean como talentos nuevos sin preguntar. Y `Talent.normalizedKey` + `TalentAlias.normalized` como índices separados permiten que un talento fantasma "Ronny" gane siempre sobre el alias de KT-004.
*Mitigación:* (a) **un solo** `TalentIdentifier.normalized @unique` como índice global de identidad; (b) `score = max(0.6·JW + 0.4·tokenSet, levenshteinRatio)` — el `max` rescata Espinoza/Espinosa (0.93); (c) umbral de revisión **0.55** con 8 alternativas; (d) **10 identificadores sembrados a mano** que eliminan el 100% de los falsos negativos conocidos; (e) orden de procesamiento fijo: `PERFIL COMERCIAL` (fuente de códigos) → `TARIFARIO` → `TALENTOS` → roster/KIF/FIERA; (f) `AUTO_MATCH` solo con coincidencia **exacta**; nada se fusiona ni se crea sin humano; cada confirmación persiste el crudo como identificador, así el siguiente import no vuelve a preguntar.

**R8 · Precios "Caso por caso" / "Pendiente": un `Int?` colapsa cuatro significados comerciales.**
`Pendiente` (no la definimos), `N/A` (no ofrece el formato) y `Caso por caso` (se cotiza aparte) tienen reglas distintas de renderizado, suma y bloqueo de emisión. Y 5 de 21 talentos tienen **todas** sus celdas no numéricas. El propio PDF HONOR vende a Mariel un formato que el tarifario marca `Pendiente`.
*Mitigación:* `amountCents Int?` + `priceStatus` enum + CHECK en la BD. Tabla de comportamiento explícita: `CASE_BY_CASE`→"Cotización aparte", suma 0, no bloquea; `PENDING`→"Tarifa pendiente", suma 0, **bloquea emitir salvo acknowledge registrado en Bitacora**; `NOT_APPLICABLE`→"No aplica" en gris; celda vacía→"—". El override sobre un base `PENDING` es un camino de **un solo gesto** en la UI, no un flujo aparte — es el corazón del producto. Los paquetes en prosa (Padigol) se cotizan con `QuoteLine` libre y `rateNotes` se muestra como panel lateral en el selector de precios.

**R9 · Dos fuentes de verdad para el mismo número dentro del mismo documento.**
`QuoteLine` con `quotePriceId` **y** `unitAmountCents` permite que Chuy baje Ronny/espejo a $150,000 en la matriz y la cotización siga cobrando $195,000: el tabulador y la cotización del mismo PDF con cifras distintas.
*Mitigación:* CHECK `ql_price_source` en la BD; `computeQuote` recibe el precio **ya resuelto** desde `QuotePrice` para todo renglón ligado; `unitAmountCents` existe solo para renglones libres; el test de la Fase 6 re-parsea el PDF y verifica `Total == Subtotal − Descuento + IVA` y que la celda del tabulador coincide con el importe del renglón.

**R10 · El PDF sale con la pantalla de login, o el despliegue tumba el servidor.**
Si Chromium navega a una ruta autenticada, imprime el login. Si `docker-compose.override.yml` está versionado, cada `git pull` re-expone `0.0.0.0:3000` saltándose UFW (Docker escribe sus reglas antes). Si `next build` corre en 2 vCPU/4 GB con el stack en pie, el OOM killer mata Postgres.
*Mitigación:* `setContent` con HTML autocontenido — no hay ruta `/print`, no hay token de render, no hay red desde la página (`page.route('**', r=>r.abort())` salvo `data:`), no hay SSRF hacia `db:5432`; el override **no** se versiona (`docker-compose.dev.yml`, que Compose no carga solo) y todo `ports:` obligatoriamente `127.0.0.1:…`; el build ocurre en CI y se publica a GHCR, `./deploy.sh actualizar` = `pull` + `up --wait` (ventana real ~20 s, rollback = cambiar `APP_VERSION`).

---

## 7. CRITERIOS DE ACEPTACIÓN

### A. Fidelidad del documento (bloqueante, automatizado)

| # | Criterio | Umbral | Cómo se mide |
|---|---|---|---|
| F1 | **Reproducción del tabulador HONOR**: partiendo de `datos-honor.ts` (HONOR / Fer Nicolini / Chuy Gallardo / MXN; Mariel, Tony, Yoiker, Ronny × TikTok, Reel IG, Espejo, Story; con los overrides de Mariel-Reel `Pendiente`→$120,000, Mariel-Espejo→$150,000, Mariel-Story→$40,000, Ronny-Espejo $195,000→$150,000, Tony-Espejo $90,000→$80,000) el PDF generado se compara contra `honor_tabulador_original.pdf` | ver F2–F6 | `tools/comparar.py` |
| F2 | Páginas y tamaño | 2 páginas, 612×792 ±0.5 | pdfplumber |
| F3 | Secuencia de texto por línea, canonicalizada | **idéntica** | `(cid:127)`→`•`, espacios colapsados, runs agrupados por línea |
| F4 | Posición de cada run | `x0` ≤ **0.75 pt**, `top` ≤ **1.0 pt** | Chromium cuantiza el baseline a píxel CSS (0.75 pt) |
| F5 | Tamaño y color de fuente | tamaño ±0.05 pt; color hex **exacto** (incluye `#1E3A8A` en las 16 celdas de precio y `#3D0070` en los 4 nombres) | pdfplumber |
| F6 | Geometría vectorial: 8 rects + 15 lines en pág.1, 2 rects + 7 lines en pág.2 (barra 17pt, caja de metadatos con divisoria en 263.76, 4 filas cebra, barra morada lw=3 en x=34.02) | cajas de tinta canonicalizadas dentro de **0.5 pt** | pdfplumber `.rects`+`.lines` |
| F7 | Diferencia visual | ≥ **99.5 %** de píxeles con Δ≤8 a 150 dpi; segunda pasada con blur 1px ≥99.85 % | `pypdfium2` + `pixelmatch` |
| F8 | Fidelidad de la **cotización** | `Total == Subtotal − Descuento + IVA` re-parseado del PDF; folio del PDF == folio en BD; total en letra correcto | `tests/pdf/fidelidad-cotizacion.test.ts` |
| F9 | Paginación estructural con N = 1, 4, 12, 21 talentos | thead repetido en toda página con filas; ninguna fila partida; pie correcto; `Pág. N de M` solo si M≥3 | goldens estructurales |
| F10 | Preview↔PDF | `renderDocumentHtml(paged,'preview')` y `'print'` producen el **mismo** DOM; el iframe no hereda estilos de la app | test de cadena + `getComputedStyle` |

### B. Corrección de datos y dinero (bloqueante)

- **D1** `compute.ts` con **100 %** de líneas/funciones y 95 % de ramas; propiedad `Σ neto + IVA === total` y `Σ repartido === descuento` para entradas arbitrarias (`fast-check`).
- **D2** Importar los dos `.xlsx` reales: 0 excepciones no controladas, <25 s, 21 talentos × 19 formatos, conteos `N/A=93 / Pendiente=87 / Caso por caso=37`.
- **D3** **Idempotencia**: re-importar el mismo archivo ⇒ **0 cambios**; `commitImport` con el mismo `commitKey` ⇒ no duplica.
- **D4** Las 19 filas huérfanas de `TALENTOS` generan issues visibles; **ninguna** se descarta en silencio.
- **D5** Los 7 pares de nombres divergentes conocidos terminan vinculados al mismo talento; `Yoiker` vs `Ronny` nunca se fusionan.
- **D6** Parser de seguidores: la tabla de 12 casos reales verde; nunca lanza; nunca inventa un 0.
- **D7** Editar una tarifa en la app y re-importar un Excel viejo ⇒ `CONFLICT` con `defaultDecision: KEEP_DB`, jamás sobrescritura silenciosa.
- **D8** Un talento ausente del archivo ⇒ `missingInLastImport = true`, **nunca** `DELETE`.
- **D9** `db seed` ×3 ⇒ 1 admin, contraseña no rotada, 19 formatos sin duplicar.

### C. Producto (observable en pantalla)

- **P1** Chuy crea el tabulador HONOR desde cero (cliente, 4 talentos, 4 formatos, 5 overrides) y descarga el PDF **en menos de 5 minutos**, en iPad.
- **P2** Escribir en una celda de precio actualiza el preview en **<80 ms** sin parpadeo ni pérdida de foco; el caret queda donde debe tras el formateo.
- **P3** El override muestra los tres portadores de información (color + barra lateral + punto + tooltip con base y delta) y `↺ Revertir al precio base` funciona.
- **P4** Un formato con base `Pendiente` acepta un precio en un solo gesto y el documento lo imprime como valor normal, marcado como ajustado en la nota al pie.
- **P5** Intentar emitir con un `PENDING` sin resolver muestra el diálogo de decisión (Asignar / Imprimir como "Cotizar" / Cancelar); la elección queda en la bitácora.
- **P6** La pestaña Historial de la cotización muestra *"Chuy Gallardo ajustó Ronny · TikTok + réplica Reel de $195,000 a $150,000"* con fecha.
- **P7** Un usuario `LECTURA` ve la cotización, descarga el PDF, y **no** tiene inputs habilitados; la Server Action de edición devuelve 403 aunque se invoque por HTTP crudo, y queda registrada.
- **P8** Dos pestañas editando la misma cotización: la segunda recibe 409 con banner de conflicto, sin perder lo escrito.
- **P9** `navigator.share` con el PDF pre-generado abre la hoja nativa de iOS (WhatsApp) desde el iPad.
- **P10** Sin desbordamiento horizontal (≤1 px) en 6 rutas × 3 viewports; 0 objetivos táctiles <44×44; 0 violaciones serious/critical de axe.

### D. Operación (bloqueante en `main`)

- **O1** `docker compose up -d --wait` en servidor limpio < 180 s con imágenes ya construidas.
- **O2** `${APP_PUBLIC_URL}/api/health` responde 200 y **ningún** puerto publicado en `docker compose ps`.
- **O3** `./deploy.sh respaldar` produce un `.dump` verificable con `pg_restore --list` y su `.sha256`.
- **O4** `./deploy.sh restaurar <dump>` restaura a base de ensayo, imprime conteos idénticos y **no promueve** sin confirmación explícita.
- **O5** `gitleaks` 0 hallazgos; `.env` nunca en git; `docker-compose.override.yml` en `.gitignore`.
- **O6** p95 de generación de PDF < 3.5 s con `PDF_CONCURRENCY=2`; app <400 MB RSS tras 50 PDFs (sin fuga de Chromium).

---

## 8. DECISIONES QUE QUEDARON ABIERTAS

**Requieren decisión de Chuy (bloquean el criterio de aceptación, no la construcción):**

1. **El azul `#1E3A8A` de los precios.** El fixture pinta las 16 cifras en azul marino (literalmente `blue-900` de Tailwind: huele a copia-pega del generador original), no en el morado de marca. *Necesito saber si es intencional.* Si Chuy dice "es un error, ponlo morado", el fixture deja de ser oráculo de color y F5 cambia. **Por defecto se replica el azul exacto** y se expone un interruptor en Ajustes › Marca (`preciosEnMorado`, apagado).
2. **Qué imprimir cuando no hay precio y la marca sí va a ver el documento.** Hay tres salidas razonables: `Pendiente`, `Cotizar` o `—`. Afecta directamente lo que recibe HONOR. **Por defecto: "Cotizar"** para `PENDING` y `CASE_BY_CASE`, `—` para vacío y `N/A` en gris — con el diálogo de P5 permitiendo cambiarlo por documento.
3. **Aprobación: ¿umbral o siempre?** El CRM real dice *"Jesús Gallardo o Ramiro Ortiz antes de…"* en **7 de 8** propuestas, es decir en la práctica todo requiere aprobación; el umbral del 20 % no está en ningún dato. **Por defecto: `ajustes.aprobacion_modo = "umbral"` con 20 % sobre las líneas con base `QUOTED`**, y `Usuario.esAprobador` para que Ramiro apruebe sin ser Admin. Chuy decide si lo cambia a "siempre".
4. **Máximo de formatos por tabulador.** El ancho útil es 470.6 pt: 4 columnas es el caso HONOR, 6 es el límite legible. **Asumido: ≥7 formatos ⇒ se apilan dos tablas de ≤5 columnas** (`FORMATOS 1–5` / `FORMATOS 6–…`), no orientación horizontal (Chromium no soporta orientaciones mixtas en un documento).

**Asumido por mí (queda registrado, revertible):**

5. **Enlace público `/v/{token}` para la marca → fuera de v1.** Es la única superficie no autenticada del sistema y Chuy va a mandar el PDF por WhatsApp de todos modos. Se conservan `QuoteSnapshotFile` + descarga autenticada; el enlace entra en v1.1 con su tabla de aperturas.
6. **TOTP → v1.1.** Cloudflare Access delante del túnel cubre el hueco en v1, **con política de bypass** si algún día se activa el enlace público. Las columnas no se crean hasta que se implemente.
7. **Módulo de talento menor de edad → una casilla y un banner.** Ninguno de los dos Excel tiene fecha de nacimiento, tutor ni contacto personal: la única mención está en el texto libre de `Notas` de Tejón. Regla dura: **ningún dato personal de menor entra al sistema**.
8. **`importacion.revertir` → sustituido por `pg_dump` automático antes de aplicar**, con restauración documentada. Revertir bien es más caro que el importador entero.
9. **Modo oscuro → solo el chrome, fase 2.** Los tokens `.dark` y `color-scheme: light` en `.kt-doc` cuestan cero ahora; el toggle no se construye en v1.
10. **Deshacer/rehacer global, drag & drop, presets de formatos, selección de rango en el tarifario, offline con IndexedDB/service worker → fuera de v1.** `Esc`, `↺ Revertir al precio base`, `Revertir todos`, ⌃⌄ y ⌥↑↓ cubren el arrepentimiento y el reordenamiento reales.
11. **Build en CI + GHCR como camino principal**, con `BUILD_LOCAL=1` documentado como respaldo para quien no tenga Actions. Si no hay CI, el requisito del servidor sube a 8 GB + 2 GB de swap.
