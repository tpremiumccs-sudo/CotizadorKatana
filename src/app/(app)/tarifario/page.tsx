import type { Metadata } from 'next'
import { leerTarifario } from '@/server/data/tarifario'
import { requireActor } from '@/server/data/actor'
import { can } from '@/lib/authz/policy'
import { MatrizTarifario } from './matriz'

export const metadata: Metadata = { title: 'Tarifario' }

export default async function PaginaTarifario() {
  const actor = await requireActor()
  const tarifario = await leerTarifario()
  const puedeEditar = can(actor, 'tarifario.editar').permitido

  const total =
    tarifario.conteos.QUOTED +
    tarifario.conteos.PENDING +
    tarifario.conteos.CASE_BY_CASE +
    tarifario.conteos.NOT_APPLICABLE

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-katana-800">Tarifario</h1>
      <p className="mt-2 max-w-prose text-sm text-tinta-suave">
        Los precios de lista. Cada cotización nueva copia de aquí y luego se
        ajusta para su marca, así que subir un precio no reescribe lo que ya se
        mandó.
        {!puedeEditar && ' Tu cuenta puede consultar, no modificar.'}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Con precio', tarifario.conteos.QUOTED, 'text-exito'],
            ['Por validar', tarifario.conteos.PENDING, 'text-alerta'],
            ['Caso por caso', tarifario.conteos.CASE_BY_CASE, 'text-tinta-suave'],
            ['No aplica', tarifario.conteos.NOT_APPLICABLE, 'text-etiqueta'],
          ] as const
        ).map(([etiqueta, valor, color]) => (
          <div key={etiqueta} className="rounded-katana border border-katana-200 px-3 py-2">
            <dt className="text-xs text-etiqueta">{etiqueta}</dt>
            <dd className={`text-xl font-bold tabular-nums ${color}`}>
              {valor}
              <span className="ml-1 text-xs font-normal text-etiqueta">
                de {total}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8">
        <MatrizTarifario inicial={tarifario} soloLectura={!puedeEditar} />
      </div>
    </main>
  )
}
