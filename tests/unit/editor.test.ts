import { describe, it, expect } from 'vitest'
import {
  claveCelda, precioEfectivo, tieneAjuste, deltaCentavos, deltaBps,
  documentoDesdeEditor,
  type CeldaEditor, type EstadoEditor,
} from '@/lib/editor/tipos'
import { renderDocumentBody, renderDocumentHtml } from '@/lib/doc/render'

/**
 * La regla central del producto: el tarifario da el precio base y la cotización
 * guarda el ajuste aparte.
 *
 * Los números de estas pruebas son los del tabulador de HONOR real: Ronny en
 * espejo se cotizó a $150,000 con el tarifario en $195,000, y tres precios de
 * Mariel se pusieron sobre un tarifario que decía "Pendiente".
 */

const celda = (over: Partial<CeldaEditor> = {}): CeldaEditor => ({
  id: 'qp1',
  quoteTalentId: 'qt1',
  deliverableTypeId: 'dt1',
  baseAmountCents: 19_500_000, // $195,000
  basePriceStatus: 'QUOTED',
  overrideAmountCents: null,
  overridePriceStatus: null,
  overrideReason: null,
  ...over,
})

describe('precio efectivo', () => {
  it('sin ajuste manda el tarifario', () => {
    const p = precioEfectivo(celda())
    expect(p.amountCents).toBe(19_500_000)
    expect(p.status).toBe('QUOTED')
    expect(p.ajustado).toBe(false)
  })

  it('con ajuste manda el ajuste, y queda marcado', () => {
    const p = precioEfectivo(
      celda({ overrideAmountCents: 15_000_000, overridePriceStatus: 'QUOTED' }),
    )
    expect(p.amountCents).toBe(15_000_000)
    expect(p.ajustado).toBe(true)
  })

  it('poner cifra sobre un "Pendiente" es un ajuste', () => {
    // Es el caso de Mariel Estrella en el PDF real.
    const p = precioEfectivo(
      celda({
        baseAmountCents: null,
        basePriceStatus: 'PENDING',
        overrideAmountCents: 12_000_000,
        overridePriceStatus: 'QUOTED',
      }),
    )
    expect(p.amountCents).toBe(12_000_000)
    expect(p.status).toBe('QUOTED')
    expect(p.ajustado).toBe(true)
  })

  it('un "ajuste" que repite el precio base NO se marca', () => {
    // Marcarlo sería ruido: no hay nada que explicarle a la marca.
    const c = celda({ overrideAmountCents: 19_500_000, overridePriceStatus: 'QUOTED' })
    expect(tieneAjuste(c)).toBe(false)
    expect(precioEfectivo(c).ajustado).toBe(false)
  })

  it('cambiar sólo el estado, con el mismo importe, sí es un ajuste', () => {
    const c = celda({
      baseAmountCents: null, basePriceStatus: 'PENDING',
      overrideAmountCents: null, overridePriceStatus: 'CASE_BY_CASE',
    })
    expect(tieneAjuste(c)).toBe(true)
  })
})

describe('la diferencia contra el tarifario', () => {
  it('calcula el monto y el porcentaje del caso Ronny', () => {
    const c = celda({ overrideAmountCents: 15_000_000, overridePriceStatus: 'QUOTED' })
    expect(deltaCentavos(c)).toBe(-4_500_000) // −$45,000
    expect(deltaBps(c)).toBe(-2308)
    // Es lo que la celda muestra: "Base $195,000 · −$45,000 (−23.1%)".
    expect((Math.abs(deltaBps(c)!) / 100).toFixed(1)).toBe('23.1')
  })

  it('un aumento sale positivo', () => {
    const c = celda({ overrideAmountCents: 21_450_000, overridePriceStatus: 'QUOTED' })
    expect(deltaCentavos(c)).toBe(1_950_000)
    expect(deltaBps(c)).toBe(1000) // +10 %
  })

  it('sin tarifa base no hay porcentaje que calcular', () => {
    // Decir "−100 %" o "+∞ %" sobre un "Pendiente" sería inventarse un dato.
    const c = celda({
      baseAmountCents: null, basePriceStatus: 'PENDING',
      overrideAmountCents: 12_000_000, overridePriceStatus: 'QUOTED',
    })
    expect(deltaCentavos(c)).toBeNull()
    expect(deltaBps(c)).toBeNull()
  })

  it('con base en cero tampoco se divide', () => {
    const c = celda({
      baseAmountCents: 0,
      overrideAmountCents: 5_000_000, overridePriceStatus: 'QUOTED',
    })
    expect(deltaBps(c)).toBeNull()
  })

  it('sin ajuste no hay diferencia', () => {
    expect(deltaCentavos(celda())).toBeNull()
  })
})

// ─────────────────────── del editor al documento ───────────────────────

