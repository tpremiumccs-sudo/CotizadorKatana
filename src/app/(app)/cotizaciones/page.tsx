import type { Metadata } from 'next'
import Link from 'next/link'
import { listarCotizaciones } from '@/server/data/cotizacion'
import { requireActor } from '@/server/data/actor'
import { can } from '@/lib/authz/policy'
import { abrirHojaNueva } from './nueva/acciones'
import { formatMXN } from '@/lib/money'

export const metadata: Metadata = { title: 'Cotizaciones' }

const ETIQUETA_ESTADO: Record<string, string> = {
  DRAFT: 'Borrador',
  REQUIERE_APROBACION: 'Requiere aprobación',
  SENT: 'Enviada',
  IN_NEGOTIATION: 'En negociación',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Vencida',
  CANCELLED: 'Cancelada',
}

const fecha = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric',
})

export default async function PaginaCotizaciones() {
  const actor = await requireActor()
  const cotizaciones = await listarCotizaciones()
  const puedeCrear = can(actor, 'cotizacion.crear').permitido

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-katana-800">
          Cotizaciones
        </h1>
        {puedeCrear && (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/cotizaciones/nueva"
              data-touch-target
              className="inline-flex min-h-[44px] items-center rounded-katana px-2
                         text-sm text-katana-600 underline underline-offset-2
                         hover:bg-katana-100 hover:text-katana-800"
            >
              Tabulador comparativo
            </Link>
            <form action={abrirHojaNueva}>
              <button
                type="submit"
                data-touch-target
                className="inline-flex min-h-[44px] items-center rounded-katana bg-katana-500
                           px-4 text-sm font-semibold text-white hover:bg-katana-600"
              >
                Nueva cotización
              </button>
            </form>
          </div>
        )}
      </div>

      {cotizaciones.length === 0 ? (
        <p className="mt-8 rounded-katana border border-katana-200 bg-katana-100 p-5
                      text-sm text-tinta-suave">
          Todavía no hay ninguna.{' '}
          {puedeCrear
            ? 'Crea la primera: agrega un talento y toca lo que le vas a vender.'
            : 'Cuando alguien cree una, aparecerá aquí.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {cotizaciones.map((q) => (
            <li key={q.id}>
              <Link
                href={`/cotizaciones/${q.id}`}
                className="flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-1
                           rounded-katana border border-katana-200 px-4 py-3
                           hover:border-katana-300 hover:bg-katana-50"
              >
                <span className="font-mono text-xs font-semibold text-katana-500">
                  {q.folio ?? q.draftRef}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-katana-800">
                  {q.client.displayName}
                  {q.projectName && (
                    <span className="font-normal text-tinta-suave">
                      {' '}· {q.projectName}
                    </span>
                  )}
                </span>
                <span className="text-xs text-etiqueta">
                  {/* La hoja cuenta renglones; el tabulador, columnas. Decir
                      "0 formato(s)" en una hoja es contar lo que no tiene. */}
                  {q.includeCotizacion
                    ? `${q._count.talents} talento(s) · ${q._count.lines} renglón(es)`
                    : `${q._count.talents} talento(s) × ${q._count.columns} formato(s)`}
                </span>
                <span className="text-xs text-tinta-suave">
                  {ETIQUETA_ESTADO[q.status] ?? q.status}
                </span>
                {q.totalCents > 0 && (
                  <span className="text-sm font-semibold tabular-nums text-precio">
                    {formatMXN(q.totalCents)}
                  </span>
                )}
                <span className="text-xs text-etiqueta">
                  {fecha.format(q.actualizadoEn)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
