import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  computeQuote,
  type CotizacionEntrada,
  type LineaEntrada,
  type EstadoPrecio,
} from '@/server/pricing/compute'
import { ImporteInvalidoError } from '@/lib/money'

const P = (pesos: number) => pesos * 100

function base(over: Partial<CotizacionEntrada> = {}): CotizacionEntrada {
  return {
    talents: [],
    lines: [],
    taxMode: 'ADDED',
    taxRateBps: 1600,
    ...over,
  }
}

function linea(over: Partial<LineaEntrada> = {}): LineaEntrada {
  return {
    id: 'l1',
    quoteTalentId: null,
    quantity: 1,
    unitAmountCents: P(1000),
    priceStatus: 'QUOTED',
    ...over,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Caso real: Azteca Peleas, folio KAT-AZT-2026-001
//
//  El CRM registra el alcance "1 Reel colaborativo + 4 Stories" y los importes
//  cotizados por talento. Las tarifas salen de la hoja TARIFARIO KATANA. Si el
//  motor no reproduce estas cifras, no sirve.
// ═══════════════════════════════════════════════════════════════════════════
describe('caso real — Azteca Peleas (KAT-AZT-2026-001)', () => {
  const TARIFAS = {
    'Luis Pride': { reelCollab: P(180_000), story: P(40_000), esperado: P(340_000) },
    'Tejón de la Miel': { reelCollab: P(180_000), story: P(40_000), esperado: P(340_000) },
    Ronny: { reelCollab: P(150_000), story: P(40_000), esperado: P(310_000) },
  } as const

  it.each(Object.entries(TARIFAS))(
    '%s: 1 Reel Collab + 4 Stories da el importe registrado en el CRM',
    (nombre, t) => {
      const r = computeQuote(
        base({
          talents: [{ id: 'T', displayName: nombre }],
          lines: [
            linea({ id: 'reel', quoteTalentId: 'T', quantity: 1, unitAmountCents: t.reelCollab }),
            linea({ id: 'stories', quoteTalentId: 'T', quantity: 4, unitAmountCents: t.story }),
          ],
        }),
      )
      expect(r.subtotalCents).toBe(t.esperado)
      expect(r.talents[0]!.netCents).toBe(t.esperado)
    },
  )

  it('Luis Pride: $340,000 + IVA 16 % = $394,400', () => {
    const r = computeQuote(
      base({
        talents: [{ id: 'T', displayName: 'Luis Pride' }],
        lines: [
          linea({ id: 'reel', quoteTalentId: 'T', quantity: 1, unitAmountCents: P(180_000) }),
          linea({ id: 'stories', quoteTalentId: 'T', quantity: 4, unitAmountCents: P(40_000) }),
        ],
      }),
    )
    expect(r.subtotalCents).toBe(P(340_000))
    expect(r.taxCents).toBe(P(54_400))
    expect(r.totalCents).toBe(P(394_400))
  })

  it('los cuatro talentos juntos suman lo que dice el CRM', () => {
    // Chuy Almada se cotizó en $400,000 con precios ajustados respecto al
    // tarifario: es justo el caso que justifica los overrides por cotización.
    const talentos = [
      { id: 'lp', displayName: 'Luis Pride', total: P(340_000) },
      { id: 'tj', displayName: 'Tejón de la Miel', total: P(340_000) },
      { id: 'ca', displayName: 'Chuy Almada', total: P(400_000) },
      { id: 'ro', displayName: 'Ronny', total: P(310_000) },
    ]
    const r = computeQuote(
      base({
        talents: talentos.map(({ id, displayName }) => ({ id, displayName })),
        lines: talentos.map((t) =>
          linea({ id: `l-${t.id}`, quoteTalentId: t.id, unitAmountCents: t.total }),
        ),
      }),
    )
    expect(r.subtotalCents).toBe(P(1_390_000))
    expect(r.taxCents).toBe(P(222_400))
    expect(r.totalCents).toBe(P(1_612_400))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('estados de precio', () => {
  const NO_COTIZADOS: EstadoPrecio[] = ['PENDING', 'NOT_APPLICABLE', 'CASE_BY_CASE']

  it.each(NO_COTIZADOS)('%s no suma y se marca como informativo', (estado) => {
    const r = computeQuote(
      base({
        talents: [{ id: 'T', displayName: 'Mariel Estrella' }],
        lines: [
          linea({ id: 'ok', quoteTalentId: 'T', unitAmountCents: P(100_000) }),
          linea({ id: 'no', quoteTalentId: 'T', unitAmountCents: null, priceStatus: estado }),
        ],
      }),
    )
    expect(r.subtotalCents).toBe(P(100_000))
    expect(r.lines.find((l) => l.id === 'no')!.totalCents).toBe(0)
    expect(r.lines.find((l) => l.id === 'no')!.informativa).toBe(true)
    expect(r.hasNonQuotedLines).toBe(true)
    expect(r.talents[0]!.lineasInformativas).toBe(1)
  })

  it('sólo PENDING bloquea la emisión', () => {
    const con = (estado: EstadoPrecio) =>
      computeQuote(
        base({
          talents: [{ id: 'T', displayName: 'X' }],
          lines: [
            linea({
              quoteTalentId: 'T',
              // QUOTED exige importe; los demás estados exigen que no lo haya.
              unitAmountCents: estado === 'QUOTED' ? P(1000) : null,
              priceStatus: estado,
            }),
          ],
        }),
      ).requiereResolverPendientes

    expect(con('PENDING')).toBe(true)
    expect(con('CASE_BY_CASE')).toBe(false)
    expect(con('NOT_APPLICABLE')).toBe(false)
    expect(con('QUOTED')).toBe(false)
  })

  it('un renglón no facturable se muestra pero no cobra', () => {
    const r = computeQuote(
      base({
        talents: [{ id: 'T', displayName: 'X' }],
        lines: [
          linea({ id: 'a', quoteTalentId: 'T', unitAmountCents: P(50_000) }),
          linea({ id: 'cortesia', quoteTalentId: 'T', unitAmountCents: P(50_000), isBillable: false }),
        ],
      }),
    )
    expect(r.subtotalCents).toBe(P(50_000))
    expect(r.lines.find((l) => l.id === 'cortesia')!.informativa).toBe(true)
  })

  it('un renglón QUOTED sin importe es un error, no un cero silencioso', () => {
    expect(() =>
      computeQuote(base({ lines: [linea({ unitAmountCents: null })] })),
    ).toThrow(ImporteInvalidoError)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('descuentos', () => {
  it('descuento de renglón por porcentaje y fijo', () => {
    const r = computeQuote(
      base({
        talents: [{ id: 'T', displayName: 'X' }],
        lines: [
          linea({
            id: 'pct', quoteTalentId: 'T', unitAmountCents: P(100_000),
            lineDiscountType: 'PERCENT', lineDiscountValue: 1000, // 10 %
          }),
          linea({
            id: 'fijo', quoteTalentId: 'T', unitAmountCents: P(100_000),
            lineDiscountType: 'FIXED', lineDiscountValue: P(15_000),
          }),
        ],
      }),
    )
    expect(r.lines.find((l) => l.id === 'pct')!.totalCents).toBe(P(90_000))
    expect(r.lines.find((l) => l.id === 'fijo')!.totalCents).toBe(P(85_000))
    expect(r.subtotalCents).toBe(P(175_000))
  })

  it('un descuento nunca deja el renglón en negativo', () => {
    const r = computeQuote(
      base({
        lines: [
          linea({ id: 'a', unitAmountCents: P(1000), lineDiscountType: 'FIXED', lineDiscountValue: P(9999) }),
          linea({ id: 'b', unitAmountCents: P(1000), lineDiscountType: 'PERCENT', lineDiscountValue: 50_000 }),
        ],
      }),
    )
    expect(r.lines.every((l) => l.totalCents >= 0)).toBe(true)
    expect(r.subtotalCents).toBe(0)
  })

  it('el descuento de paquete se reparte entre talentos sin perder centavos', () => {
    const r = computeQuote(
      base({
        talents: [
          { id: 'a', displayName: 'A' },
          { id: 'b', displayName: 'B' },
          { id: 'c', displayName: 'C' },
        ],
        lines: [
          linea({ id: 'la', quoteTalentId: 'a', unitAmountCents: P(100_000) }),
          linea({ id: 'lb', quoteTalentId: 'b', unitAmountCents: P(100_000) }),
          linea({ id: 'lc', quoteTalentId: 'c', unitAmountCents: P(100_000) }),
        ],
        packageDiscountType: 'FIXED',
        packageDiscountValue: 100, // $1.00 entre 3: no divide exacto
      }),
    )
    const repartido = r.talents.reduce((s, t) => s + t.allocatedPackageDiscountCents, 0)
    expect(repartido).toBe(100)
    expect(r.talents.reduce((s, t) => s + t.netCents, 0)).toBe(r.taxableBaseCents)
  })

  it('descuento de paquete por porcentaje sobre el subtotal', () => {
    const r = computeQuote(
      base({
        talents: [{ id: 'T', displayName: 'X' }],
        lines: [linea({ quoteTalentId: 'T', unitAmountCents: P(340_000) })],
        packageDiscountType: 'PERCENT',
        packageDiscountValue: 1000, // 10 %
      }),
    )
    expect(r.packageDiscountCents).toBe(P(34_000))
    expect(r.taxableBaseCents).toBe(P(306_000))
    expect(r.taxCents).toBe(P(48_960))
    expect(r.totalCents).toBe(P(354_960))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('impuesto', () => {
  it('EXEMPT no agrega IVA', () => {
    const r = computeQuote(
      base({
        taxMode: 'EXEMPT',
        lines: [linea({ unitAmountCents: P(340_000) })],
      }),
    )
    expect(r.taxCents).toBe(0)
    expect(r.totalCents).toBe(P(340_000))
  })

  it('rechaza una tasa fuera de rango', () => {
    for (const bps of [-1, 10_001, 1.5]) {
      expect(() => computeQuote(base({ taxRateBps: bps }))).toThrow(ImporteInvalidoError)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('validaciones y límites', () => {
  it('rechaza cantidades no positivas o no enteras', () => {
    for (const q of [0, -1, 1.5]) {
      expect(() => computeQuote(base({ lines: [linea({ quantity: q })] }))).toThrow(
        ImporteInvalidoError,
      )
    }
  })

  it('rechaza importes negativos', () => {
    expect(() =>
      computeQuote(base({ lines: [linea({ unitAmountCents: -1 })] })),
    ).toThrow(ImporteInvalidoError)
  })

  it('rechaza un renglón que apunta a un talento inexistente', () => {
    expect(() =>
      computeQuote(base({ lines: [linea({ quoteTalentId: 'fantasma' })] })),
    ).toThrow(/no está en la cotización/)
  })

  it('frena un total absurdo antes de que llegue a un PDF', () => {
    expect(() =>
      computeQuote(base({ lines: [linea({ unitAmountCents: P(30_000_000) })] })),
    ).toThrow(/supera el techo/)
  })

  it('frena un desbordamiento por cantidad enorme', () => {
    expect(() =>
      computeQuote(
        base({ lines: [linea({ quantity: 1_000_000_000, unitAmountCents: P(100_000) })] }),
      ),
    ).toThrow(ImporteInvalidoError)
  })

  it('una cotización vacía da todo en cero', () => {
    const r = computeQuote(base())
    expect(r).toMatchObject({
      grossCents: 0, subtotalCents: 0, taxCents: 0, totalCents: 0,
      hasNonQuotedLines: false, requiereResolverPendientes: false,
    })
  })

  it('un renglón sin talento suma al total pero no a ningún talento', () => {
    const r = computeQuote(
      base({
        talents: [{ id: 'T', displayName: 'X' }],
        lines: [
          linea({ id: 'general', quoteTalentId: null, unitAmountCents: P(10_000) }),
          linea({ id: 'suyo', quoteTalentId: 'T', unitAmountCents: P(20_000) }),
        ],
      }),
    )
    expect(r.subtotalCents).toBe(P(30_000))
    expect(r.talents[0]!.netCents).toBe(P(20_000))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('invariantes (propiedades)', () => {
  const arbLinea = (talentIds: string[]) =>
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      quoteTalentId: fc.constantFrom(...talentIds),
      quantity: fc.integer({ min: 1, max: 20 }),
      unitAmountCents: fc.integer({ min: 0, max: 5_000_000 }),
      priceStatus: fc.constantFrom<EstadoPrecio>(
        'QUOTED', 'QUOTED', 'QUOTED', 'PENDING', 'CASE_BY_CASE',
      ),
      lineDiscountType: fc.constantFrom<'PERCENT' | 'FIXED' | null>('PERCENT', 'FIXED', null),
      lineDiscountValue: fc.integer({ min: 0, max: 3000 }),
    })

  const arbCotizacion = fc
    .array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 6 })
    .chain((ids) => {
      const unicos = [...new Set(ids)]
      return fc.record({
        talents: fc.constant(unicos.map((id) => ({ id, displayName: id }))),
        lines: fc.array(arbLinea(unicos), { maxLength: 30 }),
        packageDiscountType: fc.constantFrom<'PERCENT' | 'FIXED' | null>('PERCENT', 'FIXED', null),
        packageDiscountValue: fc.integer({ min: 0, max: 2000 }),
        taxMode: fc.constantFrom<'ADDED' | 'EXEMPT'>('ADDED', 'EXEMPT'),
        taxRateBps: fc.constantFrom(0, 800, 1600),
      })
    })

  it('la suma de los netos por talento más el IVA es el total', () => {
    fc.assert(
      fc.property(arbCotizacion, (c) => {
        const r = computeQuote(c as CotizacionEntrada)
        // Todos los renglones del generador pertenecen a un talento, así que
        // los netos por talento deben cubrir exactamente la base gravable.
        const sumaNetos = r.talents.reduce((s, t) => s + t.netCents, 0)
        expect(sumaNetos).toBe(r.taxableBaseCents)
        expect(r.taxableBaseCents + r.taxCents).toBe(r.totalCents)
      }),
      { numRuns: 500 },
    )
  })

  it('el descuento de paquete repartido coincide exactamente con el aplicado', () => {
    fc.assert(
      fc.property(arbCotizacion, (c) => {
        const r = computeQuote(c as CotizacionEntrada)
        const repartido = r.talents.reduce(
          (s, t) => s + t.allocatedPackageDiscountCents, 0,
        )
        expect(repartido).toBe(r.packageDiscountCents)
      }),
      { numRuns: 500 },
    )
  })

  it('ningún importe sale negativo', () => {
    fc.assert(
      fc.property(arbCotizacion, (c) => {
        const r = computeQuote(c as CotizacionEntrada)
        for (const v of [
          r.grossCents, r.lineDiscountCents, r.subtotalCents,
          r.packageDiscountCents, r.taxableBaseCents, r.taxCents, r.totalCents,
        ]) {
          expect(v).toBeGreaterThanOrEqual(0)
        }
        expect(r.lines.every((l) => l.totalCents >= 0)).toBe(true)
        expect(r.talents.every((t) => t.netCents >= 0)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it('es determinista: dos ejecuciones con la misma entrada dan lo mismo', () => {
    fc.assert(
      fc.property(arbCotizacion, (c) => {
        expect(computeQuote(c as CotizacionEntrada)).toEqual(
          computeQuote(c as CotizacionEntrada),
        )
      }),
      { numRuns: 100 },
    )
  })
})
