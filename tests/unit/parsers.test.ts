import { describe, it, expect } from 'vitest'
import { parsePrice, etiquetaEstadoPrecio } from '@/server/import/parse-price'
import { parseFollowerCount, formatearSeguidores } from '@/server/import/parse-metric'
import {
  normalizeName, extractVariants, nameSimilarity, resolveIdentity,
  levenshteinRatio, jaroWinkler, tokenSetRatio, UMBRAL_REVISION,
  type TalentoConocido,
} from '@/server/import/identity'
import { normalizeHeader, esFilaCentinela } from '@/server/import/header'
import { rosterDesdeTipo } from '@/server/import/plan'

// ═══════════════════════════════════════════════════════════════════════════
describe('parsePrice', () => {
  it('interpreta los tres tokens que existen en el archivo real', () => {
    expect(parsePrice('Pendiente')).toMatchObject({ status: 'PENDING', amountCents: null, ok: true })
    expect(parsePrice('N/A')).toMatchObject({ status: 'NOT_APPLICABLE', amountCents: null, ok: true })
    expect(parsePrice('Caso por caso')).toMatchObject({ status: 'CASE_BY_CASE', amountCents: null, ok: true })
  })

  it('acepta variantes de escritura de esos tokens', () => {
    for (const v of ['pendiente', 'PENDIENTE', ' Pendiente ', 'Por definir', 'Por confirmar']) {
      expect(parsePrice(v).status, v).toBe('PENDING')
    }
    for (const v of ['n/a', 'N/A', 'NA', 'No aplica', 'no  aplica']) {
      expect(parsePrice(v).status, v).toBe('NOT_APPLICABLE')
    }
    for (const v of ['caso por caso', 'Caso Por Caso', 'A cotizar', 'Cotizar']) {
      expect(parsePrice(v).status, v).toBe('CASE_BY_CASE')
    }
  })

  it('convierte números a centavos', () => {
    expect(parsePrice(150000)).toMatchObject({ amountCents: 15_000_000, status: 'QUOTED' })
    expect(parsePrice(150000.0)).toMatchObject({ amountCents: 15_000_000, status: 'QUOTED' })
    expect(parsePrice('$150,000')).toMatchObject({ amountCents: 15_000_000, status: 'QUOTED' })
    expect(parsePrice('195000')).toMatchObject({ amountCents: 19_500_000, status: 'QUOTED' })
  })

  it('una celda vacía no es un cero', () => {
    const r = parsePrice('')
    expect(r.ok).toBe(false)
    expect(r.amountCents).toBeNull()
    expect(r.status).toBeNull()
    expect(r.aviso?.codigo).toBe('CELDA_VACIA')
    expect(parsePrice(null).aviso?.codigo).toBe('CELDA_VACIA')
  })

  it('un token desconocido se marca para revisión en vez de adivinarse', () => {
    const r = parsePrice('Preguntar a Chuy')
    expect(r.ok).toBe(false)
    expect(r.amountCents).toBeNull()
    expect(r.aviso?.codigo).toBe('TOKEN_NO_RECONOCIDO')
    expect(r.aviso?.mensaje).toContain('Pendiente')
  })

  it('rechaza importes negativos', () => {
    expect(parsePrice(-100).ok).toBe(false)
    expect(parsePrice(-100).aviso?.codigo).toBe('NEGATIVO')
  })

  it('avisa de magnitudes inverosímiles sin bloquear', () => {
    const bajo = parsePrice(50) // $50 de tarifa de influencer
    expect(bajo.ok).toBe(true)
    expect(bajo.aviso?.codigo).toBe('MAGNITUD_SOSPECHOSA')

    const alto = parsePrice(99_000_000)
    expect(alto.ok).toBe(true)
    expect(alto.aviso?.codigo).toBe('MAGNITUD_SOSPECHOSA')

    expect(parsePrice(150_000).aviso).toBeUndefined()
  })

  it('las etiquetas están en español', () => {
    expect(etiquetaEstadoPrecio('PENDING')).toBe('Tarifa pendiente')
    expect(etiquetaEstadoPrecio('CASE_BY_CASE')).toBe('Caso por caso')
    expect(etiquetaEstadoPrecio('NOT_APPLICABLE')).toBe('No aplica')
    expect(etiquetaEstadoPrecio(null)).toBe('Sin dato')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('parseFollowerCount', () => {
  it('interpreta los formatos que trae el roster real', () => {
    const casos: Array<[string, number]> = [
      ['919K', 919_000],
      ['5.9M', 5_900_000],
      ['215k', 215_000],
      ['2M', 2_000_000],
      ['830k', 830_000],
      ['1.9M', 1_900_000],
      ['1.3M', 1_300_000],
      ['7.1 M', 7_100_000], // con espacio antes del sufijo
      ['958000', 958_000],
      ['122.5K', 122_500],
    ]
    for (const [crudo, esperado] of casos) {
      expect(parseFollowerCount(crudo).seguidores, crudo).toBe(esperado)
    }
  })

  it('corrige el typo real "99.1.K" y lo marca como inferido', () => {
    const r = parseFollowerCount('99.1.K')
    expect(r.seguidores).toBe(99_100)
    expect(r.confianza).toBe('INFERIDO')
    expect(r.requiereRevision).toBe(true)
    expect(r.notas.join(' ')).toContain('separador decimal')
  })

  it('aprovecha el número pese al texto suelto, marcándolo', () => {
    const r = parseFollowerCount('48.9K aprox. — validar')
    expect(r.seguidores).toBe(48_900)
    expect(r.confianza).toBe('INFERIDO')
    expect(r.requiereRevision).toBe(true)
  })

  it('un cero no se toma por bueno', () => {
    const r = parseFollowerCount('0.0')
    expect(r.seguidores).toBe(0)
    expect(r.requiereRevision).toBe(true)
    expect(r.notas.join(' ')).toContain('cero')
  })

  it('avisa cuando el conteo es sospechosamente bajo', () => {
    // "496.0" en el archivo son casi seguro 496 mil, pero no se adivina.
    const r = parseFollowerCount('496.0')
    expect(r.requiereRevision).toBe(true)
    expect(r.notas.join(' ')).toMatch(/sufijo|unidades o miles/)
  })

  it('nunca lanza y nunca inventa un número', () => {
    for (const malo of ['', '   ', 'pendiente', 'no disponible', '???', null, undefined]) {
      const r = parseFollowerCount(malo)
      expect(r.seguidores, String(malo)).toBeNull()
      expect(() => parseFollowerCount(malo)).not.toThrow()
    }
  })

  it('formatea para la interfaz', () => {
    expect(formatearSeguidores(1_200_000)).toBe('1.2M')
    expect(formatearSeguidores(919_000)).toBe('919K')
    expect(formatearSeguidores(48_900)).toBe('48.9K')
    expect(formatearSeguidores(500)).toBe('500')
    expect(formatearSeguidores(null)).toBe('—')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('normalizeName y variantes', () => {
  it('la normalización absorbe acentos, espacios y puntuación', () => {
    // Los dos casos reales que así se resuelven solos.
    expect(normalizeName('Tony Gastelum ')).toBe(normalizeName('Tony Gastélum'))
    expect(normalizeName('Tejon de la Miel')).toBe(normalizeName('Tejón de la Miel'))
    expect(normalizeName('  MARIEL   ESTRELLA  ')).toBe('mariel estrella')
  })

  it('extrae las formas alternativas de un nombre compuesto', () => {
    expect(extractVariants('Ronny (Ronaldo López)')).toEqual(
      expect.arrayContaining(['ronny', 'ronaldo lopez']),
    )
    expect(extractVariants('Kike Padilla / Rookie Leagues')).toEqual(
      expect.arrayContaining(['kike padilla', 'rookie leagues']),
    )
    expect(extractVariants('Padigol)')).toContain('padigol')
    expect(extractVariants('Mike “Máquina del Mal”')).toContain('mike maquina del mal')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('nameSimilarity', () => {
  it('el máximo con Levenshtein rescata los casos que la métrica compuesta pierde', () => {
    const a = normalizeName('Divino Espinoza')
    const b = normalizeName('Divino Espinosa')
    const compuesto = 0.6 * jaroWinkler(a, b) + 0.4 * tokenSetRatio(a, b)

    // La métrica compuesta sola lo dejaría por debajo de un umbral típico…
    expect(compuesto).toBeLessThan(0.8)
    // …y Levenshtein lo rescata muy por encima del umbral de revisión.
    expect(levenshteinRatio(a, b)).toBeGreaterThan(0.9)
    expect(nameSimilarity(a, b)).toBeGreaterThan(UMBRAL_REVISION)
  })

  it('los pares reales del CRM quedan por encima del umbral de revisión', () => {
    const pares: Array<[string, string]> = [
      ['Divino Espinoza', 'Divino Espinosa'],
      ['Mar Coronel', 'Mariely Coronel'],
      ['Juan de Dios', 'Juan de Dios García'],
      ['Padigol', 'Padigol / Santiago Padilla'],
    ]
    for (const [a, b] of pares) {
      const s = nameSimilarity(normalizeName(a), normalizeName(b))
      expect(s, `${a} ↔ ${b} = ${s}`).toBeGreaterThanOrEqual(UMBRAL_REVISION)
    }
  })

  it('talentos distintos NO se parecen: Yoiker y Ronny nunca deben fusionarse', () => {
    const pares: Array<[string, string]> = [
      ['Yoiker', 'Ronny'],
      ['Luis Pride', 'Mariel Estrella'],
      ['Neux', 'Nene Creative'],
      ['Tony Gastélum', 'Tejón de la Miel'],
    ]
    for (const [a, b] of pares) {
      const s = nameSimilarity(normalizeName(a), normalizeName(b))
      expect(s, `${a} ↔ ${b} = ${s}`).toBeLessThan(UMBRAL_REVISION)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('resolveIdentity', () => {
  const conocidos: TalentoConocido[] = [
    {
      talentId: 't4', codigo: 'KT-004', canonicalName: 'Ronaldo BXM', displayName: 'Ronny',
      // Alias sembrados a mano: ninguna métrica podría inferirlos.
      identificadores: ['ronaldo bxm', 'ronny', 'ronaldo lopez'],
    },
    {
      talentId: 't13', codigo: 'KT-013', canonicalName: 'Yoiker', displayName: 'Yoiker',
      identificadores: ['yoiker'],
    },
    {
      talentId: 't1', codigo: 'KT-001', canonicalName: 'Divino Espinoza', displayName: 'Divino Espinoza',
      identificadores: ['divino espinoza'],
    },
    {
      talentId: 't12', codigo: 'KT-012', canonicalName: 'Tony Gastelum', displayName: 'Tony Gastélum',
      identificadores: ['tony gastelum'],
    },
  ]

  it('la coincidencia exacta es la única automática', () => {
    const r = resolveIdentity('Ronny', conocidos)
    expect(r.decision).toBe('COINCIDENCIA_EXACTA')
    expect(r.mejor?.talentId).toBe('t4')
  })

  it('resuelve acentos y espacios sobrantes como coincidencia exacta', () => {
    // "Tony Gastelum " con espacio final, contra "Tony Gastélum" con acento.
    const r = resolveIdentity('Tony Gastelum ', conocidos)
    expect(r.decision).toBe('COINCIDENCIA_EXACTA')
    expect(r.mejor?.talentId).toBe('t12')
  })

  it('el alias sembrado hace exacto lo que ninguna métrica alcanzaría', () => {
    // Ronny ↔ Ronaldo BXM da 0.44 de similitud: sin el alias serían dos
    // talentos distintos y las tarifas quedarían partidas.
    expect(nameSimilarity('ronny', 'ronaldo bxm')).toBeLessThan(UMBRAL_REVISION)
    const r = resolveIdentity('Ronaldo BXM', conocidos)
    expect(r.decision).toBe('COINCIDENCIA_EXACTA')
    expect(r.mejor?.talentId).toBe('t4')
  })

  it('un parecido alto pide confirmación, no se fusiona solo', () => {
    const r = resolveIdentity('Divino Espinosa', conocidos)
    expect(r.decision).toBe('REQUIERE_REVISION')
    expect(r.mejor?.talentId).toBe('t1')
    expect(r.motivo).toContain('Confírmalo')
  })

  it('un nombre nuevo se propone como alta, sin candidatos falsos', () => {
    const r = resolveIdentity('Gambetiti', conocidos)
    expect(r.decision).toBe('CREAR_NUEVO')
    expect(r.alternativas).toEqual([])
  })

  it('nunca propone fusionar dos talentos que sí son distintos', () => {
    const r = resolveIdentity('Yoiker', conocidos)
    expect(r.mejor?.talentId).toBe('t13')
    expect(r.decision).toBe('COINCIDENCIA_EXACTA')
  })

  it('ofrece varias alternativas ordenadas para que decida una persona', () => {
    const muchos: TalentoConocido[] = [
      ...conocidos,
      { talentId: 'x1', codigo: null, canonicalName: 'Divino E', displayName: 'Divino E', identificadores: ['divino e'] },
      { talentId: 'x2', codigo: null, canonicalName: 'Divino', displayName: 'Divino', identificadores: ['divino'] },
    ]
    const r = resolveIdentity('Divino Espinosa', muchos)
    expect(r.decision).toBe('REQUIERE_REVISION')
    expect(r.alternativas.length).toBeGreaterThan(1)
    const puntajes = r.alternativas.map((a) => a.puntaje)
    expect([...puntajes].sort((a, b) => b - a)).toEqual(puntajes)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('normalizeHeader y filas centinela', () => {
  it('normaliza encabezados con acentos y signos', () => {
    expect(normalizeHeader('Última actualización')).toBe('ultimaactualizacion')
    expect(normalizeHeader('Tipo (casa / aliado)')).toBe('tipocasaaliado')
    expect(normalizeHeader('Fijación 7 días')).toBe('fijacion7dias')
    expect(normalizeHeader('TikTok + réplica Reel')).toBe('tiktokreplicareel')
  })

  it('reconoce las filas de ejemplo que el Excel marca para borrar', () => {
    expect(esFilaCentinela(['EJEMPLO', '— borrar esta fila —', '— borrar —'])).toBe(true)
    expect(esFilaCentinela(['KT-001', 'Divino Espinoza', 'Divino Espinoza'])).toBe(false)
    expect(esFilaCentinela(['[Qué hace, por qué importa]'])).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('rosterDesdeTipo', () => {
  it('clasifica como KATANA las seis variantes que trae la hoja TALENTOS', () => {
    for (const v of [
      'KATANA — Casa',
      'KATANA — Aliado (definir)',
      'KATANA — Acceso exclusivo',
      'KATANA — Operable',
      'KATANA — Ecosistema Tejón',
      'KATANA — Chuy',
    ]) {
      expect(rosterDesdeTipo(v), v).toBe('KATANA')
    }
  })

  it('saca del cotizador a quien la hoja marca como red comercial', () => {
    // Es exactamente la celda que hay que cambiarle a Gambetiti para excluirlo
    // desde la fuente, en vez de esconderlo en el frontend.
    expect(rosterDesdeTipo('KIF (red comercial)')).toBe('KIF')
    expect(rosterDesdeTipo('kif')).toBe('KIF')
    expect(rosterDesdeTipo('FIERA — Roster')).toBe('FIERA')
  })

  it('no reclasifica cuando la celda está vacía o no nombra una red', () => {
    // Devolver KATANA por omisión devolvería al cotizador a un aliado que la
    // hoja de KIF ya había marcado.
    expect(rosterDesdeTipo('')).toBeNull()
    expect(rosterDesdeTipo('   ')).toBeNull()
    expect(rosterDesdeTipo('Por definir')).toBeNull()
  })
})
