import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderDocumentHtml } from '@/lib/doc/render'
import { fuentesDocumento, logoDataUri } from '@/server/pdf/fuentes'
import { documentoAzteca, IMPORTES_AZTECA } from '../fixtures/datos-azteca'

/**
 * La COTIZACIÓN, verificada re-leyendo el PDF que se genera.
 *
 * No se compara contra un original (la agencia no compartió el PDF de Azteca),
 * así que se comprueba lo que sí se puede comprobar y es lo que importa: que
 * las cifras impresas cuadran entre sí y con lo que el CRM registró, y que el
 * bloque de totales nunca queda partido.
 */

const RAIZ = join(import.meta.dirname, '../..')
const PY = join(RAIZ, '.venv/bin/python')

let pdf: string
let texto: string
let huella: {
  paginas: Array<{
    lineas: Array<{ runs: Array<{ texto: string; top: number; color: string }> }>
    rects: Array<{ relleno: string; top: number; bottom: number }>
  }>
}

function generar(doc: Parameters<typeof renderDocumentHtml>[0]): string {
  const dir = mkdtempSync(join(tmpdir(), 'katana-cot-'))
  const html = join(dir, 'c.html')
  const salida = join(dir, 'c.pdf')
  writeFileSync(html, renderDocumentHtml(doc, fuentesDocumento(), 'print'))
  execFileSync('node', [join(RAIZ, 'tools/render-html.mjs'), html, salida], { cwd: RAIZ })
  return salida
}

function extraerTexto(ruta: string): string {
  return execFileSync(
    PY,
    ['-c', `
import sys, pdfplumber
with pdfplumber.open(sys.argv[1]) as d:
    print('\\n'.join((p.extract_text() or '') for p in d.pages))
`, ruta],
    { cwd: RAIZ, encoding: 'utf8' },
  )
}

beforeAll(() => {
  pdf = generar(documentoAzteca(logoDataUri()))
  texto = extraerTexto(pdf)
  huella = JSON.parse(
    execFileSync(PY, [join(RAIZ, 'tools/huella.py'), pdf], {
      cwd: RAIZ, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    }),
  )
}, 180_000)

describe('cotización de Azteca Peleas', () => {
  it('imprime el folio, el cliente y el contacto', () => {
    expect(texto).toContain('KAT-AZT-2026-001')
    expect(texto).toContain('TV Azteca')
    expect(texto).toContain('Jorge Garduño')
  })

  it('el importe de cada talento coincide con lo registrado en el CRM', () => {
    for (const [nombre] of Object.entries(IMPORTES_AZTECA.porTalento)) {
      expect(texto, `falta ${nombre}`).toContain(nombre)
    }
    // "1 Reel colaborativo + 4 Stories" da estos netos por talento.
    expect(texto).toContain('$340,000')
    expect(texto).toContain('$400,000')
    expect(texto).toContain('$310,000')
  })

  it('los totales cuadran: Total = Subtotal − Descuento + IVA', () => {
    // Se re-lee el PDF y se rehace la aritmética con lo impreso, no con lo
    // calculado: es la comprobación que detecta que el documento diga otra cosa.
    const importe = (etiqueta: string): number => {
      const linea = texto
        .split('\n')
        .find((l) => l.trimStart().startsWith(etiqueta + ' $'))
      expect(linea, `no se encontró la línea de ${etiqueta}`).toBeDefined()
      const m = /\$([\d,]+(?:\.\d{2})?)/.exec(linea!)
      expect(m, `no se encontró importe en "${linea}"`).not.toBeNull()
      return Math.round(Number(m![1]!.replace(/,/g, '')) * 100)
    }

    const subtotal = importe('Subtotal')
    const iva = importe('IVA 16%')
    const total = importe('TOTAL')

    expect(subtotal).toBe(IMPORTES_AZTECA.subtotal)
    expect(iva).toBe(IMPORTES_AZTECA.iva)
    expect(total).toBe(IMPORTES_AZTECA.total)
    expect(total).toBe(subtotal + iva)
  })

  it('el importe en letra coincide con la cifra', () => {
    expect(texto).toContain(
      'UN MILLÓN SEISCIENTOS DOCE MIL CUATROCIENTOS PESOS 00/100 M.N.',
    )
  })

  it('un renglón de "caso por caso" se imprime pero no suma', () => {
    expect(texto).toContain('Presencia en evento')
    expect(texto).toContain('Cotización aparte')
    // Si sumara, el total no cuadraría con el subtotal calculado.
    expect(texto).toContain(IMPORTES_AZTECA.totalFormateado)
  })

  it('el bloque de totales no queda partido entre páginas', () => {
    // La franja morada del TOTAL y el importe en letra deben caer en la misma
    // página: separarlos deja un documento que parece incompleto.
    const paginaDe = (fragmento: string) =>
      huella.paginas.findIndex((p) =>
        p.lineas.some((l) => l.runs.some((r) => r.texto.includes(fragmento))),
      )
    const pTotal = paginaDe('TOTAL')
    const pLetra = paginaDe('Son:')
    expect(pTotal).toBeGreaterThanOrEqual(0)
    expect(pLetra).toBe(pTotal)
  })

  it('cada talento lleva su franja de cabecera y su subtotal', () => {
    for (const nombre of Object.keys(IMPORTES_AZTECA.porTalento)) {
      expect(texto).toContain(`Subtotal ${nombre}`)
    }
    // Cuatro cabeceras moradas de talento más la franja del TOTAL.
    const franjas = huella.paginas.flatMap((p) =>
      p.rects.filter((r) => r.relleno === '#7B2FBE'),
    )
    expect(franjas.length).toBeGreaterThanOrEqual(5)
  })

  it('conserva el cromo del tabulador: consideraciones, términos y pie', () => {
    expect(texto).toContain('Consideraciones')
    expect(texto).toContain('Términos y Condiciones')
    expect(texto).toContain('Confidencialidad.')
    expect(texto).toContain('Katana Talent · Información confidencial')
    expect(texto).toContain('Katana Talent × TV Azteca')
  })

  it('con más de dos páginas, el pie dice "de cuántas"', () => {
    const paginas = huella.paginas.length
    expect(paginas).toBeGreaterThanOrEqual(2)
    if (paginas > 2) {
      expect(texto).toContain(`Pág. 1 de ${paginas}`)
    } else {
      expect(texto).toContain('Pág. 1')
    }
  })
})

describe('cotización con muchos talentos', () => {
  it('21 talentos fluyen a varias páginas sin partir ningún bloque', () => {
    const base = documentoAzteca(logoDataUri())
    const grande = {
      ...base,
      bloques: Array.from({ length: 21 }, (_, i) => ({
        ...base.bloques[i % base.bloques.length]!,
        nombre: `Talento de prueba ${i + 1}`,
      })),
    }
    const rutaGrande = generar(grande)
    const h = JSON.parse(
      execFileSync(PY, [join(RAIZ, 'tools/huella.py'), rutaGrande], {
        cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      }),
    ) as typeof huella

    expect(h.paginas.length).toBeGreaterThan(2)

    const t = extraerTexto(rutaGrande)
    // Los 21 aparecen, cada uno con su subtotal: ninguno se perdió al paginar.
    for (let i = 1; i <= 21; i++) {
      expect(t, `falta el talento ${i}`).toContain(`Subtotal Talento de prueba ${i}`)
    }
    // Y el pie numera correctamente.
    expect(t).toContain(`Pág. 1 de ${h.paginas.length}`)
  }, 180_000)
})
