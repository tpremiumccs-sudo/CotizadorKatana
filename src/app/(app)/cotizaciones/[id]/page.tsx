import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { leerEditor } from '@/server/data/cotizacion'
import { requireActor } from '@/server/data/actor'
import { logoDataUri } from '@/server/pdf/fuentes'
import { can } from '@/lib/authz/policy'
import { Editor } from './editor'

export const metadata: Metadata = { title: 'Cotización' }

export default async function PaginaEditor({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor()
  const estado = await leerEditor(id)
  if (!estado) notFound()

  // La misma decisión que tomará el servidor al guardar. Se calcula aquí para
  // que la pantalla no ofrezca campos que luego serían rechazados — y se dice
  // POR QUÉ, en vez de dejar los campos apagados sin explicación.
  const decision = can(actor, 'cotizacion.editar', {
    creadoPorId: undefined,
    estado: estado.estado,
  })

  return (
    <>
      <nav className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
        <Link
          href="/cotizaciones"
          data-touch-target
          className="inline-flex min-h-[44px] items-center rounded-katana px-2
                     text-sm font-semibold text-katana-500 hover:bg-katana-100"
        >
          ← Cotizaciones
        </Link>
      </nav>
      <Editor
        inicial={estado}
        logoDataUri={logoDataUri()}
        soloLectura={!decision.permitido}
        motivoSoloLectura={decision.permitido ? undefined : decision.motivo}
      />
    </>
  )
}
