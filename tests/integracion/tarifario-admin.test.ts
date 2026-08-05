import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '@/server/auth/password'
import type { Actor } from '@/lib/authz/policy'
import type { DatosSesion } from '@/server/auth/session'

/**
 * Tarifario maestro y administración de usuarios.
 *
 * Lo que se comprueba: que editar el tarifario deja rastro y marca la tarifa
 * como tocada a mano —para que un Excel viejo no la pise—, y que la
 * administración no permite dejar el sistema sin administradores.
 */

let sesionActual: DatosSesion | null = null
const revocadas: Array<{ usuarioId: string; motivo: string }> = []

vi.mock('@/server/auth/session', () => ({
  leerSesion: async () => sesionActual,
  contextoPeticion: async () => ({ ip: '203.0.113.11', userAgent: 'prueba' }),
  revocarSesionesDe: async (usuarioId: string, motivo: string) => {
    revocadas.push({ usuarioId, motivo })
    return 1
  },
}))

const { leerTarifario, guardarTarifa, ConflictoTarifaError } =
  await import('@/server/data/tarifario')
const {
  listarUsuarios, crearUsuario, actualizarUsuario, reiniciarPassword, leerBitacora,
} = await import('@/server/data/admin')
const { ForbiddenError } = await import('@/lib/authz/policy')

const prisma = new PrismaClient()
const CORREOS = [
  'tar-admin@katana.local', 'tar-comercial@katana.local',
  'tar-lectura@katana.local', 'tar-nuevo@katana.local',
]

const admin: Actor = {
  id: '', nombre: 'Chuy Admin', email: CORREOS[0]!,
  rol: 'ADMIN', estado: 'ACTIVO', esAprobador: true,
}
const comercial: Actor = {
  id: '', nombre: 'Beto Comercial', email: CORREOS[1]!,
  rol: 'COMERCIAL', estado: 'ACTIVO', esAprobador: false,
}
const lectura: Actor = {
  id: '', nombre: 'Ana Lectura', email: CORREOS[2]!,
  rol: 'LECTURA', estado: 'ACTIVO', esAprobador: false,
}

function entrarComo(a: Actor | null) {
  sesionActual = a
    ? { actor: a, sesionId: 'sesion-prueba', debeCambiarPassword: false }
    : null
}

let talentId: string
let dtEspejoId: string

async function limpiar() {
  await prisma.$executeRaw`ALTER TABLE "Bitacora" DISABLE TRIGGER bitacora_inmutable`
  await prisma.bitacora.deleteMany({ where: { actorEmail: { in: CORREOS } } })
  await prisma.$executeRaw`ALTER TABLE "Bitacora" ENABLE TRIGGER bitacora_inmutable`
  await prisma.$executeRaw`ALTER TABLE "TalentRateRevision" DISABLE TRIGGER rate_revision_inmutable`
  await prisma.talentRateRevision.deleteMany({
    where: { talent: { slug: { startsWith: 'prueba-tar-' } } },
  })
  await prisma.$executeRaw`ALTER TABLE "TalentRateRevision" ENABLE TRIGGER rate_revision_inmutable`
  await prisma.talent.deleteMany({ where: { slug: { startsWith: 'prueba-tar-' } } })
  await prisma.usuario.deleteMany({ where: { email: { in: CORREOS } } })
}

