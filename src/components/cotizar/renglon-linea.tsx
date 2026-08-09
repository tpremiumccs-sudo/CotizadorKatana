'use client'

import { InputMoneda } from '@/components/editor/input-moneda'
import { formatMXN } from '@/lib/money'
import {
  ETIQUETA_ESTADO_HOJA, tieneAjusteRenglon, totalRenglon,
} from '@/lib/hoja/tipos'
import type { RenglonHoja, EstadoPrecioHoja } from '@/lib/hoja/tipos'

/**
 * Un renglón: «3 Stories · 3 × $15,000 · $45,000».
 *
 * Se edita tocándolo. No hay botón de editar, ni de guardar: cantidad y precio
 * son campos, Enter aplica y el total se mueve solo.
 *
 * La referencia del tarifario aparece SÓLO cuando el precio se apartó de ella.
 * Enseñarla siempre sería ruido; enseñarla cuando difiere es lo que permite
 * defender la cifra frente a la marca.
 */

const SIN_IMPORTE: EstadoPrecioHoja[] = ['PENDING', 'CASE_BY_CASE', 'NOT_APPLICABLE']

export interface RenglonLineaProps {
  renglon: RenglonHoja
  talento: string
  soloLectura: boolean
  onCambiar(cambio: {
    cantidad?: number
    unitAmountCents?: number | null
    priceStatus?: EstadoPrecioHoja
  }): void
  onQuitar(): void
}

export function RenglonLinea({
  renglon: r, talento, soloLectura, onCambiar, onQuitar,
}: RenglonLineaProps) {
  const ajustado = tieneAjusteRenglon(r)
  const cotizado = r.priceStatus === 'QUOTED'
  const total = totalRenglon(r)

  return (
    <li className="border-t border-katana-200 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-tinta">
          {r.concepto}
        </span>

        <div className="flex items-center gap-2">
          {r.permiteCantidad ? (
            <input
              type="number"
              min={1}
              max={9999}
              step={1}
              inputMode="numeric"
              value={r.cantidad}
              disabled={soloLectura}
              data-touch-target
              aria-label={`Cantidad de ${r.concepto} para ${talento}`}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isInteger(n) && n >= 1 && n <= 9999) onCambiar({ cantidad: n })
              }}
              className="min-h-[44px] w-16 rounded-katana border border-katana-200 bg-white px-2 text-right text-base tabular text-tinta focus:border-katana-500 focus:outline-none disabled:bg-katana-50"
            />
          ) : (
            <span className="text-etiqueta w-16 text-right text-sm tabular">1</span>
          )}

          <span aria-hidden="true" className="text-etiqueta text-sm">×</span>

          {cotizado ? (
            <InputMoneda
              valorCents={r.unitAmountCents}
              disabled={soloLectura}
              aria-label={`Precio de ${r.concepto} para ${talento}`}
              placeholder="Por validar"
              onCommit={(centavos) =>
                onCambiar(
                  centavos === null
                    ? { priceStatus: 'PENDING', unitAmountCents: null }
                    : { unitAmountCents: centavos, priceStatus: 'QUOTED' },
                )
              }
              className="min-h-[44px] w-28 rounded-katana border border-katana-200 bg-white px-2 text-right text-base tabular text-precio focus:border-katana-500 focus:outline-none disabled:bg-katana-50"
            />
          ) : (
            <button
              type="button"
              disabled={soloLectura}
              data-touch-target
              onClick={() => onCambiar({ priceStatus: 'QUOTED', unitAmountCents: 0 })}
              aria-label={`${ETIQUETA_ESTADO_HOJA[r.priceStatus]}: poner precio a ${r.concepto} de ${talento}`}
              className="min-h-[44px] w-28 rounded-katana border border-dashed border-katana-300 px-2 text-right text-sm text-alerta hover:border-katana-500 hover:text-katana-700 disabled:opacity-60"
            >
              {ETIQUETA_ESTADO_HOJA[r.priceStatus]}
            </button>
          )}

          <span className="w-28 text-right text-sm font-semibold tabular text-tinta">
            {cotizado ? formatMXN(total) : '—'}
          </span>

          <button
            type="button"
            onClick={onQuitar}
            disabled={soloLectura}
            data-touch-target
            aria-label={`Quitar ${r.concepto} de ${talento}`}
            className="text-etiqueta min-h-[44px] min-w-[44px] rounded-katana px-2 text-lg leading-none hover:bg-katana-50 hover:text-error disabled:opacity-40"
          >
            ×
          </button>
        </div>
      </div>

      {/* La referencia del tarifario, sólo cuando aporta información. */}
      {ajustado && r.baseAmountCents !== null && (
        <p className="text-etiqueta mt-0.5 text-xs tabular">
          CRM {formatMXN(r.baseAmountCents)}
        </p>
      )}

      {/* Un renglón sin tarifa no es un renglón gratis: hay que poder verlo. */}
      {SIN_IMPORTE.includes(r.priceStatus) && r.basePriceStatus === 'PENDING' && (
        <p className="text-etiqueta mt-0.5 text-xs">Sin tarifa en el tarifario</p>
      )}
    </li>
  )
}
