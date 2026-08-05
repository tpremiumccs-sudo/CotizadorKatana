import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { readWorkbook, sha256 } from '@/server/import/workbook'
import { buildImportPlan } from '@/server/import/plan'
import { commitImport, calcularCommitKey } from '@/server/import/commit'
import { normalizeName, type TalentoConocido } from '@/server/import/identity'
import { FORMATOS } from '@/server/import/catalogo'
import type { RejillaHoja } from '@/server/import/types'
import {
  ARCHIVO_CRM, NOMBRE_CRM, FALTAN_LOS_XLSX, avisarSiFaltan,
} from '../fixtures/xlsx-reales'

/**
 * Importación completa contra Postgres: del .xlsx real a la base.
 *
 * Es la prueba que de verdad cierra la fase. Todo lo demás son piezas; esto
 * comprueba que el archivo que usa la agencia entra entero, que se puede
 * volver a importar sin duplicar nada, y que un Excel viejo no pisa lo que
 * alguien ajustó a mano en la app.
 */

const prisma = new PrismaClient()

// Los .xlsx no se versionan: son datos comerciales reales. Sin ellos estas
// pruebas se omiten con un mensaje, no fallan.
avisarSiFaltan()
const describir = FALTAN_LOS_XLSX ? describe.skip : describe

let crm: RejillaHoja[]
let bufCrm: Buffer
let actor: { id: string; nombre: string }

async function limpiar() {
  await prisma.$executeRaw`ALTER TABLE "Bitacora" DISABLE TRIGGER bitacora_inmutable`
  await prisma.$executeRaw`ALTER TABLE "TalentRateRevision" DISABLE TRIGGER rate_revision_inmutable`
  await prisma.talentRateRevision.deleteMany({})
  await prisma.talentMetric.deleteMany({})
  await prisma.talentRate.deleteMany({})
  await prisma.talentIdentifier.deleteMany({})
  // Las cotizaciones apuntan a los talentos: si quedó alguna de otra prueba o
  // de una verificación manual, borrar talentos viola la clave foránea.
  await prisma.quote.deleteMany({})
  await prisma.client.deleteMany({})
  await prisma.talent.deleteMany({})
  await prisma.bitacora.deleteMany({})
  await prisma.importBatch.deleteMany({})
  await prisma.$executeRaw`ALTER TABLE "Bitacora" ENABLE TRIGGER bitacora_inmutable`
  await prisma.$executeRaw`ALTER TABLE "TalentRateRevision" ENABLE TRIGGER rate_revision_inmutable`
}

async function talentosConocidos(): Promise<TalentoConocido[]> {
  const filas = await prisma.talent.findMany({ include: { identifiers: true } })
  return filas.map((t) => ({
    talentId: t.id,
    codigo: t.code,
    canonicalName: t.canonicalName,
    displayName: t.displayName,
    identificadores: t.identifiers.map((i) => i.normalized),
  }))
}

async function tarifasActuales() {
  const filas = await prisma.talentRate.findMany({ include: { deliverableType: true } })
  return filas.map((r) => ({
    talentId: r.talentId,
    deliverableCode: r.deliverableType.code,
    amountCents: r.amountCents,
    priceStatus: r.priceStatus as string,
    editadaAMano: r.manuallyEditedAt !== null,
  }))
}

async function importar(decisiones = {}) {
  const plan = buildImportPlan(crm, 'CRM_COMERCIAL', {
    talentosConocidos: await talentosConocidos(),
    tarifasActuales: await tarifasActuales(),
    archivo: NOMBRE_CRM,
    sha256: sha256(bufCrm),
  })
  return { plan, resultado: await commitImport(prisma, plan, decisiones, actor) }
}

beforeAll(async () => {
  if (FALTAN_LOS_XLSX) return
  bufCrm = readFileSync(ARCHIVO_CRM)
  crm = await readWorkbook(bufCrm)
  await prisma.$connect()

  // Los 19 formatos deben existir: los siembra prisma/seed.ts.
  const n = await prisma.deliverableType.count()
  if (n !== FORMATOS.length) {
    throw new Error(
      `Faltan formatos en la base (${n}/${FORMATOS.length}). Corre: npm run db:seed`,
    )
  }

  const admin = await prisma.usuario.findFirst({ where: { rol: 'ADMIN' } })
  if (!admin) throw new Error('No hay administrador. Corre: npm run db:seed')
  actor = { id: admin.id, nombre: admin.nombre }

  await limpiar()
}, 120_000)

afterAll(async () => {
  if (FALTAN_LOS_XLSX) return
  await limpiar()
  await prisma.$disconnect()
})

