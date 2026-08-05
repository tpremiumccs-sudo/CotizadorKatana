import type { Metadata } from 'next'
import Link from 'next/link'
import { opcionesParaNueva } from '@/server/data/catalogo'
import { FormularioNueva } from './formulario'

export const metadata: Metadata = { title: 'Nueva cotización' }

export default async function PaginaNueva() {
  const { talentos, formatos } = await opcionesParaNueva()

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <nav className="mb-4">
        <Link
          href="/cotizaciones"
          className="text-sm font-semibold text-katana-500 hover:underline"
        >
          ← Cotizaciones
        </Link>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight text-katana-800">
        Nueva cotización
      </h1>
      <p className="mt-2 max-w-prose text-sm text-tinta-suave">
        Elige el cliente, los talentos y los formatos. El tabulador queda armado
        con los precios del tarifario, y desde el editor se ajusta lo que haga
        falta para esta marca sin tocar el tarifario maestro.
      </p>

      <div className="mt-8">
        <FormularioNueva talentos={talentos} formatos={formatos} />
      </div>
    </main>
  )
}
