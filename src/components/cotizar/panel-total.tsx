'use client'

import { useState } from 'react'
import { formatMXN } from '@/lib/money'
import type { CotizacionCalculada } from '@/server/pricing/compute'

/**
 * El total, siempre a la vista.
 *
 * Es la cifra que se está negociando: tiene que estar visible mientras se
 * mueve todo lo demás. En pantalla ancha es un panel discreto; en móvil, una
 * barra pegada abajo.
 *
 * El desglose está plegado porque durante la negociación lo que importa es el
 * total. Se abre cuando alguien pregunta por el IVA.
 */

export interface PanelTotalProps {
  totales: CotizacionCalculada
  moneda: string
  ivaBps: number
  /** Renglones «Por validar»: el documento no debería salir con ellos (§31). */
  pendientes: number
}

export function PanelTotal({ totales, moneda, ivaBps, pendientes }: PanelTotalProps) {
  const [abierto, setAbierto] = useState(false)
  const hayDesglose = totales.subtotalCents > 0

  return (
    <div className="rounded-katana border border-katana-200 bg-white p-4">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        disabled={!hayDesglose}
        aria-expanded={abierto}
        data-touch-target
        className="flex min-h-[44px] w-full items-baseline justify-between gap-3 text-left disabled:cursor-default"
      >
        <span className="text-etiqueta text-xs font-semibold uppercase tracking-[0.14em]">
          Total
        </span>
        <span className="text-xl font-bold tabular text-katana-800">
          {formatMXN(totales.totalCents)}{' '}
          <span className="text-etiqueta text-xs font-medium">{moneda}</span>
        </span>
      </button>

      {abierto && hayDesglose && (
        <dl className="mt-3 space-y-1.5 border-t border-katana-200 pt-3 text-sm">
          <Fila etiqueta="Subtotal" valor={formatMXN(totales.subtotalCents)} />
          {totales.packageDiscountCents > 0 && (
            <Fila
              etiqueta="Descuento"
              valor={`−${formatMXN(totales.packageDiscountCents)}`}
            />
          )}
          <Fila
            etiqueta={`IVA ${(ivaBps / 100).toFixed(0)} %`}
            valor={formatMXN(totales.taxCents)}
          />
          <div className="flex justify-between border-t border-katana-200 pt-1.5 font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{formatMXN(totales.totalCents)}</dd>
          </div>
        </dl>
      )}

      {pendientes > 0 && (
        <p className="text-alerta mt-2 text-xs">
          {pendientes} {pendientes === 1 ? 'renglón' : 'renglones'} por validar
        </p>
      )}
    </div>
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-tinta-suave">{etiqueta}</dt>
      <dd className="tabular">{valor}</dd>
    </div>
  )
}
