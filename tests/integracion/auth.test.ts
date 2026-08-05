import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { verificarLimite, registrarIntento, LIMITES } from '@/server/auth/rate-limit'
import { append } from '@/server/audit/append'
import type { Actor } from '@/lib/authz/policy'

/**
 * Autenticación y bitácora contra Postgres.
 *
 * Aquí se comprueba lo que no se puede probar con mocks: que el límite de
 * intentos bloquea de verdad, que la bitácora es de solo inserción, y que la
 * coalescencia agrupa los cambios sin perder el valor original.
 */

const prisma = new PrismaClient()
const EMAIL = 'prueba-auth@katana.local'

const actor: Actor = {
  id: '', nombre: 'Usuario de Prueba', email: EMAIL,
  rol: 'COMERCIAL', estado: 'ACTIVO', esAprobador: false,
}

async function limpiar() {
  await prisma.intentoAcceso.deleteMany({ where: { email: { contains: 'prueba-auth' } } })
  await prisma.$executeRaw`ALTER TABLE "Bitacora" DISABLE TRIGGER bitacora_inmutable`
  await prisma.bitacora.deleteMany({ where: { accion: { startsWith: 'prueba.' } } })
  await prisma.$executeRaw`ALTER TABLE "Bitacora" ENABLE TRIGGER bitacora_inmutable`
  await prisma.sesion.deleteMany({ where: { usuario: { email: EMAIL } } })
  await prisma.usuario.deleteMany({ where: { email: EMAIL } })
}

beforeAll(async () => {
  await prisma.$connect()
  await limpiar()
  const u = await prisma.usuario.create({
    data: {
      email: EMAIL, nombre: actor.nombre, rol: 'COMERCIAL', estado: 'ACTIVO',
      passwordHash: await hashPassword('una frase larga de prueba'),
    },
  })
  actor.id = u.id
}, 120_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

describe('contraseñas', () => {
  it('verifica la correcta y rechaza la incorrecta', async () => {
    const u = await prisma.usuario.findUnique({ where: { email: EMAIL } })
    expect(await verifyPassword(u!.passwordHash!, 'una frase larga de prueba')).toBe(true)
    expect(await verifyPassword(u!.passwordHash!, 'otra cosa')).toBe(false)
  }, 60_000)

  it('un hash corrupto devuelve false en vez de lanzar', async () => {
    // Si lanzara, el error distinguiría "hash roto" de "contraseña mala" y se
    // convertiría en un oráculo para quien pruebe credenciales.
    expect(await verifyPassword('esto no es un hash', 'lo que sea')).toBe(false)
  })

  it('dos hashes de la misma contraseña son distintos (sal aleatoria)', async () => {
    const a = await hashPassword('la misma contraseña de prueba')
    const b = await hashPassword('la misma contraseña de prueba')
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'la misma contraseña de prueba')).toBe(true)
    expect(await verifyPassword(b, 'la misma contraseña de prueba')).toBe(true)
  }, 60_000)
})

describe('límite de intentos', () => {
  beforeEach(async () => {
    await prisma.intentoAcceso.deleteMany({ where: { email: EMAIL } })
    await prisma.usuario.updateMany({ where: { email: EMAIL }, data: { bloqueadoHasta: null } })
  })

  it('permite los primeros intentos y bloquea al superar el límite', async () => {
    expect((await verificarLimite(EMAIL, '10.0.0.1')).permitido).toBe(true)

    for (let i = 0; i < LIMITES.MAX_POR_EMAIL; i++) {
      await registrarIntento(EMAIL, '10.0.0.1', false, 'prueba')
    }

    const r = await verificarLimite(EMAIL, '10.0.0.1')
    expect(r.permitido).toBe(false)
    expect(r.motivo).toContain('Demasiados intentos')
    expect(r.esperaMinutos).toBeGreaterThan(0)
  }, 60_000)

  it('un acceso correcto limpia el bloqueo y el historial', async () => {
    for (let i = 0; i < LIMITES.MAX_POR_EMAIL; i++) {
      await registrarIntento(EMAIL, '10.0.0.2', false, 'prueba')
    }
    expect((await verificarLimite(EMAIL, '10.0.0.2')).permitido).toBe(false)

    await registrarIntento(EMAIL, '10.0.0.2', true)

    expect((await verificarLimite(EMAIL, '10.0.0.2')).permitido).toBe(true)
    const fallos = await prisma.intentoAcceso.count({ where: { email: EMAIL, exito: false } })
    expect(fallos).toBe(0)
    const u = await prisma.usuario.findUnique({ where: { email: EMAIL } })
    expect(u!.ultimoAccesoEn).not.toBeNull()
  }, 60_000)

  it('los intentos fallidos NO ensucian la bitácora', async () => {
    const antes = await prisma.bitacora.count()
    for (let i = 0; i < 5; i++) await registrarIntento(EMAIL, '10.0.0.3', false, 'prueba')
    expect(await prisma.bitacora.count()).toBe(antes)
  }, 60_000)
})

