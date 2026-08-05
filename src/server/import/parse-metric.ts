import type { MetricaParseada, ValorCelda } from './types'

/**
 * Interpreta un conteo de seguidores del roster.
 *
 * Los valores reales del archivo son texto libre y heterogéneo:
 *
 *   919K · 5.9M · 99.1.K · 7.1 M · 215k · 2M · 830k · 496.0 · 0.0
 *   48.9K aprox. — validar · 1.9M · 7.1 M
 *
 * Dos reglas gobiernan el diseño:
 *
 *   1. **Nunca lanza.** Una celda rara no puede tumbar una importación de 60
 *      talentos.
 *   2. **Nunca inventa un cero.** Si no se entiende, `seguidores` queda `null`
 *      y la fila se marca para revisión. Un 0 se ve igual que un dato real y
 *      acabaría en un media kit frente a una marca.
 */

const MULTIPLICADORES: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  mil: 1_000,
  millon: 1_000_000,
  millones: 1_000_000,
}

/** Debajo de esto, un "conteo de seguidores" probablemente es otra cosa. */
const MINIMO_PLAUSIBLE = 1_000

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseFollowerCount(
  crudoValor: ValorCelda,
  contexto: { plataforma?: string; talento?: string } = {},
): MetricaParseada {
  const crudo =
    crudoValor === null || crudoValor === undefined ? '' : String(crudoValor).trim()
  const notas: string[] = []

  if (crudo === '') {
    return { seguidores: null, crudo, confianza: 'FALLIDO', requiereRevision: false, notas: ['Celda vacía.'] }
  }

  // Número puro desde Excel: sin sufijo que interpretar.
  if (typeof crudoValor === 'number' && Number.isFinite(crudoValor)) {
    return finalizar(crudoValor, crudo, 'EXACTO', notas, contexto)
  }

  const norm = normalizar(crudo)

  // Texto adicional tras el número ("48.9K aprox. — validar"): se conserva como
  // nota y se baja la confianza, pero el número sí se aprovecha.
  const tieneRuido = /[a-z]{3,}/.test(norm.replace(/^[\d.,\s]*[kmb]?/, ''))

  // Un typo real del archivo: "99.1.K" lleva dos puntos. Se quita el sobrante.
  let limpio = norm
  const puntos = (limpio.match(/\./g) ?? []).length
  let inferido = false
  if (puntos > 1) {
    // Se conserva el primer punto como decimal y se eliminan los demás.
    const primero = limpio.indexOf('.')
    limpio =
      limpio.slice(0, primero + 1) + limpio.slice(primero + 1).replace(/\./g, '')
    notas.push(`Se corrigió un separador decimal repetido en "${crudo}".`)
    inferido = true
  }

  const m = /^([\d]+(?:[.,]\d+)?)\s*([kmb]|mil|millones?|)\b/.exec(limpio)
  if (!m) {
    return {
      seguidores: null,
      crudo,
      confianza: 'FALLIDO',
      requiereRevision: true,
      notas: [...notas, `No se pudo interpretar "${crudo}" como número de seguidores.`],
    }
  }

  const base = Number(m[1]!.replace(',', '.'))
  if (!Number.isFinite(base)) {
    return {
      seguidores: null, crudo, confianza: 'FALLIDO', requiereRevision: true,
      notas: [...notas, `Número ilegible en "${crudo}".`],
    }
  }

  const sufijo = m[2] ?? ''
  const factor = sufijo ? (MULTIPLICADORES[sufijo] ?? 1) : 1
  const valor = Math.round(base * factor)

  if (tieneRuido) {
    notas.push(`La celda trae texto además del número: "${crudo}".`)
    inferido = true
  }
  if (!sufijo && base < 1000 && !Number.isInteger(base)) {
    // "496.0" sin sufijo: casi seguro son 496 mil mal capturados, pero no se
    // adivina — se marca para que lo confirme quien actualiza el roster.
    notas.push(
      `"${crudo}" no trae sufijo y es un número muy bajo; ` +
        'confirma si son unidades o miles.',
    )
    inferido = true
  }

  return finalizar(valor, crudo, inferido ? 'INFERIDO' : 'EXACTO', notas, contexto)
}

function finalizar(
  valor: number,
  crudo: string,
  confianza: MetricaParseada['confianza'],
  notas: string[],
  contexto: { plataforma?: string; talento?: string },
): MetricaParseada {
  const seguidores = Math.round(valor)
  const notasFinales = [...notas]
  let requiereRevision = confianza !== 'EXACTO'

  if (seguidores < 0) {
    return {
      seguidores: null, crudo, confianza: 'FALLIDO', requiereRevision: true,
      notas: [...notasFinales, 'Conteo negativo.'],
    }
  }
  if (seguidores === 0) {
    notasFinales.push('El conteo es cero: probablemente falta capturarlo.')
    requiereRevision = true
  } else if (seguidores < MINIMO_PLAUSIBLE) {
    const quien = contexto.talento ? ` de ${contexto.talento}` : ''
    const donde = contexto.plataforma ? ` en ${contexto.plataforma}` : ''
    notasFinales.push(
      `El conteo${quien}${donde} es de solo ${seguidores}; revisa si faltó el sufijo K o M.`,
    )
    requiereRevision = true
  }

  return { seguidores, crudo, confianza, requiereRevision, notas: notasFinales }
}

/**
 * Formatea un conteo para la interfaz: 1200000 → "1.2M", 48900 → "48.9K".
 *
 * Un decimal cuando aporta y ninguno cuando no, que es la convención que ya usa
 * el roster ("919K", "48.9K", "122.5K", "5.9M"). Redondear 48.9K a 49K perdería
 * precisión que la agencia sí captura.
 */
export function formatearSeguidores(n: number | null): string {
  if (n === null) return '—'
  const conSufijo = (v: number, sufijo: string) =>
    `${v.toFixed(1).replace(/\.0$/, '')}${sufijo}`
  if (n >= 1_000_000) return conSufijo(n / 1_000_000, 'M')
  if (n >= 1_000) return conSufijo(n / 1_000, 'K')
  return String(n)
}
