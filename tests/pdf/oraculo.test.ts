import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * El oráculo de fidelidad se prueba a sí mismo.
 *
 * Toda la Fase 5 descansa en que `comparar.py` sepa distinguir un PDF fiel de
 * uno que no lo es. Un oráculo que siempre dice "OK" haría pasar la suite
 * entera sin que nadie se entere, así que aquí se comprueba lo obvio y lo
 * importante: que acepta el original y que rechaza cada tipo de alteración.
 */

const RAIZ = join(import.meta.dirname, '../..')
const PY = join(RAIZ, '.venv/bin/python')
const ORIGINAL = join(RAIZ, 'tests/fixtures/honor_tabulador_original.pdf')
const BASELINE = join(RAIZ, 'tests/fixtures/honor_baseline.json')

type Huella = {
  paginas: Array<{
    numero: number
    ancho: number
    alto: number
    lineas: Array<{ top: number; runs: Array<Record<string, unknown>> }>
    rects: Array<Record<string, unknown>>
    trazos: Array<Record<string, unknown>>
    imagenes: Array<Record<string, unknown>>
  }>
}

function comparar(pdf: string, contra: string): { ok: boolean; salida: string } {
  try {
    const salida = execFileSync(
      PY,
      [join(RAIZ, 'tools/comparar.py'), pdf, '--contra', contra],
      { encoding: 'utf8', cwd: RAIZ },
    )
    return { ok: true, salida }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    return { ok: false, salida: (err.stdout ?? '') + (err.stderr ?? '') }
  }
}

/** Carga la huella base y le aplica una alteración, devolviendo la ruta temporal. */
function huellaAlterada(mutar: (h: Huella) => void): string {
  const h = JSON.parse(readFileSync(BASELINE, 'utf8')) as Huella
  mutar(h)
  const dir = mkdtempSync(join(tmpdir(), 'katana-oraculo-'))
  const ruta = join(dir, 'alterada.json')
  writeFileSync(ruta, JSON.stringify(h))
  return ruta
}

function runsDe(h: Huella, pagina = 0) {
  return h.paginas[pagina]!.lineas.flatMap((l) => l.runs)
}

describe('oráculo de fidelidad', () => {
  beforeAll(() => {
    if (!existsSync(PY)) {
      throw new Error(
        'Falta el entorno de Python para las herramientas de fidelidad.\n' +
          'Créalo con:\n' +
          '  python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt',
      )
    }
    if (!existsSync(BASELINE)) {
      throw new Error(
        'Falta tests/fixtures/honor_baseline.json. Genéralo con:\n' +
          '  .venv/bin/python tools/huella.py tests/fixtures/honor_tabulador_original.pdf ' +
          '-o tests/fixtures/honor_baseline.json',
      )
    }
  })

  it('acepta el PDF original contra su propia huella', () => {
    const r = comparar(ORIGINAL, BASELINE)
    expect(r.salida).toContain('fiel al original')
    expect(r.ok).toBe(true)
  })

  it('la huella base refleja lo que el documento realmente tiene', () => {
    const h = JSON.parse(readFileSync(BASELINE, 'utf8')) as Huella
    expect(h.paginas).toHaveLength(2)

    for (const p of h.paginas) {
      expect(p.ancho).toBeCloseTo(612, 1)
      expect(p.alto).toBeCloseTo(792, 1)
    }

    const p1 = runsDe(h, 0)
    // 9 viñetas en Consideraciones — el brief decía 8; el documento dice 9.
    expect(p1.filter((r) => r.texto === '•')).toHaveLength(9)
    // 4 talentos × 4 formatos = 16 celdas, en azul marino, no en el morado de marca.
    expect(p1.filter((r) => r.color === '#1E3A8A')).toHaveLength(16)
    // Los nombres de talento sí van en el morado oscuro, a 9.7pt.
    expect(
      p1.filter((r) => r.color === '#3D0070' && r.tam === 9.7),
    ).toHaveLength(4)
    // El logo aparece en las dos páginas.
    expect(h.paginas[0]!.imagenes).toHaveLength(1)
    expect(h.paginas[1]!.imagenes).toHaveLength(1)
  })

  it('rechaza un precio distinto', () => {
    const ruta = huellaAlterada((h) => {
      for (const r of runsDe(h)) {
        if (r.texto === '$150,000') r.texto = '$195,000'
      }
    })
    const r = comparar(ORIGINAL, ruta)
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('texto')
  })

  it('rechaza un color equivocado aunque el texto coincida', () => {
    const ruta = huellaAlterada((h) => {
      for (const r of runsDe(h)) {
        if (r.color === '#1E3A8A') r.color = '#3D0070'
      }
    })
    const r = comparar(ORIGINAL, ruta)
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('color')
  })

  it('tolera un desplazamiento menor que un píxel CSS pero no uno mayor', () => {
    const dentro = huellaAlterada((h) => {
      for (const r of runsDe(h)) {
        if (r.texto === 'Yoiker') r.x0 = (r.x0 as number) + 0.6
      }
    })
    expect(comparar(ORIGINAL, dentro).ok).toBe(true)

    const fuera = huellaAlterada((h) => {
      for (const r of runsDe(h)) {
        if (r.texto === 'Yoiker') r.x0 = (r.x0 as number) + 1.2
      }
    })
    const r = comparar(ORIGINAL, fuera)
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('posicion-x')
  })

  it('rechaza un cambio en la geometría de la barra de marca', () => {
    const ruta = huellaAlterada((h) => {
      for (const rect of h.paginas[0]!.rects) {
        if (rect.relleno === '#7B2FBE' && (rect.top as number) < 1) {
          rect.bottom = (rect.bottom as number) + 2
        }
      }
    })
    const r = comparar(ORIGINAL, ruta)
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('rect')
  })

  it('rechaza un tamaño de letra distinto', () => {
    const ruta = huellaAlterada((h) => {
      for (const r of runsDe(h)) {
        if (r.texto === 'Tabulador de Tarifas') r.tam = 18
      }
    })
    const r = comparar(ORIGINAL, ruta)
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('tamano-texto')
  })

  it('rechaza que falte una página', () => {
    const ruta = huellaAlterada((h) => {
      h.paginas = [h.paginas[0]!]
    })
    const r = comparar(ORIGINAL, ruta)
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('página')
  })
})

describe('calibración tipográfica', () => {
  it(
    'la fuente embebida sigue reproduciendo las métricas de Helvetica en Chromium',
    { timeout: 180_000 },
    () => {
      // Corre la calibración en modo verificación: comprueba los tres
      // invariantes (clon métrico, Chromium respeta los anchos, desfase de
      // línea base estable) sin reescribir los JSON generados.
      let salida: string
      try {
        salida = execFileSync(PY, [join(RAIZ, 'tools/calibrar.py'), '--verificar'], {
          encoding: 'utf8',
          cwd: RAIZ,
          env: { ...process.env },
        })
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string }
        throw new Error(
          'La calibración tipográfica falló:\n' + (err.stdout ?? '') + (err.stderr ?? ''),
        )
      }
      expect(salida).toContain('Calibración correcta')
      expect(salida).not.toContain('DIFIERE')
    },
  )
})
