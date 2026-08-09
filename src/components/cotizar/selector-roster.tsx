'use client'

import { useMemo, useState } from 'react'
import type { CardRoster } from '@/server/data/catalogo'

/**
 * El roster, como selección de personaje.
 *
 * Un tap agrega. No hay casilla, ni confirmar, ni continuar: el encargo pide
 * que agregar un talento cueste una sola interacción, y cualquier paso
 * intermedio es el que hay que quitar.
 *
 * La tarjeta enseña foto, nombre y categoría, y nada más. La biografía, las
 * métricas y las campañas pertenecen a la ficha del talento, no al acto de
 * cotizar.
 */

/** Normaliza para buscar: "Tejon" tiene que encontrar a "Tejón". */
function plegar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Iniciales para cuando el talento todavía no tiene foto cargada. */
function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter((p) => p.length > 1)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export interface SelectorRosterProps {
  roster: CardRoster[]
  /** Talent.id ya en la cotización: se marcan y no se vuelven a agregar. */
  agregados: Set<string>
  onAgregar(talentId: string): void
  disabled?: boolean
}

export function SelectorRoster({
  roster, agregados, onAgregar, disabled,
}: SelectorRosterProps) {
  const [busqueda, setBusqueda] = useState('')

  const visibles = useMemo(() => {
    const q = plegar(busqueda.trim())
    if (!q) return roster
    return roster.filter(
      (t) => plegar(t.nombre).includes(q) || plegar(t.categoria ?? '').includes(q),
    )
  }, [roster, busqueda])

  return (
    <section aria-labelledby="titulo-roster">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="titulo-roster" className="text-etiqueta text-xs font-semibold uppercase tracking-[0.14em]">
          Talentos
        </h2>
        {roster.length > 0 && (
          <span className="text-etiqueta text-xs tabular">
            {visibles.length} de {roster.length}
          </span>
        )}
      </div>

      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar talento…"
        aria-label="Buscar talento"
        data-touch-target
        className="mb-3 min-h-[44px] w-full rounded-katana border border-katana-200 bg-white px-3 text-base text-tinta placeholder:text-etiqueta focus:border-katana-500 focus:outline-none"
      />

      {visibles.length === 0 ? (
        <p className="text-etiqueta rounded-katana border border-dashed border-katana-200 px-3 py-6 text-center text-sm">
          Nadie coincide con «{busqueda}».
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visibles.map((t) => {
            const puesto = agregados.has(t.id)
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onAgregar(t.id)}
                  disabled={disabled || puesto}
                  data-touch-target
                  aria-label={puesto ? `${t.nombre}, ya agregado` : `Agregar a ${t.nombre}`}
                  className={[
                    'flex min-h-[44px] w-full items-center gap-2.5 rounded-katana border px-2.5 py-2 text-left transition-colors',
                    puesto
                      ? 'cursor-default border-katana-300 bg-katana-100'
                      : 'border-katana-200 bg-white hover:border-katana-500 hover:bg-katana-50 disabled:opacity-50',
                  ].join(' ')}
                >
                  {t.fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.fotoUrl}
                      alt=""
                      width={36}
                      height={36}
                      className="h-9 w-9 shrink-0 rounded-katana object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-katana bg-katana-800 text-[11px] font-semibold text-white"
                    >
                      {iniciales(t.nombre)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold leading-tight text-katana-800">
                      {t.nombre}
                    </span>
                    {t.categoria && (
                      <span className="text-etiqueta block truncate text-[11px] leading-tight">
                        {t.categoria}
                      </span>
                    )}
                  </span>
                  {puesto && (
                    <span aria-hidden="true" className="ml-auto text-katana-500">✓</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
