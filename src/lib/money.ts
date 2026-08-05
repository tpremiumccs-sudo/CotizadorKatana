import Big from 'big.js'

/**
 * Dinero, en centavos enteros de peso mexicano.
 *
 * Dos reglas que no se negocian:
 *
 *  1. **Nunca coma flotante.** Todo importe vive como `number` entero de
 *     centavos. `0.1 + 0.2 !== 0.3` y una cotización de $394,400 que imprime
 *     $394,399.99 es un problema con la marca, no un detalle técnico.
 *
 *  2. **Nunca `Intl.NumberFormat`.** El formato del documento tiene que salir
 *     idéntico en el servidor (Node dentro de Docker) y en el iPad (Safari).
 *     Las versiones de ICU difieren entre plataformas en el separador, el
 *     espacio antes del símbolo y el soporte de `currencyDisplay`. El
 *     formateo se hace a mano y así el PDF y la vista previa coinciden siempre.
 */

// big.js redondea HALF_UP por omisión (Big.RM = 1), que es lo que se espera al
// convertir pesos a centavos. Se fija de forma explícita por si otro módulo lo
// cambiara: es una variable global de la librería.
Big.RM = Big.roundHalfUp
Big.DP = 10

/** Techo de $20,000,000.00 MXN. Cabe en Int32 y atrapa un error de ×100. */
export const TECHO_CENTAVOS = 2_000_000_000

export class ImporteInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ImporteInvalidoError'
  }
}

/**
 * Convierte pesos a centavos con redondeo HALF_UP exacto.
 *
 * Acepta cadena o número. Con número se pasa por `String(n)`, que da la
 * representación decimal más corta que redondea al mismo flotante: así
 * `1234.565` se interpreta como "1234.565" y no como el 1234.5649999999998
 * que realmente guarda el flotante. Por eso da 123457 y no 123456, que es lo
 * que devolvería `Math.round(n * 100)` o `n.toFixed(2)`.
 */
export function pesosToCents(entrada: string | number): number {
  if (typeof entrada === 'number' && !Number.isFinite(entrada)) {
    throw new ImporteInvalidoError(`Importe no finito: ${entrada}`)
  }

  const texto = typeof entrada === 'number' ? String(entrada) : entrada.trim()
  if (texto === '') throw new ImporteInvalidoError('Importe vacío')

  // Se admite lo que un humano teclea: "$1,234.50", "1 234,50", "1234.5"
  const limpio = normalizarEntradaNumerica(texto)

  let big: Big
  try {
    big = new Big(limpio)
  } catch {
    throw new ImporteInvalidoError(`No se pudo interpretar el importe: ${entrada}`)
  }

  const centavos = Number(big.times(100).round(0, Big.roundHalfUp).toString())
  if (!Number.isSafeInteger(centavos)) {
    throw new ImporteInvalidoError(`Importe fuera de rango: ${entrada}`)
  }
  return centavos
}

/**
 * Normaliza lo que se teclea en el editor a un decimal que big.js entiende.
 *
 * El caso ambiguo real es "1,234": en México puede ser mil doscientos treinta y
 * cuatro (separador de millares). Se resuelve por forma: si la coma va seguida
 * de exactamente tres dígitos y hay más de un grupo o también hay punto, es
 * separador de millares.
 */
function normalizarEntradaNumerica(texto: string): string {
  let s = texto
    .replace(/[$\s  ]/g, '')
    .replace(/(MXN|MN|M\.N\.)/gi, '')
    .trim()

  const negativo = /^-/.test(s) || /^\(.*\)$/.test(s)
  s = s.replace(/^-/, '').replace(/^\((.*)\)$/, '$1')

  const tieneComa = s.includes(',')
  const tienePunto = s.includes('.')

  if (tieneComa && tienePunto) {
    // El último separador que aparece es el decimal.
    s =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '')
  } else if (tieneComa) {
    const partes = s.split(',')
    const esMillares =
      partes.length > 2 || (partes.length === 2 && partes[1]!.length === 3)
    s = esMillares ? s.replace(/,/g, '') : s.replace(',', '.')
  }

  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') {
    throw new ImporteInvalidoError(`No se pudo interpretar el importe: ${texto}`)
  }
  return (negativo ? '-' : '') + s
}

