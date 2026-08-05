import type { CandidatoIdentidad, ResolucionIdentidad } from './types'

/**
 * Reconciliación de identidad de talentos entre los dos archivos.
 *
 * El problema, con los nombres reales:
 *
 *   Divino Espinoza      ↔ Divino Espinosa            (una letra)
 *   Ronny                ↔ Ronny (Ronaldo López)      ↔ Ronaldo BXM
 *   Mariely Coronel      ↔ Mar Coronel                ↔ Mariely
 *   Tony Gastélum        ↔ "Tony Gastelum "           (acento y espacio final)
 *   Tejón de la Miel     ↔ Tejon de la Miel
 *   Juan de Dios García  ↔ "Juan de Dios "
 *   Padigol / Santiago Padilla ↔ "Padigol)"
 *
 * Medido con la métrica compuesta habitual (0.6·Jaro-Winkler + 0.4·tokenSet):
 *
 *   Espinoza/Espinosa           = 0.717
 *   Mar Coronel/Mariely Coronel = 0.658
 *   Ronny/Ronaldo BXM           = 0.442
 *
 * Con el umbral típico de 0.72 los tres se crearían como talentos NUEVOS y las
 * tarifas quedarían colgando de registros duplicados. Por eso:
 *
 *   1. El puntaje es `max(compuesto, levenshteinRatio)` — el máximo rescata
 *      Espinoza/Espinosa, que por Levenshtein da 0.93.
 *   2. El umbral de revisión baja a 0.55 y se muestran hasta 8 alternativas.
 *   3. Los casos imposibles de inferir (Ronny ↔ Ronaldo BXM) se siembran como
 *      alias a mano.
 *   4. Sólo la coincidencia EXACTA es automática. Todo lo demás lo confirma
 *      una persona, y esa confirmación se guarda como alias para no volver a
 *      preguntar.
 */

export const UMBRAL_REVISION = 0.55

/** Normalización canónica: es la clave única de identidad del sistema. */
export function normalizeName(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extrae las formas alternativas que trae un mismo nombre.
 *
 * "Ronny (Ronaldo López)"        → ronny ronaldo lopez · ronny · ronaldo lopez
 * "Kike Padilla / Rookie Leagues"→ ambos lados de la barra
 * "Padigol / Santiago Padilla"   → ambos lados
 */
export function extractVariants(crudo: string): string[] {
  const variantes = new Set<string>()
  const completo = normalizeName(crudo)
  if (completo) variantes.add(completo)

  // Contenido entre paréntesis y lo de fuera.
  const conParentesis = /^(.*?)\s*\(([^)]*)\)\s*(.*)$/.exec(crudo)
  if (conParentesis) {
    const fuera = normalizeName(
      `${conParentesis[1] ?? ''} ${conParentesis[3] ?? ''}`,
    )
    const dentro = normalizeName(conParentesis[2] ?? '')
    if (fuera) variantes.add(fuera)
    if (dentro) variantes.add(dentro)
  }

  // Separadores de alias: / | · —
  for (const parte of crudo.split(/[/|·—]| - /)) {
    const n = normalizeName(parte)
    if (n) variantes.add(n)
  }

  return [...variantes].filter((v) => v.length >= 2)
}

// ─────────────────────────── Métricas de similitud ───────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previa = Array.from({ length: b.length + 1 }, (_, i) => i)
  let actual = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    actual[0] = i
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      actual[j] = Math.min(
        previa[j]! + 1,
        actual[j - 1]! + 1,
        previa[j - 1]! + costo,
      )
    }
    ;[previa, actual] = [actual, previa]
  }
  return previa[b.length]!
}

export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const ventana = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const usadoA = new Array<boolean>(a.length).fill(false)
  const usadoB = new Array<boolean>(b.length).fill(false)

  let coincidencias = 0
  for (let i = 0; i < a.length; i++) {
    const desde = Math.max(0, i - ventana)
    const hasta = Math.min(i + ventana + 1, b.length)
    for (let j = desde; j < hasta; j++) {
      if (usadoB[j] || a[i] !== b[j]) continue
      usadoA[i] = true
      usadoB[j] = true
      coincidencias++
      break
    }
  }
  if (coincidencias === 0) return 0

  let transposiciones = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!usadoA[i]) continue
    while (!usadoB[k]) k++
    if (a[i] !== b[k]) transposiciones++
    k++
  }
  transposiciones /= 2

  const m = coincidencias
  const jaro = (m / a.length + m / b.length + (m - transposiciones) / m) / 3

  // Bonificación de Winkler por prefijo común (máx. 4 caracteres).
  let prefijo = 0
  while (prefijo < 4 && prefijo < a.length && prefijo < b.length && a[prefijo] === b[prefijo]) {
    prefijo++
  }
  return jaro + prefijo * 0.1 * (1 - jaro)
}

/** Similitud de conjuntos de palabras: tolera orden distinto y palabras de más. */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return 0
  let comunes = 0
  for (const t of ta) if (tb.has(t)) comunes++
  return (2 * comunes) / (ta.size + tb.size)
}

/**
 * Puntaje final.
 *
 * El `max` con Levenshtein no es adorno: es lo que salva `Espinoza`/`Espinosa`,
 * donde la métrica compuesta da 0.717 y Levenshtein 0.93.
 */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const compuesto = 0.6 * jaroWinkler(a, b) + 0.4 * tokenSetRatio(a, b)
  return Math.max(compuesto, levenshteinRatio(a, b))
}

