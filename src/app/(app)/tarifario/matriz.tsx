'use client'

import { useMemo, useState } from 'react'
import { InputMoneda } from '@/components/editor/input-moneda'
import { ETIQUETA_ESTADO } from '@/components/editor/celda-precio'
import type {
  Tarifario, CeldaTarifario, FilaTarifario,
} from '@/server/data/tarifario'
import type { EstadoPrecioDoc } from '@/lib/doc/tipos'

/**
 * El tarifario maestro en pantalla: 21 talentos × 19 formatos.
 *
 * Con 399 celdas la tabla completa es ilegible en cualquier pantalla, así que
 * se filtra por categoría de formato y se busca por talento. No se virtualiza:
 * 400 celdas las pinta el navegador sin despeinarse, y virtualizar rompería
 * Ctrl+F, que es como la gente busca de verdad.
 */

/** Las categorías del catálogo, con el nombre que usa la agencia. */
const CATEGORIAS: Array<{ valor: string; etiqueta: string }> = [
  { valor: 'TODAS', etiqueta: 'Todos los formatos' },
  { valor: 'SOCIAL_CONTENT', etiqueta: 'Contenido en redes' },
  { valor: 'PLACEMENT', etiqueta: 'Fijaciones' },
  { valor: 'STREAMING', etiqueta: 'Streaming' },
  { valor: 'YOUTUBE', etiqueta: 'YouTube' },
  { valor: 'LONGFORM', etiqueta: 'Formato largo' },
  { valor: 'EVENT', etiqueta: 'Eventos' },
  { valor: 'RIGHTS', etiqueta: 'Derechos y exclusividad' },
]

type Guardado =
  | { f: 'limpio' }
  | { f: 'guardando' }
  | { f: 'guardado' }
  | { f: 'error'; mensaje: string }

