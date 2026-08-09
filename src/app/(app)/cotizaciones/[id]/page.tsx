import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { leerEditor } from '@/server/data/cotizacion'
import { leerHoja, modoDeCotizacion } from '@/server/data/hoja'
import { rosterParaHoja } from '@/server/data/catalogo'
import { requireActor } from '@/server/data/actor'
import { logoDataUri } from '@/server/pdf/fuentes'
import { can } from '@/lib/authz/policy'
import type { EstadoCotizacion } from '@/lib/editor/tipos'
import { Editor } from './editor'
import { Hoja } from './hoja'

export const metadata: Metadata = { title: 'Cotización' }

/**
 * Una cotización se abre en la hoja de renglones o en el tabulador, según cómo
 * se creó.
 *
 * Los dos caminos conviven a propósito: el tabulador es el documento cuya
 * fidelidad está verificada contra el PDF real que la agencia le mandó a HONOR,
 * y las cotizaciones que ya existen tienen que seguir abriéndose como estaban.
 * Las nuevas nacen como hoja.
 */
export default async function PaginaCotizacion({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor()

  const modo = await modoDeCotizacion(id)
  if (!modo) notFound()

  // La misma decisión que tomará el servidor al guardar. Se calcula aquí para
  // que la pantalla no ofrezca campos que luego serían rechazados — y se dice
  // POR QUÉ, en vez de dejar los campos apagados sin explicación.
  const permiso = (estado: EstadoCotizacion) =>
    can(actor, 'cotizacion.editar', { creadoPorId: undefined, estado })

  const volver = (
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
  )

  if (modo === 'HOJA') {
    const [estado, roster] = await Promise.all([leerHoja(id), rosterParaHoja()])
    if (!estado) notFound()
    const decision = permiso(estado.estado)
    return (
      <>
        {volver}
        <Hoja
          inicial={estado}
          roster={roster}
          soloLectura={!decision.permitido}
          motivoSoloLectura={decision.permitido ? undefined : decision.motivo}
        />
      </>
    )
  }

  const estado = await leerEditor(id)
  if (!estado) notFound()
  const decision = permiso(estado.estado)

  return (
    <>
      {volver}
      <Editor
        inicial={estado}
        logoDataUri={logoDataUri()}
        soloLectura={!decision.permitido}
        motivoSoloLectura={decision.permitido ? undefined : decision.motivo}
      />
    </>
  )
}