function estadoBase(): EstadoEditor {
  return {
    quoteId: 'q1', revision: 3, folio: null, draftRef: 'BORRADOR-7Q4K',
    estado: 'DRAFT', titulo: 'Tabulador de Tarifas', cliente: 'HONOR',
    contacto: 'Fer Nicolini', agente: 'Chuy Gallardo', moneda: 'MXN',
    talentos: [
      { id: 'qt-ronny', talentId: 't1', nombre: 'Ronny', nombreCanonico: 'Ronaldo BXM', orden: 1 },
      { id: 'qt-mariel', talentId: 't2', nombre: 'Mariel Estrella', nombreCanonico: 'Mariel Estrella', orden: 0 },
    ],
    columnas: [
      { deliverableTypeId: 'dt-espejo', label: 'TIKTOK + REEL', sublabel: '(ESPEJO)', orden: 1 },
      { deliverableTypeId: 'dt-tiktok', label: 'TIKTOK', sublabel: null, orden: 0 },
    ],
    celdas: {
      [claveCelda('qt-ronny', 'dt-espejo')]: celda({
        id: 'p1', quoteTalentId: 'qt-ronny', deliverableTypeId: 'dt-espejo',
        overrideAmountCents: 15_000_000, overridePriceStatus: 'QUOTED',
      }),
      [claveCelda('qt-ronny', 'dt-tiktok')]: celda({
        id: 'p2', quoteTalentId: 'qt-ronny', deliverableTypeId: 'dt-tiktok',
        baseAmountCents: 9_000_000,
      }),
      [claveCelda('qt-mariel', 'dt-espejo')]: celda({
        id: 'p3', quoteTalentId: 'qt-mariel', deliverableTypeId: 'dt-espejo',
        baseAmountCents: null, basePriceStatus: 'PENDING',
        overrideAmountCents: 15_000_000, overridePriceStatus: 'QUOTED',
      }),
      // Mariel × TikTok se deja SIN fila a propósito.
    },
    eyebrow: 'KATANA TALENT',
    tituloConsideraciones: 'Consideraciones',
    consideraciones: ['Tarifas expresadas en pesos mexicanos (MXN).'],
    tituloTerminos: 'Términos y Condiciones',
    terminos: ['Vigencia de este tabulador: 15 días naturales.'],
    confidencialidadTitulo: 'Confidencialidad',
    confidencialidadTexto: 'Documento confidencial.',
    firma: 'Katana Talent',
    piePagina: 'Katana Talent · Información confidencial',
    textoPendiente: 'Cotizar', textoCasoPorCaso: 'Cotizar',
    textoNoAplica: 'No aplica', textoVacio: '—',
    preciosEnMorado: false,
  }
}

describe('el documento que sale del editor', () => {
  const LOGO = 'data:image/png;base64,AAAA'

  it('respeta el orden declarado, no el de captura', () => {
    const d = documentoDesdeEditor(estadoBase(), LOGO)
    expect(d.filas.map((f) => f.nombre)).toEqual(['Mariel Estrella', 'Ronny'])
    expect(d.columnas.map((c) => c.label)).toEqual(['TIKTOK', 'TIKTOK + REEL'])
    expect(d.columnas[1]!.sublabel).toBe('(ESPEJO)')
  })

  it('imprime el precio efectivo, no el base', () => {
    const d = documentoDesdeEditor(estadoBase(), LOGO)
    const ronny = d.filas.find((f) => f.nombre === 'Ronny')!
    // Columna 1 es el espejo, que está ajustado a $150,000.
    expect(ronny.celdas[1]!.amountCents).toBe(15_000_000)
    expect(ronny.celdas[0]!.amountCents).toBe(9_000_000)
  })

  it('una celda sin fila de precio va como "no aplica", nunca como cero', () => {
    // Un cero se leería como "gratis" y esa es exactamente la factura que nadie
    // quiere mandar.
    const d = documentoDesdeEditor(estadoBase(), LOGO)
    const mariel = d.filas.find((f) => f.nombre === 'Mariel Estrella')!
    expect(mariel.celdas[0]!.amountCents).toBeNull()
    expect(mariel.celdas[0]!.status).toBe('NOT_APPLICABLE')
  })

  it('la caja de metadatos lleva los cuatro campos del original', () => {
    const d = documentoDesdeEditor(estadoBase(), LOGO)
    expect(d.meta.map((m) => m.etiqueta)).toEqual([
      'CLIENTE', 'CONTACTO', 'AGENTE', 'MONEDA',
    ])
    expect(d.meta[1]!.valor).toBe('Fer Nicolini')
  })

  it('sin contacto ni agente imprime una raya, no "null"', () => {
    const e = { ...estadoBase(), contacto: null, agente: null }
    const d = documentoDesdeEditor(e, LOGO)
    expect(d.meta[1]!.valor).toBe('—')
    expect(d.meta[2]!.valor).toBe('—')
  })

  it('es una función pura: dos llamadas dan lo mismo', () => {
    const e = estadoBase()
    expect(documentoDesdeEditor(e, LOGO)).toEqual(documentoDesdeEditor(e, LOGO))
  })
})

describe('vista previa y PDF son el mismo documento', () => {
  const FUENTES = { regularWoff2Base64: 'UkVH', boldWoff2Base64: 'Qk9M' }

  it('el cuerpo que pinta el navegador es EL MISMO que va dentro del PDF', () => {
    // Es la garantía estructural de todo el producto: lo que Chuy enseña en la
    // junta y lo que recibe la marca salen de la misma función.
    const doc = documentoDesdeEditor(estadoBase(), 'data:image/png;base64,AAAA')
    const cuerpo = renderDocumentBody(doc)
    const completo = renderDocumentHtml(doc, FUENTES, 'print')
    expect(completo).toContain(cuerpo)
    expect(completo.indexOf(cuerpo)).toBeGreaterThan(-1)
  })

  it('el modo no cambia una sola letra del resultado', () => {
    const doc = documentoDesdeEditor(estadoBase(), 'data:image/png;base64,AAAA')
    expect(renderDocumentHtml(doc, FUENTES, 'preview')).toBe(
      renderDocumentHtml(doc, FUENTES, 'print'),
    )
  })

  it('el cuerpo no trae la envoltura: sólo las páginas', () => {
    const cuerpo = renderDocumentBody(
      documentoDesdeEditor(estadoBase(), 'data:image/png;base64,AAAA'),
    )
    expect(cuerpo).not.toContain('<!doctype')
    expect(cuerpo).not.toContain('@font-face')
    expect(cuerpo.startsWith('<div class="pagina"')).toBe(true)
  })
})
