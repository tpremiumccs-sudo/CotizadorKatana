import { pesosToCents, ImporteInvalidoError } from '@/lib/money'
import type { PrecioParseado, ValorCelda } from './types'

/**
 * Interpreta una celda de precio del TARIFARIO.
 *
 * Medido sobre el archivo real: 21 talentos × 19 formatos = 399 celdas, de las
 * cuales 182 son números y 217 son palabras — `N/A` 93 veces, `Pendiente` 87 y
 * `Caso por caso` 37. Ninguna está vacía.
 *
 * Cada palabra significa algo distinto en el negocio y por eso no se puede
 * colapsar todo en "0":
 *
 *   · `Pendiente`     → la tarifa existe pero no se ha definido. BLOQUEA emitir.
 *   · `N/A`           → el talento no ofrece ese formato.
 *   · `Caso por caso` → se cotiza aparte, según el proyecto.
 *
 * Un token que no se reconozca devuelve `ok: false`: no se adivina. Ese renglón
 * aparece en la revisión para que lo decida una persona.
 */

const TOKENS: Array<{ patron: RegExp; status: PrecioParseado['status'] }> = [
  { patron: /^pendiente$/, status: 'PENDING' },
  { patron: /^por\s+definir$/, status: 'PENDING' },
  { patron: /^por\s+confirmar$/, status: 'PENDING' },
  { patron: /^n\s*\/?\s*a$/, status: 'NOT_APPLICABLE' },
  { patron: /^no\s+aplica$/, status: 'NOT_APPLICABLE' },
  { patron: /^caso\s+por\s+caso$/, status: 'CASE_BY_CASE' },
  { patron: /^a\s+cotizar$/, status: 'CASE_BY_CASE' },
  { patron: /^cotizar$/, status: 'CASE_BY_CASE' },
]

/** Por debajo de esto, un "precio" casi seguro es otra cosa (un año, un conteo). */
const MINIMO_PLAUSIBLE_CENTAVOS = 100_00 // $100
/** Por encima de esto, huele a que alguien multiplicó de más. */
const MAXIMO_PLAUSIBLE_CENTAVOS = 50_000_000_00 // $50,000,000

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function parsePrice(crudoValor: ValorCelda): PrecioParseado {
  const crudo =
    crudoValor === null || crudoValor === undefined ? '' : String(crudoValor).trim()

  if (crudo === '') {
    return {
      amountCents: null,
      status: null,
      crudo,
      ok: false,
      aviso: { codigo: 'CELDA_VACIA', mensaje: 'La celda está vacía.' },
    }
  }

  // ── Número directo desde Excel ─────────────────────────────────────────
  if (typeof crudoValor === 'number') {
    if (!Number.isFinite(crudoValor)) {
      return {
        amountCents: null, status: null, crudo, ok: false,
        aviso: { codigo: 'TOKEN_NO_RECONOCIDO', mensaje: `Número inválido: ${crudo}` },
      }
    }
    if (crudoValor < 0) {
      return {
        amountCents: null, status: null, crudo, ok: false,
        aviso: { codigo: 'NEGATIVO', mensaje: `Importe negativo: ${crudo}` },
      }
    }
    const centavos = pesosToCents(crudoValor)
    return { amountCents: centavos, status: 'QUOTED', crudo, ok: true, ...avisoMagnitud(centavos) }
  }

  // ── Palabra conocida ───────────────────────────────────────────────────
  const norm = normalizar(crudo)
  for (const { patron, status } of TOKENS) {
    if (patron.test(norm)) {
      return { amountCents: null, status, crudo, ok: true }
    }
  }

  // ── Texto que contiene un importe ("$150,000", "150000 MXN") ───────────
  try {
    const centavos = pesosToCents(crudo)
    if (centavos < 0) {
      return {
        amountCents: null, status: null, crudo, ok: false,
        aviso: { codigo: 'NEGATIVO', mensaje: `Importe negativo: ${crudo}` },
      }
    }
    return { amountCents: centavos, status: 'QUOTED', crudo, ok: true, ...avisoMagnitud(centavos) }
  } catch (e) {
    if (!(e instanceof ImporteInvalidoError)) throw e
    return {
      amountCents: null,
      status: null,
      crudo,
      ok: false,
      aviso: {
        codigo: 'TOKEN_NO_RECONOCIDO',
        mensaje:
          `No se reconoce "${crudo}" como precio ni como estado conocido ` +
          '(Pendiente, N/A, Caso por caso).',
      },
    }
  }
}

function avisoMagnitud(centavos: number): Pick<PrecioParseado, 'aviso'> {
  if (centavos > 0 && centavos < MINIMO_PLAUSIBLE_CENTAVOS) {
    return {
      aviso: {
        codigo: 'MAGNITUD_SOSPECHOSA',
        mensaje:
          `El importe es muy bajo para una tarifa de talento. ` +
          '¿Está en pesos o se coló otro dato?',
      },
    }
  }
  if (centavos > MAXIMO_PLAUSIBLE_CENTAVOS) {
    return {
      aviso: {
        codigo: 'MAGNITUD_SOSPECHOSA',
        mensaje: 'El importe es inusualmente alto. Revisa si se multiplicó de más.',
      },
    }
  }
  return {}
}

/** Etiqueta en español para la UI y el documento. */
export function etiquetaEstadoPrecio(
  status: PrecioParseado['status'],
): string {
  switch (status) {
    case 'QUOTED':
      return 'Cotizado'
    case 'PENDING':
      return 'Tarifa pendiente'
    case 'NOT_APPLICABLE':
      return 'No aplica'
    case 'CASE_BY_CASE':
      return 'Caso por caso'
    default:
      return 'Sin dato'
  }
}