// ─────────────────────────── Resolución ───────────────────────────

export interface TalentoConocido {
  talentId: string
  codigo: string | null
  canonicalName: string
  displayName: string
  /** Todas las formas normalizadas que ya apuntan a este talento. */
  identificadores: string[]
}

/**
 * Decide a qué talento corresponde un nombre del archivo.
 *
 * Sólo la coincidencia exacta contra un identificador ya conocido es
 * automática. Cualquier parecido, por alto que sea, pasa por revisión humana:
 * fusionar dos talentos por error es mucho más caro que confirmar un chip.
 */
export function resolveIdentity(
  crudo: string,
  conocidos: readonly TalentoConocido[],
  opciones: { maxAlternativas?: number; umbral?: number } = {},
): ResolucionIdentidad {
  const maxAlternativas = opciones.maxAlternativas ?? 8
  const umbral = opciones.umbral ?? UMBRAL_REVISION

  const normalizado = normalizeName(crudo)
  const variantes = extractVariants(crudo)

  // ── Coincidencia exacta ────────────────────────────────────────────────
  for (const t of conocidos) {
    for (const ident of t.identificadores) {
      if (variantes.includes(ident)) {
        return {
          crudo,
          normalizado,
          variantes,
          decision: 'COINCIDENCIA_EXACTA',
          mejor: {
            talentId: t.talentId,
            codigo: t.codigo,
            canonicalName: t.canonicalName,
            displayName: t.displayName,
            coincidioPor: 'exacto',
            puntaje: 1,
          },
          alternativas: [],
          motivo: `Coincide exactamente con "${ident}".`,
        }
      }
    }
  }

  // ── Parecidos ──────────────────────────────────────────────────────────
  const candidatos: CandidatoIdentidad[] = []
  for (const t of conocidos) {
    let mejorPuntaje = 0
    let mejorPor: CandidatoIdentidad['coincidioPor'] = 'jaro'

    for (const ident of t.identificadores) {
      for (const v of variantes) {
        const lev = levenshteinRatio(v, ident)
        const compuesto = 0.6 * jaroWinkler(v, ident) + 0.4 * tokenSetRatio(v, ident)
        const puntaje = Math.max(lev, compuesto)
        if (puntaje > mejorPuntaje) {
          mejorPuntaje = puntaje
          mejorPor = lev >= compuesto ? 'levenshtein' : 'tokens'
        }
      }
    }

    if (mejorPuntaje >= umbral) {
      candidatos.push({
        talentId: t.talentId,
        codigo: t.codigo,
        canonicalName: t.canonicalName,
        displayName: t.displayName,
        coincidioPor: mejorPor,
        puntaje: Number(mejorPuntaje.toFixed(4)),
      })
    }
  }

  candidatos.sort((a, b) => b.puntaje - a.puntaje || a.displayName.localeCompare(b.displayName))
  const alternativas = candidatos.slice(0, maxAlternativas)

  if (alternativas.length === 0) {
    return {
      crudo,
      normalizado,
      variantes,
      decision: 'CREAR_NUEVO',
      alternativas: [],
      motivo: 'No se parece a ningún talento registrado.',
    }
  }

  const mejor = alternativas[0]!
  return {
    crudo,
    normalizado,
    variantes,
    decision: 'REQUIERE_REVISION',
    mejor,
    alternativas,
    motivo:
      `Se parece a "${mejor.displayName}" (${Math.round(mejor.puntaje * 100)} % de similitud). ` +
      'Confírmalo para que no se dupliquen las tarifas.',
  }
}

/**
 * Alias que ninguna métrica puede inferir y que por tanto se siembran a mano.
 *
 * Sin ellos, la primera importación crearía talentos duplicados justo para los
 * perfiles con más movimiento comercial.
 */
export const ALIAS_SEMBRADOS: Array<{ codigo: string; alias: string[] }> = [
  { codigo: 'KT-004', alias: ['Ronny', 'Ronaldo BXM', 'Ronny (Ronaldo López)', 'Ronaldo López', 'Ronaldo “Ronny” BXM'] },
  { codigo: 'KT-008', alias: ['Mar Coronel', 'Mariely Coronel', 'Mariely', 'Marieli Coronel'] },
  { codigo: 'KT-001', alias: ['Divino Espinosa', 'Divino Espinoza', 'Rafael Divino Espinoza'] },
  { codigo: 'KT-005', alias: ['Tejon de la Miel', 'Tejón de la Miel', 'Tadeo Magno'] },
  { codigo: 'KT-006', alias: ['Mama Tejona', 'Mamá Tejona'] },
  { codigo: 'KT-012', alias: ['Tony Gastelum', 'Tony Gastélum'] },
  { codigo: 'KT-014', alias: ['Kike Padilla', 'Kike Padilla / Rookie Leagues', 'Rookie Leagues'] },
  { codigo: 'KT-016', alias: ['Mike Maquina del Mal', 'Mike Máquina del Mal', 'Mike “Máquina del Mal”'] },
  { codigo: 'KT-027', alias: ['Juan de Dios', 'Juan de Dios García', 'Juan de Dios G'] },
  { codigo: 'KT-028', alias: ['Padigol', 'Padigol / Santiago Padilla', 'Santiago Padilla'] },
]
