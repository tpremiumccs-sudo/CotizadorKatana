'use client'

import { useId, useState } from 'react'
import { formatMXN } from '@/lib/money'
import {
  precioEfectivo, tieneAjuste, deltaCentavos, deltaBps,
  type CeldaEditor, type EstadoPrecioEditor,
} from '@/lib/editor/tipos'

/**
 * Una celda de la matriz de precios.
 *
 * Muestra el precio efectivo y, cuando está ajustado, de dónde salió: "Base
 * $195,000 · −$45,000 (−23.1%)". Ese renglón es lo que permite responder en
 * junta "¿por qué HONOR paga menos?" sin abrir el Excel.
 *
 * Los cuatro estados de precio se editan aquí mismo, no en un flujo aparte:
 * poner cifra sobre un "Pendiente" es el gesto más común de la agencia —tres de
 * los precios del tabulador de HONOR son exactamente eso—.
 */

/**
 * Cómo se nombra cada estado de tarifa frente al usuario.
 *
 * "Por validar" y no "Pendiente": lo que le falta a esa tarifa es que alguien
 * la confirme. Es la misma palabra que usa la hoja de cotización, para que el
 * tarifario y el documento no llamen distinto a lo mismo.
 */
export const ETIQUETA_ESTADO: Record<EstadoPrecioEditor, string> = {
  QUOTED: 'Con precio',
  PENDING: 'Por validar',
  CASE_BY_CASE: 'Caso por caso',
  NOT_APPLICABLE: 'No aplica',
}

/** Los estados que se eligen del menú: los que NO llevan importe. */
const SIN_IMPORTE: EstadoPrecioEditor[] = ['PENDING', 'CASE_BY_CASE', 'NOT_APPLICABLE']

/** Cómo se lee el precio cuando no es un importe. */
function textoNoImporte(status: EstadoPrecioEditor): string {
  return ETIQUETA_ESTADO[status]
}

export interface CeldaPrecioProps {
  celda: CeldaEditor
  talento: string
  formato: string
  soloLectura: boolean
  sucia: boolean
  onCambiar(cambio: {
    status: EstadoPrecioEditor | null
    amountCents: number | null
  }): void
  onRevertir(): void
  children: React.ReactNode
}

export function CeldaPrecio({
  celda, talento, formato, soloLectura, sucia,
  onCambiar, onRevertir, children,
}: CeldaPrecioProps) {
  const [abierto, setAbierto] = useState(false)
  const idMenu = useId()

  const efectivo = precioEfectivo(celda)
  const ajustada = tieneAjuste(celda)
  const delta = deltaCentavos(celda)
  const bps = deltaBps(celda)
  const estado = efectivo.status

  const descripcion = ajustada
    ? explicarAjuste(celda, delta, bps)
    : celda.basePriceStatus === 'QUOTED'
      ? 'Precio del tarifario'
      : `Tarifario: ${textoNoImporte(celda.basePriceStatus)}`

  return (
    <div className="relative">
      <div
        className={
          'rounded-katana border px-2 py-1.5 transition-colors ' +
          (ajustada
            ? 'border-katana-300 bg-katana-100'
            : 'border-transparent hover:border-katana-200')
        }
      >
        {/*
          El campo está SIEMPRE, también cuando la celda es "Pendiente" o "Caso
          por caso": entonces va vacío y con el estado de marcador. Poner cifra
          sobre un "Pendiente" es el gesto más común de la agencia —tres de los
          precios del tabulador de HONOR son exactamente eso— y no debe requerir
          abrir un menú antes de poder escribir.
        */}
        {children}

        <div className="mt-1 flex min-h-[18px] items-center justify-between gap-1">
          <p
            className={
              'truncate text-[11px] leading-tight ' +
              (ajustada ? 'font-medium text-katana-600' : 'text-etiqueta')
            }
            title={descripcion}
          >
            {ajustada && <span aria-hidden>● </span>}
            {descripcion}
          </p>

          {!soloLectura && (
            <button
              type="button"
              aria-label={`Opciones de ${talento} · ${formato}`}
              aria-expanded={abierto}
              aria-controls={idMenu}
              onClick={() => setAbierto((v) => !v)}
              className="shrink-0 rounded px-1 text-etiqueta hover:text-katana-600"
            >
              ⋯
            </button>
          )}
        </div>

        <span className="sr-only" aria-live="polite">
          {sucia ? 'sin guardar' : ''}
        </span>
      </div>

      {abierto && !soloLectura && (
        <div
          id={idMenu}
          className="absolute right-0 z-20 mt-1 w-56 rounded-katana border
                     border-katana-200 bg-white p-1 shadow-lg"
        >
          {/*
            "Con precio" NO está en el menú: la forma de poner precio es
            escribirlo. Ofrecerlo aquí permitiría dejar la celda en "cotizada
            sin importe", que es un estado que no significa nada y que el
            servidor rechazaría.
          */}
          {SIN_IMPORTE.map((s) => (
            <button
              key={s}
              type="button"
              data-touch-target
              onClick={() => {
                onCambiar({ status: s, amountCents: null })
                setAbierto(false)
              }}
              className={
                'flex min-h-[44px] w-full items-center rounded px-3 text-left text-sm ' +
                (s === estado
                  ? 'bg-katana-100 font-medium text-katana-700'
                  : 'text-tinta hover:bg-katana-100')
              }
            >
              {ETIQUETA_ESTADO[s]}
            </button>
          ))}

          {ajustada && (
            <>
              <div className="my-1 border-t border-katana-200" />
              <button
                type="button"
                data-touch-target
                onClick={() => {
                  onRevertir()
                  setAbierto(false)
                }}
                className="flex min-h-[44px] w-full items-center rounded px-3 text-left
                           text-sm text-katana-600 hover:bg-katana-100"
              >
                Volver al tarifario
                <span className="ml-auto text-xs text-etiqueta">
                  {celda.basePriceStatus === 'QUOTED' && celda.baseAmountCents !== null
                    ? formatMXN(celda.baseAmountCents)
                    : textoNoImporte(celda.basePriceStatus)}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * La frase que explica el ajuste.
 *
 * Cuando el tarifario no tenía cifra no hay porcentaje que calcular — y decir
 * "−100%" sería mentira —, así que se dice de dónde venía.
 */
function explicarAjuste(
  c: CeldaEditor,
  delta: number | null,
  bps: number | null,
): string {
  if (c.basePriceStatus !== 'QUOTED' || c.baseAmountCents === null) {
    return `Sin tarifa base (${textoNoImporte(c.basePriceStatus)})`
  }
  const base = `Base ${formatMXN(c.baseAmountCents)}`
  if (delta === null) return `${base} · ajustado`
  if (delta === 0) return `${base} · igual`

  const signo = delta < 0 ? '−' : '+'
  const monto = `${signo}${formatMXN(Math.abs(delta))}`
  const pct =
    bps === null ? '' : ` (${signo}${(Math.abs(bps) / 100).toFixed(1)}%)`
  return `${base} · ${monto}${pct}`
}
