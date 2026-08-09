import Link from 'next/link'
import { requireActor } from '@/server/data/actor'
import { can } from '@/lib/authz/policy'
import { abrirHojaNueva } from './cotizaciones/nueva/acciones'

export default async function Inicio() {
  // El layout ya exigió sesión; aquí se vuelve a pedir el actor porque hace
  // falta el rol para decidir qué se ofrece. Es la misma lectura de sesión,
  // deduplicada por la caché de la petición.
  const actor = await requireActor()

  return (
    <main>
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight text-katana-800 sm:text-4xl">
          Cotizador
        </h1>
        <p className="mt-3 max-w-prose text-tinta-suave">
          Tabuladores de tarifas y cotizaciones para marcas, con vista previa
          idéntica al PDF que se envía.
        </p>

        {/* La acción principal es evidente: cotizar. Lo demás es secundario. */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {can(actor, 'cotizacion.crear').permitido && (
            <form action={abrirHojaNueva}>
              <button
                type="submit"
                data-touch-target
                className="inline-flex min-h-[44px] items-center rounded-katana bg-katana-500
                           px-5 text-sm font-semibold text-white hover:bg-katana-600"
              >
                Nueva cotización
              </button>
            </form>
          )}
          <Link
            href="/cotizaciones"
            data-touch-target
            className="inline-flex min-h-[44px] items-center rounded-katana border
                       border-katana-300 px-5 text-sm font-semibold text-katana-600
                       hover:bg-katana-100"
          >
            Cotizaciones anteriores
          </Link>
        </div>

        <div className="mt-10 rounded-katana border border-katana-200 bg-katana-100 p-5">
          <p className="text-sm text-tinta-suave">
            El tarifario se llena importando el CRM; cada cotización copia de
            ahí y se ajusta para su marca sin tocar los precios de lista.
            {!can(actor, 'cotizacion.crear').permitido &&
              ' Tu cuenta es de solo lectura: puedes consultar y descargar, no editar.'}
          </p>
          <Link
            href="/api/health"
            data-touch-target
            className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold
                       text-katana-500 underline underline-offset-4"
          >
            Ver estado del sistema
          </Link>
        </div>
      </div>
    </main>
  )
}
