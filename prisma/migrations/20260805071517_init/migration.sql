-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN', 'COMERCIAL', 'LECTURA');

-- CreateEnum
CREATE TYPE "EstadoUsuario" AS ENUM ('ACTIVO', 'SUSPENDIDO', 'DESACTIVADO');

-- CreateEnum
CREATE TYPE "PriceStatus" AS ENUM ('QUOTED', 'PENDING', 'NOT_APPLICABLE', 'CASE_BY_CASE');

-- CreateEnum
CREATE TYPE "RosterKind" AS ENUM ('KATANA', 'KIF', 'FIERA');

-- CreateEnum
CREATE TYPE "TalentRateStatus" AS ENUM ('ACTIVO', 'INCOMPLETO', 'CAPTURADO', 'PENDIENTE', 'REFERENCIA_HISTORICA');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'FACEBOOK', 'TWITCH', 'KICK', 'X', 'OTRA');

-- CreateEnum
CREATE TYPE "MetricParseStatus" AS ENUM ('EXACT', 'INFERRED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliverableCategory" AS ENUM ('SOCIAL_CONTENT', 'PLACEMENT', 'EVENT', 'STREAMING', 'YOUTUBE', 'LONGFORM', 'RIGHTS');

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('PIEZA', 'HORA', 'MES', 'EVENTO', 'PERIODO_7D');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'REQUIERE_APROBACION', 'SENT', 'IN_NEGOTIATION', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('ADDED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "DocKind" AS ENUM ('TABULADOR', 'COTIZACION');

-- CreateEnum
CREATE TYPE "RateChangeSource" AS ENUM ('IMPORT', 'MANUAL', 'SEED');

-- CreateEnum
CREATE TYPE "IdentifierSource" AS ENUM ('PERFIL_COMERCIAL', 'TARIFARIO', 'TALENTOS', 'ROSTER', 'KIF', 'FIERA', 'MANUAL', 'SEED', 'IMPORT_MATCH');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CRM_COMERCIAL', 'ROSTER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'PARSED', 'PREVIEWED', 'COMMITTED', 'ABORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CategoriaBitacora" AS ENUM ('AUTENTICACION', 'USUARIOS', 'CATALOGO', 'TARIFARIO', 'COTIZACION', 'DOCUMENTO', 'IMPORTACION', 'AJUSTES', 'SISTEMA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "emailOriginal" TEXT,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'LECTURA',
    "estado" "EstadoUsuario" NOT NULL DEFAULT 'ACTIVO',
    "esAprobador" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "passwordAlgo" TEXT NOT NULL DEFAULT 'argon2id',
    "passwordCambiadoEn" TIMESTAMP(3),
    "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT false,
    "bloqueadoHasta" TIMESTAMP(3),
    "ultimoAccesoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sesion" (
    "id" TEXT NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "expiraAbsolutoEn" TIMESTAMP(3) NOT NULL,
    "ultimaActividadEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reautenticadoEn" TIMESTAMP(3),
    "recordar" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "userAgent" TEXT,
    "revocadaEn" TIMESTAMP(3),
    "motivoRevocacion" TEXT,

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitacion" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "invitadoPorId" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "aceptadaEn" TIMESTAMP(3),
    "revocadaEn" TIMESTAMP(3),

    CONSTRAINT "Invitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenRestablecimiento" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),

    CONSTRAINT "TokenRestablecimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentoAcceso" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "exito" BOOLEAN NOT NULL,
    "motivo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentoAcceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bitacora" (
    "id" TEXT NOT NULL,
    "ocurridoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorNombre" TEXT,
    "actorRol" "Rol",
    "categoria" "CategoriaBitacora" NOT NULL,
    "accion" TEXT NOT NULL,
    "entidadTipo" TEXT,
    "entidadId" TEXT,
    "entidadEtiqueta" TEXT,
    "resumen" TEXT NOT NULL,
    "cambios" JSONB,
    "metadatos" JSONB,
    "exito" BOOLEAN NOT NULL DEFAULT true,
    "ip" TEXT,
    "userAgent" TEXT,
    "sesionId" TEXT,
    "ventana" TEXT,

    CONSTRAINT "Bitacora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Talent" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "canonicalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "roster" "RosterKind" NOT NULL DEFAULT 'KATANA',
    "category" TEXT,
    "verticals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationshipType" TEXT,
    "country" TEXT,
    "city" TEXT,
    "primaryPlatformNote" TEXT,
    "rateStatus" "TalentRateStatus" NOT NULL DEFAULT 'INCOMPLETO',
    "rateStatusRaw" TEXT,
    "rateSourceLabel" TEXT,
    "rateNotes" TEXT,
    "bio" TEXT,
    "achievements" TEXT,
    "campaigns" TEXT,
    "photoUrl" TEXT,
    "driveFolderId" TEXT,
    "esMenorDeEdad" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "missingInLastImport" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPorId" TEXT,
    "actualizadoPorNombre" TEXT,

    CONSTRAINT "Talent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentIdentifier" (
    "id" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "isCanonical" BOOLEAN NOT NULL DEFAULT false,
    "source" "IdentifierSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentMetric" (
    "id" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "followers" INTEGER,
    "rawValue" TEXT NOT NULL,
    "parseStatus" "MetricParseStatus" NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceLabel" TEXT,
    "importBatchId" TEXT,

    CONSTRAINT "TalentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pdfLabel" TEXT NOT NULL,
    "pdfSublabel" TEXT,
    "excelHeader" TEXT NOT NULL,
    "category" "DeliverableCategory" NOT NULL,
    "unit" "UnitKind" NOT NULL DEFAULT 'PIEZA',
    "unitLabel" TEXT NOT NULL DEFAULT 'pieza',
    "allowsQuantity" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DeliverableType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentRate" (
    "id" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "deliverableTypeId" TEXT NOT NULL,
    "amountCents" INTEGER,
    "priceStatus" "PriceStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "sourceLabel" TEXT,
    "lastChangeSource" "RateChangeSource" NOT NULL DEFAULT 'IMPORT',
    "lastImportBatchId" TEXT,
    "manuallyEditedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPorId" TEXT,

    CONSTRAINT "TalentRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentRateRevision" (
    "id" TEXT NOT NULL,
    "talentRateId" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "deliverableTypeId" TEXT NOT NULL,
    "beforeAmountCents" INTEGER,
    "beforePriceStatus" "PriceStatus",
    "afterAmountCents" INTEGER,
    "afterPriceStatus" "PriceStatus" NOT NULL,
    "source" "RateChangeSource" NOT NULL,
    "importBatchId" TEXT,
    "actorId" TEXT,
    "reason" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TalentRateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "normalizedKey" TEXT NOT NULL,
    "folioCode" CHAR(3) NOT NULL,
    "vertical" TEXT,
    "taxId" TEXT,
    "isTalentManagement" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "folio" TEXT,
    "folioYear" INTEGER,
    "folioSeq" INTEGER,
    "draftRef" TEXT NOT NULL,
    "isLegacy" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "agentUserId" TEXT,
    "agentLabel" TEXT,
    "createdById" TEXT NOT NULL,
    "projectName" TEXT,
    "quoteType" TEXT,
    "scopeText" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "aprobadaPorId" TEXT,
    "aprobadaEn" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "taxMode" "TaxMode" NOT NULL DEFAULT 'ADDED',
    "taxRateBps" INTEGER NOT NULL DEFAULT 1600,
    "packageDiscountType" "DiscountType",
    "packageDiscountValue" INTEGER,
    "validityLabel" TEXT DEFAULT '15 días naturales',
    "paymentTerms" TEXT,
    "includeTabulador" BOOLEAN NOT NULL DEFAULT true,
    "includeCotizacion" BOOLEAN NOT NULL DEFAULT false,
    "layoutVersion" TEXT NOT NULL DEFAULT 'honor-v1',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "lineDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "packageDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "taxableBaseCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "hasNonQuotedLines" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPorNombre" TEXT,
    "emittedAt" TIMESTAMP(3),
    "currentSnapshotId" TEXT,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteTalent" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "displayNameOverride" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "lineDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "allocatedPackageDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "netCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteTalent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteColumn" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "deliverableTypeId" TEXT NOT NULL,
    "headerLabel" TEXT NOT NULL,
    "headerSublabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotePrice" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteTalentId" TEXT NOT NULL,
    "deliverableTypeId" TEXT NOT NULL,
    "baseAmountCents" INTEGER,
    "basePriceStatus" "PriceStatus" NOT NULL,
    "baseCapturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overrideAmountCents" INTEGER,
    "overridePriceStatus" "PriceStatus",
    "overrideReason" TEXT,
    "overriddenById" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "showInTabulador" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteTalentId" TEXT,
    "quotePriceId" TEXT,
    "deliverableTypeId" TEXT,
    "description" TEXT NOT NULL,
    "detail" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER,
    "priceStatus" "PriceStatus" NOT NULL DEFAULT 'QUOTED',
    "lineDiscountType" "DiscountType",
    "lineDiscountValue" INTEGER,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteConsideration" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteConsideration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteTerm" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "folio" TEXT NOT NULL,
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emittedById" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "layoutVersion" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "chromiumVersion" TEXT NOT NULL,

    CONSTRAINT "QuoteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSnapshotFile" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" "DocKind" NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "renderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteSnapshotFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolioCounter" (
    "scope" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FolioCounter_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "BrandAsset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "commitKey" TEXT,
    "plan" JSONB,
    "decisions" JSONB,
    "stats" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_estado_rol_idx" ON "Usuario"("estado", "rol");

-- CreateIndex
CREATE UNIQUE INDEX "Sesion_tokenHash_key" ON "Sesion"("tokenHash");

-- CreateIndex
CREATE INDEX "Sesion_usuarioId_revocadaEn_idx" ON "Sesion"("usuarioId", "revocadaEn");

-- CreateIndex
CREATE INDEX "Sesion_expiraAbsolutoEn_idx" ON "Sesion"("expiraAbsolutoEn");

-- CreateIndex
CREATE UNIQUE INDEX "Invitacion_tokenHash_key" ON "Invitacion"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitacion_email_aceptadaEn_revocadaEn_idx" ON "Invitacion"("email", "aceptadaEn", "revocadaEn");

-- CreateIndex
CREATE UNIQUE INDEX "TokenRestablecimiento_tokenHash_key" ON "TokenRestablecimiento"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenRestablecimiento_usuarioId_usadoEn_idx" ON "TokenRestablecimiento"("usuarioId", "usadoEn");

-- CreateIndex
CREATE INDEX "IntentoAcceso_email_creadoEn_idx" ON "IntentoAcceso"("email", "creadoEn");

-- CreateIndex
CREATE INDEX "IntentoAcceso_ip_creadoEn_idx" ON "IntentoAcceso"("ip", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "Bitacora_ventana_key" ON "Bitacora"("ventana");

-- CreateIndex
CREATE INDEX "Bitacora_ocurridoEn_idx" ON "Bitacora"("ocurridoEn" DESC);

-- CreateIndex
CREATE INDEX "Bitacora_entidadTipo_entidadId_ocurridoEn_idx" ON "Bitacora"("entidadTipo", "entidadId", "ocurridoEn" DESC);

-- CreateIndex
CREATE INDEX "Bitacora_actorId_ocurridoEn_idx" ON "Bitacora"("actorId", "ocurridoEn" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Talent_code_key" ON "Talent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Talent_slug_key" ON "Talent"("slug");

-- CreateIndex
CREATE INDEX "Talent_roster_isActive_idx" ON "Talent"("roster", "isActive");

-- CreateIndex
CREATE INDEX "Talent_displayName_idx" ON "Talent"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "TalentIdentifier_normalized_key" ON "TalentIdentifier"("normalized");

-- CreateIndex
CREATE INDEX "TalentIdentifier_talentId_idx" ON "TalentIdentifier"("talentId");

-- CreateIndex
CREATE INDEX "TalentMetric_talentId_platform_capturedAt_idx" ON "TalentMetric"("talentId", "platform", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "TalentMetric_needsReview_idx" ON "TalentMetric"("needsReview");

-- CreateIndex
CREATE UNIQUE INDEX "TalentMetric_talentId_platform_capturedAt_rawValue_key" ON "TalentMetric"("talentId", "platform", "capturedAt", "rawValue");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableType_code_key" ON "DeliverableType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableType_excelHeader_key" ON "DeliverableType"("excelHeader");

-- CreateIndex
CREATE INDEX "DeliverableType_category_sortOrder_idx" ON "DeliverableType"("category", "sortOrder");

-- CreateIndex
CREATE INDEX "TalentRate_deliverableTypeId_priceStatus_idx" ON "TalentRate"("deliverableTypeId", "priceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "TalentRate_talentId_deliverableTypeId_key" ON "TalentRate"("talentId", "deliverableTypeId");

-- CreateIndex
CREATE INDEX "TalentRateRevision_talentId_creadoEn_idx" ON "TalentRateRevision"("talentId", "creadoEn" DESC);

-- CreateIndex
CREATE INDEX "TalentRateRevision_importBatchId_idx" ON "TalentRateRevision"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_normalizedKey_key" ON "Client"("normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "Client_folioCode_key" ON "Client"("folioCode");

-- CreateIndex
CREATE INDEX "Client_displayName_idx" ON "Client"("displayName");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_folio_key" ON "Quote"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_draftRef_key" ON "Quote"("draftRef");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_currentSnapshotId_key" ON "Quote"("currentSnapshotId");

-- CreateIndex
CREATE INDEX "Quote_clientId_status_idx" ON "Quote"("clientId", "status");

-- CreateIndex
CREATE INDEX "Quote_status_actualizadoEn_idx" ON "Quote"("status", "actualizadoEn" DESC);

-- CreateIndex
CREATE INDEX "QuoteTalent_quoteId_sortOrder_idx" ON "QuoteTalent"("quoteId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTalent_quoteId_talentId_key" ON "QuoteTalent"("quoteId", "talentId");

-- CreateIndex
CREATE INDEX "QuoteColumn_quoteId_sortOrder_idx" ON "QuoteColumn"("quoteId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteColumn_quoteId_deliverableTypeId_key" ON "QuoteColumn"("quoteId", "deliverableTypeId");

-- CreateIndex
CREATE INDEX "QuotePrice_quoteId_sortOrder_idx" ON "QuotePrice"("quoteId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuotePrice_quoteId_quoteTalentId_deliverableTypeId_key" ON "QuotePrice"("quoteId", "quoteTalentId", "deliverableTypeId");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_sortOrder_idx" ON "QuoteLine"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "QuoteConsideration_quoteId_sortOrder_idx" ON "QuoteConsideration"("quoteId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTerm_quoteId_number_key" ON "QuoteTerm"("quoteId", "number");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_folio_idx" ON "QuoteSnapshot"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteSnapshot_quoteId_version_key" ON "QuoteSnapshot"("quoteId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteSnapshotFile_snapshotId_kind_key" ON "QuoteSnapshotFile"("snapshotId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BrandAsset_key_key" ON "BrandAsset"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_commitKey_key" ON "ImportBatch"("commitKey");

-- CreateIndex
CREATE INDEX "ImportBatch_sha256_idx" ON "ImportBatch"("sha256");

-- CreateIndex
CREATE INDEX "ImportBatch_status_uploadedAt_idx" ON "ImportBatch"("status", "uploadedAt" DESC);

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bitacora" ADD CONSTRAINT "Bitacora_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentIdentifier" ADD CONSTRAINT "TalentIdentifier_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentMetric" ADD CONSTRAINT "TalentMetric_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRate" ADD CONSTRAINT "TalentRate_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRate" ADD CONSTRAINT "TalentRate_deliverableTypeId_fkey" FOREIGN KEY ("deliverableTypeId") REFERENCES "DeliverableType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRateRevision" ADD CONSTRAINT "TalentRateRevision_talentRateId_fkey" FOREIGN KEY ("talentRateId") REFERENCES "TalentRate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRateRevision" ADD CONSTRAINT "TalentRateRevision_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRateRevision" ADD CONSTRAINT "TalentRateRevision_deliverableTypeId_fkey" FOREIGN KEY ("deliverableTypeId") REFERENCES "DeliverableType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRateRevision" ADD CONSTRAINT "TalentRateRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentRateRevision" ADD CONSTRAINT "TalentRateRevision_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ClientContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "QuoteSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTalent" ADD CONSTRAINT "QuoteTalent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTalent" ADD CONSTRAINT "QuoteTalent_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "Talent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteColumn" ADD CONSTRAINT "QuoteColumn_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteColumn" ADD CONSTRAINT "QuoteColumn_deliverableTypeId_fkey" FOREIGN KEY ("deliverableTypeId") REFERENCES "DeliverableType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePrice" ADD CONSTRAINT "QuotePrice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePrice" ADD CONSTRAINT "QuotePrice_quoteTalentId_fkey" FOREIGN KEY ("quoteTalentId") REFERENCES "QuoteTalent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePrice" ADD CONSTRAINT "QuotePrice_deliverableTypeId_fkey" FOREIGN KEY ("deliverableTypeId") REFERENCES "DeliverableType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteTalentId_fkey" FOREIGN KEY ("quoteTalentId") REFERENCES "QuoteTalent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quotePriceId_fkey" FOREIGN KEY ("quotePriceId") REFERENCES "QuotePrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_deliverableTypeId_fkey" FOREIGN KEY ("deliverableTypeId") REFERENCES "DeliverableType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteConsideration" ADD CONSTRAINT "QuoteConsideration_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteTerm" ADD CONSTRAINT "QuoteTerm_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshot" ADD CONSTRAINT "QuoteSnapshot_emittedById_fkey" FOREIGN KEY ("emittedById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSnapshotFile" ADD CONSTRAINT "QuoteSnapshotFile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "QuoteSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
--  INTEGRIDAD DE NEGOCIO
--  Prisma solo ejecuta este archivo, así que los CHECK y triggers viven aquí
--  (no en un .sql hermano). src/env.ts verifica su presencia al arrancar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El precio es un tipo compuesto: importe + estado ──────────────────────
-- QUOTED exige importe; Pendiente / N/A / Caso por caso exigen importe NULL.
-- Esto es lo que impide que "Pendiente" se degrade silenciosamente a $0.
ALTER TABLE "TalentRate" ADD CONSTRAINT tr_price_shape CHECK (
  ("priceStatus" = 'QUOTED' AND "amountCents" IS NOT NULL AND "amountCents" >= 0)
  OR ("priceStatus" <> 'QUOTED' AND "amountCents" IS NULL));

ALTER TABLE "QuotePrice" ADD CONSTRAINT qp_base_shape CHECK (
  ("basePriceStatus" = 'QUOTED' AND "baseAmountCents" IS NOT NULL AND "baseAmountCents" >= 0)
  OR ("basePriceStatus" <> 'QUOTED' AND "baseAmountCents" IS NULL));

ALTER TABLE "QuotePrice" ADD CONSTRAINT qp_override_shape CHECK (
  "overridePriceStatus" IS NULL
  OR ("overridePriceStatus" = 'QUOTED' AND "overrideAmountCents" IS NOT NULL AND "overrideAmountCents" >= 0)
  OR ("overridePriceStatus" <> 'QUOTED' AND "overrideAmountCents" IS NULL));

-- ── Una sola fuente de verdad para el precio de un renglón ────────────────
-- Sin esto, el tabulador y la cotización del MISMO PDF podrían mostrar cifras
-- distintas para el mismo talento y formato.
ALTER TABLE "QuoteLine" ADD CONSTRAINT ql_price_source CHECK (
  ("quotePriceId" IS NOT NULL AND "unitAmountCents" IS NULL)
  OR ("quotePriceId" IS NULL));

ALTER TABLE "QuoteLine" ADD CONSTRAINT ql_free_shape CHECK (
  "quotePriceId" IS NOT NULL
  OR ("priceStatus" = 'QUOTED' AND "unitAmountCents" IS NOT NULL)
  OR ("priceStatus" <> 'QUOTED' AND "unitAmountCents" IS NULL));

ALTER TABLE "QuoteLine" ADD CONSTRAINT ql_qty CHECK ("quantity" > 0);

-- ── Cotización ────────────────────────────────────────────────────────────
ALTER TABLE "Quote" ADD CONSTRAINT q_tax_bps CHECK ("taxRateBps" BETWEEN 0 AND 10000);

-- Una cotización emitida SIEMPRE tiene folio.
ALTER TABLE "Quote" ADD CONSTRAINT q_folio_when_emitted CHECK (
  "isLegacy" OR "status" IN ('DRAFT','REQUIERE_APROBACION','CANCELLED') OR "folio" IS NOT NULL);

-- Techo de $20,000,000.00 MXN: atrapa un error de centavos×100 antes de que
-- llegue a un PDF que ve la marca.
ALTER TABLE "Quote" ADD CONSTRAINT q_total_ceiling CHECK ("totalCents" <= 2000000000);
ALTER TABLE "Quote" ADD CONSTRAINT q_totals_no_negativos CHECK (
  "subtotalCents" >= 0 AND "taxCents" >= 0 AND "totalCents" >= 0);

-- ── Inmutabilidad de la evidencia ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION katana_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción; no admite % .', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Un snapshot emitido no se toca: es lo que reproduce el PDF que vio la marca.
CREATE TRIGGER quote_snapshot_inmutable
  BEFORE UPDATE OR DELETE ON "QuoteSnapshot"
  FOR EACH ROW EXECUTE FUNCTION katana_inmutable();

-- En Bitacora el trigger solo cubre DELETE: la coalescencia de 5 minutos
-- necesita poder hacer UPDATE sobre la fila abierta de la ventana.
CREATE TRIGGER bitacora_inmutable
  BEFORE DELETE ON "Bitacora"
  FOR EACH ROW EXECUTE FUNCTION katana_inmutable();

CREATE TRIGGER rate_revision_inmutable
  BEFORE UPDATE OR DELETE ON "TalentRateRevision"
  FOR EACH ROW EXECUTE FUNCTION katana_inmutable();
