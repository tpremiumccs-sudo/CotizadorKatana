import { describe, it, expect } from 'vitest'
import {
  formatearFolio,
  parsearFolio,
  sugerirFolioCode,
  RE_FOLIO,
} from '@/server/quote/folio'

// Los ocho folios reales del registro de la agencia.
const FOLIOS_REALES = [
  'KAT-VPV-2026-001',
  'KAT-HON-2026-001',
  'KAT-NFX-2026-001',
  'KAT-UFC-2026-001',
  'KAT-PLR-2026-001',
  'KAT-VDS-2026-001',
  'KAT-RON-2026-001',
  'KAT-AZT-2026-001',
]

describe('parsearFolio', () => {
  it('reconoce todos los folios que la agencia ya tiene emitidos', () => {
    for (const f of FOLIOS_REALES) {
      const p = parsearFolio(f)
      expect(p, f).not.toBeNull()
      expect(p!.year).toBe(2026)
      expect(p!.seq).toBe(1)
      expect(p!.folioCode).toHaveLength(3)
      // Ida y vuelta sin pérdida.
      expect(formatearFolio(p!)).toBe(f)
    }
  })

  it('normaliza espacios y minúsculas', () => {
    expect(parsearFolio('  kat-hon-2026-001 ')).toEqual({
      folioCode: 'HON', year: 2026, seq: 1,
    })
  })

  it('admite consecutivos de más de tres dígitos sin romperse', () => {
    expect(parsearFolio('KAT-HON-2026-1234')).toEqual({
      folioCode: 'HON', year: 2026, seq: 1234,
    })
    expect(formatearFolio({ folioCode: 'HON', year: 2026, seq: 1234 })).toBe(
      'KAT-HON-2026-1234',
    )
  })

  it('rechaza lo que no es un folio', () => {
    for (const malo of [
      '', 'HON-2026-001', 'KAT-HONO-2026-001', 'KAT-HO-2026-001',
      'KAT-HON-26-001', 'KAT-HON-2026-1', 'cotización 1',
    ]) {
      expect(parsearFolio(malo), malo).toBeNull()
    }
  })
})

describe('formatearFolio', () => {
  it('rellena el consecutivo a tres dígitos', () => {
    expect(formatearFolio({ folioCode: 'HON', year: 2026, seq: 1 })).toBe(
      'KAT-HON-2026-001',
    )
    expect(formatearFolio({ folioCode: 'AZT', year: 2026, seq: 42 })).toBe(
      'KAT-AZT-2026-042',
    )
  })

  it('lo que produce siempre vuelve a parsearse', () => {
    for (let seq = 1; seq <= 250; seq += 7) {
      const f = formatearFolio({ folioCode: 'VPV', year: 2027, seq })
      expect(RE_FOLIO.test(f)).toBe(true)
      expect(parsearFolio(f)!.seq).toBe(seq)
    }
  })
})

describe('sugerirFolioCode', () => {
  it('acierta el patrón de iniciales en nombres de varias palabras', () => {
    // Es el patrón que la agencia ya usaba: Visit Puerto Vallarta → VPV.
    expect(sugerirFolioCode('Visit Puerto Vallarta')).toBe('VPV')
  })

  it('usa las primeras letras en nombres de una palabra', () => {
    expect(sugerirFolioCode('HONOR')).toBe('HON')
    expect(sugerirFolioCode('Netflix')).toBe('NET')
    expect(sugerirFolioCode('Gatorade')).toBe('GAT')
  })

  it('ignora palabras vacías y de forma societaria', () => {
    // "The" no aporta identidad: The Player → PLA (el histórico usa PLR, que se
    // conserva tal cual porque los códigos existentes no se recalculan).
    expect(sugerirFolioCode('The Player')).toBe('PLA')
    expect(sugerirFolioCode('Grupo Modelo')).toBe('MOD')
    expect(sugerirFolioCode('Cerveza Victoria SA de CV')).toBe('CVI')
  })

  it('siempre devuelve exactamente tres caracteres', () => {
    for (const n of ['A', 'Ok', 'HONOR', 'Visit Puerto Vallarta', 'X Y Z W', '···', '3M']) {
      const c = sugerirFolioCode(n)
      expect(c, n).toHaveLength(3)
      expect(c, n).toMatch(/^[A-Z0-9]{3}$/)
    }
  })

  it('quita acentos', () => {
    expect(sugerirFolioCode('Telcel México')).toBe('TEL')
    expect(sugerirFolioCode('Ángel')).toBe('ANG')
  })

  it('evita colisiones con códigos ya ocupados', () => {
    const ocupados = new Set(['HON', 'HNR', 'HO0'])
    const c = sugerirFolioCode('HONOR', ocupados)
    expect(ocupados.has(c)).toBe(false)
    expect(c).toMatch(/^[A-Z0-9]{3}$/)
  })

  it('sigue encontrando hueco cuando casi todo está tomado', () => {
    const ocupados = new Set<string>()
    // Todos los códigos que el generador probaría para este nombre.
    for (let i = 0; i < 10; i++) ocupados.add('HO' + i)
    ocupados.add('HON')
    ocupados.add('HNR')
    const c = sugerirFolioCode('HONOR', ocupados)
    expect(ocupados.has(c)).toBe(false)
  })

  it('los ocho clientes reales reciben códigos distintos entre sí', () => {
    const nombres = [
      'Visit Puerto Vallarta', 'HONOR', 'Netflix', 'UFC',
      'The Player', 'Viajes Lili', 'Ronaldo BXM', 'TV Azteca',
    ]
    const ocupados = new Set<string>()
    for (const n of nombres) {
      const c = sugerirFolioCode(n, ocupados)
      expect(ocupados.has(c), `${n} → ${c} repetido`).toBe(false)
      ocupados.add(c)
    }
    expect(ocupados.size).toBe(nombres.length)
  })
})