beforeAll(async () => {
  await prisma.$connect()
  await limpiar()

  const hash = await hashPassword('una frase larga de prueba')
  for (const a of [admin, comercial, lectura]) {
    a.id = (
      await prisma.usuario.create({
        data: {
          email: a.email, nombre: a.nombre, rol: a.rol, estado: 'ACTIVO',
          esAprobador: a.esAprobador, passwordHash: hash,
        },
      })
    ).id
  }

  dtEspejoId = (
    await prisma.deliverableType.findUniqueOrThrow({
      where: { code: 'TIKTOK_REEL_MIRROR' },
    })
  ).id

  talentId = (
    await prisma.talent.create({
      data: {
        canonicalName: 'Prueba Tarifario', displayName: 'Prueba Tarifario',
        slug: 'prueba-tar-uno',
        rateNotes: 'Paquete de 3 videos con 10% de descuento, a convenir por temporada.',
      },
    })
  ).id
}, 180_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('tarifario maestro', () => {
  it('crea la tarifa cuando la fila todavía no existe', async () => {
    entrarComo(admin)
    const celda = await guardarTarifa({
      talentId, deliverableTypeId: dtEspejoId,
      amountCents: 19_500_000, priceStatus: 'QUOTED', revision: null,
    })
    expect(celda.amountCents).toBe(19_500_000)
    expect(celda.editadaAMano).toBe(true)
  })

  it('marca la tarifa como tocada a mano, que es lo que la protege de un Excel viejo', async () => {
    const r = await prisma.talentRate.findFirstOrThrow({
      where: { talentId, deliverableTypeId: dtEspejoId },
    })
    expect(r.manuallyEditedAt).not.toBeNull()
    expect(r.lastChangeSource).toBe('MANUAL')
  })

  it('guarda una revisión con el antes y el después', async () => {
    entrarComo(admin)
    await guardarTarifa({
      talentId, deliverableTypeId: dtEspejoId,
      amountCents: 21_000_000, priceStatus: 'QUOTED',
      revision: (await prisma.talentRate.findFirstOrThrow({
        where: { talentId, deliverableTypeId: dtEspejoId },
      })).revision,
    })

    const revisiones = await prisma.talentRateRevision.findMany({
      where: { talentId, deliverableTypeId: dtEspejoId },
      orderBy: { creadoEn: 'asc' },
    })
    expect(revisiones).toHaveLength(2)
    expect(revisiones[0]!.beforeAmountCents).toBeNull()
    expect(revisiones[0]!.afterAmountCents).toBe(19_500_000)
    expect(revisiones[1]!.beforeAmountCents).toBe(19_500_000)
    expect(revisiones[1]!.afterAmountCents).toBe(21_000_000)
  })

  it('las revisiones son inmutables', async () => {
    const r = await prisma.talentRateRevision.findFirstOrThrow({
      where: { talentId },
    })
    await expect(
      prisma.talentRateRevision.delete({ where: { id: r.id } }),
    ).rejects.toThrow()
  })

  it('un estado sin importe deja el importe en NULL', async () => {
    entrarComo(admin)
    const actual = await prisma.talentRate.findFirstOrThrow({
      where: { talentId, deliverableTypeId: dtEspejoId },
    })
    const celda = await guardarTarifa({
      talentId, deliverableTypeId: dtEspejoId,
      amountCents: 9_900_000, priceStatus: 'CASE_BY_CASE',
      revision: actual.revision,
    })
    expect(celda.amountCents).toBeNull()
    expect(celda.priceStatus).toBe('CASE_BY_CASE')
  })

  it('rechaza un precio cotizado sin importe', async () => {
    entrarComo(admin)
    await expect(
      guardarTarifa({
        talentId, deliverableTypeId: dtEspejoId,
        amountCents: null, priceStatus: 'QUOTED', revision: null,
      }),
    ).rejects.toThrow(/necesita un importe/)
  })

  it('dos pestañas no se pisan', async () => {
    entrarComo(admin)
    const actual = await prisma.talentRate.findFirstOrThrow({
      where: { talentId, deliverableTypeId: dtEspejoId },
    })
    await expect(
      guardarTarifa({
        talentId, deliverableTypeId: dtEspejoId,
        amountCents: 100, priceStatus: 'QUOTED', revision: actual.revision - 1,
      }),
    ).rejects.toBeInstanceOf(ConflictoTarifaError)
  })

  it('un rol LECTURA ve el tarifario pero no lo edita', async () => {
    entrarComo(lectura)
    const t = await leerTarifario()
    expect(t.filas.length).toBeGreaterThan(0)
    await expect(
      guardarTarifa({
        talentId, deliverableTypeId: dtEspejoId,
        amountCents: 1, priceStatus: 'QUOTED', revision: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('la nota en prosa se devuelve íntegra, sin interpretar', async () => {
    entrarComo(admin)
    const t = await leerTarifario()
    const fila = t.filas.find((f) => f.talentId === talentId)!
    expect(fila.notas).toBe(
      'Paquete de 3 videos con 10% de descuento, a convenir por temporada.',
    )
  })
})

describe('administración de usuarios', () => {
  it('un comercial no puede administrar', async () => {
    entrarComo(comercial)
    await expect(listarUsuarios()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('el alta obliga a cambiar la contraseña en el primer acceso', async () => {
    entrarComo(admin)
    const u = await crearUsuario({
      email: CORREOS[3]!, nombre: 'Nuevo Comercial', rol: 'COMERCIAL',
      esAprobador: false, passwordInicial: 'una frase inicial larga',
    })
    const fila = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } })
    expect(fila.debeCambiarPassword).toBe(true)
  }, 60_000)

  it('rechaza una contraseña inicial que contenga el nombre del sistema', async () => {
    entrarComo(admin)
    await expect(
      crearUsuario({
        email: 'otro-tar@katana.local', nombre: 'Otro', rol: 'LECTURA',
        esAprobador: false, passwordInicial: 'katanatalent2026',
      }),
    ).rejects.toThrow(/katana/)
  })

  it('bajar un rol revoca las sesiones abiertas', async () => {
    entrarComo(admin)
    const nuevo = await prisma.usuario.findUniqueOrThrow({ where: { email: CORREOS[3]! } })
    revocadas.length = 0

    const r = await actualizarUsuario({ usuarioId: nuevo.id, rol: 'LECTURA' })
    expect(r.revocadas).toBe(1)
    expect(revocadas[0]?.motivo).toContain('rol')

    // Si alguien pasa de Comercial a Lectura, sus pestañas abiertas no pueden
    // seguir editando hasta que se le ocurra recargar.
    const evento = await prisma.bitacora.findFirstOrThrow({
      where: { accion: 'usuario.modificado' },
      orderBy: { ocurridoEn: 'desc' },
    })
    expect(evento.resumen).toContain('de Comercial a Solo lectura')
  })

  it('no deja el sistema sin ningún administrador activo', async () => {
    entrarComo(admin)
    // Sólo hay un ADMIN de prueba, pero el seed crea otro. Se suspenden todos
    // los demás para llegar al caso real.
    const otros = await prisma.usuario.findMany({
      where: { rol: 'ADMIN', estado: 'ACTIVO', id: { not: admin.id } },
    })
    await prisma.usuario.updateMany({
      where: { id: { in: otros.map((o) => o.id) } },
      data: { estado: 'SUSPENDIDO' },
    })

    try {
      await expect(
        actualizarUsuario({ usuarioId: admin.id, rol: 'LECTURA' }),
      ).rejects.toThrow(/único administrador activo/)

      await expect(
        actualizarUsuario({ usuarioId: admin.id, estado: 'SUSPENDIDO' }),
      ).rejects.toThrow(/único administrador activo/)
    } finally {
      await prisma.usuario.updateMany({
        where: { id: { in: otros.map((o) => o.id) } },
        data: { estado: 'ACTIVO' },
      })
    }
  })

  it('reiniciar la contraseña cierra las sesiones y obliga a elegir otra', async () => {
    entrarComo(admin)
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: CORREOS[3]! } })
    revocadas.length = 0

    const r = await reiniciarPassword(u.id, 'otra frase larga distinta')
    expect(r.revocadas).toBe(1)

    const despues = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } })
    expect(despues.debeCambiarPassword).toBe(true)
    expect(despues.bloqueadoHasta).toBeNull()
  }, 60_000)
})

describe('bitácora', () => {
  it('filtra por categoría y encuentra por texto', async () => {
    entrarComo(admin)
    const porCategoria = await leerBitacora({ categoria: 'TARIFARIO' })
    expect(porCategoria.eventos.length).toBeGreaterThan(0)
    expect(porCategoria.eventos.every((e) => e.categoria === 'TARIFARIO')).toBe(true)

    const porTexto = await leerBitacora({ texto: 'Prueba Tarifario' })
    expect(porTexto.eventos.length).toBeGreaterThan(0)
  })

  it('un rol LECTURA no la puede consultar', async () => {
    entrarComo(lectura)
    await expect(leerBitacora()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('un comercial sí', async () => {
    entrarComo(comercial)
    await expect(leerBitacora({ limite: 5 })).resolves.toBeTruthy()
  })
})
