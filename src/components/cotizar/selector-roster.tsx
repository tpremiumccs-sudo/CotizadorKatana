'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CardRoster } from '@/server/data/catalogo'

/**
 * El roster: se escribe o se mira, y con un toque entra a la cotización.
 *
 * Dos maneras, según cómo llegue quien cotiza:
 *
 *   · **Sabe a quién quiere.** Teclea "nen", el autocompletado propone, Enter
 *     y listo. Sin levantar la mano del teclado.
 *   · **Está explorando.** Abre "Ver todos" y elige de las tarjetas.
 *
 * La parrilla no está desplegada de entrada a propósito: veintiún rostros
 * compitiendo con la cotización que se está armando es ruido, y quien ya sabe
 * a quién quiere no necesita verlos.
 */

/** Normaliza para buscar: "Tejon" tiene que encontrar a "Tejón". */
function plegar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Monograma para quien todavía no tiene foto cargada en el CRM. */
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
  const [abierto, setAbierto] = useState(false)
  const [verTodos, setVerTodos] = useState(false)
  const [resaltado, setResaltado] = useState(0)
  const caja = useRef<HTMLDivElement>(null)
  const idLista = useId()

  const sugerencias = useMemo(() => {
    const q = plegar(busqueda.trim())
    if (!q) return []
    return roster
      .filter(
        (t) => plegar(t.nombre).includes(q) || plegar(t.categoria ?? '').includes(q),
      )
      // Quien empieza con lo tecleado va primero: "nen" debe ofrecer Nene
      // antes que a alguien que sólo lo lleva en medio del nombre.
      .sort((a, b) => {
        const ia = plegar(a.nombre).startsWith(q) ? 0 : 1
        const ib = plegar(b.nombre).startsWith(q) ? 0 : 1
        return ia - ib || a.nombre.localeCompare(b.nombre)
      })
      .slice(0, 7)
  }, [roster, busqueda])

  useEffect(() => { setResaltado(0) }, [busqueda])

  // Cerrar al tocar fuera: si no, la lista se queda flotando sobre la hoja.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  function elegir(t: CardRoster) {
    if (agregados.has(t.id)) return
    onAgregar(t.id)
    setBusqueda('')
    setAbierto(false)
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierto || sugerencias.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setResaltado((i) => (i + 1) % sugerencias.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => (i - 1 + sugerencias.length) % sugerencias.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const t = sugerencias[resaltado]
      if (t) elegir(t)
    } else if (e.key === 'Escape') {
      setAbierto(false)
    }
  }

  return (
    <section aria-labelledby="titulo-roster">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id="titulo-roster"
          className="text-etiqueta text-xs font-semibold uppercase tracking-[0.14em]"
        >
          Agregar talento
        </h2>
        <button
          type="button"
          onClick={() => setVerTodos((v) => !v)}
          data-touch-target
          aria-expanded={verTodos}
          className="text-etiqueta min-h-[44px] text-xs font-semibold uppercase
                     tracking-[0.1em] hover:text-katana-700"
        >
          {verTodos ? 'Ocultar' : `Ver todos (${roster.length})`}
        </button>
      </div>

      {/* ── Buscador con autocompletado ─────────────────────────────── */}
      <div ref={caja} className="relative">
        <input
          type="text"
          role="combobox"
          value={busqueda}
          disabled={disabled}
          onChange={(e) => { setBusqueda(e.target.value); setAbierto(true) }}
          onFocus={() => setAbierto(true)}
          onKeyDown={teclas}
          placeholder="Escribe un nombre…"
          aria-label="Buscar talento"
          aria-expanded={abierto && sugerencias.length > 0}
          aria-controls={idLista}
          aria-autocomplete="list"
          autoComplete="off"
          data-touch-target
          className="min-h-[48px] w-full rounded-katana border border-katana-200 bg-white
                     px-4 text-base text-tinta placeholder:text-etiqueta
                     focus:border-katana-500 focus:outline-none"
        />

        {abierto && sugerencias.length > 0 && (
          <ul
            id={idLista}
            role="listbox"
            className="absolute z-30 mt-1 w-full overflow-hidden rounded-katana border
                       border-katana-300 bg-white shadow-lg"
          >
            {sugerencias.map((t, i) => {
              const puesto = agregados.has(t.id)
              return (
                <li key={t.id} role="option" aria-selected={i === resaltado}>
                  <button
                    type="button"
                    disabled={disabled || puesto}
                    onMouseEnter={() => setResaltado(i)}
                    onClick={() => elegir(t)}
                    data-touch-target
                    className={[
                      'flex min-h-[48px] w-full items-center gap-3 px-3 text-left',
                      i === resaltado ? 'bg-katana-100' : 'bg-white',
                      puesto ? 'opacity-50' : 'hover:bg-katana-100',
                    ].join(' ')}
                  >
                    <Retrato t={t} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-katana-800">
                        {t.nombre}
                      </span>
                      {t.categoria && (
                        <span className="text-etiqueta block truncate text-xs">
                          {t.categoria}
                        </span>
                      )}
                    </span>
                    <span className="text-etiqueta shrink-0 text-xs">
                      {puesto ? 'ya está' : `${t.conTarifa} con precio`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {busqueda.trim() && sugerencias.length === 0 && (
        <p className="text-etiqueta mt-2 text-sm">
          Nadie del roster coincide con «{busqueda}».
        </p>
      )}

      {/* ── La parrilla completa, bajo petición ─────────────────────── */}
      {verTodos && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {roster.map((t) => {
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
                      : 'border-katana-200 bg-white hover:border-katana-500 hover:bg-katana-50',
                  ].join(' ')}
                >
                  <Retrato t={t} />
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

/** Foto del CRM cuando la hay; monograma cuando no. Nunca un hueco gris. */
function Retrato({ t }: { t: CardRoster }) {
  if (t.fotoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={t.fotoUrl}
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-katana object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-katana
                 bg-katana-800 text-[11px] font-semibold text-white"
    >
      {iniciales(t.nombre)}
    </span>
  )
}
