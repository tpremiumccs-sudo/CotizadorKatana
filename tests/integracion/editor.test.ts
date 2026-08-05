import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '@/server/auth/password'
import type { Actor } from '@/lib/authz/policy'
import type { DatosSesion } from '@/server/auth/session'

/**
 * El ciclo de vida de un ajuste de precio contra Postgres.
 *
 * Reproduce el caso real del tabulador de HONOR: Ronny en espejo vale $195,000
 * en el tarifario y se cotizó a $150,000. Lo que se comprueba es que ese
 * ajuste se guarda SIN tocar el tarifario, que se puede revertir, y que dos
 * pestañas no se pisan.
 */

let sesionActual: DatosSesion | null = null

vi.mock('@/server/auth/session', () => ({
  leerSesion: async () => sesionActual,
  contextoPeticion: async () => ({ ip: '203.0.113.9', userAgent: 'prueba' }),
}))

const {
  crearCotizacion, leerEditor, guardarPrecio, renombrarTalento,
  medirAjustes, ConflictoRevisionError,
} = await import('@/server/data/cotizacion')
const { claveCelda, precioEfectivo, tieneAjuste } = await import('@/lib/editor/tipos')
const { ForbiddenError } = await import('@/lib/authz/policy')

const prisma = new PrismaClient()
const EMAIL_ADMIN = 'editor-admin@katana.local'
const EMAIL_LECTURA = 'editor-lectura@katana.local'
const CLIENTE = 'PRUEBA EDITOR SA'
const CORREOS = [EMAIL_ADMIN, EMAIL_LECTURA]

const admin: Actor = {
  id: '', nombre: 'Chuy Prueba', email: EMAIL_ADMIN,
  rol: 'ADMIN', estado: 'ACTIVO', esAprobador: true,
}
const lectura: Actor = {
  id: '', nombre: 'Ana Lectura', email: EMAIL_LECTURA,
  rol: 'LECTURA', estado: 'ACTIVO', esAprobador: false,
}

function entrarComo(a: Actor | null) {
  sesionActual = a
    ? { actor: a, sesionId: 'sesion-prueba', debeCambiarPassword: false }
    : null
}

let quoteId: string
let talentRonnyId: string
let talentMarielId: string
let dtEspejoId: string
let dtTikTokId: string

async function limpiar() {
  await prisma.$executeRaw`ALTER TABLE "Bitacora" DISABLE TRIGGER bitacora_inmutable`
  await prisma.bitacora.deleteMany({ where: { actorEmail: { in: CORREOS } } })
  await prisma.$executeRaw`ALTER TABLE "Bitacora" ENABLE TRIGGER bitacora_inmutable`
  await prisma.quote.deleteMany({ where: { client: { displayName: CLIENTE } } })
  await prisma.client.deleteMany({ where: { displayName: CLIENTE } })
  await prisma.talent.deleteMany({ where: { slug: { startsWith: 'prueba-editor-' } } })
  await prisma.usuario.deleteMany({ where: { email: { in: CORREOS } } })
}

