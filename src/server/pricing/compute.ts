import {
  aplicarBps,
  repartirProporcional,
  verificarTecho,
  ImporteInvalidoError,
} from '@/lib/money'

/**
 * Motor de cálculo de la cotización.
 *
 * FUNCIÓN PURA: sin Prisma, sin I/O, sin `Date.now()`. Recibe datos planos y
 * devuelve datos planos, para que se pueda probar exhaustivamente y para que
 * el editor la ejecute en el navegador y el servidor obtenga exactamente el
 * mismo resultado. Si estos dos números no coinciden, la vista previa miente.
 */

export type EstadoPrecio = 'QUOTED' | 'PENDING' | 'NOT_APPLICABLE' | 'CASE_BY_CASE'
export type TipoDescuento = 'PERCENT' | 'FIXED'
export type ModoImpuesto = 'ADDED' | 'EXEMPT'

export interface LineaEntrada {
  id: string
  /** Agrupa el renglón bajo un talento. `null` = concepto general de la cotización. */
  quoteTalentId: string | null
  quantity: number
  /** Centavos. `null` cuando el estado no es QUOTED. */
  unitAmountCents: number | null
  priceStatus: EstadoPrecio
  lineDiscountType?: TipoDescuento | null
  /** Puntos base si PERCENT, centavos si FIXED. */
  lineDiscountValue?: number | null
  /** `false` para renglones informativos que no suman (cortesías, notas). */
  isBillable?: boolean
}

export interface TalentoEntrada {
  id: string
  displayName: string
}

export interface CotizacionEntrada {
  talents: readonly TalentoEntrada[]
  lines: readonly LineaEntrada[]
  packageDiscountType?: TipoDescuento | null
  packageDiscountValue?: number | null
  taxMode: ModoImpuesto
  /** Puntos base: 1600 = 16 %. */
  taxRateBps: number
}

export interface LineaCalculada {
  id: string
  quoteTalentId: string | null
  grossCents: number
  discountCents: number
  totalCents: number
  priceStatus: EstadoPrecio
  /** Se muestra pero no suma: "Cotización aparte", "Tarifa pendiente". */
  informativa: boolean
}

export interface TalentoCalculado {
  id: string
  displayName: string
  grossCents: number
  lineDiscountCents: number
  /** Parte del descuento de paquete que le toca a este talento. */
  allocatedPackageDiscountCents: number
  /** Después de descuentos de renglón y de la parte del descuento de paquete. */
  netCents: number
  /** Renglones que no suman: hay que decírselo a quien lee el documento. */
  lineasInformativas: number
}

export interface CotizacionCalculada {
  lines: LineaCalculada[]
  talents: TalentoCalculado[]
  /** Suma de renglones facturables antes de cualquier descuento. */
  grossCents: number
  lineDiscountCents: number
  /** Bruto menos descuentos de renglón. */
  subtotalCents: number
  packageDiscountCents: number
  /** Base gravable: subtotal menos descuento de paquete. */
  taxableBaseCents: number
  taxCents: number
  totalCents: number
  /** Hay al menos un renglón Pendiente / N-A / Caso por caso. */
  hasNonQuotedLines: boolean
  /** Hay un renglón PENDING sin resolver: bloquea la emisión. */
  requiereResolverPendientes: boolean
}

/**
 * Un renglón sólo aporta dinero si su precio está cotizado.
 *
 *   · CASE_BY_CASE → "Cotización aparte". Se imprime, no suma, no bloquea.
 *   · PENDING      → "Tarifa pendiente". Se imprime, no suma, y BLOQUEA emitir
 *                    salvo que alguien lo reconozca de forma explícita.
 *   · NOT_APPLICABLE → el talento no ofrece ese formato. No debería llegar a
 *                    un renglón, pero si llega, no suma.
 *
 * Colapsar los cuatro casos en "importe 0" es justo el error que hace que una
 * marca reciba una cotización con un formato regalado.
 */
function esFacturable(l: LineaEntrada): boolean {
  return (l.isBillable ?? true) && l.priceStatus === 'QUOTED'
}

function calcularDescuentoLinea(
  bruto: number,
  tipo: TipoDescuento | null | undefined,
  valor: number | null | undefined,
): number {
  if (!tipo || valor == null || valor <= 0 || bruto <= 0) return 0
  const bruEntero = Math.trunc(bruto)
  if (tipo === 'PERCENT') {
    // Un porcentaje por encima de 100 % sería un regalo con signo cambiado.
    const bps = Math.min(valor, 10_000)
    return Math.min(aplicarBps(bruEntero, bps), bruEntero)
  }
  // FIXED nunca puede dejar el renglón en negativo.
  return Math.min(Math.trunc(valor), bruEntero)
}