export function MatrizTarifario({
  inicial, soloLectura,
}: {
  inicial: Tarifario
  soloLectura: boolean
}) {
  const [datos, setDatos] = useState(inicial)
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('TODAS')
  const [guardado, setGuardado] = useState<Guardado>({ f: 'limpio' })

  const columnas = useMemo(
    () =>
      categoria === 'TODAS'
        ? datos.columnas
        : datos.columnas.filter((c) => c.categoria === categoria),
    [datos.columnas, categoria],
  )

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return datos.filas
    return datos.filas.filter(
      (f) =>
        f.nombre.toLowerCase().includes(q) ||
        (f.codigo?.toLowerCase().includes(q) ?? false),
    )
  }, [datos.filas, busqueda])

  async function guardar(
    fila: FilaTarifario,
    deliverableTypeId: string,
    cambio: { priceStatus: EstadoPrecioDoc; amountCents: number | null },
  ) {
    const previa = fila.celdas[deliverableTypeId] ?? null
    setGuardado({ f: 'guardando' })

    // Optimista: se pinta ya y se corrige si el servidor dice otra cosa.
    aplicar(fila.talentId, deliverableTypeId, {
      id: previa?.id ?? null,
      amountCents: cambio.priceStatus === 'QUOTED' ? cambio.amountCents : null,
      priceStatus: cambio.priceStatus,
      editadaAMano: true,
      revision: previa?.revision ?? 0,
    })

    try {
      const r = await fetch('/api/tarifario', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          talentId: fila.talentId,
          deliverableTypeId,
          priceStatus: cambio.priceStatus,
          amountCents: cambio.amountCents,
          revision: previa?.revision ?? null,
        }),
      })
      const cuerpo = (await r.json().catch(() => ({}))) as {
        celda?: CeldaTarifario
        error?: string
      }
      if (!r.ok || !cuerpo.celda) {
        // Vuelve a lo que había: no se deja en pantalla una cifra que no se
        // guardó.
        if (previa) aplicar(fila.talentId, deliverableTypeId, previa)
        else quitar(fila.talentId, deliverableTypeId)
        setGuardado({ f: 'error', mensaje: cuerpo.error ?? 'No se pudo guardar.' })
        return
      }
      aplicar(fila.talentId, deliverableTypeId, cuerpo.celda)
      setGuardado({ f: 'guardado' })
    } catch {
      if (previa) aplicar(fila.talentId, deliverableTypeId, previa)
      else quitar(fila.talentId, deliverableTypeId)
      setGuardado({
        f: 'error',
        mensaje: 'Sin conexión con el servidor. El cambio no se guardó.',
      })
    }
  }

  function aplicar(talentId: string, dtId: string, celda: CeldaTarifario) {
    setDatos((d) => ({
      ...d,
      filas: d.filas.map((f) =>
        f.talentId === talentId
          ? { ...f, celdas: { ...f.celdas, [dtId]: celda } }
          : f,
      ),
    }))
  }

  function quitar(talentId: string, dtId: string) {
    setDatos((d) => ({
      ...d,
      filas: d.filas.map((f) => {
        if (f.talentId !== talentId) return f
        const celdas = { ...f.celdas }
        delete celdas[dtId]
        return { ...f, celdas }
      }),
    }))
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="buscar" className="mb-1 block text-sm font-medium text-tinta">
            Buscar talento
          </label>
          <input
            id="buscar"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Ronny, KT-004…"
            className="min-h-[44px] w-full rounded-katana border border-katana-200
                       bg-white px-3 text-base focus:border-katana-500 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="categoria"
            className="mb-1 block text-sm font-medium text-tinta"
          >
            Formatos
          </label>
          <select
            id="categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="min-h-[44px] rounded-katana border border-katana-200 bg-white
                       px-3 text-base focus:border-katana-500 focus:outline-none"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <EstadoGuardado guardado={guardado} />
      </div>

      <p className="mt-3 text-xs text-etiqueta">
        {filas.length} talento(s) × {columnas.length} formato(s). Lo que cambies
        aquí es el precio de lista: las cotizaciones ya armadas conservan el
        suyo.
      </p>

      <div className="mt-3 overflow-x-auto rounded-katana border border-katana-200">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Tarifario maestro: precio de lista por talento y formato.
          </caption>
          <thead>
            <tr className="bg-katana-500 text-white">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[160px] bg-katana-500 px-3 py-2
                           text-left text-xs font-semibold"
              >
                Talento
              </th>
              {columnas.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className="min-w-[130px] px-2 py-2 text-center text-xs font-semibold"
                >
                  {c.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.talentId} className={i % 2 ? 'bg-katana-50' : 'bg-white'}>
                <th
                  scope="row"
                  className={
                    'sticky left-0 z-10 px-3 py-2 text-left align-middle ' +
                    (i % 2 ? 'bg-katana-50' : 'bg-white')
                  }
                >
                  <span className="block font-semibold text-katana-800">
                    {f.nombre}
                  </span>
                  <span className="block text-xs font-normal text-etiqueta">
                    {f.codigo ?? 'sin código'}
                    {f.esMenorDeEdad && ' · menor de edad'}
                    {f.ausenteEnUltimoImport && ' · no vino en el último archivo'}
                  </span>
                  {f.notas && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs font-normal text-katana-500">
                        Notas de tarifa
                      </summary>
                      <p className="mt-1 max-w-[260px] whitespace-pre-wrap text-xs
                                    font-normal text-tinta-suave">
                        {f.notas}
                      </p>
                    </details>
                  )}
                </th>

                {columnas.map((c) => {
                  const celda = f.celdas[c.id]
                  const estado = celda?.priceStatus ?? 'PENDING'
                  return (
                    <td key={c.id} className="px-1 py-1 align-top">
                      <InputMoneda
                        aria-label={`Tarifa de ${f.nombre}, ${c.nombre}`}
                        valorCents={estado === 'QUOTED' ? (celda?.amountCents ?? null) : null}
                        disabled={soloLectura}
                        placeholder={
                          celda ? (ETIQUETA_ESTADO[estado] ?? '—') : 'Sin tarifa'
                        }
                        onCommit={(centavos) =>
                          void guardar(f, c.id, {
                            priceStatus: centavos === null ? 'PENDING' : 'QUOTED',
                            amountCents: centavos,
                          })
                        }
                        className="min-h-[44px] w-full rounded border border-katana-200
                                   bg-white px-2 text-right text-sm font-semibold
                                   text-precio tabular-nums focus:border-katana-500
                                   focus:outline-none disabled:border-transparent
                                   disabled:bg-transparent"
                      />
                      {!soloLectura && (
                        <div className="mt-0.5 flex justify-end gap-0.5">
                          {(['PENDING', 'CASE_BY_CASE', 'NOT_APPLICABLE'] as const).map(
                            (s) => (
                              <button
                                key={s}
                                type="button"
                                title={ETIQUETA_ESTADO[s]}
                                aria-label={`${f.nombre}, ${c.nombre}: marcar como ${ETIQUETA_ESTADO[s]}`}
                                onClick={() =>
                                  void guardar(f, c.id, {
                                    priceStatus: s,
                                    amountCents: null,
                                  })
                                }
                                className={
                                  'rounded px-1 text-[10px] leading-4 ' +
                                  (estado === s
                                    ? 'bg-katana-200 font-semibold text-katana-700'
                                    : 'text-etiqueta hover:bg-katana-100')
                                }
                              >
                                {s === 'PENDING'
                                  ? 'Pend.'
                                  : s === 'CASE_BY_CASE'
                                    ? 'Caso'
                                    : 'N/A'}
                              </button>
                            ),
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filas.length === 0 && (
        <p className="mt-4 text-sm text-etiqueta">
          Ningún talento coincide con “{busqueda}”.
        </p>
      )}
    </div>
  )
}

function EstadoGuardado({ guardado }: { guardado: Guardado }) {
  if (guardado.f === 'limpio') return null
  const texto =
    guardado.f === 'guardando'
      ? 'Guardando…'
      : guardado.f === 'guardado'
        ? 'Guardado'
        : guardado.mensaje
  const color =
    guardado.f === 'error'
      ? 'text-error'
      : guardado.f === 'guardado'
        ? 'text-exito'
        : 'text-alerta'
  return (
    <p
      aria-live="polite"
      data-testid="estado-tarifario"
      data-fase={guardado.f}
      className={`pb-2 text-sm font-medium ${color}`}
    >
      {texto}
    </p>
  )
}
