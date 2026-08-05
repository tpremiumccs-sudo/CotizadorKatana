import Link from 'next/link'
import { etiquetaRol, type Actor } from '@/lib/authz/policy'
import { cerrarSesionAccion } from '../(auth)/acceso/acciones'

/**
 * Barra de sesión.
 *
 * Muestra quién está dentro y con qué rol. No es decoración: en las juntas se
 * comparte el iPad, y ver "Comercial" arriba explica por qué un botón no está
 * — antes de que alguien piense que el sistema falla.
 */
export function BarraSesion({ actor }: { actor: Actor }) {
  return (
    <header className="border-b border-katana-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-2 sm:px-6">
        <Link
          href="/"
          className="text-xs font-bold tracking-[0.14em] text-katana-500"
        >
          KATANA TALENT
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            href="/cotizaciones"
            data-touch-target
            className="inline-flex min-h-[44px] items-center rounded-katana px-3
                       text-sm font-medium text-tinta hover:bg-katana-100"
          >
            Cotizaciones
          </Link>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium text-tinta">{actor.nombre}</p>
            <p className="truncate text-xs text-etiqueta">{etiquetaRol(actor.rol)}</p>
          </div>
          <form action={cerrarSesionAccion}>
            <button
              type="submit"
              data-touch-target
              className="min-h-[44px] rounded-katana px-3 text-sm font-semibold
                         text-katana-500 hover:bg-katana-100"
            >
              Salir
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
