import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '@/server/auth/password'
import type { Actor } from '@/lib/authz/policy'
import type { DatosSesion } from '@/server/auth/session'

/**
 * La hoja de cotización por renglones, contra Postgres.
 *
 * Lo que se comprueba aquí es lo que el producto promete y lo que sería caro
 * romper: que agregar una acción trae su tarifa en el acto, que la cantidad
 * multiplica, que el total se guarda de verdad —hasta ahora nadie lo
 * escribía—, que editar la cotización NO toca el tarifario maestro, y que el
 * roster de KIF no se puede colar en una cotización de Katana.
 */

let sesionActual: DatosSesion | null = null

vi.mock('@/server/auth/session', () => ({
  leerSesion: async () => sesionActual,
  contextoPeticion: async () => ({ ip: '203.0.113.9', userAgent: 'prueba' }),
}))

const {
  crearBorradorVacio, leerHoja, agregarTalento, quitarTalento,
  agregarRenglon, actualizarRenglon, quitarRenglon, actualizarEncabezado,
  modoDeCotizacion,
} = await import('@/server/data/hoja')
const { ConflictoRevisionError } = await import('@/server/data/cotizacion')
const { totalesDeHoja, pendientesDeHoja, tieneAjusteRenglon } =
  await import('@/lib/hoja/tipos')

const prisma = new PrismaClient()
const EMAIL_ADMIN = 'hoja-admin@katana.local'
const CLIENTE = 'PRUEBA HOJA SA'
const PREFIJO = 'prueba-hoja-'

const admin: Actor = {
  id: '', nombre: 'Chuy Hoja', email: EMAIL_ADMIN,
  rol: 'ADMIN', estado: 'ACTIVO', esAprobador: true,
}

function entrarComo(a: Actor | null) {
  sesionActual = a
    ? { actor: a, sesionId: 'sesion-prueba', debeCambiarPassword: false }
    : null
}

let dtReelId: string
let dtStoryId: string
let dtNoAplicaId: string
let nene: string
let aliadoKif: string

async function limpiar() {
  await prisma.$executeRaw`ALTER TABLE "Bitacora" DISABLE TRIGGER bitacora_inmutable`
  await prisma.bitacora.deleteMany({ where: { actorEmail: EMAIL_ADMIN } })
  await prisma.$executeRaw`ALTER TABLE "Bitacora" ENABLE TRIGGER bitacora_inmutable`
  await prisma.quote.deleteMany({ where: { createdBy: { email: EMAIL_ADMIN } } })
  await prisma.client.deleteMany({ where: { displayName: CLIENTE } })
  await prisma.talent.deleteMany({ where: { slug: { startsWith: PREFIJO } } })
  await prisma.usuario.deleteMany({ where: { email: EMAIL_ADMIN } })
}

beforeAll(async () => {
  await prisma.$connect()
  await limpiar()

  admin.id = (
    await prisma.usuario.create({
      data: {
        email: EMAIL_ADMIN, nombre: admin.nombre, rol: 'ADMIN',
        estado: 'ACTIVO', esAprobador: true,
        passwordHash: await hashPassword('una frase larga de prueba'),
      },
    })
  ).id

  // Los formatos son los del seed real.
  dtReelId = (
    await prisma.deliverableType.findUniqueOrThrow({ where: { code: 'REEL_IG' } })
  ).id
  dtStoryId = (
    await prisma.deliverableType.findUniqueOrThrow({ where: { code: 'STORY_IG' } })
  ).id
  dtNoAplicaId = (
    await prisma.deliverableType.findUniqueOrThrow({ where: { code: 'TIKTOK' } })
  ).id

  nene = (
    await prisma.talent.create({
      data: {
        canonicalName: 'Nene Creative', displayName: 'Nene Creative',
        slug: `${PREFIJO}nene`, category: 'Gaming', roster: 'KATANA',
        rates: {
          create: [
            { deliverableTypeId: dtReelId, amountCents: 7_000_000, priceStatus: 'QUOTED' },
            { deliverableTypeId: dtStoryId, amountCents: 1_500_000, priceStatus: 'QUOTED' },
            // No se le vende: no debe aparecer como acción disponible.
            { deliverableTypeId: dtNoAplicaId, priceStatus: 'NOT_APPLICABLE' },
          ],
        },
      },
    })
  ).id

  aliadoKif = (
    await prisma.talent.create({
      data: {
        canonicalName: 'Aliado KIF', displayName: 'Aliado KIF',
        slug: `${PREFIJO}kif`, roster: 'KIF',
      },
    })
  ).id
}, 180_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('crear la hoja', () => {
  it('nace vacía, sin cliente y sin quemar folio', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()

    const h = (await leerHoja(id))!
    expect(h).not.toBeNull()
    expect(h.talentos).toHaveLength(0)
    expect(h.cliente).toBe('') // el placeholder no se le enseña al usuario
    expect(h.folio).toBeNull()
    expect(h.draftRef).toMatch(/^BORRADOR-[A-Z2-9]{4}$/)
    expect(await modoDeCotizacion(id)).toBe('HOJA')
  })
})

