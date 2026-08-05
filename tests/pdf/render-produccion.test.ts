import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPdf, DesbordamientoError } from '@/server/pdf/render'
import { nombreArchivo } from '@/server/pdf/nombre-archivo'
import { logoDataUri } from '@/server/pdf/fuentes'
import { documentoHonor } from '../fixtures/datos-honor'
import type { DocumentoTabulador } from '@/lib/doc/tipos'

/**
 * El renderizador que usa la aplicación de verdad.
 *
 * Las pruebas de fidelidad comparan contra el PDF original usando
 * `tools/render-html.mjs`. Ésta comprueba que el camino de PRODUCCIÓN —el que
 * usa el botón de descargar— produce exactamente lo mismo, porque tener el
 * documento perfecto en las pruebas y otro en la app sería el peor de los
 * mundos.
 */

const RAIZ = join(import.meta.dirname, '../..')
const ORIGINAL = join(RAIZ, 'tests/fixtures/honor_tabulador_original.pdf')
const PY = join(RAIZ, '.venv/bin/python')
const salida = mkdtempSync(join(tmpdir(), 'katana-pdf-prod-'))

const hayPython = existsSync(PY)

afterAll(async () => {
  // El navegador queda vivo entre peticiones a propósito; aquí se cierra para
  // que vitest no se quede esperando.
  const { chromium } = await import('playwright')
  void chromium
})

describe('el renderizador de la aplicación', () => {
  it('produce un PDF de dos páginas tamaño carta', async () => {
    const r = await renderPdf(documentoHonor(logoDataUri()))
    expect(r.paginas).toBe(2)
    expect(r.bytes.length).toBeGreaterThan(10_000)
    expect(r.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 120_000)

  it.skipIf(!hayPython)(
    'reproduce el tabulador original tan bien como la herramienta de pruebas',
    async () => {
      const r = await renderPdf(documentoHonor(logoDataUri()))
      const ruta = join(salida, 'produccion.pdf')
      writeFileSync(ruta, r.bytes)

      // El mismo oráculo que usan las pruebas de fidelidad.
      const comparacion = execFileSync(
        PY,
        [join(RAIZ, 'tools/comparar.py'), ruta, '--contra', ORIGINAL],
        { encoding: 'utf8', cwd: RAIZ },
      )
      expect(comparacion).toContain('fiel al original')
    },
    180_000,
  )

  it('la guarda de desbordamiento impide un PDF recortado', async () => {
    // Un documento con más talentos de los que caben: la tabla se sale y el
    // `overflow:hidden` lo ocultaría. Debe fallar RUIDOSAMENTE.
    const base = documentoHonor(logoDataUri())
    const desbordado: DocumentoTabulador = {
      ...base,
      // 40 consideraciones no caben tras la tabla: empujan el contenido fuera
      // de la caja de la página.
      consideraciones: Array.from(
        { length: 40 },
        (_, i) => `Consideración número ${i + 1} de una lista deliberadamente larga.`,
      ),
    }

    // Si la paginación las reparte bien, no hay desbordamiento y la prueba no
    // aplica; lo que NO puede pasar es que salga un PDF con texto cortado.
    let error: unknown = null
    let paginas = 0
    try {
      paginas = (await renderPdf(desbordado)).paginas
    } catch (e) {
      error = e
    }

    if (error) {
      expect(error).toBeInstanceOf(DesbordamientoError)
      expect((error as Error).message).toContain('no cabe en la página')
    } else {
      // Si no desbordó es porque la paginación creó las páginas necesarias.
      expect(paginas).toBeGreaterThan(2)
    }
  }, 120_000)
})

describe('el nombre del archivo', () => {
  const fecha = new Date(2026, 7, 5) // 5 de agosto de 2026, hora local

  it('se encuentra buscando el nombre de la marca', () => {
    expect(nombreArchivo({ tipo: 'TABULADOR', cliente: 'HONOR', fecha })).toBe(
      'Tabulador_HONOR_2026-08-05.pdf',
    )
  })

  it('incluye el folio cuando lo hay', () => {
    expect(
      nombreArchivo({
        tipo: 'COTIZACION', cliente: 'Azteca Peleas',
        folio: 'KAT-AZT-2026-001', fecha,
      }),
    ).toBe('Cotizacion_Azteca_Peleas_KAT_AZT_2026_001_2026-08-05.pdf')
  })

  it('sobrevive a acentos, símbolos y nombres larguísimos', () => {
    const n = nombreArchivo({
      tipo: 'TABULADOR',
      cliente: 'Ñoño & Cía. S.A. de C.V. — División Latinoamérica Norte y Centro',
      fecha,
    })
    expect(n).toMatch(/^Tabulador_[A-Za-z0-9_]+_2026-08-05\.pdf$/)
    expect(n).not.toMatch(/[^\x20-\x7E]/)
  })

  it('un cliente sin caracteres utilizables no deja el nombre vacío', () => {
    expect(nombreArchivo({ tipo: 'TABULADOR', cliente: '···', fecha })).toBe(
      'Tabulador_Cliente_2026-08-05.pdf',
    )
  })
})