/**
 * Formatea centavos como el documento los imprime.
 *
 * Omite los decimales cuando el importe es redondo, porque así está en el PDF
 * original: `$100,000`, no `$100,000.00`.
 */
export function formatMXN(
  centavos: number,
  opciones: { forzarDecimales?: boolean; conSimbolo?: boolean } = {},
): string {
  const { forzarDecimales = false, conSimbolo = true } = opciones

  if (!Number.isFinite(centavos)) {
    throw new ImporteInvalidoError(`Importe no finito: ${centavos}`)
  }

  const negativo = centavos < 0
  const abs = Math.abs(Math.trunc(centavos))
  const enteros = Math.trunc(abs / 100)
  const decimales = abs % 100

  const conMillares = String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const parteDecimal =
    forzarDecimales || decimales !== 0
      ? '.' + String(decimales).padStart(2, '0')
      : ''

  return (
    (negativo ? '-' : '') + (conSimbolo ? '$' : '') + conMillares + parteDecimal
  )
}

/** Centavos a cadena decimal de pesos, para inputs y exportaciones. */
export function centsToPesos(centavos: number): string {
  return new Big(centavos).div(100).toFixed(2)
}

/** Aplica un porcentaje en puntos base (1600 = 16 %) con redondeo HALF_UP. */
export function aplicarBps(centavos: number, bps: number): number {
  if (!Number.isInteger(centavos)) {
    throw new ImporteInvalidoError(`Se esperaban centavos enteros: ${centavos}`)
  }
  return Number(
    new Big(centavos).times(bps).div(10_000).round(0, Big.roundHalfUp).toString(),
  )
}

/**
 * Reparte un importe entre varias partes proporcionalmente a sus pesos, sin
 * perder ni inventar un centavo.
 *
 * Usa el método del resto mayor: reparte la parte entera y luego asigna los
 * centavos sobrantes a quienes tienen el resto más grande. La propiedad que
 * garantiza —y que se comprueba en las pruebas— es que la suma de lo repartido
 * es EXACTAMENTE el importe original. Sin esto, un descuento de paquete
 * repartido entre cuatro talentos deja el total descuadrado por unos centavos
 * y la marca lo ve.
 */
export function repartirProporcional(
  total: number,
  pesos: readonly number[],
): number[] {
  if (!Number.isInteger(total)) {
    throw new ImporteInvalidoError(`Se esperaban centavos enteros: ${total}`)
  }
  if (pesos.length === 0) return []

  const sumaPesos = pesos.reduce((a, b) => a + b, 0)
  if (sumaPesos <= 0) {
    // Sin base para repartir: todo al primero, para no perder el importe.
    const salida = new Array<number>(pesos.length).fill(0)
    salida[0] = total
    return salida
  }

  const base: number[] = []
  const restos: { indice: number; resto: number }[] = []
  let repartido = 0

  for (let i = 0; i < pesos.length; i++) {
    const exacto = (total * pesos[i]!) / sumaPesos
    const entero = Math.floor(exacto)
    base.push(entero)
    restos.push({ indice: i, resto: exacto - entero })
    repartido += entero
  }

  let sobrante = total - repartido
  // Desempate estable por índice: dos ejecuciones dan el mismo reparto.
  restos.sort((a, b) => b.resto - a.resto || a.indice - b.indice)
  for (let k = 0; k < restos.length && sobrante > 0; k++) {
    base[restos[k]!.indice]! += 1
    sobrante -= 1
  }
  return base
}

/** Comprueba el techo antes de que un importe absurdo llegue a un PDF. */
export function verificarTecho(centavos: number, contexto: string): void {
  if (centavos > TECHO_CENTAVOS) {
    throw new ImporteInvalidoError(
      `${contexto}: ${formatMXN(centavos)} supera el techo de ` +
        `${formatMXN(TECHO_CENTAVOS)}. Revisa si se multiplicó por 100 de más.`,
    )
  }
}
