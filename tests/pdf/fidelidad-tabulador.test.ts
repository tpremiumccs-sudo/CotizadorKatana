import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderDocumentHtml } from '@/lib/doc/render'
import { fuentesDocumento, logoDataUri } from '@/server/pdf/fuentes'
import { documentoHonor } from '../fixtures/datos-honor'

/**
 * LA PRUEBA QUE CIERRA LA FASE.
 *
 * Reconstruye el tabulador de HONOR desde cero con los datos de la agencia y
 * compara el PDF resultante contra el original que se envió al cliente. Si esto
 * pasa, "el preview es idéntico al PDF" deja de ser una promesa.
 */

const RAIZ = join(import.meta.dirname, '../..')
const PY = join(RAIZ, '.venv/bin/python')
const BASELINE = join(RAIZ, 'tests/fixtures/honor_baseline.json')

let pdfGenerado: string
let salidaComparacion = ''
let comparacionOk = false

beforeAll(() => {
  if (!existsSync(PY)) {
    throw new Error(
      'Falta el entorno de Python de las herramientas.\n' +
        '  python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt',
    )
  }

  const html = renderDocumentHtml(
    documentoHonor(logoDataUri()),
    fuentesDocumento(),
    'print',
  )

  const dir = mkdtempSync(join(tmpdir(), 'katana-fidelidad-'))
  const rutaHtml = join(dir, 'tabulador.html')
  pdfGenerado = join(dir, 'tabulador.pdf')
  writeFileSync(rutaHtml, html)

  execFileSync('node', [join(RAIZ, 'tools/render-html.mjs'), rutaHtml, pdfGenerado], {
    cwd: RAIZ,
    encoding: 'utf8',
  })

  try {
    salidaComparacion = execFileSync(
      PY,
      [join(RAIZ, 'tools/comparar.py'), pdfGenerado, '--contra', BASELINE],
      { cwd: RAIZ, encoding: 'utf8' },
    )
    comparacionOk = true
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    salidaComparacion = (err.stdout ?? '') + (err.stderr ?? '')
    comparacionOk = false
  }
}, 180_000)

describe('fidelidad del tabulador de HONOR', () => {
  it('el PDF generado es indistinguible del original', () => {
    // El informe del oráculo se imprime completo si falla: dice exactamente
    // qué run se movió, cuánto y en qué página.
    expect(salidaComparacion, salidaComparacion).toContain('fiel al original')
    expect(comparacionOk).toBe(true)
  })

  it('tiene dos páginas de tamaño carta', () => {
    const huella = JSON.parse(
      execFileSync(PY, [join(RAIZ, 'tools/huella.py'), pdfGenerado], {
        cwd: RAIZ, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      }),
    ) as { paginas: Array<{ ancho: number; alto: number }> }

    expect(huella.paginas).toHaveLength(2)
    for (const p of huella.paginas) {
      expect(p.ancho).toBeCloseTo(612, 1)
      expect(p.alto).toBeCloseTo(792, 1)
    }
  })

  it('el texto del PDF contiene los precios ajustados y no los del tarifario', () => {
    const texto = execFileSync(
      PY,
      ['-c', `
import sys, pdfplumber
with pdfplumber.open(sys.argv[1]) as d:
    print('\\n'.join((p.extract_text() or '') for p in d.pages))
`, pdfGenerado],
      { cwd: RAIZ, encoding: 'utf8' },
    )

    expect(texto).toContain('HONOR')
    expect(texto).toContain('Fer Nicolini')
    expect(texto).toContain('Chuy Gallardo')
    // Los espejos van ajustados: Ronny a $150,000 (el tarifario dice $195,000)
    // y Tony a $80,000 (el tarifario dice $90,000).
    expect(texto).toContain('$150,000')
    expect(texto).not.toContain('$195,000')

    const filaTony = texto.split('\n').find((l) => l.startsWith('Tony Gastélum'))
    expect(filaTony).toBe('Tony Gastélum $30,000 $60,000 $80,000 $25,000')
    const filaRonny = texto.split('\n').find((l) => l.startsWith('Ronny'))
    expect(filaRonny).toBe('Ronny $90,000 $130,000 $150,000 $40,000')
  })
})