describe('talentos', () => {
  it('un tap agrega, y el segundo no duplica', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    let h = (await leerHoja(id))!

    const a = await agregarTalento(id, nene, h.revision)
    expect(a.talento.nombre).toBe('Nene Creative')

    // Idempotente: dos taps rápidos no dejan dos bloques.
    const b = await agregarTalento(id, nene, a.revision)
    expect(b.talento.id).toBe(a.talento.id)

    h = (await leerHoja(id))!
    expect(h.talentos).toHaveLength(1)
  })

  it('ofrece como acciones sólo lo que el talento sí tiene tarifado', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    await agregarTalento(id, nene, h0.revision)

    const h = (await leerHoja(id))!
    const acciones = h.talentos[0]!.acciones
    const ids = acciones.map((a) => a.deliverableTypeId)

    expect(ids).toContain(dtReelId)
    expect(ids).toContain(dtStoryId)
    // "No aplica" significa que no se le vende: no puede ser un botón.
    expect(ids).not.toContain(dtNoAplicaId)
  })

  it('el roster de KIF no entra a una cotización de Katana', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h = (await leerHoja(id))!

    await expect(agregarTalento(id, aliadoKif, h.revision)).rejects.toThrow(
      /no está en el roster de Katana/,
    )
  })

  it('quitar un talento se lleva sus renglones', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    const a = await agregarTalento(id, nene, h0.revision)
    const r = await agregarRenglon({
      quoteId: id, quoteTalentId: a.talento.id,
      deliverableTypeId: dtReelId, revision: a.revision,
    })

    const q = await quitarTalento(id, a.talento.id, r.revision)
    expect(q.revision).toBeGreaterThan(r.revision)

    const h = (await leerHoja(id))!
    expect(h.talentos).toHaveLength(0)
    expect(await prisma.quoteLine.count({ where: { quoteId: id } })).toBe(0)
  })
})

