import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  pesosToCents,
  formatMXN,
  centsToPesos,
  aplicarBps,
  repartirProporcional,
  verificarTecho,
  ImporteInvalidoError,
  TECHO_CENTAVOS,
} from '@/lib/money'

describe('pesosToCents', () => {
  it('convierte enteros y decimales simples', () => {
    expect(pesosToCents(0)).toBe(0)
    expect(pesosToCents(1)).toBe(100)
    expect(pesosToCents(100_000)).toBe(10_000_000)
    expect(pesosToCents('1234.50')).toBe(123_450)
    expect(pesosToCents('0.01')).toBe(1)
  })

  it('redondea HALF_UP de verdad, donde toFixed y Math.round fallan', () => {
    // $1.005 y $8.575 no son representables en binario: el flotante más cercano
    // queda por debajo, así que los dos atajos habituales pierden el centavo.
    // Son exactamente los casos que descuadran una cotización.
    expect((1.005).toFixed(2)).toBe('1.00') // debería ser 1.01
    expect(Math.round(1.005 * 100)).toBe(100) // debería ser 101
    expect(pesosToCents(1.005)).toBe(101)

    expect((8.575).toFixed(2)).toBe('8.57') // debería ser 8.58
    expect(Math.round(8.575 * 100)).toBe(857) // debería ser 858
    expect(pesosToCents(8.575)).toBe(858)

    expect(pesosToCents('1234.565')).toBe(123_457)
    expect(pesosToCents('0.005')).toBe(1)
    expect(pesosToCents('0.004')).toBe(0)
    expect(pesosToCents('2.675')).toBe(268)
  })

  it('acepta lo que un humano teclea en el editor', () => {
    expect(pesosToCents('$100,000')).toBe(10_000_000)
    expect(pesosToCents('$ 1,234.50')).toBe(123_450)
    expect(pesosToCents('195,000')).toBe(19_500_000)
    expect(pesosToCents('1 234.50')).toBe(123_450)
    expect(pesosToCents('50000 MXN')).toBe(5_000_000)
  })

  it('resuelve la ambigüedad de la coma por la forma del número', () => {
    // Tres dígitos tras la coma y un solo grupo ⇒ millares.
    expect(pesosToCents('1,234')).toBe(123_400)
    expect(pesosToCents('1,234,567')).toBe(123_456_700)
    // Dos dígitos ⇒ decimal a la europea.
    expect(pesosToCents('1234,50')).toBe(123_450)
    // Con ambos separadores manda el último que aparece.
    expect(pesosToCents('1.234,50')).toBe(123_450)
    expect(pesosToCents('1,234.50')).toBe(123_450)
  })

  it('rechaza lo que no es un importe en vez de inventar un cero', () => {
    for (const malo of ['', '   ', 'abc', 'Pendiente', 'N/A', 'Caso por caso', '.']) {
      expect(() => pesosToCents(malo)).toThrow(ImporteInvalidoError)
    }
    expect(() => pesosToCents(Number.NaN)).toThrow(ImporteInvalidoError)
    expect(() => pesosToCents(Number.POSITIVE_INFINITY)).toThrow(ImporteInvalidoError)
  })
})

describe('formatMXN', () => {
  it('imprime como el PDF original: sin decimales cuando son redondos', () => {
    expect(formatMXN(10_000_000)).toBe('$100,000')
    expect(formatMXN(12_000_000)).toBe('$120,000')
    expect(formatMXN(4_000_000)).toBe('$40,000')
    expect(formatMXN(19_500_000)).toBe('$195,000')
    expect(formatMXN(0)).toBe('$0')
  })

  it('muestra los centavos sólo cuando los hay', () => {
    expect(formatMXN(123_450)).toBe('$1,234.50')
    expect(formatMXN(1)).toBe('$0.01')
    expect(formatMXN(10_000_000, { forzarDecimales: true })).toBe('$100,000.00')
  })

  it('agrupa millares y admite negativos y sin símbolo', () => {
    expect(formatMXN(100_000_000)).toBe('$1,000,000')
    expect(formatMXN(-4_000_000)).toBe('-$40,000')
    expect(formatMXN(10_000_000, { conSimbolo: false })).toBe('100,000')
  })

  it('no depende de Intl ni del entorno', () => {
    // El mismo importe debe imprimirse igual con cualquier locale de proceso.
    const antes = process.env.LANG
    try {
      process.env.LANG = 'de_DE.UTF-8'
      expect(formatMXN(123_450)).toBe('$1,234.50')
      process.env.LANG = 'en_US.UTF-8'
      expect(formatMXN(123_450)).toBe('$1,234.50')
    } finally {
      process.env.LANG = antes
    }
  })
})

