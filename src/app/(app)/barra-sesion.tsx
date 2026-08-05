import Link from 'next/link'
import { can, etiquetaRol, type Actor } from '@/lib/authz/policy'
import { cerrarSesionAccion } from '../(auth)/acceso/acciones'

/**
 * Barra de sesión y navegación.
 *
 * Muestra quién está dentro y con qué rol. No es decoración: en las juntas se
 * comparte el iPad, y ver "Comercial" arriba explica por qué un botón no está
 * — antes de que alguien piense que el sistema falla.
 *
 * Los enlaces se filtran con la MISMA función que decide en el servidor, así
 * que la barra no puede ofrecer una pantalla que luego rechazaría.
 */
export function BarraSesion({ actor }: { actor: Actor }) {
  const enlaces = [
    { href: '/cotizaciones', texto: 'Cotizaciones', accion: 'cotizacion.ver' },
    { href: '/tarifario', texto: 'Tarifario', accion: 'tarifario.ver' },
    { href: '/talentos', texto: 'Talentos', accion: 'talento.ver' },
    { href: '/importaciones', texto: 'Importar', accion: 'importacion.subir' },
    { href: '/admin/bitacora', texto: 'Bitácora', accion: 'bitacora.ver' },
    { href: '/admin/usuarios', texto: 'Usuarios', accion: 'usuario.ver' },
  ] as const

  const visibles = enlaces.filter((e) => can(actor, e.accion).permitido)

  return (
    <header className="border-b border-katana-200 bg-white">
      <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center gap-x-3
                      gap-y-1 px-4 py-2 sm:px-6">
        <Link
          href="/"
          data-touch-target
          className="inline-flex min-h-[44px] items-center rounded-katana px-2
                     text-xs font-bold tracking-[0.14em] text-katana-500
                     hover:bg-katana-100"
        >
          KATANA TALENT
        </Link>

        <nav aria-label="Principal" className="-mx-1 flex flex-1 items-center overflow-x-auto">
          {visibles.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              data-touch-target
              className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap
                         rounded-katana px-3 text-sm font-medium text-tinta
                         hover:bg-katana-100"
            >
              {e.texto}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 items-center gap-3">
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
