import 'server-only'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { append } from '@/server/audit/append'
import { autorizar } from '@/server/data/autorizar'
import {
  readWorkbook, sha256, detectarTipoArchivo, MAX_BYTES, ArchivoInvalidoError,
} from '@/server/import/workbook'
import { buildImportPlan } from '@/server/import/plan'
import { commitImport, type DecisionesImport } from '@/server/import/commit'
import { FORMATO_POR_CODE } from '@/server/import/catalogo'
import type { PlanImportacion } from '@/server/import/types'

/**
 * Importación de los Excel del CRM.
 *
 * Tres pasos y ninguno toca el tarifario hasta el último: se sube el archivo,
 * se calcula QUÉ cambiaría, y sólo cuando alguien lo confirma se aplica. Los
 * archivos reales traen encabezados en filas distintas, precios que son
 * palabras y nombres que no coinciden entre hojas; aplicar directo significaría
 * romperse o, peor, inventar datos en silencio.
 */

/**
 * Dónde se guardan los .xlsx subidos: son la evidencia de qué entró.
 *
 * Cuelga de `STORAGE_DIR`, que en producción es un volumen. Guardarlos junto
 * al código los perdería en cada despliegue, y entonces la respuesta a "¿de
 * dónde salió este precio?" sería "de un archivo que ya no existe".
 */
const DIR_SUBIDAS =
  process.env.UPLOADS_DIR ??
  join(process.env.STORAGE_DIR ?? join(process.cwd(), 'var'), 'importaciones')

export { MAX_BYTES, ArchivoInvalidoError }

export interface ResultadoSubida {
  importBatchId: string
  plan: PlanImportacion
}

/**
 * Sube el archivo y calcula el plan.
 *
 * El .xlsx se conserva: `TalentRateRevision` dice qué cambió, pero sólo el
 * archivo original permite responder "¿de dónde salió este precio?" seis meses
 * después.
 */
export async function subirYPlanear(
  nombreArchivo: string,
  contenido: Buffer,
): Promise<ResultadoSubida> {
  const actor = await autorizar('importacion.subir')

  if (contenido.length === 0) throw new ArchivoInvalidoError('El archivo está vacío.')
  if (contenido.length > MAX_BYTES) {
    throw new ArchivoInvalidoError(
      `El archivo pesa ${(contenido.length / 1_048_576).toFixed(1)} MB y el límite es ` +
        `${MAX_BYTES / 1_048_576} MB.`,
    )
  }

  const hojas = await readWorkbook(contenido)
  const tipo = detectarTipoArchivo(hojas)
  if (!tipo) {
    throw new ArchivoInvalidoError(
      'No reconozco este archivo. Se esperaba el CRM KATANA ENGINE (con la hoja ' +
        '"TARIFARIO KATANA") o el CRM Roster (con "Base de Talentos"). ' +
        `Las hojas que trae son: ${hojas.map((h) => h.nombre).join(', ')}.`,
    )
  }

  const huella = sha256(contenido)
  const ctx = await contextoDelPlan()
  const plan = buildImportPlan(hojas, tipo, { ...ctx, archivo: nombreArchivo, sha256: huella })

  await mkdir(DIR_SUBIDAS, { recursive: true })
  const rutaGuardada = join(DIR_SUBIDAS, `${huella}.xlsx`)
  await writeFile(rutaGuardada, contenido)

  const lote = await prisma.importBatch.create({
    data: {
      kind: tipo,
      originalFileName: nombreArchivo,
      sha256: huella,
      sizeBytes: contenido.length,
      storagePath: rutaGuardada,
      status: 'PREVIEWED',
      uploadedById: actor.id,
      plan: plan as unknown as object,
    },
    select: { id: true },
  })

  await prisma.$transaction(async (tx) => {
    await append(tx, {
      actor,
      categoria: 'IMPORTACION',
      accion: 'importacion.subida',
      entidadTipo: 'ImportBatch',
      entidadId: lote.id,
      entidadEtiqueta: nombreArchivo,
      resumen:
        `${actor.nombre} subió "${nombreArchivo}" (${tipo}). ` +
        `Se planearon ${plan.resumen.aCrear} alta(s), ` +
        `${plan.resumen.aActualizar} actualización(es) y ` +
        `${plan.resumen.tarifasModificadas} cambio(s) de tarifa. Aún no se aplicó nada.`,
      metadatos: { sha256: huella, resumen: plan.resumen },
    })
  })

  return { importBatchId: lote.id, plan }
}

/**
 * Los campos de perfil que el importador escribe.
 *
 * Se leen para comparar: sin ellos el planificador no puede saber si un campo
 * cambia de verdad y declara una actualización por cada campo que el archivo
 * trae, aunque el valor sea idéntico al que ya está guardado.
 */
