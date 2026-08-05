'use client'

import { CeldaPrecio, ETIQUETA_ESTADO } from './celda-precio'
import { InputMoneda } from './input-moneda'
import {
  claveCelda, precioEfectivo,
  type EstadoEditor, type EstadoPrecioEditor,
} from '@/lib/editor/tipos'

/**
 * La matriz de precios: talentos en filas, formatos en columnas.
 *
 * Es la misma forma que tiene el tabulador impreso, a propósito — quien lo edita
 * está viendo la misma cuadrícula que verá la marca, sólo que con los campos
 * abiertos.
 *
 * En pantallas angostas la tabla se desplaza en horizontal DENTRO de su
 * contenedor, con la columna del talento fija: la página nunca se desborda.
 */

export interface MatrizPreciosProps {
  estado: EstadoEditor
  soloLectura: boolean
  sucias: ReadonlySet<string>
  onCambiar(
    clave: string,
    cambio: { status: EstadoPrecioEditor | null; amountCents: number | null },
  ): void
  onRevertir(clave: string): void
  onSeleccionar(clave: string | null): void
}

export function MatrizPrecios({
  estado, soloLectura, sucias, onCambiar, onRevertir, onSeleccionar,
}: MatrizPreciosProps) {
  const columnas = [...estado.columnas].sort((a, b) => a.orden - b.orden)
  const talentos = [...estado.talentos].sort((a, b) => a.orden - b.orden)

  return (
    <div className="overflow-x-auto rounded-katana border border-katana-200">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">
          Precios por talento y formato. Cada celda muestra el precio efectivo y,
          si se ajustó, el precio del tarifario y la diferencia.
        </caption>
        <thead>
          <tr className="bg-katana-500 text-white">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-katana-500 px-3 py-2 text-left
                         text-xs font-semibold tracking-wide"
            >
              Talento
            </th>
            {columnas.map((c) => (
              <th
                key={c.deliverableTypeId}
                scope="col"
                className="px-2 py-2 text-center text-xs font-semibold tracking-wide"
              >
                {c.label}
                {c.sublabel && (
                  <span className="block font-normal opacity-90">{c.sublabel}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {talentos.map((t, i) => (
            <tr key={t.id} className={i % 2 ? 'bg-katana-50' : 'bg-white'}>
              <th
                scope="row"
                className={
                  'sticky left-0 z-10 px-3 py-2 text-left align-middle font-semibold ' +
                  'text-katana-800 ' +
                  (i % 2 ? 'bg-katana-50' : 'bg-white')
                }
              >
                {t.nombre}
              </th>

              {columnas.map((col) => {
                const clave = claveCelda(t.id, col.deliverableTypeId)
                const celda = estado.celdas[clave]
                if (!celda) {
                  return (
                    <td key={col.deliverableTypeId} className="px-1 py-1 text-center">
                      <span className="text-etiqueta">—</span>
                    </td>
                  )
                }
                const efectivo = precioEfectivo(celda)
                const etiqueta = `${t.nombre}, ${col.label}${col.sublabel ? ' ' + col.sublabel : ''}`

                return (
                  <td key={col.deliverableTypeId} className="px-1 py-1 align-top">
                    <CeldaPrecio
                      celda={celda}
                      talento={t.nombre}
                      formato={col.label}
                      soloLectura={soloLectura}
                      sucia={sucias.has(clave)}
                      onCambiar={(c) => onCambiar(clave, c)}
                      onRevertir={() => onRevertir(clave)}
                    >
                      <InputMoneda
                        aria-label={`Precio de ${etiqueta}`}
                        valorCents={efectivo.amountCents}
                        disabled={soloLectura}
                        // Cuando no hay importe, el estado es el marcador: se
                        // ve qué pasa con esa celda y se puede escribir encima.
                        placeholder={
                          efectivo.status === 'QUOTED'
                            ? '—'
                            : ETIQUETA_ESTADO[efectivo.status]
                        }
                        onFocus={() => onSeleccionar(clave)}
                        onCommit={(centavos) =>
                          onCambiar(clave, {
                            // Vaciar el campo no significa "cero pesos": vuelve
                            // a dejar el precio como pendiente de tarifar.
                            status: centavos === null ? 'PENDING' : 'QUOTED',
                            amountCents: centavos,
                          })
                        }
                        className="min-h-[44px] w-full rounded border border-katana-200
                                   bg-white px-2 text-right text-base font-semibold
                                   text-precio tabular-nums
                                   focus:border-katana-500 focus:outline-none
                                   disabled:border-transparent disabled:bg-transparent
                                   aria-[invalid]:border-red-400"
                      />
                    </CeldaPrecio>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
