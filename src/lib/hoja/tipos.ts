import { computeQuote } from '@/server/pricing/compute'
import type { CotizacionEntrada, CotizacionCalculada } from '@/server/pricing/compute'
import type { EstadoPrecioDoc } from '@/lib/doc/tipos'
import type { EstadoCotizacion } from '@/lib/editor/tipos'

/**
 * La hoja de cotización: talentos con renglones, no una matriz.
 *
 * El tabulador cruza talento × formato y guarda una celda por cruce, aunque
 * esté vacía. Eso sirve para imprimir una tabla comparativa, pero no expresa
 * "3 Stories" ni permite mezclar entregables con condiciones comerciales.
 *
 * Aquí cada talento tiene los renglones que se le agregaron y nada más. Es el
 * mismo modelo que ya vive en `QuoteLine` y que `computeQuote` sabe sumar.
 *
 * Todo en este archivo es PURO: sin React, sin Prisma, sin red. El navegador lo
 * ejecuta en cada pulsación para mover el total y el servidor lo ejecuta al
 * guardar. Si los dos no coinciden, el total que ve el usuario miente.
 */

export type EstadoPrecioHoja = EstadoPrecioDoc

/**
 * Cómo se nombra cada estado de tarifa frente al usuario.
 *
 * "Por validar" y no "Pendiente": lo que le falta a esa tarifa es que alguien
 * la confirme, y el encargo pide decirlo con esas palabras.
 */
export const ETIQUETA_ESTADO_HOJA: Record<EstadoPrecioHoja, string> = {
  QUOTED: 'Cotizado',
  PENDING: 'Por validar',
  CASE_BY_CASE: 'Caso por caso',
  NOT_APPLICABLE: 'No aplica',
}

/** Un entregable que el talento sí tiene tarifado, listo para agregar de un tap. */
export interface AccionTalento {
  deliverableTypeId: string
  nombre: string
  unitLabel: string
  permiteCantidad: boolean
  /** Del tarifario. `null` cuando el estado no es QUOTED. */
  amountCents: number | null
  priceStatus: EstadoPrecioHoja
}

export interface RenglonHoja {
  /** QuoteLine.id */
  id: string
  quoteTalentId: string
  /** `null` en condiciones libres que no salen del catálogo. */
  deliverableTypeId: string | null
  concepto: string
  detalle: string | null
  cantidad: number
  unitAmountCents: number | null
  priceStatus: EstadoPrecioHoja
  permiteCantidad: boolean
  /**
   * La tarifa del tarifario en el momento de agregar el renglón. Sirve para
   * enseñar la referencia SÓLO cuando el precio cotizado se apartó de ella;
   * mostrarla siempre es ruido (§20).
   */
  baseAmountCents: number | null
  basePriceStatus: EstadoPrecioHoja | null
  orden: number
}

export interface TalentoHoja {
  /** QuoteTalent.id */
  id: string
  talentId: string
  /** La ficha del talento se direcciona por slug, no por id. */
  slug: string
  nombre: string
  categoria: string | null
  orden: number
  renglones: RenglonHoja[]
  /** Las más frecuentes primero; la interfaz enseña unas pocas y esconde el resto. */
  acciones: AccionTalento[]
}

export interface EstadoHoja {
  quoteId: string
  revision: number
  folio: string | null
  draftRef: string
  estado: EstadoCotizacion
  cliente: string
  contacto: string | null
  proyecto: string | null
  moneda: string
  ivaBps: number
  talentos: TalentoHoja[]
}

// ───────────────────────────── Derivaciones ─────────────────────────────

/**
 * ¿El precio de este renglón se apartó del tarifario?
 *
 * Sólo tiene sentido comparar importes cuando ambos lados son un importe: un
 * renglón "Por validar" no está "ajustado", está sin tarifa.
 */
export function tieneAjusteRenglon(r: RenglonHoja): boolean {
  if (r.priceStatus !== 'QUOTED' || r.basePriceStatus !== 'QUOTED') return false
  if (r.unitAmountCents === null || r.baseAmountCents === null) return false
  return r.unitAmountCents !== r.baseAmountCents
}

/** Importe del renglón. Los que no están cotizados no suman. */
export function totalRenglon(r: RenglonHoja): number {
  if (r.priceStatus !== 'QUOTED' || r.unitAmountCents === null) return 0
  return r.unitAmountCents * r.cantidad
}

/**
 * Traduce la hoja a lo que espera el motor de cálculo.
 *
 * El motor ya existe, está probado al 100 % y reparte el descuento de paquete
 * sin perder centavos. Aquí sólo se le da de comer.
 */
export function entradaComputo(e: EstadoHoja): CotizacionEntrada {
  return {
    talents: e.talentos.map((t) => ({ id: t.id, displayName: t.nombre })),
    lines: e.talentos.flatMap((t) =>
      t.renglones.map((r) => ({
        id: r.id,
        quoteTalentId: t.id,
        quantity: r.cantidad,
        unitAmountCents: r.unitAmountCents,
        priceStatus: r.priceStatus,
      })),
    ),
    taxMode: 'ADDED' as const,
    taxRateBps: e.ivaBps,
  }
}

/** El total que se pinta en pantalla y el que se guarda: la misma función. */
export function totalesDeHoja(e: EstadoHoja): CotizacionCalculada {
  return computeQuote(entradaComputo(e))
}

/**
 * Qué le falta a la cotización para poder salir (§31).
 *
 * Devuelve los pendientes agrupados por talento, con su nombre, para que el
 * aviso diga exactamente qué resolver y de quién — no un "hay errores".
 */
export interface Pendiente {
  talento: string
  concepto: string
}

export function pendientesDeHoja(e: EstadoHoja): Pendiente[] {
  const fuera: Pendiente[] = []
  for (const t of e.talentos) {
    for (const r of t.renglones) {
      if (r.priceStatus === 'PENDING') {
        fuera.push({ talento: t.nombre, concepto: r.concepto })
      }
    }
  }
  return fuera
}