beforeAll(async () => {
  await prisma.$connect()
  await limpiar()

  const hash = await hashPassword('una frase larga de prueba')
  admin.id = (
    await prisma.usuario.create({
      data: {
        email: EMAIL_ADMIN, nombre: admin.nombre, rol: 'ADMIN',
        estado: 'ACTIVO', esAprobador: true, passwordHash: hash,
      },
    })
  ).id
  lectura.id = (
    await prisma.usuario.create({
      data: {
        email: EMAIL_LECTURA, nombre: lectura.nombre, rol: 'LECTURA',
        estado: 'ACTIVO', passwordHash: hash,
      },
    })
  ).id

  // Los formatos vienen del seed; se usan los reales.
  const espejo = await prisma.deliverableType.findUniqueOrThrow({
    where: { code: 'TIKTOK_REEL_MIRROR' },
  })
  const tiktok = await prisma.deliverableType.findUniqueOrThrow({
    where: { code: 'TIKTOK' },
  })
  dtEspejoId = espejo.id
  dtTikTokId = tiktok.id

  const ronny = await prisma.talent.create({
    data: {
      canonicalName: 'Ronaldo BXM', displayName: 'Ronny',
      slug: 'prueba-editor-ronny',
      rates: {
        create: [
          // $195,000 — el precio de lista que el PDF de HONOR NO respeta.
          { deliverableTypeId: dtEspejoId, amountCents: 19_500_000, priceStatus: 'QUOTED' },
          { deliverableTypeId: dtTikTokId, amountCents: 9_000_000, priceStatus: 'QUOTED' },
        ],
      },
    },
  })
  const mariel = await prisma.talent.create({
    data: {
      canonicalName: 'Mariel Estrella', displayName: 'Mariel Estrella',
      slug: 'prueba-editor-mariel',
      rates: {
        // Sin precio: es el caso en que la agencia pone cifra directo en el
        // documento.
        create: [{ deliverableTypeId: dtEspejoId, priceStatus: 'PENDING' }],
      },
    },
  })
  talentRonnyId = ronny.id
  talentMarielId = mariel.id

  entrarComo(admin)
  quoteId = await crearCotizacion({
    clienteNombre: CLIENTE,
    contactoNombre: 'Fer Nicolini',
    talentIds: [talentMarielId, talentRonnyId],
    formatoIds: [dtTikTokId, dtEspejoId],
  })
}, 180_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('al crear la cotización', () => {
  it('copia el tarifario del momento como precio base', async () => {
    entrarComo(admin)
    const e = (await leerEditor(quoteId))!
    expect(e).not.toBeNull()

    const ronnyQt = e.talentos.find((t) => t.talentId === talentRonnyId)!
    const c = e.celdas[claveCelda(ronnyQt.id, dtEspejoId)]!
    expect(c.baseAmountCents).toBe(19_500_000)
    expect(c.basePriceStatus).toBe('QUOTED')
    expect(c.overridePriceStatus).toBeNull()
  })

  it('crea una celda por cada cruce, incluso sin tarifa', async () => {
    entrarComo(admin)
    const e = (await leerEditor(quoteId))!
    // 2 talentos × 2 formatos. Mariel no tiene tarifa de TikTok y aun así hay
    // celda: sin ella no habría dónde escribir el ajuste.
    expect(Object.keys(e.celdas)).toHaveLength(4)

    const marielQt = e.talentos.find((t) => t.talentId === talentMarielId)!
    const sinTarifa = e.celdas[claveCelda(marielQt.id, dtTikTokId)]!
    expect(sinTarifa.baseAmountCents).toBeNull()
    expect(sinTarifa.basePriceStatus).toBe('PENDING')
  })

  it('respeta el orden de columnas que se pidió, no el del catálogo', async () => {
    entrarComo(admin)
    const e = (await leerEditor(quoteId))!
    expect(e.columnas.map((c) => c.deliverableTypeId)).toEqual([dtTikTokId, dtEspejoId])
  })

  it('no acuña folio: un borrador no quema consecutivo', async () => {
    entrarComo(admin)
    const e = (await leerEditor(quoteId))!
    expect(e.folio).toBeNull()
    expect(e.draftRef).toMatch(/^BORRADOR-[A-Z2-9]{4}$/)
  })

  it('copia las consideraciones y los términos de la plantilla', async () => {
    entrarComo(admin)
    const e = (await leerEditor(quoteId))!
    expect(e.consideraciones.length).toBeGreaterThan(0)
    expect(e.terminos.length).toBeGreaterThan(0)
    const enBase = await prisma.quoteConsideration.count({ where: { quoteId } })
    // Se copian a la cotización, no se leen de la plantilla: así se pueden
    // editar por documento sin cambiárselos a todos.
    expect(enBase).toBe(e.consideraciones.length)
  })
})

describe('ajustar un precio', () => {
  it('guarda el ajuste SIN tocar el tarifario maestro', async () => {
    entrarComo(admin)
    const antes = (await leerEditor(quoteId))!
    const ronnyQt = antes.talentos.find((t) => t.talentId === talentRonnyId)!
    const clave = claveCelda(ronnyQt.id, dtEspejoId)

    const r = await guardarPrecio({
      quoteId,
      quotePriceId: antes.celdas[clave]!.id,
      revision: antes.revision,
      amountCents: 15_000_000, // $150,000, como en el PDF real
      status: 'QUOTED',
    })

    expect(r.revision).toBe(antes.revision + 1)
    expect(r.celda.overrideAmountCents).toBe(15_000_000)
    expect(r.celda.baseAmountCents).toBe(19_500_000)
    expect(precioEfectivo(r.celda).amountCents).toBe(15_000_000)
    expect(tieneAjuste(r.celda)).toBe(true)

    // Bajarle el precio a HONOR no se lo baja a todos los demás clientes.
    const tarifa = await prisma.talentRate.findFirstOrThrow({
      where: { talentId: talentRonnyId, deliverableTypeId: dtEspejoId },
    })
    expect(tarifa.amountCents).toBe(19_500_000)
  })

  it('deja en la bitácora de dónde a dónde fue', async () => {
    const e = await prisma.bitacora.findFirst({
      where: { accion: 'precio.ajustado', actorEmail: EMAIL_ADMIN },
      orderBy: { ocurridoEn: 'desc' },
    })
    expect(e).not.toBeNull()
    expect(e!.resumen).toContain('de $195,000 a $150,000')
    expect(e!.entidadEtiqueta).toContain('Ronny')
  })

  it('los tecleos seguidos se agrupan en un solo apunte', async () => {
    entrarComo(admin)
    let estado = (await leerEditor(quoteId))!
    const ronnyQt = estado.talentos.find((t) => t.talentId === talentRonnyId)!
    const clave = claveCelda(ronnyQt.id, dtEspejoId)
    const quotePriceId = estado.celdas[clave]!.id

    const antes = await prisma.bitacora.count({
      where: { accion: 'precio.ajustado', entidadId: quotePriceId },
    })

    for (const monto of [16_000_000, 15_500_000, 15_000_000]) {
      const r = await guardarPrecio({
        quoteId, quotePriceId, revision: estado.revision,
        amountCents: monto, status: 'QUOTED',
      })
      estado = { ...estado, revision: r.revision }
    }

    const despues = await prisma.bitacora.count({
      where: { accion: 'precio.ajustado', entidadId: quotePriceId },
    })
    expect(despues).toBe(antes) // se actualizó el mismo apunte, no se añadieron 3

    const evento = await prisma.bitacora.findFirstOrThrow({
      where: { accion: 'precio.ajustado', entidadId: quotePriceId },
      orderBy: { ocurridoEn: 'desc' },
    })
    const cambios = evento.cambios as { precio: { antes: string; despues: string } }
    // Del primer valor de la ventana al último.
    expect(cambios.precio.antes).toBe('$195,000')
    expect(cambios.precio.despues).toBe('$150,000')
  })

  it('poner cifra sobre un "Pendiente" es un solo gesto', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    const marielQt = estado.talentos.find((t) => t.talentId === talentMarielId)!
    const clave = claveCelda(marielQt.id, dtEspejoId)

    const r = await guardarPrecio({
      quoteId, quotePriceId: estado.celdas[clave]!.id,
      revision: estado.revision, amountCents: 15_000_000, status: 'QUOTED',
    })
    expect(r.celda.basePriceStatus).toBe('PENDING')
    expect(precioEfectivo(r.celda).status).toBe('QUOTED')
    expect(precioEfectivo(r.celda).amountCents).toBe(15_000_000)
  })

  it('se puede revertir al tarifario', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    const ronnyQt = estado.talentos.find((t) => t.talentId === talentRonnyId)!
    const clave = claveCelda(ronnyQt.id, dtEspejoId)

    const r = await guardarPrecio({
      quoteId, quotePriceId: estado.celdas[clave]!.id,
      revision: estado.revision, amountCents: null, status: null,
    })
    expect(r.celda.overridePriceStatus).toBeNull()
    expect(r.celda.overrideAmountCents).toBeNull()
    expect(precioEfectivo(r.celda).amountCents).toBe(19_500_000)
    expect(tieneAjuste(r.celda)).toBe(false)

    const e = await prisma.bitacora.findFirstOrThrow({
      where: { accion: 'precio.ajuste_revertido' },
      orderBy: { ocurridoEn: 'desc' },
    })
    expect(e.resumen).toContain('vuelve al tarifario')
  })

  it('un estado sin importe deja el importe en NULL, no en cero', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    const marielQt = estado.talentos.find((t) => t.talentId === talentMarielId)!
    const clave = claveCelda(marielQt.id, dtTikTokId)

    const r = await guardarPrecio({
      quoteId, quotePriceId: estado.celdas[clave]!.id,
      revision: estado.revision, amountCents: 9_900_000, status: 'CASE_BY_CASE',
    })
    // Un cero se imprimiría como "$0" y se leería como "gratis".
    expect(r.celda.overrideAmountCents).toBeNull()
    expect(r.celda.overridePriceStatus).toBe('CASE_BY_CASE')
  })
})