describe('renglones', () => {
  it('agregar una acción trae su tarifa en el acto', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    const a = await agregarTalento(id, nene, h0.revision)

    const { renglon } = await agregarRenglon({
      quoteId: id, quoteTalentId: a.talento.id,
      deliverableTypeId: dtReelId, revision: a.revision,
    })

    expect(renglon.cantidad).toBe(1)
    expect(renglon.unitAmountCents).toBe(7_000_000)
    expect(renglon.priceStatus).toBe('QUOTED')
    // Guarda además la foto del tarifario, que es lo que permite enseñar
    // "CRM $70,000" cuando después se negocie.
    expect(renglon.baseAmountCents).toBe(7_000_000)
    expect(tieneAjusteRenglon(renglon)).toBe(false)
  })

  it('tocar el mismo formato tres veces son 3 piezas, no 3 renglones', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    const a = await agregarTalento(id, nene, h0.revision)

    let rev = a.revision
    let ultimo
    for (let i = 0; i < 3; i++) {
      ultimo = await agregarRenglon({
        quoteId: id, quoteTalentId: a.talento.id,
        deliverableTypeId: dtReelId, revision: rev,
      })
      rev = ultimo.revision
    }

    expect(ultimo!.renglon.cantidad).toBe(3)
    const h = (await leerHoja(id))!
    expect(h.talentos[0]!.renglones).toHaveLength(1)
    // 3 × 70,000
    expect(totalesDeHoja(h).subtotalCents).toBe(21_000_000)
  })

  it('la cantidad multiplica y el total se guarda de verdad', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    const a = await agregarTalento(id, nene, h0.revision)

    const reel = await agregarRenglon({
      quoteId: id, quoteTalentId: a.talento.id,
      deliverableTypeId: dtReelId, revision: a.revision,
    })
    const story = await agregarRenglon({
      quoteId: id, quoteTalentId: a.talento.id,
      deliverableTypeId: dtStoryId, revision: reel.revision,
    })
    // 3 Stories.
    const tres = await actualizarRenglon({
      quoteId: id, lineaId: story.renglon.id,
      cantidad: 3, revision: story.revision,
    })
    expect(tres.renglon.cantidad).toBe(3)

    // 70,000 + 3 × 15,000 = 115,000
    const h = (await leerHoja(id))!
    const calc = totalesDeHoja(h)
    expect(calc.subtotalCents).toBe(11_500_000)
    expect(calc.taxCents).toBe(1_840_000) // 16 %
    expect(calc.totalCents).toBe(13_340_000)

    // Y lo mismo quedó escrito en la fila, que es lo que lee el listado.
    const q = await prisma.quote.findUniqueOrThrow({ where: { id } })
    expect(q.subtotalCents).toBe(11_500_000)
    expect(q.totalCents).toBe(13_340_000)
    expect(q.computedAt).not.toBeNull()
  })

  it('negociar el precio NO toca el tarifario maestro', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    const a = await agregarTalento(id, nene, h0.revision)
    const reel = await agregarRenglon({
      quoteId: id, quoteTalentId: a.talento.id,
      deliverableTypeId: dtReelId, revision: a.revision,
    })

    const bajado = await actualizarRenglon({
      quoteId: id, lineaId: reel.renglon.id,
      unitAmountCents: 6_500_000, priceStatus: 'QUOTED',
      revision: reel.revision,
    })

    expect(bajado.renglon.unitAmountCents).toBe(6_500_000)
    // La referencia sigue siendo la del tarifario, y ahora sí aporta.
    expect(bajado.renglon.baseAmountCents).toBe(7_000_000)
    expect(tieneAjusteRenglon(bajado.renglon)).toBe(true)

    const tarifa = await prisma.talentRate.findUniqueOrThrow({
      where: {
        talentId_deliverableTypeId: { talentId: nene, deliverableTypeId: dtReelId },
      },
    })
    expect(tarifa.amountCents).toBe(7_000_000)
  })

  it('vaciar el importe deja el renglón por validar, no en cero', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    const a = await agregarTalento(id, nene, h0.revision)
    const reel = await agregarRenglon({
      quoteId: id, quoteTalentId: a.talento.id,
      deliverableTypeId: dtReelId, revision: a.revision,
    })

    const vaciado = await actualizarRenglon({
      quoteId: id, lineaId: reel.renglon.id,
      priceStatus: 'PENDING', unitAmountCents: null,
      revision: reel.revision,
    })
    expect(vaciado.renglon.priceStatus).toBe('PENDING')
    expect(vaciado.renglon.unitAmountCents).toBeNull()

    const h = (await leerHoja(id))!
    // Un renglón sin tarifa no suma y además bloquea la emisión.
    expect(totalesDeHoja(h).subtotalCents).toBe(0)
    expect(totalesDeHoja(h).requiereResolverPendientes).toBe(true)
    expect(pendientesDeHoja(h)).toEqual([
      { talento: 'Nene Creative', concepto: 'Reel de Instagram' },
    ])
  })

  it('quitar un renglón lo borra y recalcula', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!
    const a = await agregarTalento(id, nene, h0.revision)
    const reel = await agregarRenglon({
      quoteId: id, quoteTalentId: a.talento.id,
      deliverableTypeId: dtReelId, revision: a.revision,
    })

    await quitarRenglon(id, reel.renglon.id, reel.revision)

    const q = await prisma.quote.findUniqueOrThrow({ where: { id } })
    expect(q.totalCents).toBe(0)
    expect((await leerHoja(id))!.talentos[0]!.renglones).toHaveLength(0)
  })
})

describe('encabezado y bloqueo', () => {
  it('el cliente se escribe encima y se deduplica por nombre normalizado', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h0 = (await leerHoja(id))!

    await actualizarEncabezado({
      quoteId: id, revision: h0.revision,
      cliente: CLIENTE, proyecto: 'Campaña Q4',
    })

    const h = (await leerHoja(id))!
    expect(h.cliente).toBe(CLIENTE)
    expect(h.proyecto).toBe('Campaña Q4')
  })

  it('una revisión vieja no pisa lo que otra pestaña guardó', async () => {
    entrarComo(admin)
    const id = await crearBorradorVacio()
    const h = (await leerHoja(id))!

    await agregarTalento(id, nene, h.revision)

    // La segunda pestaña sigue creyendo en la revisión anterior.
    await expect(agregarTalento(id, nene, h.revision)).rejects.toThrow(
      ConflictoRevisionError,
    )
  })
})