describe('bitácora', () => {
  it('registra un evento con el actor copiado por valor', async () => {
    await prisma.$transaction(async (tx) => {
      await append(tx, {
        actor,
        categoria: 'COTIZACION',
        accion: 'prueba.evento',
        entidadTipo: 'Quote',
        entidadId: 'q1',
        entidadEtiqueta: 'KAT-TST-2026-001',
        resumen: `${actor.nombre} hizo algo digno de registrarse.`,
      })
    })

    const e = await prisma.bitacora.findFirst({
      where: { accion: 'prueba.evento' },
      orderBy: { ocurridoEn: 'desc' },
    })
    expect(e).not.toBeNull()
    // El nombre y el rol se copian: si el usuario cambia luego, el histórico no.
    expect(e!.actorNombre).toBe(actor.nombre)
    expect(e!.actorEmail).toBe(EMAIL)
    expect(e!.actorRol).toBe('COMERCIAL')
    expect(e!.entidadEtiqueta).toBe('KAT-TST-2026-001')
  })

  it('se deshace con la transacción: sin cambio no hay rastro', async () => {
    const antes = await prisma.bitacora.count()
    await expect(
      prisma.$transaction(async (tx) => {
        await append(tx, {
          actor, categoria: 'TARIFARIO', accion: 'prueba.rollback',
          resumen: 'Esto no debería quedar registrado.',
        })
        throw new Error('la operación falla después de registrar')
      }),
    ).rejects.toThrow()
    expect(await prisma.bitacora.count()).toBe(antes)
  })

  it('la coalescencia conserva el valor original y actualiza el final', async () => {
    // Simula a alguien tecleando un precio: 195,000 → 180,000 → 150,000.
    const clave = 'precio|q1|RONNY|ESPEJO'
    for (const [antes, despues] of [
      ['$195,000', '$180,000'],
      ['$180,000', '$160,000'],
      ['$160,000', '$150,000'],
    ]) {
      await prisma.$transaction(async (tx) => {
        await append(tx, {
          actor, categoria: 'COTIZACION', accion: 'prueba.precio',
          resumen: `${actor.nombre} ajustó Ronny · espejo de ${antes} a ${despues}`,
          cambios: { precio: { antes, despues } },
          coalescerPor: clave,
        })
      })
    }

    const eventos = await prisma.bitacora.findMany({ where: { accion: 'prueba.precio' } })
    // Un solo apunte, no tres.
    expect(eventos).toHaveLength(1)
    const cambios = eventos[0]!.cambios as Record<string, { antes: string; despues: string }>
    // Del primer "antes" al último "después".
    expect(cambios.precio!.antes).toBe('$195,000')
    expect(cambios.precio!.despues).toBe('$150,000')
    expect(eventos[0]!.resumen).toContain('a $150,000')
  })

  it('no se puede borrar: la tabla es de solo inserción', async () => {
    await prisma.$transaction(async (tx) => {
      await append(tx, {
        actor, categoria: 'SISTEMA', accion: 'prueba.inmutable',
        resumen: 'Este evento no se puede borrar.',
      })
    })
    await expect(
      prisma.bitacora.deleteMany({ where: { accion: 'prueba.inmutable' } }),
    ).rejects.toThrow(/solo inserción/)
  })
})