const CAMPOS_DE_PERFIL = {
  category: true, city: true, country: true, verticals: true,
  relationshipType: true, primaryPlatformNote: true, roster: true,
  rateStatusRaw: true, rateSourceLabel: true, rateNotes: true,
  bio: true, driveFolderId: true, commercialNotes: true,
  username: true, linkInstagram: true, linkTiktok: true, linkYoutube: true,
} as const

/** Lo que el planificador necesita saber del estado actual. */
async function contextoDelPlan() {
  const [talentos, tarifas] = await Promise.all([
    prisma.talent.findMany({
      select: {
        id: true, code: true, canonicalName: true, displayName: true,
        identifiers: { select: { normalized: true } },
        // Los campos que el importador escribe. Hacen falta para que
        // re-importar el mismo archivo no declare cambios que no cambian nada.
        ...CAMPOS_DE_PERFIL,
      },
    }),
    prisma.talentRate.findMany({
      select: {
        talentId: true, amountCents: true, priceStatus: true,
        manuallyEditedAt: true,
        deliverableType: { select: { code: true } },
      },
    }),
  ])

  return {
    talentosConocidos: talentos.map((t) => {
      const { id, code, canonicalName, displayName, identifiers, ...perfil } = t
      return {
        talentId: id,
        codigo: code,
        canonicalName,
        displayName,
        identificadores: identifiers.map((i) => i.normalized),
        // `canonicalName` y `code` también los escribe el importador, así que
        // entran al perfil para poder compararlos como cualquier otro campo.
        perfil: { ...perfil, canonicalName, code } as Record<string, unknown>,
      }
    }),
    tarifasActuales: tarifas.map((r) => ({
      talentId: r.talentId,
      deliverableCode: r.deliverableType.code,
      amountCents: r.amountCents,
      priceStatus: r.priceStatus as string,
      editadaAMano: r.manuallyEditedAt !== null,
    })),
  }
}

export async function leerLote(importBatchId: string) {
  await autorizar('importacion.subir')
  const lote = await prisma.importBatch.findUnique({
    where: { id: importBatchId },
    include: { uploadedBy: { select: { nombre: true } } },
  })
  if (!lote) return null
  return {
    id: lote.id,
    archivo: lote.originalFileName,
    tipo: lote.kind,
    estado: lote.status,
    subidoPor: lote.uploadedBy.nombre,
    subidoEn: lote.uploadedAt,
    aplicadoEn: lote.committedAt,
    bytes: lote.sizeBytes,
    plan: lote.plan as unknown as PlanImportacion | null,
    stats: lote.stats as unknown as Record<string, number> | null,
  }
}

export async function listarLotes(limite = 20) {
  await autorizar('importacion.subir')
  return prisma.importBatch.findMany({
    take: limite,
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true, originalFileName: true, kind: true, status: true,
      uploadedAt: true, committedAt: true, stats: true,
      uploadedBy: { select: { nombre: true } },
    },
  })
}

/**
 * Aplica el plan ya revisado.
 *
 * Sólo un administrador: aplicar reescribe el tarifario completo, que es la
 * base de todo lo que se le cotiza a las marcas.
 */
export async function aplicarImportacion(
  importBatchId: string,
  decisiones: DecisionesImport,
) {
  const actor = await autorizar('importacion.aplicar', {
    entidadTipo: 'ImportBatch',
    entidadId: importBatchId,
  })

  const lote = await prisma.importBatch.findUnique({ where: { id: importBatchId } })
  if (!lote) throw new Error('Esa importación ya no existe.')
  if (!lote.plan) throw new Error('Esa importación no tiene un plan calculado.')

  const plan = lote.plan as unknown as PlanImportacion
  const resultado = await commitImport(prisma, plan, decisiones, actor)

  await prisma.importBatch.update({
    where: { id: importBatchId },
    data: {
      status: 'COMMITTED',
      committedAt: lote.committedAt ?? new Date(),
      decisions: decisiones as unknown as object,
      stats: resultado as unknown as object,
    },
  })

  if (!resultado.yaAplicado) {
    await prisma.$transaction(async (tx) => {
      await append(tx, {
        actor,
        categoria: 'IMPORTACION',
        accion: 'importacion.aplicada',
        entidadTipo: 'ImportBatch',
        entidadId: importBatchId,
        entidadEtiqueta: lote.originalFileName,
        resumen:
          `${actor.nombre} aplicó "${lote.originalFileName}": ` +
          `${resultado.talentosCreados} talento(s) nuevo(s), ` +
          `${resultado.talentosActualizados} actualizado(s), ` +
          `${resultado.tarifasEscritas} tarifa(s) escrita(s).`,
        metadatos: resultado as unknown as Record<string, unknown>,
      })
    })
  }

  return resultado
}

/** Nombre legible de un formato, para la pantalla de revisión. */
export function nombreFormato(code: string): string {
  return FORMATO_POR_CODE.get(code)?.name ?? code
}
