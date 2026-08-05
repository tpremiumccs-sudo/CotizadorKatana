/**
 * Importe en letra, como lo exige una cotización formal en México.
 *
 * Formato: "TRESCIENTOS NOVENTA Y CUATRO MIL CUATROCIENTOS PESOS 00/100 M.N."
 *
 * Es requisito de facturación y de orden de compra: cuando la cifra en número y
 * la cifra en letra no coinciden, en México manda la letra. Por eso se genera
 * desde los mismos centavos que imprime el documento y nunca se teclea aparte.
 */

const UNIDADES = [
  '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS',
  'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
]

const DECENAS = [
  '', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA',
  'OCHENTA', 'NOVENTA',
]

/**
 * Del 21 al 29 se escriben en una sola palabra y tres llevan acento
 * (veintidós, veintitrés, veintiséis). Se listan en vez de componerlos, que es
 * donde suelen colarse los errores de ortografía en un documento formal.
 */
const VEINTIS = [
  'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO',
  'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
]

const CENTENAS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
]

/** Convierte 0-999 a letra. */
function centenasALetra(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'

  const c = Math.floor(n / 100)
  const resto = n % 100

  const partes: string[] = []
  if (c > 0) partes.push(CENTENAS[c]!)

  if (resto > 0 && resto <= 20) {
    partes.push(UNIDADES[resto]!)
  } else if (resto > 20) {
    const d = Math.floor(resto / 10)
    const u = resto % 10
    if (d === 2) {
      partes.push(VEINTIS[u]!)
    } else {
      partes.push(u === 0 ? DECENAS[d]! : `${DECENAS[d]!} Y ${UNIDADES[u]!}`)
    }
  }
  return partes.join(' ')
}

/** Convierte 0-999,999 a letra. */
function milesALetra(n: number): string {
  if (n === 0) return ''
  const miles = Math.floor(n / 1000)
  const resto = n % 1000

  const partes: string[] = []
  if (miles === 1) {
    partes.push('MIL')
  } else if (miles > 1) {
    partes.push(`${centenasALetra(miles)} MIL`)
  }
  if (resto > 0) partes.push(centenasALetra(resto))
  return partes.join(' ')
}

/** Parte entera del importe, en letra. */
export function enteroALetra(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Se esperaba un entero no negativo: ${n}`)
  }
  if (n === 0) return 'CERO'
  if (n >= 1_000_000_000_000) {
    throw new Error(`Importe fuera de rango para convertir a letra: ${n}`)
  }

  const millones = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000

  const partes: string[] = []
  if (millones === 1) {
    partes.push('UN MILLÓN')
  } else if (millones > 1) {
    partes.push(`${milesALetra(millones)} MILLONES`)
  }
  if (resto > 0) partes.push(milesALetra(resto))
  return partes.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Apócope de "uno" delante de un sustantivo masculino.
 *
 * En español se dice UN PESO, VEINTIÚN PESOS y TREINTA Y UN PESOS, nunca
 * "uno peso". Es la clase de detalle que salta a la vista en un documento
 * formal que va a una marca.
 */
function apocopar(letra: string): string {
  if (letra.endsWith('VEINTIUNO')) return letra.slice(0, -'VEINTIUNO'.length) + 'VEINTIÚN'
  if (letra === 'UNO') return 'UN'
  if (letra.endsWith(' UNO')) return letra.slice(0, -4) + ' UN'
  return letra
}

/**
 * Importe completo en letra a partir de CENTAVOS.
 *
 * Se parte de centavos, no de pesos con decimales, para que la letra y la cifra
 * impresa procedan del mismo número exacto.
 */
export function importeALetra(centavos: number, moneda = 'M.N.'): string {
  if (!Number.isInteger(centavos) || centavos < 0) {
    throw new Error(`Se esperaban centavos enteros no negativos: ${centavos}`)
  }
  const pesos = Math.floor(centavos / 100)
  const cents = centavos % 100
  const unidad = pesos === 1 ? 'PESO' : 'PESOS'
  const letra = apocopar(enteroALetra(pesos))
  return `${letra} ${unidad} ${String(cents).padStart(2, '0')}/100 ${moneda}`
}