describir('primera importación del CRM real', () => {
  it('entra el archivo completo en una sola transacción', async () => {
    const { resultado } = await importar()

    expect(resultado.yaAplicado).toBe(false)
    expect(resultado.talentosCreados).toBeGreaterThanOrEqual(21)
    expect(resultado.omitidos).toBe(0)
    // 21 talentos del tarifario × 19 formatos.
    expect(resultado.tarifasEscritas).toBe(21 * 19)

    const lote = await prisma.importBatch.findUnique({
      where: { id: resultado.importBatchId },
    })
    expect(lote?.status).toBe('COMMITTED')
    expect(lote?.committedAt).not.toBeNull()
  }, 120_000)

  it('los estados de precio quedan exactamente como en el archivo', async () => {
    const conteo = await prisma.talentRate.groupBy({
      by: ['priceStatus'],
      _count: true,
    })
    const m = Object.fromEntries(conteo.map((c) => [c.priceStatus, c._count]))

    expect(m.QUOTED).toBe(182)
    expect(m.NOT_APPLICABLE).toBe(93)
    expect(m.PENDING).toBe(87)
    expect(m.CASE_BY_CASE).toBe(37)
  })

  it('la restricción de la base impide que un "Pendiente" tenga importe', async () => {
    const pendientes = await prisma.talentRate.findMany({
      where: { priceStatus: 'PENDING' },
      select: { amountCents: true },
    })
    expect(pendientes.length).toBe(87)
    expect(pendientes.every((p) => p.amountCents === null)).toBe(true)
  })

  it('cada cambio de tarifa deja su revisión para la bitácora', async () => {
    const revisiones = await prisma.talentRateRevision.count()
    expect(revisiones).toBe(21 * 19)
  })

  it('las tarifas de los cuatro talentos del tabulador de HONOR son correctas', async () => {
    const esperado: Record<string, Record<string, number | string>> = {
      Ronny: { TIKTOK: 90_000_00, REEL_IG: 130_000_00, TIKTOK_REEL_MIRROR: 195_000_00, STORY_IG: 40_000_00 },
      'Tony Gastélum': { TIKTOK: 30_000_00, REEL_IG: 60_000_00, TIKTOK_REEL_MIRROR: 90_000_00, STORY_IG: 25_000_00 },
      Yoiker: { TIKTOK: 25_000_00, REEL_IG: 40_000_00, TIKTOK_REEL_MIRROR: 60_000_00, STORY_IG: 20_000_00 },
      'Mariel Estrella': { TIKTOK: 100_000_00, REEL_IG: 'PENDING', TIKTOK_REEL_MIRROR: 'PENDING', STORY_IG: 'PENDING' },
    }

    for (const [nombre, formatos] of Object.entries(esperado)) {
      const ident = await prisma.talentIdentifier.findUnique({
        where: { normalized: normalizeName(nombre) },
        include: {
          talent: { include: { rates: { include: { deliverableType: true } } } },
        },
      })
      expect(ident, `no se encontró ${nombre}`).not.toBeNull()

      for (const [code, valor] of Object.entries(formatos)) {
        const tarifa = ident!.talent.rates.find((r) => r.deliverableType.code === code)
        expect(tarifa, `${nombre} · ${code}`).toBeDefined()
        if (typeof valor === 'number') {
          expect(tarifa!.amountCents, `${nombre} · ${code}`).toBe(valor)
          expect(tarifa!.priceStatus).toBe('QUOTED')
        } else {
          expect(tarifa!.priceStatus, `${nombre} · ${code}`).toBe(valor)
          expect(tarifa!.amountCents).toBeNull()
        }
      }
    }
  })

  it('los alias sembrados quedan registrados junto al talento', async () => {
    // "Ronaldo BXM" debe apuntar al mismo talento que "Ronny": es el alias que
    // ninguna métrica de similitud podría inferir (0.44).
    const porRonny = await prisma.talentIdentifier.findUnique({
      where: { normalized: normalizeName('Ronny') },
    })
    const porBxm = await prisma.talentIdentifier.findUnique({
      where: { normalized: normalizeName('Ronaldo BXM') },
    })
    expect(porRonny).not.toBeNull()
    expect(porBxm).not.toBeNull()
    expect(porBxm!.talentId).toBe(porRonny!.talentId)
  })

  it('la nota con el tarifario en prosa de Padigol se guarda íntegra', async () => {
    const ident = await prisma.talentIdentifier.findUnique({
      where: { normalized: normalizeName('Padigol') },
      include: { talent: true },
    })
    expect(ident!.talent.rateNotes!.length).toBeGreaterThan(500)
    expect(ident!.talent.rateNotes).toContain('paquete 45 menciones')
  })

  it('deja constancia en la bitácora', async () => {
    const evento = await prisma.bitacora.findFirst({
      where: { accion: 'importacion.aplicada' },
      orderBy: { ocurridoEn: 'desc' },
    })
    expect(evento).not.toBeNull()
    expect(evento!.resumen).toContain('talento(s) nuevo(s)')
    expect(evento!.actorNombre).toBe(actor.nombre)
  })
})

