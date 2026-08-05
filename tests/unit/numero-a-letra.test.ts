import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { importeALetra, enteroALetra } from '@/lib/doc/numero-a-letra'

describe('importeALetra', () => {
  it('escribe el total de la cotización de Azteca Peleas', () => {
    // $340,000 + IVA 16 % = $394,400
    expect(importeALetra(394_400_00)).toBe(
      'TRESCIENTOS NOVENTA Y CUATRO MIL CUATROCIENTOS PESOS 00/100 M.N.',
    )
  })

  it('escribe importes con centavos', () => {
    expect(importeALetra(123_45)).toBe('CIENTO VEINTITRÉS PESOS 45/100 M.N.')
    expect(importeALetra(1_00)).toBe('UN PESO 00/100 M.N.')
    expect(importeALetra(0)).toBe('CERO PESOS 00/100 M.N.')
  })

  it('resuelve los casos que suelen salir mal', () => {
    expect(enteroALetra(100)).toBe('CIEN')
    expect(enteroALetra(101)).toBe('CIENTO UNO')
    expect(enteroALetra(21)).toBe('VEINTIUNO')
    expect(enteroALetra(22)).toBe('VEINTIDÓS')
    expect(enteroALetra(16)).toBe('DIECISÉIS')
    expect(enteroALetra(31)).toBe('TREINTA Y UNO')
    expect(enteroALetra(1000)).toBe('MIL')
    expect(enteroALetra(1001)).toBe('MIL UNO')
    expect(enteroALetra(2000)).toBe('DOS MIL')
    expect(enteroALetra(1_000_000)).toBe('UN MILLÓN')
    expect(enteroALetra(2_000_000)).toBe('DOS MILLONES')
  })

  it('escribe los importes reales del tarifario', () => {
    expect(enteroALetra(340_000)).toBe('TRESCIENTOS CUARENTA MIL')
    expect(enteroALetra(195_000)).toBe('CIENTO NOVENTA Y CINCO MIL')
    expect(enteroALetra(750_000)).toBe('SETECIENTOS CINCUENTA MIL')
    expect(enteroALetra(1_612_400)).toBe(
      'UN MILLÓN SEISCIENTOS DOCE MIL CUATROCIENTOS',
    )
  })

  it('nunca produce espacios dobles ni cadenas vacías', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), (centavos) => {
        const s = importeALetra(centavos)
        expect(s).not.toMatch(/\s{2,}/)
        expect(s.length).toBeGreaterThan(10)
        expect(s).toMatch(/\d{2}\/100 M\.N\.$/)
      }),
      { numRuns: 500 },
    )
  })

  it('rechaza entradas imposibles en vez de escribir algo raro', () => {
    expect(() => importeALetra(-1)).toThrow()
    expect(() => importeALetra(10.5)).toThrow()
  })
})

describe('apócope de "uno"', () => {
  it('dice UN PESO, VEINTIÚN PESOS y TREINTA Y UN PESOS', () => {
    expect(importeALetra(1_00)).toBe('UN PESO 00/100 M.N.')
    expect(importeALetra(21_00)).toBe('VEINTIÚN PESOS 00/100 M.N.')
    expect(importeALetra(31_00)).toBe('TREINTA Y UN PESOS 00/100 M.N.')
    expect(importeALetra(101_00)).toBe('CIENTO UN PESOS 00/100 M.N.')
    expect(importeALetra(1_000_001_00)).toBe('UN MILLÓN UN PESOS 00/100 M.N.')
  })

  it('no apocopa donde no corresponde', () => {
    expect(importeALetra(11_00)).toBe('ONCE PESOS 00/100 M.N.')
    expect(importeALetra(2_00)).toBe('DOS PESOS 00/100 M.N.')
  })
})