describe('dos pestañas a la vez', () => {
  it('la segunda recibe conflicto en vez de pisar a la primera', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    const ronnyQt = estado.talentos.find((t) => t.talentId === talentRonnyId)!
    const clave = claveCelda(ronnyQt.id, dtTikTokId)
    const quotePriceId = estado.celdas[clave]!.id
    const revisionCompartida = estado.revision

    // Pestaña A guarda.
    const a = await guardarPrecio({
      quoteId, quotePriceId, revision: revisionCompartida,
      amountCents: 8_000_000, status: 'QUOTED',
    })
    expect(a.revision).toBe(revisionCompartida + 1)

    // Pestaña B todavía cree tener la revisión vieja.
    await expect(
      guardarPrecio({
        quoteId, quotePriceId, revision: revisionCompartida,
        amountCents: 7_000_000, status: 'QUOTED',
      }),
    ).rejects.toBeInstanceOf(ConflictoRevisionError)

    // Y lo de A sigue en pie: no se perdió nada.
    const final = (await leerEditor(quoteId))!
    expect(final.celdas[clave]!.overrideAmountCents).toBe(8_000_000)
  })

  it('el conflicto dice quién guardó, para poder preguntarle', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    const ronnyQt = estado.talentos.find((t) => t.talentId === talentRonnyId)!
    const quotePriceId = estado.celdas[claveCelda(ronnyQt.id, dtTikTokId)]!.id

    try {
      await guardarPrecio({
        quoteId, quotePriceId, revision: estado.revision - 1,
        amountCents: 100, status: 'QUOTED',
      })
      expect.unreachable('debió lanzar')
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictoRevisionError)
      expect((e as Error).message).toContain('Chuy Prueba')
    }
  })
})

