import type { DocumentoCotizacion, RenglonCotizacion } from './tipos'
import { COLOR, LAYOUT, anchoTexto, partirEnLineas } from './metricas'
import { formatMXN } from '@/lib/money'

/**
 * Bloques propios de la COTIZACIÓN.
 *
 * Mantiene el mismo lenguaje visual del tabulador —la caja de metadatos, la
 * cabecera morada, las filas alternas, los mismos colores y tipos— pero en vez
 * de una matriz de talento × formato presenta un bloque por talento con sus
 * entregables y, al final, el bloque de totales.
 *
 * El paginado sigue el mismo principio que el resto del documento: un bloque de
 * talento no se parte entre páginas salvo que no quepa en una hoja vacía, y el
 * bloque de totales nunca se separa de la última línea que resume.
 */

// ─────────────────────────── geometría ───────────────────────────

export const COT = {
  /** El bloque de talento arranca aquí en la primera página. */
  primerBloqueTop: 302.756,
  /** Franja con el nombre del talento. */
  cabeceraTalentoAlto: 22,
  cabeceraTalentoTam: 9.7,
  /** Fila de encabezados de columna dentro del bloque. */
  encabezadoRenglonAlto: 16,
  encabezadoRenglonTam: 7.2,
  renglonAlto: 19,
  renglonTam: 9,
  /** Fila de subtotal del talento. */
  subtotalAlto: 20,
  subtotalTam: 9,
  /** Separación entre bloques de talento. */
  entreBloques: 14,
  /** Bloque de totales. */
  totalesFilaAlto: 18,
  totalesTam: 9,
  totalTam: 11,
  letraTam: 8.2,
  /** Desde el borde superior de una fila hasta su línea de texto. */
  textoDesfase: 6.5,
} as const

/** Columnas del renglón: concepto, cantidad, unitario, importe. */
export const COLUMNAS_RENGLON = {
  concepto: LAYOUT.nombreIzq,
  cantidadDerecha: 360,
  unitarioDerecha: 450,
  importeDerecha: 533,
} as const

const ANCHO_CONCEPTO = COLUMNAS_RENGLON.cantidadDerecha - COLUMNAS_RENGLON.concepto - 40

// ─────────────────────────── medición ───────────────────────────

export interface BloqueMedido {
  indice: number
  /** Alto total del bloque, incluida su cabecera y su subtotal. */
  alto: number
  /** Líneas de cada renglón, ya partidas. */
  lineasPorRenglon: string[][]
}

export function medirBloques(doc: DocumentoCotizacion): BloqueMedido[] {
  return doc.bloques.map((b, indice) => {
    const lineasPorRenglon = b.renglones.map((r) =>
      partirEnLineas(r.concepto, ANCHO_CONCEPTO, COT.renglonTam, 'Regular'),
    )
    const altoRenglones = lineasPorRenglon.reduce(
      (s, lineas) => s + Math.max(COT.renglonAlto, lineas.length * 12 + 7),
      0,
    )
    return {
      indice,
      alto:
        COT.cabeceraTalentoAlto +
        COT.encabezadoRenglonAlto +
        altoRenglones +
        COT.subtotalAlto,
      lineasPorRenglon,
    }
  })
}

/** Alto del bloque de totales, incluido el importe en letra. */
export function altoTotales(doc: DocumentoCotizacion): number {
  const filas = doc.totales.descuentoCents > 0 ? 4 : 3
  return filas * COT.totalesFilaAlto + 26
}

// ─────────────────────────── render ───────────────────────────

interface Pintor {
  texto: (
    contenido: string,
    o: {
      left: number
      topPdf: number
      tam: number
      estilo?: 'Regular' | 'Bold'
      color: string
      ancla?: string
    },
  ) => string
  rect: (x0: number, top: number, x1: number, bottom: number, relleno: string) => string
  lineaH: (x0: number, x1: number, y: number, grosor: number, color: string) => string
  alinearDerecha: (
    derecha: number,
    texto: string,
    tam: number,
    estilo: 'Regular' | 'Bold',
  ) => number
}

