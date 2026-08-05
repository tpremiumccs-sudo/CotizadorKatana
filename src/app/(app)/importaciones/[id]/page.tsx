import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { leerLote } from '@/server/data/importacion'
import { requireActor } from '@/server/data/actor'
import { can } from '@/lib/authz/policy'
import { RevisionImportacion } from './revision'

export const metadata: Metadata = { title: 'Revisar importación' }

export default async function PaginaRevision({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor()
  const lote = await leerLote(id)
  if (!lote) notFound()

  const puedeAplicar = can(actor, 'importacion.aplicar').permitido

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <nav className="mb-4">
        <Link
          href="/importaciones"
          className="text-sm font-semibold text-katana-500 hover:underline"
        >
          ← Importaciones
        </Link>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight text-katana-800">
        {lote.archivo}
      </h1>
      <p className="mt-1 text-sm text-tinta-suave">
        Subida por {lote.subidoPor} ·{' '}
        {(lote.bytes / 1_048_576).toFixed(1)} MB · {lote.tipo}
      </p>

      {lote.aplicadoEn ? (
        <div className="mt-6 rounded-katana border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-semibold text-exito">
            Esta importación ya se aplicó.
          </p>
          {lote.stats && (
            <p className="mt-1 text-sm text-tinta-suave">
              {lote.stats.talentosCreados} talento(s) nuevo(s),{' '}
              {lote.stats.talentosActualizados} actualizado(s),{' '}
              {lote.stats.tarifasEscritas} tarifa(s) escrita(s),{' '}
              {lote.stats.metricasEscritas} métrica(s).
            </p>
          )}
        </div>
      ) : !lote.plan ? (
        <p className="mt-6 text-sm text-error">
          Esta importación no llegó a calcular un plan. Vuelve a subir el archivo.
        </p>
      ) : (
        <RevisionImportacion
          importBatchId={lote.id}
          plan={lote.plan}
          puedeAplicar={puedeAplicar}
        />
      )}
    </main>
  )
}
