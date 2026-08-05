import type { Metadata } from 'next'
import { listarUsuarios } from '@/server/data/admin'
import { requireActor } from '@/server/data/actor'
import { etiquetaRol, type Rol } from '@/lib/authz/policy'
import { FormularioAlta, AccionesUsuario } from './formularios'

export const metadata: Metadata = { title: 'Usuarios' }

const ETIQUETA_ESTADO: Record<string, string> = {
  ACTIVO: 'Activo',
  SUSPENDIDO: 'Suspendido',
  DESACTIVADO: 'Desactivado',
}

const fechaHora = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

export default async function PaginaUsuarios() {
  const actor = await requireActor()
  const usuarios = await listarUsuarios()

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-katana-800">Usuarios</h1>
      <p className="mt-2 max-w-prose text-sm text-tinta-suave">
        Bajar un rol o suspender una cuenta cierra sus sesiones abiertas en el
        acto, no cuando la persona recargue.
      </p>

      <div className="mt-6">
        <FormularioAlta />
      </div>

      <ul className="mt-6 space-y-3">
        {usuarios.map((u) => (
          <li
            key={u.id}
            className={
              'rounded-katana border p-4 ' +
              (u.estado === 'ACTIVO' ? 'border-katana-200' : 'border-katana-200 bg-katana-50')
            }
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold text-katana-800">{u.nombre}</span>
              <span className="text-sm text-tinta-suave">{u.email}</span>
              <span className="text-xs font-medium text-katana-500">
                {etiquetaRol(u.rol as Rol)}
              </span>
              <span
                className={
                  'text-xs font-medium ' +
                  (u.estado === 'ACTIVO' ? 'text-exito' : 'text-alerta')
                }
              >
                {ETIQUETA_ESTADO[u.estado] ?? u.estado}
              </span>
              {u.esAprobador && (
                <span className="text-xs text-tinta-suave">aprueba</span>
              )}
              {u.id === actor.id && (
                <span className="text-xs text-etiqueta">— tú</span>
              )}
            </div>

            <p className="mt-1 text-xs text-etiqueta">
              {u.ultimoAccesoEn
                ? `Último acceso ${fechaHora.format(u.ultimoAccesoEn)}`
                : 'Nunca ha entrado'}
              {u.sesionesAbiertas > 0 && ` · ${u.sesionesAbiertas} sesión(es) abierta(s)`}
              {u.debeCambiarPassword && ' · debe cambiar su contraseña'}
              {u.bloqueado && ' · bloqueado por intentos fallidos'}
            </p>

            <AccionesUsuario
              usuario={{
                id: u.id, email: u.email, nombre: u.nombre,
                rol: u.rol as Rol, estado: u.estado,
                esAprobador: u.esAprobador, sesionesAbiertas: u.sesionesAbiertas,
              }}
              esMiCuenta={u.id === actor.id}
            />
          </li>
        ))}
      </ul>
    </main>
  )
}
