'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatMXN } from '@/lib/money'
import { RenglonLinea } from '@/components/cotizar/renglon-linea'
import { totalRenglon } from '@/lib/hoja/tipos'
import type { TalentoHoja, EstadoPrecioHoja } from '@/lib/hoja/tipos'

/**
 * Un talento con sus renglones y sus acciones a un tap.
 *
 * Las acciones salen del tarifario real del talento, no de una lista fija: si
 * a alguien no se le vende «Stream dedicado», ese botón no existe para él.
 *
 * Se enseñan las primeras cuatro y el resto se esconde bajo «+ Más». Veinte
 * botones siempre visibles no son más rápidos, son más lentos de leer.
 */

const VISIBLES = 4

export interface BloqueTalentoProps {
  talento: TalentoHoja
  soloLectura: boolean
  onAgregarRenglon(deliverableTypeId: string): void
  onCambiarRenglon(
    lineaId: string,
    cambio: {
      cantidad?: number
      unitAmountCents?: number | null
      priceStatus?: EstadoPrecioHoja
    },
  ): void
  onQuitarRenglon(lineaId: string): void
  onQuitarTalento(): void
}

export function BloqueTalento({
  talento: t, soloLectura, onAgregarRenglon, onCambiarRenglon,
  onQuitarRenglon, onQuitarTalento,
}: BloqueTalentoProps) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')

  const frecuentes = t.acciones.slice(0, VISIBLES)
  const resto = t.acciones.slice(VISIBLES)

  const restoFiltrado = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return q ? resto.filter((a) => a.nombre.toLowerCase().includes(q)) : resto
  }, [resto, busqueda])

  const neto = t.renglones.reduce((s, r) => s + totalRenglon(r), 0)

  return (
    <article className="rounded-katana border border-katana-200 bg-white p-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-bold uppercase tracking-[0.02em] text-katana-800">
          {t.nombre}
        </h3>
        {t.categoria && (
          <span className="text-etiqueta text-xs">{t.categoria}</span>
        )}
        <Link
          href={`/talentos/${t.slug}`}
          className="text-xs text-katana-600 underline underline-offset-2 hover:text-katana-800"
        >
          Ver perfil
        </Link>
        <span className="ml-auto flex items-center gap-3">
          {neto > 0 && (
            <span className="text-sm font-semibold tabular text-tinta">
              {formatMXN(neto)}
            </span>
          )}
          <button
            type="button"
            onClick={onQuitarTalento}
            disabled={soloLectura}
            data-touch-target
            aria-label={`Quitar a ${t.nombre} de la cotización`}
            className="text-etiqueta min-h-[44px] min-w-[44px] rounded-katana px-2 text-lg leading-none hover:bg-katana-50 hover:text-error disabled:opacity-40"
          >
            ×
          </button>
        </span>
      </header>

      {t.renglones.length > 0 && (
        <ul className="mt-2">
          {t.renglones.map((r) => (
            <RenglonLinea
              key={r.id}
              renglon={r}
              talento={t.nombre}
              soloLectura={soloLectura}
              onCambiar={(c) => onCambiarRenglon(r.id, c)}
              onQuitar={() => onQuitarRenglon(r.id)}
            />
          ))}
        </ul>
      )}

      {t.acciones.length === 0 ? (
        <p className="text-etiqueta mt-3 text-sm">
          {t.nombre} todavía no tiene tarifas en el tarifario.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {frecuentes.map((a) => (
            <button
              key={a.deliverableTypeId}
              type="button"
              onClick={() => onAgregarRenglon(a.deliverableTypeId)}
              disabled={soloLectura}
              data-touch-target
              title={
                a.priceStatus === 'QUOTED' && a.amountCents !== null
                  ? formatMXN(a.amountCents)
                  : 'Por validar'
              }
              className="min-h-[44px] rounded-katana border border-katana-300 bg-katana-50 px-3 text-sm font-medium text-katana-700 hover:border-katana-500 hover:bg-katana-100 disabled:opacity-50"
            >
              {a.nombre}
            </button>
          ))}

          {resto.length > 0 && (
            <button
              type="button"
              onClick={() => setAbierto((v) => !v)}
              disabled={soloLectura}
              data-touch-target
              aria-expanded={abierto}
              className="text-etiqueta min-h-[44px] rounded-katana border border-dashed border-katana-300 px-3 text-sm hover:border-katana-500 hover:text-katana-700 disabled:opacity-50"
            >
              {abierto ? 'Menos' : `+ Más (${resto.length})`}
            </button>
          )}
        </div>
      )}

      {abierto && resto.length > 0 && (
        <div className="mt-2 rounded-katana border border-katana-200 bg-katana-50 p-2.5">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar formato…"
            aria-label={`Buscar formato para ${t.nombre}`}
            data-touch-target
            className="mb-2 min-h-[44px] w-full rounded-katana border border-katana-200 bg-white px-3 text-base text-tinta placeholder:text-etiqueta focus:border-katana-500 focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {restoFiltrado.map((a) => (
              <button
                key={a.deliverableTypeId}
                type="button"
                onClick={() => {
                  onAgregarRenglon(a.deliverableTypeId)
                  setAbierto(false)
                  setBusqueda('')
                }}
                disabled={soloLectura}
                data-touch-target
                className="min-h-[44px] rounded-katana border border-katana-200 bg-white px-3 text-sm text-tinta hover:border-katana-500 disabled:opacity-50"
              >
                {a.nombre}
                {a.priceStatus === 'QUOTED' && a.amountCents !== null && (
                  <span className="text-etiqueta ml-2 text-xs tabular">
                    {formatMXN(a.amountCents)}
                  </span>
                )}
              </button>
            ))}
            {restoFiltrado.length === 0 && (
              <p className="text-etiqueta px-1 py-2 text-sm">Nada coincide.</p>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
