import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '@/server/auth/password'
import type { Actor } from '@/lib/authz/policy'
import type { DatosSesion } from '@/server/auth/session'

/**
 * La puerta de las acciones que escriben.
 *
 * Lo que se comprueba aquí es la mitad que se olvida: que un permiso denegado
 * no sólo impide la operación, sino que DEJA RASTRO. Ocultar el botón no
 * protege nada — una Server Action es un endpoint HTTP —, así que interesa
 * saber quién intentó qué aunque no lo consiguiera.
 */

// La sesión se simula: aquí se prueba la puerta, no la cookie (eso ya lo cubre
// la verificación en navegador). Lo que NO se simula es la base: la fila de la
// bitácora se comprueba contra Postgres de verdad.
let sesionActual: DatosSesion | null = null

vi.mock('@/server/auth/session', () => ({
  leerSesion: async () => sesionActual,
  contextoPeticion: async () => ({ ip: '203.0.113.7', userAgent: 'prueba' }),
}))

const { autorizar } = await import('@/server/data/autorizar')
const { ForbiddenError } = await import('@/lib/authz/policy')

const prisma = new PrismaClient()
const CORREOS = ['lectura-autz@katana.local', 'comercial-autz@katana.local']

async function limpiar() {
  await prisma.$executeRaw`ALTER TABLE "Bitacora" DISABLE TRIGGER bitacora_inmutable`
  await prisma.bitacora.deleteMany({ where: { actorEmail: { in: CORREOS } } })
  await prisma.$executeRaw`ALTER TABLE "Bitacora" ENABLE TRIGGER bitacora_inmutable`
  await prisma.usuario.deleteMany({ where: { email: { in: CORREOS } } })
}

const actores: Record<'lectura' | 'comercial', Actor> = {
  lectura: {
    id: '', nombre: 'Ana Lectura', email: CORREOS[0]!,
    rol: 'LECTURA', estado: 'ACTIVO', esAprobador: false,
  },
  comercial: {
    id: '', nombre: 'Beto Comercial', email: CORREOS[1]!,
    rol: 'COMERCIAL', estado: 'ACTIVO', esAprobador: false,
  },
}

function entrarComo(a: Actor | null) {
  sesionActual = a
    ? { actor: a, sesionId: 'sesion-de-prueba', debeCambiarPassword: false }
    : null
}

beforeAll(async () => {
  await prisma.$connect()
  await limpiar()
  const hash = await hashPassword('una frase larga de prueba')
  for (const clave of ['lectura', 'comercial'] as const) {
    const a = actores[clave]
    const u = await prisma.usuario.create({
      data: {
        email: a.email, nombre: a.nombre, rol: a.rol,
        estado: 'ACTIVO', passwordHash: hash,
      },
    })
    a.id = u.id
  }
}, 120_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function eventosDenegados(email: string) {
  return prisma.bitacora.findMany({
    where: { actorEmail: email, accion: { startsWith: 'permiso.denegado' } },
    orderBy: { ocurridoEn: 'desc' },
  })
}

describe('acción invocada sin permiso', () => {
  it('un rol LECTURA no puede editar el tarifario, y el intento queda registrado', async () => {
    entrarComo(actores.lectura)

    await expect(
      autorizar('tarifario.editar', {
        entidadTipo: 'TalentRate',
        entidadEtiqueta: 'Ronny · TikTok + réplica Reel',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const [e] = await eventosDenegados(CORREOS[0]!)
    expect(e, 'debe haber una fila en la bitácora').toBeDefined()
    expect(e!.accion).toBe('permiso.denegado:tarifario.editar')
    expect(e!.exito).toBe(false)
    expect(e!.actorRol).toBe('LECTURA')
    expect(e!.entidadEtiqueta).toBe('Ronny · TikTok + réplica Reel')
    expect(e!.ip).toBe('203.0.113.7')
    // La frase se lee sin descifrar nada.
    expect(e!.resumen).toBe(
      'Ana Lectura (Solo lectura) intentó modificar el tarifario y no tiene ' +
        'permiso: Tu rol es de solo lectura: no puedes modificar el catálogo.',
    )
  })

  it('el error lleva la acción y el motivo, para poder mostrarlo', async () => {
    entrarComo(actores.lectura)
    try {
      await autorizar('cotizacion.crear')
      expect.unreachable('debió lanzar')
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError)
      expect((e as InstanceType<typeof ForbiddenError>).accion).toBe('cotizacion.crear')
      expect((e as Error).message).toContain('solo lectura')
    }
  })

  it('sin sesión también lanza y también deja rastro, sin actor', async () => {
    entrarComo(null)
    const antes = await prisma.bitacora.count()
    await expect(autorizar('cotizacion.editar')).rejects.toBeInstanceOf(ForbiddenError)
    expect(await prisma.bitacora.count()).toBe(antes + 1)

    const e = await prisma.bitacora.findFirst({
      where: { accion: 'permiso.denegado:cotizacion.editar', actorId: null },
      orderBy: { ocurridoEn: 'desc' },
    })
    expect(e!.resumen).toContain('Alguien sin sesión')
  })

  it('una cuenta suspendida no pasa aunque su rol sea suficiente', async () => {
    entrarComo({ ...actores.comercial, estado: 'SUSPENDIDO' })
    await expect(autorizar('cotizacion.crear')).rejects.toThrow(/suspendida/)
  })

  it('un comercial no edita la cotización de otro', async () => {
    entrarComo(actores.comercial)
    await expect(
      autorizar('cotizacion.editar', { recurso: { creadoPorId: 'alguien-mas' } }),
    ).rejects.toThrow(/que tú creaste/)

    const [e] = await eventosDenegados(CORREOS[1]!)
    // El recurso se guarda para poder reconstruir qué se intentó.
    expect(e!.metadatos).toMatchObject({
      accion: 'cotizacion.editar',
      recurso: { creadoPorId: 'alguien-mas' },
    })
  })
})

describe('acción permitida', () => {
  it('devuelve el actor y NO ensucia la bitácora', async () => {
    entrarComo(actores.comercial)
    const antes = await prisma.bitacora.count()

    const actor = await autorizar('cotizacion.crear')
    expect(actor.id).toBe(actores.comercial.id)
    expect(actor.rol).toBe('COMERCIAL')

    // Registrar los permisos concedidos llenaría la bitácora de ruido: lo que
    // se audita es el cambio que viene después, no la comprobación.
    expect(await prisma.bitacora.count()).toBe(antes)
  })

  it('un borrador propio sí se edita', async () => {
    entrarComo(actores.comercial)
    await expect(
      autorizar('cotizacion.editar', {
        recurso: { creadoPorId: actores.comercial.id, estado: 'DRAFT' },
      }),
    ).resolves.toMatchObject({ rol: 'COMERCIAL' })
  })

  it('los tres roles pueden leer', async () => {
    for (const a of [actores.lectura, actores.comercial]) {
      entrarComo(a)
      await expect(autorizar('tarifario.ver')).resolves.toBeTruthy()
      await expect(autorizar('cotizacion.descargarPdf')).resolves.toBeTruthy()
    }
  })
})