describe('permisos', () => {
  it('un rol LECTURA puede ver pero no guardar', async () => {
    entrarComo(lectura)
    const estado = await leerEditor(quoteId)
    expect(estado).not.toBeNull()

    const ronnyQt = estado!.talentos.find((t) => t.talentId === talentRonnyId)!
    await expect(
      guardarPrecio({
        quoteId,
        quotePriceId: estado!.celdas[claveCelda(ronnyQt.id, dtEspejoId)]!.id,
        revision: estado!.revision,
        amountCents: 1, status: 'QUOTED',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('el intento denegado queda en la bitácora', async () => {
    const e = await prisma.bitacora.findFirst({
      where: { actorEmail: EMAIL_LECTURA, accion: { startsWith: 'permiso.denegado' } },
      orderBy: { ocurridoEn: 'desc' },
    })
    expect(e).not.toBeNull()
    expect(e!.exito).toBe(false)
  })

  it('una celda de otra cotización se rechaza', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    await expect(
      guardarPrecio({
        quoteId, quotePriceId: 'no-existe', revision: estado.revision,
        amountCents: 1, status: 'QUOTED',
      }),
    ).rejects.toThrow(/no pertenece|ya no existe/)
  })
})

describe('nombre impreso del talento', () => {
  it('se puede acortar sin tocar la ficha', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    const marielQt = estado.talentos.find((t) => t.talentId === talentMarielId)!

    const r = await renombrarTalento(quoteId, marielQt.id, 'Mariel', estado.revision)
    expect(r.nombre).toBe('Mariel')

    const despues = (await leerEditor(quoteId))!
    expect(despues.talentos.find((t) => t.id === marielQt.id)!.nombre).toBe('Mariel')

    // La ficha del talento no cambió.
    const ficha = await prisma.talent.findUniqueOrThrow({ where: { id: talentMarielId } })
    expect(ficha.displayName).toBe('Mariel Estrella')
  })
})

describe('cuánto se apartó del tarifario', () => {
  it('cuenta las celdas ajustadas y el mayor descuento', async () => {
    entrarComo(admin)
    const estado = (await leerEditor(quoteId))!
    const m = medirAjustes(estado)
    expect(m.totales).toBe(4)
    expect(m.ajustadas).toBeGreaterThan(0)
    // Ronny × TikTok: de $90,000 a $80,000 = 11.11 %.
    expect(m.maxDescuentoBps).toBe(1111)
  })
})
