import type { Metadata } from 'next'
import Link from 'next/link'
import { listarTalentos } from '@/server/data/talentos'

export const metadata: Metadata = { title: 'Talentos' }

const numero = new Intl.NumberFormat('es-MX')

const ETIQUETA_ROSTER: Record<string, string> = {
  KATANA: 'Katana',
  KIF: 'KIF',
  FIERA: 'FIERA',
}

export default async function PaginaTalentos() {
  const talentos = await listarTalentos()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-katana-800">Talentos</h1>
      <p className="mt-2 max-w-prose text-sm text-tinta-suave">
        {talentos.length} en el sistema. La cifra de alcance suma los seguidores
        de cada plataforma, así que cuenta a la misma persona más de una vez: es
        alcance, no audiencia única.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {talentos.map((t) => (
          <li key={t.id}>
            <Link
              href={`/talentos/${t.slug}`}
              className="flex h-full min-h-[44px] flex-col rounded-katana border
                         border-katana-200 p-4 hover:border-katana-300 hover:bg-katana-50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-semibold text-katana-800">
                  {t.nombre}
                </span>
                <span className="shrink-0 text-xs text-etiqueta">
                  {t.codigo ?? ETIQUETA_ROSTER[t.roster] ?? t.roster}
                </span>
              </div>

              {t.nombreCanonico !== t.nombre && (
                <span className="mt-0.5 text-xs text-etiqueta">
                  también {t.nombreCanonico}
                </span>
              )}

              <p className="mt-2 text-sm text-tinta-suave">
                {t.formatosConPrecio > 0
                  ? `${t.formatosConPrecio} formato(s) con precio`
                  : 'sin precios cargados'}
                {t.formatosTarifados > t.formatosConPrecio &&
                  ` · ${t.formatosTarifados - t.formatosConPrecio} por definir`}
              </p>

              {t.alcance > 0 && (
                <p className="mt-1 text-sm tabular-nums text-tinta-suave">
                  {numero.format(t.alcance)} de alcance
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-1 pt-3">
                {t.esMenorDeEdad && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium
                                   text-alerta">
                    Menor de edad
                  </span>
                )}
                {t.ausente && (
                  <span className="rounded bg-katana-100 px-2 py-0.5 text-xs text-tinta-suave">
                    No vino en el último archivo
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {talentos.length === 0 && (
        <p className="mt-8 rounded-katana border border-katana-200 bg-katana-100 p-5
                      text-sm text-tinta-suave">
          Todavía no hay talentos. Importa el CRM desde{' '}
          <Link href="/importaciones" className="font-semibold text-katana-500 underline">
            Importaciones
          </Link>
          .
        </p>
      )}
    </main>
  )
}
