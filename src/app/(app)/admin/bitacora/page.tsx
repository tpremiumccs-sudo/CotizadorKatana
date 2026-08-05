import type { Metadata } from 'next'
import { leerBitacora, actoresDeBitacora } from '@/server/data/admin'
import type { CategoriaBitacora } from '@/server/audit/append'

export const metadata: Metadata = { title: 'Bitácora' }

/**
 * La bitácora.
 *
 * Espeja el modelo mental que la agencia ya tenía en su hoja HISTORIAL
 * TALENTOS: fecha, qué, quién, valor anterior y valor nuevo. Se LEE, no se
 * descifra — por eso cada evento guarda su frase en español ya redactada en vez
 * de un código que haya que interpretar.
 */

const CATEGORIAS: Array<{ valor: string; etiqueta: string }> = [
  { valor: '', etiqueta: 'Todo' },
  { valor: 'COTIZACION', etiqueta: 'Cotizaciones' },
  { valor: 'TARIFARIO', etiqueta: 'Tarifario' },
  { valor: 'IMPORTACION', etiqueta: 'Importaciones' },
  { valor: 'DOCUMENTO', etiqueta: 'Documentos' },
  { valor: 'AUTENTICACION', etiqueta: 'Accesos' },
  { valor: 'USUARIOS', etiqueta: 'Usuarios' },
  { valor: 'CATALOGO', etiqueta: 'Catálogo' },
  { valor: 'AJUSTES', etiqueta: 'Ajustes' },
  { valor: 'SISTEMA', etiqueta: 'Sistema' },
]

const fechaHora = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
})

const CAMPO =
  'min-h-[44px] rounded-katana border border-katana-200 bg-white px-3 text-base ' +
  'focus:border-katana-500 focus:outline-none'

export default async function PaginaBitacora({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const q = await searchParams
  const uno = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) || undefined

  const categoria = uno('categoria') as CategoriaBitacora | undefined
  const actorEmail = uno('actor')
  const texto = uno('q')
  const soloFallidos = uno('fallidos') === '1'

  const [{ eventos, hayMas }, actores] = await Promise.all([
    leerBitacora({ categoria, actorEmail, texto, soloFallidos }),
    actoresDeBitacora(),
  ])

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-katana-800">Bitácora</h1>
      <p className="mt-2 max-w-prose text-sm text-tinta-suave">
        Todo lo que se cambia queda aquí, con quién lo hizo y de qué valor a
        cuál. No se puede borrar: la tabla sólo admite inserciones.
      </p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="categoria" className="mb-1 block text-sm font-medium text-tinta">
            Categoría
          </label>
          <select id="categoria" name="categoria" defaultValue={categoria ?? ''} className={CAMPO}>
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>{c.etiqueta}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="actor" className="mb-1 block text-sm font-medium text-tinta">
            Persona
          </label>
          <select id="actor" name="actor" defaultValue={actorEmail ?? ''} className={CAMPO}>
            <option value="">Cualquiera</option>
            {actores.map((a) => (
              <option key={a.email} value={a.email}>
                {a.nombre} ({a.eventos})
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[200px] flex-1">
          <label htmlFor="q" className="mb-1 block text-sm font-medium text-tinta">
            Buscar
          </label>
          <input
            id="q" name="q" type="search" defaultValue={texto ?? ''}
            placeholder="Ronny, HONOR, $150,000…" className={`${CAMPO} w-full`}
          />
        </div>

        <label className="flex min-h-[44px] items-center gap-2 text-sm text-tinta">
          <input
            type="checkbox" name="fallidos" value="1" defaultChecked={soloFallidos}
            className="size-4 rounded border-katana-300 text-katana-500"
          />
          Sólo intentos denegados
        </label>

        <button
          type="submit"
          data-touch-target
          className="min-h-[44px] rounded-katana bg-katana-500 px-4 text-sm font-semibold
                     text-white hover:bg-katana-600"
        >
          Filtrar
        </button>
      </form>

      <ol className="mt-6 space-y-2">
        {eventos.map((e) => (
          <li
            key={e.id}
            className={
              'rounded-katana border px-4 py-3 ' +
              (e.exito ? 'border-katana-200' : 'border-red-200 bg-red-50')
            }
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <time
                dateTime={e.ocurridoEn.toISOString()}
                className="text-xs tabular-nums text-etiqueta"
              >
                {fechaHora.format(e.ocurridoEn)}
              </time>
              <span className="text-xs font-medium text-katana-500">{e.categoria}</span>
              {!e.exito && (
                <span className="text-xs font-semibold text-error">denegado</span>
              )}
            </div>

            <p className="mt-1 text-sm text-tinta">{e.resumen}</p>

            {e.entidadEtiqueta && (
              <p className="mt-0.5 text-xs text-etiqueta">
                {e.entidadTipo}: {e.entidadEtiqueta}
              </p>
            )}

            {e.cambios != null && (
              <ul className="mt-2 space-y-0.5">
                {Object.entries(
                  e.cambios as Record<string, { antes: unknown; despues: unknown }>,
                ).map(([campo, v]) => (
                  <li key={campo} className="text-xs text-tinta-suave">
                    <span className="font-medium">{campo}:</span> {String(v.antes)}{' '}
                    <span aria-hidden>→</span> {String(v.despues)}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-1 text-xs text-etiqueta">
              {e.actorNombre ?? 'sin sesión'}
              {e.actorRol && ` · ${e.actorRol}`}
              {e.ip && ` · ${e.ip}`}
            </p>
          </li>
        ))}
      </ol>

      {eventos.length === 0 && (
        <p className="mt-6 text-sm text-etiqueta">
          Ningún evento coincide con el filtro.
        </p>
      )}
      {hayMas && (
        <p className="mt-4 text-sm text-etiqueta">
          Se muestran los 100 más recientes. Afina el filtro para ver más atrás.
        </p>
      )}
    </main>
  )
}
