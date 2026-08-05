import type { Metadata } from 'next'
import Link from 'next/link'
import { listarLotes } from '@/server/data/importacion'
import { requireActor } from '@/server/data/actor'
import { can } from '@/lib/authz/policy'
import { SubirArchivo } from './subir'

export const metadata: Metadata = { title: 'Importaciones' }

const ETIQUETA_ESTADO: Record<string, string> = {
  UPLOADED: 'Subida',
  PARSED: 'Leída',
  PREVIEWED: 'Lista para revisar',
  COMMITTED: 'Aplicada',
  ABORTED: 'Descartada',
  FAILED: 'Falló',
}

const fecha = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

export default async function PaginaImportaciones() {
  const actor = await requireActor()
  const lotes = await listarLotes()
  const puedeAplicar = can(actor, 'importacion.aplicar').permitido

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-katana-800">
        Importar del CRM
      </h1>
      <p className="mt-2 max-w-prose text-sm text-tinta-suave">
        Sube el <strong>KATANA ENGINE — CRM COMERCIAL</strong> o el{' '}
        <strong>CRM Roster</strong>. Primero se calcula qué cambiaría y se
        revisa; nada toca el tarifario hasta que lo apliques.
        {!puedeAplicar && ' Aplicar lo hace un administrador.'}
      </p>

      <div className="mt-6">
        <SubirArchivo />
      </div>

      <h2 className="mt-12 text-lg font-semibold text-katana-800">Historial</h2>
      {lotes.length === 0 ? (
        <p className="mt-3 text-sm text-etiqueta">Todavía no se ha importado nada.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {lotes.map((l) => {
            const stats = l.stats as Record<string, number> | null
            return (
              <li key={l.id}>
                <Link
                  href={`/importaciones/${l.id}`}
                  className="flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-1
                             rounded-katana border border-katana-200 px-4 py-3
                             hover:border-katana-300 hover:bg-katana-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-tinta">
                    {l.originalFileName}
                  </span>
                  <span className="text-xs text-etiqueta">{l.kind}</span>
                  <span
                    className={
                      'text-xs font-medium ' +
                      (l.status === 'COMMITTED' ? 'text-exito' : 'text-alerta')
                    }
                  >
                    {ETIQUETA_ESTADO[l.status] ?? l.status}
                  </span>
                  {stats && (
                    <span className="text-xs text-tinta-suave">
                      {stats.talentosCreados ?? 0} alta(s) ·{' '}
                      {stats.tarifasEscritas ?? 0} tarifa(s)
                    </span>
                  )}
                  <span className="text-xs text-etiqueta">
                    {l.uploadedBy.nombre} · {fecha.format(l.uploadedAt)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