/** Qué se imprime en la columna de importe de un renglón. */
function textoImporte(r: RenglonCotizacion, doc: DocumentoCotizacion): string {
  if (r.status === 'QUOTED' && r.unitAmountCents !== null) return formatMXN(r.totalCents)
  if (r.status === 'PENDING') return doc.textoPendiente
  if (r.status === 'CASE_BY_CASE') return doc.textoCasoPorCaso
  if (r.status === 'NOT_APPLICABLE') return doc.textoNoAplica
  return doc.textoVacio
}

export function renderBloqueTalento(
  doc: DocumentoCotizacion,
  indice: number,
  medido: BloqueMedido,
  top: number,
  p: Pintor,
): string {
  const b = doc.bloques[indice]!
  const out: string[] = []
  const izq = LAYOUT.cajaIzq
  const der = LAYOUT.cajaDer
  let y = top

  // ── Cabecera con el nombre del talento ────────────────────────────────
  out.push(p.rect(izq, y, der, y + COT.cabeceraTalentoAlto, COLOR.marca))
  out.push(
    p.texto(b.nombre, {
      left: LAYOUT.nombreIzq,
      topPdf: y + COT.textoDesfase + 1,
      tam: COT.cabeceraTalentoTam,
      estilo: 'Bold',
      color: COLOR.blanco,
      ancla: `talento-${indice}`,
    }),
  )
  y += COT.cabeceraTalentoAlto

  // ── Encabezados de columna ────────────────────────────────────────────
  out.push(p.rect(izq, y, der, y + COT.encabezadoRenglonAlto, COLOR.tinte))
  const enc: Array<[string, number]> = [
    ['CANTIDAD', COLUMNAS_RENGLON.cantidadDerecha],
    ['PRECIO UNITARIO', COLUMNAS_RENGLON.unitarioDerecha],
    ['IMPORTE', COLUMNAS_RENGLON.importeDerecha],
  ]
  out.push(
    p.texto('CONCEPTO', {
      left: LAYOUT.nombreIzq,
      topPdf: y + 5.2,
      tam: COT.encabezadoRenglonTam,
      estilo: 'Bold',
      color: COLOR.etiqueta,
    }),
  )
  for (const [etiqueta, derecha] of enc) {
    out.push(
      p.texto(etiqueta, {
        left: p.alinearDerecha(derecha, etiqueta, COT.encabezadoRenglonTam, 'Bold'),
        topPdf: y + 5.2,
        tam: COT.encabezadoRenglonTam,
        estilo: 'Bold',
        color: COLOR.etiqueta,
      }),
    )
  }
  y += COT.encabezadoRenglonAlto

  // ── Renglones ─────────────────────────────────────────────────────────
  b.renglones.forEach((r, j) => {
    const lineas = medido.lineasPorRenglon[j]!
    const alto = Math.max(COT.renglonAlto, lineas.length * 12 + 7)
    if (j % 2 === 1) out.push(p.rect(izq, y, der, y + alto, COLOR.tinte))
    out.push(p.lineaH(izq, der, y, 0.4, COLOR.borde))

    lineas.forEach((linea, k) => {
      out.push(
        p.texto(linea, {
          left: LAYOUT.nombreIzq,
          topPdf: y + COT.textoDesfase + k * 12,
          tam: COT.renglonTam,
          color: COLOR.texto,
        }),
      )
    })

    const cantidad = String(r.cantidad)
    out.push(
      p.texto(cantidad, {
        left: p.alinearDerecha(COLUMNAS_RENGLON.cantidadDerecha, cantidad, COT.renglonTam, 'Regular'),
        topPdf: y + COT.textoDesfase,
        tam: COT.renglonTam,
        color: COLOR.texto,
      }),
    )

    const unitario =
      r.status === 'QUOTED' && r.unitAmountCents !== null
        ? formatMXN(r.unitAmountCents)
        : ''
    if (unitario) {
      out.push(
        p.texto(unitario, {
          left: p.alinearDerecha(COLUMNAS_RENGLON.unitarioDerecha, unitario, COT.renglonTam, 'Regular'),
          topPdf: y + COT.textoDesfase,
          tam: COT.renglonTam,
          color: COLOR.texto,
        }),
      )
    }

    const importe = textoImporte(r, doc)
    out.push(
      p.texto(importe, {
        left: p.alinearDerecha(COLUMNAS_RENGLON.importeDerecha, importe, COT.renglonTam, 'Bold'),
        topPdf: y + COT.textoDesfase,
        tam: COT.renglonTam,
        estilo: 'Bold',
        // Un renglón que no suma se imprime en gris: no es una cifra cobrable.
        color: r.informativa
          ? COLOR.etiqueta
          : doc.preciosEnMorado
            ? COLOR.oscuro
            : COLOR.precio,
        ancla: `renglon-${indice}-${j}`,
      }),
    )
    y += alto
  })

  // ── Subtotal del talento ──────────────────────────────────────────────
  out.push(p.lineaH(izq, der, y, 0.6, COLOR.borde))
  out.push(p.rect(izq, y, der, y + COT.subtotalAlto, COLOR.tinte))
  const etiqueta = `Subtotal ${b.nombre}`
  out.push(
    p.texto(etiqueta, {
      left: p.alinearDerecha(COLUMNAS_RENGLON.unitarioDerecha, etiqueta, COT.subtotalTam, 'Bold'),
      topPdf: y + COT.textoDesfase,
      tam: COT.subtotalTam,
      estilo: 'Bold',
      color: COLOR.oscuro,
    }),
  )
  const neto = formatMXN(b.netCents)
  out.push(
    p.texto(neto, {
      left: p.alinearDerecha(COLUMNAS_RENGLON.importeDerecha, neto, COT.subtotalTam, 'Bold'),
      topPdf: y + COT.textoDesfase,
      tam: COT.subtotalTam,
      estilo: 'Bold',
      color: COLOR.oscuro,
      ancla: `subtotal-${indice}`,
    }),
  )

  return out.join('')
}