export function computeQuote(entrada: CotizacionEntrada): CotizacionCalculada {
  if (!Number.isInteger(entrada.taxRateBps) || entrada.taxRateBps < 0 || entrada.taxRateBps > 10_000) {
    throw new ImporteInvalidoError(
      `Tasa de impuesto fuera de rango: ${entrada.taxRateBps} puntos base.`,
    )
  }

  // ── 1. Renglones ───────────────────────────────────────────────────────
  const lines: LineaCalculada[] = []
  let hasNonQuotedLines = false
  let requiereResolverPendientes = false

  for (const l of entrada.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new ImporteInvalidoError(
        `Cantidad inválida en el renglón ${l.id}: ${l.quantity}.`,
      )
    }

    if (l.priceStatus !== 'QUOTED') {
      hasNonQuotedLines = true
      if (l.priceStatus === 'PENDING') requiereResolverPendientes = true
    }

    if (!esFacturable(l)) {
      lines.push({
        id: l.id,
        quoteTalentId: l.quoteTalentId,
        grossCents: 0,
        discountCents: 0,
        totalCents: 0,
        priceStatus: l.priceStatus,
        informativa: true,
      })
      continue
    }

    if (l.unitAmountCents == null || !Number.isInteger(l.unitAmountCents)) {
      throw new ImporteInvalidoError(
        `El renglón ${l.id} está cotizado pero no tiene importe unitario entero.`,
      )
    }
    if (l.unitAmountCents < 0) {
      throw new ImporteInvalidoError(
        `El renglón ${l.id} tiene un importe negativo: ${l.unitAmountCents}.`,
      )
    }

    // El producto se hace en BigInt: cantidad × unitario puede desbordar el
    // entero seguro antes de que la guarda del techo pueda opinar.
    const brutoBig = BigInt(l.unitAmountCents) * BigInt(l.quantity)
    if (brutoBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ImporteInvalidoError(
        `El renglón ${l.id} desborda: ${l.quantity} × ${l.unitAmountCents} centavos.`,
      )
    }
    const bruto = Number(brutoBig)
    verificarTecho(bruto, `Renglón ${l.id}`)

    const descuento = calcularDescuentoLinea(
      bruto,
      l.lineDiscountType,
      l.lineDiscountValue,
    )

    lines.push({
      id: l.id,
      quoteTalentId: l.quoteTalentId,
      grossCents: bruto,
      discountCents: descuento,
      totalCents: bruto - descuento,
      priceStatus: l.priceStatus,
      informativa: false,
    })
  }

  // ── 2. Agregado por talento ────────────────────────────────────────────
  const porTalento = new Map<string, TalentoCalculado>()
  for (const t of entrada.talents) {
    porTalento.set(t.id, {
      id: t.id,
      displayName: t.displayName,
      grossCents: 0,
      lineDiscountCents: 0,
      allocatedPackageDiscountCents: 0,
      netCents: 0,
      lineasInformativas: 0,
    })
  }

  let grossCents = 0
  let lineDiscountCents = 0

  for (const l of lines) {
    grossCents += l.grossCents
    lineDiscountCents += l.discountCents

    if (l.quoteTalentId == null) continue
    const t = porTalento.get(l.quoteTalentId)
    if (!t) {
      throw new ImporteInvalidoError(
        `El renglón ${l.id} apunta al talento ${l.quoteTalentId}, que no está en la cotización.`,
      )
    }
    t.grossCents += l.grossCents
    t.lineDiscountCents += l.discountCents
    t.netCents += l.totalCents
    if (l.informativa) t.lineasInformativas += 1
  }

  const subtotalCents = grossCents - lineDiscountCents
  verificarTecho(subtotalCents, 'Subtotal de la cotización')

  // ── 3. Descuento de paquete ────────────────────────────────────────────
  const packageDiscountCents = calcularDescuentoLinea(
    subtotalCents,
    entrada.packageDiscountType,
    entrada.packageDiscountValue,
  )

  // Se reparte entre los talentos en proporción a su neto, con resto mayor:
  // así la suma de lo repartido es exactamente el descuento, sin centavos
  // perdidos que descuadren el documento.
  const talentos = [...porTalento.values()]
  if (packageDiscountCents > 0 && talentos.length > 0) {
    const reparto = repartirProporcional(
      packageDiscountCents,
      talentos.map((t) => t.netCents),
    )
    for (let i = 0; i < talentos.length; i++) {
      const parte = reparto[i]!
      talentos[i]!.allocatedPackageDiscountCents = parte
      talentos[i]!.netCents -= parte
    }
  }

  // ── 4. Impuesto y total ────────────────────────────────────────────────
  const taxableBaseCents = subtotalCents - packageDiscountCents
  const taxCents =
    entrada.taxMode === 'ADDED' ? aplicarBps(taxableBaseCents, entrada.taxRateBps) : 0
  const totalCents = taxableBaseCents + taxCents

  verificarTecho(totalCents, 'Total de la cotización')

  return {
    lines,
    talents: talentos,
    grossCents,
    lineDiscountCents,
    subtotalCents,
    packageDiscountCents,
    taxableBaseCents,
    taxCents,
    totalCents,
    hasNonQuotedLines,
    requiereResolverPendientes,
  }
}