describir('segunda importación del mismo archivo', () => {
  it('no crea ni modifica nada', async () => {
    const talentosAntes = await prisma.talent.count()
    const tarifasAntes = await prisma.talentRate.count()

    const { plan, resultado } = await importar({ nota: 'segunda pasada' })

    expect(plan.resumen.aCrear).toBe(0)
    expect(plan.resumen.tarifasNuevas).toBe(0)
    expect(plan.resumen.tarifasModificadas).toBe(0)
    expect(resultado.talentosCreados).toBe(0)
    expect(resultado.tarifasEscritas).toBe(0)

    expect(await prisma.talent.count()).toBe(talentosAntes)
    expect(await prisma.talentRate.count()).toBe(tarifasAntes)
  }, 120_000)

  it('el mismo commitKey devuelve el resultado anterior sin duplicar', async () => {
    const plan = buildImportPlan(crm, 'CRM_COMERCIAL', {
      talentosConocidos: await talentosConocidos(),
      tarifasActuales: await tarifasActuales(),
      archivo: 'x.xlsx',
      sha256: sha256(bufCrm),
    })
    const decisiones = { ignorar: [] }

    const lotesAntes = await prisma.importBatch.count()
    const primero = await commitImport(prisma, plan, decisiones, actor)
    const segundo = await commitImport(prisma, plan, decisiones, actor)

    expect(segundo.yaAplicado).toBe(true)
    expect(segundo.importBatchId).toBe(primero.importBatchId)
    // Sólo se creó un lote pese a las dos llamadas.
    expect(await prisma.importBatch.count()).toBe(lotesAntes + 1)
    expect(calcularCommitKey(plan.sha256, decisiones)).toBe(
      calcularCommitKey(plan.sha256, decisiones),
    )
  }, 120_000)
})

describir('una edición manual sobrevive a un Excel viejo', () => {
  it('el precio ajustado en la app no se pisa al re-importar', async () => {
    const ident = await prisma.talentIdentifier.findUnique({
      where: { normalized: normalizeName('Ronny') },
    })
    const espejo = await prisma.deliverableType.findUnique({
      where: { code: 'TIKTOK_REEL_MIRROR' },
    })

    // Chuy baja el espejo de Ronny a $150,000 dentro de la app, igual que en el
    // tabulador de HONOR. El Excel sigue diciendo $195,000.
    await prisma.talentRate.update({
      where: {
        talentId_deliverableTypeId: {
          talentId: ident!.talentId,
          deliverableTypeId: espejo!.id,
        },
      },
      data: { amountCents: 150_000_00, manuallyEditedAt: new Date(), lastChangeSource: 'MANUAL' },
    })

    const { plan, resultado } = await importar({ nota: 'tras edición manual' })

    expect(plan.resumen.tarifasEnConflicto).toBe(1)
    expect(resultado.tarifasEscritas).toBe(0) // no se escribió el conflicto

    const despues = await prisma.talentRate.findUnique({
      where: {
        talentId_deliverableTypeId: {
          talentId: ident!.talentId,
          deliverableTypeId: espejo!.id,
        },
      },
    })
    expect(despues!.amountCents).toBe(150_000_00)
  }, 120_000)

  it('con TOMAR_ARCHIVO sí se acepta el valor del Excel', async () => {
    const ident = await prisma.talentIdentifier.findUnique({
      where: { normalized: normalizeName('Ronny') },
    })
    const espejo = await prisma.deliverableType.findUnique({
      where: { code: 'TIKTOK_REEL_MIRROR' },
    })

    const { resultado } = await importar({
      conflictos: { [`${ident!.talentId}|TIKTOK_REEL_MIRROR`]: 'TOMAR_ARCHIVO' },
    })
    expect(resultado.tarifasEscritas).toBe(1)

    const despues = await prisma.talentRate.findUnique({
      where: {
        talentId_deliverableTypeId: {
          talentId: ident!.talentId,
          deliverableTypeId: espejo!.id,
        },
      },
    })
    expect(despues!.amountCents).toBe(195_000_00)
  }, 120_000)
})