export function renderTotales(
  doc: DocumentoCotizacion,
  top: number,
  p: Pintor,
): string {
  const out: string[] = []
  const t = doc.totales
  const izq = LAYOUT.cajaIzq
  const der = LAYOUT.cajaDer
  let y = top

  const filas: Array<[string, string, boolean]> = [
    ['Subtotal', formatMXN(t.subtotalCents), false],
  ]
  if (t.descuentoCents > 0) {
    filas.push(['Descuento de paquete', `−${formatMXN(t.descuentoCents)}`, false])
  }
  filas.push([t.ivaEtiqueta, formatMXN(t.ivaCents), false])
  filas.push(['TOTAL', formatMXN(t.totalCents), true])

  for (const [etiqueta, valor, esTotal] of filas) {
    const tam = esTotal ? COT.totalTam : COT.totalesTam
    if (esTotal) {
      out.push(p.rect(izq, y, der, y + COT.totalesFilaAlto + 4, COLOR.marca))
    }
    out.push(
      p.texto(etiqueta, {
        left: p.alinearDerecha(COLUMNAS_RENGLON.unitarioDerecha, etiqueta, tam, 'Bold'),
        topPdf: y + COT.textoDesfase,
        tam,
        estilo: 'Bold',
        color: esTotal ? COLOR.blanco : COLOR.gris,
      }),
    )
    out.push(
      p.texto(valor, {
        left: p.alinearDerecha(COLUMNAS_RENGLON.importeDerecha, valor, tam, 'Bold'),
        topPdf: y + COT.textoDesfase,
        tam,
        estilo: 'Bold',
        color: esTotal ? COLOR.blanco : COLOR.oscuro,
        ancla: esTotal ? 'total' : undefined,
      }),
    )
    y += esTotal ? COT.totalesFilaAlto + 4 : COT.totalesFilaAlto
  }

  // El importe en letra: en México, si la cifra y la letra difieren, manda la
  // letra. Por eso se genera de los mismos centavos que se acaban de imprimir.
  const letra = `Son: ${t.totalEnLetra}`
  const lineas = partirEnLineas(letra, der - izq - 8, COT.letraTam, 'Regular')
  lineas.forEach((l, i) => {
    out.push(
      p.texto(l, {
        left: LAYOUT.nombreIzq,
        topPdf: y + 9 + i * 10,
        tam: COT.letraTam,
        color: COLOR.gris,
        ancla: i === 0 ? 'total-en-letra' : undefined,
      }),
    )
  })

  return out.join('')
}

/** Ancho disponible para el texto de un concepto, expuesto para las pruebas. */
export const anchoConcepto = ANCHO_CONCEPTO
export { anchoTexto }
