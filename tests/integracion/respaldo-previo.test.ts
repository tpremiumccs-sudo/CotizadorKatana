import { describe, it, expect, afterAll } from 'vitest'
import { rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

/**
 * El respaldo que se toma antes de aplicar una importación.
 *
 * Aplicar reescribe el tarifario completo y no hay "deshacer". Este volcado ES
 * el deshacer, así que lo que hay que comprobar no es sólo que se cree: es que
 * sea legible, y que si no se puede crear la importación NO siga adelante.
 */

const DIR = mkdtempSync(join(tmpdir(), 'katana-respaldo-'))
process.env.STORAGE_DIR = DIR

const { respaldarAntesDe, RespaldoFallidoError } = await import(
  '@/server/data/respaldo'
)

afterAll(async () => {
  await rm(DIR, { recursive: true, force: true })
})

describe('respaldo previo', () => {
  it('produce un volcado legible', async () => {
    const r = await respaldarAntesDe('CRM COMERCIAL 2026.xlsx')
    expect(r.bytes).toBeGreaterThan(1_000)
    expect(r.ruta).toContain('respaldos-previos')
    // El nombre lleva el archivo que lo provocó, para poder relacionarlos.
    expect(r.ruta).toMatch(/previo-CRM_COMERCIAL_2026_xlsx-/)

    const archivos = await readdir(join(DIR, 'respaldos-previos'))
    expect(archivos.some((a) => a.endsWith('.dump'))).toBe(true)
    // Nada a medias: el temporal no sobrevive.
    expect(archivos.some((a) => a.endsWith('.parcial'))).toBe(false)
  }, 120_000)

  it('el volcado se puede volver a leer de verdad', async () => {
    // No basta con que el archivo exista: `respaldarAntesDe` lo relee con
    // pg_restore antes de darlo por bueno. Aquí se comprueba desde fuera.
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const ejecutar = promisify(execFile)

    const archivos = await readdir(join(DIR, 'respaldos-previos'))
    const dump = join(DIR, 'respaldos-previos', archivos.find((a) => a.endsWith('.dump'))!)

    const { stdout } = await ejecutar('pg_restore', ['--list', dump], {
      maxBuffer: 32 * 1024 * 1024,
    })
    // Las tablas del sistema tienen que estar dentro.
    expect(stdout).toContain('Talent')
    expect(stdout).toContain('TalentRate')
    expect(stdout).toContain('Quote')
  }, 120_000)

  it('si no se puede respaldar, lanza en vez de seguir', async () => {
    const original = process.env.DATABASE_URL
    // Un puerto donde no hay nadie: pg_dump falla.
    process.env.DATABASE_URL =
      'postgresql://nadie:nada@127.0.0.1:59999/inexistente?schema=public'
    try {
      await expect(respaldarAntesDe('prueba')).rejects.toBeInstanceOf(
        RespaldoFallidoError,
      )
      await expect(respaldarAntesDe('prueba')).rejects.toThrow(/no se aplicó nada/)
    } finally {
      process.env.DATABASE_URL = original
    }
  }, 120_000)

  it('sin DATABASE_URL tampoco sigue adelante', async () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      await expect(respaldarAntesDe('prueba')).rejects.toThrow(/DATABASE_URL/)
    } finally {
      process.env.DATABASE_URL = original
    }
  })
})
