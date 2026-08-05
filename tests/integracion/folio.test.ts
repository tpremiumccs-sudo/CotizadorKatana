import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  reservarFolio,
  sincronizarContador,
  formatearFolio,
  parsearFolio,
} from '@/server/quote/folio'

/**
 * La reserva de folio contra Postgres de verdad.
 *
 * Lo que aquí se prueba no se puede probar con mocks: que dos emisiones
 * simultáneas para el mismo cliente NUNCA obtienen el mismo consecutivo. Un
 * `SELECT` seguido de `UPDATE` pasaría todas las pruebas unitarias y fallaría
 * el día que Chuy y Ramiro emitan a la vez.
 */

const prisma = new PrismaClient()

describe('reserva de folio', () => {
  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "FolioCounter" WHERE "scope" LIKE 'T%'`
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM "FolioCounter" WHERE "scope" LIKE 'T%'`
  })

  it('numera de forma consecutiva desde 1', async () => {
    const a = await reservarFolio(prisma, 'TST', 2026)
    const b = await reservarFolio(prisma, 'TST', 2026)
    const c = await reservarFolio(prisma, 'TST', 2026)

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3])
    expect(formatearFolio(a)).toBe('KAT-TST-2026-001')
    expect(formatearFolio(c)).toBe('KAT-TST-2026-003')
  })

  it('cada cliente y cada año llevan su propio contador', async () => {
    const a = await reservarFolio(prisma, 'TAA', 2026)
    const b = await reservarFolio(prisma, 'TBB', 2026)
    const c = await reservarFolio(prisma, 'TAA', 2027)

    expect(a.seq).toBe(1)
    expect(b.seq).toBe(1)
    expect(c.seq).toBe(1)
  })

  it('veinte reservas simultáneas dan veinte folios distintos', async () => {
    // El caso que motiva el INSERT … ON CONFLICT DO UPDATE … RETURNING.
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => reservarFolio(prisma, 'TCC', 2026)),
    )
    const seqs = resultados.map((r) => r.seq).sort((x, y) => x - y)

    expect(new Set(seqs).size).toBe(20)
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('el rollback devuelve el consecutivo', async () => {
    await reservarFolio(prisma, 'TDD', 2026)

    await expect(
      prisma.$transaction(async (tx) => {
        await reservarFolio(tx, 'TDD', 2026) // sería el 2
        throw new Error('la emisión falla después de reservar')
      }),
    ).rejects.toThrow('la emisión falla')

    // El 2 volvió a estar libre: un borrador fallido no quema folios.
    const siguiente = await reservarFolio(prisma, 'TDD', 2026)
    expect(siguiente.seq).toBe(2)
  })

  it('normaliza el código a mayúsculas', async () => {
    const a = await reservarFolio(prisma, 'tee', 2026)
    expect(a.folioCode).toBe('TEE')
    const b = await reservarFolio(prisma, 'TEE', 2026)
    expect(b.seq).toBe(2) // el mismo contador, no uno nuevo
  })

  it('rechaza códigos y años inválidos antes de tocar la base', async () => {
    await expect(reservarFolio(prisma, 'TOOLONG', 2026)).rejects.toThrow(/inválido/)
    await expect(reservarFolio(prisma, 'TS', 2026)).rejects.toThrow(/inválido/)
    await expect(reservarFolio(prisma, 'TST', 1999)).rejects.toThrow(/inválido/)
  })

  it('sincronizar con el histórico evita repetir un folio ya emitido', async () => {
    // Se importa KAT-THH-2026-001 del registro anterior…
    const historico = parsearFolio('KAT-THH-2026-001')!
    await sincronizarContador(prisma, historico)

    // …y la primera cotización nueva del cliente debe ser la 002, no la 001.
    const nuevo = await reservarFolio(prisma, 'THH', 2026)
    expect(nuevo.seq).toBe(2)
    expect(formatearFolio(nuevo)).toBe('KAT-THH-2026-002')
  })

  it('sincronizar nunca baja el contador', async () => {
    await reservarFolio(prisma, 'TII', 2026) // 1
    await reservarFolio(prisma, 'TII', 2026) // 2
    await reservarFolio(prisma, 'TII', 2026) // 3

    // Llega un folio histórico más bajo: no debe reabrir consecutivos usados.
    await sincronizarContador(prisma, { folioCode: 'TII', year: 2026, seq: 1 })

    const siguiente = await reservarFolio(prisma, 'TII', 2026)
    expect(siguiente.seq).toBe(4)
  })
})