describe('centsToPesos', () => {
  it('siempre da dos decimales', () => {
    expect(centsToPesos(10_000_000)).toBe('100000.00')
    expect(centsToPesos(1)).toBe('0.01')
    expect(centsToPesos(0)).toBe('0.00')
  })
})

describe('aplicarBps', () => {
  it('calcula el IVA del 16 % exacto', () => {
    expect(aplicarBps(34_000_000, 1600)).toBe(5_440_000) // $340,000 → $54,400
    expect(aplicarBps(0, 1600)).toBe(0)
  })

  it('redondea HALF_UP', () => {
    // 1 centavo × 50 % = 0.5 → 1
    expect(aplicarBps(1, 5000)).toBe(1)
    // 3 centavos × 16 % = 0.48 → 0
    expect(aplicarBps(3, 1600)).toBe(0)
  })

  it('exige centavos enteros', () => {
    expect(() => aplicarBps(10.5, 1600)).toThrow(ImporteInvalidoError)
  })
})

describe('repartirProporcional', () => {
  it('reparte exacto cuando divide bien', () => {
    expect(repartirProporcional(100, [1, 1])).toEqual([50, 50])
    expect(repartirProporcional(300, [1, 1, 1])).toEqual([100, 100, 100])
  })

  it('coloca los centavos sobrantes por resto mayor', () => {
    // 100 entre 3 partes iguales: 33.33 cada una ⇒ 34, 33, 33.
    expect(repartirProporcional(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(repartirProporcional(10, [1, 2, 3])).toEqual([2, 3, 5])
  })

  it('nunca pierde ni inventa un centavo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 1, maxLength: 25 }),
        (total, pesos) => {
          const r = repartirProporcional(total, pesos)
          expect(r).toHaveLength(pesos.length)
          expect(r.reduce((a, b) => a + b, 0)).toBe(total)
          expect(r.every((v) => v >= 0)).toBe(true)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('es determinista: dos ejecuciones dan el mismo reparto', () => {
    const a = repartirProporcional(1_000_001, [7, 7, 7, 7])
    const b = repartirProporcional(1_000_001, [7, 7, 7, 7])
    expect(a).toEqual(b)
  })

  it('sin base para repartir, no pierde el importe', () => {
    expect(repartirProporcional(500, [0, 0, 0])).toEqual([500, 0, 0])
    expect(repartirProporcional(500, [])).toEqual([])
  })
})

describe('verificarTecho', () => {
  it('deja pasar importes normales y frena los absurdos', () => {
    expect(() => verificarTecho(39_440_000, 'prueba')).not.toThrow()
    expect(() => verificarTecho(TECHO_CENTAVOS, 'prueba')).not.toThrow()
    expect(() => verificarTecho(TECHO_CENTAVOS + 1, 'prueba')).toThrow(
      /supera el techo/,
    )
  })

  it('el mensaje sugiere la causa real', () => {
    // El error típico: multiplicar por 100 un importe que ya venía en centavos.
    expect(() => verificarTecho(34_000_000 * 100, 'Total')).toThrow(
      /multiplicó por 100/,
    )
  })
})

describe('defensas contra entradas imposibles', () => {
  // Estas ramas no deberían dispararse nunca en uso normal, pero son la red
  // que impide que un importe corrupto llegue a un PDF que ve una marca.

  it('pesosToCents rechaza un número astronómico en vez de devolver basura', () => {
    // Notación científica: ni siquiera es un importe tecleable.
    expect(() => pesosToCents('1e300')).toThrow(/No se pudo interpretar/)
    // Dígitos válidos pero fuera del entero seguro al pasar a centavos.
    expect(() => pesosToCents('1' + '0'.repeat(20))).toThrow(/fuera de rango/)
  })

  it('formatMXN rechaza un importe no finito', () => {
    expect(() => formatMXN(Number.NaN)).toThrow(/no finito/)
    expect(() => formatMXN(Number.POSITIVE_INFINITY)).toThrow(/no finito/)
  })

  it('repartirProporcional exige centavos enteros', () => {
    expect(() => repartirProporcional(10.5, [1, 1])).toThrow(/centavos enteros/)
  })
})
