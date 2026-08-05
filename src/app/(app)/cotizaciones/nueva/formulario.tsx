'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { crearCotizacionAccion, type EstadoNueva } from './acciones'

/**
 * Alta de una cotización.
 *
 * Se pide lo mínimo para tener un documento sobre la mesa: cliente, talentos y
 * formatos. Todo lo demás —precios, textos, nombres impresos— se ajusta ya
 * dentro del editor, con el documento a la vista.
 */

export interface OpcionTalento {
  id: string
  nombre: string
  categoria: string | null
  conTarifa: number
}

export interface OpcionFormato {
  id: string
  nombre: string
  etiquetaPdf: string
  sublabel: string | null
}

const CAMPO =
  'min-h-[44px] w-full rounded-katana border border-katana-200 bg-white px-3 ' +
  'text-base text-tinta placeholder:text-etiqueta focus:border-katana-500 focus:outline-none'

function Boton({ habilitado }: { habilitado: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || !habilitado}
      data-touch-target
      className="min-h-[44px] w-full rounded-katana bg-katana-500 px-4 text-sm
                 font-semibold text-white hover:bg-katana-600
                 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
    >
      {pending ? 'Creando…' : 'Crear y abrir el editor'}
    </button>
  )
}

export function FormularioNueva({
  talentos, formatos,
}: {
  talentos: OpcionTalento[]
  formatos: OpcionFormato[]
}) {
  const [estado, accion] = useActionState<EstadoNueva, FormData>(
    crearCotizacionAccion,
    {},
  )
  const [talentosElegidos, setTalentos] = useState<Set<string>>(new Set())
  const [formatosElegidos, setFormatos] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')

  const filtrados = busqueda.trim()
    ? talentos.filter((t) =>
        t.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : talentos

  const alternar = (
    set: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) =>
    set((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })

  return (
    <form action={accion} className="space-y-8" noValidate>
      {estado.error && (
        <div
          role="alert"
          data-testid="error-nueva"
          className="rounded-katana border border-red-200 bg-red-50 px-3 py-2 text-sm text-error"
        >
          {estado.error}
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-katana-800">Para quién</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="cliente" className="mb-1 block text-sm font-medium text-tinta">
              Cliente
            </label>
            <input
              id="cliente" name="cliente" required className={CAMPO}
              placeholder="HONOR" autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="contacto" className="mb-1 block text-sm font-medium text-tinta">
              Contacto <span className="text-etiqueta">(opcional)</span>
            </label>
            <input
              id="contacto" name="contacto" className={CAMPO}
              placeholder="Fer Nicolini" autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="proyecto" className="mb-1 block text-sm font-medium text-tinta">
              Proyecto <span className="text-etiqueta">(opcional)</span>
            </label>
            <input
              id="proyecto" name="proyecto" className={CAMPO}
              placeholder="Campaña Q3" autoComplete="off"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-katana-800">
          Talentos{' '}
          <span className="font-normal text-etiqueta">
            ({talentosElegidos.size} elegido{talentosElegidos.size === 1 ? '' : 's'})
          </span>
        </legend>
        {talentosElegidos.size > 0 && (
          <p className="text-xs text-tinta-suave">
            Saldrán en este orden:{' '}
            <span className="font-medium text-tinta">
              {[...talentosElegidos]
                .map((id) => talentos.find((t) => t.id === id)?.nombre ?? '')
                .join(' · ')}
            </span>
          </p>
        )}
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar talento…"
          aria-label="Buscar talento"
          className={CAMPO}
        />
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((t) => (
            <li key={t.id}>
              <label
                className={
                  'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-katana ' +
                  'border px-3 py-2 text-sm transition-colors ' +
                  (talentosElegidos.has(t.id)
                    ? 'border-katana-400 bg-katana-100'
                    : 'border-katana-200 hover:border-katana-300')
                }
              >
                <input
                  type="checkbox"
                  value={t.id}
                  checked={talentosElegidos.has(t.id)}
                  onChange={() => alternar(setTalentos, t.id)}
                  className="size-4 rounded border-katana-300 text-katana-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-tinta">{t.nombre}</span>
                  <span className="block text-xs text-etiqueta">
                    {t.conTarifa > 0
                      ? `${t.conTarifa} formato(s) con precio`
                      : 'sin precios en el tarifario'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {filtrados.length === 0 && (
          <p className="text-sm text-etiqueta">Ningún talento coincide con la búsqueda.</p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-katana-800">
          Formatos{' '}
          <span className="font-normal text-etiqueta">
            ({formatosElegidos.size} — serán las columnas del tabulador)
          </span>
        </legend>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {formatos.map((f) => (
            <li key={f.id}>
              <label
                className={
                  'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-katana ' +
                  'border px-3 py-2 text-sm transition-colors ' +
                  (formatosElegidos.has(f.id)
                    ? 'border-katana-400 bg-katana-100'
                    : 'border-katana-200 hover:border-katana-300')
                }
              >
                <input
                  type="checkbox"
                  value={f.id}
                  checked={formatosElegidos.has(f.id)}
                  onChange={() => alternar(setFormatos, f.id)}
                  className="size-4 rounded border-katana-300 text-katana-500"
                />
                <span className="min-w-0 flex-1 truncate font-medium text-tinta">
                  {f.nombre}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {formatosElegidos.size > 6 && (
          <p className="text-sm text-alerta">
            Con más de seis columnas el tabulador se vuelve ilegible en hoja
            carta. Considera dividirlo en dos documentos.
          </p>
        )}
      </fieldset>

      {/*
        El orden IMPORTA: es el de las filas y las columnas del documento, y no
        tiene por qué ser alfabético — el tabulador de HONOR real va Mariel,
        Tony, Yoiker, Ronny. Las casillas se envían en el orden del DOM, así que
        el valor viaja en estos campos ocultos, que van en el orden en que se
        marcaron (un Set de JavaScript conserva el orden de inserción).
      */}
      {[...talentosElegidos].map((id) => (
        <input key={id} type="hidden" name="talento" value={id} />
      ))}
      {[...formatosElegidos].map((id) => (
        <input key={id} type="hidden" name="formato" value={id} />
      ))}

      <Boton habilitado={talentosElegidos.size > 0 && formatosElegidos.size > 0} />
    </form>
  )
}
